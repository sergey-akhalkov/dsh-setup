import type { TraceRecord } from './records.js';
import type { ArgumentMatch, Predicate, Row } from './rows.js';
/** How the dashboard files one row. */
export type RowGroup = 'activity' | 'tools' | 'sources' | 'aborts' | 'errors' | 'plugin';
/** A row plus the predicate test aggregation applies to one record. */
export interface TestableRow {
    readonly row: Row;
    readonly test: (record: TraceRecord) => boolean;
    readonly group: RowGroup;
}
/** Parse raw tool-call arguments; malformed JSON simply matches nothing. */
export declare function readArguments(raw: string | undefined): Record<string, unknown> | undefined;
/** Whether raw tool-call arguments carry the configured field/value. */
export declare function argumentMatches(raw: string | undefined, argument: ArgumentMatch): boolean;
/** Whether one record satisfies every field of one predicate. */
export declare function matchesPredicate(record: TraceRecord, predicate: Predicate): boolean;
/** Whether a failed tool result belongs to a row that names its tool (and argument). */
export declare function matchesOwnedTool(record: TraceRecord, match: readonly Predicate[]): boolean;
/** Whether one record satisfies any predicate of a row's any-of list. */
export declare function matchesRow(record: TraceRecord, match: readonly Predicate[]): boolean;
/** Turn a configured row into the row aggregation tests. */
export declare function testableRow(row: Row): TestableRow;
/**
 * The built-in sets that work with no configuration at all: activity, one row
 * per observed tool name, one row per injected-message source kind, one row per
 * abort owner, and errors. A tool, source, or abort no configuration mentions
 * still gets a row under its own name.
 */
export declare function builtinRows(records: readonly TraceRecord[]): TestableRow[];
