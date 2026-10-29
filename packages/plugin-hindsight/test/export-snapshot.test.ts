import { spawn } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  acquireSnapshotLock,
  BANKS_DIR,
  bankFolderName,
  ExportError,
  INDEX_FILE,
  LOCK_FILE,
  normalizedContentHash,
  PENDING_FILE,
  STAGING_DIR,
  unpackArchive,
  writeSnapshot,
} from '../lib/index.js'
import { fakeArchive } from './fake-hindsight.js'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-export-snapshot-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  // Remove only the directories this test created under the OS temp root.
  for (const dir of tempDirs.splice(0)) {
    if (!dir.startsWith(tmpdir())) throw new Error(`refusing to remove ${dir}`)
    rmSync(dir, { recursive: true, force: true })
  }
})

function snapshotInput(bankId: string, content: string, exportedAt = '2026-10-29T12:00:00.000Z') {
  return {
    bankId,
    operationId: `op-${content}`,
    exportedAt,
    entries: unpackArchive(fakeArchive(bankId, content)),
  }
}

const SCOPE = { includeHistory: false, includeAttachments: false }

function bankFolders(dir: string): string[] {
  const banks = join(dir, BANKS_DIR)
  return existsSync(banks) ? readdirSync(banks).sort() : []
}

describe('snapshot writer', () => {
  it('writes the bank tree and the index, and replaces only changed content', () => {
    const dir = tempDir()
    const first = writeSnapshot(dir, [snapshotInput('coding-agent::repo', 'one')], SCOPE)
    expect(first.changed).toBe(true)
    expect(bankFolders(dir)).toEqual([bankFolderName('coding-agent::repo')])
    const folder = join(dir, BANKS_DIR, bankFolderName('coding-agent::repo'))
    expect(existsSync(join(folder, 'export.json'))).toBe(true)
    expect(existsSync(join(folder, 'manifest.json'))).toBe(true)
    const index = JSON.parse(readFileSync(join(dir, INDEX_FILE), 'utf8')) as {
      content_hash: string
      banks: Array<{ bank_id: string }>
    }
    expect(index.content_hash).toBe(first.contentHash)
    expect(index.banks.map((bank) => bank.bank_id)).toEqual(['coding-agent::repo'])
    const indexBytes = readFileSync(join(dir, INDEX_FILE))

    // Same archive content, new export time: nothing to write.
    const second = writeSnapshot(
      dir,
      [snapshotInput('coding-agent::repo', 'one', '2026-10-30T00:00:00.000Z')],
      SCOPE,
    )
    expect(second.changed).toBe(false)
    expect(second.contentHash).toBe(first.contentHash)
    expect(readFileSync(join(dir, INDEX_FILE)).equals(indexBytes)).toBe(true)

    // Changed content: one replacement, no leftovers.
    const third = writeSnapshot(dir, [snapshotInput('coding-agent::repo', 'two')], SCOPE)
    expect(third.changed).toBe(true)
    expect(third.contentHash).not.toBe(first.contentHash)
    expect(bankFolders(dir)).toEqual([bankFolderName('coding-agent::repo')])
    expect(readdirSync(dir).some((name) => name.startsWith('banks.old-'))).toBe(false)
    expect(existsSync(join(dir, STAGING_DIR))).toBe(false)
    const stored = JSON.parse(readFileSync(join(folder, 'documents', '000000.json'), 'utf8')) as {
      chunks: Array<{ chunk_text: string }>
    }
    expect(stored.chunks[0]?.chunk_text).toBe('two')
  })

  it('drops a bank that no longer exists and keeps the rest', () => {
    const dir = tempDir()
    writeSnapshot(dir, [snapshotInput('a', 'x'), snapshotInput('b', 'y')], SCOPE)
    const after = writeSnapshot(dir, [snapshotInput('a', 'x')], SCOPE)
    expect(after.changed).toBe(true)
    expect(bankFolders(dir)).toEqual([bankFolderName('a')])
  })

  it('records the requested scope in the stored tree', () => {
    const dir = tempDir()
    writeSnapshot(dir, [snapshotInput('a', 'x')], {
      includeHistory: true,
      includeAttachments: true,
    })
    const folder = join(dir, BANKS_DIR, bankFolderName('a'))
    // The fixture has no history or attachments; the metadata reports absence truthfully.
    const metadata = JSON.parse(readFileSync(join(folder, 'export.json'), 'utf8')) as {
      includes_history: boolean
      includes_attachments: boolean
    }
    expect(metadata.includes_history).toBe(false)
    expect(metadata.includes_attachments).toBe(false)
  })
})

describe('normalized content hash', () => {
  it('ignores key order and array order but not content', () => {
    const encoder = new TextEncoder()
    const a = new Map([['one', new Map([['data/x.json', encoder.encode('{"a":1,"b":[1,2]}')]])]])
    const b = new Map([['one', new Map([['data/x.json', encoder.encode('{"b":[2,1],"a":1}')]])]])
    const c = new Map([['one', new Map([['data/x.json', encoder.encode('{"a":2,"b":[1,2]}')]])]])
    expect(normalizedContentHash(a)).toBe(normalizedContentHash(b))
    expect(normalizedContentHash(a)).not.toBe(normalizedContentHash(c))
  })
})

describe('single-writer lock', () => {
  it('refuses a live lock and releases its own', () => {
    const dir = tempDir()
    const held = acquireSnapshotLock(dir, { owner: 'first' })
    expect(() => acquireSnapshotLock(dir, { owner: 'second' })).toThrowError(ExportError)
    try {
      acquireSnapshotLock(dir, { owner: 'second' })
    } catch (error) {
      expect((error as ExportError).code).toBe('lock')
    }
    held.release()
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false)
    const again = acquireSnapshotLock(dir, { owner: 'second' })
    again.release()
  })

  it('takes over a stale lock and ignores a foreign release', () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, LOCK_FILE),
      JSON.stringify({ owner: 'crashed', created_at: '2026-01-01T00:00:00.000Z' }),
    )
    const recovered = acquireSnapshotLock(dir, { owner: 'recovered' })
    expect(recovered.owner).toBe('recovered')
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).owner).toBe('recovered')

    const later = acquireSnapshotLock(dir, { owner: 'later', staleAfterMs: 0 })
    // The old holder's release must not remove the new holder's lock.
    recovered.release()
    expect(JSON.parse(readFileSync(join(dir, LOCK_FILE), 'utf8')).owner).toBe('later')
    later.release()
    expect(existsSync(join(dir, LOCK_FILE))).toBe(false)
  })
})

const LIB_MODULE = pathToFileURL(
  join(process.cwd(), 'packages/plugin-hindsight/lib/export-snapshot.js'),
).href

/** A child process that competes for the lock, so the exclusion is real. */
function lockScript(dir: string): string {
  const script = join(dir, 'acquire-lock.mjs')
  writeFileSync(
    script,
    [
      `import { acquireSnapshotLock } from ${JSON.stringify(LIB_MODULE)}`,
      `const [directory, owner, stale, hold] = process.argv.slice(2)`,
      `try {`,
      `  const lock = acquireSnapshotLock(directory, { owner, staleAfterMs: Number(stale) })`,
      `  console.log('acquired')`,
      `  setTimeout(() => { lock.release(); process.exit(0) }, Number(hold))`,
      `} catch (error) {`,
      `  console.log('refused:' + (error && error.code ? error.code : 'unknown'))`,
      `  process.exit(0)`,
      `}`,
    ].join('\n'),
  )
  return script
}

function runLockChild(script: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      output += String(chunk)
    })
    child.on('error', reject)
    child.on('close', () => resolve(output.trim()))
  })
}

describe('single-writer lock across processes', () => {
  it('lets exactly one of several concurrent processors acquire a free lock', async () => {
    const dir = tempDir()
    const script = lockScript(dir)
    const results = await Promise.all(
      ['p1', 'p2', 'p3', 'p4', 'p5'].map((owner) =>
        runLockChild(script, [dir, owner, '60000', '1500']),
      ),
    )
    expect(results.filter((result) => result === 'acquired')).toHaveLength(1)
    expect(results.filter((result) => result.startsWith('refused:'))).toHaveLength(4)
  }, 20_000)

  it('lets exactly one processor take over a stale lock', async () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, LOCK_FILE),
      JSON.stringify({ owner: 'crashed', created_at: '2026-01-01T00:00:00.000Z' }),
    )
    const script = lockScript(dir)
    const results = await Promise.all(
      ['p1', 'p2', 'p3', 'p4', 'p5'].map((owner) =>
        runLockChild(script, [dir, owner, '60000', '1500']),
      ),
    )
    expect(results.filter((result) => result === 'acquired')).toHaveLength(1)
  }, 20_000)
})

describe('snapshot crash recovery', () => {
  it('restores the previous tree when the crash happened before the swap', () => {
    const dir = tempDir()
    const original = writeSnapshot(dir, [snapshotInput('coding-agent::repo', 'one')], SCOPE)
    const banksDir = join(dir, BANKS_DIR)
    const backup = join(dir, 'banks.old-crash')
    renameSync(banksDir, backup)
    writeFileSync(join(dir, PENDING_FILE), JSON.stringify({ backup: 'banks.old-crash' }))

    const result = writeSnapshot(
      dir,
      [snapshotInput('coding-agent::repo', 'one', '2026-11-01T00:00:00.000Z')],
      SCOPE,
    )
    expect(result.changed).toBe(false)
    expect(result.contentHash).toBe(original.contentHash)
    expect(existsSync(banksDir)).toBe(true)
    expect(existsSync(backup)).toBe(false)
    expect(existsSync(join(dir, PENDING_FILE))).toBe(false)
    const index = JSON.parse(readFileSync(join(dir, INDEX_FILE), 'utf8')) as {
      content_hash: string
    }
    expect(index.content_hash).toBe(original.contentHash)
  })

  it('keeps the installed tree and finishes the index swap after a crash', () => {
    const dir = tempDir()
    writeSnapshot(dir, [snapshotInput('coding-agent::repo', 'one')], SCOPE)
    // Build the next snapshot elsewhere so the crashed state can be assembled.
    const next = tempDir()
    const nextSnapshot = writeSnapshot(next, [snapshotInput('coding-agent::repo', 'two')], SCOPE)

    const backup = join(dir, 'banks.old-crash')
    renameSync(join(dir, BANKS_DIR), backup)
    cpSync(join(next, BANKS_DIR), join(dir, BANKS_DIR), { recursive: true })
    mkdirSync(join(dir, STAGING_DIR), { recursive: true })
    cpSync(join(next, INDEX_FILE), join(dir, STAGING_DIR, INDEX_FILE))
    writeFileSync(join(dir, PENDING_FILE), JSON.stringify({ backup: 'banks.old-crash' }))

    const result = writeSnapshot(
      dir,
      [snapshotInput('coding-agent::repo', 'two', '2026-11-01T00:00:00.000Z')],
      SCOPE,
    )
    expect(result.changed).toBe(false)
    expect(result.contentHash).toBe(nextSnapshot.contentHash)
    expect(existsSync(backup)).toBe(false)
    expect(existsSync(join(dir, STAGING_DIR))).toBe(false)
    expect(existsSync(join(dir, PENDING_FILE))).toBe(false)
    const index = JSON.parse(readFileSync(join(dir, INDEX_FILE), 'utf8')) as {
      content_hash: string
      banks: Array<{ documents: number }>
    }
    expect(index.content_hash).toBe(nextSnapshot.contentHash)
    const stored = JSON.parse(
      readFileSync(
        join(dir, BANKS_DIR, bankFolderName('coding-agent::repo'), 'documents', '000000.json'),
        'utf8',
      ),
    ) as { chunks: Array<{ chunk_text: string }> }
    expect(stored.chunks[0]?.chunk_text).toBe('two')
  })

  it('keeps the original tree when the crash came right after the journal write', () => {
    const dir = tempDir()
    const original = writeSnapshot(dir, [snapshotInput('coding-agent::repo', 'one')], SCOPE)
    const next = tempDir()
    const nextSnapshot = writeSnapshot(next, [snapshotInput('coding-agent::repo', 'two')], SCOPE)
    // State immediately after the journal write: the new tree is still staged,
    // the original banks and index are untouched, and no backup exists yet.
    cpSync(join(next, BANKS_DIR), join(dir, STAGING_DIR, BANKS_DIR), { recursive: true })
    cpSync(join(next, INDEX_FILE), join(dir, STAGING_DIR, INDEX_FILE))
    writeFileSync(join(dir, PENDING_FILE), JSON.stringify({ backup: 'banks.old-crash' }))

    const result = writeSnapshot(
      dir,
      [snapshotInput('coding-agent::repo', 'two', '2026-11-01T00:00:00.000Z')],
      SCOPE,
    )
    // The uninstalled stage must not masquerade as the current snapshot.
    expect(result.changed).toBe(true)
    expect(result.contentHash).toBe(nextSnapshot.contentHash)
    expect(result.contentHash).not.toBe(original.contentHash)
    expect(existsSync(join(dir, STAGING_DIR))).toBe(false)
    expect(existsSync(join(dir, PENDING_FILE))).toBe(false)
    const index = JSON.parse(readFileSync(join(dir, INDEX_FILE), 'utf8')) as {
      content_hash: string
    }
    expect(index.content_hash).toBe(nextSnapshot.contentHash)
    const stored = JSON.parse(
      readFileSync(
        join(dir, BANKS_DIR, bankFolderName('coding-agent::repo'), 'documents', '000000.json'),
        'utf8',
      ),
    ) as { chunks: Array<{ chunk_text: string }> }
    expect(stored.chunks[0]?.chunk_text).toBe('two')
  })

  it('never publishes a staged index after an interrupted rollback', () => {
    const dir = tempDir()
    const original = writeSnapshot(dir, [snapshotInput('coding-agent::repo', 'one')], SCOPE)
    const next = tempDir()
    const nextSnapshot = writeSnapshot(next, [snapshotInput('coding-agent::repo', 'two')], SCOPE)
    // State left by a rollback that restored the old banks but was interrupted
    // before it could delete the new index: no staged banks remain.
    mkdirSync(join(dir, STAGING_DIR), { recursive: true })
    cpSync(join(next, INDEX_FILE), join(dir, STAGING_DIR, INDEX_FILE))
    writeFileSync(
      join(dir, PENDING_FILE),
      JSON.stringify({ backup: 'banks.old-crash', phase: 'rollback' }),
    )

    const result = writeSnapshot(
      dir,
      [snapshotInput('coding-agent::repo', 'two', '2026-11-01T00:00:00.000Z')],
      SCOPE,
    )
    expect(result.changed).toBe(true)
    expect(result.contentHash).toBe(nextSnapshot.contentHash)
    expect(result.contentHash).not.toBe(original.contentHash)
    const index = JSON.parse(readFileSync(join(dir, INDEX_FILE), 'utf8')) as {
      content_hash: string
    }
    expect(index.content_hash).toBe(nextSnapshot.contentHash)
    expect(existsSync(join(dir, STAGING_DIR))).toBe(false)
    expect(existsSync(join(dir, PENDING_FILE))).toBe(false)
  })

  it('restores the old tree when rollback was interrupted before removing the replacement', () => {
    const dir = tempDir()
    const original = writeSnapshot(dir, [snapshotInput('coding-agent::repo', 'one')], SCOPE)
    const next = tempDir()
    const nextSnapshot = writeSnapshot(next, [snapshotInput('coding-agent::repo', 'two')], SCOPE)
    // State right after the rollback journal was recorded and before the
    // installed replacement was removed: new banks, old index, old backup.
    const backup = join(dir, 'banks.old-crash')
    renameSync(join(dir, BANKS_DIR), backup)
    cpSync(join(next, BANKS_DIR), join(dir, BANKS_DIR), { recursive: true })
    mkdirSync(join(dir, STAGING_DIR), { recursive: true })
    cpSync(join(next, INDEX_FILE), join(dir, STAGING_DIR, INDEX_FILE))
    writeFileSync(
      join(dir, PENDING_FILE),
      JSON.stringify({ backup: 'banks.old-crash', phase: 'rollback' }),
    )

    // The old content is what recovery restores, so exporting it is a no-op.
    const unchanged = writeSnapshot(
      dir,
      [snapshotInput('coding-agent::repo', 'one', '2026-11-01T00:00:00.000Z')],
      SCOPE,
    )
    expect(unchanged.changed).toBe(false)
    expect(unchanged.contentHash).toBe(original.contentHash)
    expect(existsSync(backup)).toBe(false)
    expect(existsSync(join(dir, STAGING_DIR))).toBe(false)
    expect(existsSync(join(dir, PENDING_FILE))).toBe(false)
    const oldIndex = JSON.parse(readFileSync(join(dir, INDEX_FILE), 'utf8')) as {
      content_hash: string
    }
    expect(oldIndex.content_hash).toBe(original.contentHash)
    const stored = JSON.parse(
      readFileSync(
        join(dir, BANKS_DIR, bankFolderName('coding-agent::repo'), 'documents', '000000.json'),
        'utf8',
      ),
    ) as { chunks: Array<{ chunk_text: string }> }
    expect(stored.chunks[0]?.chunk_text).toBe('one')

    // And a genuinely new snapshot is still written afterwards.
    const changed = writeSnapshot(
      dir,
      [snapshotInput('coding-agent::repo', 'two', '2026-11-02T00:00:00.000Z')],
      SCOPE,
    )
    expect(changed.changed).toBe(true)
    expect(changed.contentHash).toBe(nextSnapshot.contentHash)
  })
})
