import type { HostAuth } from './host-auth.js';
import { type WorkflowRun } from './runs.js';
/**
 * Startup recovery and resume-by-run-id. An unfinished run from a previous
 * process is interrupted, never auto-completed; resume re-evaluates only its
 * pending step from authenticated durable state and never starts a second run
 * or recreates a change directory.
 */
export declare const INTERRUPTED_REASON = "the host process ended while this run was unfinished";
export interface RecoverResult {
    readonly recovered: readonly string[];
    /** Runs settled from their authoritative record instead of interrupted. */
    readonly reconciled: readonly string[];
    /** Runs that were unsigned or already terminal; left untouched. */
    readonly skipped: readonly string[];
}
/**
 * The recovery read of one unfinished run: the run settled from its
 * authoritative record, or undefined when it must be interrupted.
 */
export type RecoverReconcile = (run: WorkflowRun) => Promise<WorkflowRun | undefined>;
/**
 * Mark every authenticated running or blocked run as interrupted, unless a
 * reconciliation proves its authoritative record already settled it.
 */
export declare function recoverRuns(workspace: string, auth: HostAuth, now?: number, reconcile?: RecoverReconcile): Promise<RecoverResult>;
/** The first step still open or blocked; the step resume re-evaluates. */
export declare function pendingStep(run: WorkflowRun): string | undefined;
export interface ResumeResult {
    readonly run: WorkflowRun;
    readonly stepId: string;
}
/**
 * Resume one interrupted, blocked, or failed run at its pending step. A
 * completed, cancelled, or running run is refused.
 */
export declare function resumeRun(workspace: string, runId: string, auth: HostAuth, now?: number, session?: string, persist?: boolean): Promise<ResumeResult>;
/** Cancel one open run; an open or blocked step is recorded as cancelled. */
export declare function cancelRun(workspace: string, runId: string, auth: HostAuth, now?: number, session?: string, persist?: boolean): Promise<WorkflowRun>;
