import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { builtinRows } from '../src/host/builtins.ts'
import { extractRecords } from '../src/host/records.ts'

let seq = 0

/** Build one event with the durable envelope; data stays a plain fixture object. */
function event(
  type: string,
  data: Record<string, unknown>,
  time = 1_700_000_000_000,
): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

/** One session with a turn, a step, an unknown tool call that fails, and an error turn end. */
function fixture(): SessionEvent[] {
  return [
    event('turn/start', { turn: 1 }),
    event('step/start', { turn: 1, step: 1 }),
    event('tool/call', {
      turn: 1,
      step: 1,
      callId: 'call-1',
      name: 'mystery_tool',
      arguments: '{"path":"notes.md"}',
    }),
    event('tool/result', {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        id: 'message-1',
        content: [],
        source: { kind: 'tool', callId: 'call-1' },
        toolCallId: 'call-1',
        isError: true,
      },
    }),
    event('turn/end', {
      turn: 1,
      reason: { kind: 'error', error: { message: 'boom', code: 'X' } },
    }),
  ]
}

describe('built-in signal sets', () => {
  it('yields turn, step, tool-call, error, and per-tool rows with no configuration', () => {
    const records = extractRecords('session-1', fixture())
    const rows = builtinRows(records)
    expect(rows.map((entry) => entry.row.id)).toEqual([
      'activity.turns',
      'activity.steps',
      'activity.tool-calls',
      'errors',
      'tools.mystery_tool',
    ])
    const byId = new Map(rows.map((entry) => [entry.row.id, entry]))
    expect(records.filter((record) => byId.get('activity.turns')?.test(record))).toHaveLength(1)
    expect(records.filter((record) => byId.get('activity.steps')?.test(record))).toHaveLength(1)
    expect(records.filter((record) => byId.get('activity.tool-calls')?.test(record))).toHaveLength(
      1,
    )
    expect(records.filter((record) => byId.get('errors')?.test(record))).toHaveLength(2)
    expect(records.filter((record) => byId.get('tools.mystery_tool')?.test(record))).toHaveLength(1)
  })

  it('shows an unknown tool under its own name rather than dropping it', () => {
    const rows = builtinRows(extractRecords('session-1', fixture()))
    const tool = rows.find((entry) => entry.row.id === 'tools.mystery_tool')
    expect(tool?.row.label).toBe('mystery_tool')
    expect(tool?.row.match).toEqual([{ tool: 'mystery_tool' }])
  })

  it('keeps the built-in list free of an observed tool when no tool ran', () => {
    const rows = builtinRows(
      extractRecords('session-1', [
        event('turn/start', { turn: 1 }),
        event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      ]),
    )
    expect(rows.map((entry) => entry.row.id)).toEqual([
      'activity.turns',
      'activity.steps',
      'activity.tool-calls',
      'errors',
    ])
  })
})
