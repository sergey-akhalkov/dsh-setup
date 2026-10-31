import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionEventRecord,
  SessionLogSnapshot,
  SessionRecord,
} from '@deepseek-ai/dsh-session-query'
import { describe, expect, it } from 'vitest'
import { SessionCache } from '../src/host/cache.ts'
import { readSessions, type SessionQueryService } from '../src/host/reader.ts'

const NOW = new Date(2026, 9, 31, 12, 30).getTime()
const HOUR = 3_600_000

let seq = 0

function event(type: string, time: number, data: Record<string, unknown> = { turn: 1 }) {
  seq += 1
  return { type, seq, time, data }
}

function record(id: string): SessionRecord {
  return {
    header: {
      version: 4,
      id: id as unknown as SessionId,
      createdAt: NOW - 2 * HOUR,
      cwd: '/workspace',
      isSeeded: false,
    } as SessionRecord['header'],
    live: false,
    persisted: true,
  }
}

function snapshot(id: string, events: ReturnType<typeof event>[]): SessionLogSnapshot {
  return {
    session: record(id).header,
    inheritedEventCount: 0 as SessionLogSnapshot['inheritedEventCount'],
    events: events as unknown as SessionLogSnapshot['events'],
  }
}

class FakeQuery implements SessionQueryService {
  reads = 0
  private readonly records: readonly SessionRecord[]
  private snapshots: Map<string, SessionLogSnapshot>

  constructor(records: readonly SessionRecord[], snapshots: Map<string, SessionLogSnapshot>) {
    this.records = records
    this.snapshots = snapshots
  }

  async listSessions(): Promise<SessionRecord[]> {
    return [...this.records]
  }

  async listEvents(sessionId: SessionId): Promise<SessionEventRecord[]> {
    return (this.snapshots.get(String(sessionId))?.events ?? []).map((value) => ({
      sessionId,
      seq: value.seq,
      type: value.type,
      time: value.time,
      surface: 'log-only',
    })) as unknown as SessionEventRecord[]
  }

  async readSession(sessionId: SessionId): Promise<SessionLogSnapshot> {
    this.reads += 1
    const snapshot = this.snapshots.get(String(sessionId))
    if (snapshot === undefined) throw new Error('missing session')
    return snapshot
  }

  append(sessionId: string, value: ReturnType<typeof event>): void {
    const current = this.snapshots.get(sessionId)
    if (current === undefined) return
    this.snapshots.set(sessionId, {
      ...current,
      events: [...current.events, value] as SessionLogSnapshot['events'],
    })
  }
}

function single(): { query: FakeQuery; id: SessionId } {
  const id = 'session-1' as unknown as SessionId
  const query = new FakeQuery(
    [record('session-1')],
    new Map([['session-1', snapshot('session-1', [event('turn/start', NOW - HOUR)])]]),
  )
  return { query, id }
}

describe('per-session cache', () => {
  it('serves a repeated unchanged request without re-reading the session', async () => {
    const { query, id } = single()
    const cache = new SessionCache()
    await readSessions({ query, range: 'session', now: NOW, sessionId: id, cache })
    await readSessions({ query, range: 'session', now: NOW, sessionId: id, cache })
    expect(query.reads).toBe(1)

    const wide = single()
    const wideCache = new SessionCache()
    await readSessions({
      query: wide.query,
      range: 'day',
      now: NOW,
      sessionId: wide.id,
      cache: wideCache,
    })
    await readSessions({
      query: wide.query,
      range: 'day',
      now: NOW,
      sessionId: wide.id,
      cache: wideCache,
    })
    expect(wide.query.reads).toBe(1)
  })

  it('re-reads a session whose modification time changed', async () => {
    const { query, id } = single()
    const cache = new SessionCache()
    await readSessions({ query, range: 'session', now: NOW, sessionId: id, cache })
    query.append('session-1', event('step/start', NOW - 30 * 60_000))
    const { records } = await readSessions({
      query,
      range: 'session',
      now: NOW,
      sessionId: id,
      cache,
    })
    expect(query.reads).toBe(2)
    expect(records.some((value) => value.eventType === 'step/start')).toBe(true)
  })

  it('keeps nothing between instances: a new cache re-reads', async () => {
    const { query, id } = single()
    await readSessions({
      query,
      range: 'session',
      now: NOW,
      sessionId: id,
      cache: new SessionCache(),
    })
    await readSessions({
      query,
      range: 'session',
      now: NOW,
      sessionId: id,
      cache: new SessionCache(),
    })
    expect(query.reads).toBe(2)
  })

  it('is bounded and evicts the least recently used session', () => {
    const cache = new SessionCache(2)
    cache.set('a', '1', [])
    cache.set('b', '1', [])
    expect(cache.get('a', '1')?.records).toEqual([])
    cache.set('c', '1', [])
    expect(cache.size).toBe(2)
    expect(cache.get('a', '1')?.records).toEqual([])
    expect(cache.get('b', '1')).toBeUndefined()
    expect(cache.get('c', '1')?.records).toEqual([])
    expect(cache.get('a', '2')).toBeUndefined()
  })

  it('writes nothing to disk while caching a report', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'dsh-obs-cache-'))
    const before = process.cwd()
    try {
      process.chdir(temp)
      const { query, id } = single()
      const cache = new SessionCache()
      await readSessions({ query, range: 'session', now: NOW, sessionId: id, cache })
      await readSessions({ query, range: 'session', now: NOW, sessionId: id, cache })
      expect(cache.size).toBe(1)
      expect(readdirSync(temp)).toEqual([])
    } finally {
      process.chdir(before)
      rmSync(temp, { recursive: true, force: true })
    }
  })

  it('keeps header metadata across a cached repeat when the session is not listed', async () => {
    const id = 'child' as unknown as SessionId
    const childHeader = {
      version: 4,
      id,
      createdAt: NOW - 2 * HOUR,
      cwd: '/workspace',
      parentSession: 'root',
      isSeeded: true,
      origin: 'subagent',
      delegationDepth: 1,
    } as SessionLogSnapshot['session']
    const snapshots = new Map<string, SessionLogSnapshot>([
      [
        'child',
        {
          session: childHeader,
          inheritedEventCount: 0 as SessionLogSnapshot['inheritedEventCount'],
          events: [event('turn/start', NOW - HOUR)] as unknown as SessionLogSnapshot['events'],
        },
      ],
    ])
    const query = new FakeQuery([], snapshots)
    const cache = new SessionCache()
    const first = await readSessions({ query, range: 'session', now: NOW, sessionId: id, cache })
    const second = await readSessions({ query, range: 'session', now: NOW, sessionId: id, cache })
    const expected = [
      { id: 'child', parentSession: 'root', origin: 'subagent', delegationDepth: 1 },
    ]
    expect(first.sessions).toEqual(expected)
    expect(second.sessions).toEqual(expected)
    expect(second.records).toEqual(first.records)
    expect(query.reads).toBe(1)
  })

  it('rejects an invalid capacity instead of silently caching nothing', () => {
    expect(() => new SessionCache(0)).toThrow('positive integer')
  })
})
