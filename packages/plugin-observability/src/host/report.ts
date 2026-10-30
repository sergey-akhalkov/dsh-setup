import type { Aggregate, AggregateTotals, Range, RowAggregate } from './aggregate.js'
import { aggregate } from './aggregate.js'
import type { RowGroup } from './builtins.js'
import { builtinRows, type TestableRow, testableRow } from './builtins.js'
import type { TraceRecord } from './records.js'
import type { Row } from './rows.js'
import { GUIDANCE_NOTE, type RowStatus, rowState } from './status.js'

/** Metadata for one drill-down entry; never message text or tool arguments. */
export interface DetailRow {
  readonly time: number
  readonly turn?: number
  readonly signalId: string
  readonly tool?: string
  readonly failed?: true
}

/** One rendered row of the report. */
export interface ReportRow {
  readonly id: string
  readonly label: string
  readonly kind: Row['kind']
  /** How the dashboard files this row: totals, tools, plugins, and so on. */
  readonly group: RowGroup
  readonly status?: RowStatus
  readonly note: string
  readonly traces: number
  readonly errors: number
  /** Matched traces per bucket, for the row's sparkline. */
  readonly counts: readonly number[]
  readonly tools: readonly string[]
  /** Newest matched trace in the window, if any. */
  readonly lastActivity?: number
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
  readonly rows: readonly ReportRow[]
  readonly blindSpots: readonly string[]
}

/** What the view must state it cannot observe, not hide. */
export const BLIND_SPOTS: readonly string[] = [
  'Prompt-only guidance plugins are named in the list, but whether their prompt text changed a turn cannot be seen in the log.',
  'A plugin that fails while loading appends no session event, so its failure is invisible here.',
  'UI rendering effects are not recorded in the session log.',
  'Whether the model complied with a prompted rule cannot be judged from event counts.',
]

/** How many drill-down entries one row keeps; the dashboard shows five. */
export const DETAIL_LIMIT = 25

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
}): Report {
  const rows: TestableRow[] = [
    ...builtinRows(options.records),
    ...options.configured.map(testableRow),
  ]
  const window = aggregate(options.records, rows, options.range, options.now)
  const report: ReportRow[] = rows.map((entry) => {
    const rowAggregate = window.rows.get(entry.row.id)
    const traces = rowAggregate === undefined ? 0 : totalTraces(rowAggregate)
    const state = rowState(entry.row, rowAggregate, options.registry)
    const details =
      entry.row.kind === 'guidance'
        ? []
        : options.records
            .filter((record) => inWindow(record, options.range, window) && entry.test(record))
            .sort((left, right) => right.time - left.time)
            .slice(0, DETAIL_LIMIT)
            .map((record) => detail(record, entry.row.id))
    return {
      id: entry.row.id,
      label: entry.row.label,
      kind: entry.row.kind,
      group: entry.group,
      ...(state === undefined ? {} : { status: state.status }),
      note: state?.note ?? GUIDANCE_NOTE,
      traces,
      errors: rowAggregate?.errors ?? 0,
      counts: rowAggregate?.counts ?? [],
      tools: [...new Set((entry.row.match ?? []).flatMap((predicate) => predicate.tool ?? []))],
      ...(details[0] === undefined ? {} : { lastActivity: details[0].time }),
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
    rows: report,
    blindSpots: BLIND_SPOTS,
  }
}
