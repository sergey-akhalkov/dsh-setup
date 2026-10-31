import type { TestableRow } from './builtins.js';
import type { TraceRecord } from './records.js';
/** The four fixed ranges of the view. */
export type Range = 'session' | 'day' | 'week' | 'month';
/** Every accepted range, in selector order. */
export declare const RANGES: readonly Range[];
/** Whether a value is one of the accepted ranges. */
export declare function isRange(value: unknown): value is Range;
/** Local midnight at or before a timestamp. */
export declare function startOfLocalDay(time: number): number;
/** Local hour start at or before a timestamp. */
export declare function startOfLocalHour(time: number): number;
/** One bucket window in epoch milliseconds; `to` is exclusive. */
export interface BucketWindow {
    readonly label: string;
    readonly from: number;
    readonly to: number;
}
/** The window and buckets a range selects. */
export interface RangeWindow {
    readonly range: Range;
    readonly from: number;
    readonly to: number;
    readonly buckets: readonly BucketWindow[];
}
/**
 * The fixed window for a range. Session buckets come from the session's own
 * turns plus one trailing outside-turn bucket; the other ranges are trailing
 * local-hour and local-day windows ending now.
 */
export declare function rangeWindow(range: Range, now: number, turns: number): RangeWindow;
/** One row's contribution to an aggregate. */
export interface RowAggregate {
    readonly rowId: string;
    /** Matched traces per bucket, in bucket order. */
    readonly counts: readonly number[];
    /** Failed traces attributed to the row anywhere in the window. */
    readonly errors: number;
}
/** Whole-window counts for the KPI strip; never a sum of overlapping rows. */
export interface AggregateTotals {
    readonly turns: number;
    readonly steps: number;
    readonly toolCalls: number;
    readonly errors: number;
    readonly records: number;
    /** Distinct sessions that contributed an in-window record. */
    readonly sessions: number;
}
/** The pure aggregate over one window. */
export interface Aggregate {
    readonly range: Range;
    readonly from: number;
    readonly to: number;
    readonly buckets: readonly BucketWindow[];
    readonly rows: ReadonlyMap<string, RowAggregate>;
    readonly totals: AggregateTotals;
    /** All in-window records per bucket, for the dashboard activity chart. */
    readonly activity: readonly number[];
    /** Failed in-window records per bucket; a subset of `activity`. */
    readonly errorSeries: readonly number[];
}
/**
 * Compute per-row counts and errors for one range. Pure: the caller supplies
 * the records, the rows, and `now`, so no clock or Host is touched.
 */
export declare function aggregate(records: readonly TraceRecord[], rows: readonly TestableRow[], range: Range, now: number): Aggregate;
