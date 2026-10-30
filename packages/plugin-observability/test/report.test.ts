import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { extractRecords } from '../src/host/records.ts'
import { buildReport } from '../src/host/report.ts'
import { parseRows } from '../src/host/rows.ts'

const NOW = new Date(2026, 9, 31, 12, 30).getTime()
const MINUTE = 60_000
let seq = 0

function event(type: string, data: Record<string, unknown>, time: number): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

function fixture() {
  const records = extractRecords('session-1', [
    event('turn/start', { turn: 1 }, NOW - 5 * MINUTE),
    event('step/start', { turn: 1, step: 1 }, NOW - 4 * MINUTE),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'c1', name: 'delegate', arguments: '{}' },
      NOW - 3 * MINUTE,
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
      NOW - 2 * MINUTE,
    ),
    event(
      'user/message',
      { role: 'user', id: 'm2', content: [], source: { kind: 'goal' } },
      NOW - 90_000,
    ),
    event(
      'turn/end',
      {
        turn: 1,
        reason: { kind: 'aborted', reason: { kind: 'hook', reason: 'loop-guard:reset:' } },
      },
      NOW - MINUTE,
    ),
  ])
  const configured = parseRows({
    rows: [
      {
        id: 'delegation-rules',
        label: 'Delegation rules',
        kind: 'signal',
        match: [{ tool: 'delegate' }],
      },
      { id: 'prompt-only', label: 'Prompt-only', kind: 'guidance' },
    ],
  })
  return buildReport({
    range: 'session',
    now: NOW,
    records,
    configured,
    registry: new Set(['delegate']),
  })
}

describe('dashboard report data', () => {
  it('computes KPI totals and the activity series once from the records', () => {
    const report = fixture()
    expect(report.totals).toEqual({ turns: 1, steps: 1, toolCalls: 1, errors: 1, records: 6 })
    expect(report.activity.reduce((sum, count) => sum + count, 0)).toBe(report.totals.records)
    expect(report.errorSeries.reduce((sum, count) => sum + count, 0)).toBe(1)
    // Rows overlap (the tools row and the plugin row both count the delegate
    // call), so the KPI must stay below the sum of row traces.
    const rowTraces = report.rows.reduce((sum, row) => sum + row.traces, 0)
    expect(rowTraces).toBeGreaterThan(report.totals.toolCalls)
  })

  it('carries a group, a status, and the last activity for every row', () => {
    const report = fixture()
    const byId = new Map(report.rows.map((row) => [row.id, row]))
    const groups = new Set(report.rows.map((row) => row.group))
    // Every row has a group, and the fixture exercises every group.
    expect(groups).toEqual(new Set(['activity', 'tools', 'sources', 'aborts', 'errors', 'plugin']))
    for (const row of report.rows) {
      expect(row.group).toBeDefined()
    }
    expect(byId.get('activity.turns')?.group).toBe('activity')
    expect(byId.get('activity.steps')?.group).toBe('activity')
    expect(byId.get('activity.tool-calls')?.group).toBe('activity')
    expect(byId.get('tools.delegate')?.group).toBe('tools')
    expect(byId.get('sources.goal')?.group).toBe('sources')
    expect(byId.get('aborts.loop-guard')?.group).toBe('aborts')
    expect(byId.get('errors')?.group).toBe('errors')
    expect(byId.get('delegation-rules')?.group).toBe('plugin')
    expect(byId.get('delegation-rules')?.status).toBe('error')
    expect(byId.get('delegation-rules')?.lastActivity).toBe(NOW - 3 * MINUTE)
    expect(byId.get('prompt-only')?.kind).toBe('guidance')
    expect(byId.get('prompt-only')?.status).toBeUndefined()
    expect(byId.get('prompt-only')?.lastActivity).toBeUndefined()
  })

  it('keeps abort-derived row ids and labels free of abort message text', () => {
    const secret = 'STREAMED-MODEL-OUTPUT'
    const records = extractRecords('session-1', [
      event(
        'turn/end',
        {
          turn: 1,
          reason: {
            kind: 'aborted',
            reason: { kind: 'hook', reason: `loop-guard:final: repeated line: "${secret}"` },
          },
        },
        NOW,
      ),
    ])
    const report = buildReport({
      range: 'session',
      now: NOW,
      records,
      configured: [],
      registry: new Set(),
    })
    const abort = report.rows.find((row) => row.group === 'aborts')
    expect(abort?.id).toBe('aborts.loop-guard')
    expect(abort?.label).toBe('Abort: loop-guard')
    expect(abort?.traces).toBe(1)
    expect(JSON.stringify(report)).not.toContain(secret)
  })

  it('keeps the activity series empty but aligned for an empty window', () => {
    const report = buildReport({
      range: 'day',
      now: NOW,
      records: [],
      configured: [],
      registry: new Set(),
    })
    expect(report.totals).toEqual({ turns: 0, steps: 0, toolCalls: 0, errors: 0, records: 0 })
    expect(report.activity).toHaveLength(24)
    expect(report.errorSeries).toHaveLength(24)
    expect(report.activity.every((count) => count === 0)).toBe(true)
  })
})
