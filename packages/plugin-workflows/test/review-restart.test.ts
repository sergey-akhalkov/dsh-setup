import { describe, expect, it } from 'vitest'
import type { Definition } from '../src/host/definitions.ts'
import {
  RESTART_SUPERSEDE_REASON,
  type RestartSupersedeDeps,
  supersedeInterruptedReviews,
} from '../src/host/review-restart.ts'
import { createRun, setRunStatus, type WorkflowRun } from '../src/host/runs.ts'

/**
 * The restart cleanup's ordering: candidates are captured first, the run lock is
 * taken second, and the run is revalidated inside it. A resume that commits
 * between the capture and the lock must survive; an unchanged interrupted run is
 * settled cancelled with the restart reason and no record.
 */

const TASK_ID = 'aaaaaaaaaaaaaaaa'

function definition(gate: string): Definition {
  return {
    id: 'task-review',
    name: 'Task review',
    version: 1,
    settings: { gate },
    steps: [
      { id: 'review', executor: 'review', review: { scope: 'task', phase: 'task' } },
      { id: 'complete-review', executor: 'gate' },
    ],
  } as unknown as Definition
}

function interrupted(): WorkflowRun {
  return setRunStatus(
    createRun({
      definition: 'task-review',
      trigger: 'turn.stopping',
      session: 'session-2',
      workspace: '/workspace',
      context: { name: 'auth', taskId: TASK_ID },
      steps: ['review', 'complete-review'],
      now: 1_000,
    }),
    'interrupted',
    2_000,
    'the Host restarted while this run was unfinished',
  )
}

interface Harness {
  readonly deps: RestartSupersedeDeps
  readonly writes: WorkflowRun[]
  current: WorkflowRun
}

function harness(run: WorkflowRun, gate = 'review', resume = false): Harness {
  const state: Harness = {
    current: run,
    writes: [],
    deps: {
      definitions: [definition(gate)],
      listRuns: async () => [state.current],
      readRun: async () => state.current,
      withRunLock: async (_runId, action) => {
        // The concurrent resume commits after candidate capture and before the
        // cleanup's lock body, which is exactly the ordering under test.
        if (resume) state.current = setRunStatus(state.current, 'running', 2_500)
        return action()
      },
      writeRun: async (settled) => {
        state.writes.push(settled)
      },
      now: () => 3_000,
    },
  }
  return state
}

const INPUT = {
  change: 'auth',
  scope: 'task' as const,
  phase: 'task',
  rule: 'task-review',
  taskIds: [TASK_ID],
  freshRunId: 'run-fresh',
}

describe('restart supersede', () => {
  it('keeps a run a resume claimed after the candidate capture', async () => {
    const run = interrupted()
    const state = harness(run, 'review', true)
    await supersedeInterruptedReviews(state.deps, INPUT)
    expect(state.writes).toEqual([])
    expect(state.current.status).toBe('running')
  })

  it('settles an unchanged interrupted run cancelled with the restart reason', async () => {
    const run = interrupted()
    const state = harness(run)
    await supersedeInterruptedReviews(state.deps, INPUT)
    expect(state.writes).toHaveLength(1)
    const settled = state.writes[0]
    expect(settled?.status).toBe('cancelled')
    expect(settled?.reason).toBe(RESTART_SUPERSEDE_REASON)
    expect(settled?.steps.find((step) => step.id === 'review')).toMatchObject({
      state: 'cancelled',
      reason: RESTART_SUPERSEDE_REASON,
    })
    // The settlement is pure: it carries no record evidence.
    expect(settled?.steps.find((step) => step.id === 'review')?.evidence).toBeUndefined()
  })

  it('preserves a gated workflow that only shares the review identity', async () => {
    const run = interrupted()
    const state = harness(run, 'intake')
    await supersedeInterruptedReviews(state.deps, INPUT)
    expect(state.writes).toEqual([])
    expect(state.current.status).toBe('interrupted')
  })
})
