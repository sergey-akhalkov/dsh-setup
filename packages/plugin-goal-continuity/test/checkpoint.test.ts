import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointHarness, type CheckpointHarnessOptions } from './checkpoint-harness.js'
import { noticeText } from './harness.js'

/**
 * The work_checkpoint tool, its local record, the close gate, and the
 * parallel-action gate. The plugin runs in a real Cordis context; the session
 * log, the tool registry, and the clock are fakes.
 */

const ID_PATTERN = /checkpoint-\d+-[a-f0-9]{8}/u

/** One serial plan whose declared remedy is one lead edit. */
const SERIAL = {
  outcome: 'continue',
  lanes: [{ id: 'edit', owner: 'lead', scope: ['src/a.ts'], state: 'running' }],
  bottleneck: {
    id: 'guard-missing',
    owner: 'lead',
    action: 'lead_action',
    blockingLanes: ['edit'],
    targets: ['src/a.ts'],
  },
  next: 'finish the edit',
}

/** Two runnable lanes with different owners and disjoint scopes. */
const PARALLEL = {
  outcome: 'continue',
  lanes: [
    { id: 'host', owner: 'lead', scope: ['packages/host'], state: 'running' },
    { id: 'docs', owner: 'lane-docs', scope: ['docs'], state: 'running' },
  ],
  bottleneck: {
    id: 'split',
    owner: 'lead',
    action: 'lead_action',
    blockingLanes: ['host'],
    targets: ['src/a.ts'],
  },
  next: 'dispatch the docs lane',
}

/** The same parallel plan, with the worker start as its declared remedy. */
const PARALLEL_WORKER = {
  ...PARALLEL,
  bottleneck: {
    id: 'split',
    owner: 'lead',
    action: 'worker_start',
    blockingLanes: ['host'],
  },
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

/** Execute the declared `lead_action` remedy of SERIAL. */
function remedy(harness: CheckpointHarness): void {
  const call = harness.toolCall('edit', { file_path: 'src/a.ts' })
  harness.toolResult(call, 'ok')
}

describe('work_checkpoint tool', () => {
  it('records a done decision and returns the id and the record path', async () => {
    const harness = await create()
    harness.turnStart()
    const result = await harness.checkpoint({
      outcome: 'done',
      verified: ['the focused tests pass'],
      next: 'report the result',
    })
    expect(result.text).toMatch(ID_PATTERN)
    expect(result.text).toContain('.dsh/work-checkpoints/')
    const record = await harness.readRecord()
    expect(record).toMatchObject({
      version: 2,
      turn: 1,
      outcome: 'done',
      verified: ['the focused tests pass'],
      lanes: [],
      derivedRemaining: [],
      parallelComputed: false,
      next: 'report the result',
    })
    expect(record.session).toBe(harness.sessionId)
    expect(typeof record.time).toBe('string')
    expect(record.checkpoint).toMatch(ID_PATTERN)
    expect(record.bottleneck).toBeUndefined()
  })

  it('records a lane plan, the bottleneck, and the derived remainder', async () => {
    const harness = await create()
    harness.turnStart()
    const result = await harness.checkpoint({
      outcome: 'continue',
      lanes: [
        { id: 'guard', owner: 'lead', scope: ['src/parser.ts'], state: 'done' },
        {
          id: 'test',
          owner: 'lead',
          scope: ['test/parser.test.ts'],
          state: 'running',
          blockedBy: ['guard'],
        },
      ],
      bottleneck: {
        id: 'test-missing',
        owner: 'lead',
        action: 'lead_action',
        blockingLanes: ['test'],
        targets: ['test/parser.test.ts'],
      },
      next: 'write the regression test',
    })
    expect(result.text).toContain('2 lanes, 1 remaining')
    expect(result.text).toContain('test-missing')
    const record = await harness.readRecord()
    expect(record.derivedRemaining).toEqual(['test'])
    expect(record.parallelComputed).toBe(false)
    expect(record.bottleneckAge).toBe(1)
    expect(record.lanes).toHaveLength(2)
  })

  it('rejects continue without a lane plan', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'continue',
        bottleneck: { id: 'b', owner: 'lead', action: 'user_decision' },
        next: 'x',
      }),
    ).rejects.toThrow(/work_checkpoint\.lanes is required/u)
  })

  it('rejects continue without a bottleneck', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'continue',
        lanes: [{ id: 'one', owner: 'lead', scope: ['src'], state: 'running' }],
        next: 'x',
      }),
    ).rejects.toThrow(/work_checkpoint\.bottleneck is required/u)
  })

  it('rejects a duplicate lane id', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'done',
        lanes: [
          { id: 'same', owner: 'lead', scope: ['src'], state: 'running' },
          { id: 'same', owner: 'lead', scope: ['docs'], state: 'running' },
        ],
        next: 'x',
      }),
    ).rejects.toThrow(/duplicate id "same"/u)
  })

  it('rejects an unknown blockedBy lane id', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'done',
        lanes: [
          { id: 'one', owner: 'lead', scope: ['src'], state: 'blocked', blockedBy: ['gone'] },
        ],
        next: 'x',
      }),
    ).rejects.toThrow(/blockedBy names unknown lane "gone"/u)
  })

  it('rejects an empty scope', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'done',
        lanes: [{ id: 'one', owner: 'lead', scope: [], state: 'running' }],
        next: 'x',
      }),
    ).rejects.toThrow(/scope must list at least one owned path or resource/u)
  })

  it('rejects a plan over the lane bound', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'done',
        lanes: Array.from({ length: 9 }, (_, index) => ({
          id: `lane-${index}`,
          owner: 'lead',
          scope: [`src/${index}`],
          state: 'running',
        })),
        next: 'x',
      }),
    ).rejects.toThrow(/at most 8 lanes/u)
  })

  it('rejects an unknown lane state', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'done',
        lanes: [{ id: 'one', owner: 'lead', scope: ['src'], state: 'paused' }],
        next: 'x',
      }),
    ).rejects.toThrow(/lane/u)
  })

  it('rejects an unknown field, an unknown outcome, and a missing next action', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', extra: true }),
    ).rejects.toThrow(/unknown field "extra"/u)
    await expect(
      harness.execute('work_checkpoint', { outcome: 'stop', next: 'x' }),
    ).rejects.toThrow(/work_checkpoint\.outcome/u)
    await expect(harness.execute('work_checkpoint', { outcome: 'done' })).rejects.toThrow(
      /work_checkpoint\.next/u,
    )
  })

  it('rejects each removed field and names its replacement', async () => {
    const harness = await create()
    harness.turnStart()
    const removed = ['parallel', 'serialReason', 'remaining', 'speedup'] as const
    for (const field of removed) {
      await expect(
        harness.execute('work_checkpoint', { outcome: 'done', next: 'x', [field]: 'old' }),
      ).rejects.toThrow(new RegExp(`work_checkpoint\\.${field} was removed`, 'u'))
    }
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', parallel: false }),
    ).rejects.toThrow(/work_checkpoint\.lanes/u)
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', serialReason: 'why' }),
    ).rejects.toThrow(/work_checkpoint\.lanes/u)
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', remaining: ['one'] }),
    ).rejects.toThrow(/work_checkpoint\.lanes/u)
    await expect(
      harness.execute('work_checkpoint', { outcome: 'done', next: 'x', speedup: 'faster' }),
    ).rejects.toThrow(/work_checkpoint\.next/u)
  })

  it('rejects a continuation that carries a serial reason and no plan', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'continue',
        parallel: false,
        serialReason: 'one ordered edit',
        next: 'x',
      }),
    ).rejects.toThrow(/work_checkpoint\.parallel was removed;.*work_checkpoint\.lanes/u)
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
      harness.execute('work_checkpoint', {
        outcome: 'done',
        next: 'x',
        lanes: [{ id: 'one', owner: '   ', scope: ['src'], state: 'running' }],
      }),
    ).rejects.toThrow(/lanes\[0\]\.owner/u)
  })

  it('rejects a lead_action bottleneck without a target', async () => {
    const harness = await create()
    harness.turnStart()
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'continue',
        lanes: [{ id: 'one', owner: 'lead', scope: ['src'], state: 'running' }],
        bottleneck: { id: 'b', owner: 'lead', action: 'lead_action' },
        next: 'x',
      }),
    ).rejects.toThrow(/bottleneck\.targets/u)
  })

  it('a failed validation call does not satisfy the close gate', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.failedCheckpoint({ outcome: 'continue', next: 'x' })
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
      outcome: 'continue',
      next: 'x'.repeat(2000),
      verified: ['y'.repeat(2000)],
      lanes: [
        {
          id: 'i'.repeat(2000),
          owner: 'o'.repeat(2000),
          scope: ['s'.repeat(2000)],
          state: 'running',
        },
      ],
      bottleneck: {
        id: 'b'.repeat(2000),
        owner: 'n'.repeat(2000),
        action: 'lead_action',
        targets: ['t'.repeat(2000)],
      },
    })
    const record = await harness.readRecord()
    expect(String(record.next).length).toBeLessThanOrEqual(400)
    expect((record.verified as string[])[0]?.length).toBeLessThanOrEqual(240)
    const lanes = record.lanes as { id: string; owner: string; scope: string[] }[]
    expect(lanes[0]?.id.length).toBeLessThanOrEqual(120)
    expect(lanes[0]?.owner.length).toBeLessThanOrEqual(120)
    expect(lanes[0]?.scope[0]?.length).toBeLessThanOrEqual(120)
    const bottleneck = record.bottleneck as { id: string; owner: string; targets: string[] }
    expect(bottleneck.id.length).toBeLessThanOrEqual(120)
    expect(bottleneck.owner.length).toBeLessThanOrEqual(120)
    expect(bottleneck.targets[0]?.length).toBeLessThanOrEqual(120)
  })

  it('redacts machine paths and obvious credentials', async () => {
    const harness = await create()
    harness.turnStart()
    const machinePath = join(harness.workspace, 'private', 'notes.txt')
    await harness.checkpoint({
      outcome: 'continue',
      next: `finish with sk-abcdefgh12345678 at ${machinePath}`,
      verified: [`read ${machinePath}`],
      lanes: [
        { id: 'lane-a', owner: 'lead', scope: [machinePath], state: 'running' },
        { id: 'lane-b', owner: 'sk-abcdefgh12345678', scope: ['docs'], state: 'running' },
      ],
      bottleneck: {
        id: 'sk-abcdefgh12345678',
        owner: 'lead',
        action: 'lead_action',
        targets: [machinePath],
      },
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
    await harness.checkpoint(PARALLEL)
    const id = (await harness.readRecord()).checkpoint
    expect((await harness.readRecord()).parallelComputed).toBe(true)
    const second = await harness.checkpoint(SERIAL)
    expect(second.text).toContain(String(id))
    const record = await harness.readRecord()
    expect(record.next).toBe('finish the edit')
    expect(record.parallelComputed).toBe(false)
    expect(record.derivedRemaining).toEqual(['edit'])
    expect(record.checkpoint).toBe(id)
    expect(await harness.recordNames()).toEqual(['1.json'])
  })

  it('reads a legacy v1 record and writes v2 on the next checkpoint', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(SERIAL)
    // Replace the record with a v1 shape a previous plugin version wrote.
    const path = harness.recordPath(1)
    const legacy = {
      version: 1,
      checkpoint: 'checkpoint-1-00000000',
      turn: 1,
      outcome: 'continue',
      verified: [],
      remaining: ['one'],
      parallel: false,
      serialReason: 'one ordered edit',
      bottleneck: 'the guard must exist',
      next: 'finish',
      time: new Date().toISOString(),
      session: harness.sessionId,
    }
    await writeFile(path, `${JSON.stringify(legacy)}\n`, 'utf8')
    harness.turnStart(2)
    await harness.checkpoint(SERIAL)
    const record = await harness.readRecord(2)
    expect(record.version).toBe(2)
    // A legacy record without the object is not a plan and never ages the count.
    expect(record.bottleneckAge).toBe(1)
  })

  it('writes the documented record example', async () => {
    const harness = await create()
    harness.turnStart(3)
    await harness.checkpoint({
      outcome: 'continue',
      verified: ['the parser test fails on the empty input'],
      lanes: [
        { id: 'guard', owner: 'lead', scope: ['src/parser.ts'], state: 'done' },
        {
          id: 'test',
          owner: 'lead',
          scope: ['test/parser.test.ts'],
          state: 'running',
          blockedBy: ['guard'],
        },
      ],
      bottleneck: {
        id: 'test-missing',
        owner: 'lead',
        action: 'lead_action',
        blockingLanes: ['test'],
        targets: ['test/parser.test.ts'],
      },
      next: 'write the regression test',
    })
    const record = await harness.readRecord(3)
    const { checkpoint, time, session, ...decision } = record
    expect(checkpoint).toMatch(/^checkpoint-3-[a-f0-9]{8}$/u)
    expect(typeof time).toBe('string')
    expect(session).toBe(harness.sessionId)
    expect(decision).toEqual({
      version: 2,
      turn: 3,
      outcome: 'continue',
      verified: ['the parser test fails on the empty input'],
      lanes: [
        { id: 'guard', owner: 'lead', scope: ['src/parser.ts'], state: 'done', blockedBy: [] },
        {
          id: 'test',
          owner: 'lead',
          scope: ['test/parser.test.ts'],
          state: 'running',
          blockedBy: ['guard'],
        },
      ],
      laneAges: [
        { id: 'guard', checkpoints: 1 },
        { id: 'test', checkpoints: 1 },
      ],
      bottleneck: {
        id: 'test-missing',
        owner: 'lead',
        action: 'lead_action',
        blockingLanes: ['test'],
        targets: ['test/parser.test.ts'],
      },
      bottleneckKey: 'fdc2f0da6ab1499a',
      bottleneckChanged: false,
      derivedRemaining: ['test'],
      parallelComputed: false,
      bottleneckAge: 1,
      next: 'write the regression test',
    })
  })

  it('rejects two lane ids that collide after the record bounds them', async () => {
    const harness = await create()
    harness.turnStart()
    const prefix = 'i'.repeat(200)
    await expect(
      harness.execute('work_checkpoint', {
        outcome: 'done',
        lanes: [
          { id: `${prefix}-one`, owner: 'lead', scope: ['src'], state: 'running' },
          { id: `${prefix}-two`, owner: 'lead', scope: ['src2'], state: 'running' },
        ],
        next: 'x',
      }),
    ).rejects.toThrow(/collide after redaction/u)
  })

  it('returns the summary without claiming a record when the write fails', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.blockSessionDirectory()
    const result = await harness.checkpoint({ outcome: 'done', next: 'finish' })
    expect(result.text).toContain('could not write')
    expect(result.text).not.toContain('recorded at')
    expect(result.text).toMatch(ID_PATTERN)
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

  it('allows the close once a successful checkpoint and its remedy exist', async () => {
    const harness = await create()
    workingTurn(harness)
    await harness.turnStopping()
    await harness.checkpoint(SERIAL)
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
  })

  it('accepts a checkpoint recorded two steps before the close', async () => {
    const harness = await create({ config: { checkpoint: { stepInterval: 10 } } })
    workingTurn(harness)
    await harness.preStep()
    await harness.preStep()
    await harness.checkpoint(SERIAL)
    remedy(harness)
    await harness.preStep()
    await harness.preStep()
    await harness.preStep()
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('refuses the close when the latest checkpoint is stale', async () => {
    const harness = await create({ config: { checkpoint: { stepInterval: 10 } } })
    workingTurn(harness)
    await harness.preStep()
    await harness.preStep()
    await harness.checkpoint(SERIAL)
    remedy(harness)
    for (let step = 0; step < 10; step += 1) await harness.preStep()
    // The interval also steered once; the close still refuses the stale checkpoint.
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(2)
    expect(noticeText(harness.steers.at(-1) as never)).toContain('Work checkpoint required')
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
  async function parallelCheckpoint(
    harness: CheckpointHarness,
    plan: unknown = PARALLEL_WORKER,
  ): Promise<string> {
    harness.turnStart()
    await harness.checkpoint(plan)
    return String((await harness.readRecord()).checkpoint)
  }

  it('computes parallel work and refuses the close without a tagged worker', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    const id = await parallelCheckpoint(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    const text = noticeText(harness.steers[0] as never)
    expect(text).toContain(id)
    expect(text).toContain('computes parallel lanes')
  })

  it('passes after a successful worker start that contains the id', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    const id = await parallelCheckpoint(harness)
    const call = harness.toolCall('subagent', { prompt: `take lane one for ${id}` })
    harness.toolResult(call, 'started')
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  for (const tool of ['subagent', 'subagent_fork', 'spawn_teammate', 'workflow', 'delegate']) {
    it(`passes the parallel gate after a tagged ${tool} start`, async () => {
      const harness = await create({ availableTools: [tool] })
      const id = await parallelCheckpoint(harness)
      const call = harness.toolCall(tool, { prompt: `take lane one for ${id}` })
      harness.toolResult(call, 'started')
      await harness.turnStopping()
      expect(harness.steers).toHaveLength(0)
    })
  }

  it('passes after an amendment that leaves one runnable lane', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    await parallelCheckpoint(harness)
    await harness.checkpoint({
      ...SERIAL,
      bottleneck: { ...SERIAL.bottleneck, owner: 'lane-docs' },
    })
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('treats a shared scope as serial', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [
        { id: 'one', owner: 'lead', scope: ['src/shared.ts'], state: 'running' },
        { id: 'two', owner: 'lane-two', scope: ['src/shared.ts'], state: 'running' },
      ],
      bottleneck: {
        id: 'shared',
        owner: 'lead',
        action: 'lead_action',
        targets: ['src/a.ts'],
      },
      next: 'edit the shared file',
    })
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('treats one owner as serial', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [
        { id: 'one', owner: 'lead', scope: ['src/one.ts'], state: 'running' },
        { id: 'two', owner: 'lead', scope: ['src/two.ts'], state: 'running' },
      ],
      bottleneck: { id: 'same-owner', owner: 'lead', action: 'lead_action', targets: ['src/a.ts'] },
      next: 'edit one file',
    })
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('treats a textual sibling scope as disjoint', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [
        { id: 'one', owner: 'lead', scope: ['src'], state: 'running' },
        { id: 'two', owner: 'lane-two', scope: ['src2'], state: 'running' },
      ],
      bottleneck: { id: 'sibling', owner: 'lead', action: 'lead_action', targets: ['src/a.ts'] },
      next: 'fan out',
    })
    expect((await harness.readRecord()).parallelComputed).toBe(true)
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('computes parallel lanes')
  })

  it('does not count a blocked lane as runnable', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [
        { id: 'one', owner: 'lead', scope: ['src/one.ts'], state: 'blocked' },
        { id: 'two', owner: 'lane-two', scope: ['docs'], state: 'running' },
      ],
      bottleneck: { id: 'blocked', owner: 'lead', action: 'lead_action', targets: ['src/a.ts'] },
      next: 'unblock the lane',
    })
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('counts a lane whose blocking dependency is done as runnable', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [
        { id: 'first', owner: 'lead', scope: ['src/first.ts'], state: 'done' },
        {
          id: 'second',
          owner: 'lead',
          scope: ['src/second.ts'],
          state: 'running',
          blockedBy: ['first'],
        },
        { id: 'third', owner: 'lane-three', scope: ['docs'], state: 'running' },
      ],
      bottleneck: { id: 'pair', owner: 'lead', action: 'lead_action', targets: ['src/a.ts'] },
      next: 'dispatch',
    })
    expect((await harness.readRecord()).parallelComputed).toBe(true)
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(1)
    expect(noticeText(harness.steers[0] as never)).toContain('computes parallel lanes')
  })

  it('does not count a lane whose blocking dependency is unfinished', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    await harness.checkpoint({
      outcome: 'continue',
      lanes: [
        {
          id: 'blocked',
          owner: 'lead',
          scope: ['src/blocked.ts'],
          state: 'running',
          blockedBy: ['dep'],
        },
        { id: 'dep', owner: 'lane-dep', scope: ['src/dep.ts'], state: 'running' },
      ],
      bottleneck: { id: 'dep', owner: 'lead', action: 'lead_action', targets: ['src/a.ts'] },
      next: 'wait for the dependency',
    })
    expect((await harness.readRecord()).parallelComputed).toBe(false)
    remedy(harness)
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
    await harness.checkpoint(PARALLEL_WORKER)
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
      (await harness.checkpoint(PARALLEL_WORKER)).text.match(/checkpoint-\d+-[0-9a-f]{8}/u)?.[0],
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
    await parallelCheckpoint(harness, PARALLEL)
    // The parallel gate reports nothing; the declared lead remedy is executed.
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
    expect(harness.injected).toHaveLength(0)
  })

  it('reports nothing for a done outcome', async () => {
    const harness = await create({ availableTools: ['subagent'] })
    harness.turnStart()
    await harness.checkpoint({ outcome: 'done', next: 'report' })
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('does not compute parallel work when enforceParallel is false', async () => {
    const harness = await create({
      availableTools: ['subagent'],
      config: { checkpoint: { enforceParallel: false } },
    })
    await parallelCheckpoint(harness, PARALLEL)
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })
})

describe('scope comparison', () => {
  /** One continue plan over two lanes that resolve to the given scopes. */
  function twoLanes(left: string, right: string): Record<string, unknown> {
    return {
      outcome: 'continue',
      lanes: [
        { id: 'one', owner: 'lead', scope: [left], state: 'running' },
        { id: 'two', owner: 'lane-two', scope: [right], state: 'running' },
      ],
      bottleneck: { id: 'pair', owner: 'lead', action: 'lead_action', targets: ['src/a.ts'] },
      next: 'compare the scopes',
    }
  }

  it('compares resource scopes exactly, so case and separators are distinct', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('resource:Stand', 'resource:stand'))
    expect((await harness.readRecord()).parallelComputed).toBe(true)
  })

  it('treats two lanes on the same resource as serial', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('resource:live-stand', 'resource:live-stand'))
    expect((await harness.readRecord()).parallelComputed).toBe(false)
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('treats the repository root as containing a descendant scope', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('.', 'src'))
    expect((await harness.readRecord()).parallelComputed).toBe(false)
    remedy(harness)
    await harness.turnStopping()
    expect(harness.steers).toHaveLength(0)
  })

  it('resolves dot segments before comparing scopes', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('src/../docs', 'docs'))
    expect((await harness.readRecord()).parallelComputed).toBe(false)
    harness.turnStart(2)
    await harness.checkpoint(twoLanes('./src', 'src'))
    expect((await harness.readRecord(2)).parallelComputed).toBe(false)
  })

  it('keeps an unmatched leading parent distinct from its target', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('../a', 'a'))
    expect((await harness.readRecord()).parallelComputed).toBe(true)
  })

  it('treats the absolute root as containing an absolute descendant', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('/', '/src'))
    expect((await harness.readRecord()).parallelComputed).toBe(false)
  })

  it('keeps the working-directory root distinct from a parent-relative scope', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('.', '../sibling'))
    expect((await harness.readRecord()).parallelComputed).toBe(true)
  })

  it('treats a parent-relative scope as containing the working directory', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('..', 'src'))
    expect((await harness.readRecord()).parallelComputed).toBe(false)
  })

  it('keeps containment at two parent levels', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('../..', 'src'))
    expect((await harness.readRecord()).parallelComputed).toBe(false)
  })

  it('matches a relative scope against an absolute one beneath the workspace', async () => {
    const harness = await create()
    harness.turnStart()
    await harness.checkpoint(twoLanes('src', join(harness.workspace, 'src')))
    expect((await harness.readRecord()).parallelComputed).toBe(false)
  })
})
