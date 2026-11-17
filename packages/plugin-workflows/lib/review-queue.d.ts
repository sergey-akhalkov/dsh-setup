export type SettledRunState = 'completed' | 'failed' | 'discarded';
/**
 * Per-profile review admission: every distinct identity starts immediately,
 * dedupe and per-key serialization (one provider thread), retry/backoff, and
 * the quarantine bookkeeping the start path needs. There is no concurrency
 * limit, waiting list, or admission timeout. The engine owns records,
 * snapshots, and target starts; this module owns admission and settlement.
 */
/** How a failed review attempt is classified for retry purposes. */
export type FailureClass = 'child-limit' | 'provider-not-started' | 'timeout' | 'reviewed-inputs-changed' | 'invalid-output' | 'config' | 'permission' | 'unknown' | 'queue-full' | 'queue-timeout' | 'queue-internal-error';
/** One admission state; `settled` is reachable only through completion. */
export type QueuePhase = 'queued' | 'starting' | 'running' | 'retry-wait' | 'settled';
/** An unexpected queue failure the engine may recover from by a direct start. */
export declare class QueueInternalError extends Error {
    readonly causeError?: unknown | undefined;
    constructor(message: string, causeError?: unknown | undefined);
}
/** Bounded queue facts persisted on the durable run file. */
export interface QueueRunFile {
    id: string;
    key: string;
    identity: string;
    state: string;
    attempts?: number;
    failureClass?: FailureClass;
    detail?: string;
}
/** The durable run shape this queue tracks; the engine's run embeds it. */
export interface QueueRun {
    file: QueueRunFile;
}
/**
 * The queue settings: the off switch and the retry budget. The retired
 * `concurrency`, `maxQueued`, and `waitTimeoutMs` fields are accepted for
 * profile compatibility and never read.
 */
export interface QueueLimits {
    enabled: boolean;
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    /** Retired: accepted and ignored, kept so an existing profile still loads. */
    concurrency?: number;
    /** Retired: accepted and ignored, kept so an existing profile still loads. */
    maxQueued?: number;
    /** Retired: accepted and ignored, kept so an existing profile still loads. */
    waitTimeoutMs?: number;
}
/** One classified failure, with a retry-after hint when the provider gave one. */
export interface ClassifiedFailure {
    failureClass: FailureClass;
    transient: boolean;
    retryAfterMs?: number;
}
/** Facts a settlement observer needs to tell a release from a quarantine. */
export interface SettlementInfo {
    /** The run settled visibly but its child is not yet confirmed torn down. */
    readonly quarantined?: boolean;
}
/** Engine callbacks; every write of a record or run file stays in the engine. */
export interface ReviewQueueHooks<T extends QueueRun> {
    /** Start the prepared target; throws on a classified or unknown failure. */
    start(run: T): Promise<void>;
    /** Persist the run's queue facts (best effort). */
    persist(run: T): void | Promise<void>;
    /** Write the final `ERROR` record and mark the run failed. */
    fail(run: T, error: unknown, failureClass: FailureClass): Promise<void>;
    /** Fire the settlement observer exactly once; a quarantine retains its key. */
    settled(run: T, state: SettledRunState, info?: SettlementInfo): void;
    /** Record bounded evidence when an unexpected fault is survived. */
    internalFault?(run: T, message: string): void | Promise<void>;
    now(): Date;
}
/** Outcome of admitting one prepared run. */
export type Admission<T extends QueueRun> = {
    kind: 'duplicate';
    run: T;
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
    private disposed;
    constructor(limits: QueueLimits, hooks: ReviewQueueHooks<T>);
    /** Stop every pending retry timer; the engine calls this when the plugin unloads. */
    dispose(): void;
    owns(runId: string): boolean;
    /** Whether this queued run still holds the current identity mapping. */
    ownsIdentity(runId: string, identity: string): boolean;
    /** The active review runs and the attempts they have used; no queue position. */
    summary(): {
        enabled: boolean;
        active: number;
        attempts: number;
    };
    /** Admission for one already prepared run; unexpected faults become internal. */
    submit(run: T): Promise<Admission<T>>;
    /** Remove an admission that failed before it could settle; never observe it. */
    private rollback;
    /**
     * Reserve a direct-start fallback's identity and conversation key. The run
     * keeps dedupe/key ordering until it settles.
     */
    reserve(run: T): Promise<{
        kind: 'duplicate';
        run: T;
    } | {
        kind: 'conflict';
        run: T;
    } | {
        kind: 'reserved';
    }>;
    private submitInner;
    /**
     * Replace a queued run's identity after a re-preparation. The old mapping is
     * removed and the new one inserted in one step. When the new identity is
     * already admitted, this run is the duplicate: it settles `discarded` naming
     * the incumbent, promotes its follower, and fires its observer exactly once.
     */
    replaceIdentity(run: T, identity: string): Promise<{
        collision?: T;
        replaced: boolean;
    }>;
    /** Wait out an incumbent's in-flight start so a duplicate handle is settled. */
    whenAdmitted(runId: string): Promise<void>;
    /** Mark the run's terminal state, release its slot, and settle exactly once. */
    complete(run: T, state: SettledRunState): Promise<void>;
    /** A queued run cancelled before any target started settles discarded. */
    cancel(runId: string): Promise<boolean>;
    /**
     * Hold a timed-out run's conversation key, capacity slot, and snapshot until
     * its child teardown is confirmed. The settlement observer fires once here;
     * `teardown` is retried with backoff and releases the slot on success.
     */
    /**
     * Hold a timed-out run's conversation key and snapshot until its child
     * teardown is confirmed. The settlement observer fires once here;
     * `teardown` is retried with backoff and releases the key on success.
     */
    quarantine(run: T, teardown: () => Promise<void>, outcome?: SettledRunState): void;
    private confirmTeardown;
    /**
     * Re-enter a transiently failed run after its backoff. The caller has already
     * persisted `retry-wait`; this releases its admission and arms the retry timer.
     */
    scheduleRetry(run: T, failure: ClassifiedFailure): Promise<void>;
    /** Re-enter the waiting order after backoff; the head of a key starts. */
    private retryDue;
    /** Attempts this run has already used, for the retry budget decision. */
    attemptsOf(runId: string): number;
    /** Promote the next follower of a key after its head settles. */
    private detachKey;
    private forgetIdentity;
    private removeWaiting;
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
     * Claim every start-eligible run synchronously and launch each start on its
     * own. There is no capacity limit: only a key's followers wait.
     */
    private pump;
    private claim;
    private runStart;
    private runStartInner;
    private failEntry;
    private finish;
    /** Pump from a background context; a fault settles the next waiter visibly. */
    private safePump;
}
