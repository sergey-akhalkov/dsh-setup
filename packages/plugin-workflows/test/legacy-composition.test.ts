import { describe, expect, it } from 'vitest'
import { type Definition, resolveOwnership } from '../src/host/definitions.ts'
import { evaluateTurnClose, runDeferredStep, selectBlockingStep } from '../src/host/gates.ts'
import { createRun, settleStep, type WorkflowRun } from '../src/host/runs.ts'
import { contributedIntake } from './intake-definition.ts'

const INSTALLED: ReadonlySet<string> = new Set(['delegation-rules', 'goal-continuity'])

function intakeDefinition(): Definition {
  return contributedIntake()
}

function intakeRun(): WorkflowRun {
  const definition = intakeDefinition()
  let run = createRun({
    definition: 'change-intake',
    trigger: 'tool.pre-execute',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth' },
    steps: definition.steps.map((step) => step.id),
    now: 1_000,
  })
  for (const [index, step] of definition.steps.entries()) {
    if (step.id === 'spec-review' || step.id === 'approval') continue
    run = settleStep(run, step.id, 'done', { at: 1_100 + index })
  }
  return run
}

describe('legacy composition', () => {
  it('keeps the shipped intake owned except for its deferred spec-review step', () => {
    const definition = intakeDefinition()
    const resolved = resolveOwnership(definition, INSTALLED)
    expect(resolved.issues).toEqual([])
    const byId = new Map(resolved.steps.map((step) => [step.id, step.ownership]))
    expect(byId.get('spec-review')).toBe('defer')
    expect(byId.get('requirements')).toBe('own')
    expect(byId.get('approval')).toBe('own')
    const run = intakeRun()
    expect(selectBlockingStep(run, definition, INSTALLED)).toBeUndefined()
  })

  it('never selects or steers the deferred step from the turn-close gate', () => {
    const definition = intakeDefinition()
    let run = intakeRun()
    run = settleStep(run, 'approval', 'done', { at: 2_000 })
    expect(selectBlockingStep(run, definition, INSTALLED)).toBeUndefined()
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: {
        steer: () => {
          throw new Error('the deferred step must never steer')
        },
      },
      evidenceContext: { workspace: '/workspace', values: { name: 'auth' } },
      turn: 1,
      maxBlocks: 3,
      installedLegacy: INSTALLED,
    })
    expect(outcome.kind).toBe('allow')
  })

  it('does not steer a later owned step while the deferred prerequisite is pending', () => {
    const definition = intakeDefinition()
    const run = intakeRun()
    expect(selectBlockingStep(run, definition, INSTALLED)).toBeUndefined()
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: {
        steer: () => {
          throw new Error('a workflow steer must wait for the legacy review')
        },
      },
      evidenceContext: { workspace: '/workspace', values: { name: 'auth' } },
      turn: 1,
      maxBlocks: 3,
      installedLegacy: INSTALLED,
    })
    expect(outcome.kind).toBe('allow')
    // Once the legacy record lands, the deferred step is done and approval is
    // the next owned step the engine may steer.
    const reviewed = settleStep(run, 'spec-review', 'done', { at: 2_000 })
    expect(selectBlockingStep(reviewed, definition, INSTALLED)?.id).toBe('approval')
  })

  it('stops at a deferred prerequisite even without a blockTurnClose flag', () => {
    const base = intakeDefinition()
    for (const flag of [undefined, false] as const) {
      const steps = base.steps.map((step) => {
        if (step.id !== 'spec-review') return step
        const clone = { ...step }
        if (flag === undefined) delete clone.blockTurnClose
        else clone.blockTurnClose = false
        return clone
      })
      const definition = { ...base, steps }
      expect(selectBlockingStep(intakeRun(), definition, INSTALLED)).toBeUndefined()
      const outcome = evaluateTurnClose({
        run: intakeRun(),
        definition,
        agent: {
          steer: () => {
            throw new Error('a workflow steer must wait for the legacy review')
          },
        },
        evidenceContext: { workspace: '/workspace', values: { name: 'auth' } },
        turn: 1,
        maxBlocks: 3,
        installedLegacy: INSTALLED,
      })
      expect(outcome.kind).toBe('allow')
      const reviewed = settleStep(intakeRun(), 'spec-review', 'done', { at: 2_000 })
      expect(selectBlockingStep(reviewed, definition, INSTALLED)?.id).toBe('approval')
    }
  })

  it('reads the legacy record, completes the deferred step, and dispatches nothing', async () => {
    const definition = intakeDefinition()
    const run = intakeRun()
    let reads = 0
    const result = await runDeferredStep({
      run,
      definition,
      stepId: 'spec-review',
      installedLegacy: INSTALLED,
      readRecord: async () => {
        reads += 1
        return {
          ok: true,
          evidence: {
            kind: 'record',
            path: '.dsh/delegation/spec-review/auth/spec.json',
            digest: 'a'.repeat(64),
          },
        }
      },
    })
    expect(reads).toBe(1)
    expect(result.dispatched).toBe(false)
    expect(result.steered).toBe(false)
    expect(result.run.steps.find((step) => step.id === 'spec-review')?.state).toBe('done')
  })

  it('leaves the run blocked with no steer when the legacy record is missing', async () => {
    const definition = intakeDefinition()
    const result = await runDeferredStep({
      run: intakeRun(),
      definition,
      stepId: 'spec-review',
      installedLegacy: INSTALLED,
      readRecord: async () => ({
        ok: false,
        failure: {
          reason: 'missing-file',
          path: '.dsh/delegation/spec-review/auth/spec.json',
          detail: 'the record does not exist',
        },
      }),
    })
    expect(result.dispatched).toBe(false)
    expect(result.steered).toBe(false)
    expect(result.run.status).toBe('blocked')
    expect(result.run.steps.find((step) => step.id === 'spec-review')?.state).toBe('blocked')
    expect(result.run.steps.find((step) => step.id === 'spec-review')?.reason).toContain(
      'waiting for the legacy gate',
    )
  })

  it('blocks a deferred definition whose legacy source is not installed', async () => {
    const definition = intakeDefinition()
    const result = await runDeferredStep({
      run: intakeRun(),
      definition,
      stepId: 'spec-review',
      installedLegacy: new Set(),
      readRecord: async () => {
        throw new Error('no record is read without its source')
      },
    })
    expect(result.run.status).toBe('blocked')
    expect(result.run.steps.find((step) => step.id === 'spec-review')?.reason).toContain(
      'retire-legacy-gates',
    )
  })

  it('refuses to run an owned step through the deferred path', async () => {
    const definition = intakeDefinition()
    await expect(
      runDeferredStep({
        run: intakeRun(),
        definition,
        stepId: 'spec',
        installedLegacy: INSTALLED,
        readRecord: async () => {
          throw new Error('not read')
        },
      }),
    ).rejects.toThrow(/not deferred/u)
  })
})
