import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointHarness, type CheckpointHarnessOptions } from './checkpoint-harness.js'
import { noticeText } from './harness.js'

/**
 * Bottleneck age: the same owner keeping the same lanes blocked is not progress.
 * The plugin reads the previous checkpoint record of the same session and
 * refuses the close at `bottleneckAge`, until the data changes or the user was
 * asked. A legacy, foreign, or unreadable record is never a count.
 */

let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

async function create(options: CheckpointHarnessOptions = {}): Promise<CheckpointHarness> {
  const created = await CheckpointHarness.create(options)
  cleanup = created.cleanup
  return created.harness
}

/** One serial plan with the given bottleneck overrides. */
function plan(bottleneck: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    outcome: 'continue',
    lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src/a.ts'], state: 'running' }],
    bottleneck: {
      id: 'guard-missing',
      owner: 'lead',
      action: 'lead_action',
      blockingLanes: ['lane-a'],
      targets: ['src/a.ts'],
      ...bottleneck,
    },
    next: 'execute the remedy',
  }
}

/** Execute the declared lead remedy so only the age gate can refuse. */
function remedy(harness: CheckpointHarness): void {
  const call = harness.toolCall('edit', { file_path: 'src/a.ts' })
  harness.toolResult(call, 'ok')
}

describe('bottleneck age', () => {
  it('refuses the close when the same owner and blocking lanes survive a second checkpoint', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.turnStart(2)
    await harness.checkpoint(plan())
    expect((await harness.readRecord(2)).bottleneckAge).toBe(2)
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain('guard-missing')
    expect(text).toContain('persisted for 2 checkpoints')
    expect(text).toContain('Change the route')
  })

  it('resets the count when the owner changes', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.turnStart(2)
    await harness.checkpoint(plan({ owner: 'lane-docs' }))
    expect((await harness.readRecord(2)).bottleneckAge).toBe(1)
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('resets the count when the blocking lane set changes', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.turnStart(2)
    await harness.checkpoint(plan({ blockingLanes: [] }))
    expect((await harness.readRecord(2)).bottleneckAge).toBe(1)
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('lets a user_decision question escape an aged bottleneck', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.turnStart(2)
    await harness.checkpoint(plan({ action: 'user_decision' }))
    expect((await harness.readRecord(2)).bottleneckAge).toBe(2)
    const question = harness.toolCall('ask_user_question', { question: 'which route?' })
    harness.toolResult(question, 'answered')
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('counts periodic checkpoints within the same turn', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    await harness.checkpoint(plan())
    expect((await harness.readRecord(1)).bottleneckAge).toBe(2)
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('persisted for 2 checkpoints')
  })

  it('keeps the age across a truncated display owner', async () => {
    const harness = await create()
    const owner = 'o'.repeat(200)
    harness.turnStart(1)
    await harness.checkpoint(plan({ owner }))
    harness.turnStart(2)
    await harness.checkpoint(plan({ owner }))
    expect((await harness.readRecord(2)).bottleneckAge).toBe(2)
  })

  it('does not let a duplicate blocking entry reset the age', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan({ blockingLanes: ['lane-a'] }))
    harness.turnStart(2)
    await harness.checkpoint(plan({ blockingLanes: ['lane-a', 'lane-a'] }))
    expect((await harness.readRecord(2)).bottleneckAge).toBe(2)
  })

  it('keeps the state escape for a lane id the record truncates', async () => {
    const harness = await create()
    const id = 'l'.repeat(121)
    harness.turnStart(1)
    await harness.checkpoint({
      ...plan({ blockingLanes: [id] }),
      lanes: [{ id, owner: 'lead', scope: ['src/a.ts'], state: 'blocked' }],
    })
    harness.turnStart(2)
    await harness.checkpoint({
      ...plan({ blockingLanes: [id] }),
      lanes: [{ id, owner: 'lead', scope: ['src/a.ts'], state: 'running' }],
    })
    expect((await harness.readRecord(2)).bottleneckAge).toBe(1)
  })

  it('allows a new owner at threshold 1', async () => {
    const harness = await create({ config: { checkpoint: { bottleneckAge: 1 } } })
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.turnStart(2)
    await harness.checkpoint(plan({ owner: 'lane-docs' }))
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('refuses a repeated bottleneck at threshold 1', async () => {
    const harness = await create({ config: { checkpoint: { bottleneckAge: 1 } } })
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.turnStart(2)
    await harness.checkpoint(plan())
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('persisted for 2 checkpoints')
  })

  it('does not enforce an older same-turn record after a failed state amendment', async () => {
    const harness = await create()
    const lanes = (state: 'blocked' | 'running'): Record<string, unknown>[] => [
      { id: 'lane-a', owner: 'lead', scope: ['src/a.ts'], state },
    ]
    harness.turnStart(1)
    await harness.checkpoint({ ...plan(), lanes: lanes('blocked') })
    await harness.checkpoint({ ...plan(), lanes: lanes('blocked') })
    const stale = await readFile(harness.recordPath(1), 'utf8')
    await harness.checkpoint({ ...plan(), lanes: lanes('running') })
    // Simulate the amendment's write failing and leaving the earlier record.
    await writeFile(harness.recordPath(1), stale, 'utf8')
    remedy(harness)
    await harness.turnStopping(1)
    expect(harness.steers).toHaveLength(0)
  })

  it('does not enforce an older same-turn record after a failed amendment', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    await harness.checkpoint(plan())
    const stale = await readFile(harness.recordPath(1), 'utf8')
    await harness.checkpoint(plan({ owner: 'lane-docs' }))
    // Simulate the amendment's write failing and leaving the earlier record.
    await writeFile(harness.recordPath(1), stale, 'utf8')
    remedy(harness)
    await harness.turnStopping(1)
    expect(harness.steers).toHaveLength(0)
  })

  it('does not enforce an older record when the current write fails', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.turnStart(2)
    await harness.checkpoint(plan())
    expect((await harness.readRecord(2)).bottleneckAge).toBe(2)
    harness.turnStart(3)
    // A directory at the record path makes the write fail while older records read.
    await mkdir(harness.recordPath(3))
    const written = await harness.checkpoint(plan({ owner: 'lane-docs' }))
    expect(written.text).toContain('could not write')
    remedy(harness)
    await harness.turnStopping(3)
    expect(harness.steers).toHaveLength(0)
  })

  it('does not enforce the age on an expired done checkpoint', async () => {
    const harness = await create({ config: { checkpoint: { stepInterval: 1 } } })
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.turnStart(2)
    await harness.checkpoint({
      outcome: 'done',
      verified: ['shipped'],
      lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src/a.ts'], state: 'done' }],
      bottleneck: {
        id: 'guard-missing',
        owner: 'lead',
        action: 'lead_action',
        blockingLanes: ['lane-a'],
        targets: ['src/a.ts'],
      },
      next: 'report',
    })
    await harness.preStep(2)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('refuses the first checkpoint at threshold 1 with no route change', async () => {
    const harness = await create({ config: { checkpoint: { bottleneckAge: 1 } } })
    harness.turnStart(1)
    await harness.checkpoint(plan())
    remedy(harness)
    await harness.turnStopping(1)
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('persisted for 1 checkpoints')
  })

  it('refuses an aged bottleneck even after the checkpoint expires', async () => {
    const harness = await create({ config: { checkpoint: { stepInterval: 1 } } })
    harness.turnStart(1)
    await harness.checkpoint(plan())
    await harness.checkpoint(plan())
    remedy(harness)
    await harness.preStep(1)
    await harness.turnStopping(1)
    expect(harness.steers).toHaveLength(2)
    expect(noticeText(harness.steers[1] as never)).toContain('persisted for 2 checkpoints')
  })

  it('resets the count when a blocking lane moves from blocked to running', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint({
      ...plan(),
      lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src/a.ts'], state: 'blocked' }],
    })
    harness.turnStart(2)
    await harness.checkpoint(plan())
    expect((await harness.readRecord(2)).bottleneckAge).toBe(1)
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('resets the count when a blocking lane moves from blocked to done', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint({
      ...plan(),
      lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src/a.ts'], state: 'blocked' }],
    })
    harness.turnStart(2)
    await harness.checkpoint({
      ...plan(),
      lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src/a.ts'], state: 'done' }],
    })
    expect((await harness.readRecord(2)).bottleneckAge).toBe(1)
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('ignores a legacy record without a bottleneck object', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    await writeFile(
      harness.recordPath(1),
      `${JSON.stringify({
        version: 1,
        checkpoint: 'checkpoint-1-00000000',
        turn: 1,
        outcome: 'continue',
        parallel: false,
        serialReason: 'one ordered edit',
        bottleneck: 'the guard must exist',
        next: 'finish',
        time: new Date().toISOString(),
        session: harness.sessionId,
      })}\n`,
      'utf8',
    )
    harness.turnStart(2)
    await harness.checkpoint(plan())
    expect((await harness.readRecord(2)).bottleneckAge).toBe(1)
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('ignores a record from another session', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    harness.resetSessionId('other-session')
    harness.turnStart(2)
    await harness.checkpoint(plan())
    expect((await harness.readRecord(2)).bottleneckAge).toBe(1)
  })

  it('ignores an unreadable previous record without failing the turn', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint(plan())
    await writeFile(harness.recordPath(1), 'not json', 'utf8')
    harness.turnStart(2)
    await harness.checkpoint(plan())
    expect((await harness.readRecord(2)).bottleneckAge).toBe(1)
    remedy(harness)
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })
})
