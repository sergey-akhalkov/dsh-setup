import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  assertAssetBytes,
  PONYTAIL_ASSETS_DIRECTORY,
  PONYTAIL_LICENSE_FILE,
  PONYTAIL_LOCK_FILE,
  PONYTAIL_REPOSITORY,
  PONYTAIL_RULES_FILE,
  PONYTAIL_SKILL_FILE,
  type PonytailLock,
  parseSkillFrontmatter,
} from '../lib/ponytail.ts'

const packageDir = fileURLToPath(new URL('../../packages/plugin-ponytail/', import.meta.url))
const assetsDir = join(packageDir, PONYTAIL_ASSETS_DIRECTORY)
const temporaryRoots: string[] = []

function assetPath(name: string): string {
  return join(assetsDir, name)
}

function readLock(): PonytailLock {
  const parsed: unknown = JSON.parse(readFileSync(join(packageDir, PONYTAIL_LOCK_FILE), 'utf8'))
  expect(parsed).toMatchObject({
    upstream: {
      repository: expect.any(String),
      version: expect.any(String),
      tag: expect.any(String),
      commit: expect.any(String),
    },
    skill: { name: 'ponytail', description: expect.any(String) },
    files: expect.any(Array),
  })
  return parsed as PonytailLock
}

function temporaryCopy(): string {
  const directory = mkdtempSync(join(tmpdir(), 'ponytail-lock-'))
  temporaryRoots.push(directory)
  for (const name of [PONYTAIL_SKILL_FILE, PONYTAIL_RULES_FILE, PONYTAIL_LICENSE_FILE]) {
    copyFileSync(assetPath(name), join(directory, name))
  }
  return directory
}

afterAll(() => {
  for (const directory of temporaryRoots) rmSync(directory, { recursive: true, force: true })
})

describe('vendored ponytail provenance', () => {
  it('pins an immutable upstream identity', () => {
    const lock = readLock()
    expect(lock.upstream.repository).toBe(PONYTAIL_REPOSITORY)
    expect(lock.upstream.tag).toBe(`v${lock.upstream.version}`)
    expect(lock.upstream.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(lock.upstream.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)
  })

  it('records exactly the skill prompt, rules file, and license', () => {
    const lock = readLock()
    expect(lock.files.map((file) => file.path)).toEqual([
      `${PONYTAIL_ASSETS_DIRECTORY}/${PONYTAIL_RULES_FILE}`,
      `${PONYTAIL_ASSETS_DIRECTORY}/${PONYTAIL_LICENSE_FILE}`,
      `${PONYTAIL_ASSETS_DIRECTORY}/${PONYTAIL_SKILL_FILE}`,
    ])
  })

  it('matches every vendored byte to its recorded size and SHA-256', () => {
    const lock = readLock()
    for (const record of lock.files) {
      const name = record.path.slice(record.path.lastIndexOf('/') + 1)
      const content = readFileSync(assetPath(name))
      expect(content.byteLength).toBe(record.bytes)
      expect(() => assertAssetBytes(record, content)).not.toThrow()
    }
  })

  it('keeps the vendored prompts and license intact', () => {
    const lock = readLock()
    expect(lock.skill.name).toBe('ponytail')
    expect(lock.skill.description.trim()).not.toBe('')

    const skill = readFileSync(assetPath(PONYTAIL_SKILL_FILE), 'utf8')
    expect(parseSkillFrontmatter(skill).name).toBe('ponytail')

    const rules = readFileSync(assetPath(PONYTAIL_RULES_FILE), 'utf8')
    expect(rules.startsWith('# Ponytail')).toBe(true)

    const license = readFileSync(assetPath(PONYTAIL_LICENSE_FILE), 'utf8')
    expect(license).toContain('MIT License')
    expect(license).toMatch(/Copyright \(c\) \d{4} DietrichGebert/)

    for (const name of [PONYTAIL_SKILL_FILE, PONYTAIL_RULES_FILE, PONYTAIL_LICENSE_FILE]) {
      const bytes = readFileSync(assetPath(name))
      expect(bytes.includes(13)).toBe(false)
    }
  })

  it('rejects a fixture copy with one changed byte', () => {
    const directory = temporaryCopy()
    const copiedSkill = join(directory, PONYTAIL_SKILL_FILE)
    const original = readFileSync(copiedSkill, 'utf8')
    writeFileSync(copiedSkill, `${original} `, 'utf8')
    const record = readLock().files.find((file) => file.path.endsWith(`/${PONYTAIL_SKILL_FILE}`))
    expect(record).toBeDefined()
    if (record === undefined) return
    expect(() => assertAssetBytes(record, readFileSync(copiedSkill))).toThrow(
      /does not match its provenance record/,
    )
  })
})
