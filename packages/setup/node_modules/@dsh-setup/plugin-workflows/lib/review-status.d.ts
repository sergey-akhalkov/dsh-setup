import type { Definition } from './definitions.js';
import type { WorkflowRun } from './runs.js';
import type { ReviewLiveness } from './tools.js';
/**
 * The review read model the change card and the session rows render: the static
 * whole-spec verdict at its digest with the portable task-review coverage the
 * archive gate counts, and the live projection of the reviews the scheduler is
 * running. One definition of "reviewed" — the gate's — so the card can never
 * disagree with an archive decision; liveness stays the executor's #7 rule and
 * is never re-derived here.
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
/** One live or waiting review the card and the session rows render. */
export interface ReviewLiveEntry {
    readonly session: string;
    readonly change: string;
    readonly definition: string;
    /** `spec` for a whole spec phase, `tasks` for task scope, `integration` for integration. */
    readonly unit: 'spec' | 'tasks' | 'integration';
    /** Bounded unit detail: a section title, a task number, or a phase. */
    readonly label?: string;
    readonly state: 'starting' | 'live' | 'waiting';
    readonly attempt: number;
    /** ISO timestamp of when the current attempt started (or began waiting). */
    readonly since: string;
}
/** One pending review the host's #7 liveness projection still reports. */
export interface ReviewLiveCandidate {
    readonly run: WorkflowRun;
    readonly liveness: ReviewLiveness;
    /** This advance's admission is in flight, before the scheduler holds it. */
    readonly starting: boolean;
}
/** The host-owned facts `live()` shapes; liveness itself is never re-derived here. */
export interface ReviewLiveSource {
    /** The pending review runs the host already tracks in memory. */
    candidatesFor(workspace: string): readonly ReviewLiveCandidate[];
    /** The installed definitions of one workspace, for the review step's scope. */
    definitionsFor(workspace: string): readonly Definition[];
}
/** The host service a feature plugin reads as `workflowsReviewStatus`. */
export interface WorkflowsReviewStatusService {
    summaries(workspace: string, changes: readonly string[]): Promise<Record<string, ChangeReviewSummary>>;
    /** Live entries for one workspace; an orphaned run is not returned. */
    live(workspace: string): Promise<ReviewLiveEntry[]>;
}
/** One change's static review state; an unknown or unreadable change is undefined. */
export declare function reviewSummary(workspace: string, change: string, 
/** Test seam for the artifact digest read; production uses `currentSpecDigest`. */
digestOf?: (workspace: string, change: string) => Promise<string | undefined>): Promise<ChangeReviewSummary | undefined>;
/** Per-change summaries; an unknown or unreadable row is omitted, never thrown. */
export declare function summaries(workspace: string, changes: readonly string[]): Promise<Record<string, ChangeReviewSummary>>;
/**
 * One entry per live or waiting review in the workspace. The #7 projection
 * decides the state and the host's admission set decides `starting`; an
 * orphaned run with no executor is never reported.
 */
export declare function live(workspace: string, source: ReviewLiveSource): ReviewLiveEntry[];
