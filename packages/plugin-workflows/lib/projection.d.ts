/**
 * Read-only run projection over the process records the setup already writes:
 * work checkpoints, delegation runs, settled local review records, and portable
 * task approvals. No adapter writes, repairs, deletes, or re-runs a record.
 */
export type RunSource = 'checkpoint' | 'delegation' | 'review' | 'workflow';
export type RunAttribution = 'local' | 'portable' | 'unattributed';
export type RunStatus = 'running' | 'done' | 'failed' | 'unknown';
/** One step of a projected run; evidence is the file, call id, or target. */
export interface RunStep {
    readonly id: string;
    readonly title: string;
    readonly state: string;
    readonly at?: number;
    readonly evidence?: string;
}
/** The one shape every adapter returns. */
export interface RunView {
    readonly id: string;
    readonly source: RunSource;
    readonly session?: string;
    readonly attribution: RunAttribution;
    readonly title: string;
    readonly startedAt: number;
    readonly status: RunStatus;
    readonly steps: readonly RunStep[];
    readonly error?: string;
    /** The absolute or workspace-relative record path this view came from. */
    readonly record?: string;
}
export declare const WORK_CHECKPOINT_DIR: string;
export declare const DELEGATION_DIR: string;
export declare const WORKFLOW_EVENTS_DIR: string;
/** The producer's checkpoint directory name: sha256 of the session id, first 16 hex. */
export declare function hashSession(sessionId: string): string;
/**
 * Checkpoints for the requesting session only. The directory is the producer's
 * hash of the session id; the directory name and the redacted `session` field
 * are never read back as a session identity.
 */
export declare function checkpointRuns(workspace: string, sessionId: string): Promise<RunView[]>;
/** One settled local review record and the file it came from. */
export interface LocalReviewRecord {
    readonly file: string;
    readonly record: Record<string, unknown>;
}
/** Read every settled local review record; malformed files are not runs. */
export declare function readLocalReviewRecords(workspace: string): Promise<LocalReviewRecord[]>;
/**
 * Delegation runs. Session attribution comes from an observed starting/queuing
 * result or a settled record whose `runId` equals the run id; the run's record
 * path is a display hint only.
 */
export declare function delegationRuns(workspace: string, observedSessions: ReadonlyMap<string, string>, localRecords: readonly LocalReviewRecord[]): Promise<RunView[]>;
/** Portable task approvals under `openspec/changes/*\/reviews/*.json`. */
export declare function portableReviewRuns(workspace: string, localRecords: readonly LocalReviewRecord[]): Promise<RunView[]>;
/**
 * Observed delegation ownership from the journal: the earliest `delegate`
 * result that reported starting or queuing a run. An `already pending` result
 * names the run but must not establish or transfer ownership.
 */
export declare function delegationObservations(workspace: string): Promise<Map<string, string>>;
/** Every projected run in one workspace, unattributed runs included. */
export declare function workspaceRuns(workspace: string): Promise<RunView[]>;
/** The requesting session's timeline: only attributed runs, in time order. */
export declare function sessionRuns(workspace: string, sessionId: string): Promise<RunView[]>;
/** Whether a path is inside the workspace; adapters never read outside it. */
export declare function insideWorkspace(workspace: string, path: string): boolean;
/** A file's age, used only to display and order error rows. */
export declare function fileTime(file: string): Promise<number>;
