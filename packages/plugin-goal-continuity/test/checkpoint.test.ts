import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointHarness, type CheckpointHarnessOptions } from './checkpoint-harness.js'
import { noticeText } from './harness.js'

/**
 * The work_checkpoint tool, its local record, the close gate, and the
 * parallel-action gate. The plugin runs in a real Cordis context; the session
 * log, the tool registry, and the clock are fakes.
 */

const ID_PATTERN = /^checkpoint-\d+-[a-f0-9]{8}$/u
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

describe('work_checkpoint tool', () => {
  it('records a done decision and returns the id and the record path', async () => {
    const harness = await create()
    harness.turnStart()
    const result = await harness.checkpoint({
      outcome: 'done',
      verified: ['the focused tests pass'],
      remaining: [],
      next: 'report the result',
    })
    expect(result.text).toMatch(/checkpoint-\d+-[a-f0-9]{8}/u)
    expect(result.text).toContain('.dsh/work-checkpoints/')
    const record = await harness.readRecord()
    expect(record).toMatchObject({
      version: 1,
      turn: 1,
      outcome: 'done',
      parallel: false,
      verified: ['the focused tests pass'],
      next: 'report the result',
    })
    expect(record.session).toBe(harness.sessionId)
    expect(typeof record.time).toBe('string')
    expect(record.checkpoint).toMatch(ID_PATTERN)
  })

  it('accepts continue with a serial reason and stores it', async () => {
    const harness = await create()
    harness.turnStart()
    const result = await harness.checkpoint(SERIAL)
    expect(result.text).toContain('continue; serial')
    const record = await harness.readRecord()
    expect(record).toMatchObject({
      outcome: 'continue',
      parallel: false,
      serialReason: SERIAL.serialReason,
    })
  })

  it('accepts a parallel continuation without a serial reason', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint({ outcome: 'continue', parallel: true, next: 'start the lanes' })
    expect(await harness.readRecord()).toMatchObject({ outcome: 'continue', parallel: true })
  })

  it('rejects an unknown field with a field diagnostic', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', extra: true }),
    ).rejects.toThrow(/unknown field "extra"/u)
  })

  it('rejects an unknown outcome with a field diagnostic', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', { outcome: 'stop', next: 'x' }),
    ).rejects.toThrow(/work_checkpoint\.outcome/u)
  })

  it('rejects a missing next action with a field diagnostic', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(harness.execute('work_checkpoint', { outcome: 'done' })).rejects.toThrow(
      /work_checkpoint\.next/u,
    )
  })

  it('rejects continue + parallel false without a serial reason', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', { outcome: 'continue', parallel: false, next: 'x' }),
    ).rejects.toThrow(/serialReason/u)
  })

  it('rejects an empty serial reason and a mistyped parallel flag', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'continue',
        parallel: false,
        serialReason: '   ',
        next: 'x',
      }),
    ).rejects.toThrow(/work_checkpoint\.serialReason/u)
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', parallel: 'yes', next: 'x' }),
    ).rejects.toThrow(/work_checkpoint\.parallel/u)
  })

  it('rejects a malformed verified list', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', verified: 'one fact' }),
    ).rejects.toThrow(/work_checkpoint\.verified/u)
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'done',
        next: 'x',
        verified: Array.from({ length: 9 }, () => 'fact'),
      }),
    ).rejects.toThrow(/work_checkpoint\.verified/u)
  })

  it('rejects non-object arguments and non-string list members', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(harness.execute('work_checkpoint', 'nope')).rejects.toThrow(
      /arguments must be an object/u,
    )
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', verified: ['ok', 7] }),
    ).rejects.toThrow(/work_checkpoint\.verified/u)
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', remaining: ['   '] }),
    ).rejects.toThrow(/work_checkpoint\.remaining/u)
  })

  it('a failed validation call does not satisfy the close gate', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.failedCheckpoint({ outcome: 'continue', parallel: false, next: 'x' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })
})

describe('work checkpoint record', () => {
  it('writes under the hashed session directory and turn file', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint({ outcome: 'done', next: 'finish' })
    const sessionKey = createHash('sha256').update(harness.sessionId).digest('hex').slice(0, 16)
    expect(harness.recordPath()).toBe(
      join(harness.workspace, '.dsh', 'work-checkpoints', sessionKey, '1.json'),
    )
    expect(await harness.recordNames()).toEqual(['1.json'])
  })

  it('bounds every free-text field', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'done',
      next: 'x'.repeat(2000),
      verified: ['y'.repeat(2000)],
      speedup: 'z'.repeat(2000),
    })
    const record = await harness.readRecord()
    expect(String(record.next).length).toBeLessThanOrEqual(400)
    expect((record.verified as string[])[0]?.length).toBeLessThanOrEqual(240)
    expect(String(record.speedup).length).toBeLessThanOrEqual(240)
  })

  it('redacts machine paths and obvious credentials', async () => {
    const harness = await create()
    harness.turnStart()
    const machinePath = join(harness.workspace, 'private', 'notes.txt')
    await harness.checkpoint({
      outcome: 'done',
      next: `finish with sk-abcdefgh12345678 at ${machinePath}`,
      verified: [`read ${machinePath}`],
    })
    const text = JSON.stringify(await harness.readRecord())
    expect(text).not.toContain('sk-abcdefgh12345678')
    expect(text).not.toContain(harness.workspace)
    expect(text).toContain('[redacted]')
  })

  it('bounds and redacts the persisted session while the path hashes the original', async () => {
    const harness = await create()
    const sensitive = `${harness.workspace}\\private sk-abcdefgh12345678 ${'y'.repeat(300)}`
    harness.resetSessionId(sensitive)
    harness.turnStart()
    await harness.checkpoint({ outcome: 'done', next: 'report' })
    const record = await harness.readRecord()
    const persisted = String(record.session)
    expect(persisted.length).toBeLessThanOrEqual(240)
    expect(persisted).not.toContain('sk-abcdefgh12345678')
    expect(persisted).not.toContain(harness.workspace)
    expect(persisted).toContain('[redacted]')
    // The record path still hashes the original id.
    const sessionKey = createHash('sha256').update(sensitive).digest('hex').slice(0, 16)
    expect(harness.recordPath()).toContain(sessionKey)
  })

  it('reuses the same record for a repeated call in the turn', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint({ outcome: 'continue', parallel: true, next: 'fan out' })
    const id = (await harness.readRecord()).checkpoint
    const second = await harness.checkpoint({
      outcome: 'continue',
      parallel: false,
      serialReason: 'the lanes are ordered',
      next: 'finish serially',
    })
    expect(second.text).toContain(String(id))
    const record = await harness.readRecord()
    expect(record.next).toBe('finish serially')
    expect(record.parallel).toBe(false)
    expect(record.checkpoint).toBe(id)
    expect(await harness.recordNames()).toEqual(['1.json'])
  })

  it('returns the summary without claiming a record when the write fails', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.blockSessionDirectory()
    const result = await harness.checkpoint({ outcome: 'done', next: 'finish' })
    expect(result.text).toContain('could not write')
    expect(result.text).not.toContain('recorded at')
    expect(result.text).toMatch(/checkpoint-\d+-[a-f0-9]{8}/u)
    expect(await harness.tryReadRecord()).toBeUndefined()
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })
})

describe('close gate', () => {
  it('refuses the close and steers the checkpoint request', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain('Work checkpoint required')
    expect(text).toContain('Tool calls: 4')
    expect(harness.steers[0]?.source.kind).toBe('goal-continuity')
    expect(harness.injected).toHaveLength(0)
  })

  it('allows the close once a successful checkpoint exists', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.turnStopping()
    await harness.checkpoint(SERIAL)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('allows the close UNCHECKED after maxBlocks refusals', async () => {
    const harness = await create()
    workingTurn(harness)
    for (let attempt = 0; attempt < 4; attempt += 1) await harness.turnStopping()
    expect(harness.steers).toHaveLength(3)
    expect(harness.injected).toHaveLength(1)
    const notice = noticeText(harness.injected[0] as never)
    expect(notice).toContain('UNCHECKED')
    expect(notice).toContain('not a pass')
    await harness.turnStopping()
    expect(harness.injected).toHaveLength(1)
  })

  it('fails open when the session state cannot be read', async () => {
    const harness = await create({ snapshotError: true })
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
    expect(harness.injected).toHaveLength(0)
  })

  it('does not evaluate a subagent turn', async () => {
    const harness = await create({
      header: { origin: 'subagent', delegationDepth: 1, parentSession: 'root-agent' },
    })
    workingTurn(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('registers no tool and gates nothing when checkpoint.enabled is false', async () => {
    const harness = await create({ config: { checkpoint: { enabled: false } } })
    workingTurn(harness)
    expect(harness.tools.has('work_checkpoint')).toBe(false)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
    expect(harness.injected).toHaveLength(0)
  })

  it('does not trigger for a trivial turn', async () => {
    const harness = await create()
    harness.turnStart()
    const call = harness.toolCall('edit', { file_path: 'src/a.ts' })
    harness.toolResult(call, 'ok')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('does not trigger for a read-only turn', async () => {
    const harness = await create()
    harness.turnStart()
    for (const path of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
      const call = harness.toolCall('read', { file_path: path })
      harness.toolResult(call, 'ok')
    }
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('triggers for a read-only turn when writes are not required', async () => {
    const harness = await create({ config: { checkpoint: { requireWrite: false } } })
    harness.turnStart()
    for (const path of ['a.ts', 'b.ts', 'c.ts', 'd.ts']) {
      const call = harness.toolCall('read', { file_path: path })
      harness.toolResult(call, 'ok')
    }
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('does not trigger when the last tool call asks the user', async () => {
    const harness = await create()
    workingTurn(harness)
    const question = harness.toolCall('ask_user_question', { question: 'which lane?' })
    harness.toolResult(question, 'answered')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('does not trigger for an aborted turn', async () => {
    const harness = await create()
    workingTurn(harness)
    harness.turnEnd({ kind: 'aborted', reason: { kind: 'user' } })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })
})

describe('parallel-action gate', () => {
  async function parallelCheckpoint(harness: CheckpointHarness): Promise<string> {
    harness.turnStart()
    await harness.checkpoint({ outcome: 'continue', parallel: true, next: 'start the lanes' })
    return String((await harness.readRecord()).checkpoint)
  }

  it('passes after a successful worker start that contains the id', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    const id = await parallelCheckpoint(harness)
    const call = harness.toolCall('subagent', { prompt: `take lane one for ${id}` })
    harness.toolResult(call, 'started')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('passes after a serial amendment', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    await parallelCheckpoint(harness)
    await harness.checkpoint(SERIAL)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('does not accept a failed worker start', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    const id = await parallelCheckpoint(harness)
    const call = harness.toolCall('subagent', { prompt: `take lane one for ${id}` })
    harness.toolResult(call, 'the worker failed', true)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain(id)
  })

  it('does not accept an untagged worker start', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    const id = await parallelCheckpoint(harness)
    const call = harness.toolCall('subagent', { prompt: 'take a lane' })
    harness.toolResult(call, 'started')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain(id)
  })

  it('does not accept a worker start before the checkpoint, even when it is tagged', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    const id = `checkpoint-1-${createHash('sha256')
      .update(`${harness.sessionId}:1`)
      .digest('hex')
      .slice(0, 8)}`
    const early = harness.toolCall('subagent', { prompt: `take lane one for ${id}` })
    harness.toolResult(early, 'started')
    await harness.checkpoint({ outcome: 'continue', parallel: true, next: 'start the lanes' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain(id)
  })

  it('steers with the id on each unsatisfied close below the cap', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    const id = await parallelCheckpoint(harness)
    await harness.turnStopping()
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(2)
    for (const message of harness.steers) expect(noticeText(message)).toContain(id)
  })

  it('allows the close UNCHECKED at the shared cap', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    const id = await parallelCheckpoint(harness)
    for (let attempt = 0; attempt < 4; attempt += 1) await harness.turnStopping()
    expect(harness.steers).toHaveLength(3)
    expect(harness.injected).toHaveLength(1)
    const notice = noticeText(harness.injected[0] as never)
    expect(notice).toContain('UNCHECKED')
    expect(notice).toContain(id)
  })

  it('shares one refusal budget across the checkpoint and parallel gates', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    addWorkingCalls(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('work_checkpoint:')
    // The model records a parallel checkpoint; the parallel gate now refuses
    // from the same per-turn budget.
    const id = String(
      (
        await harness.checkpoint({
          outcome: 'continue',
          parallel: true,
          next: 'start the lanes',
        })
      ).text.match(/checkpoint-\d+-[0-9a-f]{8}/u)?.[0],
    )
    await harness.turnStopping()
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(3)
    expect(noticeText(harness.steers[1] as never)).toContain(id)
    expect(noticeText(harness.steers[2] as never)).toContain(id)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(3)
    expect(harness.injected).toHaveLength(1)
    expect(noticeText(harness.injected[0] as never)).toContain('UNCHECKED')
  })

  it('reports nothing when no worker-start tool is registered', async () => {
    const harness = await create()
    await parallelCheckpoint(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
    expect(harness.injected).toHaveLength(0)
  })

  it('reports nothing for a done outcome', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    await harness.checkpoint({ outcome: 'done', parallel: true, next: 'report' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('reports nothing when enforceParallel is false', async () => {
    const harness = await create({
      availableTools: ['subagent'],
      config: { checkpoint: { enforceParallel: false } },
    })
    await parallelCheckpoint(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })
})
