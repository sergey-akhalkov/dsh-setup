import type { Definition, DefinitionTrigger, DefinitionTriggerKind, ObligationEventKind } from './definitions.js';
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
/**
 * The shipped catalog path. It resolves from both layouts: `src/host` during a
 * source test (two levels to the package root) and `lib` after compilation (one
 * level), so the built plugin never points outside itself.
 */
export declare function catalogPath(): string;
/** Load the shipped catalog from this package's assets. */
export declare function loadCatalog(): Trigger[];
/**
 * Obligation triggers evaluate a definition's single declarative trigger. The
 * reason vocabulary extends the shadow catalog's with the run outcomes; the
 * two vocabularies share a journal table but not the same typed union.
 */
export declare const OBLIGATION_REASONS: readonly ["would-fire", "run-created", "run-suppressed", "not-applicable", "event-mismatch", "filter-mismatch", "dedupe", "disabled", "not-ready", "error"];
export type ObligationReason = (typeof OBLIGATION_REASONS)[number];
/** One normalized event an obligation trigger may observe. */
export interface DefinitionEvent {
    readonly kind: ObligationEventKind;
    readonly subject: string;
    readonly workspace?: string;
    readonly session?: string;
    readonly turn?: number;
    readonly tool?: string;
    /** The raw observed command; a `match.command` template normalizes it. */
    readonly command?: string;
    /** An engine-provided change name hint; a matched capture takes precedence. */
    readonly name?: string;
    readonly path?: string;
    readonly verdict?: string;
    readonly hash?: string;
    readonly callId?: string;
    readonly classifier?: string;
}
/** One definition trigger's stored evaluation row. */
export interface DefinitionEvaluation {
    readonly definition: string;
    readonly trigger: DefinitionTriggerKind;
    readonly matched: boolean;
    readonly reason: ObligationReason;
    /** The name captured from the matched command template or path glob. */
    readonly capture?: string;
    readonly path?: string;
    readonly filter?: string;
    readonly detail?: string;
    /** The created run id for a run-created outcome. */
    readonly runId?: string;
}
export interface DefinitionEvaluationContext {
    /** The engine is enabled; `false` stops evaluation with `disabled`. */
    readonly enabled?: boolean;
    /** The catalog and engine are ready; `false` records `not-ready`. */
    readonly ready?: boolean;
    /** The resolved applicability of a trigger that declares one. */
    readonly applicability?: boolean;
    readonly isDuplicate: (key: string, definition?: Definition) => boolean;
}
/**
 * The de-duplication identity for one definition trigger and event. It always
 * includes the definition, the trigger policy, and the session; the subject is
 * the turn, the path and content hash, the call id, or the captured name.
 */
export declare function obligationDedupeKey(definition: string, trigger: DefinitionTrigger, event: DefinitionEvent, capture?: string): string | undefined;
/** Evaluate one definition's trigger against one event. Pure and contained. */
export declare function evaluateDefinitionTrigger(definition: Definition, event: DefinitionEvent, context: DefinitionEvaluationContext): DefinitionEvaluation;
export interface StartRunOutcome {
    readonly ok: boolean;
    readonly reason?: string;
    readonly runId?: string;
}
export interface DefinitionRouterContext extends DefinitionEvaluationContext {
    readonly resolveApplicability?: (definition: Definition, event: DefinitionEvent) => boolean | undefined;
    readonly markKey?: (key: string) => void;
    readonly startRun?: (definition: Definition, event: DefinitionEvent, capture?: string) => StartRunOutcome;
}
/**
 * Evaluate every loaded definition for one event. A shadow match records
 * `would-fire` and starts nothing; an active match asks the run starter and
 * records `run-created`, or `run-suppressed` with the bounded cause.
 */
export declare function evaluateDefinitions(definitions: readonly Definition[], event: DefinitionEvent, context: DefinitionRouterContext): DefinitionEvaluation[];
/** The bounded result a classifier returns; it is data, never a command. */
export interface IntentClassification {
    readonly intent: string;
    readonly confidence: number;
    readonly reason: string;
    readonly classifier: string;
}
export interface IntentEvaluationContext extends DefinitionEvaluationContext {
    /** The engine opt-in; without it every active intent stays shadow. */
    readonly allowIntent: boolean;
    /** The definition was installed through the user-confirmed host path. */
    readonly confirmed: boolean;
    readonly session?: string;
    readonly workspace?: string;
    readonly turn?: number;
    readonly markKey?: (key: string) => void;
    readonly startRun?: (definition: Definition, classification: IntentClassification) => StartRunOutcome;
}
/** The classification fields a recorded intent evaluation must name. */
export declare function classificationDetail(classification: IntentClassification): string;
/** Classify one bounded user message; a text without a known intent is no signal. */
export declare function classifyIntent(text: string): IntentClassification | undefined;
/** The dedupe identity an intent trigger declares for one classification. */
export declare function intentDedupeKey(definition: Definition, classification: IntentClassification, context: {
    readonly session?: string;
    readonly turn?: number;
}): string | undefined;
/** Evaluate one intent definition against one classification. */
export declare function evaluateIntentDefinition(definition: Definition, classification: IntentClassification, context: IntentEvaluationContext): DefinitionEvaluation;
/**
 * Evaluate every intent definition. A shadow classification records the
 * classifier, confidence, and reason and starts nothing; an active run needs
 * both `allowIntent` and a user-confirmed definition.
 */
export declare function evaluateIntents(definitions: readonly Definition[], classification: IntentClassification, context: IntentEvaluationContext): DefinitionEvaluation[];
/**
 * The installed goal-continuity checkpoint applicability decision, replicated
 * locally (the cross-package predicate is not exported): a turn needs the
 * resolved tool-call minimum, must not end in a question, and, when required,
 * must carry a write or a worker start.
 */
export interface CheckpointApplicabilityInput {
    readonly toolCalls: number;
    readonly lastTool?: string;
    readonly written: number;
    readonly workers: number;
    readonly minToolCalls?: number;
    readonly requireWrite?: boolean;
}
export declare function checkpointRequired(input: CheckpointApplicabilityInput): boolean;
