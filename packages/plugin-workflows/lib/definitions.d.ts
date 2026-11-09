/**
 * Workflow definitions are closed-schema JSON data. Every field is validated
 * before a definition can be listed or started; an unknown field, a duplicate
 * step id, or an edge that names no step fails the load and names the
 * definition and the field, never a bare stack trace.
 */
export declare const DEFINITION_SCHEMA_VERSION = 1;
/** A definition id is also its install file name, so it must be path-safe. */
export declare const DEFINITION_ID: RegExp;
/** The deterministic event kinds a definition trigger may observe. */
export declare const OBLIGATION_EVENT_KINDS: readonly ["turn.stopping", "tool.pre-execute", "tool.result", "fs.change", "subagent.end", "review.record"];
export type ObligationEventKind = (typeof OBLIGATION_EVENT_KINDS)[number];
/** The optional intent trigger is a separate kind, never a deterministic event. */
export declare const DEFINITION_TRIGGER_KINDS: readonly ["turn.stopping", "tool.pre-execute", "tool.result", "fs.change", "subagent.end", "review.record", "intent"];
export type DefinitionTriggerKind = (typeof DEFINITION_TRIGGER_KINDS)[number];
export declare const TRIGGER_MODES: readonly ["shadow", "active"];
export type TriggerMode = (typeof TRIGGER_MODES)[number];
/** De-duplication identities: a trigger, a session, and the event subject. */
export declare const DEDUPE_POLICIES: readonly ["none", "turn", "path+content-hash", "callId", "name"];
export type DedupePolicy = (typeof DEDUPE_POLICIES)[number];
/** Which dedupe identities each event kind can actually provide. */
export declare const DEDUPE_BY_TRIGGER: Record<DefinitionTriggerKind, readonly DedupePolicy[]>;
/** The one applicability decision a definition may declare for a trigger. */
export declare const APPLICABILITY_KINDS: readonly ["checkpoint-required", "code-write"];
export type ApplicabilityKind = (typeof APPLICABILITY_KINDS)[number];
/** The structured command match an intent trigger accepts. */
export type TriggerCommand = 'openspec new change <name>' | 'openspec archive <name>';
export declare const TRIGGER_COMMANDS: readonly TriggerCommand[];
/** Filters are exact strings except the two workspace/path globs. */
export interface TriggerMatch {
    readonly workspace?: string;
    readonly session?: string;
    readonly tool?: string;
    readonly command?: TriggerCommand;
    readonly path?: string;
    readonly subject?: string;
    readonly verdict?: string;
    readonly classifier?: string;
    /** The classified intent name, for the optional intent trigger. */
    readonly intent?: string;
}
export interface DefinitionTrigger {
    readonly kind: DefinitionTriggerKind;
    readonly match: TriggerMatch;
    readonly mode: TriggerMode;
    readonly dedupe: DedupePolicy;
    readonly repeat?: boolean;
    readonly applicability?: ApplicabilityKind;
}
export declare const EXECUTORS: readonly ["main", "subagent", "tool", "branch", "loop", "human"];
export type Executor = (typeof EXECUTORS)[number];
export declare const RISKS: readonly ["low", "medium", "high"];
export type Risk = (typeof RISKS)[number];
export declare const GATE_OWNERSHIP: readonly ["own", "defer"];
export type GateOwnership = (typeof GATE_OWNERSHIP)[number];
/** The legacy gate a deferred definition or step defers to. */
export interface LegacySource {
    readonly plugin: string;
    readonly signal: string;
}
export interface DefinitionSettings {
    readonly allowModelStart: boolean;
    readonly risk: Risk;
    readonly gateOwnership: GateOwnership;
    readonly maxBlocks: number;
    readonly allowIntent: boolean;
    /** Tool names a `tool` step may call. */
    readonly allowTools?: readonly string[];
    readonly legacy?: LegacySource;
}
export declare const EVIDENCE_KINDS: readonly ["file", "record", "tool", "check", "human", "all", "declaration"];
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export interface FileEvidence {
    readonly kind: 'file';
    /** Workspace-relative path; `glob` enables `*`/`**` segments. */
    readonly path: string;
    readonly minBytes?: number;
    readonly glob?: boolean;
}
export interface AllEvidence {
    readonly kind: 'all';
    readonly items: readonly Evidence[];
}
export interface RecordEvidence {
    readonly kind: 'record';
    readonly rule: string;
    /** Matched when declared; a checkpoint record carries no change. */
    readonly change?: string;
    /** The single accepted verdict; exactly one of verdict/verdicts is required. */
    readonly verdict?: string;
    /** Every accepted verdict; for a task review that is PASS or ERROR. */
    readonly verdicts?: readonly string[];
    /** Workspace-relative record path; derived from rule/change/phase when absent. */
    readonly path?: string;
    readonly phase?: string;
    readonly scope?: string;
    readonly task?: string;
    /** `current` compares the record's digest with the change's current digest. */
    readonly digest?: 'current' | string;
    /** `review` (default) or the goal-continuity checkpoint record. */
    readonly source?: 'review' | 'checkpoint';
}
export interface ToolCallEvidence {
    readonly kind: 'tool';
    readonly name: string;
    readonly command?: string;
    readonly args?: Readonly<Record<string, unknown>>;
}
export interface CheckEvidence {
    readonly kind: 'check';
    readonly command?: string;
    /** erify-settings reads the validated profile command list. */
    readonly source?: 'verify-settings';
}
export interface HumanEvidence {
    readonly kind: 'human';
    /** Every declared accepted answer; only a match completes the step. */
    readonly answer: string | readonly string[];
}
export interface DeclarationEvidence {
    readonly kind: 'declaration';
}
export type Evidence = FileEvidence | AllEvidence | RecordEvidence | ToolCallEvidence | CheckEvidence | HumanEvidence | DeclarationEvidence;
/** A fixed tool call; `{name}` is the only interpolation and is validated. */
export interface ToolSpec {
    readonly name: string;
    readonly command?: string;
    readonly args?: Readonly<Record<string, unknown>>;
}
export interface SubagentSpec {
    readonly provider: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    /** Required closed result schema; a child result that does not match fails the step. */
    readonly schema: Readonly<Record<string, unknown>>;
}
export interface HumanSpec {
    readonly timeoutAction?: 'block' | 'cancel';
}
export interface BranchSpec {
    readonly predicate: Readonly<Record<string, unknown>>;
    readonly then: string;
    readonly else: string;
}
export interface LoopSpec {
    readonly maxIterations: number;
    readonly stop: Readonly<Record<string, unknown>>;
    readonly next: string;
    readonly cap?: 'blocked' | 'failed';
    /** An optional context key holding the list to iterate over. */
    readonly list?: string;
}
export declare const MAX_LOOP_ITERATIONS = 50;
export interface Step {
    readonly id: string;
    readonly title: string;
    readonly executor: Executor;
    readonly prompt?: string;
    readonly evidence?: Evidence;
    readonly next?: string;
    readonly blockTurnClose?: boolean;
    readonly nonCritical?: boolean;
    readonly ownership?: GateOwnership;
    readonly legacy?: LegacySource;
    readonly tool?: ToolSpec;
    readonly subagent?: SubagentSpec;
    readonly human?: HumanSpec;
    readonly branch?: BranchSpec;
    readonly loop?: LoopSpec;
}
export interface Definition {
    readonly v: typeof DEFINITION_SCHEMA_VERSION;
    readonly id: string;
    readonly name: string;
    readonly version: number;
    readonly trigger: DefinitionTrigger;
    readonly settings: DefinitionSettings;
    readonly steps: readonly Step[];
}
/** The closed JSON Schema subset a subagent result may use; unsupported keywords fail the load. */
export declare function resultSchemaShapeError(schema: Readonly<Record<string, unknown>>, depth?: number): string | undefined;
/** Validate one raw definition; every failure names the definition and field. */
export declare function validateDefinition(raw: unknown, source?: string): Definition;
/** The host approval store; signed with the host key. */
export declare function workspaceDefinitionsDirectory(workspace: string): string;
/** Model-writable drafts; the loader never reads this directory. */
export declare function workspaceDraftsDirectory(workspace: string): string;
/** One step's effective ownership after the definition and profile resolve. */
export interface ResolvedStepOwnership {
    readonly id: string;
    readonly ownership: GateOwnership;
    readonly legacy?: LegacySource;
}
export interface OwnershipResolution {
    readonly steps: readonly ResolvedStepOwnership[];
    /** One load-refusing line per illegal combination. */
    readonly issues: readonly string[];
}
/** The legacy plugins this engine knows how to defer to. */
export declare const KNOWN_LEGACY_SOURCES: readonly ["delegation-rules", "goal-continuity"];
/** The legacy signal state a load or gate decision resolves against. */
export interface LegacySignalState {
    readonly installed: ReadonlySet<string>;
    /** `${plugin}/${signal}` entries that would actually steer. */
    readonly enabled: ReadonlySet<string>;
}
/**
 * Resolve ownership per definition and step against the installed and enabled
 * legacy sources. A `defer` needs an enabled source; an `own` step may not
 * declare an enabled source for the same behavior. A deferred definition
 * defers every step, so only a definition-level `own` can carry a deferred
 * step such as `spec-review`.
 */
export declare function resolveOwnership(definition: Definition, installed: ReadonlySet<string>, enabledSignals?: ReadonlySet<string>): OwnershipResolution;
/** Read and validate one definition file. */
export declare function readDefinitionFile(file: string): Definition;
/**
 * The shipped definition directory. Like the trigger catalog it resolves from
 * both `src/host` during a source test and `lib` after compilation.
 */
export declare function shippedDefinitionsDirectory(): string;
/** Load every shipped definition; a duplicate id or invalid file fails the load. */
export declare function loadShippedDefinitions(): Definition[];
