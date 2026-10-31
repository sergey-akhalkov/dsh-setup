import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { extractRecords } from '../src/host/records.ts'
import { buildReport, FAILURE_LIMIT } from '../src/host/report.ts'
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
    expect(report.totals).toEqual({
      turns: 1,
      steps: 1,
      toolCalls: 1,
      errors: 1,
      records: 6,
      sessions: 1,
    })
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
    expect(report.totals).toEqual({
      turns: 0,
      steps: 0,
      toolCalls: 0,
      errors: 0,
      records: 0,
      sessions: 0,
    })
    expect(report.activity).toHaveLength(24)
    expect(report.errorSeries).toHaveLength(24)
    expect(report.activity.every((count) => count === 0)).toBe(true)
  })
})

describe('failure list', () => {
  function callEvent(
    _sessionId: string,
    callId: string,
    tool: string,
    time: number,
    turn = 1,
  ): SessionEvent[] {
    return [
      {
        type: 'tool/call',
        seq: ++seq,
        time,
        data: { turn, step: 1, callId, name: tool, arguments: '{}' },
      } as unknown as SessionEvent,
    ]
  }

  function resultEvent(
    callId: string,
    time: number,
    options: { isError?: boolean; error?: Record<string, unknown>; turn?: number } = {},
  ): SessionEvent {
    return {
      type: 'tool/result',
      seq: ++seq,
      time,
      data: {
        turn: options.turn ?? 1,
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
      },
    } as unknown as SessionEvent
  }

  function endEvent(kind: string, time: number, turn = 1, error?: Record<string, unknown>) {
    return {
      type: 'turn/end',
      seq: ++seq,
      time,
      data: { turn, reason: error === undefined ? { kind } : { kind, error } },
    } as unknown as SessionEvent
  }

  function report(events: Record<string, SessionEvent[]>, range: 'session' | 'day' = 'day') {
    const records = Object.entries(events).flatMap(([id, list]) => extractRecords(id, list))
    return buildReport({ range, now: NOW, records, configured: [], registry: new Set() })
  }

  it('lists every failed tool result with its tool and recorded identity', () => {
    const tools = ['edit', 'write', 'read', 'delegate']
    const events: SessionEvent[] = []
    for (let index = 0; index < 22; index += 1) {
      const callId = `c${String(index)}`
      const tool = tools[index % tools.length] ?? 'edit'
      const time = NOW - (30 - index) * MINUTE
      events.push(
        ...callEvent('session-1', callId, tool, time - MINUTE),
        resultEvent(callId, time, {
          isError: true,
          error: { name: 'ToolError', code: `E_${String(index)}`, reason: 'RAW-REASON' },
        }),
      )
    }
    const built = report({ 'session-1': events })
    expect(built.failures).toHaveLength(22)
    expect(built.failureTotals).toEqual({
      total: 22,
      turnFailures: 0,
      turnCuts: 0,
      toolFailures: 22,
      recovered: 0,
    })
    expect(built.failures[0]).toMatchObject({
      severity: 'tool failure',
      tool: 'write',
      sessionId: 'session-1',
      errorName: 'ToolError',
      errorCode: 'E_21',
    })
    expect(built.failures.every((failure) => failure.tool !== undefined)).toBe(true)
    expect(JSON.stringify(built)).not.toContain('RAW-REASON')
  })

  it('separates a turn failure from the window tool failures', () => {
    const built = report({
      'session-1': [
        ...callEvent('session-1', 'c1', 'edit', NOW - 5 * MINUTE),
        resultEvent('c1', NOW - 4 * MINUTE, { isError: true }),
        endEvent('error', NOW - 2 * MINUTE, 1, { message: 'PROVIDER-MESSAGE', code: 'E_LLM' }),
      ],
    })
    expect(built.failureTotals).toEqual({
      total: 2,
      turnFailures: 1,
      turnCuts: 0,
      toolFailures: 1,
      recovered: 0,
    })
    const turn = built.failures.find((failure) => failure.severity === 'turn failure')
    expect(turn?.errorCode).toBe('E_LLM')
    expect(JSON.stringify(built)).not.toContain('PROVIDER-MESSAGE')
  })

  it('shows a cut turn without any failed result', () => {
    const built = report({
      'session-1': [
        endEvent('max-tokens', NOW - 3 * MINUTE),
        endEvent('interrupted', NOW - MINUTE),
      ],
    })
    expect(built.failureTotals).toEqual({
      total: 2,
      turnFailures: 0,
      turnCuts: 2,
      toolFailures: 0,
      recovered: 0,
    })
    expect(built.failures.map((failure) => failure.severity)).toEqual(['turn cut', 'turn cut'])
  })

  it('marks a tool failure recovered only when its turn completed, even outside the window', () => {
    const inside = report({
      'session-1': [
        ...callEvent('session-1', 'c1', 'edit', NOW - 20 * MINUTE),
        resultEvent('c1', NOW - 19 * MINUTE, { isError: true }),
        endEvent('completed', NOW - 18 * MINUTE),
      ],
    })
    expect(inside.failures[0]?.recovered).toBe(true)
    expect(inside.failureTotals.recovered).toBe(1)

    const closerOutside = report({
      'session-1': [
        ...callEvent('session-1', 'c2', 'edit', NOW - 3 * MINUTE),
        resultEvent('c2', NOW - 2 * MINUTE, { isError: true }),
        endEvent('completed', NOW - 25 * 3_600_000),
      ],
    })
    expect(closerOutside.failures[0]?.recovered).toBe(true)

    for (const closer of ['blocked', 'aborted'] as const) {
      const other = report({
        'session-1': [
          ...callEvent('session-1', 'c3', 'edit', NOW - 6 * MINUTE),
          resultEvent('c3', NOW - 5 * MINUTE, { isError: true }),
          endEvent(closer, NOW - 4 * MINUTE),
        ],
      })
      expect(other.failures[0]?.recovered).toBe(false)
      expect(other.failureTotals.recovered).toBe(0)
    }
  })

  it('leaves an open turn unrecovered', () => {
    const built = report({
      'session-1': [
        ...callEvent('session-1', 'c1', 'write', NOW - 4 * MINUTE),
        resultEvent('c1', NOW - 3 * MINUTE, { isError: true }),
      ],
    })
    expect(built.failures[0]?.recovered).toBe(false)
  })

  it('bounds the rendered list while the counts cover the window', () => {
    const events: SessionEvent[] = []
    for (let index = 0; index < FAILURE_LIMIT + 5; index += 1) {
      events.push(
        ...callEvent('session-1', `c${String(index)}`, 'edit', NOW - 2 * 3_600_000 + index),
        resultEvent(`c${String(index)}`, NOW - 2 * 3_600_000 + index + 1, { isError: true }),
      )
    }
    const built = report({ 'session-1': events })
    expect(built.failures).toHaveLength(FAILURE_LIMIT)
    expect(built.failureTotals.total).toBe(FAILURE_LIMIT + 5)
  })

  it('keeps an identity absent when the failure has no error object', () => {
    const built = report({
      'session-1': [
        ...callEvent('session-1', 'c1', 'read', NOW - 3 * MINUTE),
        resultEvent('c1', NOW - 2 * MINUTE, { isError: true }),
      ],
    })
    expect(built.failures[0]?.errorName).toBeUndefined()
    expect(built.failures[0]?.errorCode).toBeUndefined()
  })
})

describe('tool call outcomes', () => {
  function toolEvents(_sessionId: string, tool: string, count: number): SessionEvent[] {
    return Array.from({ length: count }, (_unused, index) => ({
      type: 'tool/call',
      seq: ++seq,
      time: NOW - 30 * MINUTE + index,
      data: { turn: 1, step: 1, callId: `${tool}-${String(index)}`, name: tool, arguments: '{}' },
    })) as unknown as SessionEvent[]
  }

  function failedResult(callId: string, time = NOW - 20 * MINUTE): SessionEvent {
    return {
      type: 'tool/result',
      seq: ++seq,
      time,
      data: {
        turn: 1,
        step: 1,
        message: {
          role: 'tool',
          id: `m-${callId}`,
          content: [],
          source: { kind: 'tool', callId },
          toolCallId: callId,
          isError: true,
        },
      },
    } as unknown as SessionEvent
  }

  function outcome(
    events: Record<string, SessionEvent[]>,
  ): { calls: number; failed: number } | undefined {
    const records = Object.entries(events).flatMap(([id, list]) => extractRecords(id, list))
    const built = buildReport({
      range: 'day',
      now: NOW,
      records,
      configured: [],
      registry: new Set(),
    })
    return built.toolOutcomes.find((entry) => entry.tool === 'edit')
  }

  it('draws the failing share over the calls made in the window', () => {
    const events = toolEvents('s1', 'edit', 179)
    const failed = events
      .filter((_event, index) => index < 17)
      .map((event) => {
        const data = event.data as { callId: string }
        return failedResult(data.callId)
      })
    const share = outcome({ s1: [...events, ...failed] })
    expect(share).toEqual({ tool: 'edit', calls: 179, failed: 17 })
  })

  it('does not count a failed result whose call is outside the window', () => {
    const outsideCall = {
      type: 'tool/call',
      seq: ++seq,
      time: NOW - 25 * 3_600_000,
      data: { turn: 1, step: 1, callId: 'edit-0', name: 'edit', arguments: '{}' },
    } as unknown as SessionEvent
    const events = [outsideCall, failedResult('edit-0', NOW - MINUTE)]
    expect(outcome({ s1: events })).toBeUndefined()
  })

  it('joins a call to a failed result outside the window', () => {
    const call = toolEvents('s1', 'edit', 1)[0]
    if (call === undefined) throw new Error('fixture call missing')
    const data = call.data as { callId: string }
    expect(outcome({ s1: [call, failedResult(data.callId, NOW - 25 * 3_600_000)] })).toEqual({
      tool: 'edit',
      calls: 1,
      failed: 1,
    })
  })

  it('counts a call without a result as not failed, and a repeated call id per session', () => {
    const first = toolEvents('s1', 'edit', 1)[0]
    if (first === undefined) throw new Error('fixture call missing')
    const data = first.data as { callId: string }
    const other = {
      type: 'tool/call',
      seq: ++seq,
      time: NOW - 20 * MINUTE,
      data: { turn: 1, step: 1, callId: data.callId, name: 'edit', arguments: '{}' },
    } as unknown as SessionEvent
    const records = [
      ...extractRecords('s1', [first, failedResult(data.callId)]),
      ...extractRecords('s2', [other]),
    ]
    const built = buildReport({
      range: 'day',
      now: NOW,
      records,
      configured: [],
      registry: new Set(),
    })
    const edit = built.toolOutcomes.find((entry) => entry.tool === 'edit')
    expect(edit).toEqual({ tool: 'edit', calls: 2, failed: 1 })
  })
})
