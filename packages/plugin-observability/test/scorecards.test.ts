import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { testableRow } from '../src/host/builtins.ts'
import { buildEpisodes, type SessionInput } from '../src/host/episodes.ts'
import { type EpisodeWork, episodeWork } from '../src/host/metrics.ts'
import { extractRecords } from '../src/host/records.ts'
import { parseRows } from '../src/host/rows.ts'
import { scorecards, toolBin, weekStart } from '../src/host/scorecards.ts'

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const BASE = new Date(2026, 9, 26, 9, 0).getTime()

let seq = 0

function event(type: string, data: Record<string, unknown>, time: number): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

interface Fixture {
  readonly sessionId: string
  readonly start: number
  readonly tools?: readonly string[]
  readonly steps?: number
  readonly failed?: boolean
  /** Input tokens recorded on an assistant message inside the episode. */
  readonly input?: number
}

/** One session holding one episode that calls the listed tools. */
function eventsOf(fixture: Fixture): SessionEvent[] {
  const events: SessionEvent[] = [
    event('user/message', { role: 'user', content: [], source: { kind: 'user' } }, fixture.start),
  ]
  if (fixture.input !== undefined) {
    events.push(
      event(
        'assistant/message',
        {
          turn: 1,
          step: 1,
          usage: {
            inputTokens: fixture.input,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: fixture.input,
          },
        },
        fixture.start + 500,
      ),
    )
  }
  const steps = fixture.steps ?? 1
  for (let step = 0; step < steps; step += 1) {
    events.push(
      event('step/start', { turn: 1, step: step + 1 }, fixture.start + (step + 1) * MINUTE),
      event('step/end', { turn: 1, step: step + 1 }, fixture.start + (step + 1) * MINUTE + 30_000),
    )
  }
  for (const [index, tool] of (fixture.tools ?? []).entries()) {
    const at = fixture.start + (index + 1) * MINUTE
    const callId = `${fixture.sessionId}-${String(index)}`
    events.push(
      event('tool/call', { turn: 1, step: 1, callId, name: tool, arguments: '{}' }, at),
      event(
        'tool/result',
        {
          turn: 1,
          step: 1,
          message: {
            role: 'tool',
            content: [],
            source: { kind: 'tool', callId },
            isError: fixture.failed === true,
          },
        },
        at + 10_000,
      ),
    )
  }
  events.push(
    event(
      'turn/end',
      { turn: 1, reason: { kind: fixture.failed === true ? 'error' : 'completed' } },
      fixture.start + 10 * MINUTE,
    ),
  )
  return events
}

/** Build the episode work for a fixture list. */
function workOf(fixtures: readonly Fixture[]): EpisodeWork[] {
  const sessions: SessionInput[] = fixtures.map((fixture) => ({
    id: fixture.sessionId,
    records: extractRecords(fixture.sessionId, eventsOf(fixture)),
    meta: { id: fixture.sessionId },
  }))
  return buildEpisodes(sessions, 30 * MINUTE).episodes.map((episode) =>
    episodeWork(episode, { from: BASE - DAY, to: BASE + 60 * DAY }),
  )
}

function rowFrom(raw: unknown) {
  const [row] = parseRows({ rows: [raw] })
  if (row === undefined) throw new Error('fixture row missing')
  return testableRow(row)
}

describe('scorecards', () => {
  it('renders a declared goal and reads every episode when eligibility is undeclared', () => {
    const work = workOf([
      { sessionId: 'a', start: BASE, tools: ['write'] },
      { sessionId: 'b', start: BASE + DAY, tools: ['write'] },
      { sessionId: 'c', start: BASE + 2 * DAY, tools: ['read'] },
    ])
    const [card] = scorecards(
      [
        rowFrom({
          id: 'writes',
          label: 'Writes',
          kind: 'signal',
          match: [{ tool: 'write' }],
          goal: 'write more',
        }),
      ],
      work,
      1,
    )
    expect(card?.goal).toBe('write more')
    expect(card?.eligibilityDeclared).toBe(false)
    expect(card?.eligible).toBe(3)
    expect(card?.fired).toBe(2)
    expect(card?.activation).toBeCloseTo(2 / 3)
  })

  it('counts eligible episodes through the eligible predicate', () => {
    const work = workOf([
      { sessionId: 'a', start: BASE, tools: ['edit', 'write'] },
      { sessionId: 'b', start: BASE + DAY, tools: ['edit'] },
      { sessionId: 'c', start: BASE + 2 * DAY, tools: ['read', 'write'] },
    ])
    const [card] = scorecards(
      [
        rowFrom({
          id: 'writes',
          label: 'Writes',
          kind: 'signal',
          match: [{ tool: 'write' }],
          eligible: [{ tool: 'edit' }],
        }),
      ],
      work,
      1,
    )
    expect(card?.eligibilityDeclared).toBe(true)
    expect(card?.eligible).toBe(2)
    expect(card?.fired).toBe(1)
    expect(card?.firedOutside).toBe(1)
    expect(card?.activation).toBe(0.5)
  })

  it('caps activation at the eligible set when the row also fires outside it', () => {
    const work = workOf([
      { sessionId: 'a', start: BASE, tools: ['edit', 'write'] },
      { sessionId: 'b', start: BASE + DAY, tools: ['write'] },
    ])
    const [card] = scorecards(
      [
        rowFrom({
          id: 'writes',
          label: 'Writes',
          kind: 'signal',
          match: [{ tool: 'write' }],
          eligible: [{ tool: 'edit' }],
        }),
      ],
      work,
      1,
    )
    expect(card?.eligible).toBe(1)
    expect(card?.fired).toBe(1)
    expect(card?.firedOutside).toBe(1)
    expect(card?.activation).toBe(1)
  })

  it('reads a silent row as zero of its eligible episodes and insufficient', () => {
    const work = workOf([
      { sessionId: 'a', start: BASE, tools: ['read'] },
      { sessionId: 'b', start: BASE + DAY, tools: ['read'] },
    ])
    const [card] = scorecards(
      [
        rowFrom({
          id: 'writes',
          label: 'Writes',
          kind: 'signal',
          match: [{ tool: 'write' }],
          eligible: [{ tool: 'read' }],
        }),
      ],
      work,
      10,
    )
    expect(card?.fired).toBe(0)
    expect(card?.activation).toBe(0)
    expect(card?.treated.n).toBe(0)
    expect(card?.insufficient).toBe(true)
  })

  it('matches treated and control episodes by bin and week', () => {
    const fixtures: Fixture[] = []
    for (let index = 0; index < 12; index += 1) {
      fixtures.push({
        sessionId: `t${String(index)}`,
        start: BASE + index * MINUTE,
        tools: ['write'],
      })
      fixtures.push({
        sessionId: `c${String(index)}`,
        start: BASE + index * MINUTE,
        tools: ['read'],
      })
    }
    const [card] = scorecards(
      [rowFrom({ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] })],
      workOf(fixtures),
      10,
    )
    expect(card?.matched).toBe(true)
    expect(card?.weekRelaxed).toBe(false)
    expect(card?.treated.n).toBe(12)
    expect(card?.control.n).toBe(12)
    expect(card?.insufficient).toBe(false)
    expect(card?.association).toBe('association, not proof')
  })

  it('relaxes the week when a size bin is too small within one week', () => {
    const fixtures: Fixture[] = []
    for (let index = 0; index < 10; index += 1) {
      fixtures.push({
        sessionId: `t${String(index)}`,
        start: BASE + index * MINUTE,
        tools: ['write'],
      })
      fixtures.push({
        sessionId: `c${String(index)}`,
        start: BASE + 7 * DAY + index * MINUTE,
        tools: ['read'],
      })
    }
    const [card] = scorecards(
      [rowFrom({ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] })],
      workOf(fixtures),
      10,
    )
    expect(card?.weekRelaxed).toBe(true)
    expect(card?.treated.n).toBe(10)
    expect(card?.control.n).toBe(10)
    expect(card?.insufficient).toBe(false)
  })

  it('reads a small sample as insufficient', () => {
    const [card] = scorecards(
      [rowFrom({ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] })],
      workOf([
        { sessionId: 'a', start: BASE, tools: ['write'] },
        { sessionId: 'b', start: BASE + MINUTE, tools: ['read'] },
      ]),
      10,
    )
    expect(card?.insufficient).toBe(true)
    expect(card?.treated.n).toBe(1)
    expect(card?.control.n).toBe(1)
  })

  it('reports the error rate of treated episodes', () => {
    const work = workOf([
      { sessionId: 'a', start: BASE, tools: ['write'], failed: true },
      { sessionId: 'b', start: BASE + MINUTE, tools: ['write'] },
    ])
    const [card] = scorecards(
      [rowFrom({ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] })],
      work,
      1,
    )
    expect(card?.errorRate).toBe(0.5)
  })

  it('relaxes a bin whose week cells are below the minimum', () => {
    const fixtures: Fixture[] = []
    // Week A: 10 treated and one control; week B: nine more controls. A single
    // small cell must aggregate the whole bin across weeks.
    for (let index = 0; index < 10; index += 1) {
      fixtures.push({
        sessionId: `t${String(index)}`,
        start: BASE + index * MINUTE,
        tools: ['write'],
      })
    }
    fixtures.push({ sessionId: 'c-small', start: BASE + 30 * MINUTE, tools: ['read'] })
    for (let index = 0; index < 9; index += 1) {
      fixtures.push({
        sessionId: `c${String(index)}`,
        start: BASE + 7 * DAY + index * MINUTE,
        tools: ['read'],
      })
    }
    const [card] = scorecards(
      [rowFrom({ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] })],
      workOf(fixtures),
      10,
    )
    expect(card?.weekRelaxed).toBe(true)
    expect(card?.treated.n).toBe(10)
    expect(card?.control.n).toBe(10)
    expect(card?.insufficient).toBe(false)
  })

  it('reports treated-minus-control outcome deltas and their percentiles', () => {
    const fixtures: Fixture[] = [
      { sessionId: 't1', start: BASE, tools: ['write'], steps: 2 },
      { sessionId: 't2', start: BASE + MINUTE, tools: ['write'], steps: 4 },
      { sessionId: 't3', start: BASE + 2 * MINUTE, tools: ['write'], steps: 6 },
      { sessionId: 'c1', start: BASE, tools: ['read'], steps: 1 },
      { sessionId: 'c2', start: BASE + MINUTE, tools: ['read'], steps: 1 },
      { sessionId: 'c3', start: BASE + 2 * MINUTE, tools: ['read'], steps: 1 },
    ]
    const [card] = scorecards(
      [rowFrom({ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] })],
      workOf(fixtures),
      1,
    )
    expect(card?.treated.n).toBe(3)
    expect(card?.control.n).toBe(3)
    expect(card?.treated.stepsPerHumanMessage.p50).toBe(4)
    expect(card?.control.stepsPerHumanMessage.p50).toBe(1)
    expect(card?.treated.activeMinutes.p50).toBeGreaterThan(card?.control.activeMinutes.p50 ?? 0)
    expect(card?.deltas.stepsPerHumanMessageP50).toBe(3)
    expect(card?.deltas.tokensP50).toBe(0)
    expect(card?.deltas.verifiedShare).toBe(0)
  })

  it('balances matching cells so pooled sizes cannot fabricate a delta', () => {
    const fixtures: Fixture[] = []
    // Week A: 20 treated and 10 controls at 100 tokens; week B: 10 treated and
    // 20 controls at 1000 tokens. Within every cell the outcome is identical.
    for (let index = 0; index < 20; index += 1) {
      fixtures.push({
        sessionId: `ta${String(index)}`,
        start: BASE + index * MINUTE,
        tools: ['write'],
        input: 100,
      })
    }
    for (let index = 0; index < 10; index += 1) {
      fixtures.push({
        sessionId: `ca${String(index)}`,
        start: BASE + index * MINUTE,
        tools: ['read'],
        input: 100,
      })
    }
    for (let index = 0; index < 10; index += 1) {
      fixtures.push({
        sessionId: `tb${String(index)}`,
        start: BASE + 7 * DAY + index * MINUTE,
        tools: ['write'],
        input: 1000,
      })
    }
    for (let index = 0; index < 20; index += 1) {
      fixtures.push({
        sessionId: `cb${String(index)}`,
        start: BASE + 7 * DAY + index * MINUTE,
        tools: ['read'],
        input: 1000,
      })
    }
    const [card] = scorecards(
      [rowFrom({ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] })],
      workOf(fixtures),
      10,
    )
    expect(card?.weekRelaxed).toBe(false)
    expect(card?.treated.n).toBe(20)
    expect(card?.control.n).toBe(20)
    expect(card?.deltas.tokensP50).toBe(0)
  })

  it('leaves deltas absent when a matched cohort is empty', () => {
    const work = workOf([
      { sessionId: 'a', start: BASE, tools: ['write'] },
      { sessionId: 'b', start: BASE + MINUTE, tools: ['write'] },
    ])
    const [card] = scorecards(
      [rowFrom({ id: 'writes', label: 'Writes', kind: 'signal', match: [{ tool: 'write' }] })],
      work,
      1,
    )
    // There is no control to match, so no matched cohorts and no deltas.
    expect(card?.treated.n).toBe(0)
    expect(card?.control.n).toBe(0)
    expect(card?.deltas).toEqual({})
  })

  it('bins tool-call counts and keys weeks by their local Monday', () => {
    expect(toolBin(0)).toBe(0)
    expect(toolBin(10)).toBe(1)
    expect(toolBin(49)).toBe(1)
    expect(toolBin(50)).toBe(2)
    expect(toolBin(200)).toBe(3)
    expect(weekStart(BASE)).toBe(new Date(2026, 9, 26).getTime())
    expect(weekStart(BASE + 6 * DAY)).toBe(new Date(2026, 9, 26).getTime())
  })
})
