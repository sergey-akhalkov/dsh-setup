import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointHarness } from './checkpoint-harness.js'
import { noticeText } from './harness.js'

/**
 * A scenario shaped like the reference session: 16 checkpoints, 12 of them
 * repeating one serial reason, a remainder that still listed closed work, and a
 * named bottleneck that survived while the agent waited. Every one of those
 * decisions is now refused with named evidence.
 */

let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
})

async function create(): Promise<CheckpointHarness> {
  const created = await CheckpointHarness.create({ availableTools: ['subagent'] })
  cleanup = created.cleanup
  return created.harness
}

describe('reference-session regressions', () => {
  it('rejects the repeatable serial-reason checkpoint', async () => {
    const harness = await create()
    harness.turnStart(1)
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'continue',
        parallel: false,
        serialReason: 'the live stand must stay one ordered run',
        bottleneck: 'the stand is still running',
        next: 'wait ten minutes',
      }),
    ).rejects.toThrow(/work_checkpoint\.parallel was removed/u)
    expect(await harness.tryReadRecord()).toBeUndefined()
  })

  it('refuses two disjoint owned lanes with no tagged worker', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [
        { id: 'host', owner: 'lead', scope: ['packages/host'], state: 'running' },
        { id: 'docs', owner: 'lane-docs', scope: ['docs'], state: 'running' },
      ],
      bottleneck: {
        id: 'dispatch',
        owner: 'lead',
        action: 'worker_start',
        blockingLanes: ['docs'],
      },
      next: 'start the docs worker',
    })
    const id = String((await harness.readRecord()).checkpoint)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain(id)
    expect(text).toContain('computes parallel lanes')
  })

  it('refuses a close whose only progress is another wait', async () => {
    const harness = await create()
    harness.turnStart(1)
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [{ id: 'stand', owner: 'lead', scope: ['resource:live-stand'], state: 'running' }],
      bottleneck: {
        id: 'stand-run',
        owner: 'lead',
        action: 'worker_start',
        blockingLanes: ['stand'],
      },
      next: 'wait for the stand',
    })
    const wait = harness.toolCall('job_output', { job_id: 'job-1', wait: true })
    harness.toolResult(wait, 'no change')
    const shell = harness.toolCall('pwsh', { command: 'Start-Sleep -Seconds 600' })
    harness.toolResult(shell, 'ok')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain('stand-run')
    expect(text).toContain('worker_start')
    expect(text).toContain('Before the close')
  })

  it('refuses a bottleneck that survives a second checkpoint', async () => {
    const harness = await create()
    const plan = {
      outcome: 'continue',
      lanes: [{ id: 'stand', owner: 'lead', scope: ['resource:live-stand'], state: 'running' }],
      bottleneck: {
        id: 'stand-run',
        owner: 'lead',
        action: 'lead_action',
        blockingLanes: ['stand'],
        targets: ['docs/live-stand.md'],
      },
      next: 'wait again',
    }
    harness.turnStart(1)
    await harness.checkpoint(plan)
    harness.turnStart(2)
    await harness.checkpoint(plan)
    const edit = harness.toolCall('write', { file_path: 'docs/live-stand.md', content: 'note' })
    harness.toolResult(edit, 'ok')
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain('stand-run')
    expect(text).toContain('persisted for 2 checkpoints')
  })
})
