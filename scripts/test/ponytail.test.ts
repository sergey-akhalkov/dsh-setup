import { describe, expect, it } from 'vitest'
import {
  assertAssetBytes,
  assertLicenseText,
  assertRulesText,
  assertSkillText,
  assertUpstream,
  buildPonytailLock,
  normalizeDescription,
  PONYTAIL_MAX_RULES_BYTES,
  PONYTAIL_MAX_SKILL_BYTES,
  type PonytailAsset,
  parseSkillFrontmatter,
  serializePonytailLock,
  sha256Hex,
} from '../lib/ponytail.ts'

const VALID_SKILL = `---
name: ponytail
description: >
  Lazy senior dev mode: the smallest change that fully solves the task, and a
  reply a busy human understands in one read. Levels: lite, full (default), ultra.
argument-hint: "[lite|full|ultra|off]"
license: MIT
---

# Ponytail

You are a lazy senior developer. The best code is the code never written.
`

const VALID_RULES = `# Ponytail, lazy senior dev mode

You are a lazy senior developer. The best code is the code never written.
`

const VALID_LICENSE = `MIT License

Copyright (c) 2026 DietrichGebert

Permission is hereby granted, free of charge, to any person obtaining a copy.
`

const VALID_UPSTREAM = {
  repository: 'https://github.com/DietrichGebert/ponytail',
  version: '5.3.2',
  tag: 'v5.3.2',
  commit: '16352ac229eb08a9598dcae48fe9f2b342567d86',
}

const SKILL_ASSET: PonytailAsset = { path: 'assets/ponytail/SKILL.md', content: VALID_SKILL }
const RULES_ASSET: PonytailAsset = { path: 'assets/ponytail/AGENTS.md', content: VALID_RULES }
const LICENSE_ASSET: PonytailAsset = { path: 'assets/ponytail/LICENSE', content: VALID_LICENSE }

describe('skill frontmatter', () => {
  it('parses the fields the plugin needs and folds the description to one line', () => {
    const parsed = parseSkillFrontmatter(VALID_SKILL)
    expect(parsed.name).toBe('ponytail')
    expect(parsed.argumentHint).toBe('[lite|full|ultra|off]')
    expect(parsed.description).toMatch(/^Lazy senior dev mode: /)
    expect(parsed.description).toContain('Levels: lite, full (default), ultra.')
    expect(parsed.description).not.toContain('\n')
  })

  it('rejects a body without YAML frontmatter', () => {
    expect(() => parseSkillFrontmatter('# Ponytail\n\nbody\n')).toThrow(/missing YAML frontmatter/)
  })

  it('rejects an invalid skill name', () => {
    const body = VALID_SKILL.replace('name: ponytail', 'name: Ponytail')
    expect(() => parseSkillFrontmatter(body)).toThrow(/frontmatter name must match/)
  })

  it('rejects an empty description', () => {
    const body = VALID_SKILL.replace(
      /description: >[\s\S]*?argument-hint:/u,
      'description: "   "\nargument-hint:',
    )
    expect(() => parseSkillFrontmatter(body)).toThrow(/description must not be empty/)
  })

  it('rejects CRLF content', () => {
    expect(() => parseSkillFrontmatter(VALID_SKILL.replaceAll('\n', '\r\n'))).toThrow(
      /must use LF line endings/,
    )
  })

  it('rejects a body above the size ceiling', () => {
    const toolarge = `${VALID_SKILL}${'x'.repeat(PONYTAIL_MAX_SKILL_BYTES)}`
    expect(() => assertSkillText(toolarge)).toThrow(/above the .* ceiling/)
  })

  it('normalizes whitespace and rejects non-string descriptions', () => {
    expect(normalizeDescription('  one\n\ttwo   three  ', 'test')).toBe('one two three')
    expect(() => normalizeDescription(undefined, 'test')).toThrow(/must be a string/)
  })
})

describe('rules file', () => {
  it('accepts a file that starts with the expected heading', () => {
    expect(() => assertRulesText(VALID_RULES)).not.toThrow()
  })

  it('rejects a missing heading', () => {
    expect(() => assertRulesText('Lazy senior dev mode\n')).toThrow(/must start with "# Ponytail"/)
  })

  it('rejects empty content', () => {
    expect(() => assertRulesText('   \n')).toThrow(/must not be empty/)
  })

  it('rejects CRLF content', () => {
    expect(() => assertRulesText(VALID_RULES.replaceAll('\n', '\r\n'))).toThrow(
      /must use LF line endings/,
    )
  })

  it('rejects content above the size ceiling', () => {
    const toolarge = `${VALID_RULES}${'x'.repeat(PONYTAIL_MAX_RULES_BYTES)}`
    expect(() => assertRulesText(toolarge)).toThrow(/above the .* ceiling/)
  })
})

describe('license file', () => {
  it('accepts the upstream MIT license shape', () => {
    expect(() => assertLicenseText(VALID_LICENSE)).not.toThrow()
  })

  it('rejects a file without the MIT marker', () => {
    expect(() => assertLicenseText('Copyright (c) 2026 DietrichGebert\n')).toThrow(
      /must contain "MIT License"/,
    )
  })

  it('rejects a file without the upstream copyright line', () => {
    expect(() => assertLicenseText('MIT License\n\nSomeone else.\n')).toThrow(
      /upstream copyright line/,
    )
  })
})

describe('upstream identity', () => {
  it('accepts a pinned tag, version, repository, and commit', () => {
    expect(() => assertUpstream(VALID_UPSTREAM)).not.toThrow()
  })

  it('rejects a non-commit value', () => {
    expect(() => assertUpstream({ ...VALID_UPSTREAM, commit: 'main' })).toThrow(
      /40-hex-digit commit/,
    )
  })

  it('rejects a tag that does not match the version', () => {
    expect(() => assertUpstream({ ...VALID_UPSTREAM, tag: 'latest' })).toThrow(
      /upstream tag must be v5.3.2/,
    )
  })

  it('rejects a non-GitHub repository', () => {
    expect(() =>
      assertUpstream({ ...VALID_UPSTREAM, repository: 'https://example.com/x' }),
    ).toThrow(/upstream repository must look like/)
  })

  it('rejects a malformed version', () => {
    expect(() => assertUpstream({ ...VALID_UPSTREAM, version: '5.3' })).toThrow(
      /upstream version must be x.y.z/,
    )
  })
})

describe('provenance lock', () => {
  const skill = parseSkillFrontmatter(VALID_SKILL)

  it('is deterministic across repeated builds and sorts files by path', () => {
    const first = buildPonytailLock(VALID_UPSTREAM, skill, [
      SKILL_ASSET,
      LICENSE_ASSET,
      RULES_ASSET,
    ])
    const second = buildPonytailLock(VALID_UPSTREAM, skill, [
      RULES_ASSET,
      SKILL_ASSET,
      LICENSE_ASSET,
    ])
    expect(serializePonytailLock(first)).toBe(serializePonytailLock(second))
    expect(first.files.map((file) => file.path)).toEqual([
      'assets/ponytail/AGENTS.md',
      'assets/ponytail/LICENSE',
      'assets/ponytail/SKILL.md',
    ])
    expect(first.files[0]?.bytes).toBe(Buffer.byteLength(VALID_RULES))
    expect(first.files[0]?.sha256).toBe(sha256Hex(VALID_RULES))
  })

  it('rejects a duplicated vendored path', () => {
    expect(() => buildPonytailLock(VALID_UPSTREAM, skill, [SKILL_ASSET, SKILL_ASSET])).toThrow(
      /is listed twice/,
    )
  })

  it('rejects an empty vendored path', () => {
    expect(() => buildPonytailLock(VALID_UPSTREAM, skill, [{ path: ' ', content: 'x' }])).toThrow(
      /path must not be empty/,
    )
  })

  it('validates a vendored body against its record', () => {
    const lock = buildPonytailLock(VALID_UPSTREAM, skill, [SKILL_ASSET])
    const record = lock.files[0]
    expect(record).toBeDefined()
    if (record === undefined) return
    expect(() => assertAssetBytes(record, VALID_SKILL)).not.toThrow()
    expect(() => assertAssetBytes(record, `${VALID_SKILL} `)).toThrow(
      /does not match its provenance record/,
    )
  })
})
