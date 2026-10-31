import { afterEach, describe, expect, it } from 'vitest'
import { BlockReviewHarness, decisionCode } from './block-review-harness.js'
import { CheckpointHarness } from './checkpoint-harness.js'
import { noticeText } from './harness.js'

/**
 * Goal rounds use the same turn-close path: the checkpoint is required before
 * the close, the goal driver may continue afterwards, and the independent block
 * review is untouched.
 */

const SERIAL = {
  outcome: 'continue',
  parallel: false,
  serialReason: 'the remaining work is one ordered edit',
  next: 'finish the edit',
}

const GOAL = {
  id: 'goal-1',
  revision: 1,
  objective: 'Ship the migration.',
  phase: 'active',
  maxGoalRounds: 256,
  roundsStarted: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  activation: 'armed',
}

let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

async function createGoalHarness(): Promise<CheckpointHarness> {
  const created = await CheckpointHarness.create({ goal: GOAL })
  cleanup = created.cleanup
  return created.harness
}

/** A goal round with four observed calls and one successful write. */
function goalRoundWork(harness: CheckpointHarness): void {
  harness.turnStart(1)
  harness.goalMessage(1)
  const calls = [
    ['read', { file_path: 'src/a.ts' }, false],
    ['edit', { file_path: 'src/a.ts' }, false],
    ['pwsh', { command: 'pnpm test' }, false],
    ['read', { file_path: 'src/b.ts' }, true],
  ] as const
  for (const [name, args, isError] of calls) {
    const callId = harness.toolCall(name, args)
    harness.toolResult(callId, isError ? 'ENOENT' : 'ok', isError)
  }
}

describe('goal rounds', () => {
  it('requires the checkpoint before a goal round closes and adds no second trigger', async () => {
    const harness = await createGoalHarness()
    goalRoundWork(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('Work checkpoint required')
    expect(harness.goalCalls).toEqual([])

    await harness.checkpoint(SERIAL)
    await harness.turnStopping()
    // One checkpoint for the round: the close is allowed and no second request fires.
    expect(harness.steers).toHaveLength(1)
    expect(await harness.recordNames()).toEqual(['1.json'])
    // The checkpoint never blocked, paused, completed, or resumed the goal.
    expect(harness.goalCalls).toEqual([])
  })

  it('closes the round and the next goal round sees the checkpoint', async () => {
    const harness = await createGoalHarness()
    goalRoundWork(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    await harness.checkpoint(SERIAL)
    await harness.turnStopping()
    // The close is allowed; the round then ends through the normal turn/end path.
    expect(harness.steers).toHaveLength(1)
    harness.turnEnd()
    // Idle processing runs the scheduled reconciliation; the goal is untouched.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(harness.goalCalls).toEqual([])
    expect(harness.injected).toHaveLength(0)
    // A closed round never re-requires its checkpoint.
    await harness.turnStopping(1)
    expect(harness.steers).toHaveLength(1)
    // The closed round's log carries the checkpoint the next round reads.
    const checkpointCall = harness.events.find(
      (event) => event.type === 'tool/call' && event.data.name === 'work_checkpoint',
    )
    expect(checkpointCall).toBeDefined()
    expect(harness.events.filter((event) => event.type === 'turn/end')).toHaveLength(1)
    // The driver starts the next goal round; no second checkpoint is required
    // for the closed round and the checkpoint is already in the session history.
    harness.turnStart(2)
    harness.goalMessage(2)
    const call = harness.toolCall('read', { file_path: 'src/b.ts' })
    harness.toolResult(call, 'ok')
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    expect(harness.goalCalls).toEqual([])
    expect(await harness.recordNames()).toEqual(['1.json'])
  })

  it('still runs the block review when the same turn proposes a block', async () => {
    const created = await BlockReviewHarness.create(
      {},
      { checkpoint: { enabled: true } },
      { roundsStarted: 3 },
    )
    const harness = created.harness
    try {
      harness.turnStart(1)
      const goal = harness.goal
      if (goal === undefined) throw new Error('test goal missing')
      harness.goalRound(goal, 3)
      const checkpoint = harness.toolCall('work_checkpoint', SERIAL)
      harness.toolResult(checkpoint, 'recorded')
      const edit = harness.toolCall('edit', { file_path: 'src/a.ts' })
      harness.toolResult(edit, 'ok')

      const { decision } = await harness.block()
      expect(harness.runs).toHaveLength(1)
      expect(harness.children).toHaveLength(1)
      expect(decisionCode(decision)).toBe('GOAL_BLOCK_REVIEW_REJECTED')
    } finally {
      await created.cleanup()
    }
  })
})
