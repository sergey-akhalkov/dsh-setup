import type { Range } from './aggregate.js'
import type {
  Episode,
  EpisodeCheckpoints,
  EpisodeGoals,
  EpisodeInterval,
  EpisodeOutcome,
} from './episodes.js'
import {
  checkpointEvidence,
  EPISODE_OUTCOMES,
  finalTerminalOf,
  goalsOf,
  isHumanMessage,
  KNOWN_TERMINALS,
  NO_USAGE,
  outcomeOf,
} from './episodes.js'
import type { TokenUsage, TraceRecord } from './records.js'

/**
 * Episode metrics: usage, outcomes, active time, goals and autonomy, subagent
 * work, and the coverage behind each number. Everything is computed over the
 * observed window by event time; nothing here reads message text.
 */

/** An observed window; `to` is exclusive. */
export interface Window {
  readonly from: number
  readonly to: number
}

/** The whole corpus, used by the session range which has no cutoff. */
export const FULL_WINDOW: Window = { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY }

/** The cutoff the session range reports. */
export const NO_CUTOFF = Number.POSITIVE_INFINITY

/** A p50/p90 pair with its sample size. */
export interface Distribution {
  readonly p50: number
  readonly p90: number
  readonly n: number
}

/** The nearest-rank percentile of a value list; empty list reads zero. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.ceil(fraction * sorted.length) - 1
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0
}

/** A p50/p90 distribution of a value list. */
export function distribution(values: readonly number[]): Distribution {
  return { p50: percentile(values, 0.5), p90: percentile(values, 0.9), n: values.length }
}

/** Whether a record's time falls inside a window. */
function inWindow(record: TraceRecord, window: Window): boolean {
  return record.time >= window.from && record.time < window.to
}

/** Whether a record's time is before the cutoff, the session range included. */
function before(record: TraceRecord, cutoff: number): boolean {
  return record.time < cutoff
}

/** Sum the usage of a record list, ignoring time. */
function sumUsage(records: readonly TraceRecord[]): TokenUsage {
  let total = NO_USAGE
  for (const record of records) {
    if (record.usage === undefined) continue
    total = {
      input: total.input + record.usage.input,
      output: total.output + record.usage.output,
      cacheRead: total.cacheRead + record.usage.cacheRead,
      cacheWrite: total.cacheWrite + record.usage.cacheWrite,
      total: total.total + record.usage.total,
    }
  }
  return total
}

/** Sum the usage of the records inside a window. */
export function windowUsage(records: readonly TraceRecord[], window: Window): TokenUsage {
  return sumUsage(records.filter((record) => inWindow(record, window)))
}

/** How much of a window's usage the log actually recorded. */
export interface UsageCoverage {
  /** Distinct steps that started inside the window. */
  readonly steps: number
  /** Distinct steps carrying an assistant message with usage. */
  readonly stepsWithUsage: number
  /** Assistant messages inside the window. */
  readonly messages: number
  /** Assistant messages inside the window that recorded usage. */
  readonly messagesWithUsage: number
  /** `stepsWithUsage / steps`; one when no step started. */
  readonly stepCoverage: number
  /** `messagesWithUsage / messages`; one when no message was recorded. */
  readonly messageCoverage: number
  /** The lower of step and message coverage; zero when the window holds neither. */
  readonly coverage: number
}

/** Count the steps and messages that recorded usage. */
export function usageCoverage(records: readonly TraceRecord[], window: Window): UsageCoverage {
  const steps = new Set<string>()
  const stepsWithUsage = new Set<string>()
  let messages = 0
  let messagesWithUsage = 0
  const stepKey = (record: TraceRecord): string | undefined =>
    record.turn === undefined || record.step === undefined
      ? undefined
      : `${record.sessionId}:${String(record.turn)}:${String(record.step)}`
  for (const record of records) {
    if (!inWindow(record, window)) continue
    if (record.eventType === 'step/start') {
      const key = stepKey(record)
      if (key !== undefined) steps.add(key)
      continue
    }
    if (record.eventType !== 'assistant/message') continue
    messages += 1
    if (record.usage === undefined) continue
    messagesWithUsage += 1
    const key = stepKey(record)
    if (key !== undefined) stepsWithUsage.add(key)
  }
  // A message's usage covers the step only when that step started in the window;
  // usage recorded for a step that started earlier cannot mask a missing step.
  const coveredSteps = [...stepsWithUsage].filter((key) => steps.has(key)).length
  const stepCoverage = steps.size === 0 ? (messages === 0 ? 0 : 1) : coveredSteps / steps.size
  const messageCoverage = messages === 0 ? (steps.size === 0 ? 0 : 1) : messagesWithUsage / messages
  return {
    steps: steps.size,
    stepsWithUsage: coveredSteps,
    messages,
    messagesWithUsage,
    stepCoverage,
    messageCoverage,
    // Both halves must be complete before coverage reads complete.
    coverage: Math.min(stepCoverage, messageCoverage),
  }
}

/** One child session's work inside the observed window. */
export interface EpisodeChildWork {
  readonly sessionId: string
  readonly start: number
  readonly end: number
  readonly outcome: EpisodeOutcome
  readonly verified: boolean
  readonly usage: TokenUsage
  readonly toolCalls: number
}

/** One episode's work inside the observed window. */
export interface EpisodeWork {
  readonly episode: Episode
  /** Usage recorded inside the window. */
  readonly usage: TokenUsage
  /** Usage of the whole episode, including work outside the window. */
  readonly fullUsage: TokenUsage
  readonly ownRecords: readonly TraceRecord[]
  readonly childRecords: readonly TraceRecord[]
  readonly childUsage: TokenUsage
  /** Joined children with work inside the window, already clipped and classified at the cutoff. */
  readonly children: readonly EpisodeChildWork[]
  readonly steps: number
  readonly toolCalls: number
  readonly activeMs: number
  readonly outcome: EpisodeOutcome
  readonly verified: boolean
  readonly failures: number
  readonly checkpoints: EpisodeCheckpoints
  readonly goals: EpisodeGoals
  /** The final terminal kind observed at the cutoff, when the log recorded one. */
  readonly terminal?: string
  /** The observation cutoff (`Infinity` for the session range). */
  readonly cutoff: number
  /** At least four tool calls and one successful edit or write inside the window. */
  readonly substantive: boolean
  readonly costBasis: 'through cutoff'
}

/** The successful calls of one window, joined to their own results. */
function hasSuccessfulWrite(records: readonly TraceRecord[]): boolean {
  const failed = new Set<string>()
  for (const record of records) {
    if (
      record.eventType === 'tool/result' &&
      record.failed === true &&
      record.callId !== undefined
    ) {
      failed.add(record.callId)
    }
  }
  return records.some(
    (record) =>
      record.eventType === 'tool/call' &&
      (record.tool === 'edit' || record.tool === 'write') &&
      (record.callId === undefined || !failed.has(record.callId)),
  )
}

/** The overlap of an active interval with a window. */
function intervalInWindow(intervals: readonly EpisodeInterval[], window: Window): number {
  let total = 0
  for (const interval of intervals) {
    const from = Math.max(interval.from, window.from)
    const to = Math.min(interval.to, window.to)
    if (to > from) total += to - from
  }
  return total
}

/** Clip one episode to the observed window. */
export function episodeWork(episode: Episode, window: Window): EpisodeWork {
  const ownRecords = episode.records.filter((record) => inWindow(record, window))
  const childRecords = episode.children.flatMap((child) =>
    child.records.filter((record) => inWindow(record, window)),
  )
  const beforeCutoff = (records: readonly TraceRecord[]): TraceRecord[] =>
    records.filter((record) => before(record, window.to))
  const outcome = outcomeOf(beforeCutoff(episode.records))
  const checkpoints = checkpointEvidence(beforeCutoff(episode.records))
  const terminal = finalTerminalOf(beforeCutoff(episode.records))
  const children: EpisodeChildWork[] = episode.children.flatMap((child) => {
    // A child whose work spans the whole window has no in-window timestamp but
    // is still active in it, so the span decides membership and the records
    // decide usage. A genuine instant counts at the window start too.
    const instant = child.start === child.end
    const overlaps = instant
      ? child.start >= window.from && child.start < window.to
      : child.start < window.to && child.end > window.from
    if (!overlaps) return []
    const records = child.records.filter((record) => inWindow(record, window))
    const clipped = child.records.filter((record) => before(record, window.to))
    const childOutcome = outcomeOf(clipped)
    return [
      {
        sessionId: child.sessionId,
        start: Math.max(child.start, window.from),
        end: Math.min(child.end, window.to),
        outcome: childOutcome.outcome,
        verified: checkpointEvidence(clipped).verified > 0,
        usage: sumUsage(records),
        toolCalls: records.filter((record) => record.eventType === 'tool/call').length,
      },
    ]
  })
  const work = [...ownRecords, ...childRecords]
  return {
    episode,
    usage: sumUsage(work),
    fullUsage: episode.usage,
    ownRecords,
    childRecords,
    childUsage: sumUsage(childRecords),
    children,
    steps: work.filter((record) => record.eventType === 'step/start').length,
    toolCalls: work.filter((record) => record.eventType === 'tool/call').length,
    activeMs: intervalInWindow(episode.intervals, window),
    outcome: outcome.outcome,
    verified: checkpoints.verified > 0,
    failures: outcome.failures,
    checkpoints,
    goals: goalsOf(beforeCutoff(episode.records)),
    ...(terminal === undefined ? {} : { terminal }),
    cutoff: window.to,
    substantive:
      work.filter((record) => record.eventType === 'tool/call').length >= 4 &&
      hasSuccessfulWrite(work),
    costBasis: 'through cutoff',
  }
}

/** Whether an episode started inside a window; cohorts select by start. */
export function startsIn(episode: Episode, window: Window): boolean {
  return episode.start >= window.from && episode.start < window.to
}

/** Whether an episode has any work or span inside a window. */
export function overlapsWindow(episode: Episode, window: Window): boolean {
  return episode.start < window.to && episode.end >= window.from
}

/** Cost, context load, and usage coverage of the window and its episodes. */
export interface CostSummary {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly total: number
  /** Input plus cache read: what the model had to hold for the step. */
  readonly contextLoad: number
  readonly contextPerStep: number
  /** Cache read as a share of input plus cache read; absent when both are zero. */
  readonly cacheHitRatio?: number
  readonly steps: number
  readonly stepsWithUsage: number
  readonly usageCoverage: number
  readonly messages: number
  readonly messagesWithUsage: number
  /** `null` for the session range, which observes the whole session. */
  readonly cutoff: number | null
  readonly cutoffLabel: 'through cutoff' | 'full episode'
  readonly tokensPerEpisode: Distribution
  readonly fullTokensPerEpisode: Distribution
}

/** Cost and usage of one window's event-time totals and its cohort episodes. */
export function costSummary(
  work: readonly EpisodeWork[],
  usage: TokenUsage,
  coverage: UsageCoverage,
  cutoff: number,
): CostSummary {
  const contextLoad = usage.input + usage.cacheRead
  const denominator = usage.input + usage.cacheRead
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    total: usage.total,
    contextLoad,
    // The spec's mean is across assistant messages, not steps.
    contextPerStep: coverage.messages === 0 ? 0 : contextLoad / coverage.messages,
    ...(denominator === 0 ? {} : { cacheHitRatio: usage.cacheRead / denominator }),
    steps: coverage.steps,
    stepsWithUsage: coverage.stepsWithUsage,
    usageCoverage: coverage.coverage,
    messages: coverage.messages,
    messagesWithUsage: coverage.messagesWithUsage,
    cutoff: cutoff === NO_CUTOFF ? null : cutoff,
    cutoffLabel: cutoff === NO_CUTOFF ? 'full episode' : 'through cutoff',
    tokensPerEpisode: distribution(work.map((entry) => entry.usage.total)),
    fullTokensPerEpisode: distribution(work.map((entry) => entry.fullUsage.total)),
  }
}

/** Outcome shares of the cohort, with verified and unverified closes. */
export interface QualitySummary {
  readonly episodes: number
  readonly completed: number
  readonly verified: number
  readonly failed: number
  readonly cut: number
  readonly blocked: number
  readonly other: number
  readonly open: number
  /** Verified completions over completed episodes; absent when none completed. */
  readonly verifiedShare?: number
  /** Failed episodes over the cohort; absent when the cohort is empty. */
  readonly failureRate?: number
  /** Episodes with at least four tool calls and a successful edit or write. */
  readonly substantive: number
  /** Substantive episodes with a completed checkpoint over all substantive ones. */
  readonly checkpointCoverage?: number
  /** Completed episodes without a completed checkpoint. */
  readonly unverified: number
  /** Steps per completed episode; a percentile of the quality of the closes. */
  readonly stepsToCompletion: Distribution
}

/** Classify a cohort's outcomes. */
export function qualitySummary(work: readonly EpisodeWork[]): QualitySummary {
  const counts: Record<EpisodeOutcome, number> = {
    completed: 0,
    failed: 0,
    cut: 0,
    blocked: 0,
    other: 0,
    open: 0,
  }
  for (const entry of work) counts[entry.outcome] += 1
  const verified = work.filter((entry) => entry.outcome === 'completed' && entry.verified).length
  const substantiveWork = work.filter((entry) => entry.substantive)
  const substantiveWithClose = substantiveWork.filter(
    (entry) => entry.checkpoints.closes > 0,
  ).length
  return {
    episodes: work.length,
    completed: counts.completed,
    verified,
    failed: counts.failed,
    cut: counts.cut,
    blocked: counts.blocked,
    other: counts.other,
    open: counts.open,
    ...(counts.completed === 0 ? {} : { verifiedShare: verified / counts.completed }),
    ...(work.length === 0 ? {} : { failureRate: counts.failed / work.length }),
    substantive: substantiveWork.length,
    ...(substantiveWork.length === 0
      ? {}
      : { checkpointCoverage: substantiveWithClose / substantiveWork.length }),
    unverified: Math.max(0, counts.completed - verified),
    stepsToCompletion: distribution(
      work.filter((entry) => entry.outcome === 'completed').map((entry) => entry.steps),
    ),
  }
}

/** Active-time distributions; wall-clock span is never used. */
export interface SpeedSummary {
  readonly n: number
  readonly activeMinutes: Distribution
  readonly completedActiveMinutes?: Distribution
}

/** Active minutes per cohort episode, and per completed episode. */
export function speedSummary(work: readonly EpisodeWork[]): SpeedSummary {
  const minutes = work.map((entry) => entry.activeMs / 60_000)
  const completed = work
    .filter((entry) => entry.outcome === 'completed')
    .map((entry) => entry.activeMs / 60_000)
  return {
    n: work.length,
    activeMinutes: distribution(minutes),
    ...(completed.length === 0 ? {} : { completedActiveMinutes: distribution(completed) }),
  }
}

/** Steps and machine injections per human message, and goal completion. */
export interface AutonomySummary {
  readonly episodes: number
  readonly sessions: number
  readonly episodesPerSession?: number
  readonly humanMessages: number
  readonly machineMessages: number
  readonly stepsPerHumanMessage: Distribution
  readonly machineMessagesPerHumanMessage: Distribution
  readonly goals: number
  readonly completedGoals: number
  /** Completed goals over touched goals; absent when no goal was recorded. */
  readonly goalCompletionRate?: number
  readonly rounds: number
  /** Human messages per completed goal; absent when no goal completed. */
  readonly humanMessagesPerCompletedGoal?: number
}

/**
 * Autonomy over the window. `work` supplies the window's messages and goal
 * lifecycles (including an episode spanning the boundary); `counted` is the
 * start-selected cohort the episode and session counts come from; `goalStreams`
 * replays the session's complete goal stream, including events in an idle gap.
 */
export function autonomySummary(
  work: readonly EpisodeWork[],
  counted: readonly EpisodeWork[] = work,
  goalStreams?: ReadonlyMap<string, readonly TraceRecord[]>,
  window?: Window,
): AutonomySummary {
  let humanMessages = 0
  let machineMessages = 0
  const stepsPerHumanMessage: number[] = []
  const machinePerHumanMessage: number[] = []
  const bySession = new Map<string, EpisodeWork[]>()
  for (const entry of work) {
    // Only the window's own messages count: a message or injection after the
    // cutoff, or a human message before a spanning episode begins, stays out.
    const humans = entry.ownRecords.filter(isHumanMessage).length
    const machines = entry.ownRecords.filter(
      (record) => record.eventType === 'user/message' && !isHumanMessage(record),
    ).length
    humanMessages += humans
    machineMessages += machines
    const list = bySession.get(entry.episode.sessionId) ?? []
    list.push(entry)
    bySession.set(entry.episode.sessionId, list)
  }
  for (const entry of counted) {
    const humans = entry.ownRecords.filter(isHumanMessage).length
    const machines = entry.ownRecords.filter(
      (record) => record.eventType === 'user/message' && !isHumanMessage(record),
    ).length
    if (humans > 0) {
      stepsPerHumanMessage.push(entry.steps / humans)
      machinePerHumanMessage.push(machines / humans)
    }
  }
  // Follow each goal from its create to its complete, so a goal's human
  // messages and rounds are counted once even when it spans episodes. The
  // complete session stream is replayed in time order, so a completion during
  // an idle gap still closes a goal that was observed earlier.
  interface GoalState {
    messages: number
    rounds: number
    completed: boolean
  }
  const goals = new Map<string, GoalState>()
  const goalOf = (sessionId: string, id: string | undefined): GoalState => {
    const key = id ?? `${sessionId}:unidentified`
    let state = goals.get(key)
    if (state === undefined) {
      state = { messages: 0, rounds: 0, completed: false }
      goals.set(key, state)
    }
    return state
  }
  const keyOf = (sessionId: string, record: TraceRecord): string =>
    record.goalId ?? `${sessionId}:unidentified`
  const streamOf = (sessionId: string, entries: readonly EpisodeWork[]): TraceRecord[] => {
    const provided = goalStreams?.get(sessionId)
    if (provided !== undefined) return [...provided]
    return entries
      .flatMap((entry) => entry.episode.records)
      .filter((record) => record.eventType === 'goal/change')
      .sort((left, right) => left.time - right.time || left.seq - right.seq)
  }
  const reported = new Set<string>()
  for (const [sessionId, entries] of bySession) {
    entries.sort((left, right) => left.episode.start - right.episode.start)
    const stream = streamOf(sessionId, entries)
    const active = new Set<string>()
    const applyLifecycle = (record: TraceRecord): void => {
      const id = keyOf(sessionId, record)
      const state = goalOf(sessionId, record.goalId)
      if (record.goalOperation !== 'complete') {
        if (!state.completed) active.add(id)
      } else {
        state.completed = true
        active.delete(id)
      }
      if (record.goalRounds !== undefined) {
        state.rounds = Math.max(state.rounds, record.goalRounds)
      }
      // A lifecycle event inside the window is reported even when it lands in an
      // idle gap between episodes; a message there is still not attributed.
      if (window !== undefined && record.time >= window.from && record.time < window.to) {
        reported.add(id)
      }
    }
    let cursor = 0
    for (const entry of entries) {
      // A historical episode has no in-window records; leaving its lifecycle
      // events in the stream lets the next observed episode consume them.
      if (entry.ownRecords.length === 0) continue
      const cutoff = entry.cutoff
      const firstOwn = entry.ownRecords[0]
      const lastOwn = entry.ownRecords[entry.ownRecords.length - 1]
      const observed = entry.ownRecords.length > 0
      // Compare by time and sequence, so adjacent episodes that share a
      // timestamp still assign every record to exactly one of them.
      const beforeBoundary = (record: TraceRecord): boolean =>
        firstOwn === undefined ||
        record.time < firstOwn.time ||
        (record.time === firstOwn.time && record.seq < firstOwn.seq)
      const throughEpisode = (record: TraceRecord): boolean =>
        lastOwn === undefined ||
        record.time < lastOwn.time ||
        (record.time === lastOwn.time && record.seq <= lastOwn.seq)
      // Everything before this episode's in-window part only seeds the state.
      while (cursor < stream.length) {
        const record = stream[cursor]
        if (record === undefined || !beforeBoundary(record)) break
        if (record.time < cutoff) applyLifecycle(record)
        cursor += 1
      }
      const touched = new Set<string>()
      while (cursor < stream.length) {
        const record = stream[cursor]
        if (record === undefined || !throughEpisode(record)) break
        if (record.time < cutoff) {
          applyLifecycle(record)
          touched.add(keyOf(sessionId, record))
        }
        cursor += 1
      }
      if (!observed) continue
      const attributed = new Set([...active, ...touched])
      const humans = entry.ownRecords.filter(isHumanMessage).length
      for (const id of attributed) {
        const state = goals.get(id)
        if (state !== undefined) state.messages += humans
        reported.add(id)
      }
    }
    // Events after the last episode (an idle-gap completion) still close a goal
    // that was observed, up to the window cutoff.
    const lastCutoff = entries[entries.length - 1]?.cutoff ?? Number.POSITIVE_INFINITY
    while (cursor < stream.length) {
      const record = stream[cursor]
      if (record === undefined || record.time >= lastCutoff) break
      applyLifecycle(record)
      cursor += 1
    }
  }
  // A goal observed only before the window is history, not a reported goal.
  for (const id of goals.keys()) {
    if (!reported.has(id)) goals.delete(id)
  }
  let rounds = 0
  let completedGoals = 0
  let completedMessages = 0
  for (const state of goals.values()) {
    rounds += state.rounds
    if (state.completed) {
      completedGoals += 1
      completedMessages += state.messages
    }
  }
  const goalCount = goals.size
  const sessions = new Set(counted.map((entry) => entry.episode.sessionId)).size
  return {
    episodes: counted.length,
    sessions,
    ...(sessions === 0 ? {} : { episodesPerSession: counted.length / sessions }),
    humanMessages,
    machineMessages,
    stepsPerHumanMessage: distribution(stepsPerHumanMessage),
    machineMessagesPerHumanMessage: distribution(machinePerHumanMessage),
    goals: goalCount,
    completedGoals,
    ...(goalCount === 0 ? {} : { goalCompletionRate: completedGoals / goalCount }),
    rounds,
    ...(completedGoals === 0
      ? {}
      : { humanMessagesPerCompletedGoal: completedMessages / completedGoals }),
  }
}

/** The widest number of spans active at one instant; a zero-length span is one instant. */
export function parallelWidth(
  spans: readonly { readonly start: number; readonly end: number }[],
): number {
  const points = spans.flatMap((span) => {
    // Half-open spans: touching spans do not overlap, and an instant still counts.
    const end = span.end > span.start ? span.end : span.start + 1
    return [
      { time: span.start, delta: 1 },
      { time: end, delta: -1 },
    ]
  })
  points.sort((left, right) => left.time - right.time || left.delta - right.delta)
  let current = 0
  let widest = 0
  for (const point of points) {
    current += point.delta
    if (current > widest) widest = current
  }
  return widest
}

/** Delegate calls, child work, wait time, and child outcomes. */
export interface SubagentSummary {
  readonly episodes: number
  readonly episodesWithChild: number
  /** Episodes with a child over the cohort; absent when the cohort is empty. */
  readonly delegateRate?: number
  readonly delegateCalls: number
  readonly parallelWidth: number
  /** Milliseconds the parent waited on a delegate call, per episode that waited. */
  readonly parentWaitMs: Distribution
  readonly childTokens: number
  readonly childFailures: number
  readonly linkedChildren: number
  readonly unlinkedChildren: number
}

/** Join delegate calls and child outcomes to their episodes. */
export function subagentSummary(
  work: readonly EpisodeWork[],
  unlinkedChildren: number,
): SubagentSummary {
  let delegateCalls = 0
  let episodesWithChild = 0
  let childTokens = 0
  let childFailures = 0
  let linkedChildren = 0
  let widest = 0
  const waits: number[] = []
  for (const entry of work) {
    const children = entry.children
    if (children.length > 0) episodesWithChild += 1
    linkedChildren += children.length
    widest = Math.max(widest, parallelWidth(children))
    childTokens += entry.childUsage.total
    childFailures += children.filter(
      (child) => child.outcome === 'failed' || child.outcome === 'cut',
    ).length
    const callTimes = new Map<string, number>()
    const intervals: { from: number; to: number }[] = []
    for (const record of entry.ownRecords) {
      if (record.eventType === 'tool/call' && record.tool === 'delegate') {
        delegateCalls += 1
        if (record.callId !== undefined) callTimes.set(record.callId, record.time)
        continue
      }
      if (record.eventType !== 'tool/result' || record.callId === undefined) continue
      const from = callTimes.get(record.callId)
      if (from === undefined) continue
      intervals.push({ from, to: record.time })
      callTimes.delete(record.callId)
    }
    // The parent waits on the union of delegate intervals, not their sum.
    intervals.sort((left, right) => left.from - right.from)
    let waited = 0
    let open: { from: number; to: number } | undefined
    for (const interval of intervals) {
      if (open === undefined) {
        open = interval
        continue
      }
      if (interval.from <= open.to) {
        if (interval.to > open.to) open.to = interval.to
        continue
      }
      waited += open.to - open.from
      open = interval
    }
    if (open !== undefined) waited += open.to - open.from
    if (waited > 0) waits.push(waited)
  }
  return {
    episodes: work.length,
    episodesWithChild,
    ...(work.length === 0 ? {} : { delegateRate: episodesWithChild / work.length }),
    delegateCalls,
    parallelWidth: widest,
    parentWaitMs: distribution(waits),
    childTokens,
    childFailures,
    linkedChildren,
    unlinkedChildren,
  }
}

/** The coverage behind every metric, stated rather than hidden. */
export interface DataQuality {
  readonly steps: number
  readonly stepsWithUsage: number
  readonly messages: number
  readonly messagesWithUsage: number
  readonly usageCoverage: number
  readonly stepCoverage: number
  readonly messageCoverage: number
  readonly episodes: number
  readonly linkedChildren: number
  readonly unlinkedChildren: number
  readonly goalEvents: number
  readonly checkpoints: number
  /** Episodes whose final terminal kind the outcome map does not define. */
  readonly unmappedClosers: number
  /** Episodes entering the treated-and-control comparison. */
  readonly comparisonSample: number
}

/** The data-quality line for a window. */
export function dataQuality(
  work: readonly EpisodeWork[],
  coverage: UsageCoverage,
  unlinkedChildren: number,
  comparisonSample = 0,
): DataQuality {
  let goalEvents = 0
  let checkpoints = 0
  for (const entry of work) {
    goalEvents +=
      entry.goals.created + entry.goals.paused + entry.goals.resumed + entry.goals.completed
    checkpoints += entry.checkpoints.total
  }
  return {
    steps: coverage.steps,
    stepsWithUsage: coverage.stepsWithUsage,
    messages: coverage.messages,
    messagesWithUsage: coverage.messagesWithUsage,
    usageCoverage: coverage.coverage,
    stepCoverage: coverage.stepCoverage,
    messageCoverage: coverage.messageCoverage,
    episodes: work.length,
    linkedChildren: work.reduce((sum, entry) => sum + entry.children.length, 0),
    unlinkedChildren,
    goalEvents,
    checkpoints,
    unmappedClosers: work.filter(
      (entry) => entry.terminal !== undefined && !KNOWN_TERMINALS.has(entry.terminal),
    ).length,
    comparisonSample,
  }
}

/** One outcome word per accepted outcome, in report order. */
export const OUTCOME_ORDER: readonly EpisodeOutcome[] = EPISODE_OUTCOMES

/** Whether a range observes a cutoff or the whole session. */
export function cutoffOf(range: Range, window: Window): number {
  return range === 'session' ? NO_CUTOFF : window.to
}
