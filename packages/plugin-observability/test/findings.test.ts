import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { buildEpisodes, type SessionInput } from '../src/host/episodes.ts'
import { SERIAL_RUN_MINUTES, SERIAL_RUN_STEPS, serialRunFindings } from '../src/host/findings.ts'
import { type EpisodeWork, episodeWork, FULL_WINDOW } from '../src/host/metrics.ts'
import { extractRecords } from '../src/host/records.ts'

const MINUTE = 60_000
const BASE = new Date(2026, 9, 31, 9, 0).getTime()

let seq = 0

function event(type: string, data: Record<string, unknown>, time: number): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

function human(at: number, text = 'work'): SessionEvent {
  return event(
    'user/message',
    { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } },
    at,
  )
}

function stepsOf(count: number, from: number): SessionEvent[] {
  return Array.from({ length: count }, (_unused, index) => [
    event('step/start', { turn: 1, step: index + 1 }, from + index * 30_000),
    event('step/end', { turn: 1, step: index + 1 }, from + index * 30_000 + 20_000),
  ]).flat()
}

function session(id: string, events: SessionEvent[], parentSession?: string): SessionInput {
  return {
    id,
    records: extractRecords(id, events),
    meta: { id, ...(parentSession === undefined ? {} : { parentSession }) },
  }
}

function workOf(sessions: readonly SessionInput[]): EpisodeWork[] {
  return buildEpisodes(sessions, 30 * MINUTE).episodes.map((episode) =>
    episodeWork(episode, FULL_WINDOW),
  )
}

describe('serial long run finding', () => {
  it('flags a long episode that ran on one stream', () => {
    const sessions = [
      session('s', [
        human(BASE, 'SECRET-MESSAGE-TEXT'),
        ...stepsOf(SERIAL_RUN_STEPS + 1, BASE + MINUTE),
        event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 40 * MINUTE),
      ]),
    ]
    const findings = serialRunFindings(workOf(sessions))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.id).toBe('serial-long-run')
    expect(findings[0]?.severity).toBe('attention')
    expect(findings[0]?.evidence).toContain(`${String(SERIAL_RUN_STEPS + 1)} steps`)
    expect(findings[0]?.evidence).toContain('width of 0')
    expect(findings[0]?.episodeIds).toEqual(['s#1'])
    expect(findings[0]?.nextAction).toContain('streams')
    expect(JSON.stringify(findings)).not.toContain('SECRET-MESSAGE-TEXT')
  })

  it('does not flag a short episode', () => {
    const sessions = [
      session('s', [
        human(BASE),
        ...stepsOf(3, BASE + MINUTE),
        event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 5 * MINUTE),
      ]),
    ]
    expect(serialRunFindings(workOf(sessions))).toEqual([])
  })

  it('does not flag a long episode with overlapping children', () => {
    const parent = session('parent', [
      human(BASE),
      ...stepsOf(SERIAL_RUN_STEPS + 1, BASE + MINUTE),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 40 * MINUTE),
    ])
    const childA = session(
      'child-a',
      [
        event('step/start', { turn: 1, step: 1 }, BASE + 5 * MINUTE),
        event('step/end', { turn: 1, step: 1 }, BASE + 15 * MINUTE),
      ],
      'parent',
    )
    const childB = session(
      'child-b',
      [
        event('step/start', { turn: 1, step: 1 }, BASE + 8 * MINUTE),
        event('step/end', { turn: 1, step: 1 }, BASE + 18 * MINUTE),
      ],
      'parent',
    )
    expect(serialRunFindings(workOf([parent, childA, childB]))).toEqual([])
  })

  it('flags a long episode whose single child never overlapped anything', () => {
    const parent = session('parent', [
      human(BASE),
      ...stepsOf(SERIAL_RUN_STEPS + 1, BASE + MINUTE),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 40 * MINUTE),
    ])
    const child = session(
      'child',
      [
        event('step/start', { turn: 1, step: 1 }, BASE + 2 * MINUTE),
        event('step/end', { turn: 1, step: 1 }, BASE + 3 * MINUTE),
      ],
      'parent',
    )
    const findings = serialRunFindings(workOf([parent, child]))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toContain('width of 1')
  })

  it('reports nothing on an empty window', () => {
    expect(serialRunFindings([])).toEqual([])
  })

  it('flags a long episode by active minutes even with few steps', () => {
    const events = [human(BASE)]
    for (let index = 0; index < SERIAL_RUN_MINUTES + 1; index += 1) {
      // The intervals overlap slightly, so the union still spans the threshold.
      events.push(
        event('step/start', { turn: 1, step: index + 1 }, BASE + MINUTE + index * MINUTE),
        event('step/end', { turn: 1, step: index + 1 }, BASE + MINUTE + index * MINUTE + 70_000),
      )
    }
    events.push(
      event(
        'turn/end',
        { turn: 1, reason: { kind: 'completed' } },
        BASE + (SERIAL_RUN_MINUTES + 2) * MINUTE,
      ),
    )
    const findings = serialRunFindings(workOf([session('s', events)]))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.evidence).toContain('21 active minutes')
  })
})
