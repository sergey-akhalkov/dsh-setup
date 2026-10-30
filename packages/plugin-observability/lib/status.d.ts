import type { RowAggregate } from './aggregate.js';
import type { Row } from './rows.js';
/** The four status words a signal row can carry. */
export type RowStatus = 'not loaded' | 'error' | 'active' | 'silent';
/** The explicit note beside `silent`: absence is not evidence of a fault. */
export declare const SILENT_NOTE = "No traces in this period; absence is not evidence of a fault.";
/** The label a guidance row carries instead of a status. */
export declare const GUIDANCE_NOTE = "Guidance only: this plugin contributes prompt text, which a session log cannot count.";
/** One row's status word and the plain-language note beside it. */
export interface RowState {
    readonly status: RowStatus;
    readonly note: string;
}
/** The tool names a row's predicates bind, in first-seen order. */
export declare function boundTools(row: Row): string[];
/**
 * Compare a signal row against the live tool registry and its own traces.
 * Guidance rows have no status at all; the caller renders their guidance label.
 */
export declare function rowState(row: Row, aggregate: RowAggregate | undefined, registry: ReadonlySet<string>): RowState | undefined;
