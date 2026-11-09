import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointHarness, type CheckpointHarnessOptions } from './checkpoint-harness.js'

/**
 * The gate-only `checkpoint.automation` switch: the tool and its record stay
 * available while the periodic request and the close/parallel/remedy/age gates
 * are silent, and the documented default restores the old behavior.
 */

let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  if (cleanup !== undefined) await cleanup()
  cleanup = undefined
})

async function create(options: CheckpointHarnessOptions = {}): Promise<CheckpointHarness> {
  const created = await CheckpointHarness.create(options)
  cleanup = created.cleanup
  return created.harness
}

/** Four observed calls: one successful write, one shell, one failed read. */
function addWorkingCalls(harness: CheckpointHarness): void {
  const calls = [
    ['read', { file_path: 'src/a.ts' }, false, 'ok'],
    ['edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }, false, 'ok'],
    ['pwsh', { command: 'pnpm test' }, false, 'ok'],
    ['read', { file_path: 'src/missing.ts' }, true, 'ENOENT'],
  ] as const
  for (const [name, args, isError, text] of calls) {
    const callId = harness.toolCall(name, args)
    harness.toolResult(callId, text, isError)
  }
}

function workingTurn(harness: CheckpointHarness): void {
  harness.turnStart()
  addWorkingCalls(harness)
}

describe('checkpoint.automation: false', () => {
  it('keeps the tool and its record while the close gate stays silent', async () => {
    const harness = await create({ config: { checkpoint: { automation: false } } })
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)

    const result = await harness.checkpoint({ outcome: 'done', verified: ['done'], next: 'report' })
    expect(result.text).toContain('.dsh/work-checkpoints/')
    const record = await harness.readRecord()
    expect(record.outcome).toBe('done')
    expect(record.session).toBe(harness.sessionId)
  })

  it('sends no periodic request at the step interval', async () => {
    const harness = await create({ config: { checkpoint: { automation: false, stepInterval: 5 } } })
    workingTurn(harness)
    for (let step = 0; step < 10; step += 1) await harness.preStep()
    expect(harness.steers).toHaveLength(0)
  })

  it('reports the disabled automation to the workflow engine', async () => {
    const harness = await create({ config: { checkpoint: { automation: false } } })
    expect(harness.ctx.get('goalContinuityStatus')).toEqual({ automation: false })
    const enabled = await create()
    expect(enabled.ctx.get('goalContinuityStatus')).toEqual({ automation: true })
  })
})

describe('checkpoint.automation: true', () => {
  it('restores the close gate and the periodic request', async () => {
    const harness = await create({ config: { checkpoint: { stepInterval: 5 } } })
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    for (let step = 0; step < 10; step += 1) await harness.preStep()
    expect(harness.steers.length).toBeGreaterThan(1)
  })
})
