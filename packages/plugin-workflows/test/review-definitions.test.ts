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
import { evaluateTurnClose, isSoftSettled, SOFT_SETTLEMENT } from '../src/host/gates.ts'
import { createRun, type WorkflowRun } from '../src/host/runs.ts'

/**
 * The engine-shipped review definitions: the native review executor contract,
 * the spec-review condition, and the required integration review with no
 * refusal budget and no soft settlement.
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

function integrationRun(definition: Definition = shipped('integration-review')): WorkflowRun {
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
  review?: { readonly uncovered: readonly string[]; readonly live: readonly string[] },
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
    ...(review === undefined ? {} : { review }),
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
      allowModelStart: true,
    })
    expect(definition.settings.legacy).toBeUndefined()
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
      allowModelStart: true,
    })
    expect(definition.settings.legacy).toBeUndefined()
    expect(definition.trigger.condition).toBeUndefined()
  })

  it('ships the integration review as a required review', () => {
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
    expect(step.nonCritical).toBeUndefined()
    // The shipped definition omits the budget; the gate never uses one for a
    // review run, and the omitted settings field still defaults to 3.
    const raw = shippedRaw('integration-review')
    expect((raw.settings as Record<string, unknown>).maxBlocks).toBeUndefined()
    expect(definition.settings.maxBlocks).toBe(3)
    expect(definition.settings).toMatchObject({
      gate: 'review',
      gateIdentity: 'integration-review',
      gateOwnership: 'own',
      allowModelStart: true,
    })
    expect(definition.settings.legacy).toBeUndefined()
    const condition = definition.trigger.condition
    if (condition === undefined) throw new Error('the integration-review condition is missing')
    expect(evaluateCondition(condition, conditionContext({ completed: true }))).toBe(true)
    expect(evaluateCondition(condition, conditionContext({ completed: false }))).toBe(false)
    expect(
      evaluateCondition(condition, conditionContext({ completed: true, involved: false })),
    ).toBe(false)
  })
})

describe('required integration review', () => {
  it('refuses every round without a PASS and never settles completed-soft', () => {
    const definition = shipped('integration-review')
    let run = integrationRun()
    for (const round of [1, 2, 3, 4]) {
      const outcome = close(run, definition, round)
      expect(outcome.kind, `round ${round}`).toBe('refuse')
      expect(outcome.steers, `round ${round}`).toHaveLength(1)
      expect(outcome.run, `round ${round}`).toBe(run)
      run = outcome.run
    }
    expect(run.status).toBe('running')
    expect(run.steps[0]?.state).toBe('open')
    expect(run.violations).toHaveLength(0)
    expect(isSoftSettled(run)).toBe(false)
    expect(run.reason).not.toBe(SOFT_SETTLEMENT)
  })

  it('allows the waiting close while the review is live and approves nothing', () => {
    const definition = shipped('integration-review')
    const run = integrationRun()
    const outcome = close(run, definition, 1, { uncovered: [], live: ['run-live'] })
    expect(outcome.kind).toBe('allow')
    expect(outcome.steers).toHaveLength(1)
    expect(outcome.steers[0]).toContain('run-live')
    expect(outcome.steers[0]).toContain('write nothing')
    expect(outcome.run.violations).toHaveLength(0)
    expect(run.status).toBe('running')
    expect(run.steps[0]?.state).toBe('open')
  })

  it('ignores a declared maxBlocks and a local nonCritical on a review step', () => {
    const raw = shippedRaw('integration-review')
    const settings = { ...(raw.settings as Record<string, unknown>), maxBlocks: 1 }
    const steps = (raw.steps as Array<Record<string, unknown>>).map((step) => ({
      ...step,
      nonCritical: true,
    }))
    const definition = validateDefinition({ ...raw, settings, steps })
    expect(definition.settings.maxBlocks).toBe(1)
    expect(definition.steps[0]?.nonCritical).toBe(true)
    let run = integrationRun(definition)
    for (const round of [1, 2, 3]) {
      const outcome = close(run, definition, round)
      expect(outcome.kind, `round ${round}`).toBe('refuse')
      expect(outcome.run.violations).toHaveLength(0)
      run = outcome.run
    }
    expect(run.status).toBe('running')
    expect(isSoftSettled(run)).toBe(false)
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
