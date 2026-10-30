import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { aggregate, RANGES, type Range } from '../src/host/aggregate.ts'
import { builtinRows, testableRow } from '../src/host/builtins.ts'
import { extractRecords } from '../src/host/records.ts'
import { parseRows } from '../src/host/rows.ts'

let seq = 0

function event(type: string, data: Record<string, unknown>, time = Date.now()): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

const NOW = new Date(2026, 9, 31, 12, 30).getTime()
const MINUTE = 60_000
const HOUR = 60 * MINUTE

function configured(raw: unknown) {
  return parseRows(raw).map(testableRow)
}

describe('aggregation buckets', () => {
  it('uses the fixed bucket counts of each range', () => {
    const records = extractRecords('s', [])
    expect(aggregate(records, [], 'session', NOW).buckets.map((bucket) => bucket.label)).toEqual([
      'Outside turn',
    ])
    expect(aggregate(records, [], 'day', NOW).buckets).toHaveLength(24)
    expect(aggregate(records, [], 'week', NOW).buckets).toHaveLength(7)
    expect(aggregate(records, [], 'month', NOW).buckets).toHaveLength(30)
  })

  it('returns zero counts for an empty window in every range', () => {
    for (const range of RANGES satisfies readonly Range[]) {
      const result = aggregate([], builtinRows([]), range, NOW)
      expect(result.totals).toEqual({ turns: 0, steps: 0, toolCalls: 0, errors: 0, records: 0 })
      expect(result.activity.every((count) => count === 0)).toBe(true)
      expect(result.errorSeries.every((count) => count === 0)).toBe(true)
      for (const row of result.rows.values()) {
        expect(row.counts.every((count) => count === 0)).toBe(true)
        expect(row.errors).toBe(0)
      }
    }
  })

  it('buckets a session by turn plus one outside-turn bucket', () => {
    const records = extractRecords('s', [
      event('turn/start', { turn: 1 }, NOW - 10 * MINUTE),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 7 * MINUTE),
      event('turn/start', { turn: 2 }, NOW - 5 * MINUTE),
      event('turn/end', { turn: 2, reason: { kind: 'completed' } }, NOW - 2 * MINUTE),
    ])
    const result = aggregate(records, builtinRows(records), 'session', NOW)
    expect(result.buckets.map((bucket) => bucket.label)).toEqual([
      'Turn 1',
      'Turn 2',
      'Outside turn',
    ])
    expect(result.rows.get('activity.turns')?.counts).toEqual([1, 1, 0])
  })

  it('puts a command-only session in the outside-turn bucket', () => {
    const records = extractRecords('s', [
      event('command/run', { commandId: 'c', name: 'compact', source: { kind: 'user' } }, NOW),
    ])
    const rows = configured({
      rows: [{ id: 'compact', label: 'Compact', kind: 'signal', match: [{ command: 'compact' }] }],
    })
    const result = aggregate(records, rows, 'session', NOW)
    expect(result.buckets.map((bucket) => bucket.label)).toEqual(['Outside turn'])
    expect(result.rows.get('compact')?.counts).toEqual([1])
  })

  it('drops events outside the trailing window and keeps the rest in the last bucket', () => {
    const rows = builtinRows([])
    for (const [range, outside] of [
      ['day', NOW - 25 * HOUR],
      ['week', NOW - 8 * 24 * HOUR],
      ['month', NOW - 31 * 24 * HOUR],
    ] as const) {
      const records = extractRecords('s', [
        event('step/start', { turn: 1, step: 1 }, outside),
        event('step/start', { turn: 1, step: 1 }, NOW - MINUTE),
      ])
      const result = aggregate(records, rows, range, NOW)
      const counts = result.rows.get('activity.steps')?.counts ?? []
      expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1)
      expect(counts[counts.length - 1]).toBe(1)
    }
  })

  it('attributes source kinds and abort prefixes with no configuration', () => {
    const records = extractRecords('s', [
      event('turn/start', { turn: 1 }, NOW - 3 * MINUTE),
      event(
        'user/message',
        { role: 'user', id: 'm', content: [], source: { kind: 'goal' } },
        NOW - 2 * MINUTE,
      ),
      event(
        'turn/end',
        {
          turn: 1,
          reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'goal-max-rounds' } },
        },
        NOW - MINUTE,
      ),
    ])
    const builtins = aggregate(records, builtinRows(records), 'session', NOW)
    expect(builtins.rows.get('sources.goal')?.counts).toEqual([1, 0])
    expect(builtins.rows.get('aborts.goal-max-rounds')?.counts).toEqual([1, 0])

    const rows = configured({
      rows: [
        {
          id: 'goal-context',
          label: 'Goal context',
          kind: 'signal',
          match: [{ sourceKind: 'goal' }],
        },
        {
          id: 'goal-abort',
          label: 'Goal abort',
          kind: 'signal',
          match: [{ abortPrefix: 'goal-' }],
        },
        {
          id: 'other-abort',
          label: 'Other abort',
          kind: 'signal',
          match: [{ abortPrefix: 'loop-' }],
        },
      ],
    })
    const result = aggregate(records, rows, 'session', NOW)
    expect(result.rows.get('goal-context')?.counts).toEqual([1, 0])
    expect(result.rows.get('goal-abort')?.counts).toEqual([1, 0])
    expect(result.rows.get('other-abort')?.counts).toEqual([0, 0])
  })

  it('attributes a delegation gate message by its source kind', () => {
    const records = extractRecords('s', [
      event(
        'user/message',
        { role: 'user', id: 'm', content: [], source: { kind: 'delegation-rules' } },
        NOW - MINUTE,
      ),
    ])
    const rows = [
      ...builtinRows(records),
      ...configured({
        rows: [
          {
            id: 'delegation-rules',
            label: 'Delegation rules',
            kind: 'signal',
            match: [{ sourceKind: 'delegation-rules' }],
          },
        ],
      }),
    ]
    const result = aggregate(records, rows, 'session', NOW)
    expect(result.rows.get('sources.delegation-rules')?.counts).toEqual([1])
    expect(result.rows.get('delegation-rules')?.counts).toEqual([1])
  })

  it('counts errors and attributes a failed result to its tool row', () => {
    const records = extractRecords('s', [
      event('turn/start', { turn: 1 }, NOW - 2 * MINUTE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'delegate', arguments: '{}' },
        NOW - MINUTE,
      ),
    ])
    const rows = [
      ...builtinRows(records),
      ...configured({
        rows: [
          { id: 'delegation', label: 'Delegation', kind: 'signal', match: [{ tool: 'delegate' }] },
        ],
      }),
    ]
    const withFailure = extractRecords('s', [
      event('turn/start', { turn: 1 }, NOW - 2 * MINUTE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'delegate', arguments: '{}' },
        NOW - MINUTE,
      ),
      event(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            id: 'm',
            content: [],
            source: { kind: 'tool', callId: 'c1' },
            toolCallId: 'c1',
            isError: true,
          },
        },
        NOW - MINUTE,
      ),
    ])
    const result = aggregate(withFailure, rows, 'session', NOW)
    expect(result.rows.get('delegation')?.counts).toEqual([1, 0])
    expect(result.rows.get('delegation')?.errors).toBe(1)
    expect(result.rows.get('tools.delegate')?.errors).toBe(1)
    expect(result.rows.get('errors')?.counts).toEqual([1, 0])
  })

  it('attributes a failed result only when the argument predicate matches the call', () => {
    const records = extractRecords('s', [
      event('turn/start', { turn: 1 }, NOW - 2 * MINUTE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"path":"notes.md"}' },
        NOW - MINUTE,
      ),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c2', name: 'write', arguments: '{"path":"other.md"}' },
        NOW - MINUTE,
      ),
      event(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            id: 'm1',
            content: [],
            source: { kind: 'tool', callId: 'c1' },
            toolCallId: 'c1',
            isError: true,
          },
        },
        NOW - MINUTE,
      ),
      event(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            id: 'm2',
            content: [],
            source: { kind: 'tool', callId: 'c2' },
            toolCallId: 'c2',
            isError: true,
          },
        },
        NOW - MINUTE,
      ),
    ])
    const rows = configured({
      rows: [
        {
          id: 'notes',
          label: 'Notes',
          kind: 'signal',
          match: [{ tool: 'write', argument: { field: 'path', value: 'notes.md' } }],
        },
        { id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] },
      ],
    })
    const result = aggregate(records, rows, 'session', NOW)
    expect(result.rows.get('notes')?.errors).toBe(1)
    expect(result.rows.get('writes')?.errors).toBe(2)
  })

  it('does not count a record beyond the day window or outside the last bucket', () => {
    const result = aggregate(
      extractRecords('s', [
        event('step/start', { turn: 1, step: 1 }, NOW - MINUTE),
        event('step/start', { turn: 1, step: 1 }, NOW + 10 * MINUTE),
      ]),
      builtinRows([]),
      'day',
      NOW,
    )
    expect(result.to).toBe(NOW + 1)
    expect(result.buckets[23]?.to).toBe(NOW + 1)
    const counts = result.rows.get('activity.steps')?.counts ?? []
    expect(counts[23]).toBe(1)
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(1)
  })

  it('keeps an unmapped tool visible under its own name', () => {
    const records = extractRecords('s', [
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'mystery', arguments: '{}' },
        NOW - MINUTE,
      ),
    ])
    const result = aggregate(records, builtinRows(records), 'session', NOW)
    expect(result.rows.get('tools.mystery')?.counts).toEqual([1, 0])
  })

  it('matches an argument predicate against the raw call arguments only', () => {
    const records = extractRecords('s', [
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: '{"path":"notes.md"}' },
        NOW - MINUTE,
      ),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c2', name: 'write', arguments: '{"path":"other.md"}' },
        NOW - MINUTE,
      ),
    ])
    const rows = configured({
      rows: [
        {
          id: 'notes',
          label: 'Notes',
          kind: 'signal',
          match: [{ tool: 'write', argument: { field: 'path', value: 'notes.md' } }],
        },
      ],
    })
    expect(aggregate(records, rows, 'session', NOW).rows.get('notes')?.counts).toEqual([1, 0])
  })

  it('leaves guidance rows out of the counts without failing', () => {
    const rows = configured({ rows: [{ id: 'ponytail', label: 'Ponytail', kind: 'guidance' }] })
    const records = extractRecords('s', [event('turn/start', { turn: 1 }, NOW)])
    const result = aggregate(records, rows, 'session', NOW)
    expect(result.rows.get('ponytail')?.counts).toEqual([0, 0])
    expect(result.rows.get('ponytail')?.errors).toBe(0)
  })
})
