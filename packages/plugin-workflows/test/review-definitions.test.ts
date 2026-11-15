import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type ConditionContext,
  conditionNeedsWorktree,
  evaluateCondition,
} from '../src/host/condition.ts'
import {
  type Definition,
  loadShippedDefinitions,
  shippedDefinitionsDirectory,
  validateDefinition,
} from '../src/host/definitions.ts'
import {
  evaluateArchiveGate,
  evaluateTurnClose,
  isSoftSettled,
  runReplaceable,
  SOFT_SETTLEMENT,
} from '../src/host/gates.ts'
import { createRun, type WorkflowRun } from '../src/host/runs.ts'

/**
 * The engine-shipped review definitions: the native review executor contract,
 * the spec-review condition, and the integration soft release that reproduces
 * the legacy once-only refusal.
 */

const REVIEW_IDS = ['integration-review', 'spec-review', 'task-review'] as const

function shippedRaw(id: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(shippedDefinitionsDirectory(), `${id}.json`), 'utf8'),
  ) as Record<string, unknown>
}

function shipped(id: string): Definition {
  return validateDefinition(shippedRaw(id), `assets/definitions/${id}.json`)
}

function reviewStep(definition: Definition): Definition['steps'][number] {
  const found = definition.steps.filter((step) => step.executor === 'review')
  expect(found).toHaveLength(1)
  return found[0] as Definition['steps'][number]
}

function conditionContext(overrides: {
  involved?: boolean
  completed?: boolean
  specRecord?: { verdict: string; digest: string; current: boolean; pass: boolean }
}): ConditionContext {
  return {
    event: { kind: 'turn.stopping' },
    change: {
      name: 'auth',
      tasks: { checked: [], unchecked: [], items: [] },
      lanes: [],
    },
    records: {
      ...(overrides.specRecord === undefined ? {} : { spec: overrides.specRecord }),
      tasks: {},
    },
    digests: { spec: 'a'.repeat(64) },
    session: {
      involved: overrides.involved ?? true,
      changedSpec: false,
      completed: overrides.completed ?? false,
    },
  }
}

function integrationRun(): WorkflowRun {
  const definition = shipped('integration-review')
  return createRun({
    definition: definition.id,
    trigger: definition.trigger.kind,
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth' },
    steps: definition.steps.map((step) => step.id),
    now: 1_000,
  })
}

function close(
  run: WorkflowRun,
  definition: Definition,
  turn = 1,
): ReturnType<typeof evaluateTurnClose> & { readonly steers: string[] } {
  const steers: string[] = []
  const outcome = evaluateTurnClose({
    run,
    definition,
    agent: { steer: (text: string) => steers.push(text) },
    evidenceContext: { workspace: '/workspace', values: { name: 'auth' } },
    turn,
    maxBlocks: definition.settings.maxBlocks,
    installedLegacy: new Set(),
    enabledLegacy: new Set(),
  })
  return { ...outcome, steers }
}

describe('shipped review definitions', () => {
  it('loads every review definition through the definition validator', () => {
    const loaded = loadShippedDefinitions().map((definition) => definition.id)
    for (const id of REVIEW_IDS) {
      expect(loaded, id).toContain(id)
      expect(shipped(id).id, id).toBe(id)
    }
  })

  it('skips the git worktree digest for predicates that never read it', () => {
    expect(conditionNeedsWorktree({ '==': [{ var: 'digests.worktree' }, 'abc'] })).toBe(true)
    expect(conditionNeedsWorktree({ missing: ['digests.worktree'] })).toBe(true)
    expect(conditionNeedsWorktree({ '==': [{ var: 'session.involved' }, true] })).toBe(false)
    for (const id of REVIEW_IDS) {
      expect(conditionNeedsWorktree(shipped(id).trigger.condition), id).toBe(false)
    }
  })

  it('ships the whole-spec review on the review executor with a digest condition', () => {
    const definition = shipped('spec-review')
    const step = reviewStep(definition)
    expect(step.review).toEqual({
      target: 'codex',
      instruction: 'review-spec',
      scope: 'whole',
      phase: 'spec',
    })
    expect(step.evidence).toEqual({
      kind: 'record',
      rule: 'spec-review',
      change: '{name}',
      phase: 'spec',
      scope: 'whole',
      verdicts: ['PASS', 'ERROR'],
      digest: 'current',
      path: '.dsh/workflows/records/spec-review/{name}/spec.json',
    })
    expect(step.blockTurnClose).toBe(true)
    expect(definition.settings).toMatchObject({
      gate: 'review',
      gateIdentity: 'spec-review',
      gateOwnership: 'own',
      legacy: { plugin: 'delegation-rules', signal: 'spec-review' },
    })
    expect(definition.trigger).toMatchObject({ kind: 'turn.stopping', mode: 'active' })

    const condition = definition.trigger.condition
    if (condition === undefined) throw new Error('the spec-review condition is missing')
    const currentPass = { verdict: 'PASS', digest: 'a'.repeat(64), current: true, pass: true }
    expect(evaluateCondition(condition, conditionContext({ specRecord: currentPass }))).toBe(false)
    expect(evaluateCondition(condition, conditionContext({}))).toBe(true)
    expect(
      evaluateCondition(
        condition,
        conditionContext({ specRecord: { ...currentPass, current: false } }),
      ),
    ).toBe(true)
    expect(
      evaluateCondition(
        condition,
        conditionContext({ specRecord: { ...currentPass, verdict: 'FINDINGS', pass: false } }),
      ),
    ).toBe(true)
    expect(evaluateCondition(condition, conditionContext({ involved: false }))).toBe(false)
  })

  it('ships the task review on the frozen task snapshot with coverage evidence', () => {
    const definition = shipped('task-review')
    const step = reviewStep(definition)
    expect(step.review).toEqual({
      target: 'codex',
      instruction: 'review-task',
      scope: 'task',
    })
    expect(step.evidence).toEqual({
      kind: 'record',
      rule: 'task-review',
      change: '{name}',
      scope: 'task',
      task: '{taskId}',
      verdicts: ['PASS', 'ERROR'],
      path: '.dsh/workflows/records/task-review/{name}/tasks/{taskId}.json',
    })
    expect(step.blockTurnClose).toBe(true)
    expect(definition.steps.map((entry) => entry.id)).toEqual(['review', 'complete-review'])
    expect(definition.steps[1]?.evidence).toEqual({
      kind: 'check',
      source: 'task-review-coverage',
    })
    expect(definition.trigger).toMatchObject({
      kind: 'fs.change',
      dedupe: 'path+content-hash',
    })
    expect(definition.settings).toMatchObject({
      gate: 'review',
      gateIdentity: 'task-review',
      gateOwnership: 'own',
      legacy: { plugin: 'delegation-rules', signal: 'task-review' },
    })
    expect(definition.trigger.condition).toBeUndefined()
  })

  it('ships the integration review as the once-only soft rule', () => {
    const definition = shipped('integration-review')
    const step = reviewStep(definition)
    expect(step.review).toEqual({
      target: 'codex',
      instruction: 'review-integration',
      scope: 'whole',
      phase: 'integration',
    })
    expect(step.evidence).toEqual({
      kind: 'record',
      rule: 'integration-review',
      change: '{name}',
      phase: 'integration',
      scope: 'whole',
      verdicts: ['PASS', 'ERROR'],
      digest: 'current-worktree',
      path: '.dsh/workflows/records/integration-review/{name}/integration.json',
    })
    expect(step.blockTurnClose).toBe(true)
    expect(step.nonCritical).toBe(true)
    expect(definition.settings.maxBlocks).toBe(1)
    expect(definition.settings).toMatchObject({
      gate: 'review',
      gateIdentity: 'integration-review',
      gateOwnership: 'own',
      legacy: { plugin: 'delegation-rules', signal: 'integration-review' },
    })
    const condition = definition.trigger.condition
    if (condition === undefined) throw new Error('the integration-review condition is missing')
    expect(evaluateCondition(condition, conditionContext({ completed: true }))).toBe(true)
    expect(evaluateCondition(condition, conditionContext({ completed: false }))).toBe(false)
    expect(
      evaluateCondition(condition, conditionContext({ completed: true, involved: false })),
    ).toBe(false)
  })
})

describe('integration soft settlement', () => {
  it('refuses once, then closes the violation with completed-soft and never a pass', () => {
    const definition = shipped('integration-review')
    const first = close(integrationRun(), definition)
    expect(first.kind).toBe('refuse')
    expect(first.steers).toHaveLength(1)
    const afterFirst = first.run
    expect(afterFirst.status).toBe('running')
    expect(afterFirst.turnBlocks).toBe(1)
    expect(afterFirst.steps[0]?.state).toBe('open')

    const second = close(afterFirst, definition)
    expect(second.kind).toBe('violation')
    const settled = second.run
    expect(settled.status).toBe('completed')
    expect(settled.reason).toBe(SOFT_SETTLEMENT)
    const step = settled.steps[0]
    expect(step?.state).toBe('cancelled')
    expect(step?.reason).toContain(SOFT_SETTLEMENT)
    expect(step?.evidence).toBeUndefined()
    expect(
      settled.steps.every((entry) => entry.state !== 'open' && entry.state !== 'blocked'),
    ).toBe(true)
    expect(settled.violations).toHaveLength(1)
    expect(settled.violations[0]?.reason).toContain('VIOLATION')
    expect(settled.violations[0]?.reason).toContain(SOFT_SETTLEMENT)

    // The settlement is terminal: a late reviewer's snapshot (the original
    // running state with its open step and no violation) must never replace it.
    expect(isSoftSettled(settled)).toBe(true)
    const late = integrationRun()
    expect(late.status).toBe('running')
    expect(late.steps[0]?.state).toBe('open')
    expect(late.violations).toHaveLength(0)
    expect(runReplaceable(settled, late)).toBe(false)
    expect(runReplaceable(settled, settled)).toBe(true)

    // The exhausted soft run is closed without an approval and does not block
    // an otherwise authorized archive.
    const receipt = {
      v: 1 as const,
      kind: 'intake' as const,
      change: 'auth',
      digest: 'a'.repeat(64),
      issuedAt: 1,
      workspaceKey: '/workspace',
      signature: 'test',
    }
    const archive = evaluateArchiveGate({
      change: 'auth',
      runs: [settled],
      receipts: [receipt],
      specRecord: {
        ok: true,
        evidence: { kind: 'record', path: 'spec.json', digest: 'a'.repeat(64) },
      },
    })
    expect(archive.kind).toBe('allow')
  })

  it('refuses a local copy that drops the review step', () => {
    const raw = shippedRaw('task-review')
    const steps = (raw.steps as Array<Record<string, unknown>>).filter(
      (step) => step.executor !== 'review',
    )
    expect(() => validateDefinition({ ...raw, steps })).toThrow(/exactly one "review" step/u)
    // The local copy must declare the gate everywhere it ships; removing it is
    // a different refusal, so the shipped declaration stays visible above.
    expect(shipped('task-review').settings.gate).toBe('review')
  })
})
