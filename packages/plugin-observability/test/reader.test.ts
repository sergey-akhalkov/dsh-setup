import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionEventRecord,
  SessionLogSnapshot,
  SessionRecord,
} from '@deepseek-ai/dsh-session-query'
import { describe, expect, it } from 'vitest'
import { aggregate } from '../src/host/aggregate.ts'
import { builtinRows } from '../src/host/builtins.ts'
import { readSessions, type SessionQueryService } from '../src/host/reader.ts'

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
  } as SessionRecord['header']
}

function record(id: string, cwd: string | undefined, parentSession?: string): SessionRecord {
  return {
    header: header(id, cwd, parentSession),
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

describe('session reader', () => {
  it('reads the open session only for the session range', async () => {
    const { query } = workspace()
    const records = await readSessions({
      query,
      range: 'session',
      now: NOW,
      sessionId: 'parent' as unknown as SessionId,
    })
    expect(query.calls.map((call) => call.id)).toEqual(['parent'])
    expect(records.filter((value) => value.eventType === 'tool/call')).toHaveLength(1)
  })

  it('selects only workspace sessions whose events fall in the window', async () => {
    const { query } = workspace()
    const records = await readSessions({
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
    const records = await readSessions({
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
    const records = await readSessions({
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
    const records = await readSessions({
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
    const records = await readSessions({
      query,
      range: 'day',
      now: NOW,
      sessionId: 'parent' as unknown as SessionId,
    })
    expect(records.filter((value) => value.sessionId === 'child')).toHaveLength(1)
  })
})
