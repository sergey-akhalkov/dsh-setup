import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { inject, skillDescription, toolDescriptions } from '../lib/index.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const assets = join(packageDir, 'assets', 'delegation-rules')
const docsPath = join(packageDir, '..', '..', 'docs', 'delegation-rules.md')

const read = (name: string): string => readFileSync(join(assets, name), 'utf8')

const BUDGET_TOKENS = 900
const SKILL_BODY_LIMIT = 24_000

function estimatedTokens(text: string): number {
  return Buffer.byteLength(text, 'utf8') / 4
}

describe('model-facing budget', () => {
  const toolBytes = Object.values(toolDescriptions).reduce(
    (total, description) => total + Buffer.byteLength(description, 'utf8'),
    0,
  )
  const catalogBytes = Buffer.byteLength(skillDescription, 'utf8')
  const skillBody = read('SKILL.md')
  const skillBodyBytes = Buffer.byteLength(skillBody, 'utf8')

  it('keeps the three tool descriptions and the skill catalog entry under 900 estimated tokens', () => {
    const total = toolBytes + catalogBytes
    expect(
      total,
      `descriptions are ${total} bytes (~${Math.round(total / 4)} estimated tokens)`,
    ).toBeLessThanOrEqual(BUDGET_TOKENS * 4)
  })

  it('keeps the on-demand skill body under 24,000 UTF-8 bytes', () => {
    expect(skillBodyBytes).toBeLessThanOrEqual(SKILL_BODY_LIMIT)
  })

  it('would fail on padded descriptions and a padded skill body', () => {
    const padded = toolDescriptions.delegate.repeat(6)
    expect(estimatedTokens(padded)).toBeGreaterThan(BUDGET_TOKENS)
    const paddedBody = `${skillBody}${'x'.repeat(SKILL_BODY_LIMIT)}`
    expect(Buffer.byteLength(paddedBody, 'utf8')).toBeGreaterThan(SKILL_BODY_LIMIT)
  })

  it('registers no always-on system-prompt section', () => {
    expect(inject).not.toContain('systemPrompt')
    expect(readFileSync(join(packageDir, 'lib', 'index.js'), 'utf8')).not.toContain('systemPrompt')
  })

  it('states the measured sizes and links existing repository documents', () => {
    const docs = readFileSync(docsPath, 'utf8')
    expect(docs).toContain('900 estimated tokens')
    expect(docs).toContain('24,000 UTF-8 bytes')
    expect(docs).toContain(`${toolBytes + catalogBytes}`)
    expect(docs).toContain(`${skillBodyBytes}`)
    expect(docs).toContain('docs/plugins.md')
    expect(existsSync(join(packageDir, '..', '..', 'docs', 'plugins.md'))).toBe(true)
    expect(existsSync(join(packageDir, '..', '..', 'openspec', 'specs'))).toBe(true)
  })

  it('documents the per-target model and effort example in the fragment and docs', () => {
    const fragment = readFileSync(join(packageDir, 'cordis.fragment.yml'), 'utf8')
    const docs = readFileSync(docsPath, 'utf8')
    for (const text of [fragment, docs]) {
      expect(text).toContain('codex-astra')
      expect(text).toContain('model: gpt-6-astra')
      expect(text).toContain('reasoningEffort: xhigh')
    }
  })

  it('documents the worker effort tiers and names both worker rules in the skill', () => {
    const skill = read('SKILL.md')
    const fragment = readFileSync(join(packageDir, 'cordis.fragment.yml'), 'utf8')
    const docs = readFileSync(docsPath, 'utf8')
    for (const text of [skill, docs]) {
      expect(text).toContain('`worker-fast`')
      expect(text).toContain('`worker-deep`')
    }
    expect(skill).toContain('mechanical inspection')
    expect(skill).toContain('root-cause')
    expect(skill).toContain('The main loop keeps its own effort')
    expect(skill).toContain('`minimal`/`low` map to `low`')
    expect(skill).toContain('`medium`/`high`/`xhigh` map to `high`')
    expect(skill).toContain('`max` is distinct')
    expect(fragment).toContain('worker-fast:')
    expect(fragment).toContain('worker-deep:')
    expect(docs).toContain('reasoningEffort: high')
    expect(docs).toContain('reasoningEffort: max')
  })

  it('documents the lane assignment trigger, ledger, tag, and deprecated boundary', () => {
    const skill = read('SKILL.md')
    const docs = readFileSync(docsPath, 'utf8')
    const fragment = readFileSync(join(packageDir, 'cordis.fragment.yml'), 'utf8')
    for (const text of [skill, docs]) {
      expect(text).toContain('lane-assignment')
      expect(text).toContain('lane-tag')
      expect(text).toContain('lane-boundary')
      expect(text).toContain('lane-fanout')
    }
    expect(skill).toContain('| `lane-fanout` | `lane-assignment` | note | strict |')
    expect(skill).toContain('`lane-boundary` (deprecated)')
    expect(skill).toContain('Per-lane serial escape')
    expect(skill).toContain('Host restart')
    expect(docs).toContain('lane-tag: <change>#<n>')
    expect(docs).toContain('lane-boundary` is deprecated')
    expect(fragment).toContain('when: lane-assignment')
    expect(fragment).not.toContain('when: lane-boundary')
  })
})

describe('bundled prompts', () => {
  it('carries the whole-spec P0/P1 rubric, evidence, and one JSON verdict', () => {
    const text = read('review-spec.md')
    expect(text).toContain('P0')
    expect(text).toContain('P1')
    expect(text).toContain('Evidence')
    expect(text).toMatch(/exactly one fenced ```json block/)
    expect(text).toContain('"digest"')
  })

  it('carries the task-scope rubric and the historical-snapshot boundary', () => {
    const text = read('review-task.md')
    expect(text).toContain('task')
    expect(text).toContain('P0')
    expect(text).toContain('P1')
    expect(text).toMatch(/exactly one fenced ```json block/)
  })

  it('carries the whole-worktree integration review rules', () => {
    const text = read('review-integration.md')
    expect(text).toContain('whole')
    expect(text).toContain('worktree')
    expect(text).toMatch(/exactly one fenced ```json block/)
  })

  it('shapes a blocker consultation with recommendation, evidence, and next action', () => {
    const text = read('consult.md')
    expect(text).toContain('Recommendation')
    expect(text).toContain('Evidence')
    expect(text).toContain('Next action')
    expect(text).toContain('read-only')
  })

  it('shapes research with a bounded answer, evidence, and sources', () => {
    const text = read('research.md')
    expect(text).toContain('Answer')
    expect(text).toContain('Evidence')
    expect(text).toContain('Sources')
    expect(text).toContain('read-only')
  })

  it('shapes an advisor second opinion with a recommendation, counterargument, risks, next action, and confidence', () => {
    const text = read('advisor.md')
    expect(text).toContain('Recommendation')
    expect(text).toContain('strongest counterargument')
    expect(text).toContain('Risks')
    expect(text).toContain('Next action')
    expect(text).toContain('Confidence')
    expect(text).toContain('read-only')
  })

  it('shapes the isolated fix with root cause, changed files, tests, and limits', () => {
    const text = read('fix.md')
    expect(text).toContain('worktree')
    expect(text).toContain('Root cause')
    expect(text).toContain('Changed files')
    expect(text).toContain('Tests')
    expect(text).toContain('Limits')
  })
})

describe('advisor policy', () => {
  it('names the advisor uses, exclusions, context guidance, and ceiling in the delegate description', () => {
    const description = toolDescriptions.delegate
    expect(description).toContain('advisor')
    expect(description).toContain('exact question')
    expect(description).toContain('constraints')
    expect(description).toContain('decisive evidence')
    expect(description).toContain('expensive-to-reverse')
    expect(description).toContain('security/data-integrity')
    expect(description).toContain('routine edits')
    expect(description).toContain('locally verifiable facts')
    expect(description).toContain('at most three times per session')
  })

  it('carries the advisor policy and default row in the skill', () => {
    const text = read('SKILL.md')
    expect(text).toContain('| `advisor` | `manual` | answer | none |')
    expect(text).toContain('## When to consult the advisor')
    expect(text).toContain('expensive to reverse')
    expect(text).toContain('security or data integrity')
    expect(text).toContain('routine edits')
    expect(text).toContain('at most three advisor calls per session')
    expect(text).toContain('never satisfies a review')
  })
})
