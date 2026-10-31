import type { AggregateTotals, Range } from './aggregate.js';
import type { RowGroup } from './builtins.js';
import type { TraceRecord } from './records.js';
import type { Row } from './rows.js';
import { type Readiness, type ReadinessSources, type RowStatus } from './status.js';
/** Metadata for one drill-down entry; never message text or tool arguments. */
export interface DetailRow {
    readonly time: number;
    readonly turn?: number;
    readonly signalId: string;
    readonly tool?: string;
    readonly failed?: true;
}
/** The failure classes the log itself records. */
export type FailureSeverity = 'turn failure' | 'turn cut' | 'tool failure';
/** One failure in the window, independent of the configured rows. */
export interface FailureEntry {
    readonly seq: number;
    readonly time: number;
    readonly sessionId: string;
    /** Session title when the Host could resolve one; the view falls back to a short id. */
    readonly sessionTitle?: string;
    readonly severity: FailureSeverity;
    /** A tool failure whose turn ended `completed` did not end the work. */
    readonly recovered: boolean;
    readonly turn?: number;
    readonly step?: number;
    readonly tool?: string;
    readonly callId?: string;
    readonly errorName?: string;
    readonly errorCode?: string;
}
/** Uncapped failure counts; the rendered list itself is bounded. */
export interface FailureTotals {
    readonly total: number;
    readonly turnFailures: number;
    readonly turnCuts: number;
    readonly toolFailures: number;
    readonly recovered: number;
}
/** One tool's in-window call population and how many of those calls failed. */
export interface ToolOutcome {
    readonly tool: string;
    readonly calls: number;
    readonly failed: number;
}
/** One rendered row of the report. */
export interface ReportRow {
    readonly id: string;
    readonly label: string;
    readonly kind: Row['kind'];
    /** How the dashboard files this row: totals, tools, plugins, and so on. */
    readonly group: RowGroup;
    readonly status?: RowStatus;
    /** A guidance row's declared contribution checked against the live registries. */
    readonly readiness?: Readiness;
    readonly note: string;
    /** What a silent row waits for, when the configuration declares it. */
    readonly trigger?: string;
    readonly traces: number;
    readonly errors: number;
    /** Failed traces whose turn did not recover them; silence never counts here. */
    readonly unrecoveredErrors: number;
    /** Matched traces per bucket, for the row's sparkline. */
    readonly counts: readonly number[];
    readonly tools: readonly string[];
    /** Newest matched trace in the window, if any. */
    readonly lastActivity?: number;
    /** Newest failure the row owns, so an error card can name it. */
    readonly lastFailure?: {
        readonly time: number;
        readonly tool?: string;
        readonly errorName?: string;
        readonly errorCode?: string;
    };
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
    /** Newest failures first; bounded to {@link FAILURE_LIMIT} entries. */
    readonly failures: readonly FailureEntry[];
    readonly failureTotals: FailureTotals;
    /** In-window tool calls and the failing share of each, joined by call identity. */
    readonly toolOutcomes: readonly ToolOutcome[];
    readonly rows: readonly ReportRow[];
    readonly blindSpots: readonly string[];
}
/** What the view must state it cannot observe, not hide. */
export declare const BLIND_SPOTS: readonly string[];
/** How many drill-down entries one row keeps; the dashboard shows five. */
export declare const DETAIL_LIMIT = 25;
/** How many failure entries the report carries; the counts are uncapped. */
export declare const FAILURE_LIMIT = 200;
/**
 * Assemble the report for one range from the sessions' neutral records.
 * Built-in rows come first, configured rows after; nothing is persisted.
 */ export declare function buildReport(options: {
    readonly range: Range;
    readonly now: number;
    readonly records: readonly TraceRecord[];
    readonly configured: readonly Row[];
    readonly registry: ReadonlySet<string>;
    readonly readiness?: ReadinessSources;
}): Report;
/** Name the failure sessions; an absent title falls back to the short id in the view. */
export declare function attachSessionTitles(report: Report, titles: ReadonlyMap<string, string>): Report;
