import type { Aggregate, AggregateTotals, Range, RowAggregate } from './aggregate.js'
import { aggregate } from './aggregate.js'
import type { RowGroup, TestableRow } from './builtins.js'
import { builtinRows, matchesOwnedTool, testableRow } from './builtins.js'
import type {
  EpisodeCheckpoints,
  EpisodeGoals,
  EpisodeInterval,
  EpisodeOutcome,
  SessionInput,
} from './episodes.js'
import {
  addUsage,
  buildEpisodes,
  clipIntervals,
  type Episode,
  intervalLength,
  laneIntervals,
  NO_USAGE,
} from './episodes.js'
import type { Finding } from './findings.js'
import { serialRunFindings } from './findings.js'
import type { Hypothesis, HypothesisResult, MetricValues } from './hypotheses.js'
import { evaluateHypotheses } from './hypotheses.js'
import type {
  AutonomySummary,
  CostSummary,
  DataQuality,
  EpisodeWork,
  QualitySummary,
  SpeedSummary,
  SubagentSummary,
  Window,
} from './metrics.js'
import {
  autonomySummary,
  costSummary,
  cutoffOf,
  dataQuality,
  episodeWork,
  FULL_WINDOW,
  overlapsWindow,
  qualitySummary,
  speedSummary,
  startsIn,
  subagentSummary,
  usageCoverage,
} from './metrics.js'
import type { SessionMeta, TokenUsage, TraceRecord } from './records.js'
import type { Row } from './rows.js'
import { scorecards as buildScorecards, type Scorecard } from './scorecards.js'
import {
  GUIDANCE_NOTE,
  guidanceReadiness,
  type Readiness,
  type ReadinessSources,
  type RowStatus,
  rowState,
} from './status.js'

/** The client renders these beside the report; re-exported so one module is enough. */
export type { Finding } from './findings.js'
export type { HypothesisResult } from './hypotheses.js'
export type { Scorecard } from './scorecards.js'

/** Metadata for one drill-down entry; never message text or tool arguments. */
export interface DetailRow {
  readonly time: number
  readonly turn?: number
  readonly signalId: string
  readonly tool?: string
  readonly failed?: true
}

/** The failure classes the log itself records. */
export type FailureSeverity = 'turn failure' | 'turn cut' | 'tool failure'

/** One failure in the window, independent of the configured rows. */
export interface FailureEntry {
  readonly seq: number
  readonly time: number
  readonly sessionId: string
  /** Session title when the Host could resolve one; the view falls back to a short id. */
  readonly sessionTitle?: string
  readonly severity: FailureSeverity
  /** A tool failure whose turn ended `completed` did not end the work. */
  readonly recovered: boolean
  readonly turn?: number
  readonly step?: number
  readonly tool?: string
  readonly callId?: string
  readonly errorName?: string
  readonly errorCode?: string
}

/** Uncapped failure counts; the rendered list itself is bounded. */
export interface FailureTotals {
  readonly total: number
  readonly turnFailures: number
  readonly turnCuts: number
  readonly toolFailures: number
  readonly recovered: number
}

/** One tool's in-window call population and how many of those calls failed. */
export interface ToolOutcome {
  readonly tool: string
  readonly calls: number
  readonly failed: number
}

/** One rendered row of the report. */
export interface ReportRow {
  readonly id: string
  readonly label: string
  readonly kind: Row['kind']
  /** How the dashboard files this row: totals, tools, plugins, and so on. */
  readonly group: RowGroup
  readonly status?: RowStatus
  /** A guidance row's declared contribution checked against the live registries. */
  readonly readiness?: Readiness
  readonly note: string
  /** What a silent row waits for, when the configuration declares it. */
  readonly trigger?: string
  /** The declared business goal, shown beside the row detail. */
  readonly goal?: string
  /** Whether the row declares an eligible population. */
  readonly eligibilityDeclared: boolean
  readonly traces: number
  readonly errors: number
  /** Failed traces whose turn did not recover them; silence never counts here. */
  readonly unrecoveredErrors: number
  /** Matched traces per bucket, for the row's sparkline. */
  readonly counts: readonly number[]
  readonly tools: readonly string[]
  /** Newest matched trace in the window, if any. */
  readonly lastActivity?: number
  /** Newest failure the row owns, so an error card can name it. */
  readonly lastFailure?: {
    readonly time: number
    readonly tool?: string
    readonly errorName?: string
    readonly errorCode?: string
  }
  readonly details: readonly DetailRow[]
}

/** One child session as the episode detail shows it. */
export interface EpisodeChildReport {
  readonly sessionId: string
  readonly sessionTitle?: string
  readonly origin?: string
  readonly delegationDepth?: number
  readonly outcome: EpisodeOutcome
  readonly verified: boolean
  readonly usage: TokenUsage
  readonly toolCalls: number
}

/** The per-episode lanes the Tasks detail renders. */
export interface EpisodeTimeline {
  readonly from: number
  readonly to: number
  readonly steps: readonly EpisodeInterval[]
  readonly tools: readonly EpisodeInterval[]
  readonly human: readonly number[]
  readonly errors: readonly number[]
  /** Recorded step starts, including a step whose end is missing. */
  readonly stepsCount: number
  /** Recorded tool calls, including a call whose result is missing. */
  readonly callsCount: number
}

/** One episode as the Tasks table and its detail render it. */
export interface EpisodeReport {
  readonly id: string
  readonly sessionId: string
  readonly sessionTitle?: string
  readonly start: number
  readonly end: number
  readonly durationMs: number
  readonly steps: number
  readonly toolCalls: number
  readonly turns: number
  readonly commands: number
  readonly humanMessages: number
  readonly machineMessages: number
  readonly outcome: EpisodeOutcome
  readonly verified: boolean
  readonly failures: number
  readonly substantive: boolean
  /** Active time inside the window. */
  readonly activeMs: number
  /** Active time of the whole episode. */
  readonly activeMsFull: number
  /** Usage measured through the window cutoff. */
  readonly usage: TokenUsage
  /** Usage of the whole episode. */
  readonly fullUsage: TokenUsage
  /** Usage from the episode's start through the window cutoff, including its prefixed work. */
  readonly throughCutoffUsage: TokenUsage
  readonly costBasis: 'through cutoff' | 'full episode'
  readonly goals: EpisodeGoals
  readonly checkpoints: EpisodeCheckpoints
  readonly delegateCalls: number
  readonly parallelWidth: number
  readonly parentWaitMs: number
  readonly children: readonly EpisodeChildReport[]
  /** Configured signal row ids that fired inside this episode; the Tasks filter reads it. */
  readonly firedRows: readonly string[]
  /** The episode's own lanes, for the detail timeline. */
  readonly timeline: EpisodeTimeline
}

/** One turn of a session timeline. */
export interface TimelineTurn {
  readonly turn: number
  readonly start: number
  readonly end: number
  readonly durationMs: number
  readonly steps: readonly EpisodeInterval[]
  readonly tools: readonly EpisodeInterval[]
  readonly human: readonly number[]
  readonly errors: readonly number[]
  readonly stepsCount: number
  readonly callsCount: number
  readonly errorCount: number
}

/** The session range's time-based timeline. */
export interface SessionTimelineData {
  readonly from: number
  readonly to: number
  readonly turns: readonly TimelineTurn[]
}

/** The previous window, or the previous completed session, the report compares against. */
export interface BaselineComparison {
  readonly kind: 'previous equal window' | 'previous completed session'
  readonly from: number
  readonly to: number
  readonly episodes: number
  readonly quality: QualitySummary
  readonly cost: CostSummary
  readonly speed: SpeedSummary
  readonly autonomy: AutonomySummary
  readonly subagents: SubagentSummary
  /** The metric values a hypothesis compares against. */
  readonly metrics: MetricValues
}

/** What the view must state it cannot observe, not hide. */
export const BLIND_SPOTS: readonly string[] = [
  'A plugin that fails while loading appends no session event and registers no tool, prompt section, or skill, so a declaration is the only handle it offers here.',
  'UI rendering effects are not recorded in the session log.',
  'Whether the model complied with a prompted rule cannot be judged from event counts; only the contribution’s presence is checked.',
  'Whether a human accepted a completed result is not recorded; a completed turn is not proof of acceptance.',
  'The configuration and version active in a past session are not recorded, so two sessions may have run different setups.',
  'Every plugin comparison here is an association, not causal proof.',
]

/** How many drill-down entries one row keeps; the dashboard shows five. */
export const DETAIL_LIMIT = 25

/** How many failure entries the report carries; the counts are uncapped. */
export const FAILURE_LIMIT = 200

/** How many episodes the report carries; the counts remain uncapped. */
export const EPISODE_LIMIT = 200

const CUT_KINDS: ReadonlySet<string> = new Set(['max-tokens', 'interrupted'])

function inWindow(record: TraceRecord, range: Range, window: Aggregate): boolean {
  if (range === 'session') return true
  return record.time >= window.from && record.time < window.to
}

function totalTraces(entry: RowAggregate): number {
  return entry.counts.reduce((sum, count) => sum + count, 0)
}

function detail(record: TraceRecord, signalId: string): DetailRow {
  return {
    time: record.time,
    ...(record.turn === undefined ? {} : { turn: record.turn }),
    signalId,
    ...(record.tool === undefined ? {} : { tool: record.tool }),
    ...(record.failed === true ? { failed: true as const } : {}),
  }
}

/** The severity a record earns by the log's own reason, if it is a failure at all. */
function failureSeverity(record: TraceRecord): FailureSeverity | undefined {
  if (record.eventType === 'turn/end') {
    if (record.turnEnd === 'error') return 'turn failure'
    return record.turnEnd !== undefined && CUT_KINDS.has(record.turnEnd) ? 'turn cut' : undefined
  }
  if (record.eventType === 'tool/result' && record.failed === true) return 'tool failure'
  return undefined
}

/** The last closer per session and turn, over the full record set. */
function turnClosers(records: readonly TraceRecord[]): Map<string, Map<number, string>> {
  const closers = new Map<string, Map<number, string>>()
  for (const record of records) {
    if (record.eventType !== 'turn/end' || record.turn === undefined) continue
    let byTurn = closers.get(record.sessionId)
    if (byTurn === undefined) {
      byTurn = new Map()
      closers.set(record.sessionId, byTurn)
    }
    if (record.turnEnd !== undefined) byTurn.set(record.turn, record.turnEnd)
  }
  return closers
}

/** A tool failure is recovered when its turn completed; nothing else can be. */
function isRecovered(
  record: TraceRecord,
  severity: FailureSeverity,
  closers: ReadonlyMap<string, ReadonlyMap<number, string>>,
): boolean {
  if (severity !== 'tool failure' || record.turn === undefined) return false
  return closers.get(record.sessionId)?.get(record.turn) === 'completed'
}

function failureEntry(
  record: TraceRecord,
  severity: FailureSeverity,
  recovered: boolean,
): FailureEntry {
  return {
    seq: record.seq,
    time: record.time,
    sessionId: record.sessionId,
    severity,
    recovered,
    ...(record.turn === undefined ? {} : { turn: record.turn }),
    ...(record.step === undefined ? {} : { step: record.step }),
    ...(record.tool === undefined ? {} : { tool: record.tool }),
    ...(record.callId === undefined ? {} : { callId: record.callId }),
    ...(record.errorName === undefined ? {} : { errorName: record.errorName }),
    ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
  }
}

function countFailures(failures: readonly FailureEntry[]): FailureTotals {
  let turnFailures = 0
  let turnCuts = 0
  let toolFailures = 0
  let recovered = 0
  for (const failure of failures) {
    if (failure.severity === 'turn failure') turnFailures += 1
    else if (failure.severity === 'turn cut') turnCuts += 1
    else toolFailures += 1
    if (failure.recovered) recovered += 1
  }
  return {
    total: failures.length,
    turnFailures,
    turnCuts,
    toolFailures,
    recovered,
  }
}

/**
 * The calls each tool made inside the window, joined to their own result by
 * session and call identity whatever the result's time, so a failing share is
 * always a subset of its call count.
 */
function callOutcomes(
  records: readonly TraceRecord[],
  range: Range,
  window: Aggregate,
): ToolOutcome[] {
  const failedCalls = new Set<string>()
  for (const record of records) {
    if (record.eventType !== 'tool/result' || record.failed !== true) continue
    if (record.callId === undefined) continue
    failedCalls.add(`${record.sessionId}\u0000${record.callId}`)
  }
  const calls = new Map<string, number>()
  const failed = new Map<string, number>()
  for (const record of records) {
    if (record.eventType !== 'tool/call' || record.tool === undefined) continue
    if (!inWindow(record, range, window)) continue
    calls.set(record.tool, (calls.get(record.tool) ?? 0) + 1)
    if (
      record.callId !== undefined &&
      failedCalls.has(`${record.sessionId}\u0000${record.callId}`)
    ) {
      failed.set(record.tool, (failed.get(record.tool) ?? 0) + 1)
    }
  }
  return [...calls.entries()]
    .map(([tool, count]) => ({ tool, calls: count, failed: failed.get(tool) ?? 0 }))
    .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool))
}

/** The episode inputs a record corpus forms, with its listed header metadata. */
function episodesOf(
  records: readonly TraceRecord[],
  sessions: readonly SessionMeta[] | undefined,
): SessionInput[] {
  const bySession = new Map<string, TraceRecord[]>()
  for (const record of records) {
    const list = bySession.get(record.sessionId) ?? []
    list.push(record)
    bySession.set(record.sessionId, list)
  }
  const metaById = new Map((sessions ?? []).map((meta) => [meta.id, meta]))
  const inputs: SessionInput[] = [...bySession.entries()].map(([id, list]) => ({
    id,
    records: list,
    meta: metaById.get(id) ?? { id },
  }))
  for (const meta of sessions ?? []) {
    if (!bySession.has(meta.id)) inputs.push({ id: meta.id, records: [], meta })
  }
  return inputs
}

/** Usage from the episode's start through the cutoff, including pre-window work. */
function usageUntil(episode: Episode, cutoff: number): TokenUsage {
  const records = [...episode.records, ...episode.children.flatMap((child) => child.records)]
  return records.reduce(
    (total, record) =>
      record.usage === undefined || record.time >= cutoff ? total : addUsage(total, record.usage),
    NO_USAGE,
  )
}

/** Milliseconds the parent waited on delegate calls inside the window, unioned. */
function parentWait(work: EpisodeWork): number {
  const callTimes = new Map<string, number>()
  const intervals: EpisodeInterval[] = []
  for (const record of work.ownRecords) {
    if (
      record.eventType === 'tool/call' &&
      record.tool === 'delegate' &&
      record.callId !== undefined
    ) {
      callTimes.set(record.callId, record.time)
      continue
    }
    if (record.eventType !== 'tool/result' || record.callId === undefined) continue
    const from = callTimes.get(record.callId)
    if (from === undefined) continue
    intervals.push({ from, to: record.time })
    callTimes.delete(record.callId)
  }
  // Overlapping delegate waits count once, matching the summary's union.
  return intervalLength(
    clipIntervals(intervals, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY),
  )
}

/** The widest number of children active at once in one episode. */
function episodeParallel(work: EpisodeWork): number {
  const points = work.children.flatMap((child) => {
    const end = child.end > child.start ? child.end : child.start + 1
    return [
      { time: child.start, delta: 1 },
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

function episodeReport(
  work: EpisodeWork,
  titles: ReadonlyMap<string, string>,
  rows: readonly TestableRow[],
): EpisodeReport {
  const episode = work.episode
  const lanes = laneIntervals(episode.records)
  const start = episode.start
  const end = episode.end
  return {
    id: episode.id,
    sessionId: episode.sessionId,
    ...(titles.get(episode.sessionId) === undefined
      ? {}
      : { sessionTitle: titles.get(episode.sessionId) as string }),
    start: episode.start,
    end: episode.end,
    durationMs: episode.end - episode.start,
    steps: work.steps,
    toolCalls: work.toolCalls,
    turns: episode.turns,
    commands: episode.commands,
    humanMessages: episode.humanMessages,
    machineMessages: episode.machineMessages,
    outcome: work.outcome,
    verified: work.verified,
    failures: work.failures,
    substantive: work.substantive,
    activeMs: work.activeMs,
    activeMsFull: episode.activeMs,
    usage: work.usage,
    fullUsage: work.fullUsage,
    throughCutoffUsage: usageUntil(episode, work.cutoff),
    costBasis: work.costBasis,
    goals: work.goals,
    checkpoints: work.checkpoints,
    delegateCalls: work.ownRecords.filter(
      (record) => record.eventType === 'tool/call' && record.tool === 'delegate',
    ).length,
    parallelWidth: episodeParallel(work),
    parentWaitMs: parentWait(work),
    children: work.children.map((child) => {
      const detail = episode.children.find((entry) => entry.sessionId === child.sessionId)
      return {
        sessionId: child.sessionId,
        ...(titles.get(child.sessionId) === undefined
          ? {}
          : { sessionTitle: titles.get(child.sessionId) as string }),
        ...(detail?.origin === undefined ? {} : { origin: detail.origin }),
        ...(detail?.delegationDepth === undefined
          ? {}
          : { delegationDepth: detail.delegationDepth }),
        outcome: child.outcome,
        verified: child.verified,
        usage: child.usage,
        toolCalls: child.toolCalls,
      }
    }),
    firedRows: rows
      .filter(
        (entry) =>
          entry.row.kind === 'signal' &&
          [...work.ownRecords, ...work.childRecords].some((record) => entry.test(record)),
      )
      .map((entry) => entry.row.id),
    timeline: {
      from: start,
      to: end,
      steps: clipIntervals(lanes.steps, Math.max(start, work.episode.start), end),
      tools: clipIntervals(lanes.tools, Math.max(start, work.episode.start), end),
      human: episode.records
        .filter((record) => record.eventType === 'user/message' && record.sourceKind === 'user')
        .map((record) => record.time),
      errors: episode.records
        .filter((record) => record.failed === true)
        .map((record) => record.time),
      // Recorded counters, so an unfinished step or pending call still shows.
      stepsCount: episode.records.filter((record) => record.eventType === 'step/start').length,
      callsCount: episode.records.filter((record) => record.eventType === 'tool/call').length,
    },
  }
}

/** The session range's time-based timeline, one lane per turn. */
function sessionTimeline(records: readonly TraceRecord[]): SessionTimelineData {
  if (records.length === 0) return { from: 0, to: 0, turns: [] }
  let from = Number.POSITIVE_INFINITY
  let to = Number.NEGATIVE_INFINITY
  for (const record of records) {
    if (record.time < from) from = record.time
    if (record.time > to) to = record.time
  }
  if (to <= from) to = from + 1
  interface Accumulator {
    start: number
    end: number
    steps: EpisodeInterval[]
    tools: EpisodeInterval[]
    human: number[]
    errors: number[]
    stepsCount: number
    callsCount: number
    errorCount: number
    stepStarts: Map<string, number>
    callStarts: Map<string, number>
  }
  const turns = new Map<number, Accumulator>()
  const accumulator = (turn: number): Accumulator => {
    let entry = turns.get(turn)
    if (entry === undefined) {
      entry = {
        start: Number.POSITIVE_INFINITY,
        end: Number.NEGATIVE_INFINITY,
        steps: [],
        tools: [],
        human: [],
        errors: [],
        stepsCount: 0,
        callsCount: 0,
        errorCount: 0,
        stepStarts: new Map(),
        callStarts: new Map(),
      }
      turns.set(turn, entry)
    }
    return entry
  }
  for (const record of records) {
    // A record outside any turn stays on the timeline under turn 0.
    const entry = accumulator(record.turn ?? 0)
    if (record.time < entry.start) entry.start = record.time
    if (record.time > entry.end) entry.end = record.time
    if (record.failed === true) {
      entry.errors.push(record.time)
      entry.errorCount += 1
    }
    if (record.eventType === 'user/message' && record.sourceKind === 'user') {
      entry.human.push(record.time)
      continue
    }
    if (record.eventType === 'step/start') {
      entry.stepsCount += 1
      if (record.step !== undefined) {
        entry.stepStarts.set(`${String(record.turn)}:${String(record.step)}`, record.time)
      }
      continue
    }
    if (record.eventType === 'step/end' && record.step !== undefined) {
      const start = entry.stepStarts.get(`${String(record.turn)}:${String(record.step)}`)
      if (start !== undefined) entry.steps.push({ from: start, to: record.time })
      continue
    }
    if (record.eventType === 'tool/call') {
      entry.callsCount += 1
      if (record.callId !== undefined) entry.callStarts.set(record.callId, record.time)
      continue
    }
    if (record.eventType === 'tool/result' && record.callId !== undefined) {
      const start = entry.callStarts.get(record.callId)
      if (start !== undefined) entry.tools.push({ from: start, to: record.time })
    }
  }
  return {
    from,
    to,
    turns: [...turns.entries()]
      .sort(([left], [right]) => left - right)
      .map(([turn, entry]) => ({
        turn,
        start: entry.start,
        end: entry.end,
        durationMs: Math.max(0, entry.end - entry.start),
        steps: entry.steps,
        tools: entry.tools,
        human: entry.human,
        errors: entry.errors,
        stepsCount: entry.stepsCount,
        callsCount: entry.callsCount,
        errorCount: entry.errorCount,
      })),
  }
}

/** The window's tokens from attributed episode work, each child counted once. */
function attributedUsage(work: readonly EpisodeWork[]): TokenUsage {
  return work.reduce((total, entry) => addUsage(total, entry.usage), NO_USAGE)
}

/** The complete goal stream per session, including events outside an episode. */
function goalStreams(records: readonly TraceRecord[]): Map<string, TraceRecord[]> {
  const streams = new Map<string, TraceRecord[]>()
  for (const record of records) {
    if (record.eventType !== 'goal/change') continue
    const list = streams.get(record.sessionId) ?? []
    list.push(record)
    streams.set(record.sessionId, list)
  }
  for (const list of streams.values()) {
    list.sort((left, right) => left.time - right.time || left.seq - right.seq)
  }
  return streams
}

/** The records behind the attributed usage: own and joined-child records once. */
function attributedRecords(work: readonly EpisodeWork[]): TraceRecord[] {
  return work.flatMap((entry) => [...entry.ownRecords, ...entry.childRecords])
}

/** The metric values a hypothesis is evaluated against. */
function metricValues(
  work: readonly EpisodeWork[],
  quality: QualitySummary,
  cost: CostSummary,
  autonomy: AutonomySummary,
  subagents: SubagentSummary,
): MetricValues {
  const tokensPerEpisode =
    work.length === 0
      ? undefined
      : work.reduce((sum, entry) => sum + entry.usage.total, 0) / work.length
  const activePerEpisode =
    work.length === 0
      ? undefined
      : work.reduce((sum, entry) => sum + entry.activeMs, 0) / work.length / 60_000
  const stepsPerHuman =
    autonomy.humanMessages === 0
      ? undefined
      : work.reduce((sum, entry) => sum + entry.steps, 0) / autonomy.humanMessages
  return {
    samples: work.length,
    ...(quality.verifiedShare === undefined
      ? {}
      : { verifiedCompletionRate: quality.verifiedShare }),
    ...(tokensPerEpisode === undefined ? {} : { tokensPerEpisode }),
    ...(cost.contextPerStep === undefined ? {} : { contextTokensPerStep: cost.contextPerStep }),
    ...(activePerEpisode === undefined ? {} : { activeMinutesPerEpisode: activePerEpisode }),
    ...(stepsPerHuman === undefined ? {} : { stepsPerHumanMessage: stepsPerHuman }),
    ...(autonomy.humanMessagesPerCompletedGoal === undefined
      ? {}
      : { humanMessagesPerCompletedGoal: autonomy.humanMessagesPerCompletedGoal }),
    ...(subagents.delegateRate === undefined ? {} : { delegateRate: subagents.delegateRate }),
    ...(quality.checkpointCoverage === undefined
      ? {}
      : { checkpointCoverage: quality.checkpointCoverage }),
    ...(quality.failureRate === undefined ? {} : { failureRate: quality.failureRate }),
  }
}

/** The summaries a baseline comparison carries. */
function baselineComparison(options: {
  readonly kind: BaselineComparison['kind']
  readonly records: readonly TraceRecord[]
  readonly sessions: readonly SessionMeta[] | undefined
  readonly from: number
  readonly to: number
  readonly idleGapMs: number
}): BaselineComparison {
  const window = { from: options.from, to: options.to }
  const index = buildEpisodes(episodesOf(options.records, options.sessions), options.idleGapMs)
  const work = index.episodes.map((episode) => episodeWork(episode, window))
  const cohort = work.filter((entry) => startsIn(entry.episode, window))
  // Window totals come from attributed episode work, so an unlinked child or a
  // preamble record is never added outside its episode.
  const usage = attributedUsage(work)
  const coverage = usageCoverage(attributedRecords(work), FULL_WINDOW)
  const quality = qualitySummary(cohort)
  const cost = costSummary(cohort, usage, coverage, options.to)
  const speed = speedSummary(cohort)
  const autonomy = autonomySummary(work, cohort, goalStreams(options.records), window)
  const subagents = subagentSummary(cohort, index.unlinked.length)
  return {
    kind: options.kind,
    from: options.from,
    to: options.to,
    episodes: cohort.length,
    quality,
    cost,
    speed,
    autonomy,
    subagents,
    metrics: metricValues(cohort, quality, cost, autonomy, subagents),
  }
}

/** The bucket series; the session range uses time buckets, never turns. */
function timeSeries(
  records: readonly TraceRecord[],
  range: Range,
  window: Aggregate,
): { labels: string[]; activity: number[]; errorSeries: number[] } {
  if (range !== 'session') {
    return {
      labels: window.buckets.map((bucket) => bucket.label),
      activity: [...window.activity],
      errorSeries: [...window.errorSeries],
    }
  }
  const buckets = 24
  if (records.length === 0) {
    return {
      labels: Array.from({ length: buckets }, (_unused, index) => `b${String(index + 1)}`),
      activity: new Array<number>(buckets).fill(0),
      errorSeries: new Array<number>(buckets).fill(0),
    }
  }
  let from = Number.POSITIVE_INFINITY
  let to = Number.NEGATIVE_INFINITY
  for (const record of records) {
    if (record.time < from) from = record.time
    if (record.time > to) to = record.time
  }
  const span = Math.max(1, to + 1 - from)
  const width = span / buckets
  const activity = new Array<number>(buckets).fill(0)
  const errorSeries = new Array<number>(buckets).fill(0)
  const labels = Array.from({ length: buckets }, (_unused, index) => {
    const time = from + index * width
    const date = new Date(time)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  })
  for (const record of records) {
    const index = Math.min(buckets - 1, Math.max(0, Math.floor((record.time - from) / width)))
    activity[index] = (activity[index] ?? 0) + 1
    if (record.failed === true) errorSeries[index] = (errorSeries[index] ?? 0) + 1
  }
  return { labels, activity, errorSeries }
}

/** The metric values a window's records produce; used for a hypothesis's own window. */
export function metricValuesFor(options: {
  readonly records: readonly TraceRecord[]
  readonly sessions?: readonly SessionMeta[]
  readonly idleGapMinutes: number
  readonly window: Window
}): MetricValues {
  const index = buildEpisodes(
    episodesOf(options.records, options.sessions),
    options.idleGapMinutes * 60_000,
  )
  const work = index.episodes.map((episode) => episodeWork(episode, options.window))
  const cohort = work.filter((entry) => startsIn(entry.episode, options.window))
  const usage = attributedUsage(work)
  const coverage = usageCoverage(attributedRecords(work), FULL_WINDOW)
  const quality = qualitySummary(cohort)
  const cost = costSummary(cohort, usage, coverage, options.window.to)
  const autonomy = autonomySummary(work, cohort, goalStreams(options.records), options.window)
  const subagents = subagentSummary(cohort, index.unlinked.length)
  return metricValues(cohort, quality, cost, autonomy, subagents)
}

/** Everything the view renders for one range. */
export interface Report {
  readonly range: Range
  readonly from: number
  readonly to: number
  readonly bucketLabels: readonly string[]
  /** Whole-window counts, computed from the records once. */
  readonly totals: AggregateTotals
  /** Window usage attributed by event time. */
  readonly windowCost: TokenUsage
  /** All records per bucket, for the range series. */
  readonly activity: readonly number[]
  /** Failed records per bucket, a subset of `activity`. */
  readonly errorSeries: readonly number[]
  /** Newest failures first; bounded to {@link FAILURE_LIMIT} entries. */
  readonly failures: readonly FailureEntry[]
  readonly failureTotals: FailureTotals
  /** In-window tool calls and the failing share of each, joined by call identity. */
  readonly toolOutcomes: readonly ToolOutcome[]
  readonly rows: readonly ReportRow[]
  /** Newest first, capped at {@link EPISODE_LIMIT}; the counts stay uncapped. */
  readonly episodes: readonly EpisodeReport[]
  readonly episodeCount: number
  /** Episodes whose start lies in the window; the cohort outcomes select by start. */
  readonly cohortCount: number
  readonly quality: QualitySummary
  readonly cost: CostSummary
  readonly speed: SpeedSummary
  readonly autonomy: AutonomySummary
  readonly subagents: SubagentSummary
  readonly dataQuality: DataQuality
  readonly scorecards: readonly Scorecard[]
  readonly hypotheses: readonly HypothesisResult[]
  /** Attention findings derived from the metadata; empty when nothing is wrong. */
  readonly findings: readonly Finding[]
  /** Uncapped active time of the window, attributed by event time. */
  readonly windowActiveMs: number
  readonly baseline?: BaselineComparison
  /** Only the session range, whose buckets are time rather than turns. */
  readonly timeline?: SessionTimelineData
  readonly blindSpots: readonly string[]
  readonly cutoffLabel: 'through cutoff' | 'full episode'
  /** The configured minimum episodes per comparison side. */
  readonly minEpisodes: number
}

/**
 * Assemble the report for one range from the sessions' neutral records.
 * Built-in rows come first, configured rows after; nothing is persisted.
 */
export function buildReport(options: {
  readonly range: Range
  readonly now: number
  readonly records: readonly TraceRecord[]
  readonly configured: readonly Row[]
  readonly registry: ReadonlySet<string>
  readonly readiness?: ReadinessSources
  /** Session header metadata from the reader, used to join child sessions. */
  readonly sessions?: readonly SessionMeta[]
  /** Episode boundaries, comparison minimum, and hypotheses. */
  readonly config?: {
    readonly idleGapMinutes: number
    readonly minEpisodes: number
    readonly hypotheses: readonly Hypothesis[]
  }
  /** The previous window or session, when the reader resolved one. */
  readonly baseline?: {
    readonly kind: BaselineComparison['kind']
    readonly records: readonly TraceRecord[]
    readonly sessions?: readonly SessionMeta[]
    readonly from: number
    readonly to: number
  }
  /** Session titles by id; applied to failures and episodes. */
  readonly titles?: ReadonlyMap<string, string>
  /**
   * Metric values per hypothesis window, when the caller resolved windows other
   * than the requested range. Without it a hypothesis falls back to the report's
   * own window values.
   */
  readonly hypothesisValues?: ReadonlyMap<Range, { current: MetricValues; baseline?: MetricValues }>
}): Report {
  const rows: TestableRow[] = [
    ...builtinRows(options.records),
    ...options.configured.map(testableRow),
  ]
  const configuredRows = options.configured.map(testableRow)
  const window = aggregate(options.records, rows, options.range, options.now)
  const idleGapMs = (options.config?.idleGapMinutes ?? 30) * 60_000
  const minEpisodes = options.config?.minEpisodes ?? 10
  const index = buildEpisodes(episodesOf(options.records, options.sessions), idleGapMs)
  const observed = options.range === 'session' ? FULL_WINDOW : { from: window.from, to: window.to }
  const work = index.episodes.map((episode) => episodeWork(episode, observed))
  const cohort = work.filter((entry) => startsIn(entry.episode, observed))
  const usage = attributedUsage(work)
  const coverage = usageCoverage(attributedRecords(work), FULL_WINDOW)
  const cutoff = cutoffOf(options.range, observed)
  const titles = options.titles ?? new Map<string, string>()
  const quality = qualitySummary(cohort)
  const cost = costSummary(cohort, usage, coverage, cutoff)
  const speed = speedSummary(cohort)
  const autonomy = autonomySummary(work, cohort, goalStreams(options.records), observed)
  const subagents = subagentSummary(cohort, index.unlinked.length)
  // Scorecards evaluate window records and count the start-selected cohort.
  const cards = buildScorecards(configuredRows, cohort, minEpisodes)
  const compared = cards.reduce((sum, card) => sum + card.treated.n + card.control.n, 0)
  const data = dataQuality(cohort, coverage, index.unlinked.length, compared)
  const current = metricValues(cohort, quality, cost, autonomy, subagents)
  const comparison =
    options.baseline === undefined
      ? undefined
      : baselineComparison({
          kind: options.baseline.kind,
          records: options.baseline.records,
          sessions: options.baseline.sessions,
          from: options.baseline.from,
          to: options.baseline.to,
          idleGapMs,
        })
  const baselineValues = comparison?.metrics
  // A hypothesis is evaluated over the window it declares, not over whichever
  // range the view happens to request.
  const valuesFor = (range: Range): { current: MetricValues; baseline?: MetricValues } => {
    const provided = options.hypothesisValues?.get(range)
    if (provided !== undefined) return provided
    return {
      current,
      ...(baselineValues === undefined ? {} : { baseline: baselineValues }),
    }
  }
  const hypotheses = (options.config?.hypotheses ?? []).flatMap((hypothesis, hypothesisIndex) =>
    evaluateHypotheses(
      [hypothesis],
      valuesFor(hypothesis.window).current,
      valuesFor(hypothesis.window).baseline,
    ).map((result) => ({ ...result, index: hypothesisIndex })),
  )
  const closers = turnClosers(options.records)
  const failures: FailureEntry[] = []
  for (const record of options.records) {
    if (!inWindow(record, options.range, window)) continue
    const severity = failureSeverity(record)
    if (severity === undefined) continue
    failures.push(failureEntry(record, severity, isRecovered(record, severity, closers)))
  }
  failures.sort((left, right) => right.time - left.time || right.seq - left.seq)
  const failureTotals = countFailures(failures)
  const failureByRecord = new Map(
    failures.map((failure) => [`${failure.sessionId}:${String(failure.seq)}`, failure]),
  )
  const readinessSources: ReadinessSources = options.readiness ?? { skillsComplete: false }
  const report: ReportRow[] = rows.map((entry) => {
    const rowAggregate = window.rows.get(entry.row.id)
    const traces = rowAggregate === undefined ? 0 : totalTraces(rowAggregate)
    const state = rowState(entry.row, rowAggregate, options.registry)
    const readiness =
      entry.row.kind === 'guidance' ? guidanceReadiness(entry.row, readinessSources) : undefined
    const details =
      entry.row.kind === 'guidance'
        ? []
        : options.records
            .filter((record) => inWindow(record, options.range, window) && entry.test(record))
            .sort((left, right) => right.time - left.time)
            .slice(0, DETAIL_LIMIT)
            .map((record) => detail(record, entry.row.id))
    const errors = rowAggregate?.errors ?? 0
    const rowFailures =
      errors === 0
        ? []
        : options.records
            .filter((record) => {
              if (record.failed !== true) return false
              if (!inWindow(record, options.range, window)) return false
              return entry.test(record) || matchesOwnedTool(record, entry.row.match ?? [])
            })
            .sort((left, right) => right.time - left.time)
            .flatMap((record) => {
              const failure = failureByRecord.get(`${record.sessionId}:${String(record.seq)}`)
              return failure === undefined ? [] : [failure]
            })
    const lastFailure = rowFailures[0]
    // A row whose failures were all recovered needs no attention of its own.
    const unrecoveredErrors = rowFailures.filter((failure) => !failure.recovered).length
    return {
      id: entry.row.id,
      label: entry.row.label,
      kind: entry.row.kind,
      group: entry.group,
      ...(state === undefined ? {} : { status: state.status }),
      ...(readiness === undefined ? {} : { readiness }),
      note: state?.note ?? GUIDANCE_NOTE,
      ...(entry.row.trigger === undefined ? {} : { trigger: entry.row.trigger }),
      ...(entry.row.goal === undefined ? {} : { goal: entry.row.goal }),
      eligibilityDeclared: entry.row.eligible !== undefined,
      traces,
      errors,
      unrecoveredErrors,
      counts: rowAggregate?.counts ?? [],
      tools: [...new Set((entry.row.match ?? []).flatMap((predicate) => predicate.tool ?? []))],
      ...(details[0] === undefined ? {} : { lastActivity: details[0].time }),
      ...(lastFailure === undefined
        ? {}
        : {
            lastFailure: {
              time: lastFailure.time,
              ...(lastFailure.tool === undefined ? {} : { tool: lastFailure.tool }),
              ...(lastFailure.errorName === undefined ? {} : { errorName: lastFailure.errorName }),
              ...(lastFailure.errorCode === undefined ? {} : { errorCode: lastFailure.errorCode }),
            },
          }),
      details,
    }
  })
  const bounded = work
    .filter((entry) => overlapsWindow(entry.episode, observed))
    .sort((left, right) => right.episode.start - left.episode.start)
  const series = timeSeries(options.records, options.range, window)
  return {
    range: options.range,
    from: window.from,
    to: window.to,
    bucketLabels: series.labels,
    totals: window.totals,
    windowCost: usage,
    activity: series.activity,
    errorSeries: series.errorSeries,
    failures: failures.slice(0, FAILURE_LIMIT),
    failureTotals,
    toolOutcomes: callOutcomes(options.records, options.range, window),
    rows: report,
    episodes: bounded
      .slice(0, EPISODE_LIMIT)
      .map((entry) => episodeReport(entry, titles, configuredRows)),
    episodeCount: bounded.length,
    cohortCount: cohort.length,
    quality,
    cost,
    speed,
    autonomy,
    subagents,
    dataQuality: data,
    scorecards: cards,
    hypotheses,
    findings: serialRunFindings(cohort),
    windowActiveMs: work.reduce((sum, entry) => sum + entry.activeMs, 0),
    ...(comparison === undefined ? {} : { baseline: comparison }),
    ...(options.range === 'session' ? { timeline: sessionTimeline(options.records) } : {}),
    blindSpots: BLIND_SPOTS,
    cutoffLabel: cost.cutoffLabel,
    minEpisodes,
  }
}

/** Name the sessions of failures, episodes, and children; an absent title falls back to the id. */
export function attachSessionTitles(report: Report, titles: ReadonlyMap<string, string>): Report {
  if (titles.size === 0) return report
  return {
    ...report,
    failures: report.failures.map((failure) => {
      const title = titles.get(failure.sessionId)
      return title === undefined ? failure : { ...failure, sessionTitle: title }
    }),
    episodes: report.episodes.map((episode) => {
      const title = titles.get(episode.sessionId)
      const children = episode.children.map((child) => {
        const childTitle = titles.get(child.sessionId)
        return childTitle === undefined ? child : { ...child, sessionTitle: childTitle }
      })
      return {
        ...(title === undefined ? episode : { ...episode, sessionTitle: title }),
        children,
      }
    }),
  }
}
