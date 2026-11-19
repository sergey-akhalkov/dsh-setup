/**
 * The static review read model the change card renders: the local whole-spec
 * verdict at its digest, and the portable task-review coverage the archive gate
 * counts. One definition of "reviewed" — the gate's — so the card can never
 * disagree with an archive decision. Nothing here reads the review executor.
 */
export interface ChangeReviewSummary {
    /** The last local whole-spec record, or null when no local record exists. */
    readonly spec: {
        readonly verdict: 'PASS' | 'FINDINGS' | 'ERROR';
        /** The record digest equals the current change-artifact digest. */
        readonly current: boolean;
        /** ISO timestamp of the record. */
        readonly at: string;
        readonly findings: number;
        readonly reviewer: string;
        readonly model?: string;
    } | null;
    /** Checked-task coverage, or null when tasks.md is missing/unreadable. */
    readonly tasks: {
        readonly checked: number;
        readonly passed: number;
        /** The missing checked tasks' numbers, bounded to 20 entries. */
        readonly missing: readonly string[];
        /** Newest matching approval time, when there is at least one. */
        readonly at?: string;
    } | null;
}
/** The host service a feature plugin reads as `workflowsReviewStatus`. */
export interface WorkflowsReviewStatusService {
    summaries(workspace: string, changes: readonly string[]): Promise<Record<string, ChangeReviewSummary>>;
}
/** One change's static review state; an unknown or unreadable change is undefined. */
export declare function reviewSummary(workspace: string, change: string, 
/** Test seam for the artifact digest read; production uses `currentSpecDigest`. */
digestOf?: (workspace: string, change: string) => Promise<string | undefined>): Promise<ChangeReviewSummary | undefined>;
/** Per-change summaries; an unknown or unreadable row is omitted, never thrown. */
export declare function summaries(workspace: string, changes: readonly string[]): Promise<Record<string, ChangeReviewSummary>>;
