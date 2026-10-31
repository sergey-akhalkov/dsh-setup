import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointHarness, type CheckpointHarnessOptions } from './checkpoint-harness.js'
import { noticeText } from './harness.js'

/**
 * The substantial-pause trigger and the bounded checkpoint request. Detection
 * reads the session's committed tool results; the request is a non-waking steer
 * attributed to goal-continuity.
 */

const SERIAL = {
  outcome: 'continue',
  parallel: false,
  serialReason: 'the remaining work is one ordered edit',
  next: 'finish the edit',
}

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

function addWorkingCalls(harness: CheckpointHarness, write = true): void {
  const calls = [
    ['read', { file_path: 'src/a.ts' }, false, 'ok'],
    ...(write
      ? ([
          ['edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }, false, 'ok'],
        ] as const)
      : []),
    ['pwsh', { command: 'pnpm test' }, false, 'ok'],
    ['read', { file_path: 'src/missing.ts' }, true, 'ENOENT'],
  ] as const
  for (const [name, args, isError, text] of calls) {
    const callId = harness.toolCall(name, args)
    harness.toolResult(callId, text, isError)
  }
}

function workingTurn(harness: CheckpointHarness, write = true): void {
  harness.turnStart()
  addWorkingCalls(harness, write)
}

describe('substantial-pause trigger', () => {
  it('requires one checkpoint for a working turn', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('requires no checkpoint for a read-only turn', async () => {
    const harness = await create()
    harness.turnStart()
    for (const path of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
      const call = harness.toolCall('read', { file_path: path })
      harness.toolResult(call, 'ok')
    }
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('requires one checkpoint for a read-only turn when writes are not required', async () => {
    const harness = await create({ config: { checkpoint: { requireWrite: false } } })
    harness.turnStart()
    for (const path of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
      const call = harness.toolCall('read', { file_path: path })
      harness.toolResult(call, 'ok')
    }
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('requires no checkpoint for a trivial turn', async () => {
    const harness = await create()
    harness.turnStart()
    const call = harness.toolCall('edit', { file_path: 'src/a.ts' })
    harness.toolResult(call, 'ok')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('requires one checkpoint when a worker start replaces the write', async () => {
    const harness = await create()
    harness.turnStart()
    for (const path of ['a.ts', 'b.ts', 'c.ts']) {
      const call = harness.toolCall('read', { file_path: path })
      harness.toolResult(call, 'ok')
    }
    const worker = harness.toolCall('subagent', { prompt: 'take the docs lane' })
    harness.toolResult(worker, 'started')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('does not count a failed write as the required write', async () => {
    const harness = await create()
    harness.turnStart()
    for (const path of ['a.ts', 'b.ts', 'c.ts']) {
      const call = harness.toolCall('read', { file_path: path })
      harness.toolResult(call, 'ok')
    }
    const edit = harness.toolCall('edit', { file_path: 'src/a.ts' })
    harness.toolResult(edit, 'file changed', true)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('honors a non-default minToolCalls', async () => {
    const harness = await create({ config: { checkpoint: { minToolCalls: 6 } } })
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('requires no checkpoint when the last tool call asks the user', async () => {
    const harness = await create()
    workingTurn(harness)
    const question = harness.toolCall('ask_user_question', { question: 'which lane?' })
    harness.toolResult(question, 'answered')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('requires no checkpoint for a subagent turn', async () => {
    const harness = await create({
      header: { origin: 'subagent', delegationDepth: 1, parentSession: 'root-agent' },
    })
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('requires no checkpoint for an aborted turn', async () => {
    const harness = await create()
    workingTurn(harness)
    harness.turnEnd({ kind: 'aborted', reason: { kind: 'user' } })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('requires no further checkpoint after one successful call', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.turnStopping()
    await harness.checkpoint(SERIAL)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(await harness.recordNames()).toEqual(['1.json'])
  })
})

describe('checkpoint request', () => {
  it('names the tool-call count, the written paths, and worker starts', async () => {
    const harness = await create()
    workingTurn(harness)
    const worker = harness.toolCall('subagent', { prompt: 'take the docs lane' })
    harness.toolResult(worker, 'started')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain('Tool calls: 5')
    expect(text).toContain('src/a.ts')
    expect(text).toContain('Worker starts: subagent')
  })

  it('names the last shell command and its structured exit state', async () => {
    const harness = await create()
    harness.turnStart()
    addWorkingCalls(harness)
    const shell = harness.toolCall('pwsh', { command: 'pnpm check' })
    harness.toolResult(shell, '[exit code: 1]', true)
    await harness.turnStopping()
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain('Last shell: pwsh `pnpm check`')
    expect(text).toContain('Last shell exit: failed')
  })

  it('reads a nonzero exit as failed even when the result is not an error', async () => {
    const harness = await create()
    harness.turnStart()
    addWorkingCalls(harness)
    const shell = harness.toolCall('pwsh', { command: 'pnpm check' })
    harness.toolOutcome('pwsh', shell, {
      kind: 'foreground',
      exitCode: 1,
      signal: null,
      timedOut: false,
      aborted: false,
    })
    harness.toolResult(shell, 'typecheck failed', false)
    await harness.turnStopping()
    expect(noticeText(harness.steers[0] as never)).toContain('Last shell exit: failed')
  })

  it('never presents an unreadable shell result as success', async () => {
    const harness = await create()
    harness.turnStart()
    addWorkingCalls(harness)
    const shell = harness.toolCall('pwsh', { command: 'pnpm check' })
    harness.toolOutcome('pwsh', shell, undefined)
    harness.toolResult(shell, 'ok', false)
    await harness.turnStopping()
    expect(noticeText(harness.steers[0] as never)).toContain(
      'Last shell exit: exit state unreadable',
    )
  })

  it('treats malformed sandbox metadata as unreadable', async () => {
    const harness = await create()
    harness.turnStart()
    addWorkingCalls(harness)
    const shell = harness.toolCall('pwsh', { command: 'pnpm check' })
    harness.toolOutcome('pwsh', shell, {
      kind: 'foreground',
      exitCode: 0,
      signal: null,
      timedOut: false,
      aborted: false,
      sandbox: {},
    })
    harness.toolResult(shell, 'ok', false)
    await harness.turnStopping()
    expect(noticeText(harness.steers[0] as never)).toContain(
      'Last shell exit: exit state unreadable',
    )
  })

  it('names the last failed tool without its output', async () => {
    const harness = await create()
    harness.turnStart()
    for (const path of ['a.ts', 'b.ts', 'c.ts']) {
      const call = harness.toolCall('read', { file_path: path })
      harness.toolResult(call, 'ok')
    }
    const write = harness.toolCall('edit', { file_path: 'src/a.ts' })
    harness.toolResult(write, 'ok')
    const failed = harness.toolCall('grep', { pattern: 'needle' })
    harness.toolResult(failed, 'FULL FAILED OUTPUT THAT MUST NOT LEAK', true)
    await harness.turnStopping()
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain('Last failed tool: grep')
    expect(text).not.toContain('FULL FAILED OUTPUT')
  })

  it('redacts machine paths and credentials before injection', async () => {
    const harness = await create()
    harness.turnStart()
    for (const path of ['a.ts', 'b.ts']) {
      const call = harness.toolCall('read', { file_path: path })
      harness.toolResult(call, 'ok')
    }
    const machinePath = `${harness.workspace}\\src\\a.ts`
    const edit = harness.toolCall('edit', { file_path: machinePath })
    harness.toolResult(edit, 'ok')
    const shell = harness.toolCall('pwsh', { command: 'tok sk-abcdefgh12345678' })
    harness.toolResult(shell, 'ok')
    const flag = harness.toolCall('pwsh', { command: 'deploy --token EXAMPLE_SECRET_123' })
    harness.toolResult(flag, 'ok')
    await harness.turnStopping()
    const text = noticeText(harness.steers[0] as never)
    expect(text).not.toContain(harness.workspace)
    expect(text).not.toContain('sk-abcdefgh12345678')
    expect(text).not.toContain('EXAMPLE_SECRET_123')
    expect(text).toContain('[redacted]')
  })

  it('stays within maxMessageChars and keeps the questions', async () => {
    const harness = await create({ config: { checkpoint: { maxMessageChars: 200 } } })
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0] as never)
    expect(text.length).toBeLessThanOrEqual(200)
    expect(text).toContain('work_checkpoint:')
    expect(text).toContain('Done? verified? remaining? parallel lanes? next?')
  })

  it('is attributed to goal-continuity and is a non-waking steer', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers[0]?.source.kind).toBe('goal-continuity')
    const source = harness.steers[0]?.source as { form?: string } | undefined
    expect(source?.form).toBe('notice')
    expect(harness.injected).toHaveLength(0)
  })
})
