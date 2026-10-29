import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { rootDir } from '../lib/workspace.ts'

/**
 * The restore script is exercised as a real process against a fixture export
 * tree; `pwsh` availability is the same prerequisite the other PowerShell
 * checks have.
 */

const SCRIPT = join(rootDir, 'restore-hindsight.ps1')
const PWSH = process.env.PWSH ?? 'pwsh'
const hasPwsh =
  spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
    stdio: 'ignore',
  }).status === 0

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-restore-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (!dir.startsWith(tmpdir())) throw new Error(`refusing to remove ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
    } catch {
      // Windows keeps read-only Git object files briefly; %TEMP% may clean up.
    }
  }
})

function sha256(bytes: string): string {
  return createHash('sha256').update(bytes, 'utf8').digest('hex')
}

export interface FixtureOptions {
  includeHistory?: boolean
}

export interface FixtureBank {
  bankId: string
  folder: string
  counts: {
    documents: number
    facts: number
    observations: number
    mental_models: number
    knowledge_pages: number
  }
}

/** Write one bank folder and its metadata exactly as the exporter does. */
function writeBank(
  root: string,
  folder: string,
  bankId: string,
  options: FixtureOptions,
): FixtureBank {
  const dir = join(root, 'banks', folder)
  mkdirSync(join(dir, 'documents'), { recursive: true })
  const counts = {
    documents: 1,
    facts: 2,
    observations: 0,
    mental_models: 0,
    knowledge_pages: 1,
  }
  const manifest = {
    schema_version: 1,
    source_bank_id: bankId,
    exported_at: '2026-10-29T12:00:00Z',
    archive_type: 'bank',
    document_count: counts.documents,
    fact_count: counts.facts,
    observation_count: counts.observations,
    mental_model_count: counts.mental_models,
    knowledge_page_count: counts.knowledge_pages,
    directive_count: 0,
    webhook_count: 0,
    includes_history: options.includeHistory === true,
    attachment_count: 0,
  }
  const files: Record<string, string> = {
    'manifest.json': JSON.stringify(manifest),
    'documents/000000.json': JSON.stringify({
      id: 'doc-1',
      chunks: [{ chunk_index: 0, chunk_text: `memory for ${bankId}` }],
      facts: [],
    }),
    'observations.json': '[]',
    'mental_models.json': '[]',
    'knowledge_pages.json': JSON.stringify([{ id: 'page-1', kind: 'page', name: 'Repo' }]),
  }
  if (options.includeHistory === true) {
    files['history/audit_log.json'] = '[]'
  }
  for (const [path, content] of Object.entries(files)) {
    const absolute = join(dir, ...path.split('/'))
    mkdirSync(join(absolute, '..'), { recursive: true })
    writeFileSync(absolute, content)
  }
  const checksums: Record<string, string> = {}
  for (const [path, content] of Object.entries(files)) checksums[path] = sha256(content)
  const metadata = {
    schema_version: 1,
    bank_id: bankId,
    exported_at: '2026-10-29T12:00:00Z',
    operation_id: 'op-fixture',
    archive_schema_version: 1,
    archive_type: 'bank',
    counts,
    includes_history: options.includeHistory === true,
    includes_attachments: false,
    checksums,
  }
  writeFileSync(join(dir, 'export.json'), JSON.stringify(metadata, null, 2))
  return { bankId, folder, counts }
}

/** Write the repository index and return the export root. */
function writeFixture(
  root: string,
  banks: Array<{ folder: string; bankId: string }>,
  options: FixtureOptions = {},
): FixtureBank[] {
  const fixtures = banks.map((bank) => writeBank(root, bank.folder, bank.bankId, options))
  writeFileSync(
    join(root, 'index.json'),
    JSON.stringify(
      {
        schema_version: 1,
        updated_at: '2026-10-29T12:00:00Z',
        content_hash: 'fixture',
        banks: fixtures.map((bank) => ({
          bank_id: bank.bankId,
          folder: bank.folder,
          exported_at: '2026-10-29T12:00:00Z',
          operation_id: 'op-fixture',
          documents: bank.counts.documents,
          facts: bank.counts.facts,
          metadata_sha256: 'fixture',
        })),
      },
      null,
      2,
    ),
  )
  return fixtures
}

interface ScriptResult {
  code: number | null
  stdout: string
  stderr: string
}

function runScript(args: string[], env: NodeJS.ProcessEnv = {}): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(PWSH, ['-NoProfile', '-NonInteractive', '-File', SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

interface RecordedRequest {
  method: string
  path: string
  query: URLSearchParams
  body: Buffer
}

interface FakeApi {
  url: string
  banks: Set<string>
  requests: RecordedRequest[]
  close(): Promise<void>
}

const DEFAULT_IMPORT_COUNTS = {
  documents_imported: 1,
  facts_imported: 2,
  observations_imported: 0,
  mental_models_imported: 0,
  knowledge_pages_imported: 1,
}

/** A stand-in for the documented Hindsight REST surface used by the restore path. */
async function startFakeApi(
  options: {
    banks?: string[]
    counts?: Record<string, number>
    healthy?: boolean
    pageSize?: number
  } = {},
): Promise<FakeApi> {
  const banks = new Set(options.banks ?? [])
  const requests: RecordedRequest[] = []
  const operations = new Map<string, { counts: Record<string, number> }>()
  const pageSize = options.pageSize ?? 100
  let sequence = 0
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = Buffer.concat(chunks)
      const method = request.method ?? 'GET'
      requests.push({ method, path: url.pathname, query: url.searchParams, body })
      const segments = url.pathname.split('/').filter((segment) => segment !== '')
      const send = (status: number, payload: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' })
        response.end(JSON.stringify(payload))
      }

      if (method === 'GET' && url.pathname === '/health') {
        send(200, {
          status: options.healthy === false ? 'unhealthy' : 'healthy',
          database: 'connected',
        })
        return
      }
      if (method === 'GET' && segments.length === 3 && segments[2] === 'banks') {
        const offset = Number(url.searchParams.get('offset') ?? '0')
        const ids = [...banks].sort()
        send(200, {
          banks: ids.slice(offset, offset + pageSize).map((bank_id) => ({ bank_id })),
          total: ids.length,
          limit: pageSize,
          offset,
        })
        return
      }
      if (segments[0] === 'v1' && segments[2] === 'banks' && segments[3] !== undefined) {
        const bank = decodeURIComponent(segments[3] ?? '')
        if (method === 'PUT' && segments.length === 4) {
          banks.add(bank)
          send(200, { bank_id: bank, name: bank, disposition: {}, mission: '' })
          return
        }
        if (method === 'DELETE' && segments.length === 4) {
          banks.delete(bank)
          send(200, {})
          return
        }
        if (method === 'POST' && segments[4] === 'transfer' && segments[5] === 'import') {
          sequence += 1
          const operationId = `op-${sequence}`
          operations.set(operationId, {
            counts: { ...DEFAULT_IMPORT_COUNTS, ...options.counts },
          })
          send(202, { operation_id: operationId, status: 'pending' })
          return
        }
        if (method === 'GET' && segments[4] === 'operations' && segments[5] !== undefined) {
          const operation = operations.get(decodeURIComponent(segments[5] ?? ''))
          send(200, {
            operation_id: segments[5],
            status: 'completed',
            result_metadata: operation?.counts ?? DEFAULT_IMPORT_COUNTS,
            error_message: null,
          })
          return
        }
      }
      send(404, { detail: `no route for ${method} ${url.pathname}` })
    })()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    banks,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

function importRequest(api: FakeApi): RecordedRequest | undefined {
  return api.requests.find((request) => request.path.endsWith('/transfer/import'))
}

describe.skipIf(!hasPwsh)('restore-hindsight.ps1', () => {
  it('rebuilds each archive, inspects it, and changes no bank in dry-run mode', async () => {
    const root = tempDir()
    writeFixture(root, [
      { folder: 'bank-one', bankId: 'coding-agent::one' },
      { folder: 'bank-two', bankId: 'coding-agent::two' },
    ])
    const before = readFileSync(join(root, 'banks', 'bank-one', 'export.json'), 'utf8')
    const archives = join(tempDir(), 'rebuilt')
    // A recording endpoint proves a dry run sends nothing at all.
    const requests: string[] = []
    const server: Server = createServer((request, response) => {
      requests.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`)
      response.writeHead(500)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    try {
      const port = (server.address() as AddressInfo).port
      const result = await runScript([
        '-From',
        root,
        '-DryRun',
        '-ArchiveOut',
        archives,
        '-ApiUrl',
        `http://127.0.0.1:${port}`,
      ])
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain(
        "would restore bank 'coding-agent::one' into 'coding-agent::one'",
      )
      expect(result.stdout).toContain(
        "would restore bank 'coding-agent::two' into 'coding-agent::two'",
      )
      expect(result.stdout).toMatch(/1 documents, 2 facts/)
      expect(result.stdout).toContain('done')
      expect(requests).toHaveLength(0)

      // The rebuilt archive is a real ZIP with the stored entries and bytes.
      const entry = join(rootDir, 'packages/plugin-hindsight/lib/index.js')
      const { unpackArchive } = (await import(pathToFileURL(entry).href)) as {
        unpackArchive: (zip: Uint8Array) => Map<string, Uint8Array>
      }
      const zip = new Uint8Array(readFileSync(join(archives, 'bank-one.zip')))
      const entries = unpackArchive(zip)
      expect([...entries.keys()].sort()).toEqual([
        'documents/000000.json',
        'knowledge_pages.json',
        'manifest.json',
        'mental_models.json',
        'observations.json',
      ])
      expect(entries.has('export.json')).toBe(false)
      const document = new TextDecoder().decode(entries.get('documents/000000.json'))
      expect(document).toBe(
        readFileSync(join(root, 'banks', 'bank-one', 'documents', '000000.json'), 'utf8'),
      )
      // The script writes nothing into the export tree it reads.
      expect(readFileSync(join(root, 'banks', 'bank-one', 'export.json'), 'utf8')).toBe(before)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('reports a checksum mismatch and exits non-zero', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    writeFileSync(join(root, 'banks', 'bank-one', 'documents', '000000.json'), '{"tampered":true}')
    const result = await runScript(['-From', root, '-DryRun'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('checksum mismatch for documents/000000.json')
  })

  it('rejects a stored file that no checksum covers', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    writeFileSync(
      join(root, 'banks', 'bank-one', 'documents', '000001.json'),
      JSON.stringify({ id: 'doc-2' }),
    )
    const result = await runScript(['-From', root, '-DryRun'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('file(s) without a checksum in export.json')
  })

  it('rejects a bank id that the tree does not contain', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    const result = await runScript(['-From', root, '-Bank', 'missing-bank', '-DryRun'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('bank(s) not found in the export tree: missing-bank')
  })

  it('restores an absent bank and verifies the imported counts', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    const api = await startFakeApi({ banks: [] })
    try {
      const result = await runScript(['-From', root, '-ApiUrl', api.url])
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain("restored bank 'coding-agent::one' -> 'coding-agent::one'")
      const submit = importRequest(api)
      expect(submit).toBeDefined()
      expect(submit?.method).toBe('POST')
      expect(submit?.query.get('mode')).toBe('restore')
      expect(submit?.query.get('target_bank_id')).toBe('coding-agent::one')
      // The multipart body carries a real ZIP under the documented `file` field.
      const body = submit?.body ?? Buffer.alloc(0)
      expect(/name="?file"?/u.test(body.toString('latin1'))).toBe(true)
      expect(body.includes(Buffer.from('PK\x03\x04', 'latin1'))).toBe(true)
      // The operation bank is temporary and leaves no bank behind.
      const created = api.requests.filter(
        (request) => request.method === 'PUT' && request.path.startsWith('/v1/default/banks/'),
      )
      expect(created).toHaveLength(1)
      expect(created[0]?.path).toMatch(/^\/v1\/default\/banks\/hindsight-restore-[0-9a-f]{8}$/)
      expect(api.banks.size).toBe(0)
      const deleted = api.requests.filter((request) => request.method === 'DELETE')
      expect(deleted).toHaveLength(1)
    } finally {
      await api.close()
    }
  })

  it('refuses to restore over an existing bank and names the merge option', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    const api = await startFakeApi({ banks: ['coding-agent::one'] })
    try {
      const result = await runScript(['-From', root, '-ApiUrl', api.url])
      expect(result.code).toBe(2)
      expect(result.stderr).toContain("target bank 'coding-agent::one' already exists")
      expect(result.stderr).toContain('-Mode merge')
      expect(importRequest(api)).toBeUndefined()
    } finally {
      await api.close()
    }
  })

  it('paginates the bank listing when the existing target is past the first page', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    const filler = Array.from({ length: 100 }, (_, index) => `filler-${index}`)
    const api = await startFakeApi({ banks: [...filler, 'coding-agent::one'], pageSize: 100 })
    try {
      const result = await runScript(['-From', root, '-ApiUrl', api.url])
      expect(result.code).toBe(2)
      expect(result.stderr).toContain("target bank 'coding-agent::one' already exists")
      const listings = api.requests.filter(
        (request) => request.method === 'GET' && request.path === '/v1/default/banks',
      )
      expect(listings.map((request) => request.query.get('offset'))).toEqual(['0', '100'])
      expect(importRequest(api)).toBeUndefined()
    } finally {
      await api.close()
    }
  })

  it('exits non-zero when imported counts differ from the manifest', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    const api = await startFakeApi({ banks: [], counts: { documents_imported: 2 } })
    try {
      const result = await runScript(['-From', root, '-ApiUrl', api.url])
      expect(result.code).toBe(3)
      expect(result.stderr).toContain('imported counts differ from the manifest')
      expect(result.stderr).toContain('documents: expected 1, imported 2')
    } finally {
      await api.close()
    }
  })

  it('merges documents into an existing bank without a temporary bank', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    const api = await startFakeApi({ banks: ['coding-agent::one'] })
    try {
      const result = await runScript(['-From', root, '-ApiUrl', api.url, '-Mode', 'merge'])
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout).toContain("merged bank 'coding-agent::one': 1 documents imported")
      const submit = importRequest(api)
      expect(submit?.query.get('mode')).toBe('merge')
      expect(submit?.query.get('target_bank_id')).toBeNull()
      expect(api.requests.some((request) => request.method === 'PUT')).toBe(false)
      expect(api.requests.some((request) => request.method === 'DELETE')).toBe(false)
    } finally {
      await api.close()
    }
  })

  it('refuses a merge into a bank that does not exist', async () => {
    const root = tempDir()
    writeFixture(root, [{ folder: 'bank-one', bankId: 'coding-agent::one' }])
    const api = await startFakeApi({ banks: [] })
    try {
      const result = await runScript(['-From', root, '-ApiUrl', api.url, '-Mode', 'merge'])
      expect(result.code).toBe(1)
      expect(result.stderr).toContain("merge target 'coding-agent::one' does not exist")
      expect(importRequest(api)).toBeUndefined()
    } finally {
      await api.close()
    }
  })
})
