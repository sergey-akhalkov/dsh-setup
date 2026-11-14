import { type ReviewRunInput } from './review.js';
import { type QueueLimits, type SettledRunState } from './review-queue.js';
import type { WorkflowRun } from './runs.js';
/**
 * The engine-side review scheduler: it admits one prepared review through the
 * bounded queue, runs the review executor in the background, persists the
 * settled workflow run, and releases the frozen snapshot. A review step stays
 * open while its run is admitted, so the turn-close gate still refuses a
 * PASS-dependent close until the record exists.
 */
export interface ScheduledReview {
    readonly workspace: string;
    readonly run: WorkflowRun;
    readonly request: ReviewRunInput;
    /** The dedupe facts: rule + change + task + digest + reviewer. */
    readonly rule: string;
    readonly change: string;
    readonly taskId?: string;
    readonly digest: string;
}
/** The host-owned operations the scheduler cannot perform alone. */
export interface ReviewSchedulerHost {
    persistRun: (workspace: string, run: WorkflowRun) => Promise<WorkflowRun>;
    discardSnapshot: (workspace: string, runId: string) => Promise<void>;
    onSettled?: (status: {
        readonly runId: string;
        readonly state: SettledRunState;
        readonly recordPath?: string;
        readonly verdict?: string;
    }) => void;
}
export type ReviewAdmission = {
    readonly kind: 'accepted';
    readonly phase: string;
} | {
    readonly kind: 'duplicate';
    readonly runId: string;
} | {
    readonly kind: 'full';
    readonly depth: number;
    readonly maxQueued: number;
};
export declare class ReviewScheduler {
    private readonly host;
    private readonly queue;
    /** The last settled result per run id, for a status read. */
    private readonly lastSettled;
    constructor(limits: QueueLimits, host: ReviewSchedulerHost);
    private launch;
    summary(): {
        enabled: boolean;
        concurrency: number;
        active: number;
        queued: number;
    };
    dispose(): void;
    enqueue(input: ScheduledReview): Promise<ReviewAdmission>;
}
