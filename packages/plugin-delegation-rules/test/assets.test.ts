import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { inject, skillDescription, toolDescriptions } from '../src/index.js'
import { FINDING_CLASSES } from '../src/shared/approval.ts'

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

  it('states the documented budgets and links existing repository documents', async () => {
    const docs = readFileSync(docsPath, 'utf8')
    expect(docs).toContain('900 estimated tokens')
    expect(docs).toContain('24,000 UTF-8 bytes')
    expect(docs).toContain('docs/plugins.md')
    expect(existsSync(join(packageDir, '..', '..', 'docs', 'plugins.md'))).toBe(true)
    expect(existsSync(join(packageDir, '..', '..', 'openspec', 'specs'))).toBe(true)
  })

  it('ships exactly the review prompts and the skill asset', () => {
    expect(readdirSync(assets).sort()).toEqual([
      'SKILL.md',
      'review-integration.md',
      'review-spec.md',
      'review-task.md',
    ])
  })

  it('documents the single codex target and a non-Codex override', () => {
    const fragment = readFileSync(join(packageDir, 'cordis.fragment.yml'), 'utf8')
    const docs = readFileSync(docsPath, 'utf8')
    for (const text of [fragment, docs]) {
      expect(text).toContain('model: gpt-6-astra')
      expect(text).toContain('reasoningEffort: xhigh')
    }
    expect(fragment).toContain('codex:')
    expect(fragment).not.toContain('codex-astra')
    expect(fragment).not.toContain('codex-write')
    expect(fragment).not.toContain('worker-fast')
    expect(fragment).not.toContain('worker-deep')
    expect(docs).toContain('provider: spawn')
    expect(docs).not.toContain('contract: answer')
    expect(docs).not.toContain('contract: patch')
  })

  it('documents the lane triggers and names the checkpoint owner', () => {
    const skill = read('SKILL.md')
    const docs = readFileSync(docsPath, 'utf8')
    const fragment = readFileSync(join(packageDir, 'cordis.fragment.yml'), 'utf8')
    for (const text of [skill, docs]) {
      expect(text).toContain('lane-assignment')
      expect(text).toContain('lane-tag')
      expect(text).toContain('lane-boundary')
      expect(text).toContain('lane-fanout')
      expect(text).toContain('work-checkpoints')
      expect(text).toContain('work_checkpoint')
      expect(text).toContain('`implementation-work` and `lane-assignment` triggers')
    }
    expect(skill).toContain('`lane-boundary` (deprecated)')
    expect(skill).toContain('Per-lane serial escape')
    expect(skill).toContain('Host restart')
    expect(docs).toContain('lane-tag: <change>#<n>')
    expect(docs).toContain('lane-boundary` is deprecated')
    // The shipped default includes the strict lane-fanout rule; the progress
    // rule stays a profile option.
    expect(fragment).toContain('- id: lane-fanout')
    expect(fragment).toContain('when: lane-assignment')
    expect(fragment).not.toContain('when: implementation-work')
    expect(fragment).not.toContain('when: lane-boundary')
    // The task-completion requirement belongs to a profile that configures the
    // implementation-work rule, never to the shipped defaults.
    expect(skill).toContain('The shipped defaults configure no `implementation-work` rule')
    expect(skill).toContain('may pause mid-task through the goal-continuity')
    expect(skill).not.toContain('With the shipped defaults the gate refuses')
    expect(docs).toMatch(/when a profile configures/iu)
  })

  it('documents the lane-fanout fire conditions, tagged call, and worker-lane checkpoint binding', () => {
    const skill = read('SKILL.md')
    const docs = readFileSync(docsPath, 'utf8')
    for (const text of [skill, docs]) {
      expect(text).toContain('shared hot file')
      expect(text).toContain('generated output')
      expect(text).toContain('serial gate')
      expect(text).toContain('worker_start')
      expect(text).toContain('user_decision')
      expect(text).toContain('Worker-assigned checkpoint lanes')
      // A completed non-serial lane still counts toward the two-lane threshold.
      expect(text).toContain('completed lane still counts')
    }
    expect(skill).toContain('`lane-tag: <change>#<n>`')
    expect(docs).toContain('lane-tag: <change>#<n>')
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

  it('checks the plan lane shape and exempts a work-level single-lane reason', () => {
    const text = read('review-spec.md').replace(/\s+/gu, ' ')
    expect(text).toContain("Check the plan's work lanes before implementation")
    expect(text).toContain(
      'two or more level-2 task groups and no heading names owned paths, unless the plan states one work-level single-lane reason: a shared hot file, generated output, or a serial gate',
    )
    expect(text).toContain(
      'A stated single-lane reason that is the task-review or archive process instead of a work constraint is also a P1 finding',
    )
    expect(text).toContain('The evidence names the headings or the reason')
    expect(text).toContain('the fix asks for the owned paths or for one work-level reason')
  })

  it('starts the task review immediately and conditions overlap on a frozen snapshot', () => {
    const agentsPath = join(packageDir, '..', '..', 'AGENTS.md')
    const skill = read('SKILL.md').replace(/\s+/gu, ' ')
    const docs = readFileSync(docsPath, 'utf8').replace(/\s+/gu, ' ')
    const agents = readFileSync(agentsPath, 'utf8').replace(/\s+/gu, ' ')
    expect(skill).toContain('immediately after the tick')
    expect(docs).toContain('immediately after the tick')
    expect(agents).toContain('start its task-scoped review immediately')
    for (const text of [skill, docs, agents]) {
      expect(text).toContain(
        'Keep implementing an independent task while the run uses a frozen snapshot',
      )
      expect(text).toContain(
        'When the run reports the live worktree, a write can discard its verdict: restore snapshot support and re-run, or defer writes until the run settles',
      )
      expect(text).toContain('No blocking sleep')
      expect(text).not.toContain('before starting the next task')
    }
  })

  it('carries the task-scope rubric and the historical-snapshot boundary', () => {
    const text = read('review-task.md')
    expect(text).toContain('task')
    expect(text).toContain('P0')
    expect(text).toContain('P1')
    expect(text).toMatch(/exactly one fenced ```json block/)
  })

  it('documents section-scoped review in the prompt, the skill, and the docs', () => {
    const prompt = read('review-task.md').replace(/\s+/gu, ' ')
    const skill = read('SKILL.md').replace(/\s+/gu, ' ')
    const docs = readFileSync(docsPath, 'utf8').replace(/\s+/gu, ' ')
    expect(prompt).toContain('every checked task in scope')
    expect(prompt).toContain('unchecked tasks that are out of scope')
    expect(prompt).toContain('name its number')
    expect(prompt).toContain('never review an unchecked task')
    for (const text of [skill, docs]) {
      expect(text).toContain('section: "1"')
      expect(text).toContain('1.x')
      expect(text).toContain('unchecked tasks')
      expect(text).toContain('per-task')
      expect(text).toContain('newly checked task')
      expect(text).toContain('mutually exclusive')
    }
    expect(skill).toContain('Every section finding names the affected task')
    expect(toolDescriptions.delegate).toContain('section')
    expect(toolDescriptions.delegate).toContain('1.x')
  })

  it('carries the whole-worktree integration review rules', () => {
    const text = read('review-integration.md')
    expect(text).toContain('whole')
    expect(text).toContain('worktree')
    expect(text).toMatch(/exactly one fenced ```json block/)
  })

  it('documents the review queue and the asynchronous run handle in the skill', () => {
    const text = read('SKILL.md').replace(/\s+/gu, ' ')
    expect(text).toContain('## Review queue')
    expect(text).toContain('returns a run id and record path before the target finishes')
    expect(text).toContain('queued or running')
    expect(text).toContain('review queue full')
    expect(text).toContain('delegation_status')
  })

  it('requests the finding class vocabulary in all three review instructions', () => {
    for (const name of ['review-spec.md', 'review-task.md', 'review-integration.md']) {
      const text = read(name)
      expect(text).toContain('"class"')
      for (const findingClass of FINDING_CLASSES) expect(text).toContain(findingClass)
    }
  })
})
