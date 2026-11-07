/**
 * The shipped shadow trigger catalog. Triggers are data only: loading,
 * validating, and evaluating them never registers a tool or steers a turn.
 */
/** The event kinds a trigger may observe. Intent classification is not one. */
export declare const EVENT_KINDS: readonly ["agent.turn-start", "agent.turn-stop", "tool.result", "subagent.start", "subagent.end", "fs.change"];
export type EventKind = (typeof EVENT_KINDS)[number];
/** This change ships every trigger in shadow mode; disabled stays refusable. */
export declare const TRIGGER_MODES: readonly ["shadow", "disabled"];
export type TriggerMode = (typeof TRIGGER_MODES)[number];
/** De-duplication policies a trigger may declare. */
export declare const DEDUPE_POLICIES: readonly ["none", "path+content-hash"];
export type DedupePolicy = (typeof DEDUPE_POLICIES)[number];
/** The filter vocabulary; an unknown member is a load failure. */
export interface TriggerFilter {
    readonly path?: string;
    readonly tool?: string;
    readonly change?: 'created-or-modified';
}
/** One declarative shadow trigger. */
export interface Trigger {
    readonly id: string;
    readonly event: EventKind;
    readonly filter: TriggerFilter;
    readonly mode: TriggerMode;
    readonly dedupe: DedupePolicy;
}
/** Validate one catalog value; a failure names the trigger and its field. */
export declare function validateCatalog(raw: unknown): Trigger[];
/** Read and validate one catalog file. */
export declare function readCatalog(file: string): Trigger[];
/** Load the shipped catalog from this package's assets. */
export declare function loadCatalog(): Trigger[];
