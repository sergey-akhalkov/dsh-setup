/**
 * Declarative signal rows. A row is inert data: an id, a label, a kind, and a
 * match over session-event facts. Nothing here is executed.
 */
/** A row either reports traces (`signal`) or names a prompt-only plugin (`guidance`). */
export type RowKind = 'signal' | 'guidance';
/** One argument field/value check on a tool call's raw JSON arguments. */
export interface ArgumentMatch {
    readonly field: string;
    readonly value: string;
}
/**
 * One event predicate. A predicate with several fields requires all of them;
 * a row's predicate list is an any-of, so one row can cover several tools.
 */
export interface Predicate {
    readonly eventType?: string;
    readonly tool?: string;
    readonly sourceKind?: string;
    readonly abortPrefix?: string;
    readonly command?: string;
    readonly argument?: ArgumentMatch;
}
/** One configured row. */
export interface Row {
    readonly id: string;
    readonly label: string;
    readonly kind: RowKind;
    readonly match?: readonly Predicate[];
}
/** A configuration error that names the offending field or row. */
export declare class RowConfigError extends Error {
    constructor(message: string);
}
/**
 * Validate the configured row list. An absent list is valid: the built-in
 * signal sets still work on a profile with no configuration.
 */
export declare function parseRows(raw: unknown): Row[];
