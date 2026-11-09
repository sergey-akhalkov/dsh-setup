import { renameSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import type { HostAuth } from './host-auth.js';
/**
 * Durable workflow obligation runs. A run is one JSON file under
 * `.dsh/workflows/runs/`; every transition replaces the file atomically so a
 * crash leaves the previous readable state, never a torn one. An authoritative
 * run carries a host HMAC signature over its persisted state; an unsigned or
 * modified file is refused for resume, gate admission, and receipt issuance.
 */
export declare const RUN_VERSION = 1;
export declare const RUN_STATUSES: readonly ["running", "blocked", "completed", "failed", "cancelled", "interrupted"];
export type RunStatus = (typeof RUN_STATUSES)[number];
export declare const STEP_STATES: readonly ["open", "done", "blocked", "failed", "cancelled"];
export type StepState = (typeof STEP_STATES)[number];
/** What satisfied one step. */
export interface RunEvidence {
    readonly kind: string;
    /** The workspace-relative path, call id, or record the evidence names. */
    readonly ref?: string;
    readonly path?: string;
    readonly detail?: string;
    readonly digest?: string;
    readonly answer?: string;
    readonly callId?: string;
    readonly bytes?: number;
    readonly at?: number;
    /** The schema-validated child result a subagent step settled on. */
    readonly result?: unknown;
}
export interface RunStep {
    readonly id: string;
    readonly state: StepState;
    readonly requestedAt?: number;
    readonly at?: number;
    readonly attempts?: number;
    /** The turn in which this step was last steered, so one turn steers once. */
    readonly lastTurn?: number;
    readonly evidence?: RunEvidence;
    readonly reason?: string;
    /** The producer-owned failure class of a blocked or failed step. */
    readonly failureClass?: string;
}
export declare function classifyFailure(reason: string | undefined): string;
/** A visible refusal or bypass; never a pass. */
export interface RunViolation {
    readonly stepId?: string;
    readonly at: number;
    readonly reason: string;
}
/** The definition identity a run records at creation; copied, never looked up. */
export interface RunDefinitionRef {
    readonly id: string;
    readonly name: string;
    readonly version: number;
}
export interface WorkflowRun {
    /** The branch or loop successor selected by the last executed edge. */
    readonly nextStep?: string;
    /** The ordered selected path from the last executed edge. */
    readonly branchPath?: readonly string[];
    readonly v: typeof RUN_VERSION;
    readonly id: string;
    /** The definition identity in effect when the run started. */
    readonly definition: RunDefinitionRef;
    readonly trigger: string;
    readonly session: string;
    readonly workspaceKey: string;
    readonly status: RunStatus;
    readonly createdAt: number;
    readonly updatedAt: number;
    /** A bounded explanation for an interrupted or blocked run. */
    readonly reason?: string;
    /** Turn-close refusals since the last visible violation. */
    readonly turnBlocks?: number;
    readonly context: Readonly<Record<string, unknown>>;
    readonly steps: readonly RunStep[];
    readonly violations: readonly RunViolation[];
    /** The trigger identity that produced this run, for dedupe after reload. */
    readonly dedupeKey?: string;
}
/** The run directory for one workspace. */
export declare function runsDirectory(workspace: string): string;
/** The run file for one id. */
export declare function runPath(workspace: string, id: string): string;
/** A fresh stable run id. */
export declare function newRunId(now?: number): string;
export interface CreateRunInput {
    readonly definition: string | RunDefinitionRef;
    /** Legacy input fields, normalized into `definition` before persistence. */
    readonly definitionName?: string;
    readonly definitionVersion?: number;
    readonly trigger: string;
    readonly session: string;
    readonly workspace: string;
    readonly context?: Readonly<Record<string, unknown>>;
    readonly steps: readonly string[];
    readonly now?: number;
    readonly id?: string;
    readonly dedupeKey?: string;
}
/** Normalize an input or stored definition identity to the persisted object. */
export declare function definitionRefOf(definition: unknown, legacyName?: unknown, legacyVersion?: unknown): RunDefinitionRef;
/** Build a new running run with every step open. */
export declare function createRun(input: CreateRunInput): WorkflowRun;
/** Persist one run atomically and sign its authoritative state. */
/** Persist one run atomically and sign its authoritative state. */
export interface WriteRunOptions {
    readonly renameSync?: typeof renameSync;
}
export declare function writeRunSync(workspace: string, run: WorkflowRun, auth: HostAuth, options?: WriteRunOptions): void;
export interface WriteRunAsyncOptions {
    readonly rename?: typeof rename;
}
export declare function writeRun(workspace: string, run: WorkflowRun, auth: HostAuth, options?: WriteRunAsyncOptions): Promise<void>;
/**
 * Read and authenticate one run. An unsigned, modified, or forged file reads as
 * absent: no caller may resume, admit, or issue a receipt from it.
 */
/** Compare the run's bound workspace with the workspace asking for it. */
export declare function sameWorkspace(left: string, right: string): boolean;
export declare function readAuthenticatedRun(workspace: string, id: string, auth: HostAuth): Promise<WorkflowRun | undefined>;
/** Read one run for display only; never use this for authority. */
export declare function readRunUnverified(workspace: string, id: string): Promise<WorkflowRun | undefined>;
export interface StoredRunEntry {
    readonly id: string;
    readonly size: number;
    readonly mtimeMs: number;
}
/**
 * Every run file on disk, oldest first, as retention sees it. Only `ENOENT`
 * means absent history; any other listing or stat failure propagates so a gate
 * cannot read an unreadable store as an empty one.
 */
export declare function storedRuns(workspace: string): Promise<StoredRunEntry[]>;
/** Every readable run in one workspace, oldest first (display only). */
export declare function listRuns(workspace: string): Promise<WorkflowRun[]>;
/** Every run that authenticates against the host key. */
export declare function listAuthenticatedRuns(workspace: string, auth: HostAuth): Promise<WorkflowRun[]>;
/** Replace one step's state and stamp the run. Pure. */
export declare function settleStep(run: WorkflowRun, stepId: string, state: StepState, patch?: {
    readonly at?: number;
    readonly evidence?: RunEvidence;
    readonly reason?: string;
    readonly failureClass?: string;
}): WorkflowRun;
/** Move a run to a terminal or blocked status and stamp it. Pure. */
export declare function setRunStatus(run: WorkflowRun, status: RunStatus, now?: number, reason?: string): WorkflowRun;
/** Append a visible violation; a violation is never a pass. Pure. */
export declare function resetStepAttempts(run: WorkflowRun, stepId: string): WorkflowRun;
export declare function addViolation(run: WorkflowRun, detail: string, options?: {
    readonly kind?: string;
    readonly step?: string;
    readonly at?: number;
}): WorkflowRun;
/** Count one turn-close refusal on the run. Pure. */
export declare function incrementTurnBlocks(run: WorkflowRun, now?: number): WorkflowRun;
/** Reset the refusal count after the visible violation allows one close. Pure. */
export declare function resetTurnBlocks(run: WorkflowRun, now?: number): WorkflowRun;
/**
 * Terminally classify a run whose trigger later evaluates as not applicable.
 * The unexecuted required steps are released so retention can prune it; it is
 * never a pass.
 */
export declare function completeNotApplicable(run: WorkflowRun, now?: number): WorkflowRun;
/** Retention defaults: 30 days and 20 MB of run files. */
export declare const RUN_RETENTION_DAYS = 30;
export declare const RUN_RETENTION_BYTES: number;
export declare const DAY_MS: number;
export interface PruneOptions {
    readonly auth: HostAuth;
    readonly now?: number;
    readonly retentionMs?: number;
    readonly maxBytes?: number;
    /** Test seam: a deletion that throws never counts as removed. */
    readonly unlink?: (path: string) => Promise<void>;
}
export interface PruneResult {
    readonly removed: readonly string[];
    readonly retained: readonly string[];
}
/**
 * Prune terminal runs first: expired (30 days) then, while the workspace is over
 * its byte cap, the oldest terminal run. A running or blocked run is retained.
 * Receipts live outside this directory and are never touched.
 */
export declare function hasTamperedRuns(workspace: string, auth: HostAuth): Promise<boolean>;
export declare function pruneRuns(workspace: string, options: PruneOptions): Promise<PruneResult>;
/** A run id's content identity for diagnostics; never a secret. */
export declare function runDigest(run: WorkflowRun): string;
/** A bounded one-line failure reason for a run record. */
export declare function runFailure(error: unknown): string;
/** Run limits: concurrent open runs and the serialized context cap. */
export declare const DEFAULT_MAX_RUNS = 20;
export declare const MAX_CONTEXT_BYTES = 4096;
/** A run is open while it can still be resumed or steered. */
export declare function isOpenRun(run: WorkflowRun): boolean;
/** The number of open runs; terminal runs do not consume a slot. */
export declare function openRunCount(runs: readonly WorkflowRun[]): number;
/** Whether one more run would exceed the configured limit. */
export declare function runLimitExceeded(runs: readonly WorkflowRun[], maxRuns: number): boolean;
/** The open runs of one session; a different session cannot satisfy them. */
export declare function sessionRunsFor(runs: readonly WorkflowRun[], session: string): WorkflowRun[];
/**
 * A step belongs to the run's session. Another session may see the run in the
 * view but cannot satisfy its step.
 */
export declare function assertRunSession(run: WorkflowRun, session: string): void;
/** The step currently requested and still open, if any. */
export declare function activeStep(run: WorkflowRun): RunStep | undefined;
/**
 * Request one step. A run executes one main step at a time: requesting a second
 * step while another request is still open is refused. Re-requesting the same
 * step increments its bounded attempt count instead.
 */
export declare function requestStep(run: WorkflowRun, stepId: string, now?: number): WorkflowRun;
/** A bounded copy of a run context: an oversized value keeps its keys and a marker. */
export declare function boundContext(context: Readonly<Record<string, unknown>>, maxBytes?: number): Readonly<Record<string, unknown>>;
