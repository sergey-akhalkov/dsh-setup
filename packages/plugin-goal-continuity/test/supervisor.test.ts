import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import {
  countCalls,
  createHarness,
  directMessage,
  driverDisarm,
  driverPauseCancelledRound,
  goalMessage,
  type Harness,
  noticeText,
  setGoal,
  turnEnd,
  turnStart,
} from './harness.js'

const RESET = {
  kind: 'aborted',
  reason: { kind: 'hook', reason: 'loop-guard:reset: repeated line' },
}
const FINAL = {
  kind: 'aborted',
  reason: { kind: 'hook', reason: 'loop-guard:final: repeated line' },
}
const UNKNOWN_HOOK = { kind: 'aborted', reason: { kind: 'hook', reason: 'other-plugin' } }
const USER_ABORT = { kind: 'aborted', reason: { kind: 'user' } }
const MAX_TOKENS = { kind: 'max-tokens' }
const COMPLETED = { kind: 'completed' }

/** Run one goal-round abort through the full driver-shaped event order. */
async function goalRoundAbort(harness: Harness, reason: Record<string, unknown>): Promise<void> {
  const goal = harness.goals.goal
  if (goal === undefined) throw new Error('test goal missing')
  turnStart(harness)
  goalMessage(harness, goal)
  turnEnd(harness, reason)
  driverPauseCancelledRound(harness)
  harness.emitStatus('idle')
  await harness.flush()
}

/** Run one non-goal abort with the driver's disarm reaction. */
async function nonGoalAbort(harness: Harness, reason: Record<string, unknown>): Promise<void> {
  turnStart(harness)
  driverDisarm(harness)
  turnEnd(harness, reason)
  harness.emitStatus('idle')
  await harness.flush()
}

describe('deterministic signal tracking', () => {
  it('resumes after a non-goal hook reset', async () => {
    const harness = createHarness()
    setGoal(harness)
    await nonGoalAbort(harness, RESET)
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(1)
    expect(harness.goals.goal?.activation).toBe('armed')
  })

  it('acts on a round-limit goal change without an activation edge', async () => {
    const harness = createHarness()
    await harness.flush()
    const goal = setGoal(harness, {
      roundsStarted: 256,
      maxGoalRounds: 256,
      activation: 'disarmed',
    })
    harness.goals.block(
      harness.agent,
      { id: goal.id as never, revision: goal.revision },
      { code: 'round-limit', message: 'Goal reached its configured limit.' },
    )
    await harness.flush()
    expect(countCalls(harness, 'edit')).toBe(1)
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.goals.goal?.activation).toBe('armed')
  })

  it('tracks a goal round and ignores a forked or subagent session', async () => {
    const subagent = createHarness({ header: { origin: 'subagent' } })
    await subagent.flush()
    setGoal(subagent)
    const subagentGoal = subagent.goals.goal
    if (subagentGoal === undefined) throw new Error('test goal missing')
    turnStart(subagent)
    goalMessage(subagent, subagentGoal)
    turnEnd(subagent, RESET)
    await subagent.flush()
    expect(subagent.goals.calls).toHaveLength(0)
    expect(subagent.goals.reads).toHaveLength(0)

    const forked = createHarness({ header: { parentSession: 'parent', isSeeded: true } })
    await forked.flush()
    setGoal(forked)
    const forkedGoal = forked.goals.goal
    if (forkedGoal === undefined) throw new Error('test goal missing')
    turnStart(forked)
    goalMessage(forked, forkedGoal)
    turnEnd(forked, RESET)
    await forked.flush()
    expect(forked.goals.calls).toHaveLength(0)
    expect(forked.goals.reads).toHaveLength(0)
  })

  it('ignores an unknown session id', async () => {
    const harness = createHarness()
    await harness.flush()
    harness.goals.reads.length = 0
    setGoal(harness)
    harness.ctx.emit(
      'session/event',
      { id: 'missing', header: {} } as never,
      {
        type: 'turn/end',
        data: { turn: 1, reason: COMPLETED },
      } as never,
    )
    await harness.flush()
    expect(harness.goals.reads).toHaveLength(0)
  })
})

describe('deferred reconciliation', () => {
  it('acts only after the turn/end dispatch settles', async () => {
    const harness = createHarness()
    setGoal(harness)
    turnStart(harness)
    driverDisarm(harness)
    turnEnd(harness, RESET)
    expect(countCalls(harness, 'resume')).toBe(0)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(1)
  })

  it('re-reads and resumes once on a stale revision', async () => {
    const harness = createHarness()
    setGoal(harness)
    harness.goals.staleNext = 'resume'
    driverDisarm(harness)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(2)
    expect(harness.injected).toHaveLength(1)
    expect(harness.goals.goal?.activation).toBe('armed')
  })

  it('does not resume a blocked or paused goal', async () => {
    const harness = createHarness()
    const goal = setGoal(harness)
    harness.goals.block(
      harness.agent,
      { id: goal.id as never, revision: goal.revision },
      {
        code: 'model-reported',
        message: 'need input',
      },
    )
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('model-reported')
    expect(harness.injected).toHaveLength(0)

    const paused = createHarness()
    const pausedGoal = setGoal(paused)
    paused.goals.pause(paused.agent, {
      id: pausedGoal.id as never,
      revision: pausedGoal.revision,
    })
    await paused.flush()
    expect(countCalls(paused, 'resume')).toBe(0)
    expect(paused.goals.goal?.phase).toBe('paused')
  })
})

describe('restart policy', () => {
  it('leaves a restored goal disarmed by default', async () => {
    const harness = createHarness({
      restart: true,
      initialGoal: { phase: 'active', activation: 'disarmed' },
    })
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.activation).toBe('disarmed')
  })

  it('resumes once with the flag and reconciles a later in-process disarm', async () => {
    const harness = createHarness({
      restart: true,
      config: { resumeAfterRestart: true },
      initialGoal: { phase: 'active', activation: 'disarmed' },
    })
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(1)

    driverDisarm(harness)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(2)
  })

  it('reconciles an in-process disarm when restart resume is off', async () => {
    const harness = createHarness()
    setGoal(harness)
    driverDisarm(harness)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(1)
  })

  it('falls back to the first observation when the header lacks a creation time', async () => {
    const harness = createHarness({
      missingCreatedAt: true,
      initialGoal: { phase: 'active', activation: 'disarmed' },
    })
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(0)
    const goal = harness.goals.goal
    if (goal === undefined) throw new Error('test goal missing')
    goal.activation = 'armed'
    driverDisarm(harness)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(1)
  })
})

describe('user abort policy', () => {
  it('respects a Stop during a goal round', async () => {
    const harness = createHarness()
    const goal = setGoal(harness, { roundsStarted: 3 })
    turnStart(harness)
    goalMessage(harness, goal)
    turnEnd(harness, USER_ABORT)
    driverPauseCancelledRound(harness)
    harness.emitStatus('idle')
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.phase).toBe('paused')
    expect(harness.injected).toHaveLength(0)

    turnStart(harness, 2)
    directMessage(harness)
    turnEnd(harness, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.phase).toBe('paused')
  })

  it('re-arms after a non-goal Stop with the non-goal policy', async () => {
    const harness = createHarness()
    setGoal(harness)
    await nonGoalAbort(harness, USER_ABORT)
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(1)
  })

  it('suppresses a non-goal Stop with the never policy until a direct message', async () => {
    const harness = createHarness({ config: { resumeAfterUserStop: 'never' } })
    setGoal(harness)
    await nonGoalAbort(harness, USER_ABORT)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.injected).toHaveLength(1)
    expect(noticeText(harness.injected[0] as UserMessage)).toContain(
      'suppressed automatic continuation',
    )

    turnStart(harness, 2)
    directMessage(harness)
    turnEnd(harness, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(2)
  })
})

describe('pause prevention', () => {
  it('disarms before the idle settlement so a reset does not become a pause', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 4 })
    await goalRoundAbort(harness, RESET)
    expect(countCalls(harness, 'pause')).toBe(0)
    expect(countCalls(harness, 'resume')).toBe(1)
  })

  it('prevents the pause for a final cause and then blocks the goal', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 4 })
    await goalRoundAbort(harness, FINAL)
    expect(countCalls(harness, 'pause')).toBe(0)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(countCalls(harness, 'block')).toBe(1)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
  })

  it('prevents the pause for an unrecognized hook cause', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 4 })
    await goalRoundAbort(harness, UNKNOWN_HOOK)
    expect(countCalls(harness, 'pause')).toBe(0)
    expect(countCalls(harness, 'block')).toBe(1)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
  })

  it('keeps the driver pause when the user aborts a goal round', async () => {
    const harness = createHarness()
    const goal = setGoal(harness, { roundsStarted: 4 })
    turnStart(harness)
    goalMessage(harness, goal)
    turnEnd(harness, USER_ABORT)
    driverPauseCancelledRound(harness)
    harness.emitStatus('idle')
    await harness.flush()
    expect(harness.goals.goal?.phase).toBe('paused')
    expect(countCalls(harness, 'resume')).toBe(0)
  })

  it('never resumes when the pause was already recorded before turn/end', async () => {
    const harness = createHarness()
    const goal = setGoal(harness, { roundsStarted: 4 })
    turnStart(harness)
    goalMessage(harness, goal)
    driverPauseCancelledRound(harness)
    turnEnd(harness, RESET)
    harness.emitStatus('idle')
    await harness.flush()
    expect(harness.goals.goal?.phase).toBe('paused')
    expect(countCalls(harness, 'resume')).toBe(0)
  })
})

describe('reset continuation and round-cap extension', () => {
  it('extends the cap for a reset on the last permitted round', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    await goalRoundAbort(harness, RESET)
    expect(countCalls(harness, 'edit')).toBe(1)
    expect(harness.goals.goal?.maxGoalRounds).toBe(1256)
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(1)
  })

  it('blocks an active goal when no extension capacity remains', async () => {
    const harness = createHarness({ config: { maxRoundExtensions: 0 } })
    setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    await goalRoundAbort(harness, RESET)
    expect(countCalls(harness, 'edit')).toBe(0)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
  })

  it('extends a round-limit block and resumes it', async () => {
    const harness = createHarness()
    const goal = setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    harness.goals.block(
      harness.agent,
      { id: goal.id as never, revision: goal.revision },
      {
        code: 'round-limit',
        message: 'Goal reached its configured limit.',
      },
    )
    await harness.flush()
    expect(harness.goals.goal?.maxGoalRounds).toBe(1256)
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(1)
  })

  it('keeps the native round-limit block and explains the exhausted extension budget', async () => {
    const harness = createHarness({ config: { maxRoundExtensions: 0 } })
    const goal = setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    harness.goals.block(
      harness.agent,
      { id: goal.id as never, revision: goal.revision },
      {
        code: 'round-limit',
        message: 'Goal reached its configured limit.',
      },
    )
    await harness.flush()
    expect(countCalls(harness, 'edit')).toBe(0)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('round-limit')
    expect(harness.injected).toHaveLength(1)
  })

  it('records a native round-limit refusal once across repeated reconciles', async () => {
    const harness = createHarness({ config: { maxRoundExtensions: 0 } })
    const goal = setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    harness.goals.block(
      harness.agent,
      { id: goal.id as never, revision: goal.revision },
      {
        code: 'round-limit',
        message: 'Goal reached its configured limit.',
      },
    )
    await harness.flush()
    expect(harness.injected).toHaveLength(1)

    turnStart(harness, 2)
    turnEnd(harness, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()
    expect(harness.injected).toHaveLength(1)
    expect(harness.goals.goal?.blockedReason?.code).toBe('round-limit')
  })

  it('enforces the hard total cap', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 4500, maxGoalRounds: 4500 })
    await goalRoundAbort(harness, RESET)
    expect(countCalls(harness, 'edit')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
  })

  it('re-reads and retries a stale cap edit', async () => {
    const harness = createHarness()
    const goal = setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    harness.goals.staleNext = 'edit'
    harness.goals.block(
      harness.agent,
      { id: goal.id as never, revision: goal.revision },
      {
        code: 'round-limit',
        message: 'Goal reached its configured limit.',
      },
    )
    await harness.flush()
    expect(countCalls(harness, 'edit')).toBe(2)
    expect(harness.goals.goal?.maxGoalRounds).toBe(1256)
    expect(countCalls(harness, 'resume')).toBe(1)
  })

  it('blocks when one extension still cannot cover the rounds already started', async () => {
    const harness = createHarness({ config: { maxRoundExtensions: 1 } })
    setGoal(harness, { roundsStarted: 1500, maxGoalRounds: 256 })
    await goalRoundAbort(harness, RESET)
    expect(countCalls(harness, 'edit')).toBe(1)
    expect(harness.goals.goal?.maxGoalRounds).toBe(1256)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
  })

  it('keeps extending while extension capacity remains to cover the started rounds', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 1500, maxGoalRounds: 256 })
    await goalRoundAbort(harness, RESET)
    expect(countCalls(harness, 'edit')).toBe(2)
    expect(harness.goals.goal?.maxGoalRounds).toBe(2256)
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(1)
  })

  it('blocks after an extension when every resume attempt fails', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    harness.goals.failResumeAttempts = 2
    await goalRoundAbort(harness, RESET)
    expect(countCalls(harness, 'edit')).toBe(1)
    expect(countCalls(harness, 'resume')).toBe(2)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
    const reason = harness.goals.goal?.blockedReason?.message ?? ''
    expect(reason).toContain('Automatic resumes used')
    expect(reason).toContain('Next:')
  })

  it('blocks when a later extension fails after a partial extension', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 1500, maxGoalRounds: 256 })
    harness.goals.failEditAfter = 1
    harness.goals.failEditAttempts = 2
    await goalRoundAbort(harness, RESET)
    expect(countCalls(harness, 'edit')).toBe(3)
    expect(harness.goals.goal?.maxGoalRounds).toBe(1256)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.injected).toHaveLength(1)
    const reason = harness.goals.goal?.blockedReason?.message ?? ''
    expect(reason).toContain('Automatic resumes used')
    expect(reason).toContain('Next:')
  })

  it('resumes when a stale edit reveals capacity instead of extending again', async () => {
    const harness = createHarness({ config: { hardMaxGoalRounds: 1256 } })
    const goal = setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    harness.goals.staleNext = 'edit'
    harness.goals.staleEditRaiseCap = 300
    harness.goals.block(
      harness.agent,
      { id: goal.id as never, revision: goal.revision },
      {
        code: 'round-limit',
        message: 'Goal reached its configured limit.',
      },
    )
    await harness.flush()
    expect(countCalls(harness, 'edit')).toBe(1)
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.goals.goal?.maxGoalRounds).toBe(300)
    expect(harness.goals.goal?.activation).toBe('armed')
    expect(harness.goals.goal?.blockedReason).toBeUndefined()
    expect(harness.injected).toHaveLength(1)
  })
})

describe('terminal stops', () => {
  it('blocks a goal on a final hook cause outside a goal round', async () => {
    const harness = createHarness()
    setGoal(harness)
    await nonGoalAbort(harness, FINAL)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
    const reason = harness.goals.goal?.blockedReason?.message ?? ''
    expect(reason).toContain('final stop')
    expect(reason).toContain('Automatic resumes used')
    expect(reason).toContain('remain')
    expect(reason).toContain('Next:')
  })

  it('blocks a goal on an unrecognized hook cause outside a goal round', async () => {
    const harness = createHarness()
    setGoal(harness)
    await nonGoalAbort(harness, UNKNOWN_HOOK)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
  })

  it('blocks a goal on max tokens', async () => {
    const harness = createHarness()
    setGoal(harness)
    await nonGoalAbort(harness, MAX_TOKENS)
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
  })

  it('blocks a goal on an agent error', async () => {
    const harness = createHarness()
    await harness.flush()
    setGoal(harness)
    harness.emitError()
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(0)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(1)
  })

  it('leaves a user pause unchanged without a notice', async () => {
    const harness = createHarness()
    const goal = setGoal(harness)
    harness.goals.pause(harness.agent, { id: goal.id as never, revision: goal.revision })
    harness.emitError()
    await harness.flush()
    expect(harness.goals.goal?.phase).toBe('paused')
    expect(countCalls(harness, 'block')).toBe(0)
    expect(harness.injected).toHaveLength(0)
  })

  it('does not let a goal-service resume clear a terminal suppression', async () => {
    const harness = createHarness()
    setGoal(harness)
    await goalRoundAbort(harness, FINAL)
    const blocked = harness.goals.goal
    if (blocked === undefined) throw new Error('test goal missing')
    expect(blocked.blockedReason?.code).toBe('continuity-stopped')

    harness.goals.resume(harness.agent, {
      id: blocked.id as never,
      revision: blocked.revision,
    })
    await harness.flush()
    expect(harness.goals.goal?.phase).toBe('active')

    driverDisarm(harness)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
  })

  it('does not resume after a user clear or complete', async () => {
    const cleared = createHarness()
    const clearedGoal = setGoal(cleared)
    await cleared.flush()
    cleared.goals.clear(cleared.agent, {
      id: clearedGoal.id as never,
      revision: clearedGoal.revision,
    })
    await cleared.flush()
    expect(cleared.goals.goal).toBeUndefined()
    expect(countCalls(cleared, 'resume')).toBe(0)
    expect(cleared.injected).toHaveLength(0)

    const completed = createHarness()
    const completedGoal = setGoal(completed)
    await completed.flush()
    completed.goals.complete(completed.agent, {
      id: completedGoal.id as never,
      revision: completedGoal.revision,
    })
    await completed.flush()
    expect(completed.goals.goal?.phase).toBe('complete')
    expect(countCalls(completed, 'resume')).toBe(0)
    expect(completed.injected).toHaveLength(0)
  })
})

describe('bounded automatic continuation', () => {
  it('refuses the 21st resume and blocks the active goal', async () => {
    const harness = createHarness({ config: { maxSessionResumes: 20 } })
    const goal = setGoal(harness)
    for (let index = 0; index < 20; index += 1) {
      driverDisarm(harness)
      await harness.flush()
    }
    expect(countCalls(harness, 'resume')).toBe(20)
    expect(harness.injected).toHaveLength(20)

    turnStart(harness, 2)
    goalMessage(harness, goal, 21)
    turnEnd(harness, COMPLETED)
    harness.emitStatus('idle')
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(20)

    driverDisarm(harness)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(20)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(21)
    const reason = harness.goals.goal?.blockedReason?.message ?? ''
    expect(reason).toContain('Automatic resumes used 20 of 20')
    expect(reason).toContain('0 remain')
    expect(reason).toContain('Next:')
  })

  it('charges an extension resume against the shared session budget', async () => {
    const harness = createHarness({ config: { maxSessionResumes: 1 } })
    const goal = setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    harness.goals.block(
      harness.agent,
      { id: goal.id as never, revision: goal.revision },
      { code: 'round-limit', message: 'Goal reached its configured limit.' },
    )
    await harness.flush()
    expect(countCalls(harness, 'edit')).toBe(1)
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(1)

    driverDisarm(harness)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.goals.goal?.blockedReason?.code).toBe('continuity-stopped')
    expect(harness.injected).toHaveLength(2)
  })
})

describe('visible bounded notices', () => {
  it('delivers one bounded non-waking notice without the objective', async () => {
    const harness = createHarness()
    setGoal(harness, { objective: 'SECRET OBJECTIVE' })
    await goalRoundAbort(harness, RESET)
    const notice = harness.injected[0] as UserMessage
    expect(notice.source).toMatchObject({ kind: 'goal-continuity', form: 'notice' })
    const text = noticeText(notice)
    expect(text.length).toBeLessThanOrEqual(600)
    expect(text).not.toContain('SECRET OBJECTIVE')
    expect(text).toContain('resumed the goal')
    const summary = (notice.source as { summary?: string }).summary ?? ''
    expect(summary.length).toBeLessThanOrEqual(120)
    expect(harness.followups).toHaveLength(0)
    expect(harness.steers).toHaveLength(0)
    expect(harness.agent.status).toBe('idle')
  })

  it('produces exactly one notice for an extension and resume', async () => {
    const harness = createHarness()
    setGoal(harness, { roundsStarted: 256, maxGoalRounds: 256 })
    await goalRoundAbort(harness, RESET)
    expect(harness.injected).toHaveLength(1)
  })

  it('keeps the block reason bounded', async () => {
    const harness = createHarness()
    setGoal(harness)
    await nonGoalAbort(harness, FINAL)
    const reason = harness.goals.goal?.blockedReason
    expect(reason?.code).toBe('continuity-stopped')
    expect((reason?.message ?? '').length).toBeLessThanOrEqual(400)
    expect(reason?.message).toContain('Next:')
  })

  it('fails open when the agent cannot receive a notice', async () => {
    const harness = createHarness({ throwOnInject: true })
    setGoal(harness)
    driverDisarm(harness)
    await harness.flush()
    expect(countCalls(harness, 'resume')).toBe(1)
    expect(harness.injected).toHaveLength(0)
  })
})

describe('composition off switch', () => {
  it('performs no action and emits no notice when disabled', async () => {
    const harness = createHarness({ config: { enabled: false } })
    setGoal(harness)
    turnStart(harness)
    turnEnd(harness, RESET)
    harness.emitStatus('idle')
    await harness.flush()
    expect(harness.goals.reads).toHaveLength(0)
    expect(harness.goals.calls).toHaveLength(0)
    expect(harness.injected).toHaveLength(0)
  })
})
