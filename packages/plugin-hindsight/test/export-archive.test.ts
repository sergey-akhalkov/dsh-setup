import { describe, expect, it } from 'vitest'
import {
  applyArchiveScope,
  bankFolderName,
  buildBankFiles,
  buildRepositoryIndex,
  ExportError,
  parseBankMetadata,
  parseRepositoryIndex,
  sanitizeBankId,
  sha256Hex,
  unsanitizeBankId,
} from '../lib/index.js'

const encoder = new TextEncoder()

function manifestFor(bankId: string, extra: Record<string, unknown> = {}): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      schema_version: 1,
      source_bank_id: bankId,
      archive_type: 'bank',
      document_count: 1,
      fact_count: 2,
      observation_count: 0,
      mental_model_count: 0,
      knowledge_page_count: 3,
      directive_count: 0,
      webhook_count: 0,
      attachment_count: 0,
      ...extra,
    }),
  )
}

/** A scoped archive with one entry per optional section. */
function archiveFor(bankId: string) {
  return new Map<string, Uint8Array>([
    ['manifest.json', manifestFor(bankId)],
    ['documents/000000.json', encoder.encode('{"id":"doc-1"}')],
    ['observations.json', encoder.encode('[]')],
    ['knowledge_pages.json', encoder.encode('[]')],
    ['history/audit_log.json', encoder.encode('[]')],
    ['attachments.json', encoder.encode('[]')],
    ['blobs/000001.bin', new Uint8Array([1, 2, 3])],
  ])
}

const DEFAULT_SCOPE = { includeHistory: false, includeAttachments: false }

describe('bank folder names', () => {
  it('round-trips any bank id through a Windows-safe path segment', () => {
    const ids = [
      'coding-agent::repo',
      'a/b\\c',
      'bank<with>"bad|chars?*',
      'trailing.dot.',
      '..',
      'with space',
      'память',
      'CON',
    ]
    for (const id of ids) {
      const sanitized = sanitizeBankId(id)
      expect(sanitized).toMatch(/^[A-Za-z0-9_%.-]*$/)
      expect(sanitized).not.toContain('/')
      expect(sanitized).not.toContain('\\')
      expect(unsanitizeBankId(sanitized)).toBe(id)
    }
    expect(bankFolderName('coding-agent::repo')).toMatch(/^[A-Za-z0-9_%-]+$/)
  })

  it('keeps distinct bank ids in distinct folders on a case-insensitive filesystem', () => {
    const names = ['Bank', 'bank', 'BANK', 'a:b', 'a%3Ab', '..', 'a/b'].map(bankFolderName)
    expect(new Set(names).size).toBe(names.length)
    expect(bankFolderName('Bank').toLowerCase()).not.toBe(bankFolderName('bank').toLowerCase())
    expect(bankFolderName('coding-agent::repo')).toBe(bankFolderName('coding-agent::repo'))
  })
})

describe('per-bank metadata', () => {
  it('writes export.json with counts, scope, and a checksum per stored entry', () => {
    const { files, metadata } = buildBankFiles({
      bankId: 'coding-agent::repo',
      operationId: 'op-1',
      exportedAt: '2026-10-29T12:00:00.000Z',
      entries: archiveFor('coding-agent::repo'),
      scope: DEFAULT_SCOPE,
    })
    expect(metadata.bank_id).toBe('coding-agent::repo')
    expect(metadata.counts.documents).toBe(1)
    expect(metadata.counts.facts).toBe(2)
    expect(metadata.counts.knowledgePages).toBe(3)
    expect(metadata.includes_history).toBe(false)
    expect(metadata.includes_attachments).toBe(false)
    expect(metadata.checksums['manifest.json']).toBe(sha256Hex(manifestFor('coding-agent::repo')))
    expect(files.has('export.json')).toBe(true)
    // The metadata is what recovers the original id, whatever the folder name is.
    const stored = parseBankMetadata(files.get('export.json') ?? new Uint8Array())
    expect(stored.bank_id).toBe('coding-agent::repo')
    expect(stored.archive_schema_version).toBe(1)
    expect(Object.keys(stored.checksums).sort()).toEqual(
      [...files.keys()].filter((path) => path !== 'export.json').sort(),
    )
  })

  it('omits history and attachments unless enabled', () => {
    const off = applyArchiveScope(archiveFor('b'), DEFAULT_SCOPE)
    expect(off.has('history/audit_log.json')).toBe(false)
    expect(off.has('attachments.json')).toBe(false)
    expect(off.has('blobs/000001.bin')).toBe(false)
    expect(off.has('documents/000000.json')).toBe(true)

    const on = applyArchiveScope(archiveFor('b'), {
      includeHistory: true,
      includeAttachments: true,
    })
    expect(on.has('history/audit_log.json')).toBe(true)
    expect(on.has('attachments.json')).toBe(true)
    expect(on.has('blobs/000001.bin')).toBe(true)
  })

  it('rejects an archive that is not a whole-bank export of the requested bank', () => {
    const foreign = new Map([
      ['manifest.json', manifestFor('another-bank')],
      ['documents/000000.json', encoder.encode('{}')],
    ])
    expect(() =>
      buildBankFiles({
        bankId: 'coding-agent::repo',
        operationId: 'op-1',
        exportedAt: '2026-10-29T12:00:00.000Z',
        entries: foreign,
        scope: DEFAULT_SCOPE,
      }),
    ).toThrowError(ExportError)

    const documentsOnly = new Map([
      ['manifest.json', manifestFor('coding-agent::repo', { archive_type: 'documents' })],
    ])
    expect(() =>
      buildBankFiles({
        bankId: 'coding-agent::repo',
        operationId: 'op-1',
        exportedAt: '2026-10-29T12:00:00.000Z',
        entries: documentsOnly,
        scope: DEFAULT_SCOPE,
      }),
    ).toThrowError(/whole-bank/)

    const unsupported = new Map([
      ['manifest.json', manifestFor('coding-agent::repo', { schema_version: 2 })],
    ])
    expect(() =>
      buildBankFiles({
        bankId: 'coding-agent::repo',
        operationId: 'op-1',
        exportedAt: '2026-10-29T12:00:00.000Z',
        entries: unsupported,
        scope: DEFAULT_SCOPE,
      }),
    ).toThrowError(/schema version/)
  })
})

describe('repository index', () => {
  it('lists banks sorted by id and round-trips through JSON', () => {
    const bytes = buildRepositoryIndex('2026-10-29T12:00:00.000Z', 'hash-1', [
      {
        bank_id: 'z-bank',
        folder: bankFolderName('z-bank'),
        exported_at: '2026-10-29T12:00:00.000Z',
        operation_id: 'op-z',
        documents: 1,
        facts: 2,
        metadata_sha256: 'abc',
      },
      {
        bank_id: 'a-bank',
        folder: bankFolderName('a-bank'),
        exported_at: '2026-10-29T12:00:00.000Z',
        operation_id: 'op-a',
        documents: 3,
        facts: 4,
        metadata_sha256: 'def',
      },
    ])
    const index = parseRepositoryIndex(bytes)
    expect(index?.banks.map((entry) => entry.bank_id)).toEqual(['a-bank', 'z-bank'])
    expect(index?.content_hash).toBe('hash-1')
  })

  it('treats a missing or foreign index as no previous snapshot', () => {
    expect(parseRepositoryIndex(encoder.encode('{"schema_version":1}'))).toBeUndefined()
    expect(parseRepositoryIndex(encoder.encode('not json'))).toBeUndefined()
    expect(
      parseRepositoryIndex(encoder.encode('{"schema_version":9,"content_hash":"x","banks":[]}')),
    ).toBeUndefined()
  })
})
