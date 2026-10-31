import type { Aggregate, AggregateTotals, Range, RowAggregate } from './aggregate.js'
import { aggregate } from './aggregate.js'
import type { RowGroup, TestableRow } from './builtins.js'
import { builtinRows, matchesOwnedTool, testableRow } from './builtins.js'
import type { TraceRecord } from './records.js'
import type { Row } from './rows.js'
import {
  GUIDANCE_NOTE,
  guidanceReadiness,
  type Readiness,
  type ReadinessSources,
  type RowStatus,
  rowState,
} from './status.js'

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

/** Everything the view renders for one range. */
export interface Report {
  readonly range: Range
  readonly from: number
  readonly to: number
  readonly bucketLabels: readonly string[]
  /** Whole-window counts, computed from the records once. */
  readonly totals: AggregateTotals
  /** All records per bucket, for the activity chart. */
  readonly activity: readonly number[]
  /** Failed records per bucket, a subset of `activity`. */
  readonly errorSeries: readonly number[]
  /** Newest failures first; bounded to {@link FAILURE_LIMIT} entries. */
  readonly failures: readonly FailureEntry[]
  readonly failureTotals: FailureTotals
  /** In-window tool calls and the failing share of each, joined by call identity. */
  readonly toolOutcomes: readonly ToolOutcome[]
  readonly rows: readonly ReportRow[]
  readonly blindSpots: readonly string[]
}

/** What the view must state it cannot observe, not hide. */
export const BLIND_SPOTS: readonly string[] = [
  'A plugin that fails while loading appends no session event and registers no tool, prompt section, or skill, so a declaration is the only handle it offers here.',
  'UI rendering effects are not recorded in the session log.',
  'Whether the model complied with a prompted rule cannot be judged from event counts; only the contribution’s presence is checked.',
]

/** How many drill-down entries one row keeps; the dashboard shows five. */
export const DETAIL_LIMIT = 25

/** How many failure entries the report carries; the counts are uncapped. */
export const FAILURE_LIMIT = 200

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

/**
 * Assemble the report for one range from the sessions' neutral records.
 * Built-in rows come first, configured rows after; nothing is persisted.
 */ export function buildReport(options: {
  readonly range: Range
  readonly now: number
  readonly records: readonly TraceRecord[]
  readonly configured: readonly Row[]
  readonly registry: ReadonlySet<string>
  readonly readiness?: ReadinessSources
}): Report {
  const rows: TestableRow[] = [
    ...builtinRows(options.records),
    ...options.configured.map(testableRow),
  ]
  const window = aggregate(options.records, rows, options.range, options.now)
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
  return {
    range: options.range,
    from: window.from,
    to: window.to,
    bucketLabels: window.buckets.map((bucket) => bucket.label),
    totals: window.totals,
    activity: window.activity,
    errorSeries: window.errorSeries,
    failures: failures.slice(0, FAILURE_LIMIT),
    failureTotals,
    toolOutcomes: callOutcomes(options.records, options.range, window),
    rows: report,
    blindSpots: BLIND_SPOTS,
  }
}

/** Name the failure sessions; an absent title falls back to the short id in the view. */
export function attachSessionTitles(report: Report, titles: ReadonlyMap<string, string>): Report {
  if (titles.size === 0) return report
  return {
    ...report,
    failures: report.failures.map((failure) => {
      const title = titles.get(failure.sessionId)
      return title === undefined ? failure : { ...failure, sessionTitle: title }
    }),
  }
}
