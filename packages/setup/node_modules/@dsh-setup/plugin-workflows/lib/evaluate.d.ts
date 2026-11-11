import type { EventKind, Trigger } from './triggers.js';
/**
 * Pure shadow-trigger evaluation. Every observed event is evaluated against
 * every trigger and records one fixed reason; a matched shadow trigger reports
 * `would-fire` and never calls a tool or steers.
 */
export declare const WHY_NOT_REASONS: readonly ["would-fire", "event-mismatch", "filter-mismatch", "dedupe", "disabled", "not-ready", "error"];
export type WhyNotReason = (typeof WHY_NOT_REASONS)[number];
/** One trigger's result for one observed event. */
export interface Evaluation {
    readonly matched: boolean;
    readonly reason: WhyNotReason;
    /** The rejected path or filter, when a filter mismatch explains it. */
    readonly path?: string;
    readonly filter?: string;
    /** The contained failure, when an evaluation threw. */
    readonly detail?: string;
}
/** The normalized event the evaluator sees. */
export interface ObservedEvent {
    readonly kind: EventKind;
    readonly subject: string;
    readonly tool?: string;
    readonly change?: 'created' | 'modified' | 'deleted';
    readonly hash?: string;
}
export interface EvaluationContext {
    /** The catalog loaded and the recorder is ready to evaluate. */
    readonly ready: boolean;
    /** Whether this event was already evaluated for this trigger. */
    isDuplicate(key: string): boolean;
}
/** One glob segment, where `*` matches any run of non-slash characters. */
export declare function segmentGlobMatches(pattern: string, value: string): boolean;
/** Segment glob: `*` within one segment, `**` across zero or more segments. */
export declare function globMatches(pattern: string, path: string): boolean;
/** The de-duplication identity for one trigger/event pair, or undefined. */
export declare function evaluationKey(trigger: Trigger, event: ObservedEvent): string | undefined;
/** One stored evaluation row; structurally the journal's record type. */
export interface EvaluatedTrigger {
    readonly id: string;
    readonly matched: boolean;
    readonly reason: WhyNotReason;
    readonly path?: string;
    readonly filter?: string;
    readonly detail?: string;
}
/** The de-duplication window; a distinct change after it fires again. */
export declare const DEDUPE_WINDOW_MS = 250;
/**
 * Evaluate the whole catalog for one event. Keys are added to `seen` with their
 * evaluation time; a second identical event inside the window reports `dedupe`,
 * while the same content observed after the window is a new change.
 */
export declare function evaluateEvent(triggers: readonly Trigger[], event: ObservedEvent, seen: Map<string, number>, ready?: boolean, now?: number, windowMs?: number): EvaluatedTrigger[];
export declare function evaluate(trigger: Trigger, event: ObservedEvent, context: EvaluationContext): Evaluation;
