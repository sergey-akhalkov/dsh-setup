import { describe, expect, it } from 'vitest'
import {
  checkpointCall,
  countCalls,
  createHarness,
  directMessage,
  driverDisarm,
  driverPauseCancelledRound,
  goalMessage,
  type Harness,
  noticeText,
  setGoal,
  toolCall,
  turnEnd,
  turnStart,
} from './harness.js'

const COMPLETED = { kind: 'completed' }
const USER_ABORT = { kind: 'aborted', reason: { kind: 'user' } }
const MAX_TOKENS = { kind: 'max-tokens' }
const RESET = {
  kind: 'aborted',
  reason: { kind: 'hook', reason: 'loop-guard:reset: repeated line' },
}

/** A `continue` plan whose bottleneck is whoever the test names. */
function continuePlan(
  action: string,
  id = 'the-work',
  next = 'do the next step',
): Record<string, unknown> {
  return {
    outcome: 'continue',
    lanes: [{ id: 'work', owner: 'lead', scope: ['src/a.ts'], state: 'running' }],
    bottleneck: { id, owner: 'lead', action, blockingLanes: ['work'] },
    next,
  }
}

/** One settled goal round: the driver admits it, the model works, the turn ends. */
function goalRound(harness: Harness, turn: number, reason: Record<string, unknown>): void {
  const goal = harness.goals.goal
  if (goal === undefined) throw new Error('test goal missing')
  turnStart(harness, turn)
  goalMessage(harness, goal, turn)
  turnEnd(harness, reason, turn)
}

function notices(harness: Harness): string {
  return harness.injected.map((message) => noticeText(message)).join('\n')
}

describe('checkpoint-evidenced continuation', () => {
  it('stops an armed goal when the plan declares the objective done', async () => {
    const harness = createHarness()
    setGoal(harness)
    turnStart(harness, 1)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 1)
    checkpointCall(harness, { outcome: 'done', next: 'nothing left' })
    turnEnd(harness, COMPLETED, 1)
    // The decision is synchronous; the notice waits for the dispatch to settle,
    // because an inject inside the turn/end handler is dropped by the host.
    expect(countCalls(harness, 'disarm')).toBe(1)
    expect(harness.injected).toHaveLength(0)
    harness.emitStatus('idle')
    await harness.flush()

    expect(notices(harness)).toContain('declares the objective done')
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.phase).toBe('active')
    expect(harness.goals.goal?.activation).toBe('disarmed')
  })

  it('withholds a disarmed resume when the plan names a user decision', async () => {
    const harness = createHarness()
    setGoal(harness, { activation: 'disarmed' })
    turnStart(harness, 1)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 1)
    checkpointCall(harness, continuePlan('user_decision', 'first-night', 'check the log at 07:00'))
    turnEnd(harness, COMPLETED, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'resume')).toBe(0)
    expect(notices(harness)).toContain('first-night')
    expect(notices(harness)).toContain('check the log at 07:00')
  })

  it('keeps an earlier stop as the only cause and notice on a reset round', async () => {
    const done = createHarness()
    setGoal(done)
    turnStart(done, 1)
    const doneGoal = done.goals.goal
    if (doneGoal === undefined) throw new Error('test goal missing')
    goalMessage(done, doneGoal, 1)
    checkpointCall(done, { outcome: 'done', next: 'nothing left' })
    turnEnd(done, RESET, 1)
    done.emitStatus('idle')
    await done.flush()
    expect(done.injected).toHaveLength(1)
    expect(notices(done)).toContain('declares the objective done')
    expect(notices(done)).not.toContain('loop guard')
    expect(done.goals.goal?.phase).toBe('active')

    const decision = createHarness()
    setGoal(decision)
    turnStart(decision, 1)
    const decisionGoal = decision.goals.goal
    if (decisionGoal === undefined) throw new Error('test goal missing')
    goalMessage(decision, decisionGoal, 1)
    checkpointCall(decision, continuePlan('user_decision', 'first-night', 'check the log at 07:00'))
    turnEnd(decision, RESET, 1)
    decision.emitStatus('idle')
    await decision.flush()
    expect(decision.injected).toHaveLength(1)
    expect(notices(decision)).toContain('first-night')
    expect(notices(decision)).not.toContain('loop guard')
    expect(decision.goals.goal?.phase).toBe('active')
  })

  it('resumes a disarmed goal with the plan next action in the notice', async () => {
    const harness = createHarness()
    setGoal(harness, { activation: 'disarmed' })
    turnStart(harness, 1)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 1)
    checkpointCall(harness, continuePlan('worker_start', 'impl', 'add the resolver test'))
    turnEnd(harness, COMPLETED, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'resume')).toBe(1)
    expect(notices(harness)).toContain('add the resolver test')
    expect(notices(harness)).not.toContain('continue the current objective')
  })

  it('treats a plan older than the settled turn as no evidence', async () => {
    const harness = createHarness()
    setGoal(harness, { activation: 'disarmed' })
    turnStart(harness, 1)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 1)
    checkpointCall(harness, { outcome: 'done', next: 'nothing left' }, { turn: 1 })
    turnStart(harness, 3)
    goalMessage(harness, goal, 3)
    turnEnd(harness, COMPLETED, 3)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'resume')).toBe(1)
    expect(notices(harness)).not.toContain('declares the objective done')
  })

  it('treats a plan the last direct message predates as no evidence', async () => {
    const harness = createHarness()
    setGoal(harness, { activation: 'disarmed' })
    turnStart(harness, 1)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 1)
    checkpointCall(harness, { outcome: 'done', next: 'nothing left' })
    directMessage(harness)
    turnEnd(harness, COMPLETED, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'resume')).toBe(1)
    expect(notices(harness)).not.toContain('declares the objective done')
  })

  it('treats a plan an answered question predates as no evidence', async () => {
    const harness = createHarness()
    setGoal(harness, { activation: 'disarmed' })
    turnStart(harness, 1)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 1)
    checkpointCall(harness, continuePlan('user_decision', 'pick-a', 'wait for the answer'))
    toolCall(harness, 'ask_user_question', { questions: [{ id: 'pick-a', question: 'Which?' }] })
    turnEnd(harness, COMPLETED, 1)
    harness.emitStatus('idle')
    await harness.flush()

    // The answer arrives as a tool result, so the stop must not replay for it.
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(notices(harness)).not.toContain('pick-a')
  })

  it('treats an unreadable or refused checkpoint as no evidence', async () => {
    const unreadable = createHarness()
    setGoal(unreadable, { activation: 'disarmed' })
    turnStart(unreadable, 1)
    const first = unreadable.goals.goal
    if (first === undefined) throw new Error('test goal missing')
    goalMessage(unreadable, first, 1)
    checkpointCall(unreadable, 'not json')
    turnEnd(unreadable, COMPLETED, 1)
    unreadable.emitStatus('idle')
    await unreadable.flush()
    expect(countCalls(unreadable, 'resume')).toBe(1)

    const refused = createHarness()
    setGoal(refused, { activation: 'disarmed' })
    turnStart(refused, 1)
    const second = refused.goals.goal
    if (second === undefined) throw new Error('test goal missing')
    goalMessage(refused, second, 1)
    checkpointCall(refused, { outcome: 'done', next: 'nothing left' }, { isError: true })
    turnEnd(refused, COMPLETED, 1)
    refused.emitStatus('idle')
    await refused.flush()
    expect(countCalls(refused, 'resume')).toBe(1)
  })

  it('keeps a terminal end reason as the single stop and record', async () => {
    const harness = createHarness()
    setGoal(harness)
    turnStart(harness, 1)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 1)
    checkpointCall(harness, { outcome: 'done', next: 'nothing left' })
    turnEnd(harness, MAX_TOKENS, 1)
    harness.emitStatus('idle')
    await harness.flush()

    // The token limit owns the outcome: one stop, one notice, and its own record.
    expect(notices(harness)).not.toContain('declares the objective done')
    expect(harness.injected).toHaveLength(1)
    expect(notices(harness)).toContain('token limit')
    expect(harness.goals.goal?.phase).toBe('blocked')
  })

  it('keeps the evidence and the recovery action in a bounded notice', async () => {
    const harness = createHarness()
    setGoal(harness, { activation: 'disarmed' })
    turnStart(harness, 1)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 1)
    checkpointCall(harness, continuePlan('user_decision', 'b'.repeat(120), 'n'.repeat(400)))
    turnEnd(harness, COMPLETED, 1)
    harness.emitStatus('idle')
    await harness.flush()

    const text = notices(harness)
    expect(text).toContain('user decision')
    expect(text).toContain('/goal resume')
    expect(text.length).toBeLessThanOrEqual(600)
  })
})

describe('no-effect round stop', () => {
  it('stops after two consecutive goal rounds without effect', async () => {
    const harness = createHarness()
    setGoal(harness)
    goalRound(harness, 1, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()
    expect(countCalls(harness, 'disarm')).toBe(0)

    goalRound(harness, 2, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()
    expect(countCalls(harness, 'disarm')).toBe(1)
    expect(notices(harness)).toContain('two consecutive goal rounds')
  })

  it('counts an aborted round and resets on an effective one', async () => {
    const harness = createHarness()
    setGoal(harness)
    goalRound(harness, 1, COMPLETED)
    await harness.flush()

    // A reset-aborted round that writes is effective: the count goes back to zero.
    turnStart(harness, 2)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goalMessage(harness, goal, 2)
    toolCall(harness, 'edit', { file_path: 'src/a.ts' })
    turnEnd(harness, RESET, 2)
    harness.emitStatus('idle')
    await harness.flush()

    goalRound(harness, 3, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()
    expect(notices(harness)).not.toContain('two consecutive goal rounds')
  })

  it('counts a reset-aborted round that did nothing', async () => {
    const harness = createHarness()
    setGoal(harness)
    goalRound(harness, 1, COMPLETED)
    await harness.flush()
    goalRound(harness, 2, RESET)
    harness.emitStatus('idle')
    await harness.flush()

    expect(notices(harness)).toContain('two consecutive goal rounds')
  })

  it('admits no third round after the no-effect stop', async () => {
    const harness = createHarness()
    setGoal(harness)
    goalRound(harness, 1, COMPLETED)
    await harness.flush()
    goalRound(harness, 2, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()

    // The driver only admits a round for an armed goal, so the disarm is the stop.
    expect(harness.goals.goal?.activation).toBe('disarmed')
    expect(harness.goals.goal?.phase).toBe('active')

    // A round the driver managed to admit anyway resumes nothing afterwards.
    goalRound(harness, 3, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.phase).toBe('active')
  })

  it('stops after two consecutive reset-aborted no-effect rounds', async () => {
    const harness = createHarness()
    setGoal(harness)
    goalRound(harness, 1, RESET)
    harness.emitStatus('idle')
    await harness.flush()
    goalRound(harness, 2, RESET)
    harness.emitStatus('idle')
    await harness.flush()

    expect(notices(harness)).toContain('two consecutive goal rounds')
    expect(harness.goals.goal?.phase).toBe('active')
  })
})

describe('user abort precedence', () => {
  it('keeps the driver pause for a user-aborted no-effect goal round', async () => {
    const harness = createHarness()
    setGoal(harness)
    goalRound(harness, 1, COMPLETED)
    await harness.flush()
    goalRound(harness, 2, USER_ABORT)
    driverPauseCancelledRound(harness)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'disarm')).toBe(0)
    expect(harness.goals.goal?.phase).toBe('paused')
    expect(notices(harness)).not.toContain('two consecutive goal rounds')
  })

  it('disarms an armed goal after a non-goal Stop under the strict policy', async () => {
    const harness = createHarness()
    setGoal(harness)
    turnStart(harness, 1)
    turnEnd(harness, USER_ABORT, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'disarm')).toBe(1)
    expect(harness.goals.goal?.activation).toBe('disarmed')
    expect(notices(harness)).toContain('suppressed automatic continuation')
  })

  it('still resumes after a non-goal Stop under the opt-in policy', async () => {
    const harness = createHarness({ config: { resumeAfterUserStop: 'non-goal' } })
    setGoal(harness)
    turnStart(harness, 1)
    driverDisarm(harness)
    turnEnd(harness, USER_ABORT, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'resume')).toBe(1)
  })

  it('lets the strict policy Stop own the notice even with a stopping plan', async () => {
    const harness = createHarness()
    setGoal(harness)
    turnStart(harness, 1)
    checkpointCall(harness, { outcome: 'done', next: 'nothing left' })
    turnEnd(harness, USER_ABORT, 1)
    harness.emitStatus('idle')
    await harness.flush()

    // The policy owns this stop, so no second evidence notice is delivered.
    expect(harness.injected).toHaveLength(1)
    expect(notices(harness)).toContain('suppressed automatic continuation')
    expect(notices(harness)).not.toContain('declares the objective done')
    expect(countCalls(harness, 'disarm')).toBe(1)
    expect(harness.goals.goal?.phase).toBe('active')
  })

  it('stops an opt-in policy Stop when the plan stops continuation', async () => {
    const harness = createHarness({ config: { resumeAfterUserStop: 'non-goal' } })
    setGoal(harness)
    turnStart(harness, 1)
    driverDisarm(harness)
    checkpointCall(harness, { outcome: 'done', next: 'nothing left' })
    turnEnd(harness, USER_ABORT, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'resume')).toBe(0)
    expect(notices(harness)).toContain('declares the objective done')
    expect(harness.goals.goal?.phase).toBe('active')
  })

  it('disarms an armed opt-in goal when the plan stops continuation', async () => {
    const harness = createHarness({ config: { resumeAfterUserStop: 'non-goal' } })
    setGoal(harness)
    turnStart(harness, 1)
    checkpointCall(harness, { outcome: 'done', next: 'nothing left' })
    turnEnd(harness, USER_ABORT, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'disarm')).toBe(1)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(notices(harness)).toContain('declares the objective done')
    expect(harness.goals.goal?.activation).toBe('disarmed')
    expect(harness.goals.goal?.phase).toBe('active')
  })

  it('lets the opt-in policy resume on a permissive plan after a Stop', async () => {
    const harness = createHarness({ config: { resumeAfterUserStop: 'non-goal' } })
    setGoal(harness)
    turnStart(harness, 1)
    driverDisarm(harness)
    checkpointCall(harness, continuePlan('worker_start', 'impl', 'add the resolver test'))
    turnEnd(harness, USER_ABORT, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'resume')).toBe(1)
    expect(notices(harness)).toContain('add the resolver test')
  })

  it('leaves an armed opt-in goal running on a permissive plan after a Stop', async () => {
    const harness = createHarness({ config: { resumeAfterUserStop: 'non-goal' } })
    setGoal(harness)
    turnStart(harness, 1)
    checkpointCall(harness, continuePlan('worker_start', 'impl', 'add the resolver test'))
    turnEnd(harness, USER_ABORT, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'disarm')).toBe(0)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.activation).toBe('armed')
    expect(harness.goals.goal?.phase).toBe('active')
  })

  it('keeps the strict policy stop on a permissive plan after a Stop', async () => {
    const harness = createHarness()
    setGoal(harness)
    turnStart(harness, 1)
    checkpointCall(harness, continuePlan('worker_start', 'impl', 'add the resolver test'))
    turnEnd(harness, USER_ABORT, 1)
    harness.emitStatus('idle')
    await harness.flush()

    expect(countCalls(harness, 'disarm')).toBe(1)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(notices(harness)).toContain('suppressed automatic continuation')
    expect(notices(harness)).not.toContain('add the resolver test')
  })
})
