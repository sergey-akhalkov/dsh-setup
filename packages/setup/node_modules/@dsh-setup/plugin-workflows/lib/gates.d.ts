import type { Definition, Step } from './definitions.js';
import type { EvidenceCheck, EvidenceContext } from './evidence.js';
import type { WorkflowReceipt } from './receipts.js';
import { type WorkflowRun } from './runs.js';
import type { SteerTarget } from './steer.js';
/**
 * The turn-close gate. It refuses a root turn close while the run has an open
 * `blockTurnClose` step that this engine owns; a deferred step never steers.
 * The refusal is bounded by `maxBlocks`; after the cap the close is allowed
 * exactly once and recorded as a visible VIOLATION, not a pass. An internal
 * error fails open so a plugin fault can never trap a turn.
 */
export type TurnCloseOutcome = {
    readonly kind: 'allow';
    readonly run: WorkflowRun;
    readonly reason: string;
} | {
    readonly kind: 'refuse';
    readonly run: WorkflowRun;
    readonly stepId: string;
    readonly text: string;
} | {
    readonly kind: 'violation';
    readonly run: WorkflowRun;
    readonly detail: string;
};
export interface TurnCloseInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly agent: SteerTarget;
    readonly evidenceContext: EvidenceContext;
    readonly turn: number;
    readonly maxBlocks: number;
    readonly origin?: 'root' | 'subagent';
    /** The legacy plugins the profile installs. */
    readonly installedLegacy: ReadonlySet<string>;
    /** `${plugin}/signal` entries that would actually steer; absent means installed = enabled. */
    readonly enabledLegacy?: ReadonlySet<string>;
    /** The owned completion-coverage decision for this turn, when it applies. */
    readonly completion?: {
        readonly ok: boolean;
        readonly text?: string;
    };
    /** The owned checkpoint remedy/age decision for this turn, when it applies. */
    readonly checkpointIssue?: {
        readonly text: string;
    };
    readonly now?: number;
    readonly onError?: (error: unknown) => void;
}
/**
 * The first open `blockTurnClose` owned step, unless an earlier open step is
 * deferred: an unresolved deferred prerequisite stops the selection no matter
 * whether it blocks the turn close itself, because the legacy gate is the only
 * steer for it.
 */
export declare function selectBlockingStep(run: WorkflowRun, definition: Definition, installedLegacy: ReadonlySet<string>, enabledLegacy?: ReadonlySet<string>): Step | undefined;
/** Evaluate one root turn stop. */
export declare function evaluateTurnClose(input: TurnCloseInput): TurnCloseOutcome;
export type IntakeGateDecision = {
    readonly kind: 'allow';
    readonly reason: string;
    readonly runId?: string;
} | {
    readonly kind: 'deny';
    readonly reason: string;
    readonly action: 'started' | 'resumed' | 'adopt';
    readonly runId?: string;
    readonly stepId?: string;
};
export interface IntakeGateInput {
    readonly name: string;
    readonly session: string;
    readonly workspace: string;
    readonly callId?: string;
    /** The matched definition that declares the intake gate. */
    readonly definition: Definition;
    /** Every authenticated run in the workspace. */
    readonly runs: readonly WorkflowRun[];
    /** Every verified receipt in the workspace. */
    readonly receipts: readonly WorkflowReceipt[];
    /** Host-owned call ids the gate may dispatch. */
    readonly ownedCallIds: ReadonlySet<string>;
    readonly changeExists: boolean;
    readonly startRun: (definition: Definition, name: string) => Promise<{
        runId: string;
    }>;
    readonly resumeRun: (runId: string) => Promise<{
        stepId: string;
    }>;
}
/**
 * The pre-execute intake gate, in the required order: an authenticated
 * completed run or receipt allows; an owned create-change call allows; a
 * resumable intake resumes and is refused; an existing change directory is
 * redirected to adoption; otherwise the run starts and the call is refused.
 */
export declare function evaluateIntakeGate(input: IntakeGateInput): Promise<IntakeGateDecision>;
export interface DeferredStepInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly stepId: string;
    readonly installedLegacy: ReadonlySet<string>;
    /** `${plugin}/${signal}` entries that would actually steer. */
    readonly enabledLegacy?: ReadonlySet<string>;
    /** The existing legacy reader; it never dispatches an executor. */
    readonly readRecord: (step: Step) => Promise<EvidenceCheck>;
    readonly now?: number;
}
export interface DeferredStepResult {
    readonly run: WorkflowRun;
    /** A deferred step never dispatches its declared executor. */
    readonly dispatched: false;
    /** A deferred step never steers; the legacy gate is the only steer. */
    readonly steered: false;
    readonly stepId: string;
}
/**
 * Run one deferred step at runtime. It reads the existing legacy record,
 * updates its own step, and never dispatches its executor or steers. A missing
 * or mismatched record leaves the step open and the run blocked for visibility;
 * the legacy gate alone is still the enforcing path.
 */
export declare function runDeferredStep(input: DeferredStepInput): Promise<DeferredStepResult>;
/** The host-owned directories and store a model write may never target. */
export declare const PROTECTED_WRITE_PREFIXES: readonly [".dsh/workflows/definitions/", ".dsh/workflows/approved.json", ".dsh/workflows/receipts/", ".dsh/workflows/runs/"];
export interface FileWriteIntent {
    readonly tool: string;
    /** Every non-empty path-like argument the tool may consume. */
    readonly paths: readonly string[];
    /** Two different targets are named; the guard must not guess which is written. */
    readonly conflict: boolean;
}
/** The file-write intent of one tool execution, when it is a recognized write. */
export declare function recognizeFileWrite(exec: {
    readonly name: string;
    readonly arguments?: unknown;
}): FileWriteIntent | undefined;
export interface AuthorizationWriteInput {
    readonly workspace: string;
    readonly exec: {
        readonly name: string;
        readonly arguments?: unknown;
    };
    /** The host-owned call ids; only their writes may reach the protected paths. */
    readonly ownedCallIds: ReadonlySet<string>;
    readonly callId?: string;
}
/**
 * The pre-execute authorization write guard. A model-originated write to a
 * definition, the approval store, a receipt, or a run file is refused; an
 * owned host call is allowed. Returns undefined when the call is untouched.
 */
export declare function authorizationWriteDecision(input: AuthorizationWriteInput): {
    readonly kind: 'allow';
} | {
    readonly kind: 'deny';
    readonly reason: string;
} | undefined;
export interface ArchiveGateInput {
    readonly change: string;
    /** Whether a run file failed authentication; a tampered store fails closed. */
    readonly tamperedRuns?: boolean;
    /** Every authenticated run in the workspace. */
    readonly runs: readonly WorkflowRun[];
    /** Every verified receipt in the workspace. */
    readonly receipts: readonly WorkflowReceipt[];
    /** The whole-spec `PASS` record, already verified against the current digest. */
    readonly specRecord: EvidenceCheck;
    /** The owned per-task portable PASS coverage, computed from the workspace. */
    readonly taskReview?: {
        readonly ok: boolean;
        readonly text?: string;
    };
}
export type ArchiveGateDecision = {
    readonly kind: 'allow';
    readonly reason: string;
} | {
    readonly kind: 'deny';
    readonly reason: string;
};
/**
 * The archive gate. It refuses while a related run has an open required step,
 * no authenticated completed intake run and no verified receipt exist, or the
 * current whole-spec PASS record is missing or stale. A text claim is never an
 * input; only the authenticated run, receipt, and record can allow.
 */
export declare function evaluateArchiveGate(input: ArchiveGateInput): ArchiveGateDecision;
