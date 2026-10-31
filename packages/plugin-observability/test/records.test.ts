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
  options: { isError?: boolean; error?: Record<string, unknown> } = {},
): SessionEvent {
  return event('tool/result', {
    turn: 1,
    step: 1,
    message: {
      role: 'tool',
      id: `m-${callId}`,
      content: [],
      source: { kind: 'tool', callId },
      toolCallId: callId,
      isError: options.isError === true,
    },
    ...(options.error === undefined ? {} : { error: options.error }),
  })
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

  it('keeps a checkpoint outcome, its list lengths, and the parallel flag', () => {
    const arguments_ = JSON.stringify({
      outcome: 'continue',
      verified: ['one', 'two'],
      remaining: ['three'],
      parallel: true,
      next: 'keep going',
      serialReason: 'one ordered step',
    })
    const records = extractRecords('s1', [call('c1', 'work_checkpoint', arguments_)])
    expect(records[0]).toMatchObject({
      checkpointOutcome: 'continue',
      checkpointVerifiedCount: 2,
      checkpointRemainingCount: 1,
      checkpointParallel: true,
    })
  })

  it('counts an empty checkpoint list as zero', () => {
    const arguments_ = JSON.stringify({
      outcome: 'done',
      verified: [],
      remaining: [],
      next: 'nothing left',
    })
    const records = extractRecords('s1', [call('c1', 'work_checkpoint', arguments_)])
    expect(records[0]).toMatchObject({
      checkpointOutcome: 'done',
      checkpointVerifiedCount: 0,
      checkpointRemainingCount: 0,
      checkpointParallel: false,
    })
  })

  it('never keeps the checkpoint lists, next step, or serial reason text', () => {
    const secret = 'CHECKPOINT-TEXT-SECRET'
    const arguments_ = JSON.stringify({
      outcome: 'done',
      verified: [`verified ${secret}`],
      remaining: [`remaining ${secret}`],
      parallel: false,
      next: `next ${secret}`,
      serialReason: `reason ${secret}`,
    })
    const records = extractRecords('s1', [call('c1', 'work_checkpoint', arguments_)])
    expect(records[0]?.checkpointVerifiedCount).toBe(1)
    expect(records[0]?.checkpointRemainingCount).toBe(1)
    expect(JSON.stringify(records)).not.toContain(secret)
  })

  it('contributes zero for malformed checkpoint arguments and never throws', () => {
    const records = extractRecords('s1', [
      call('c1', 'work_checkpoint', 'not json'),
      call('c2', 'work_checkpoint', '[]'),
      call('c3', 'work_checkpoint', JSON.stringify({ outcome: 7, verified: 'text' })),
    ])
    expect(records).toHaveLength(3)
    expect(records[0]).toMatchObject({ checkpointVerifiedCount: 0, checkpointRemainingCount: 0 })
    expect(records[0]?.checkpointOutcome).toBeUndefined()
    expect(records[1]).toMatchObject({ checkpointVerifiedCount: 0, checkpointRemainingCount: 0 })
    expect(records[2]).toMatchObject({ checkpointVerifiedCount: 0, checkpointRemainingCount: 0 })
    expect(records[2]?.checkpointOutcome).toBeUndefined()
  })

  it('rejects the whole checkpoint when one field among valid ones is malformed', () => {
    const cases = [
      JSON.stringify({
        outcome: 'done',
        verified: ['checked'],
        remaining: [],
        parallel: 'yes',
        next: 'finish',
      }),
      JSON.stringify({ outcome: 'SECRET-OUTCOME', next: 'finish' }),
      JSON.stringify({ outcome: 'done', verified: [null], next: 'finish' }),
      JSON.stringify({ outcome: 'done', verified: ['ok'], remaining: [{}], next: 'finish' }),
      JSON.stringify({ outcome: 'done', verified: ['ok'], next: '' }),
      JSON.stringify({ outcome: 'done', next: 'finish', unknown: 'SECRET-FIELD' }),
      JSON.stringify({ outcome: 'continue', next: 'finish', parallel: false }),
    ]
    const events = cases.map((arguments_, index) =>
      call(`c${String(index)}`, 'work_checkpoint', arguments_),
    )
    const records = extractRecords('s1', events)
    for (const record of records) {
      expect(record.checkpointOutcome).toBeUndefined()
      expect(record.checkpointVerifiedCount).toBe(0)
      expect(record.checkpointRemainingCount).toBe(0)
      expect(record.checkpointParallel).toBeUndefined()
    }
    expect(JSON.stringify(records)).not.toContain('SECRET')
  })

  it('keeps checkpoint text out of a configured argument field map', () => {
    const secret = 'CONFIGURED-CHECKPOINT-SECRET'
    const fields = new Map([
      [
        'work_checkpoint',
        new Set(['outcome', 'verified', 'remaining', 'next', 'serialReason', 'speedup']),
      ],
    ])
    const arguments_ = JSON.stringify({
      outcome: 'continue',
      verified: [`verified ${secret}`],
      remaining: [`remaining ${secret}`],
      next: `next ${secret}`,
      serialReason: `reason ${secret}`,
      speedup: `speedup ${secret}`,
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
    const fields = new Map([['work_checkpoint', new Set(['outcome', 'parallel'])]])
    const args = (outcome: unknown, parallel: unknown): string =>
      JSON.stringify({ outcome, parallel, verified: ['ok'], next: 'finish' })
    const records = extractRecords(
      's1',
      [
        call('c1', 'work_checkpoint', args(secret, secret)),
        result('c1'),
        call('c2', 'work_checkpoint', args('done', true)),
        result('c2'),
      ],
      0,
      fields,
    )
    expect(records[0]?.argumentValues).toBeUndefined()
    expect(records[1]?.argumentValues).toBeUndefined()
    expect(records[2]?.argumentValues).toEqual({ outcome: 'done', parallel: 'true' })
    expect(records[3]?.argumentValues).toEqual({ outcome: 'done', parallel: 'true' })
    expect(JSON.stringify(records)).not.toContain(secret)
  })
})
