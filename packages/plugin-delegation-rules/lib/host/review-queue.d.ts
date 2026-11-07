import type { SettledRunState } from './index.js';
/**
 * Per-profile review admission queue: one bounded FIFO waiting list, a
 * concurrency ceiling, per-key serialization, identity dedupe, and the
 * retry/quarantine bookkeeping the start path needs. The engine owns records,
 * snapshots, and target starts; this module owns admission and settlement.
 */
/** How a failed review attempt is classified for retry purposes. */
export type FailureClass = 'child-limit' | 'provider-not-started' | 'timeout' | 'reviewed-inputs-changed' | 'invalid-output' | 'config' | 'permission' | 'unknown' | 'queue-full' | 'queue-timeout' | 'queue-internal-error';
/** One admission state; `settled` is reachable only through completion. */
export type QueuePhase = 'queued' | 'starting' | 'running' | 'retry-wait' | 'settled';
/** Bounded queue facts persisted on the durable run file. */
export interface QueueRunFile {
    id: string;
    key: string;
    identity: string;
    state: string;
    queuePosition?: number;
    queuedAt?: string;
    waitMs?: number;
    attempts?: number;
    failureClass?: FailureClass;
    lastRetryAt?: string;
    detail?: string;
}
/** The durable run shape this queue tracks; the engine's run embeds it. */
export interface QueueRun {
    file: QueueRunFile;
}
/** The queue limits, structurally equal to the validated `reviewQueue` block. */
export interface QueueLimits {
    enabled: boolean;
    concurrency: number;
    maxQueued: number;
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    waitTimeoutMs: number;
}
/** One classified failure, with a retry-after hint when the provider gave one. */
export interface ClassifiedFailure {
    failureClass: FailureClass;
    transient: boolean;
    retryAfterMs?: number;
}
/** Facts a wait-timeout settlement reports for the ERROR detail. */
export interface QueueTimeoutInfo {
    /** Waiting-list position; absent when the run timed out during retry backoff. */
    position?: number;
    waitMs: number;
}
/** Engine callbacks; every write of a record or run file stays in the engine. */
export interface ReviewQueueHooks<T extends QueueRun> {
    /** Start the prepared target; throws on a classified or unknown failure. */
    start(run: T): Promise<void>;
    /** Persist the run's queue facts (best effort). */
    persist(run: T): void | Promise<void>;
    /** Write the final `ERROR` record and mark the run failed. */
    fail(run: T, error: unknown, failureClass: FailureClass): Promise<void>;
    /** Write the terminal wait-timeout `ERROR` and mark the run failed. */
    timeout(run: T, info: QueueTimeoutInfo): Promise<void>;
    /** Fire the settlement observer exactly once. */
    settled(run: T, state: SettledRunState): void;
    now(): Date;
}
/** Outcome of admitting one prepared run. */
export type Admission<T extends QueueRun> = {
    kind: 'duplicate';
    run: T;
} | {
    kind: 'full';
    depth: number;
    maxQueued: number;
} | {
    kind: 'settled';
} | {
    kind: 'accepted';
    phase: 'queued' | 'running' | 'retry-wait';
};
/** Provider/result classification shared with the start path. */
export declare function classifyFailure(error: unknown, phase: 'start' | 'run'): ClassifiedFailure;
/**
 * Bounded exponential backoff with full jitter. A provider-supplied retry-after
 * wins when larger; everything is capped by `maxDelayMs`.
 */
export declare function retryDelayMs(attempt: number, limits: Pick<QueueLimits, 'baseDelayMs' | 'maxDelayMs'>, retryAfterMs?: number, random?: () => number): number;
/** One per-profile admission queue. */
export declare class ReviewQueue<T extends QueueRun> {
    private readonly limits;
    private readonly hooks;
    private readonly entries;
    private readonly identities;
    private readonly keys;
    private waiting;
    private readonly active;
    private readonly persistChains;
    private sequence;
    constructor(limits: QueueLimits, hooks: ReviewQueueHooks<T>);
    /** Stop every pending timer; the engine calls this when the plugin unloads. */
    dispose(): void;
    owns(runId: string): boolean;
    summary(): {
        enabled: boolean;
        concurrency: number;
        active: number;
        queued: number;
    };
    /** Admission for one already prepared run. */
    submit(run: T): Promise<Admission<T>>;
    /**
     * Replace a queued run's identity after a re-preparation. The old mapping is
     * removed and the new one inserted in one step; an occupied identity is
     * returned so the caller settles this run as the duplicate.
     */
    replaceIdentity(run: T, identity: string): {
        collision?: T;
    };
    /** Mark the run's terminal state, release its slot, and settle exactly once. */
    complete(run: T, state: SettledRunState): Promise<void>;
    /** A queued run cancelled before any target started settles discarded. */
    cancel(runId: string): Promise<boolean>;
    /**
     * Re-enter a transiently failed run after its backoff. The caller has already
     * persisted `retry-wait`; this releases the slot and arms the retry timer.
     */
    scheduleRetry(run: T, failure: ClassifiedFailure, error?: unknown): void;
    /** Re-enter the waiting list, or settle visibly when capacity or time is gone. */
    private retryDue;
    /** Attempts this run has already used, for the retry budget decision. */
    attemptsOf(runId: string): number;
    /** Promote the next follower of a key after its head settles. */
    private detachKey;
    private forgetIdentity;
    private armWaitTimer;
    private waitTimedOut;
    /** Settle an unadmitted run whose acceptance-based wait deadline expired. */
    private settleWaitTimeout;
    private positionOf;
    private removeWaiting;
    /** Apply every position before any persistence so a stale sweep cannot win. */
    private syncPositions;
    private persistEntry;
    private persistNow;
    /**
     * Serialize one run's writes so a terminal state can never be overwritten by
     * an earlier queued-state write that resolves late. Unrelated runs stay
     * independent.
     */
    private enqueuePersist;
    private startEligible;
    /**
     * Claim every available slot synchronously and launch each start on its own.
     * A slow target start must never delay an unrelated admission or handle.
     */
    private pump;
    private claim;
    private runStart;
    private failEntry;
    private finish;
}
