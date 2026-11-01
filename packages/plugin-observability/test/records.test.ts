import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { extractRecords } from '../src/host/records.ts'

const NOW = new Date(2026, 9, 31, 12, 30).getTime()

let seq = 0

function event(type: string, data: Record<string, unknown>, time = NOW): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

function call(callId: string, name: string, arguments_ = '{}'): SessionEvent {
  return event('tool/call', { turn: 1, step: 1, callId, name, arguments: arguments_ })
}

function result(
  callId: string,
  options: { isError?: boolean; error?: Record<string, unknown>; text?: string } = {},
): SessionEvent {
  return event('tool/result', {
    turn: 1,
    step: 1,
    message: {
      role: 'tool',
      id: `m-${callId}`,
      content: options.text === undefined ? [] : [{ type: 'text', text: options.text }],
      source: { kind: 'tool', callId },
      toolCallId: callId,
      isError: options.isError === true,
    },
    ...(options.error === undefined ? {} : { error: options.error }),
  })
}

function lane(
  id: string,
  owner: string,
  scope: string[],
  state: 'running' | 'blocked' | 'done' = 'running',
  blockedBy?: string[],
): Record<string, unknown> {
  return { id, owner, scope, state, ...(blockedBy === undefined ? {} : { blockedBy }) }
}

function checkpoint(value: Record<string, unknown>): string {
  return JSON.stringify(value)
}

/** A valid `continue` plan; a `done` plan omits lanes and the bottleneck. */
function continuePlan(
  options: {
    readonly lanes?: readonly Record<string, unknown>[]
    readonly action?: 'worker_start' | 'lead_action' | 'user_decision'
    readonly owner?: string
    readonly blockingLanes?: readonly string[]
    readonly targets?: readonly string[]
  } = {},
): string {
  const action = options.action ?? 'worker_start'
  return checkpoint({
    outcome: 'continue',
    verified: [],
    lanes: options.lanes ?? [lane('a', 'lead', ['src']), lane('b', 'worker', ['docs'])],
    bottleneck: {
      id: 'n',
      owner: options.owner ?? 'lead',
      action,
      ...(options.blockingLanes === undefined ? {} : { blockingLanes: [...options.blockingLanes] }),
      ...(options.targets === undefined ? {} : { targets: [...options.targets] }),
    },
    next: 'go on',
  })
}

function planParallel(lanes: readonly Record<string, unknown>[]): boolean | undefined {
  const records = extractRecords('s1', [call('c1', 'work_checkpoint', continuePlan({ lanes }))])
  return records[0]?.checkpointParallelComputed
}

describe('neutral record extraction', () => {
  it('keeps the call identity on a call and on its result', () => {
    const records = extractRecords('s1', [call('c1', 'edit'), result('c1')])
    expect(records[0]).toMatchObject({ callId: 'c1', tool: 'edit' })
    expect(records[1]).toMatchObject({ callId: 'c1', tool: 'edit' })
  })

  it('keeps a failed result error name and code, never its raw reason', () => {
    const secret = 'RAW-REASON-DO-NOT-KEEP'
    const records = extractRecords('s1', [
      call('c1', 'edit'),
      result('c1', { isError: true, error: { name: 'ToolError', code: 'E_EDIT', reason: secret } }),
    ])
    const failed = records[1]
    expect(failed?.failed).toBe(true)
    expect(failed?.errorName).toBe('ToolError')
    expect(failed?.errorCode).toBe('E_EDIT')
    expect(JSON.stringify(records)).not.toContain(secret)
  })

  it('accepts a failed result without an error object', () => {
    const records = extractRecords('s1', [call('c1', 'read'), result('c1', { isError: true })])
    expect(records[1]?.failed).toBe(true)
    expect(records[1]?.errorName).toBeUndefined()
    expect(records[1]?.errorCode).toBeUndefined()
  })

  it('keeps a result whose call is outside the read without inventing a tool', () => {
    const events = [call('c1', 'edit'), result('c1')]
    const records = extractRecords('s1', events, 1)
    expect(records).toHaveLength(1)
    expect(records[0]?.callId).toBe('c1')
    expect(records[0]?.tool).toBeUndefined()
  })

  it('keeps every turn-end kind and fails only the error closed turn', () => {
    const kinds = [
      'completed',
      'aborted',
      'blocked',
      'error',
      'max-tokens',
      'interrupted',
      'forked',
    ] as const
    for (const kind of kinds) {
      const reason =
        kind === 'error'
          ? { kind, error: { message: 'LLM-FAILURE-MESSAGE', code: 'E_RATE_LIMIT' } }
          : kind === 'aborted'
            ? { kind, reason: { kind: 'user' } }
            : { kind }
      const records = extractRecords('s1', [event('turn/end', { turn: 1, reason })])
      const record = records[0]
      expect(record?.turnEnd).toBe(kind)
      expect(record?.failed).toBe(kind === 'error' ? true : undefined)
      if (kind === 'error') expect(record?.errorCode).toBe('E_RATE_LIMIT')
    }
  })

  it('keeps only the configured argument fields, never the raw arguments', () => {
    const secret = 'DO-NOT-KEEP'
    const fields = new Map([['write', new Set(['path'])]])
    const filtered = extractRecords(
      's1',
      [call('c1', 'write', `{"path":"notes.md","secret":"${secret}"}`)],
      0,
      fields,
    )
    expect(filtered[0]?.argumentValues).toEqual({ path: 'notes.md' })
    expect(JSON.stringify(filtered)).not.toContain(secret)
    const unfiltered = extractRecords('s1', [
      call('c2', 'write', `{"path":"notes.md","secret":"${secret}"}`),
    ])
    expect(unfiltered[0]?.argumentValues).toBeUndefined()
    expect(JSON.stringify(unfiltered)).not.toContain(secret)
  })

  it('never records message text, tool arguments, or the failure message', () => {
    const secret = 'SECRET-USER-TEXT-123'
    const records = extractRecords('s1', [
      event('user/message', {
        role: 'user',
        id: 'm0',
        content: [{ type: 'text', text: secret }],
        source: { kind: 'user' },
      }),
      call('c1', 'write', '{"path":"notes.md"}'),
      result('c1', { isError: true, error: { name: 'E', code: 'C', reason: secret } }),
      event('turn/end', {
        turn: 1,
        reason: { kind: 'error', error: { message: secret, code: 'C' } },
      }),
    ])
    expect(JSON.stringify(records)).not.toContain(secret)
  })

  it('keeps the five usage fields and leaves a message without usage empty', () => {
    const records = extractRecords('s1', [
      event('assistant/message', {
        turn: 1,
        step: 1,
        usage: {
          inputTokens: 1200,
          outputTokens: 34,
          cacheReadTokens: 5600,
          cacheWriteTokens: 0,
          totalTokens: 6834,
        },
      }),
      event('assistant/message', { turn: 1, step: 2 }),
    ])
    expect(records[0]?.usage).toEqual({
      input: 1200,
      output: 34,
      cacheRead: 5600,
      cacheWrite: 0,
      total: 6834,
    })
    expect(records[1]?.usage).toBeUndefined()
  })

  it('keeps a partially recorded usage object without estimating the missing fields', () => {
    const records = extractRecords('s1', [
      event('assistant/message', { turn: 1, step: 1, usage: { inputTokens: 10 } }),
    ])
    expect(records[0]?.usage).toEqual({
      input: 10,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    })
  })

  it('keeps the goal operation, phase, and rounds without the objective text', () => {
    const secret = 'GOAL-OBJECTIVE-SECRET'
    const goal = (operation: string, phase: string) =>
      event('goal/change', {
        kind: 'goal/change',
        operation,
        goal: { id: 'g1', revision: 1, objective: secret, phase },
        roundsStarted: 3,
      })
    const records = extractRecords('s1', [goal('create', 'active'), goal('complete', 'completed')])
    expect(records.map((record) => record.goalOperation)).toEqual(['create', 'complete'])
    expect(records.map((record) => record.goalPhase)).toEqual(['active', 'completed'])
    expect(records.map((record) => record.goalId)).toEqual(['g1', 'g1'])
    expect(records[0]?.goalRounds).toBe(3)
    expect(JSON.stringify(records)).not.toContain(secret)
  })

  it('keeps the plan counts, the computed parallel flag, the action, and the first age', () => {
    const arguments_ = checkpoint({
      outcome: 'continue',
      verified: ['one', 'two'],
      lanes: [
        lane('a', 'lead', ['src']),
        lane('b', 'worker', ['src2']),
        lane('c', 'worker', ['docs'], 'blocked'),
      ],
      bottleneck: { id: 'n', owner: 'lead', action: 'worker_start', blockingLanes: ['c'] },
      next: 'keep going',
    })
    const records = extractRecords('s1', [call('c1', 'work_checkpoint', arguments_)])
    expect(records[0]).toMatchObject({
      checkpointOutcome: 'continue',
      checkpointVerifiedCount: 2,
      checkpointLaneCount: 3,
      checkpointBlockedLaneCount: 1,
      checkpointParallelComputed: true,
      checkpointBottleneckAction: 'worker_start',
      checkpointBottleneckAge: 1,
    })
  })

  it('computes parallel work from runnable lanes, owners, and disjoint scopes', () => {
    // Different owners over a textual sibling scope are disjoint: src and src2.
    expect(planParallel([lane('a', 'lead', ['src']), lane('b', 'worker', ['src2'])])).toBe(true)
    // One owner is the serial form.
    expect(planParallel([lane('a', 'lead', ['src']), lane('b', 'lead', ['docs'])])).toBe(false)
    // Containment by path component is overlap.
    expect(planParallel([lane('a', 'lead', ['src']), lane('b', 'worker', ['src/api'])])).toBe(false)
    // A shared resource scope is serial by construction.
    expect(
      planParallel([
        lane('a', 'lead', ['resource:live-stand']),
        lane('b', 'worker', ['resource:live-stand']),
      ]),
    ).toBe(false)
    expect(
      planParallel([
        lane('a', 'lead', ['resource:live-stand']),
        lane('b', 'worker', ['resource:other']),
      ]),
    ).toBe(true)
    // Separators and case are normalized before comparison.
    expect(
      planParallel([lane('a', 'lead', ['SRC\\Data']), lane('b', 'worker', ['src/data/file.ts'])]),
    ).toBe(false)
    // Dot and dot-dot segments are dropped, so an alias is the same scope.
    expect(planParallel([lane('a', 'lead', ['src']), lane('b', 'worker', ['./src'])])).toBe(false)
    expect(planParallel([lane('a', 'lead', ['src']), lane('b', 'worker', ['.\\src'])])).toBe(false)
    expect(planParallel([lane('a', 'lead', ['src']), lane('b', 'worker', ['a/../src'])])).toBe(
      false,
    )
    // A running lane waiting on a done lane is runnable; a waiting lane is not.
    expect(
      planParallel([
        lane('a', 'lead', ['src'], 'done'),
        lane('b', 'worker', ['docs'], 'running', ['a']),
        lane('c', 'other', ['assets']),
      ]),
    ).toBe(true)
    expect(
      planParallel([
        lane('a', 'lead', ['src'], 'running'),
        lane('b', 'worker', ['docs'], 'running', ['a']),
      ]),
    ).toBe(false)
  })

  it('counts bottleneck age across consecutive checkpoints by owner and blocking lanes', () => {
    const plan = (owner: string, blockingLanes: readonly string[]): string =>
      continuePlan({
        owner,
        blockingLanes,
        lanes: [lane('a', 'lead', ['src']), lane('b', 'worker', ['docs'], 'blocked')],
      })
    const records = extractRecords('s1', [
      call('c1', 'work_checkpoint', plan('lead', ['b'])),
      call('c2', 'work_checkpoint', plan('lead', ['b'])),
      call('c3', 'work_checkpoint', plan('other', ['b'])),
      call('c4', 'work_checkpoint', plan('other', ['a', 'b'])),
      call('c5', 'work_checkpoint', plan('other', ['a', 'b'])),
    ])
    expect(records.map((record) => record.checkpointBottleneckAge)).toEqual([1, 2, 1, 1, 2])
  })

  it('resets the bottleneck age at a checkpoint without a bottleneck', () => {
    const records = extractRecords('s1', [
      call('c1', 'work_checkpoint', continuePlan()),
      call(
        'c2',
        'work_checkpoint',
        checkpoint({ outcome: 'done', verified: ['ok'], next: 'done' }),
      ),
      call('c3', 'work_checkpoint', continuePlan()),
    ])
    expect(records.map((record) => record.checkpointBottleneckAge)).toEqual([1, undefined, 1])
  })

  it('resolves a worker-start remedy only by a successful worker call in the window', () => {
    const records = extractRecords('s1', [
      call('cp1', 'work_checkpoint', continuePlan()),
      call('w1', 'subagent'),
      result('w1'),
      call('cp2', 'work_checkpoint', continuePlan()),
      call('w2', 'delegate'),
      result('w2', { isError: true }),
      call('cp3', 'work_checkpoint', continuePlan()),
      call('w3', 'workflow'),
      call('cp4', 'work_checkpoint', continuePlan()),
    ])
    expect(
      records.flatMap((record) =>
        record.checkpointOutcome === undefined ? [] : [record.checkpointRemedyResolved],
      ),
    ).toEqual([true, false, false, false])
  })

  it('matches a lead-action remedy by normalized target or directory descendant', () => {
    const remedy = (filePath: string, targets: readonly string[], failed = false): boolean => {
      const records = extractRecords('s1', [
        call('cp1', 'work_checkpoint', continuePlan({ action: 'lead_action', targets })),
        call('e1', 'edit', JSON.stringify({ file_path: filePath })),
        result('e1', { isError: failed }),
        call('cp2', 'work_checkpoint', continuePlan()),
      ])
      return records[0]?.checkpointRemedyResolved === true
    }
    expect(remedy('src\\a.ts', ['src'])).toBe(true)
    expect(remedy('SRC/A.TS', ['src/a.ts'])).toBe(true)
    // Dot aliases normalize to the same destination and target.
    expect(remedy('./src/a.ts', ['src'])).toBe(true)
    expect(remedy('.\\src\\a.ts', ['src'])).toBe(true)
    expect(remedy('src/a.ts', ['./src'])).toBe(true)
    expect(remedy('src/a.ts', ['a/../src'])).toBe(true)
    // A textual sibling is not beneath the target by path component.
    expect(remedy('src2/a.ts', ['src'])).toBe(false)
    expect(remedy('src/a.ts', ['src'], true)).toBe(false)
    // The written content is not evidence; only the destination is.
    const contentOnly = extractRecords('s1', [
      call('cp1', 'work_checkpoint', continuePlan({ action: 'lead_action', targets: ['src'] })),
      call('e1', 'write', JSON.stringify({ file_path: 'notes.md', content: 'src' })),
      result('e1'),
      call('cp2', 'work_checkpoint', continuePlan()),
    ])
    expect(contentOnly[0]?.checkpointRemedyResolved).toBe(false)
  })

  it('resolves a user-decision remedy only by a completed question call', () => {
    const resolved = extractRecords('s1', [
      call('cp1', 'work_checkpoint', continuePlan({ action: 'user_decision' })),
      call('q1', 'ask_user_question'),
      result('q1'),
      call('cp2', 'work_checkpoint', continuePlan()),
    ])
    expect(resolved[0]?.checkpointRemedyResolved).toBe(true)
    const pending = extractRecords('s1', [
      call('cp1', 'work_checkpoint', continuePlan({ action: 'user_decision' })),
      call('q1', 'ask_user_question'),
      call('cp2', 'work_checkpoint', continuePlan()),
    ])
    expect(pending[0]?.checkpointRemedyResolved).toBe(false)
    const failed = extractRecords('s1', [
      call('cp1', 'work_checkpoint', continuePlan({ action: 'user_decision' })),
      call('q1', 'ask_user_question'),
      result('q1', { isError: true }),
      call('cp2', 'work_checkpoint', continuePlan()),
    ])
    expect(failed[0]?.checkpointRemedyResolved).toBe(false)
    const notAQuestion = extractRecords('s1', [
      call('cp1', 'work_checkpoint', continuePlan()),
      call('q1', 'ask_user_question'),
      result('q1'),
      call('cp2', 'work_checkpoint', continuePlan()),
    ])
    expect(notAQuestion[0]?.checkpointRemedyResolved).toBe(false)
  })

  it('classifies a reused, pending, or queued delegate result as not a worker start', () => {
    const cases: ReadonlyArray<readonly [string, boolean]> = [
      ['rule "task-review" PASS (reused record abc123, digest def456)', false],
      ['rule "task-review" FINDINGS (reused record abc123, digest def456)', false],
      ['rule "task-review" ERROR (reused record abc123, digest def456)', false],
      ['rule "task-review" review already pending', false],
      ['rule "task-review" review queued', false],
      ['started the review', true],
      ['answer\n(no gate record: this answer does not satisfy a strict review rule)', true],
    ]
    for (const [text, started] of cases) {
      const records = extractRecords('s1', [
        call('cp1', 'work_checkpoint', continuePlan()),
        call('w1', 'delegate'),
        result('w1', { text }),
        call('cp2', 'work_checkpoint', continuePlan()),
      ])
      expect(
        records.find((record) => record.eventType === 'tool/result')?.delegateStarted,
        text,
      ).toBe(started)
      expect(records[0]?.checkpointRemedyResolved, text).toBe(started)
      expect(JSON.stringify(records)).not.toContain(text)
    }
  })

  it('ends the last checkpoint remedy window at the turn end', () => {
    const before = extractRecords('s1', [
      call('cp1', 'work_checkpoint', continuePlan()),
      call('w1', 'subagent'),
      result('w1'),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ])
    expect(before[0]?.checkpointRemedyResolved).toBe(true)
    const after = extractRecords('s1', [
      call('cp1', 'work_checkpoint', continuePlan()),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      call('w1', 'subagent'),
      result('w1'),
    ])
    expect(after[0]?.checkpointRemedyResolved).toBe(false)
  })

  it('counts an empty verified list and a plan-less done close as zeroes', () => {
    const arguments_ = checkpoint({ outcome: 'done', verified: [], next: 'nothing left' })
    const records = extractRecords('s1', [call('c1', 'work_checkpoint', arguments_)])
    expect(records[0]).toMatchObject({
      checkpointOutcome: 'done',
      checkpointVerifiedCount: 0,
      checkpointLaneCount: 0,
      checkpointBlockedLaneCount: 0,
      checkpointParallelComputed: false,
    })
    expect(records[0]?.checkpointBottleneckAction).toBeUndefined()
    expect(records[0]?.checkpointBottleneckAge).toBeUndefined()
    expect(records[0]?.checkpointRemedyResolved).toBeUndefined()
  })

  it('never keeps the lane, owner, target, verified, or next text', () => {
    const secret = 'CHECKPOINT-TEXT-SECRET'
    const arguments_ = checkpoint({
      outcome: 'continue',
      verified: [`verified ${secret}`],
      lanes: [
        lane(`id-${secret}`, `owner-${secret}`, [`scope ${secret}`], 'blocked', []),
        lane('b', 'worker', ['docs']),
      ],
      bottleneck: {
        id: `bottleneck-${secret}`,
        owner: `owner-${secret}`,
        action: 'lead_action',
        blockingLanes: [`id-${secret}`],
        targets: [`target ${secret}`],
      },
      next: `next ${secret}`,
    })
    const records = extractRecords('s1', [call('c1', 'work_checkpoint', arguments_)])
    expect(records[0]).toMatchObject({
      checkpointVerifiedCount: 1,
      checkpointLaneCount: 2,
      checkpointBlockedLaneCount: 1,
      checkpointBottleneckAction: 'lead_action',
      checkpointBottleneckAge: 1,
    })
    expect(JSON.stringify(records)).not.toContain(secret)
  })

  it('contributes nothing for malformed checkpoint arguments and never throws', () => {
    const records = extractRecords('s1', [
      call('c1', 'work_checkpoint', 'not json'),
      call('c2', 'work_checkpoint', '[]'),
      call('c3', 'work_checkpoint', checkpoint({ outcome: 7, verified: 'text' })),
    ])
    expect(records).toHaveLength(3)
    for (const record of records) {
      expect(record.checkpointOutcome).toBeUndefined()
      expect(record.checkpointVerifiedCount).toBeUndefined()
      expect(record.checkpointLaneCount).toBeUndefined()
      expect(record.checkpointBlockedLaneCount).toBeUndefined()
      expect(record.checkpointParallelComputed).toBeUndefined()
      expect(record.checkpointBottleneckAction).toBeUndefined()
      expect(record.checkpointBottleneckAge).toBeUndefined()
      expect(record.checkpointRemedyResolved).toBeUndefined()
    }
  })

  it('rejects the whole checkpoint when any field or plan part is malformed', () => {
    const valid = continuePlan()
    const removed = [
      { outcome: 'done', verified: ['ok'], remaining: [], next: 'finish' },
      { outcome: 'done', verified: ['ok'], parallel: false, next: 'finish' },
      { outcome: 'done', verified: [], next: 'finish', serialReason: 'reason' },
      { outcome: 'done', verified: [], next: 'finish', speedup: 'speedup' },
    ].map((value) => checkpoint(value))
    const cases = [
      ...removed,
      checkpoint({ outcome: 'SECRET-OUTCOME', next: 'finish' }),
      checkpoint({ outcome: 'done', verified: [null], next: 'finish' }),
      checkpoint({ outcome: 'done', verified: ['ok'], next: '' }),
      checkpoint({ outcome: 'done', next: 'finish', unknown: 'SECRET-FIELD' }),
      checkpoint({ outcome: 'continue', lanes: [lane('a', 'lead', ['src'])], next: 'finish' }),
      checkpoint({
        outcome: 'continue',
        bottleneck: { id: 'n', owner: 'lead', action: 'worker_start' },
        next: 'finish',
      }),
      continuePlan({ lanes: [lane('a', 'lead', ['src']), lane('a', 'worker', ['docs'])] }),
      continuePlan({ lanes: [lane('b', 'worker', ['docs'], 'running', ['missing'])] }),
      continuePlan({ lanes: [lane('a', 'lead', [])] }),
      continuePlan({ lanes: [] }),
      continuePlan({
        lanes: [lane('a', 'lead', ['src']), { ...lane('b', 'worker', ['docs']), extra: 'field' }],
      }),
      continuePlan({
        lanes: [
          lane(
            'a',
            'lead',
            Array.from({ length: 9 }, (_unused, index) => `src/${String(index)}`),
          ),
          lane('b', 'worker', ['docs']),
        ],
      }),
      continuePlan({
        lanes: [
          lane('done', 'lead', ['assets'], 'done'),
          lane(
            'a',
            'lead',
            ['src'],
            'running',
            Array.from({ length: 9 }, () => 'done'),
          ),
        ],
      }),
      checkpoint({
        outcome: 'continue',
        lanes: [lane('a', 'lead', ['src'])],
        bottleneck: {
          id: 'n',
          owner: 'lead',
          action: 'worker_start',
          blockingLanes: Array.from({ length: 9 }, () => 'a'),
        },
        next: 'finish',
      }),
      checkpoint({
        outcome: 'continue',
        lanes: [lane('a', 'lead', ['src'])],
        bottleneck: {
          id: 'n',
          owner: 'lead',
          action: 'lead_action',
          targets: Array.from({ length: 9 }, (_unused, index) => `src/${String(index)}.ts`),
        },
        next: 'finish',
      }),
      checkpoint({
        outcome: 'continue',
        lanes: [lane('a', 'lead', ['src'])],
        bottleneck: {
          id: 'n',
          owner: 'lead',
          action: 'worker_start',
          extra: 'field',
        },
        next: 'finish',
      }),
      continuePlan({
        lanes: [
          { id: 'a', owner: 'lead', scope: ['src'], state: 'paused' },
          lane('b', 'worker', ['docs']),
        ],
      }),
      continuePlan({
        lanes: Array.from({ length: 9 }, (_unused, index) =>
          lane(`l${String(index)}`, 'lead', [`scope-${String(index)}`]),
        ),
      }),
      checkpoint({
        outcome: 'continue',
        lanes: [lane('a', 'lead', ['src'])],
        bottleneck: { id: 'n', owner: 'lead', action: 'wait' },
        next: 'finish',
      }),
      checkpoint({
        outcome: 'continue',
        lanes: [lane('a', 'lead', ['src'])],
        bottleneck: { id: 'n', owner: 'lead', action: 'lead_action' },
        next: 'finish',
      }),
      valid.replace('"continue"', '"SECRET-OUTCOME"'),
    ]
    const events = cases.map((arguments_, index) =>
      call(`c${String(index)}`, 'work_checkpoint', arguments_),
    )
    const records = extractRecords('s1', events)
    for (const record of records) {
      expect(record.checkpointOutcome).toBeUndefined()
      expect(record.checkpointVerifiedCount).toBeUndefined()
      expect(record.checkpointLaneCount).toBeUndefined()
      expect(record.checkpointBlockedLaneCount).toBeUndefined()
      expect(record.checkpointParallelComputed).toBeUndefined()
      expect(record.checkpointBottleneckAction).toBeUndefined()
      expect(record.checkpointBottleneckAge).toBeUndefined()
    }
    expect(JSON.stringify(records)).not.toContain('SECRET')
  })

  it('keeps checkpoint text out of a configured argument field map', () => {
    const secret = 'CONFIGURED-CHECKPOINT-SECRET'
    const fields = new Map([
      ['work_checkpoint', new Set(['outcome', 'verified', 'lanes', 'bottleneck', 'next'])],
    ])
    const arguments_ = checkpoint({
      outcome: 'continue',
      verified: [`verified ${secret}`],
      lanes: [lane(`id-${secret}`, `owner-${secret}`, [`scope ${secret}`])],
      bottleneck: {
        id: `b-${secret}`,
        owner: `owner-${secret}`,
        action: 'worker_start',
        blockingLanes: [`id-${secret}`],
      },
      next: `next ${secret}`,
    })
    const records = extractRecords(
      's1',
      [call('c1', 'work_checkpoint', arguments_), result('c1')],
      0,
      fields,
    )
    expect(records[0]?.argumentValues).toEqual({ outcome: 'continue' })
    expect(records[1]?.argumentValues).toEqual({ outcome: 'continue' })
    expect(JSON.stringify(records)).not.toContain(secret)
  })

  it('copies only validated checkpoint values into configured argument fields', () => {
    const secret = 'INVALID-CHECKPOINT-SECRET'
    const fields = new Map([['work_checkpoint', new Set(['outcome'])]])
    const args = (outcome: unknown): string =>
      checkpoint({ outcome, verified: ['ok'], next: 'finish' })
    const records = extractRecords(
      's1',
      [
        call('c1', 'work_checkpoint', args(secret)),
        result('c1'),
        call('c2', 'work_checkpoint', args('done')),
        result('c2'),
      ],
      0,
      fields,
    )
    expect(records[0]?.argumentValues).toBeUndefined()
    expect(records[1]?.argumentValues).toBeUndefined()
    expect(records[2]?.argumentValues).toEqual({ outcome: 'done' })
    expect(records[3]?.argumentValues).toEqual({ outcome: 'done' })
    expect(JSON.stringify(records)).not.toContain(secret)
  })
})
