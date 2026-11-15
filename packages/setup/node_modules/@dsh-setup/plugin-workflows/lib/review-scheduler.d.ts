import { type ReviewRunInput } from './review.js';
import { type QueueLimits, type SettledRunState } from './review-queue.js';
import { type WorkflowRun } from './runs.js';
/**
 * The engine-side review scheduler: it admits one prepared review through the
 * bounded queue, runs the review executor in the background, persists the
 * settled workflow run, and releases the frozen snapshot. A review step stays
 * open while its run is admitted, so the turn-close gate still refuses a
 * PASS-dependent close until the record exists.
 */
/** The re-prepared inputs of a queued review whose source set moved. */
export interface RepreparedReview {
    readonly kind: 'replaced';
    readonly prepared: ReviewRunInput['prepared'];
    readonly digest: string;
    readonly liveDigest: string;
    readonly task?: NonNullable<ReviewRunInput['task']>;
}
export type ReviewReprepareOutcome = {
    readonly kind: 'unchanged';
} | RepreparedReview;
export interface ScheduledReview {
    readonly workspace: string;
    readonly run: WorkflowRun;
    readonly request: ReviewRunInput;
    /** The dedupe facts: rule + change + task + digest + reviewer. */
    readonly rule: string;
    readonly change: string;
    readonly taskId?: string;
    /** The whole-scope record phase (`spec`, `integration`, ...). */
    readonly phase?: string;
    readonly digest: string;
    /** The digest known before the snapshot exists, for the live-admission key. */
    readonly liveDigest?: string;
    /**
     * Re-check the live source inputs when the entry becomes start-eligible. The
     * callback reports `unchanged`, or rebuilds once and returns the replacement;
     * it throws a classified failure when the inputs moved a second time.
     */
    readonly reprepare?: (reprepared: boolean) => Promise<ReviewReprepareOutcome>;
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
    private readonly limits;
    private readonly maxAttempts;
    private readonly queue;
    /** Every admitted entry by run id, so disposal can clean its snapshot up. */
    private readonly admitted;
    private disposed;
    /** The last settled result per run id, for a status read. */
    private readonly lastSettled;
    /** Live reviews by complete identity, so the host admits before a snapshot. */
    private readonly liveRuns;
    private readonly liveKeys;
    private readonly liveByRun;
    /** Runs fenced by a completed-soft settlement; their late verdict is discarded. */
    private readonly fenced;
    private readonly recordLocks;
    /**
     * Fence a run that settled without its review (completed-soft): a queued
     * attempt is cancelled before it starts, and a late verdict is discarded
     * instead of publishing over the terminal run.
     */
    fence(runId: string): void;
    private recordKey;
    private withRecordLock;
    /** Remove a PASS record/approval a fenced settlement must not leave behind. */
    private discardFencedRecord;
    private discardFencedRecordUnlocked;
    /** The live review of this workflow run, regardless of current input changes. */
    liveRunById(runId: string): WorkflowRun | undefined;
    /** The run already covering this review, before any snapshot is prepared. */
    liveRun(input: {
        workspace: string;
        rule: string;
        change: string;
        taskId?: string;
        phase?: string;
        digest?: string;
        reviewer?: string;
    }): WorkflowRun | undefined;
    constructor(limits: QueueLimits, host: ReviewSchedulerHost);
    /** The queue's start hook: start the target and report once it is live. */
    private start;
    /** Re-check and re-prepare a queued entry's inputs exactly once. */
    private reprepareIfChanged;
    /** Settle a finished attempt: retry (publishing nothing) or publish once. */
    private finish;
    /** Publish the settled attempt, then release or quarantine the slot. */
    private publishAndSettle;
    /** The request's live-input guard, treated as a failure when it throws. */
    private recheckGuard;
    /** Publish a terminal attempt whose child teardown is not yet confirmed. */
    private publishAndQuarantine;
    private publish;
    private publishUnlocked;
    /**
     * Hold the run's slot, key, live dedupe entry, and snapshot until the child
     * teardown succeeds; the queue retries the callback with backoff.
     */
    private quarantine;
    /** Whether the reviewer child is confirmed gone; false on failure or timeout. */
    private teardownConfirmed;
    /** Await teardown, letting a rejection reach the queue's quarantine retry. */
    private waitForTeardown;
    private rememberLive;
    private forgetLive;
    summary(): {
        enabled: boolean;
        concurrency: number;
        active: number;
        queued: number;
    };
    dispose(): void;
    /** Wait out a disposed reviewer child, then release its snapshot and lease. */
    private discardAfterTeardown;
    enqueue(input: ScheduledReview): Promise<ReviewAdmission>;
}
