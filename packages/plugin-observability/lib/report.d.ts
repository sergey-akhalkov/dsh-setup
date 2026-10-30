import type { AggregateTotals, Range } from './aggregate.js';
import type { RowGroup } from './builtins.js';
import type { TraceRecord } from './records.js';
import type { Row } from './rows.js';
import { type RowStatus } from './status.js';
/** Metadata for one drill-down entry; never message text or tool arguments. */
export interface DetailRow {
    readonly time: number;
    readonly turn?: number;
    readonly signalId: string;
    readonly tool?: string;
    readonly failed?: true;
}
/** One rendered row of the report. */
export interface ReportRow {
    readonly id: string;
    readonly label: string;
    readonly kind: Row['kind'];
    /** How the dashboard files this row: totals, tools, plugins, and so on. */
    readonly group: RowGroup;
    readonly status?: RowStatus;
    readonly note: string;
    readonly traces: number;
    readonly errors: number;
    /** Matched traces per bucket, for the row's sparkline. */
    readonly counts: readonly number[];
    readonly tools: readonly string[];
    /** Newest matched trace in the window, if any. */
    readonly lastActivity?: number;
    readonly details: readonly DetailRow[];
}
/** Everything the view renders for one range. */
export interface Report {
    readonly range: Range;
    readonly from: number;
    readonly to: number;
    readonly bucketLabels: readonly string[];
    /** Whole-window counts, computed from the records once. */
    readonly totals: AggregateTotals;
    /** All records per bucket, for the activity chart. */
    readonly activity: readonly number[];
    /** Failed records per bucket, a subset of `activity`. */
    readonly errorSeries: readonly number[];
    readonly rows: readonly ReportRow[];
    readonly blindSpots: readonly string[];
}
/** What the view must state it cannot observe, not hide. */
export declare const BLIND_SPOTS: readonly string[];
/** How many drill-down entries one row keeps; the dashboard shows five. */
export declare const DETAIL_LIMIT = 25;
/**
 * Assemble the report for one range from the sessions' neutral records.
 * Built-in rows come first, configured rows after; nothing is persisted.
 */
export declare function buildReport(options: {
    readonly range: Range;
    readonly now: number;
    readonly records: readonly TraceRecord[];
    readonly configured: readonly Row[];
    readonly registry: ReadonlySet<string>;
}): Report;
