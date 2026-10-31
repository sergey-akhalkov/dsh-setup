import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { buildEpisodes, deriveEpisodes, type SessionInput } from '../src/host/episodes.ts'
import { extractRecords } from '../src/host/records.ts'

const MINUTE = 60_000
const IDLE = 30 * MINUTE
const BASE = new Date(2026, 9, 31, 9, 0).getTime()

let seq = 0

function event(type: string, data: Record<string, unknown>, time: number): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

function human(time: number, kind = 'user'): SessionEvent {
  return event('user/message', { role: 'user', content: [], source: { kind } }, time)
}

function step(turn: number, at: number): SessionEvent[] {
  return [
    event('step/start', { turn, step: 1 }, at),
    event('step/end', { turn, step: 1 }, at + MINUTE),
  ]
}

function session(
  id: string,
  events: SessionEvent[],
  parentSession?: string,
  extra: { origin?: string; delegationDepth?: number } = {},
): SessionInput {
  return {
    id,
    records: extractRecords(id, events),
    meta: {
      id,
      ...(parentSession === undefined ? {} : { parentSession }),
      ...extra,
    },
  }
}

function usageEvent(at: number, input: number): SessionEvent {
  return event(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      usage: {
        inputTokens: input,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: input,
      },
    },
    at,
  )
}

function callEvent(callId: string, name: string, at: number): SessionEvent {
  return event('tool/call', { turn: 1, step: 1, callId, name, arguments: '{}' }, at)
}

function resultEvent(callId: string, at: number): SessionEvent {
  return event(
    'tool/result',
    { turn: 1, step: 1, message: { role: 'tool', content: [], source: { kind: 'tool', callId } } },
    at,
  )
}

function closer(kind: string, at: number): SessionEvent {
  return event('turn/end', { turn: 1, reason: { kind } }, at)
}

/** A parent episode from BASE to BASE+20m with one delegate call and 100 input tokens. */
function parentSession(): SessionInput {
  return session('parent', [
    human(BASE),
    usageEvent(BASE + MINUTE, 100),
    callEvent('p1', 'delegate', BASE + 2 * MINUTE),
    resultEvent('p1', BASE + 10 * MINUTE),
    closer('completed', BASE + 20 * MINUTE),
  ])
}

/** A child that starts inside the parent episode and runs 50 input tokens. */
function childSession(id = 'child', parentSession = 'parent', origins = true): SessionInput {
  return session(
    id,
    [
      usageEvent(BASE + 3 * MINUTE, 50),
      callEvent('c1', 'read', BASE + 4 * MINUTE),
      resultEvent('c1', BASE + 5 * MINUTE),
      closer('completed', BASE + 6 * MINUTE),
    ],
    parentSession,
    origins ? { origin: 'subagent', delegationDepth: 1 } : {},
  )
}

describe('child session joins', () => {
  it('joins one child to the parent episode and counts its tokens and tools once', () => {
    const index = buildEpisodes([parentSession(), childSession()], IDLE)
    expect(index.episodes).toHaveLength(1)
    expect(index.unlinked).toEqual([])
    const episode = index.episodes[0]
    expect(episode?.children).toHaveLength(1)
    expect(episode?.children[0]).toMatchObject({
      sessionId: 'child',
      origin: 'subagent',
      delegationDepth: 1,
      outcome: 'completed',
    })
    expect(episode?.children[0]?.usage.input).toBe(50)
    // The parent's own 100 plus the child's 50, each counted once.
    expect(episode?.usage.input).toBe(150)
    expect(episode?.toolCalls).toBe(2)
    expect(episode?.steps).toBe(0)
  })

  it('keeps two overlapping children on the same episode', () => {
    const first = childSession('child-a')
    const second = session(
      'child-b',
      [
        usageEvent(BASE + 4 * MINUTE, 25),
        event('job/registered', {}, BASE + 4 * MINUTE),
        closer('completed', BASE + 12 * MINUTE),
      ],
      'parent',
      { origin: 'subagent', delegationDepth: 1 },
    )
    const episode = buildEpisodes([parentSession(), first, second], IDLE).episodes[0]
    expect(episode?.children.map((child) => child.sessionId).sort()).toEqual(['child-a', 'child-b'])
    expect(episode?.usage.input).toBe(175)
  })

  it('joins a child that recorded a single instant inside the episode', () => {
    const instant = session('instant-child', [usageEvent(BASE + 4 * MINUTE, 50)], 'parent', {
      origin: 'subagent',
      delegationDepth: 1,
    })
    const episode = buildEpisodes([parentSession(), instant], IDLE).episodes[0]
    expect(episode?.children.map((child) => child.sessionId)).toEqual(['instant-child'])
    expect(episode?.usage.input).toBe(150)
  })

  it('joins a child whose own records share one timestamp', () => {
    const shared = session(
      'shared-child',
      [
        usageEvent(BASE + 4 * MINUTE, 30),
        callEvent('c1', 'read', BASE + 4 * MINUTE),
        closer('completed', BASE + 4 * MINUTE),
      ],
      'parent',
      { origin: 'subagent', delegationDepth: 1 },
    )
    const episode = buildEpisodes([parentSession(), shared], IDLE).episodes[0]
    expect(episode?.children.map((child) => child.sessionId)).toEqual(['shared-child'])
    expect(episode?.children[0]?.toolCalls).toBe(1)
    expect(episode?.usage.input).toBe(130)
  })

  it('reports a child outside the parent episode as unlinked', () => {
    const late = session(
      'late-child',
      [usageEvent(BASE + 60 * MINUTE, 5), closer('completed', BASE + 61 * MINUTE)],
      'parent',
      { origin: 'subagent', delegationDepth: 1 },
    )
    const index = buildEpisodes([parentSession(), late], IDLE)
    expect(index.episodes[0]?.children).toEqual([])
    expect(index.unlinked).toEqual([{ sessionId: 'late-child', parentSession: 'parent' }])
  })

  it('keeps an inherited fork prefix out of the child contribution', () => {
    const prefix = [
      human(BASE),
      usageEvent(BASE + MINUTE, 100),
      closer('completed', BASE + 2 * MINUTE),
    ]
    const own = [usageEvent(BASE + 4 * MINUTE, 50), callEvent('c1', 'read', BASE + 5 * MINUTE)]
    const child: SessionInput = {
      id: 'forked-child',
      records: extractRecords('forked-child', [...prefix, ...own], prefix.length),
      meta: { id: 'forked-child', parentSession: 'parent', origin: 'subagent', delegationDepth: 1 },
    }
    const episode = buildEpisodes([parentSession(), child], IDLE).episodes[0]
    expect(episode?.children[0]?.usage.input).toBe(50)
    expect(episode?.children[0]?.toolCalls).toBe(1)
    expect(episode?.usage.input).toBe(150)
  })

  it('reports an orphan child whose parent is outside the corpus', () => {
    const index = buildEpisodes([parentSession(), childSession('orphan', 'missing')], IDLE)
    expect(index.episodes[0]?.children).toEqual([])
    expect(index.unlinked).toEqual([{ sessionId: 'orphan', parentSession: 'missing' }])
  })

  it('joins a grandchild through the chain to the root episode', () => {
    const grandchild = session(
      'grandchild',
      [usageEvent(BASE + 7 * MINUTE, 10), closer('completed', BASE + 8 * MINUTE)],
      'child',
      { origin: 'subagent', delegationDepth: 2 },
    )
    const episode = buildEpisodes([parentSession(), childSession(), grandchild], IDLE).episodes[0]
    expect(episode?.children.map((child) => child.sessionId).sort()).toEqual([
      'child',
      'grandchild',
    ])
    expect(episode?.usage.input).toBe(160)
  })
})

describe('episode boundaries', () => {
  it('starts an episode at the first human message and keeps machine messages inside', () => {
    const events = [
      event('turn/start', { turn: 1 }, BASE),
      human(BASE + MINUTE),
      event('assistant/message', { turn: 1, step: 1 }, BASE + 2 * MINUTE),
      human(BASE + 3 * MINUTE, 'goal'),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' },
        BASE + 4 * MINUTE,
      ),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 5 * MINUTE),
      human(BASE + 6 * MINUTE, 'user-approval'),
    ]
    const episodes = deriveEpisodes(session('s', events), IDLE)
    expect(episodes).toHaveLength(1)
    const episode = episodes[0]
    expect(episode?.start).toBe(BASE + MINUTE)
    expect(episode?.end).toBe(BASE + 6 * MINUTE)
    expect(episode?.humanMessages).toBe(1)
    expect(episode?.machineMessages).toBe(2)
    expect(episode?.records).toHaveLength(6)
  })

  it('excludes preamble before the first human message', () => {
    const events = [
      event('system/message', { content: [] }, BASE),
      event('turn/start', { turn: 1 }, BASE + MINUTE),
      human(BASE + 2 * MINUTE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' },
        BASE + 3 * MINUTE,
      ),
    ]
    const [episode] = deriveEpisodes(session('s', events), IDLE)
    expect(episode?.records[0]?.eventType).toBe('user/message')
    expect(episode?.start).toBe(BASE + 2 * MINUTE)
    expect(episode?.end).toBe(BASE + 3 * MINUTE)
  })

  it('never starts an episode from an approval message alone', () => {
    const events = [
      human(BASE, 'user-approval'),
      human(BASE + MINUTE, 'goal'),
      event('turn/start', { turn: 1 }, BASE + 2 * MINUTE),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 3 * MINUTE),
    ]
    expect(deriveEpisodes(session('s', events), IDLE)).toEqual([])
  })

  it('contributes no episode for a session with no human message', () => {
    const events = [
      event('turn/start', { turn: 1 }, BASE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' },
        BASE + MINUTE,
      ),
    ]
    expect(deriveEpisodes(session('s', events), IDLE)).toEqual([])
  })

  it('splits two human messages into two non-overlapping episodes with index identities', () => {
    const events = [
      human(BASE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' },
        BASE + 2 * MINUTE,
      ),
      human(BASE + 10 * MINUTE),
      event('turn/end', { turn: 2, reason: { kind: 'completed' } }, BASE + 15 * MINUTE),
    ]
    const episodes = deriveEpisodes(session('session-a', events), IDLE)
    expect(episodes.map((episode) => episode.id)).toEqual(['session-a#1', 'session-a#2'])
    expect(episodes[0]?.start).toBe(BASE)
    // The episode ends at its boundary, the next human message.
    expect(episodes[0]?.end).toBe(BASE + 10 * MINUTE)
    expect(episodes[1]?.start).toBe(BASE + 10 * MINUTE)
    expect(episodes[1]?.end).toBe(BASE + 15 * MINUTE)
    expect(episodes[0]!.end).toBeLessThanOrEqual(episodes[1]!.start)
  })

  it('ends an episode after the idle gap and leaves the later activity outside it', () => {
    const events = [
      human(BASE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' },
        BASE + 10 * MINUTE,
      ),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{}' },
        BASE + 50 * MINUTE,
      ),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c3', name: 'read', arguments: '{}' },
        BASE + 55 * MINUTE,
      ),
      human(BASE + 80 * MINUTE),
      event('turn/end', { turn: 2, reason: { kind: 'completed' } }, BASE + 85 * MINUTE),
    ]
    const episodes = deriveEpisodes(session('s', events), IDLE)
    expect(episodes).toHaveLength(2)
    expect(episodes[0]?.end).toBe(BASE + 10 * MINUTE)
    expect(episodes[0]?.toolCalls).toBe(1)
    // The two calls after the gap belong to no episode.
    expect(episodes[1]?.start).toBe(BASE + 80 * MINUTE)
    expect(episodes[1]?.toolCalls).toBe(0)
  })

  it('ends an episode at session end when the human message never gets a closer', () => {
    const events = [human(BASE), ...step(1, BASE + MINUTE)]
    const [episode] = deriveEpisodes(session('s', events), IDLE)
    expect(episode?.end).toBe(BASE + 2 * MINUTE)
    expect(episode?.outcome).toBe('open')
  })

  it('applies the 30-minute default cutoff at the boundary and just above it', () => {
    const events = [
      human(BASE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' },
        BASE + 10 * MINUTE,
      ),
      // Exactly 30 minutes after the previous record: still inside the default gap.
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{}' },
        BASE + 40 * MINUTE,
      ),
      // 31 minutes after: beyond the default gap, so it stays outside the episode.
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c3', name: 'read', arguments: '{}' },
        BASE + 71 * MINUTE,
      ),
    ]
    const index = buildEpisodes([session('s', events)])
    expect(index.episodes).toHaveLength(1)
    expect(index.episodes[0]?.end).toBe(BASE + 40 * MINUTE)
    expect(index.episodes[0]?.toolCalls).toBe(2)
  })

  it('uses a supplied idle threshold instead of the default', () => {
    const events = [
      human(BASE),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{}' },
        BASE + MINUTE,
      ),
      event(
        'tool/call',
        { turn: 1, step: 1, callId: 'c2', name: 'read', arguments: '{}' },
        BASE + 11 * MINUTE,
      ),
    ]
    const inclusive = buildEpisodes([session('s', events)], 10 * MINUTE)
    expect(inclusive.episodes[0]?.toolCalls).toBe(2)
    const split = buildEpisodes([session('s', events)], 9 * MINUTE)
    expect(split.episodes[0]?.toolCalls).toBe(1)
    expect(split.episodes[0]?.end).toBe(BASE + MINUTE)
  })

  it('builds episodes for root sessions only and never for a child session', () => {
    const root = session('root', [
      human(BASE),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 5 * MINUTE),
    ])
    const child = session(
      'child',
      [
        human(BASE + 2 * MINUTE, 'agent-message'),
        event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 3 * MINUTE),
      ],
      'root',
    )
    const index = buildEpisodes([root, child], IDLE)
    expect(index.episodes.map((episode) => episode.id)).toEqual(['root#1'])
    expect(index.episodes[0]?.children.map((entry) => entry.sessionId)).toEqual(['child'])
    expect(index.unlinked).toEqual([])
  })
})
