import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { rangeWindow } from '../src/host/aggregate.ts'
import { windowUsage } from '../src/host/metrics.ts'
import { extractRecords } from '../src/host/records.ts'
import { buildReport, EPISODE_LIMIT, FAILURE_LIMIT } from '../src/host/report.ts'
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

describe('window accounting', () => {
  const HOUR = 60 * MINUTE

  function humanEvent(at: number): SessionEvent {
    return event('user/message', { role: 'user', content: [], source: { kind: 'user' } }, at)
  }

  function usageEvent(at: number, total: number): SessionEvent {
    return event(
      'assistant/message',
      {
        turn: 1,
        step: 1,
        usage: {
          inputTokens: total,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: total,
        },
      },
      at,
    )
  }

  function closerEvent(at: number): SessionEvent {
    return event('turn/end', { turn: 1, reason: { kind: 'completed' } }, at)
  }

  function reportAt(now: number, records: ReturnType<typeof extractRecords>) {
    return buildReport({ range: 'day', now, records, configured: [], registry: new Set() })
  }

  it('attributes work by event time and splits a spanning episode at the boundary', () => {
    const w2 = rangeWindow('day', NOW, 0)
    const w1 = rangeWindow('day', w2.from - 1, 0)
    const records = extractRecords('s', [
      humanEvent(w2.from - 20 * MINUTE),
      event('step/start', { turn: 1, step: 1 }, w2.from - 19 * MINUTE),
      event('step/end', { turn: 1, step: 1 }, w2.from - 18 * MINUTE),
      usageEvent(w2.from - 17 * MINUTE, 100),
      event('step/start', { turn: 1, step: 2 }, w2.from + MINUTE),
      event('step/end', { turn: 1, step: 2 }, w2.from + 3 * MINUTE),
      usageEvent(w2.from + 2 * MINUTE, 300),
      closerEvent(w2.from + 4 * MINUTE),
    ])
    const first = reportAt(w2.from - 1, records)
    const second = reportAt(NOW, records)
    // The episode starts in the previous window, so only that window cohorts it.
    expect(first.cohortCount).toBe(1)
    expect(second.cohortCount).toBe(0)
    // Its in-window work still counts here, by event time.
    expect(second.episodes[0]?.usage.total).toBe(300)
    expect(second.episodes[0]?.fullUsage.total).toBe(400)
    expect(second.episodes[0]?.activeMs).toBe(2 * MINUTE)
    expect(second.episodes[0]?.activeMsFull).toBe(3 * MINUTE)
    expect(second.episodes[0]?.costBasis).toBe('through cutoff')
    expect(first.episodes[0]?.usage.total).toBe(100)
    expect(first.episodes[0]?.activeMs).toBe(MINUTE)
    // Adjacent windows together hold every token exactly once.
    const combined = windowUsage(records, { from: w1.from, to: w2.to })
    expect(first.windowCost.total + second.windowCost.total).toBe(combined.total)
    expect(first.windowCost.total).toBe(100)
    expect(second.windowCost.total).toBe(300)
  })

  it('excludes work recorded after the window end', () => {
    const window = rangeWindow('day', NOW, 0)
    const records = extractRecords('s', [
      humanEvent(window.to - 5 * MINUTE),
      usageEvent(window.to - 4 * MINUTE, 100),
      usageEvent(window.to + 10 * MINUTE, 500),
      closerEvent(window.to + 11 * MINUTE),
    ])
    const report = reportAt(NOW, records)
    expect(report.windowCost.total).toBe(100)
    expect(report.cost.total).toBe(100)
    // The episode's full usage keeps the later work, labelled for the detail view.
    const episode = report.episodes.find((entry) => entry.sessionId === 's')
    expect(episode?.usage.total).toBe(100)
    expect(episode?.fullUsage.total).toBe(600)
  })

  it('keeps an episode active across a window whose events bracket it', () => {
    const window = rangeWindow('day', NOW, 0)
    const records = extractRecords('s', [
      humanEvent(window.from - MINUTE),
      event('step/start', { turn: 1, step: 1 }, window.from - 30_000),
      event('step/end', { turn: 1, step: 1 }, window.to + 30_000),
      closerEvent(window.to + MINUTE),
    ])
    const report = buildReport({
      range: 'day',
      now: NOW,
      records,
      configured: [],
      registry: new Set(),
      // A two-day idle gap keeps the bracketing events in one episode.
      config: { idleGapMinutes: 2880, minEpisodes: 10, hypotheses: [] },
    })
    // No event falls inside the window, but the episode's active interval does.
    expect(report.windowActiveMs).toBe(window.to - window.from)
  })

  it('keeps a baseline episode open when it completed after the baseline cutoff', () => {
    const w2 = rangeWindow('day', NOW, 0)
    const w1 = rangeWindow('day', w2.from - 1, 0)
    const baselineRecords = extractRecords('base', [
      // The completion is 20 minutes after the human message, inside the idle
      // gap, so the episode exists; it must still be classified at the cutoff.
      humanEvent(w1.to - 10 * MINUTE),
      closerEvent(w1.to + 10 * MINUTE),
    ])
    const report = buildReport({
      range: 'day',
      now: NOW,
      records: [],
      configured: [],
      registry: new Set(),
      baseline: {
        kind: 'previous equal window',
        records: baselineRecords,
        from: w1.from,
        to: w1.to,
      },
    })
    expect(report.baseline?.quality.completed).toBe(0)
    expect(report.baseline?.quality.open).toBe(1)
  })

  it('splits one active interval at the boundary and reconciles the totals', () => {
    const w2 = rangeWindow('day', NOW, 0)
    const records = extractRecords('s', [
      humanEvent(w2.from - 10 * MINUTE),
      event('step/start', { turn: 1, step: 1 }, w2.from - 2 * MINUTE),
      event('step/end', { turn: 1, step: 1 }, w2.from + 2 * MINUTE),
      closerEvent(w2.from + 3 * MINUTE),
    ])
    const first = reportAt(w2.from - 1, records)
    const second = reportAt(NOW, records)
    expect(first.windowActiveMs).toBe(2 * MINUTE)
    expect(second.windowActiveMs).toBe(2 * MINUTE)
    expect(first.windowActiveMs + second.windowActiveMs).toBe(4 * MINUTE)
    // The step starts before the boundary, so its start event belongs to the
    // earlier window and the step itself is not counted again in the later one.
    expect(first.episodes[0]?.steps).toBe(1)
    expect(second.episodes[0]?.steps).toBe(0)
  })

  it('reconstructs an episode whose human message precedes the window', () => {
    const window = rangeWindow('day', NOW, 0)
    const records = extractRecords('s', [
      humanEvent(window.from - 10 * MINUTE),
      usageEvent(window.from + MINUTE, 100),
      closerEvent(window.from + 2 * MINUTE),
    ])
    const report = reportAt(NOW, records)
    expect(report.episodes).toHaveLength(1)
    expect(report.episodes[0]?.start).toBe(window.from - 10 * MINUTE)
    expect(report.episodes[0]?.usage.total).toBe(100)
    // Cohorts select by start, so this episode belongs to the earlier window.
    expect(report.cohortCount).toBe(0)
    expect(report.cutoffLabel).toBe('through cutoff')
  })

  it('counts only start-selected episodes in autonomy while active time is uncapped', () => {
    const window = rangeWindow('day', NOW, 0)
    const old = (offset: number): SessionEvent[] => [
      humanEvent(window.from - offset * MINUTE),
      event(
        'turn/end',
        { turn: 1, reason: { kind: 'completed' } },
        window.from - offset * MINUTE + MINUTE,
      ),
    ]
    const records = extractRecords('s', [
      ...old(300),
      ...old(200),
      ...old(100),
      humanEvent(window.from + MINUTE),
      event('step/start', { turn: 1, step: 1 }, window.from + 2 * MINUTE),
      event('step/end', { turn: 1, step: 1 }, window.from + 3 * MINUTE),
      closerEvent(window.from + 4 * MINUTE),
    ])
    const report = reportAt(NOW, records)
    // Three older episodes exist in the same session; autonomy counts only the
    // start-selected one, while the window's active time is still reported.
    expect(report.autonomy.episodes).toBe(1)
    expect(report.autonomy.sessions).toBe(1)
    expect(report.autonomy.humanMessages).toBe(1)
    expect(report.windowActiveMs).toBe(MINUTE)
  })

  it('counts only start-selected episodes in a scorecard', () => {
    const window = rangeWindow('day', NOW, 0)
    const write = (at: number): SessionEvent => {
      const callId = `write-${String(at)}`
      return event('tool/call', { turn: 1, step: 1, callId, name: 'write', arguments: '{}' }, at)
    }
    const records = extractRecords('s', [
      // A spanning episode starts before the window and writes inside it.
      humanEvent(window.from - 10 * MINUTE),
      write(window.from + MINUTE),
      closerEvent(window.from + 2 * MINUTE),
      // An in-window episode also writes.
      humanEvent(window.from + 2 * HOUR),
      write(window.from + 2 * HOUR + MINUTE),
      closerEvent(window.from + 2 * HOUR + 2 * MINUTE),
    ])
    const report = buildReport({
      range: 'day',
      now: NOW,
      records,
      configured: parseRows({
        rows: [{ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] }],
      }),
      registry: new Set(['write']),
    })
    // Both episodes overlap the window, but only the in-window start is a cohort.
    expect(report.episodeCount).toBe(2)
    expect(report.cohortCount).toBe(1)
    expect(report.scorecards[0]?.eligible).toBe(1)
    expect(report.scorecards[0]?.fired).toBe(1)
  })
})

describe('episode report shape', () => {
  function episodeEvents(
    sessionId: string,
    start: number,
    options: { usage?: number; text?: string; complete?: boolean } = {},
  ): SessionEvent[] {
    const secret = options.text ?? 'SECRET-TEXT'
    return [
      event('turn/start', { turn: 1 }, start - 1_000),
      event(
        'user/message',
        { role: 'user', content: [{ type: 'text', text: secret }], source: { kind: 'user' } },
        start,
      ),
      event(
        'assistant/message',
        {
          turn: 1,
          step: 1,
          usage: {
            inputTokens: options.usage ?? 10,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: (options.usage ?? 10) + 1,
          },
        },
        start + 1_000,
      ),
      event(
        'tool/call',
        {
          turn: 1,
          step: 1,
          callId: `${sessionId}-c1`,
          name: 'write',
          arguments: `{"path":"${secret}"}`,
        },
        start + 2_000,
      ),
      event(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            content: [],
            source: { kind: 'tool', callId: `${sessionId}-c1` },
            isError: false,
          },
        },
        start + 3_000,
      ),
      ...(options.complete === false
        ? []
        : [event('turn/end', { turn: 1, reason: { kind: 'completed' } }, start + 4_000)]),
    ]
  }

  it('carries the episode, summary, scorecard, and data-quality sections', () => {
    const records = extractRecords('s1', episodeEvents('s1', NOW - 10 * MINUTE))
    const configured = parseRows({
      rows: [
        {
          id: 'writes',
          label: 'Writes',
          kind: 'signal',
          match: [{ tool: 'write' }],
          goal: 'keep edits small',
          eligible: [{ tool: 'write' }],
        },
      ],
    })
    const report = buildReport({
      range: 'session',
      now: NOW,
      records,
      configured,
      registry: new Set(['write']),
      config: {
        idleGapMinutes: 30,
        minEpisodes: 1,
        hypotheses: [
          {
            metric: 'tokens-per-episode',
            direction: 'decrease',
            threshold: 1,
            window: 'session',
            minSamples: 1,
          },
        ],
      },
    })
    expect(report.episodes).toHaveLength(1)
    expect(report.episodeCount).toBe(1)
    expect(report.cohortCount).toBe(1)
    expect(report.episodes[0]).toMatchObject({
      sessionId: 's1',
      outcome: 'completed',
      verified: false,
      costBasis: 'through cutoff',
    })
    expect(report.quality.completed).toBe(1)
    expect(report.cost.tokensPerEpisode.n).toBe(1)
    expect(report.speed.activeMinutes.n).toBe(1)
    expect(report.autonomy.humanMessages).toBe(1)
    expect(report.subagents.delegateCalls).toBe(0)
    expect(report.dataQuality.episodes).toBe(1)
    expect(report.scorecards).toHaveLength(1)
    expect(report.scorecards[0]).toMatchObject({
      rowId: 'writes',
      goal: 'keep edits small',
      eligibilityDeclared: true,
      eligible: 1,
      fired: 1,
      activation: 1,
      association: 'association, not proof',
    })
    expect(report.hypotheses).toHaveLength(1)
    expect(report.hypotheses[0]?.status).toBe('inconclusive')
    expect(report.cutoffLabel).toBe('full episode')
    expect(report.minEpisodes).toBe(1)
    expect(report.quality.stepsToCompletion.n).toBe(1)
    expect(report.timeline?.turns).toHaveLength(1)
    expect(report.timeline?.turns[0]?.turn).toBe(1)
  })

  it('carries a serial-run finding for a long single-stream episode', () => {
    const events: SessionEvent[] = [
      event(
        'user/message',
        { role: 'user', content: [], source: { kind: 'user' } },
        NOW - 60 * MINUTE,
      ),
    ]
    for (let index = 0; index < 45; index += 1) {
      events.push(
        event('step/start', { turn: 1, step: index + 1 }, NOW - 59 * MINUTE + index * 30_000),
        event(
          'step/end',
          { turn: 1, step: index + 1 },
          NOW - 59 * MINUTE + index * 30_000 + 20_000,
        ),
      )
    }
    events.push(event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 30 * MINUTE))
    const report = buildReport({
      range: 'session',
      now: NOW,
      records: extractRecords('s1', events),
      configured: [],
      registry: new Set(),
    })
    expect(report.findings.map((finding) => finding.id)).toEqual(['serial-long-run'])
    expect(report.findings[0]?.episodeIds).toEqual(['s1#1'])
  })

  it('caps the episode list at 200 newest while the counts stay uncapped', () => {
    const records = Array.from({ length: EPISODE_LIMIT + 5 }, (_unused, index) =>
      extractRecords(
        `s${String(index)}`,
        episodeEvents(`s${String(index)}`, NOW - (index + 1) * MINUTE),
      ),
    ).flat()
    const report = buildReport({
      range: 'day',
      now: NOW,
      records,
      configured: [],
      registry: new Set(),
    })
    expect(report.episodes).toHaveLength(EPISODE_LIMIT)
    expect(report.episodeCount).toBe(EPISODE_LIMIT + 5)
    expect(report.cohortCount).toBe(EPISODE_LIMIT + 5)
    expect(report.episodes[0]?.start).toBeGreaterThan(report.episodes[1]?.start ?? 0)
  })

  it('never carries message text, arguments, goal objectives, or checkpoint list text', () => {
    const secret = 'SECRET-TOKEN-123'
    const events = [
      ...episodeEvents('s1', NOW - 10 * MINUTE, { text: secret }),
      event(
        'goal/change',
        {
          kind: 'goal/change',
          operation: 'create',
          goal: { id: 'g1', revision: 1, objective: secret, phase: 'active' },
          roundsStarted: 0,
        },
        NOW - 9 * MINUTE,
      ),
      event(
        'tool/call',
        {
          turn: 1,
          step: 1,
          callId: 'cp1',
          name: 'work_checkpoint',
          arguments: JSON.stringify({
            outcome: 'done',
            verified: [secret],
            remaining: [secret],
            next: secret,
          }),
        },
        NOW - 8 * MINUTE,
      ),
      event(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            content: [],
            source: { kind: 'tool', callId: 'cp1' },
            isError: false,
          },
        },
        NOW - 7 * MINUTE,
      ),
    ]
    const report = buildReport({
      range: 'session',
      now: NOW,
      records: extractRecords('s1', events),
      configured: [],
      registry: new Set(),
    })
    const wire = JSON.stringify(report)
    expect(wire).not.toContain(secret)
    expect(wire).not.toContain('SECRET-TOKEN-123')
  })

  it('keeps completed goals from several sessions in the autonomy totals', () => {
    const human = (at: number): SessionEvent =>
      event('user/message', { role: 'user', content: [], source: { kind: 'user' } }, at)
    const goal = (id: string, operation: string, at: number, rounds: number): SessionEvent =>
      event(
        'goal/change',
        {
          kind: 'goal/change',
          operation,
          goal: {
            id,
            revision: 1,
            objective: 'secret',
            phase: operation === 'complete' ? 'completed' : 'active',
          },
          roundsStarted: rounds,
        },
        at,
      )
    const done = (at: number): SessionEvent =>
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, at)
    const records = [
      ...extractRecords('a', [
        human(NOW - 60 * MINUTE),
        goal('g1', 'create', NOW - 59 * MINUTE, 2),
        goal('g1', 'complete', NOW - 58 * MINUTE, 3),
        done(NOW - 57 * MINUTE),
      ]),
      ...extractRecords('b', [
        human(NOW - 40 * MINUTE),
        goal('g2', 'create', NOW - 39 * MINUTE, 1),
        goal('g2', 'complete', NOW - 38 * MINUTE, 2),
        done(NOW - 37 * MINUTE),
      ]),
      ...extractRecords('c', [human(NOW - 20 * MINUTE), done(NOW - 19 * MINUTE)]),
    ]
    const report = buildReport({
      range: 'session',
      now: NOW,
      records,
      configured: [],
      registry: new Set(),
    })
    expect(report.autonomy.goals).toBe(2)
    expect(report.autonomy.completedGoals).toBe(2)
    expect(report.autonomy.rounds).toBe(5)
  })
})
