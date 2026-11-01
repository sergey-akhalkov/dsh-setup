import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointHarness, type CheckpointHarnessOptions } from './checkpoint-harness.js'
import { noticeText } from './harness.js'

/**
 * The executed-remedy gate: a `continue` checkpoint names a bottleneck and the
 * action that removes it, and the turn may close only after a later call the
 * plugin can verify as that action. A sentence, a target mentioned in content,
 * and a call before the checkpoint are not evidence.
 */

const WORKER_START_TOOLS = [
  'subagent',
  'subagent_fork',
  'spawn_teammate',
  'workflow',
  'delegate',
] as const

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

/** One serial plan whose declared remedy is the given action. */
function plan(action: string, targets?: string[]): Record<string, unknown> {
  return {
    outcome: 'continue',
    lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src'], state: 'running' }],
    bottleneck: {
      id: 'guard-missing',
      owner: 'lead',
      action,
      blockingLanes: ['lane-a'],
      ...(targets === undefined ? {} : { targets }),
    },
    next: 'execute the remedy',
  }
}

/** Start one checkpoint and return its id and the close text's steer helper. */
async function checkpointed(
  harness: CheckpointHarness,
  action: string,
  targets?: string[],
): Promise<string> {
  harness.turnStart()
  await harness.checkpoint(plan(action, targets))
  return String((await harness.readRecord()).checkpoint)
}

function call(harness: CheckpointHarness, name: string, args: unknown, result = 'ok'): void {
  const callId = harness.toolCall(name, args)
  harness.toolResult(callId, result)
}

describe('executed bottleneck remedy', () => {
  for (const tool of WORKER_START_TOOLS) {
    it(`accepts a tagged ${tool} start as the remedy`, async () => {
      const harness = await create({ availableTools: [tool] })
      const id = await checkpointed(harness, 'worker_start')
      call(harness, tool, { objective: `take the lane for ${id}` }, 'started')
      await harness.turnStopping()
      expect(harness.steers).toHaveLength(0)
    })
  }

  it('does not accept an untagged worker start', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    const id = await checkpointed(harness, 'worker_start')
    call(harness, 'subagent', { prompt: 'take the lane' }, 'started')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain(id)
  })

  it('does not accept send_message as a worker start', async () => {
    const harness = await create({ availableTools: ['send_message'] })
    const id = await checkpointed(harness, 'worker_start')
    call(harness, 'send_message', { target: 'lane-a', message: `continue ${id}` })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('worker_start')
  })

  it('does not accept a cached delegate record as a start', async () => {
    const harness = await create({ availableTools: ['delegate'] })
    const id = await checkpointed(harness, 'worker_start')
    call(
      harness,
      'delegate',
      { rule: 'task-review', context: id },
      'rule "task-review" PASS (reused record abc123, digest def456)',
    )
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('accepts a lead edit at the exact declared target', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src/a.ts'])
    call(harness, 'edit', { file_path: 'src/a.ts' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('accepts a write beneath a declared directory target', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src'])
    call(harness, 'write', { file_path: 'src/deep/nested/file.ts', content: 'x' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('does not accept a textual sibling of a declared target', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src'])
    call(harness, 'edit', { file_path: 'src2/file.ts' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('does not accept a failed edit', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src/a.ts'])
    const failed = harness.toolCall('edit', { file_path: 'src/a.ts' })
    harness.toolResult(failed, 'read-only file', true)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('does not accept a pending edit with no result', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src/a.ts'])
    harness.toolCall('edit', { file_path: 'src/a.ts' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('does not accept a target mentioned only in written content', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src/a.ts'])
    call(harness, 'write', { file_path: 'notes.md', content: 'todo: edit src/a.ts next' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('does not accept a target mentioned only in a shell command', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src/a.ts'])
    call(harness, 'pwsh', { command: 'Get-Content src/a.ts' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('does not accept a wrong target', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src/a.ts'])
    call(harness, 'edit', { file_path: 'src/other.ts' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('does not count a matching write from before the checkpoint', async () => {
    const harness = await create()
    harness.turnStart()
    call(harness, 'edit', { file_path: 'src/a.ts' })
    await harness.checkpoint(plan('lead_action', ['src/a.ts']))
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('accepts a question to the user as the user_decision remedy', async () => {
    const harness = await create()
    await checkpointed(harness, 'user_decision')
    call(harness, 'ask_user_question', { question: 'which lane first?' }, 'answered')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('refuses the close naming the checkpoint, the bottleneck, its action, and its lanes', async () => {
    const harness = await create()
    const id = await checkpointed(harness, 'lead_action', ['src/a.ts'])
    await harness.turnStopping()
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain(id)
    expect(text).toContain('guard-missing')
    expect(text).toContain('lead_action')
    expect(text).toContain('lane-a')
    expect(text).toContain('src/a.ts')
    expect(text).toContain('Before the close')
  })

  it('reports nothing for a done outcome', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint({ outcome: 'done', next: 'report' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
    expect(harness.injected).toHaveLength(0)
  })

  it('fails open when the session state cannot be read', async () => {
    const harness = await create({ snapshotError: true })
    harness.turnStart()
    await harness.checkpoint(plan('worker_start')).catch(() => undefined)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('refuses a stale checkpoint whose remedy is still outstanding', async () => {
    const harness = await create()
    await checkpointed(harness, 'worker_start')
    for (let step = 0; step < 40; step += 1) await harness.preStep()
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('Before the close')
  })

  it('matches a relative target against an absolute destination and the reverse', async () => {
    const harness = await create()
    const absolute = join(harness.workspace, 'src', 'a.ts')
    await checkpointed(harness, 'lead_action', ['src/a.ts'])
    call(harness, 'edit', { file_path: absolute })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)

    harness.turnStart(2)
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src'], state: 'running' }],
      bottleneck: {
        id: 'guard-missing',
        owner: 'lane-docs',
        action: 'lead_action',
        blockingLanes: ['lane-a'],
        targets: [absolute],
      },
      next: 'execute the remedy',
    })
    call(harness, 'edit', { file_path: 'src/a.ts' })
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(0)
  })

  it('keeps every required field inside a 200-character steer', async () => {
    const harness = await create({ config: { checkpoint: { maxMessageChars: 200 } } })
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src'], state: 'running' }],
      bottleneck: {
        id: 'guard-missing',
        owner: 'lead',
        action: 'worker_start',
        blockingLanes: ['lane-a'],
      },
      next: 'x',
    })
    await harness.turnStopping()
    const text = noticeText(harness.steers[0] as never)
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text).toContain('Before the close')
    expect(text).toContain('guard-missing')
    expect(text).toContain('worker_start')
    expect(text).toContain('lane-a')
  })

  it('resolves dot segments before matching a target', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src'])
    call(harness, 'edit', { file_path: 'src/./a.ts' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
    // An escaping destination is outside the declared directory.
    harness.turnStart(2)
    await harness.checkpoint(plan('lead_action', ['src']))
    call(harness, 'write', { file_path: 'src/../notes.md', content: 'x' })
    await harness.turnStopping(2)
    expect(harness.steers).toHaveLength(1)
  })

  it('matches an absolute declared target against the same absolute destination', async () => {
    const harness = await create()
    const target = join(harness.workspace, 'src', 'a.ts')
    await checkpointed(harness, 'lead_action', [target])
    call(harness, 'edit', { file_path: target })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('accepts the repository root as a directory target', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['.'])
    call(harness, 'edit', { file_path: 'src/a.ts' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('does not follow parent traversal out of a declared target', async () => {
    const harness = await create()
    await checkpointed(harness, 'lead_action', ['src'])
    call(harness, 'write', { file_path: 'src/../../src/a.ts', content: 'x' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('exempts a done checkpoint that still carries a bottleneck', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'done',
      lanes: [{ id: 'lane-a', owner: 'lead', scope: ['src'], state: 'running' }],
      bottleneck: {
        id: 'guard-missing',
        owner: 'lead',
        action: 'worker_start',
        blockingLanes: ['lane-a'],
      },
      next: 'report',
    })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
    expect(harness.injected).toHaveLength(0)
  })

  it('refuses the continue form of the same plan', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(plan('worker_start'))
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('reaches the shared UNCHECKED cap instead of looping', async () => {
    const harness = await create()
    await checkpointed(harness, 'worker_start')
    for (let attempt = 0; attempt < 4; attempt += 1) await harness.turnStopping()
    expect(harness.steers).toHaveLength(3)
    expect(harness.injected).toHaveLength(1)
    expect(noticeText(harness.injected[0] as never)).toContain('UNCHECKED')
    expect(noticeText(harness.injected[0] as never)).toContain('guard-missing')
  })
})
