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
})
