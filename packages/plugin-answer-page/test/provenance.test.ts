import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const lockFile = join(packageDir, 'answer-page.lock.json')

interface FileRecord {
  path: string
  bytes: number
  sha256: string
}

interface LockFile {
  upstream: { repository: string; version: string; tag: string; commit: string }
  skill: { name: string }
  files: FileRecord[]
}

interface PluginModule {
  assertVendoredBytes: (record: FileRecord, content: Uint8Array) => void
}

const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as LockFile

/** Every file the vendored skill invokes or documents, flattened into the skill directory. */
const EXPECTED_FILES = [
  'assets/answer-me-with-html/LICENSE',
  'assets/answer-me-with-html/licenses/OFL-Bangers.txt',
  'assets/answer-me-with-html/references/settings.md',
  'assets/answer-me-with-html/references/video.md',
  'assets/answer-me-with-html/scripts/am.mjs',
  'assets/answer-me-with-html/SKILL.md',
]

async function loadPlugin(): Promise<PluginModule> {
  const file = join(packageDir, 'lib', 'index.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  return (await import(pathToFileURL(file).href)) as unknown as PluginModule
}

describe('answer-page provenance', () => {
  it('pins the upstream release at a 40-hex commit', () => {
    expect(lock.upstream.repository).toBe('https://github.com/QingYunA/answer-me-with-html')
    expect(lock.upstream.version).toBe('0.5.10')
    expect(lock.upstream.tag).toBe('v0.5.10')
    expect(lock.upstream.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(lock.skill.name).toBe('answer-me-with-html')
  })

  it('lists every vendored file exactly once, sorted by path', () => {
    const paths = lock.files.map((file) => file.path)
    expect(paths).toEqual(EXPECTED_FILES)
    expect(paths).toEqual([...paths].sort((left, right) => left.localeCompare(right)))
  })

  it('matches every vendored file against its recorded size and SHA-256', () => {
    for (const record of lock.files) {
      const content = readFileSync(join(packageDir, record.path))
      expect(content.length, record.path).toBe(record.bytes)
      expect(createHash('sha256').update(content).digest('hex'), record.path).toBe(record.sha256)
    }
  })

  it('rejects a corrupted byte offline', async () => {
    const plugin = await loadPlugin()
    const record = lock.files.find((file) => file.path.endsWith('/scripts/am.mjs'))
    expect(record).toBeDefined()
    if (record === undefined) return
    const original = readFileSync(join(packageDir, record.path))
    expect(() => plugin.assertVendoredBytes(record, original)).not.toThrow()
    const corrupted = Buffer.from(original)
    corrupted[0] = (corrupted[0] ?? 0) ^ 0xff
    expect(() => plugin.assertVendoredBytes(record, corrupted)).toThrow(/provenance record/u)
  })
})
