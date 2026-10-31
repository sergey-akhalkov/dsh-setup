import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { buildEpisodes, type Episode, type SessionInput } from '../src/host/episodes.ts'
import {
  autonomySummary,
  costSummary,
  dataQuality,
  type EpisodeWork,
  episodeWork,
  FULL_WINDOW,
  NO_CUTOFF,
  parallelWidth,
  qualitySummary,
  speedSummary,
  subagentSummary,
  usageCoverage,
  windowUsage,
} from '../src/host/metrics.ts'
import { extractRecords } from '../src/host/records.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const BASE = new Date(2026, 9, 31, 9, 0).getTime()
const IDLE = 30 * MINUTE

let seq = 0

function event(type: string, data: Record<string, unknown>, time: number): SessionEvent {
  seq += 1
  return { type, seq, time, data } as unknown as SessionEvent
}

function human(at: number, kind = 'user'): SessionEvent {
  return event('user/message', { role: 'user', content: [], source: { kind } }, at)
}

function usage(
  at: number,
  input: number,
  extra: Partial<Record<'output' | 'cacheRead' | 'cacheWrite', number>> = {},
): SessionEvent {
  return event(
    'assistant/message',
    {
      turn: 1,
      step: 1,
      usage: {
        inputTokens: input,
        outputTokens: extra.output ?? 0,
        cacheReadTokens: extra.cacheRead ?? 0,
        cacheWriteTokens: extra.cacheWrite ?? 0,
        totalTokens: input + (extra.output ?? 0) + (extra.cacheRead ?? 0) + (extra.cacheWrite ?? 0),
      },
    },
    at,
  )
}

function step(at: number, turn = 1, index = 1): SessionEvent[] {
  return [
    event('step/start', { turn, step: index }, at),
    event('step/end', { turn, step: index }, at + MINUTE),
  ]
}

function call(callId: string, name: string, at: number, turn = 1): SessionEvent {
  return event('tool/call', { turn, step: 1, callId, name, arguments: '{}' }, at)
}

function result(callId: string, at: number, isError = false, turn = 1): SessionEvent {
  return event(
    'tool/result',
    {
      turn,
      step: 1,
      message: { role: 'tool', content: [], source: { kind: 'tool', callId }, isError },
    },
    at,
  )
}

function closer(kind: string, at: number, turn = 1): SessionEvent {
  return event('turn/end', { turn, reason: { kind } }, at)
}

function goal(operation: string, at: number, rounds = 0, id = 'g1'): SessionEvent {
  const phase = operation === 'complete' ? 'completed' : operation === 'pause' ? 'paused' : 'active'
  return event(
    'goal/change',
    {
      kind: 'goal/change',
      operation,
      goal: { id, revision: 1, objective: 'SECRET', phase },
      roundsStarted: rounds,
    },
    at,
  )
}

function checkpoint(outcome: string, verified: string[], at: number): SessionEvent {
  return event(
    'tool/call',
    {
      turn: 1,
      step: 1,
      callId: `cp-${String(seq)}`,
      name: 'work_checkpoint',
      arguments: JSON.stringify({
        outcome,
        verified,
        remaining: [],
        next: 'go on',
        ...(outcome === 'continue' ? { serialReason: 'one ordered step' } : {}),
      }),
    },
    at,
  )
}

function session(id: string, events: SessionEvent[], parentSession?: string): SessionInput {
  return {
    id,
    records: extractRecords(id, events),
    meta: { id, ...(parentSession === undefined ? {} : { parentSession }) },
  }
}

function episodesOf(sessions: readonly SessionInput[]): readonly Episode[] {
  return buildEpisodes(sessions, IDLE).episodes
}

function workOf(episodes: readonly Episode[], window = FULL_WINDOW): EpisodeWork[] {
  return episodes.map((episode) => episodeWork(episode, window))
}

function usageOf(sessions: readonly SessionInput[]) {
  const records = sessions.flatMap((entry) => entry.records)
  return {
    usage: windowUsage(records, FULL_WINDOW),
    coverage: usageCoverage(records, FULL_WINDOW),
  }
}

describe('episode usage aggregation', () => {
  it('sums one step and derives context load and the cache ratio', () => {
    const sessions = [
      session('s', [
        human(BASE),
        ...step(BASE + MINUTE),
        usage(BASE + 30_000, 100, { output: 10, cacheRead: 300, cacheWrite: 5 }),
        closer('completed', BASE + 2 * MINUTE),
      ]),
    ]
    const episodes = episodesOf(sessions)
    const sums = usageOf(sessions)
    const work = workOf(episodes)
    const cost = costSummary(work, sums.usage, sums.coverage, NO_CUTOFF)
    expect(cost.input).toBe(100)
    expect(cost.output).toBe(10)
    expect(cost.cacheRead).toBe(300)
    expect(cost.cacheWrite).toBe(5)
    expect(cost.total).toBe(415)
    expect(cost.contextLoad).toBe(400)
    expect(cost.steps).toBe(1)
    expect(cost.stepsWithUsage).toBe(1)
    expect(cost.usageCoverage).toBe(1)
    expect(cost.contextPerStep).toBe(400)
    expect(cost.cacheHitRatio).toBe(0.75)
    expect(cost.tokensPerEpisode).toEqual({ p50: 415, p90: 415, n: 1 })
    expect(cost.cutoff).toBeNull()
    expect(cost.cutoffLabel).toBe('full episode')
  })

  it('averages context load over several steps', () => {
    const sessions = [
      session('s', [
        human(BASE),
        usage(BASE + 10_000, 100, { cacheRead: 100 }),
        ...step(BASE + MINUTE, 1, 1),
        usage(BASE + 20_000, 300, { cacheRead: 100 }),
        ...step(BASE + 3 * MINUTE, 1, 2),
        closer('completed', BASE + 5 * MINUTE),
      ]),
    ]
    const sums = usageOf(sessions)
    const cost = costSummary(workOf(episodesOf(sessions)), sums.usage, sums.coverage, NO_CUTOFF)
    expect(cost.steps).toBe(2)
    expect(cost.contextLoad).toBe(600)
    expect(cost.contextPerStep).toBe(300)
  })

  it('averages context load across messages, not steps', () => {
    const sessions = [
      session('s', [
        human(BASE),
        ...step(BASE + MINUTE),
        usage(BASE + 30_000, 100, { cacheRead: 100 }),
        event('assistant/message', { turn: 1, step: 1 }, BASE + 40_000),
        closer('completed', BASE + 2 * MINUTE),
      ]),
    ]
    const sums = usageOf(sessions)
    const cost = costSummary(workOf(episodesOf(sessions)), sums.usage, sums.coverage, NO_CUTOFF)
    expect(cost.steps).toBe(1)
    expect(cost.messages).toBe(2)
    expect(cost.contextLoad).toBe(200)
    expect(cost.contextPerStep).toBe(100)
  })

  it('keeps step identities apart across sessions', () => {
    const sessions = [
      session('a', [
        human(BASE),
        ...step(BASE + MINUTE),
        usage(BASE + 30_000, 100),
        closer('completed', BASE + 2 * MINUTE),
      ]),
      session('b', [
        human(BASE + 10 * MINUTE),
        ...step(BASE + 11 * MINUTE),
        usage(BASE + 12 * MINUTE, 100),
        closer('completed', BASE + 13 * MINUTE),
      ]),
    ]
    const sums = usageOf(sessions)
    expect(sums.coverage.steps).toBe(2)
    expect(sums.coverage.stepsWithUsage).toBe(2)
    expect(sums.coverage.coverage).toBe(1)
    const cost = costSummary(workOf(episodesOf(sessions)), sums.usage, sums.coverage, NO_CUTOFF)
    expect(cost.contextPerStep).toBe(100)
  })

  it('reports step coverage separately from message coverage', () => {
    const sessions = [
      session('s', [
        human(BASE),
        ...step(BASE + MINUTE, 1, 1),
        usage(BASE + 90_000, 50),
        ...step(BASE + 3 * MINUTE, 1, 2),
        closer('completed', BASE + 5 * MINUTE),
      ]),
    ]
    const sums = usageOf(sessions)
    expect(sums.coverage.steps).toBe(2)
    expect(sums.coverage.stepsWithUsage).toBe(1)
    expect(sums.coverage.stepCoverage).toBe(0.5)
    expect(sums.coverage.messageCoverage).toBe(1)
    // A started step without a message is partial, never complete.
    expect(sums.coverage.coverage).toBe(0.5)
    const quality = dataQuality(workOf(episodesOf(sessions)), sums.coverage, 0)
    expect(quality.usageCoverage).toBe(0.5)
    expect(quality.stepCoverage).toBe(0.5)
  })

  it('lowers coverage for a message without usage instead of estimating', () => {
    const sessions = [
      session('s', [
        human(BASE),
        ...step(BASE + MINUTE),
        usage(BASE + 30_000, 100),
        event('assistant/message', { turn: 1, step: 1 }, BASE + 40_000),
        closer('completed', BASE + 2 * MINUTE),
      ]),
    ]
    const sums = usageOf(sessions)
    expect(sums.coverage.messages).toBe(2)
    expect(sums.coverage.messagesWithUsage).toBe(1)
    expect(sums.coverage.coverage).toBe(0.5)
    const cost = costSummary(workOf(episodesOf(sessions)), sums.usage, sums.coverage, NO_CUTOFF)
    expect(cost.total).toBe(100)
    expect(cost.usageCoverage).toBe(0.5)
  })

  it('reads a zero-step episode as zero without dividing by zero', () => {
    const sessions = [session('s', [human(BASE), closer('completed', BASE + MINUTE)])]
    const sums = usageOf(sessions)
    const cost = costSummary(workOf(episodesOf(sessions)), sums.usage, sums.coverage, NO_CUTOFF)
    expect(cost.steps).toBe(0)
    expect(cost.contextPerStep).toBe(0)
    expect(cost.cacheHitRatio).toBeUndefined()
    expect(cost.tokensPerEpisode).toEqual({ p50: 0, p90: 0, n: 1 })
  })

  it('leaves the cache ratio absent when input and cache read are both zero', () => {
    const sessions = [
      session('s', [
        human(BASE),
        event('assistant/message', { turn: 1, step: 1, usage: { inputTokens: 0 } }, BASE + 30_000),
        closer('completed', BASE + MINUTE),
      ]),
    ]
    const sums = usageOf(sessions)
    const cost = costSummary(workOf(episodesOf(sessions)), sums.usage, sums.coverage, NO_CUTOFF)
    expect(cost.cacheHitRatio).toBeUndefined()
  })

  it('keeps the through-cutoff use apart from the full-episode use', () => {
    const sessions = [
      session('s', [
        human(BASE),
        usage(BASE + 10 * MINUTE, 100),
        usage(BASE + 25 * MINUTE, 400),
        closer('completed', BASE + 29 * MINUTE),
      ]),
    ]
    const window = { from: BASE, to: BASE + 20 * MINUTE }
    const [entry] = workOf(episodesOf(sessions), window)
    expect(entry?.usage.total).toBe(100)
    expect(entry?.fullUsage.total).toBe(500)
    expect(entry?.episode.usage.total).toBe(500)
  })
})

describe('episode quality and active time', () => {
  it('does not fail an episode whose tool failure its completed turn recovered', () => {
    const sessions = [
      session('s', [
        human(BASE),
        call('c1', 'edit', BASE + MINUTE),
        result('c1', BASE + 2 * MINUTE, true),
        closer('completed', BASE + 3 * MINUTE),
      ]),
    ]
    const quality = qualitySummary(workOf(episodesOf(sessions)))
    expect(quality.completed).toBe(1)
    expect(quality.failed).toBe(0)
    expect(quality.verifiedShare).toBe(0)
  })

  it('fails an episode with an unrecovered failure even when the closer is a cut', () => {
    const sessions = [
      session('s', [
        human(BASE),
        call('c1', 'edit', BASE + MINUTE),
        result('c1', BASE + 2 * MINUTE, true),
        closer('aborted', BASE + 3 * MINUTE),
      ]),
    ]
    const quality = qualitySummary(workOf(episodesOf(sessions)))
    expect(quality.failed).toBe(1)
    expect(quality.cut).toBe(0)
  })

  it('counts verified only for a completed checkpoint with non-empty evidence', () => {
    const sessions = [
      session('s', [
        human(BASE),
        checkpoint('done', ['the test passed'], BASE + MINUTE),
        closer('completed', BASE + 2 * MINUTE),
      ]),
    ]
    const [work] = workOf(episodesOf(sessions))
    expect(work?.verified).toBe(true)
    expect(work?.episode.checkpoints).toEqual({ total: 1, closes: 1, verified: 1 })

    const empty = workOf(
      episodesOf([
        session('s2', [
          human(BASE),
          checkpoint('done', [], BASE + MINUTE),
          closer('completed', BASE + 2 * MINUTE),
        ]),
      ]),
    )
    expect(empty[0]?.verified).toBe(false)
    expect(empty[0]?.episode.checkpoints).toEqual({ total: 1, closes: 1, verified: 0 })
  })

  it('does not treat a continue checkpoint as a close', () => {
    const sessions = [
      session('s', [
        human(BASE),
        checkpoint('continue', ['something'], BASE + MINUTE),
        closer('completed', BASE + 2 * MINUTE),
      ]),
    ]
    const [work] = workOf(episodesOf(sessions))
    expect(work?.episode.checkpoints).toEqual({ total: 1, closes: 0, verified: 0 })
    expect(work?.verified).toBe(false)
  })

  it('excludes an idle gap from active time', () => {
    const sessions = [
      session('s', [
        human(BASE),
        ...step(BASE + MINUTE, 1, 1),
        // A 20-minute gap sits inside the episode; the default idle gap is 30.
        ...step(BASE + 21 * MINUTE, 1, 2),
        closer('completed', BASE + 23 * MINUTE),
      ]),
    ]
    const [work] = workOf(episodesOf(sessions))
    expect(work?.episode.activeMs).toBe(2 * MINUTE)
  })

  it('counts a tool inside a step once and a tool outside a step separately', () => {
    const inside = [
      session('s', [
        human(BASE),
        event('step/start', { turn: 1, step: 1 }, BASE + MINUTE),
        call('c1', 'read', BASE + 90_000),
        result('c1', BASE + 2 * MINUTE),
        event('step/end', { turn: 1, step: 1 }, BASE + 3 * MINUTE),
        closer('completed', BASE + 4 * MINUTE),
      ]),
    ]
    expect(workOf(episodesOf(inside))[0]?.episode.activeMs).toBe(2 * MINUTE)

    const outside = [
      session('s', [
        human(BASE),
        call('c1', 'read', BASE + MINUTE),
        result('c1', BASE + 3 * MINUTE),
        closer('completed', BASE + 4 * MINUTE),
      ]),
    ]
    expect(workOf(episodesOf(outside))[0]?.episode.activeMs).toBe(2 * MINUTE)
  })

  it('adds no active time for a command outside a step', () => {
    const sessions = [
      session('s', [
        human(BASE),
        event(
          'command/run',
          { name: 'permission', args: 'x', source: { kind: 'user' } },
          BASE + MINUTE,
        ),
        event('command/done', { name: 'permission' }, BASE + 3 * MINUTE),
        closer('completed', BASE + 4 * MINUTE),
      ]),
    ]
    const [work] = workOf(episodesOf(sessions))
    expect(work?.episode.activeMs).toBe(0)
    expect(work?.episode.commands).toBe(1)
  })

  it('keeps an episode with no steps visible with zero active time', () => {
    const sessions = [
      session('s', [human(BASE), usage(BASE + MINUTE, 10), closer('completed', BASE + 2 * MINUTE)]),
    ]
    const [work] = workOf(episodesOf(sessions))
    expect(work?.episode.activeMs).toBe(0)
    expect(speedSummary(workOf(episodesOf(sessions))).activeMinutes).toEqual({
      p50: 0,
      p90: 0,
      n: 1,
    })
  })

  it('maps every terminal kind and an unfinished final turn', () => {
    const cases: ReadonlyArray<readonly [string | undefined, string]> = [
      ['completed', 'completed'],
      ['error', 'failed'],
      ['aborted', 'cut'],
      ['max-tokens', 'cut'],
      ['interrupted', 'cut'],
      ['blocked', 'blocked'],
      ['mystery', 'other'],
      [undefined, 'open'],
    ]
    for (const [kind, expected] of cases) {
      const events =
        kind === undefined
          ? [human(BASE), event('turn/start', { turn: 1 }, BASE + MINUTE)]
          : [human(BASE), closer(kind, BASE + MINUTE)]
      const [work] = workOf(episodesOf([session('s', events)]))
      expect(work?.outcome, `kind ${String(kind)}`).toBe(expected)
    }
  })

  it('leaves an episode open when a later turn started without an end', () => {
    const events = [
      human(BASE),
      event('turn/start', { turn: 1 }, BASE + MINUTE),
      closer('completed', BASE + 2 * MINUTE),
      event('turn/start', { turn: 2 }, BASE + 3 * MINUTE),
    ]
    const [work] = workOf(episodesOf([session('s', events)]))
    expect(work?.outcome).toBe('open')
  })

  it('clips a tool interval that crosses a human message boundary', () => {
    const events = [
      human(BASE),
      call('c1', 'read', BASE + MINUTE),
      human(BASE + 2 * MINUTE),
      result('c1', BASE + 3 * MINUTE),
      closer('completed', BASE + 4 * MINUTE),
    ]
    const [first, second] = workOf(episodesOf([session('s', events)]))
    expect(first?.episode.activeMs).toBe(0)
    expect(second?.episode.activeMs).toBe(MINUTE)
  })

  it('clips a step interval that crosses a human message boundary', () => {
    const events = [
      human(BASE),
      event('step/start', { turn: 1, step: 1 }, BASE + MINUTE),
      human(BASE + 2 * MINUTE),
      event('step/end', { turn: 1, step: 1 }, BASE + 4 * MINUTE),
    ]
    const [, second] = workOf(episodesOf([session('s', events)]))
    expect(second?.episode.activeMs).toBe(2 * MINUTE)
  })

  it('reports p50 and p90 active minutes', () => {
    const sessions = ['a', 'b', 'c'].map((id, index) => {
      const events = [human(BASE + index * HOUR)]
      for (let number = 1; number <= index + 1; number += 1) {
        events.push(...step(BASE + index * HOUR + number * 2 * MINUTE, 1, number))
      }
      events.push(closer('completed', BASE + index * HOUR + 20 * MINUTE))
      return session(id, events)
    })
    const speed = speedSummary(workOf(episodesOf(sessions)))
    expect(speed.n).toBe(3)
    expect(speed.activeMinutes.p50).toBe(2)
    expect(speed.activeMinutes.p90).toBe(3)
  })
})

describe('goals and autonomy', () => {
  it('reports one completed goal and the human messages spent on it', () => {
    const sessions = [
      session('a', [
        human(BASE),
        goal('create', BASE + MINUTE, 2),
        closer('completed', BASE + 2 * MINUTE),
      ]),
      session('b', [
        human(BASE + HOUR),
        goal('complete', BASE + HOUR + MINUTE, 3),
        closer('completed', BASE + HOUR + 2 * MINUTE),
      ]),
    ]
    const autonomy = autonomySummary(workOf(episodesOf(sessions)))
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(1)
    expect(autonomy.goalCompletionRate).toBe(1)
    expect(autonomy.rounds).toBe(3)
    expect(autonomy.humanMessagesPerCompletedGoal).toBe(2)
  })

  it('reports a paused goal as untouched completion', () => {
    const autonomy = autonomySummary(
      workOf(
        episodesOf([
          session('s', [
            human(BASE),
            goal('create', BASE + MINUTE),
            goal('pause', BASE + 2 * MINUTE),
            closer('completed', BASE + 3 * MINUTE),
          ]),
        ]),
      ),
    )
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(0)
    expect(autonomy.goalCompletionRate).toBe(0)
    expect(autonomy.humanMessagesPerCompletedGoal).toBeUndefined()
  })

  it('reports autonomy without goals and leaves goal metrics absent', () => {
    const [work] = workOf(
      episodesOf([
        session('s', [human(BASE), ...step(BASE + MINUTE), closer('completed', BASE + 3 * MINUTE)]),
      ]),
    )
    if (work === undefined) throw new Error('fixture episode missing')
    const autonomy = autonomySummary([work])
    expect(autonomy.goals).toBe(0)
    expect(autonomy.goalCompletionRate).toBeUndefined()
    expect(autonomy.humanMessagesPerCompletedGoal).toBeUndefined()
    expect(autonomy.stepsPerHumanMessage.n).toBe(1)
    expect(autonomy.stepsPerHumanMessage.p50).toBe(1)
  })

  it('sums rounds across independent goals', () => {
    const autonomy = autonomySummary(
      workOf(
        episodesOf([
          session('s', [
            human(BASE),
            goal('create', BASE + MINUTE, 3, 'g1'),
            goal('complete', BASE + 2 * MINUTE, 3, 'g1'),
            goal('create', BASE + 3 * MINUTE, 2, 'g2'),
            goal('complete', BASE + 4 * MINUTE, 2, 'g2'),
            closer('completed', BASE + 5 * MINUTE),
          ]),
        ]),
      ),
    )
    expect(autonomy.goals).toBe(2)
    expect(autonomy.completedGoals).toBe(2)
    expect(autonomy.goalCompletionRate).toBe(1)
    expect(autonomy.rounds).toBe(5)
  })

  it('counts several human messages spent on one goal', () => {
    const autonomy = autonomySummary(
      workOf(
        episodesOf([
          session('s', [
            human(BASE),
            goal('create', BASE + MINUTE, 1),
            human(BASE + 5 * MINUTE),
            human(BASE + 10 * MINUTE),
            goal('complete', BASE + 11 * MINUTE, 2),
            closer('completed', BASE + 12 * MINUTE),
          ]),
        ]),
      ),
    )
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(1)
    expect(autonomy.humanMessages).toBe(3)
    expect(autonomy.humanMessagesPerCompletedGoal).toBe(3)
  })

  it('never reports a completion rate above one for a goal created in an earlier window', () => {
    const autonomy = autonomySummary(
      workOf(
        episodesOf([
          session('s', [
            human(BASE),
            goal('complete', BASE + MINUTE, 4),
            closer('completed', BASE + 2 * MINUTE),
          ]),
        ]),
      ),
    )
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(1)
    expect(autonomy.goalCompletionRate).toBe(1)
    expect(autonomy.rounds).toBe(4)
  })

  it('keeps pause and resume counts and the final phase', () => {
    const [work] = workOf(
      episodesOf([
        session('s', [
          human(BASE),
          goal('create', BASE + 1_000),
          goal('pause', BASE + 2_000),
          goal('resume', BASE + 3_000),
          goal('complete', BASE + 4_000),
          closer('completed', BASE + 5_000),
        ]),
      ]),
    )
    expect(work?.episode.goals).toEqual({
      created: 1,
      paused: 1,
      resumed: 1,
      completed: 1,
      rounds: 0,
      phase: 'completed',
    })
  })

  it('attributes in-window messages to a goal created before the window', () => {
    const autonomy = autonomySummary(
      workOf(
        episodesOf([
          session('s', [
            human(BASE),
            goal('resume', BASE + MINUTE, 4),
            human(BASE + 5 * MINUTE),
            human(BASE + 10 * MINUTE),
            goal('complete', BASE + 11 * MINUTE, 5),
            closer('completed', BASE + 12 * MINUTE),
          ]),
        ]),
      ),
    )
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(1)
    expect(autonomy.humanMessages).toBe(3)
    expect(autonomy.humanMessagesPerCompletedGoal).toBe(3)
  })

  it('keeps a pre-window goal creation through a spanning episode', () => {
    const sessions = [
      session('s', [
        // Episode 1 starts and creates the goal before the window, then runs on.
        human(BASE),
        goal('create', BASE + MINUTE, 3),
        event('step/start', { turn: 1, step: 1 }, BASE + 15 * MINUTE),
        event('turn/end', { turn: 1, reason: { kind: 'completed' } }, BASE + 20 * MINUTE),
        // Three in-window human messages, then the goal completes without resume.
        human(BASE + 25 * MINUTE),
        human(BASE + 30 * MINUTE),
        human(BASE + 35 * MINUTE),
        goal('complete', BASE + 36 * MINUTE, 6),
        closer('completed', BASE + 37 * MINUTE),
      ]),
    ]
    const window = { from: BASE + 10 * MINUTE, to: BASE + 60 * MINUTE }
    const work = workOf(episodesOf(sessions), window)
    const autonomy = autonomySummary(
      work,
      work.filter((entry) => entry.episode.start >= window.from),
    )
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(1)
    expect(autonomy.humanMessages).toBe(3)
    expect(autonomy.humanMessagesPerCompletedGoal).toBe(3)
  })

  it('excludes a goal completed after the window cutoff', () => {
    const sessions = [
      session('s', [
        human(BASE),
        goal('create', BASE + MINUTE, 1),
        human(BASE + 20 * MINUTE),
        goal('complete', BASE + 21 * MINUTE, 2),
        closer('completed', BASE + 22 * MINUTE),
      ]),
    ]
    const work = workOf(episodesOf(sessions), { from: BASE - MINUTE, to: BASE + 10 * MINUTE })
    const autonomy = autonomySummary(work)
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(0)
    expect(autonomy.goalCompletionRate).toBe(0)
    expect(autonomy.humanMessagesPerCompletedGoal).toBeUndefined()
  })

  it('excludes a goal completed before the window', () => {
    const sessions = [
      session('s', [
        human(BASE),
        goal('create', BASE + MINUTE, 1),
        goal('complete', BASE + 2 * MINUTE, 2),
        closer('completed', BASE + 3 * MINUTE),
        human(BASE + 100 * MINUTE),
        closer('completed', BASE + 101 * MINUTE),
      ]),
    ]
    const work = workOf(episodesOf(sessions), {
      from: BASE + 100 * MINUTE,
      to: BASE + 200 * MINUTE,
    })
    const autonomy = autonomySummary(work)
    expect(autonomy.goals).toBe(0)
    expect(autonomy.humanMessages).toBe(1)
    expect(autonomy.humanMessagesPerCompletedGoal).toBeUndefined()
  })

  it('keeps the goals of several sessions and a goal-free session', () => {
    const build = (order: readonly string[]): ReturnType<typeof autonomySummary> => {
      const fixtures = new Map([
        [
          'a',
          session('a', [
            human(BASE),
            goal('create', BASE + MINUTE, 1, 'g1'),
            goal('complete', BASE + 2 * MINUTE, 2, 'g1'),
            closer('completed', BASE + 3 * MINUTE),
          ]),
        ],
        [
          'b',
          session('b', [
            human(BASE + 60 * MINUTE),
            goal('create', BASE + 61 * MINUTE, 3, 'g2'),
            goal('complete', BASE + 62 * MINUTE, 4, 'g2'),
            closer('completed', BASE + 63 * MINUTE),
          ]),
        ],
        ['c', session('c', [human(BASE + 120 * MINUTE), closer('completed', BASE + 121 * MINUTE)])],
      ])
      const ordered = order.map((id) => {
        const entry = fixtures.get(id)
        if (entry === undefined) throw new Error('fixture missing')
        return entry
      })
      return autonomySummary(workOf(episodesOf(ordered), FULL_WINDOW))
    }
    for (const order of [
      ['a', 'b', 'c'],
      ['c', 'a', 'b'],
    ] as const) {
      const autonomy = build(order)
      expect(autonomy.goals, order.join('')).toBe(2)
      expect(autonomy.completedGoals, order.join('')).toBe(2)
      expect(autonomy.rounds, order.join('')).toBe(6)
    }
  })

  it('reports episodes per session across the cohort', () => {
    const sessions = [
      session('a', [
        human(BASE),
        closer('completed', BASE + MINUTE),
        human(BASE + 10 * MINUTE),
        closer('completed', BASE + 11 * MINUTE),
      ]),
      session('b', [human(BASE + 20 * MINUTE), closer('completed', BASE + 21 * MINUTE)]),
    ]
    const work = workOf(episodesOf(sessions), FULL_WINDOW)
    expect(autonomySummary(work).episodesPerSession).toBe(1.5)
    expect(autonomySummary([]).episodesPerSession).toBeUndefined()
  })

  it('closes a goal completed during an idle gap', () => {
    const sessions = [
      session('s', [
        human(BASE),
        goal('create', BASE + MINUTE, 1, 'g1'),
        closer('completed', BASE + 2 * MINUTE),
        // The completion lands in the idle gap, outside every episode.
        goal('complete', BASE + 40 * MINUTE, 2, 'g1'),
        human(BASE + 60 * MINUTE),
        closer('completed', BASE + 61 * MINUTE),
      ]),
    ]
    const entry = sessions[0]
    if (entry === undefined) throw new Error('fixture session missing')
    const streams = new Map([
      ['s', entry.records.filter((record) => record.eventType === 'goal/change')],
    ])
    const whole = workOf(episodesOf(sessions), FULL_WINDOW)
    const autonomy = autonomySummary(whole, whole, streams)
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(1)
    expect(autonomy.humanMessagesPerCompletedGoal).toBe(1)
    // A later window only sees the goal-free message: the goal completed before it.
    const later = workOf(episodesOf(sessions), {
      from: BASE + 50 * MINUTE,
      to: BASE + 70 * MINUTE,
    })
    expect(autonomySummary(later, later, streams).goals).toBe(0)
    // A window containing only the gap completion reports that completion.
    const gap = workOf(episodesOf(sessions), {
      from: BASE + 30 * MINUTE,
      to: BASE + 70 * MINUTE,
    })
    const gapAutonomy = autonomySummary(gap, gap, streams, {
      from: BASE + 30 * MINUTE,
      to: BASE + 70 * MINUTE,
    })
    expect(gapAutonomy.goals).toBe(1)
    expect(gapAutonomy.completedGoals).toBe(1)
    expect(gapAutonomy.humanMessagesPerCompletedGoal).toBe(0)
  })

  it('does not let a historical episode change in-window message attribution', () => {
    const sessions = [
      session('s', [
        // A historical episode entirely before the window.
        human(BASE),
        closer('completed', BASE + 2 * MINUTE),
        human(BASE + 20 * MINUTE),
        goal('create', BASE + 21 * MINUTE, 1, 'g1'),
        human(BASE + 22 * MINUTE),
        goal('complete', BASE + 23 * MINUTE, 2, 'g1'),
        closer('completed', BASE + 24 * MINUTE),
      ]),
    ]
    const entry = sessions[0]
    if (entry === undefined) throw new Error('fixture session missing')
    const streams = new Map([
      ['s', entry.records.filter((record) => record.eventType === 'goal/change')],
    ])
    const window = { from: BASE + 10 * MINUTE, to: BASE + 30 * MINUTE }
    const work = workOf(episodesOf(sessions), window)
    const autonomy = autonomySummary(work, work, streams, window)
    expect(autonomy.goals).toBe(1)
    expect(autonomy.completedGoals).toBe(1)
    expect(autonomy.humanMessages).toBe(2)
    expect(autonomy.humanMessagesPerCompletedGoal).toBe(2)
  })

  it('excludes a goal created and completed in separate historical episodes', () => {
    const sessions = [
      session('s', [
        human(BASE),
        goal('create', BASE + MINUTE, 1, 'g1'),
        closer('completed', BASE + 2 * MINUTE),
        human(BASE + 10 * MINUTE),
        goal('complete', BASE + 11 * MINUTE, 2, 'g1'),
        closer('completed', BASE + 12 * MINUTE),
        human(BASE + 100 * MINUTE),
        closer('completed', BASE + 101 * MINUTE),
      ]),
    ]
    const work = workOf(episodesOf(sessions), {
      from: BASE + 100 * MINUTE,
      to: BASE + 200 * MINUTE,
    })
    const autonomy = autonomySummary(work)
    expect(autonomy.goals).toBe(0)
    expect(autonomy.completedGoals).toBe(0)
    expect(autonomy.humanMessages).toBe(1)
  })

  it('ignores a machine injection after the window cutoff', () => {
    const sessions = [session('s', [human(BASE), human(BASE + 10 * MINUTE, 'user-approval')])]
    const work = workOf(episodesOf(sessions), { from: BASE - MINUTE, to: BASE + 5 * MINUTE })
    const autonomy = autonomySummary(work)
    expect(autonomy.humanMessages).toBe(1)
    expect(autonomy.machineMessages).toBe(0)
  })

  it('counts an approval as a machine injection, not a human message', () => {
    const autonomy = autonomySummary(
      workOf(
        episodesOf([
          session('s', [
            human(BASE),
            human(BASE + 30_000, 'user-approval'),
            human(BASE + 40_000, 'goal'),
            ...step(BASE + MINUTE),
            closer('completed', BASE + 3 * MINUTE),
          ]),
        ]),
      ),
    )
    expect(autonomy.humanMessages).toBe(1)
    expect(autonomy.machineMessages).toBe(2)
    expect(autonomy.stepsPerHumanMessage.p50).toBe(1)
    expect(autonomy.machineMessagesPerHumanMessage.p50).toBe(2)
  })

  it('reflects contrasting step counts in steps per human message', () => {
    const light = session('light', [
      human(BASE),
      ...step(BASE + MINUTE, 1, 1),
      closer('completed', BASE + 3 * MINUTE),
    ])
    const heavyEvents = [human(BASE + HOUR)]
    for (let index = 1; index <= 8; index += 1) {
      heavyEvents.push(...step(BASE + HOUR + index * 2 * MINUTE, 1, index))
    }
    heavyEvents.push(closer('completed', BASE + HOUR + 20 * MINUTE))
    const autonomy = autonomySummary(workOf(episodesOf([light, session('heavy', heavyEvents)])))
    expect(autonomy.stepsPerHumanMessage).toEqual({ p50: 1, p90: 8, n: 2 })
  })
})

describe('subagent aggregation', () => {
  const parent = () =>
    session('parent', [
      human(BASE),
      call('d1', 'delegate', BASE + MINUTE),
      result('d1', BASE + 5 * MINUTE),
      closer('completed', BASE + 20 * MINUTE),
    ])

  const child = (id: string, from: number, outcome = 'completed') =>
    session(
      id,
      [
        usage(from, 40),
        event('step/start', { turn: 1, step: 1 }, from),
        event('step/end', { turn: 1, step: 1 }, from + MINUTE),
        closer(outcome, from + 2 * MINUTE),
      ],
      'parent',
    )

  it('reports sequential children with a width of one', () => {
    const index = buildEpisodes(
      [parent(), child('child-a', BASE + 2 * MINUTE), child('child-b', BASE + 10 * MINUTE)],
      IDLE,
    )
    expect(index.episodes[0]?.children).toHaveLength(2)
    const summary = subagentSummary(workOf(index.episodes), 0)
    expect(summary.delegateCalls).toBe(1)
    expect(summary.episodesWithChild).toBe(1)
    expect(summary.delegateRate).toBe(1)
    expect(summary.linkedChildren).toBe(2)
    expect(summary.childTokens).toBe(80)
    expect(summary.parallelWidth).toBe(1)
    expect(summary.parentWaitMs).toEqual({ p50: 4 * MINUTE, p90: 4 * MINUTE, n: 1 })
  })

  it('reports overlapping children with a width of two', () => {
    const index = buildEpisodes(
      [parent(), child('child-a', BASE + 2 * MINUTE), child('child-b', BASE + 3 * MINUTE)],
      IDLE,
    )
    expect(subagentSummary(workOf(index.episodes), 0).parallelWidth).toBe(2)
  })

  it('leaves parent wait empty when a delegate call has no result', () => {
    const pending = session('pending', [
      human(BASE),
      call('d1', 'delegate', BASE + MINUTE),
      closer('completed', BASE + 5 * MINUTE),
    ])
    const summary = subagentSummary(
      workOf(episodesOf([pending, child('child-a', BASE + 2 * MINUTE)])),
      0,
    )
    expect(summary.delegateCalls).toBe(1)
    expect(summary.parentWaitMs.n).toBe(0)
  })

  it('counts a failed child without failing the parent', () => {
    const index = buildEpisodes([parent(), child('child-a', BASE + 2 * MINUTE, 'error')], IDLE)
    const summary = subagentSummary(workOf(index.episodes), 1)
    expect(summary.childFailures).toBe(1)
    expect(summary.unlinkedChildren).toBe(1)
    expect(index.episodes[0]?.outcome).toBe('completed')
  })

  it('counts an instantaneous child at the window start', () => {
    const parentSession = parent()
    const instant = session('instant-child', [usage(BASE + 5 * MINUTE, 10)], 'parent')
    const index = buildEpisodes([parentSession, instant], IDLE)
    const work = workOf(index.episodes, {
      from: BASE + 5 * MINUTE,
      to: BASE + 10 * MINUTE,
    })
    expect(work[0]?.children).toHaveLength(1)
    expect(work[0]?.children[0]?.usage.total).toBe(10)
    expect(subagentSummary(work, 0).parallelWidth).toBe(1)
  })

  it('counts a child that starts exactly at the window edge once, not as parallel', () => {
    const parentSession = parent()
    const before = session(
      'child-before',
      [
        event('step/start', { turn: 1, step: 1 }, BASE + MINUTE),
        event('step/end', { turn: 1, step: 1 }, BASE + 5 * MINUTE),
      ],
      'parent',
    )
    const after = session(
      'child-after',
      [
        event('step/start', { turn: 1, step: 1 }, BASE + 5 * MINUTE),
        event('step/end', { turn: 1, step: 1 }, BASE + 8 * MINUTE),
      ],
      'parent',
    )
    const index = buildEpisodes([parentSession, before, after], IDLE)
    const work = workOf(index.episodes, { from: BASE + 5 * MINUTE, to: BASE + 10 * MINUTE })
    // The child ending at the window start and the child starting there are
    // sequential, so the window holds one of them and a width of one.
    expect(work[0]?.children).toHaveLength(1)
    expect(subagentSummary(work, 0).parallelWidth).toBe(1)
  })

  it('retains a child whose work spans the whole window', () => {
    const parentSession = parent()
    const spanning = session(
      'spanning-child',
      [
        event('step/start', { turn: 1, step: 1 }, BASE + MINUTE),
        event('step/end', { turn: 1, step: 1 }, BASE + 12 * MINUTE),
      ],
      'parent',
    )
    const index = buildEpisodes([parentSession, spanning], IDLE)
    const work = workOf(index.episodes, { from: BASE + 3 * MINUTE, to: BASE + 10 * MINUTE })
    expect(work[0]?.children).toHaveLength(1)
    expect(work[0]?.children[0]?.start).toBe(BASE + 3 * MINUTE)
    expect(work[0]?.children[0]?.end).toBe(BASE + 10 * MINUTE)
    expect(subagentSummary(work, 0).parallelWidth).toBe(1)
  })

  it('measures parent wait from the union of overlapping delegate calls', () => {
    const overlapping = session('overlapping', [
      human(BASE),
      call('d1', 'delegate', BASE + MINUTE),
      call('d2', 'delegate', BASE + MINUTE),
      result('d1', BASE + 5 * MINUTE),
      result('d2', BASE + 5 * MINUTE),
      closer('completed', BASE + 10 * MINUTE),
    ])
    const summary = subagentSummary(workOf(episodesOf([overlapping])), 0)
    expect(summary.delegateCalls).toBe(2)
    expect(summary.parentWaitMs).toEqual({ p50: 4 * MINUTE, p90: 4 * MINUTE, n: 1 })
  })

  it('counts inherited-prefix tokens once', () => {
    const prefix = [human(BASE), usage(BASE + MINUTE, 500), closer('completed', BASE + 2 * MINUTE)]
    const own = [usage(BASE + 4 * MINUTE, 40), closer('completed', BASE + 5 * MINUTE)]
    const forked: SessionInput = {
      id: 'child-fork',
      records: extractRecords('child-fork', [...prefix, ...own], prefix.length),
      meta: { id: 'child-fork', parentSession: 'parent' },
    }
    const index = buildEpisodes([parent(), forked], IDLE)
    expect(subagentSummary(workOf(index.episodes), 0).childTokens).toBe(40)
    // The parent fixture records no usage of its own; the fork prefix is not the child's.
    expect(index.episodes[0]?.usage.input).toBe(40)
  })

  it('observes a child outcome at the window cutoff instead of its later failure', () => {
    const index = buildEpisodes([parent(), child('child-a', BASE + 2 * MINUTE, 'error')], IDLE)
    // The child fails at BASE+4m; a window ending at BASE+3m sees it still open.
    const window = { from: BASE, to: BASE + 3 * MINUTE }
    const work = workOf(index.episodes, window)
    expect(work[0]?.children[0]?.outcome).toBe('open')
    const summary = subagentSummary(work, 0)
    expect(summary.childFailures).toBe(0)
    expect(summary.linkedChildren).toBe(1)
  })

  it('excludes a child whose work starts after the window cutoff', () => {
    const late = child('late-child', BASE + 15 * MINUTE)
    const index = buildEpisodes([parent(), late], IDLE)
    const window = { from: BASE, to: BASE + 10 * MINUTE }
    const work = workOf(index.episodes, window)
    expect(work[0]?.children).toEqual([])
    const summary = subagentSummary(work, 0)
    expect(summary.episodesWithChild).toBe(0)
    expect(summary.linkedChildren).toBe(0)
    expect(summary.childTokens).toBe(0)
    expect(summary.parallelWidth).toBe(0)
  })
})

describe('data quality', () => {
  it('reports complete coverage as one on complete data', () => {
    const sessions = [
      session('s', [
        human(BASE),
        goal('create', BASE + 1_000),
        checkpoint('done', ['evidence'], BASE + 2_000),
        ...step(BASE + MINUTE),
        usage(BASE + 90_000, 10, { cacheRead: 10 }),
        closer('completed', BASE + 3 * MINUTE),
      ]),
    ]
    const work = workOf(episodesOf(sessions))
    const sums = usageOf(sessions)
    const quality = dataQuality(work, sums.coverage, 0)
    expect(quality.usageCoverage).toBe(1)
    expect(quality.goalEvents).toBe(1)
    expect(quality.checkpoints).toBe(1)
    expect(quality.usageCoverage).not.toBeLessThan(1)
    expect(quality.linkedChildren).toBe(0)
    expect(quality.unlinkedChildren).toBe(0)
  })

  it('states partial usage coverage instead of reporting it complete', () => {
    const sessions = [
      session('s', [
        human(BASE),
        ...step(BASE + MINUTE),
        usage(BASE + 90_000, 10),
        event('assistant/message', { turn: 1, step: 1 }, BASE + 2 * MINUTE),
        closer('completed', BASE + 3 * MINUTE),
      ]),
    ]
    const work = workOf(episodesOf(sessions))
    const sums = usageOf(sessions)
    const quality = dataQuality(work, sums.coverage, 2)
    expect(quality.usageCoverage).toBe(0.5)
    expect(quality.usageCoverage).not.toBe(1)
    expect(quality.stepsWithUsage).toBe(1)
    expect(quality.unlinkedChildren).toBe(2)
  })

  it('reports absent data as zero and keeps the comparison sample explicit', () => {
    const work = workOf([])
    const sums = usageOf([])
    const quality = dataQuality(work, sums.coverage, 0, 0)
    expect(quality).toEqual({
      steps: 0,
      stepsWithUsage: 0,
      messages: 0,
      messagesWithUsage: 0,
      usageCoverage: 0,
      stepCoverage: 0,
      messageCoverage: 0,
      episodes: 0,
      linkedChildren: 0,
      unlinkedChildren: 0,
      goalEvents: 0,
      checkpoints: 0,
      unmappedClosers: 0,
      comparisonSample: 0,
    })
  })

  it('counts an unmapped terminal kind as other', () => {
    const sessions = [session('s', [human(BASE), closer('mystery', BASE + MINUTE)])]
    const work = workOf(episodesOf(sessions))
    expect(work[0]?.outcome).toBe('other')
    expect(dataQuality(work, usageOf(sessions).coverage, 0).unmappedClosers).toBe(1)
  })

  it('counts an unmapped terminal kind even when a failure makes the episode failed', () => {
    const sessions = [
      session('s', [
        human(BASE),
        call('c1', 'edit', BASE + MINUTE),
        result('c1', BASE + 2 * MINUTE, true),
        closer('mystery', BASE + 3 * MINUTE),
      ]),
    ]
    const work = workOf(episodesOf(sessions))
    expect(work[0]?.outcome).toBe('failed')
    expect(dataQuality(work, usageOf(sessions).coverage, 0).unmappedClosers).toBe(1)
  })

  it('does not let usage from a preceding step cover an in-window step', () => {
    const records = extractRecords('s', [
      event('step/start', { turn: 1, step: 1 }, BASE + 90_000),
      usage(BASE + 110_000, 50),
      event('step/start', { turn: 1, step: 2 }, BASE + 120_000),
    ])
    const coverage = usageCoverage(records, { from: BASE + 100_000, to: BASE + 200_000 })
    // Step 1 began before the window, so its usage cannot cover step 2.
    expect(coverage.steps).toBe(1)
    expect(coverage.stepCoverage).toBe(0)
    expect(coverage.coverage).toBe(0)
  })

  it('reports a linked child and the comparison sample instead of zeros', () => {
    const parent = session('parent', [
      human(BASE),
      event('step/start', { turn: 1, step: 1 }, BASE + MINUTE),
      event('step/end', { turn: 1, step: 1 }, BASE + 2 * MINUTE),
      closer('completed', BASE + 5 * MINUTE),
    ])
    const child = session(
      'child',
      [event('step/start', { turn: 1, step: 1 }, BASE + 2 * MINUTE)],
      'parent',
    )
    const sessions = [parent, child]
    const work = workOf(episodesOf(sessions))
    const data = dataQuality(work, usageOf(sessions).coverage, 0, 7)
    expect(data.linkedChildren).toBe(1)
    expect(data.comparisonSample).toBe(7)
  })
})

describe('parallel width helper', () => {
  it('counts spans active at the same instant once each', () => {
    expect(
      parallelWidth([
        { start: 0, end: 10 },
        { start: 5, end: 15 },
      ]),
    ).toBe(2)
    expect(
      parallelWidth([
        { start: 0, end: 5 },
        { start: 5, end: 10 },
      ]),
    ).toBe(1)
    expect(parallelWidth([])).toBe(0)
  })
})
