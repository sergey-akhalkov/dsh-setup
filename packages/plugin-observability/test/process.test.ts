import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { rangeWindow } from '../src/host/aggregate.ts'
import { parseConfig } from '../src/host/config.ts'
import type { SessionMeta } from '../src/host/records.ts'
import { extractRecords } from '../src/host/records.ts'
import { buildReport, type Report } from '../src/host/report.ts'

const NOW = new Date(2026, 9, 31, 12, 30).getTime()
const MINUTE = 60_000
let seq = 0

function event(type: string, data: Record<string, unknown>, time: number): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

function human(time: number): SessionEvent {
  return event('user/message', { role: 'user', content: [], source: { kind: 'user' } }, time)
}

function stepStart(time: number, step: number): SessionEvent {
  return event('step/start', { turn: 1, step }, time)
}

function closer(time: number): SessionEvent {
  return event('turn/end', { turn: 1, reason: { kind: 'completed' } }, time)
}

/** A `work_checkpoint` call; an undefined outcome makes it malformed. */
function checkpoint(time: number, outcome: string | undefined): SessionEvent {
  const text =
    outcome === undefined
      ? JSON.stringify({ outcome: 'bogus', next: 'NEXT' })
      : JSON.stringify({
          outcome,
          verified: [],
          remaining: [],
          next: 'NEXT',
          ...(outcome === 'continue' ? { parallel: true } : {}),
        })
  return event(
    'tool/call',
    {
      turn: 1,
      step: 1,
      callId: `cp-${String(seq + 1)}`,
      name: 'work_checkpoint',
      arguments: text,
    },
    time,
  )
}

function meta(id: string, parentSession?: string): SessionMeta {
  return { id, ...(parentSession === undefined ? {} : { parentSession }) }
}

/** A parent episode with one step per minute from `from`, closing at `to`. */
function parentEpisode(from: number, to: number, steps = 2): SessionEvent[] {
  return [
    human(from),
    ...Array.from({ length: steps }, (_unused, index) =>
      stepStart(from + (index + 1) * MINUTE, index + 1),
    ),
    closer(to),
  ]
}

interface BuildOptions {
  readonly sessions: Record<string, SessionEvent[]>
  readonly metas: readonly SessionMeta[]
  readonly range?: 'session' | 'day'
  readonly minEpisodes?: number
  readonly interventionAt?: number
  readonly baseline?: {
    readonly kind: 'previous equal window' | 'previous completed session'
    readonly sessions: Record<string, SessionEvent[]>
    readonly metas: readonly SessionMeta[]
    readonly from: number
    readonly to: number
  }
}

function build(options: BuildOptions): Report {
  const records = Object.entries(options.sessions).flatMap(([id, list]) => extractRecords(id, list))
  return buildReport({
    range: options.range ?? 'session',
    now: NOW,
    records,
    configured: [],
    registry: new Set(),
    sessions: options.metas,
    config: {
      idleGapMinutes: 30,
      minEpisodes: options.minEpisodes ?? 1,
      hypotheses: [],
      ...(options.interventionAt === undefined ? {} : { interventionAt: options.interventionAt }),
    },
    ...(options.baseline === undefined
      ? {}
      : {
          baseline: {
            kind: options.baseline.kind,
            records: Object.entries(options.baseline.sessions).flatMap(([id, list]) =>
              extractRecords(id, list),
            ),
            sessions: options.baseline.metas,
            from: options.baseline.from,
            to: options.baseline.to,
          },
        }),
  })
}

describe('process timeline', () => {
  it('derives one worker span, its activation, and the concurrency series', () => {
    const start = NOW - 20 * MINUTE
    const report = build({
      sessions: {
        parent: parentEpisode(start, start + 10 * MINUTE),
        child: [stepStart(start + 3 * MINUTE, 1), closer(start + 5 * MINUTE)],
      },
      metas: [meta('parent'), meta('child', 'parent')],
    })
    const process = report.process
    expect(process.from).toBe(start)
    expect(process.to).toBe(start + 10 * MINUTE + 1)
    expect(process.workers).toEqual([
      {
        sessionId: 'child',
        episodeId: 'parent#1',
        from: start + 3 * MINUTE,
        to: start + 5 * MINUTE,
      },
    ])
    expect(process.summary).toMatchObject({
      episodes: 1,
      workers: 1,
      episodesWithWorker: 1,
      activations: 1,
      maxConcurrency: 1,
      reflections: 0,
      decompositionObserved: true,
    })
    expect(process.summary.timeToFirstWorker).toEqual({
      p50: 3 * MINUTE,
      p90: 3 * MINUTE,
      n: 1,
    })
    expect(process.summary.reflectionsPerEpisode).toBe(0)
    expect(process.summary.reflectionCoverage).toBe(0)
    expect(process.summary.stepsBetweenReflections.n).toBe(0)
    expect(process.decomposition).toEqual([
      { time: start + 3 * MINUTE, episodeId: 'parent#1', workers: 1 },
    ])
    expect(process.concurrency).toEqual([
      { time: start, active: 0 },
      { time: start + 3 * MINUTE, active: 1 },
      { time: start + 5 * MINUTE, active: 0 },
    ])
    expect(process.comparison).toBeUndefined()
    expect(process.stepRate).toHaveLength(report.bucketLabels.length)
    // The session range's slices carry no calendar bounds; the panel uses index layout.
    expect(process.stepRate.every((bucket) => bucket.from === 0 && bucket.to === 0)).toBe(true)
  })

  it('marks every episode whose first worker starts at the same instant after idle', () => {
    const start = NOW - 40 * MINUTE
    const report = build({
      sessions: {
        a: parentEpisode(start, start + 10 * MINUTE),
        b: parentEpisode(start, start + 10 * MINUTE),
        'a-worker': [stepStart(start + 3 * MINUTE, 1), closer(start + 5 * MINUTE)],
        'b-worker': [stepStart(start + 3 * MINUTE, 1), closer(start + 5 * MINUTE)],
      },
      metas: [meta('a'), meta('b'), meta('a-worker', 'a'), meta('b-worker', 'b')],
    })
    const process = report.process
    expect(process.summary.episodes).toBe(2)
    // Both workers are active at once, and both started the observed burst.
    expect(process.summary.maxConcurrency).toBe(2)
    expect(process.decomposition).toEqual([
      { time: start + 3 * MINUTE, episodeId: 'a#1', workers: 1 },
      { time: start + 3 * MINUTE, episodeId: 'b#1', workers: 1 },
    ])
  })

  it('reads two active workers and marks the burst once with its worker count', () => {
    const start = NOW - 30 * MINUTE
    const report = build({
      sessions: {
        parent: parentEpisode(start, start + 20 * MINUTE),
        'child-a': [stepStart(start + 3 * MINUTE, 1), closer(start + 12 * MINUTE)],
        'child-b': [stepStart(start + 4 * MINUTE, 1), closer(start + 8 * MINUTE)],
      },
      metas: [meta('parent'), meta('child-a', 'parent'), meta('child-b', 'parent')],
    })
    const process = report.process
    expect(process.summary.workers).toBe(2)
    expect(process.summary.episodesWithWorker).toBe(1)
    expect(process.summary.activations).toBe(2)
    expect(process.summary.maxConcurrency).toBe(2)
    expect(process.decomposition).toEqual([
      { time: start + 3 * MINUTE, episodeId: 'parent#1', workers: 2 },
    ])
    expect(process.concurrency).toContainEqual({ time: start + 4 * MINUTE, active: 2 })
    expect(process.concurrency).toContainEqual({ time: start + 8 * MINUTE, active: 1 })
    expect(process.concurrency).toContainEqual({ time: start + 12 * MINUTE, active: 0 })
  })

  it('reads zero workers and states that no decomposition was observed', () => {
    const start = NOW - 20 * MINUTE
    const report = build({
      sessions: {
        parent: [
          human(start),
          stepStart(start + MINUTE, 1),
          stepStart(start + 2 * MINUTE, 2),
          checkpoint(start + 3 * MINUTE, 'done'),
          closer(start + 10 * MINUTE),
        ],
      },
      metas: [meta('parent')],
    })
    const process = report.process
    expect(process.workers).toEqual([])
    expect(process.decomposition).toEqual([])
    expect(process.concurrency).toEqual([])
    expect(process.summary).toMatchObject({
      episodes: 1,
      workers: 0,
      episodesWithWorker: 0,
      activations: 0,
      maxConcurrency: 0,
      decompositionObserved: false,
    })
    // A reflection without a worker is still observed.
    expect(process.summary.reflections).toBe(1)
    expect(process.summary.reflectionCoverage).toBe(1)
    expect(process.summary.reflectionsPerEpisode).toBe(1)
  })

  it('renders an empty timeline for a window with no episode', () => {
    const window = rangeWindow('day', NOW, 0)
    const report = buildReport({
      range: 'day',
      now: NOW,
      records: [],
      configured: [],
      registry: new Set(),
      config: { idleGapMinutes: 30, minEpisodes: 1, hypotheses: [] },
    })
    const process = report.process
    expect(process.from).toBe(window.from)
    expect(process.to).toBe(window.to)
    expect(process.workers).toEqual([])
    expect(process.decomposition).toEqual([])
    expect(process.reflections).toEqual([])
    expect(process.concurrency).toEqual([])
    expect(process.stepRate).toHaveLength(report.bucketLabels.length)
    expect(process.stepRate.every((bucket) => bucket.steps === 0)).toBe(true)
    // The day range carries the aggregate bucket bounds; the last bucket is truncated at now.
    expect(process.stepRate[0]).toEqual({ from: window.from, to: window.buckets[0]?.to, steps: 0 })
    expect(process.summary).toEqual({
      episodes: 0,
      workers: 0,
      episodesWithWorker: 0,
      activations: 0,
      maxConcurrency: 0,
      timeToFirstWorker: { p50: 0, p90: 0, n: 0 },
      reflections: 0,
      stepsBetweenReflections: { p50: 0, p90: 0, n: 0 },
      decompositionObserved: false,
    })
    expect(process.comparison).toBeUndefined()
  })

  it('clips a spanning worker to the window and counts only in-window activations', () => {
    const window = rangeWindow('day', NOW, 0)
    const report = buildReport({
      range: 'day',
      now: NOW,
      records: [
        ...extractRecords('parent', [
          human(window.from - 10 * MINUTE),
          stepStart(window.from + 2 * MINUTE, 1),
          closer(window.from + 10 * MINUTE),
        ]),
        ...extractRecords('child', [
          stepStart(window.from - 5 * MINUTE, 1),
          closer(window.from + 5 * MINUTE),
        ]),
      ],
      configured: [],
      registry: new Set(),
      sessions: [meta('parent'), meta('child', 'parent')],
      config: { idleGapMinutes: 30, minEpisodes: 1, hypotheses: [] },
    })
    const process = report.process
    expect(process.from).toBe(window.from)
    expect(process.to).toBe(window.to)
    expect(process.workers).toEqual([
      {
        sessionId: 'child',
        episodeId: 'parent#1',
        from: window.from,
        to: window.from + 5 * MINUTE,
      },
    ])
    expect(process.summary.workers).toBe(1)
    expect(process.summary.activations).toBe(0)
    expect(process.decomposition).toEqual([])
    expect(process.stepRate).toHaveLength(report.bucketLabels.length)
    // Only the step that started inside the window counts; bounds are the calendar buckets.
    expect(process.stepRate.reduce((sum, bucket) => sum + bucket.steps, 0)).toBe(1)
    expect(process.stepRate[0]).toEqual({ from: window.from, to: window.buckets[0]?.to, steps: 1 })
  })
})

describe('reflection markers', () => {
  it('marks one reflection with the steps since the episode start', () => {
    const start = NOW - 20 * MINUTE
    const report = build({
      sessions: {
        parent: [
          human(start),
          stepStart(start + MINUTE, 1),
          stepStart(start + 2 * MINUTE, 2),
          checkpoint(start + 3 * MINUTE, 'done'),
          closer(start + 4 * MINUTE),
        ],
      },
      metas: [meta('parent')],
    })
    const process = report.process
    expect(process.reflections).toEqual([
      { time: start + 3 * MINUTE, episodeId: 'parent#1', outcome: 'done', stepsSince: 2 },
    ])
    expect(process.summary.reflections).toBe(1)
    expect(process.summary.stepsBetweenReflections).toEqual({ p50: 2, p90: 2, n: 1 })
    expect(process.summary.reflectionsPerEpisode).toBe(1)
    expect(process.summary.reflectionCoverage).toBe(1)
  })

  it('marks two reflections and distributes the steps between them', () => {
    const start = NOW - 20 * MINUTE
    const report = build({
      sessions: {
        parent: [
          human(start),
          stepStart(start + MINUTE, 1),
          stepStart(start + 2 * MINUTE, 2),
          checkpoint(start + 3 * MINUTE, 'done'),
          stepStart(start + 4 * MINUTE, 3),
          stepStart(start + 5 * MINUTE, 4),
          stepStart(start + 6 * MINUTE, 5),
          checkpoint(start + 7 * MINUTE, 'continue'),
          closer(start + 8 * MINUTE),
        ],
      },
      metas: [meta('parent')],
    })
    const process = report.process
    expect(process.reflections.map((marker) => marker.stepsSince)).toEqual([2, 3])
    expect(process.reflections[1]?.outcome).toBe('continue')
    expect(process.summary.stepsBetweenReflections).toEqual({ p50: 2, p90: 3, n: 2 })
    expect(process.summary.reflectionsPerEpisode).toBe(2)
    expect(process.summary.reflectionCoverage).toBe(1)
  })

  it('shows a reflection after a long step gap', () => {
    const start = NOW - 20 * MINUTE
    const gap = Array.from({ length: 12 }, (_unused, index) =>
      stepStart(start + (index + 3) * MINUTE, index + 3),
    )
    const report = build({
      sessions: {
        parent: [
          human(start),
          stepStart(start + MINUTE, 1),
          checkpoint(start + 2 * MINUTE, 'done'),
          ...gap,
          checkpoint(start + 15 * MINUTE, 'continue'),
          closer(start + 16 * MINUTE),
        ],
      },
      metas: [meta('parent')],
    })
    const process = report.process
    expect(process.reflections.map((marker) => marker.stepsSince)).toEqual([1, 12])
    expect(process.summary.stepsBetweenReflections.p90).toBe(12)
    expect(process.summary.stepsBetweenReflections.n).toBe(2)
  })

  it('excludes a malformed checkpoint from markers, cadence, and coverage', () => {
    const start = NOW - 30 * MINUTE
    const report = build({
      sessions: {
        parent: [
          human(start),
          stepStart(start + MINUTE, 1),
          stepStart(start + 2 * MINUTE, 2),
          checkpoint(start + 3 * MINUTE, 'done'),
          stepStart(start + 4 * MINUTE, 3),
          stepStart(start + 5 * MINUTE, 4),
          checkpoint(start + 6 * MINUTE, undefined),
          stepStart(start + 7 * MINUTE, 5),
          checkpoint(start + 8 * MINUTE, 'continue'),
          closer(start + 9 * MINUTE),
          human(start + 20 * MINUTE),
          stepStart(start + 21 * MINUTE, 6),
          checkpoint(start + 22 * MINUTE, undefined),
          closer(start + 23 * MINUTE),
        ],
      },
      metas: [meta('parent')],
    })
    const process = report.process
    // The malformed call is not a marker: it neither resets the 3-step cadence
    // after the first reflection nor covers the episode that only holds one.
    expect(process.reflections.map((marker) => marker.stepsSince)).toEqual([2, 3])
    expect(process.reflections.map((marker) => marker.outcome)).toEqual(['done', 'continue'])
    expect(
      process.reflections.some(
        (marker) => marker.time === start + 6 * MINUTE || marker.time === start + 22 * MINUTE,
      ),
    ).toBe(false)
    expect(process.summary.episodes).toBe(2)
    expect(process.summary.reflectionCoverage).toBe(0.5)
    expect(process.summary.reflectionsPerEpisode).toBe(1)
  })
})

describe('process comparison', () => {
  function twoEpisodes(start: number): BuildOptions {
    return {
      sessions: {
        parent: [
          human(start),
          stepStart(start + MINUTE, 1),
          closer(start + 10 * MINUTE),
          human(start + 20 * MINUTE),
          stepStart(start + 21 * MINUTE, 1),
          closer(start + 30 * MINUTE),
        ],
        'child-a': [stepStart(start + 3 * MINUTE, 1), closer(start + 6 * MINUTE)],
        'child-b': [stepStart(start + 23 * MINUTE, 1), closer(start + 26 * MINUTE)],
      },
      metas: [meta('parent'), meta('child-a', 'parent'), meta('child-b', 'parent')],
    }
  }

  it('splits the episodes at the configured date and prints it', () => {
    const start = NOW - 60 * MINUTE
    const interventionAt = start + 15 * MINUTE
    const report = build({ ...twoEpisodes(start), interventionAt, minEpisodes: 1 })
    const comparison = report.process.comparison
    expect(comparison?.basis).toBe('intervention date')
    expect(comparison?.interventionAt).toBe(interventionAt)
    expect(comparison?.status).toBe('association')
    expect(comparison?.label).toBe('association, not proof')
    expect(comparison?.minEpisodes).toBe(1)
    expect(comparison?.before.summary.episodes).toBe(1)
    expect(comparison?.after.summary.episodes).toBe(1)
    expect(comparison?.before.summary.workers).toBe(1)
    expect(comparison?.after.summary.workers).toBe(1)
  })

  it('reads insufficient data below the configured minimum on either side', () => {
    const start = NOW - 60 * MINUTE
    const report = build({
      ...twoEpisodes(start),
      interventionAt: start + 15 * MINUTE,
      minEpisodes: 2,
    })
    const comparison = report.process.comparison
    expect(comparison?.status).toBe('insufficient')
    expect(comparison?.label).toBe('insufficient data')
    expect(comparison?.before.summary.episodes).toBe(1)
    expect(comparison?.after.summary.episodes).toBe(1)
  })

  it('names the previous completed session as the baseline for the session range', () => {
    const start = NOW - 20 * MINUTE
    const report = build({
      sessions: { current: parentEpisode(start, start + 10 * MINUTE) },
      metas: [meta('current')],
      minEpisodes: 1,
      baseline: {
        kind: 'previous completed session',
        sessions: {
          previous: [
            human(start - 20 * MINUTE),
            stepStart(start - 19 * MINUTE, 1),
            checkpoint(start - 18 * MINUTE, 'done'),
            closer(start - 10 * MINUTE),
          ],
        },
        metas: [meta('previous')],
        from: start - 20 * MINUTE,
        to: start - 9 * MINUTE,
      },
      range: 'session',
    })
    const comparison = report.process.comparison
    expect(comparison?.basis).toBe('previous completed session')
    expect(comparison?.interventionAt).toBeUndefined()
    expect(comparison?.label).toBe('association, not proof')
    expect(comparison?.before.summary.episodes).toBe(1)
    expect(comparison?.after.summary.episodes).toBe(1)
    expect(comparison?.before.summary.reflections).toBe(1)
    expect(comparison?.after.summary.reflections).toBe(0)
  })
})

describe('process metadata only', () => {
  it('never carries message text, arguments, objectives, or checkpoint list text', () => {
    const secret = 'SECRET-PROCESS-TOKEN'
    const start = NOW - 10 * MINUTE
    const report = build({
      sessions: {
        parent: [
          event(
            'user/message',
            {
              role: 'user',
              content: [{ type: 'text', text: secret }],
              source: { kind: 'user' },
            },
            start,
          ),
          stepStart(start + MINUTE, 1),
          event(
            'tool/call',
            {
              turn: 1,
              step: 1,
              callId: 'edit-1',
              name: 'edit',
              arguments: JSON.stringify({ path: secret }),
            },
            start + 2 * MINUTE,
          ),
          event(
            'goal/change',
            {
              kind: 'goal/change',
              operation: 'create',
              goal: { id: 'g1', revision: 1, objective: secret, phase: 'active' },
              roundsStarted: 0,
            },
            start + 3 * MINUTE,
          ),
          event(
            'tool/call',
            {
              turn: 1,
              step: 1,
              callId: 'cp-1',
              name: 'work_checkpoint',
              arguments: JSON.stringify({
                outcome: 'done',
                verified: [secret],
                remaining: [secret],
                next: secret,
              }),
            },
            start + 4 * MINUTE,
          ),
          closer(start + 5 * MINUTE),
        ],
      },
      metas: [meta('parent')],
    })
    // The marker proves the checkpoint path ran; only its outcome word survives.
    expect(report.process.reflections[0]?.outcome).toBe('done')
    expect(JSON.stringify(report.process)).not.toContain(secret)
    expect(JSON.stringify(report)).not.toContain(secret)
  })
})

describe('interventionAt configuration', () => {
  it('parses an ISO date and reads absent as unset', () => {
    expect(parseConfig({ interventionAt: '2026-10-30T00:00:00Z' }).interventionAt).toBe(
      Date.parse('2026-10-30T00:00:00Z'),
    )
    expect(parseConfig({ interventionAt: '2026-10-30' }).interventionAt).toBe(
      Date.parse('2026-10-30'),
    )
    expect(parseConfig({}).interventionAt).toBeUndefined()
  })

  it('rejects a malformed date by name', () => {
    expect(() => parseConfig({ interventionAt: 'not-a-date' })).toThrow('config.interventionAt')
    expect(() => parseConfig({ interventionAt: '' })).toThrow('config.interventionAt')
    expect(() => parseConfig({ interventionAt: 123 })).toThrow('config.interventionAt')
    // Non-ISO formats are not silently accepted.
    expect(() => parseConfig({ interventionAt: '10/11/2026' })).toThrow('config.interventionAt')
    // An impossible calendar day must not roll into the next month.
    expect(() => parseConfig({ interventionAt: '2026-02-30T00:00:00Z' })).toThrow(
      'config.interventionAt',
    )
    expect(() => parseConfig({ interventionAt: '2026-13-01T00:00:00Z' })).toThrow(
      'config.interventionAt',
    )
    expect(() => parseConfig({ interventionAt: '2026-10-30T25:00:00Z' })).toThrow(
      'config.interventionAt',
    )
  })
})
