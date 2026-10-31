import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionEventRecord,
  SessionLogSnapshot,
  SessionRecord,
} from '@deepseek-ai/dsh-session-query'
import { describe, expect, it } from 'vitest'
import { aggregate, rangeWindow } from '../src/host/aggregate.ts'
import { builtinRows } from '../src/host/builtins.ts'
import { SessionCache } from '../src/host/cache.ts'
import { readBaseline, readSessions, type SessionQueryService } from '../src/host/reader.ts'
import { buildReport } from '../src/host/report.ts'

const NOW = new Date(2026, 9, 31, 12, 30).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR

let seq = 0

function event(type: string, data: Record<string, unknown>, time: number) {
  seq += 1
  return { type, seq, time, data }
}

function header(
  id: string,
  cwd: string | undefined,
  parentSession?: string,
  createdAt = NOW - 2 * HOUR,
  extra: { origin?: 'subagent'; delegationDepth?: number } = {},
): SessionRecord['header'] {
  return {
    version: 4,
    id: id as unknown as SessionId,
    createdAt,
    ...(cwd === undefined ? {} : { cwd }),
    ...(parentSession === undefined
      ? {}
      : { parentSession: parentSession as unknown as SessionId }),
    isSeeded: parentSession !== undefined,
    ...extra,
  } as SessionRecord['header']
}

function record(
  id: string,
  cwd: string | undefined,
  parentSession?: string,
  extra: { origin?: 'subagent'; delegationDepth?: number } = {},
): SessionRecord {
  return {
    header: header(id, cwd, parentSession, NOW - 2 * HOUR, extra),
    live: false,
    persisted: true,
  }
}

function snapshot(
  id: string,
  events: ReturnType<typeof event>[],
  inheritedEventCount = 0,
  cwd = '/workspace',
): SessionLogSnapshot {
  return {
    session: header(id, cwd),
    inheritedEventCount: inheritedEventCount as SessionLogSnapshot['inheritedEventCount'],
    events: events as unknown as SessionLogSnapshot['events'],
  }
}

interface FakeCall {
  readonly id: string
  readonly at: number
}

class FakeQuery implements SessionQueryService {
  readonly calls: FakeCall[] = []
  readonly listed: string[] = []
  maxConcurrentReads = 0
  private concurrentReads = 0
  private readonly sessions: readonly SessionRecord[]
  private readonly snapshots: ReadonlyMap<string, SessionLogSnapshot>
  private readonly delay: number

  constructor(
    sessions: readonly SessionRecord[],
    snapshots: ReadonlyMap<string, SessionLogSnapshot>,
    delay = 0,
  ) {
    this.sessions = sessions
    this.snapshots = snapshots
    this.delay = delay
  }

  async listSessions(): Promise<SessionRecord[]> {
    return [...this.sessions]
  }

  async listEvents(sessionId: SessionId): Promise<SessionEventRecord[]> {
    const snapshot = this.snapshots.get(String(sessionId))
    return (snapshot?.events ?? []).map((value) => ({
      sessionId,
      seq: value.seq,
      type: value.type,
      time: value.time,
      surface: 'log-only',
    })) as unknown as SessionEventRecord[]
  }

  async readSession(sessionId: SessionId): Promise<SessionLogSnapshot> {
    this.calls.push({ id: String(sessionId), at: Date.now() })
    this.concurrentReads += 1
    this.maxConcurrentReads = Math.max(this.maxConcurrentReads, this.concurrentReads)
    try {
      if (this.delay > 0) await new Promise((resolve) => setTimeout(resolve, this.delay))
      const snapshot = this.snapshots.get(String(sessionId))
      if (snapshot === undefined) throw new Error(`missing session ${String(sessionId)}`)
      return snapshot
    } finally {
      this.concurrentReads -= 1
    }
  }
}

function workspace(): { query: FakeQuery; parentEvents: ReturnType<typeof event>[] } {
  const parentEvents = [
    event('turn/start', { turn: 1 }, NOW - HOUR),
    event(
      'tool/call',
      { turn: 1, step: 1, callId: 'p1', name: 'delegate', arguments: '{}' },
      NOW - HOUR,
    ),
  ]
  const childOwn = event(
    'tool/call',
    { turn: 1, step: 1, callId: 'c1', name: 'task_progress', arguments: '{}' },
    NOW - 30 * 60_000,
  )
  const sessions = [
    record('parent', '/workspace'),
    record('child', '/workspace', 'parent'),
    record('foreign', '/other'),
    record('old', '/workspace'),
  ]
  const snapshots = new Map<string, SessionLogSnapshot>([
    ['parent', snapshot('parent', parentEvents)],
    ['child', snapshot('child', [...parentEvents, childOwn], parentEvents.length)],
    [
      'foreign',
      snapshot('foreign', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)], 0, '/other'),
    ],
    ['old', snapshot('old', [event('turn/start', { turn: 1 }, NOW - 10 * DAY)])],
  ])
  return { query: new FakeQuery(sessions, snapshots), parentEvents }
}

describe('baseline reader', () => {
  it('reads the previous equal window through the same query and reuses the cache', async () => {
    const window = rangeWindow('day', NOW, 0)
    const sessions = [record('prev', '/workspace'), record('now', '/workspace')]
    const snapshots = new Map<string, SessionLogSnapshot>([
      [
        'prev',
        snapshot('prev', [event('step/start', { turn: 1, step: 1 }, window.from - 2 * HOUR)]),
      ],
      ['now', snapshot('now', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)])],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const cache = new SessionCache()
    const first = await readBaseline({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'now' as unknown as SessionId,
      cache,
      windowFrom: window.from,
      windowTo: window.to,
    })
    expect(first?.kind).toBe('previous equal window')
    // Same duration as the current window, ending where it begins.
    expect(first?.from).toBe(window.from - (window.to - window.from))
    expect(first?.to).toBe(window.from)
    expect(first?.records.every((value) => value.sessionId === 'prev')).toBe(true)
    const reads = query.calls.length
    const second = await readBaseline({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'now' as unknown as SessionId,
      cache,
      windowFrom: window.from,
      windowTo: window.to,
    })
    expect(second?.records).toHaveLength(first?.records.length ?? 0)
    // An unchanged previous window is served from the in-memory cache.
    expect(query.calls.length).toBe(reads)
  })

  it('returns no baseline when the previous window holds nothing', async () => {
    const window = rangeWindow('day', NOW, 0)
    const sessions = [record('now', '/workspace')]
    const snapshots = new Map<string, SessionLogSnapshot>([
      ['now', snapshot('now', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)])],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const baseline = await readBaseline({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'now' as unknown as SessionId,
      windowFrom: window.from,
      windowTo: window.to,
    })
    expect(baseline).toBeUndefined()
  })

  it('uses an equal-length previous window for a week and a month', async () => {
    for (const range of ['week', 'month'] as const) {
      const window = rangeWindow(range, NOW, 0)
      const length = window.to - window.from
      const sessions = [record('now', '/workspace'), record('prev', '/workspace')]
      const snapshots = new Map<string, SessionLogSnapshot>([
        ['now', snapshot('now', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)])],
        [
          'prev',
          snapshot('prev', [
            event('step/start', { turn: 1, step: 1 }, window.from - length + HOUR),
          ]),
        ],
      ])
      const query = new FakeQuery(sessions, snapshots)
      const baseline = await readBaseline({
        query,
        range,
        now: NOW,
        sessionId: 'now' as unknown as SessionId,
        windowFrom: window.from,
        windowTo: window.to,
      })
      expect(baseline?.from, range).toBe(window.from - length)
      expect(baseline?.to, range).toBe(window.from)
      expect(
        baseline?.records.every((value) => value.sessionId === 'prev'),
        range,
      ).toBe(true)
    }
  })

  it('skips an unfinished session for the previous completed session', async () => {
    const sessions = [
      record('current', '/workspace'),
      record('earlier', '/workspace'),
      record('unfinished', '/workspace'),
    ]
    const snapshots = new Map<string, SessionLogSnapshot>([
      ['current', snapshot('current', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)])],
      [
        'earlier',
        snapshot('earlier', [
          event('step/start', { turn: 1, step: 1 }, NOW - 6 * HOUR),
          event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 5 * HOUR),
        ]),
      ],
      [
        'unfinished',
        snapshot('unfinished', [
          event('step/start', { turn: 1, step: 1 }, NOW - 4 * HOUR),
          event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 3 * HOUR),
          // A later turn opened and never closed.
          event('turn/start', { turn: 2 }, NOW - 2 * HOUR),
        ]),
      ],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const baseline = await readBaseline({
      query,
      range: 'session',
      now: NOW,
      sessionId: 'current' as unknown as SessionId,
      windowFrom: 0,
      windowTo: 1,
    })
    expect(baseline?.sessions.map((meta) => meta.id)).toEqual(['earlier'])
  })

  it('returns no baseline for an empty previous period between episodes', async () => {
    const window = rangeWindow('day', NOW, 0)
    const sessions = [record('now', '/workspace'), record('spans', '/workspace')]
    const snapshots = new Map<string, SessionLogSnapshot>([
      ['now', snapshot('now', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)])],
      [
        'spans',
        snapshot('spans', [
          event('step/start', { turn: 1, step: 1 }, window.from - 2 * 24 * HOUR),
          event('step/start', { turn: 1, step: 2 }, window.from + HOUR),
        ]),
      ],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const baseline = await readBaseline({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'now' as unknown as SessionId,
      windowFrom: window.from,
      windowTo: window.to,
    })
    // The previous window has no event and no interval crossing it.
    expect(baseline).toBeUndefined()
  })

  it('uses the previous completed session for the session range', async () => {
    const sessions = [record('current', '/workspace'), record('previous', '/workspace')]
    const snapshots = new Map<string, SessionLogSnapshot>([
      ['current', snapshot('current', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)])],
      [
        'previous',
        snapshot('previous', [
          event('step/start', { turn: 1, step: 1 }, NOW - 3 * HOUR),
          event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 2 * HOUR),
        ]),
      ],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const baseline = await readBaseline({
      query,
      range: 'session',
      now: NOW,
      sessionId: 'current' as unknown as SessionId,
      windowFrom: 0,
      windowTo: 1,
    })
    expect(baseline?.kind).toBe('previous completed session')
    expect(baseline?.sessions.map((meta) => meta.id)).toEqual(['previous'])
    expect(baseline?.records.every((value) => value.sessionId === 'previous')).toBe(true)
  })

  it('returns no session baseline without an earlier completed session', async () => {
    const sessions = [record('current', '/workspace'), record('open', '/workspace')]
    const snapshots = new Map<string, SessionLogSnapshot>([
      ['current', snapshot('current', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)])],
      ['open', snapshot('open', [event('step/start', { turn: 1, step: 1 }, NOW - 3 * HOUR)])],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const baseline = await readBaseline({
      query,
      range: 'session',
      now: NOW,
      sessionId: 'current' as unknown as SessionId,
      windowFrom: 0,
      windowTo: 1,
    })
    expect(baseline).toBeUndefined()
  })
})

describe('session reader', () => {
  it('reads the open session and its descendants for the session range', async () => {
    const { query } = workspace()
    const { records, sessions } = await readSessions({
      query,
      range: 'session',
      now: NOW,
      sessionId: 'parent' as unknown as SessionId,
    })
    expect(query.calls.map((call) => call.id).sort()).toEqual(['child', 'parent'])
    expect(sessions.map((meta) => meta.id).sort()).toEqual(['child', 'parent'])
    expect(sessions.find((meta) => meta.id === 'child')?.parentSession).toBe('parent')
    const toolCalls = records.filter((value) => value.eventType === 'tool/call')
    expect(toolCalls.map((value) => value.tool).sort()).toEqual(['delegate', 'task_progress'])
  })

  it('builds a session report containing the child episode', async () => {
    const sessions = [record('parent', '/workspace'), record('child', '/workspace', 'parent')]
    const parentEvents = [
      event('user/message', { role: 'user', content: [], source: { kind: 'user' } }, NOW - HOUR),
      event('step/start', { turn: 1, step: 1 }, NOW - 55 * 60_000),
      event('step/end', { turn: 1, step: 1 }, NOW - 50 * 60_000),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 30 * 60_000),
    ]
    const childEvents = [
      event('step/start', { turn: 1, step: 1 }, NOW - 50 * 60_000),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, NOW - 40 * 60_000),
    ]
    const snapshots = new Map<string, SessionLogSnapshot>([
      ['parent', snapshot('parent', parentEvents)],
      ['child', snapshot('child', childEvents)],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const { records, sessions: metas } = await readSessions({
      query,
      range: 'session',
      now: NOW,
      sessionId: 'parent' as unknown as SessionId,
    })
    const report = buildReport({
      range: 'session',
      now: NOW,
      records,
      sessions: metas,
      configured: [],
      registry: new Set(),
    })
    const episode = report.episodes.find((entry) => entry.sessionId === 'parent')
    expect(episode?.children.map((child) => child.sessionId)).toEqual(['child'])
  })

  it('carries parent, origin, and delegation depth without path or preset text', async () => {
    const headers = [
      record('root', '/workspace'),
      record('sub', '/workspace', 'root', { origin: 'subagent', delegationDepth: 1 }),
      record('team', '/workspace', 'root', { delegationDepth: 1 }),
      record('orphan', '/workspace', 'outside', { origin: 'subagent', delegationDepth: 1 }),
    ]
    const snapshots = new Map<string, SessionLogSnapshot>(
      headers.map((entry) => [
        String(entry.header.id),
        snapshot(String(entry.header.id), [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)]),
      ]),
    )
    const query = new FakeQuery(headers, snapshots)
    const { sessions } = await readSessions({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'root' as unknown as SessionId,
    })
    const byId = new Map(sessions.map((meta) => [meta.id, meta]))
    expect(byId.get('root')).toEqual({ id: 'root' })
    expect(byId.get('sub')).toMatchObject({
      parentSession: 'root',
      origin: 'subagent',
      delegationDepth: 1,
    })
    expect(byId.get('team')).toMatchObject({ parentSession: 'root', delegationDepth: 1 })
    expect(byId.get('orphan')).toMatchObject({ parentSession: 'outside', origin: 'subagent' })
    // The header carries a cwd and a preset; neither reaches the report input.
    expect(JSON.stringify(sessions)).not.toContain('/workspace')
  })

  it('selects only workspace sessions whose events fall in the window', async () => {
    const { query } = workspace()
    const { records } = await readSessions({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'parent' as unknown as SessionId,
    })
    expect(query.calls.map((call) => call.id).sort()).toEqual(['child', 'parent'])
    const toolCalls = records.filter((value) => value.eventType === 'tool/call')
    expect(toolCalls.map((value) => value.tool).sort()).toEqual(['delegate', 'task_progress'])
  })

  it('includes a subagent child and counts its own work once', async () => {
    const { query } = workspace()
    const { records } = await readSessions({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'parent' as unknown as SessionId,
    })
    const child = records.filter((value) => value.sessionId === 'child')
    expect(child).toHaveLength(1)
    expect(child[0]?.tool).toBe('task_progress')

    const tools = aggregate(records, builtinRows(records), 'day', NOW)
    const calls = (tools.rows.get('activity.tool-calls')?.counts ?? []).reduce(
      (sum, count) => sum + count,
      0,
    )
    expect(calls).toBe(2)
  })

  it('scopes a cwd-less child to its lineage instead of every workspace', async () => {
    const sessions = [
      record('parent', '/workspace'),
      record('child', undefined, 'parent'),
      record('peer', '/workspace'),
      record('stranger', undefined),
      record('foreign', '/other'),
    ]
    const snapshots = new Map<string, SessionLogSnapshot>([
      [
        'parent',
        snapshot('parent', [event('turn/start', { turn: 1 }, NOW - HOUR)], 0, '/workspace'),
      ],
      ['child', snapshot('child', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)], 0, '')],
      [
        'peer',
        snapshot('peer', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)], 0, '/workspace'),
      ],
      [
        'stranger',
        snapshot('stranger', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)], 0, ''),
      ],
      [
        'foreign',
        snapshot('foreign', [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)], 0, '/other'),
      ],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const { records } = await readSessions({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'child' as unknown as SessionId,
    })
    // The cwd-less child resolves its workspace through the parent: the parent
    // and its independent peer both count, while unrelated sessions do not.
    expect(query.calls.map((call) => call.id).sort()).toEqual(['child', 'parent', 'peer'])
    expect(
      records.every(
        (value) =>
          value.sessionId === 'parent' || value.sessionId === 'child' || value.sessionId === 'peer',
      ),
    ).toBe(true)
  })

  it('reads sessions with bounded concurrency', async () => {
    const many: SessionRecord[] = []
    const snapshots = new Map<string, SessionLogSnapshot>()
    for (let index = 0; index < 8; index += 1) {
      many.push(record(`s${index}`, '/workspace'))
      snapshots.set(
        `s${index}`,
        snapshot(`s${index}`, [event('step/start', { turn: 1, step: 1 }, NOW - HOUR)]),
      )
    }
    const query = new FakeQuery(many, snapshots, 5)
    const { records } = await readSessions({
      query,
      range: 'day',
      now: NOW,
      sessionId: 's0' as unknown as SessionId,
      concurrency: 3,
    })
    expect(records).toHaveLength(8)
    expect(query.maxConcurrentReads).toBeLessThanOrEqual(3)
  })

  it('keeps an inherited fork prefix out of the child contribution', async () => {
    const { query } = workspace()
    const { records, sessions } = await readSessions({
      query,
      range: 'session',
      now: NOW,
      sessionId: 'parent' as unknown as SessionId,
    })
    expect(records.filter((value) => value.sessionId === 'child')).toHaveLength(1)
    expect(sessions.map((meta) => meta.id).sort()).toEqual(['child', 'parent'])
  })

  it('reads a session whose events bracket the window without an event inside it', async () => {
    const window = rangeWindow('day', NOW, 0)
    const minute = 60_000
    const sessions = [record('bracket', '/workspace')]
    const snapshots = new Map<string, SessionLogSnapshot>([
      [
        'bracket',
        snapshot('bracket', [
          event('step/start', { turn: 1, step: 1 }, window.from - minute),
          event('step/end', { turn: 1, step: 1 }, window.to + minute),
        ]),
      ],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const { records } = await readSessions({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'bracket' as unknown as SessionId,
    })
    expect(query.calls.map((call) => call.id)).toEqual(['bracket'])
    expect(records).toHaveLength(2)
  })

  it('reads the parent chain when only a child overlaps the window', async () => {
    const parentEvents = [event('user/message', { source: { kind: 'user' } }, NOW - 26 * HOUR)]
    const childOwn = [
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' },
        NOW - 2 * HOUR,
      ),
    ]
    const sessions = [record('parent', '/workspace'), record('child', '/workspace', 'parent')]
    const snapshots = new Map<string, SessionLogSnapshot>([
      ['parent', snapshot('parent', parentEvents)],
      ['child', snapshot('child', childOwn)],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const { records, sessions: meta } = await readSessions({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'parent' as unknown as SessionId,
    })
    expect(query.calls.map((call) => call.id).sort()).toEqual(['child', 'parent'])
    expect(meta.map((entry) => entry.id).sort()).toEqual(['child', 'parent'])
    // The parent's human message predates the window but is read for the episode.
    expect(records.filter((value) => value.sessionId === 'parent')).toHaveLength(1)
    expect(records.filter((value) => value.sessionId === 'child')).toHaveLength(1)
  })

  it('reads only the open session when it started no child', async () => {
    const sessions = [record('solo', '/workspace'), record('other', '/other')]
    const snapshots = new Map<string, SessionLogSnapshot>([
      ['solo', snapshot('solo', [event('turn/start', { turn: 1 }, NOW - HOUR)], 0, '/workspace')],
      ['other', snapshot('other', [event('turn/start', { turn: 1 }, NOW - HOUR)], 0, '/other')],
    ])
    const query = new FakeQuery(sessions, snapshots)
    const { sessions: meta } = await readSessions({
      query,
      range: 'session',
      now: NOW,
      sessionId: 'solo' as unknown as SessionId,
    })
    expect(query.calls.map((call) => call.id)).toEqual(['solo'])
    expect(meta.map((entry) => entry.id)).toEqual(['solo'])
  })
})
