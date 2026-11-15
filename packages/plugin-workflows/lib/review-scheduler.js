import { beginReviewAttempt, publishReviewOutcome, recordReviewFailure, } from './review.js';
import { ReviewQueue, } from './review-queue.js';
import { settleStep } from './runs.js';
function liveIdentity(input) {
    return `${input.workspace}\u0000${input.rule}\u0000${input.change}\u0000${input.taskId ?? ''}\u0000${input.digest ?? ''}\u0000${input.reviewer ?? ''}`;
}
function queueIdentity(input) {
    const task = input.taskId ?? 'whole';
    return `${input.workspace}/${input.rule}/${input.change}/${task}/${input.digest}/${input.reviewer}`;
}
function queueFile(input) {
    return {
        id: `${input.workspace}:${input.run.id}:${input.rule}:${input.change}:${input.taskId ?? 'whole'}`,
        key: `${input.workspace}/${input.rule}/${input.change}/${input.taskId ?? 'whole'}`,
        identity: queueIdentity({
            workspace: input.workspace,
            rule: input.rule,
            change: input.change,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            digest: input.digest,
            reviewer: input.request.reviewer.id,
        }),
        state: 'queued',
    };
}
/** The bounded wait for a child teardown; an unresponsive dispose is unconfirmed. */
const MAX_TEARDOWN_WAIT_MS = 30_000;
/** Typed failures a start hook raises deliberately; the queue already settled. */
const START_FAILURE_NAMES = new Set([
    'ConfigError',
    'ProviderStartError',
    'PermissionError',
    'TimeoutError',
    'InvalidOutputError',
    'InputMutationError',
]);
/** Keep a failure's diagnostic and say the slot stays held until teardown. */
function withUnconfirmedTeardown(outcome) {
    const result = outcome.result;
    if (result.kind !== 'failure')
        return outcome;
    return {
        ...outcome,
        result: {
            ...result,
            error: `${result.error}; the reviewer could not be confirmed cancelled, so its review slot stays held until teardown completes — check the provider before starting a fresh review`,
        },
    };
}
export class ReviewScheduler {
    host;
    maxAttempts;
    queue;
    /** The last settled result per run id, for a status read. */
    lastSettled = new Map();
    /** Live reviews by complete identity, so the host admits before a snapshot. */
    liveRuns = new Map();
    liveKeys = new Map();
    liveByRun = new Map();
    /** The live review of this workflow run, regardless of current input changes. */
    liveRunById(runId) {
        return this.liveByRun.get(runId);
    }
    /** The run already covering this review, before any snapshot is prepared. */
    liveRun(input) {
        const exact = this.liveRuns.get(liveIdentity(input));
        if (exact !== undefined)
            return exact;
        // Only a precheck that supplied no digest/reviewer may match the task
        // prefix: an exact caller must bind the complete identity.
        if (input.digest !== undefined || input.reviewer !== undefined)
            return undefined;
        const prefix = `${input.workspace}\u0000${input.rule}\u0000${input.change}\u0000${input.taskId ?? ''}\u0000`;
        for (const [key, run] of this.liveRuns) {
            if (key.startsWith(prefix))
                return run;
        }
        return undefined;
    }
    constructor(limits, host) {
        this.host = host;
        this.maxAttempts = limits.maxAttempts;
        this.queue = new ReviewQueue(limits, {
            start: (entry) => this.start(entry),
            persist: () => undefined,
            fail: async (entry, error, failureClass) => {
                const failure = await recordReviewFailure({
                    ...entry.request,
                    error: error instanceof Error ? error.message : String(error),
                    failureClass,
                }).catch(() => undefined);
                if (failure === undefined)
                    return;
                await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined);
                this.lastSettled.set(entry.run.id, {
                    state: 'failed',
                    ...(failure.recordPath === undefined ? {} : { recordPath: failure.recordPath }),
                    ...(failure.record?.verdict === undefined ? {} : { verdict: failure.record.verdict }),
                });
            },
            timeout: async (entry, info) => {
                const position = info.position === undefined ? '' : ` at position ${String(info.position)}`;
                const failure = await recordReviewFailure({
                    ...entry.request,
                    error: `review queue wait timed out after ${String(info.waitMs)} ms${position}; no target started. Shorten the running reviews or start this review again after the queue drains`,
                    failureClass: 'queue-timeout',
                }).catch(() => undefined);
                if (failure === undefined)
                    return;
                await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined);
                this.lastSettled.set(entry.run.id, {
                    state: 'failed',
                    ...(failure.recordPath === undefined ? {} : { recordPath: failure.recordPath }),
                    ...(failure.record?.verdict === undefined ? {} : { verdict: failure.record.verdict }),
                });
            },
            settled: (entry, state, info) => {
                const settled = this.lastSettled.get(entry.run.id);
                // A quarantined run keeps its slot, key, live dedupe entry, and
                // snapshot until teardown confirms; the quarantine callback releases
                // them, then discards the snapshot.
                if (info?.quarantined !== true) {
                    this.forgetLive(entry.run.id);
                    void this.host.discardSnapshot(entry.workspace, entry.run.id).catch(() => undefined);
                }
                this.host.onSettled?.({
                    runId: entry.run.id,
                    state,
                    ...(settled?.recordPath === undefined ? {} : { recordPath: settled.recordPath }),
                    ...(settled?.verdict === undefined ? {} : { verdict: settled.verdict }),
                });
            },
            now: () => new Date(),
        });
    }
    /** The queue's start hook: start the target and report once it is live. */
    async start(entry) {
        await this.reprepareIfChanged(entry);
        if (!this.queue.owns(entry.file.id))
            return;
        const attempt = beginReviewAttempt(entry.request);
        let timer;
        try {
            // The acceptance deadline is cleared only by this success, after the
            // provider activation is published; a failed start reaches the queue's
            // classifier and keeps its deadline across the retry backoff. A hanging
            // activation must not outlive the timeout: publish and quarantine it.
            const started = await new Promise((resolve, reject) => {
                timer = setTimeout(() => resolve('timeout'), entry.request.timeoutMs);
                attempt.started.then(() => resolve('started'), (error) => reject(error));
            });
            if (started === 'timeout') {
                void attempt.result.catch(() => undefined);
                const failure = await recordReviewFailure({
                    ...entry.request,
                    error: 'provider activation timed out before the reviewer started; the reviewer could not be confirmed cancelled, so its review slot stays held until teardown completes',
                    failureClass: 'timeout',
                }).catch(() => undefined);
                if (failure !== undefined) {
                    await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined);
                }
                this.quarantine(entry, 'failed');
                return;
            }
        }
        catch (error) {
            // The queue classifies this start failure and decides retry or terminal
            // settlement; the background attempt publishes nothing.
            void attempt.result.catch(() => undefined);
            throw error;
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
        void this.finish(entry, attempt);
    }
    /** Re-check and re-prepare a queued entry's inputs exactly once. */
    async reprepareIfChanged(entry) {
        if (!entry.waited || entry.reprepare === undefined)
            return;
        const outcome = await entry.reprepare(entry.reprepared);
        if (outcome.kind === 'unchanged')
            return;
        const identity = queueIdentity({
            workspace: entry.workspace,
            rule: entry.rule,
            change: entry.change,
            ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
            digest: outcome.digest,
            reviewer: entry.request.reviewer.id,
        });
        const replaced = await this.queue.replaceIdentity(entry, identity);
        if (!replaced.replaced) {
            // A live successor already holds the new identity; the queue settled
            // this entry as its duplicate and its follower proceeds. Persist a
            // terminal durable state so the discarded run cannot be advanced again.
            const settled = settleStep(entry.request.run, entry.request.step.id, 'failed', {
                at: Date.now(),
                reason: 'a live successor already holds this review identity; this queued entry was discarded without replacing its record',
            });
            await this.host.persistRun(entry.workspace, settled).catch(() => undefined);
            return;
        }
        entry.reprepared = true;
        entry.request = {
            ...entry.request,
            prepared: outcome.prepared,
            ...(outcome.task === undefined ? {} : { task: outcome.task }),
        };
        this.rememberLive(entry, outcome.liveDigest);
    }
    /** Settle a finished attempt: retry (publishing nothing) or publish once. */
    async finish(entry, attempt) {
        const outcome = await attempt.result;
        // A start failure, cancellation, or re-preparation collision already
        // settled this entry; its attempt must not publish a second verdict.
        if (!this.queue.owns(entry.file.id))
            return;
        const result = outcome.result;
        if (result.kind === 'failure' &&
            result.transient &&
            this.queue.attemptsOf(entry.file.id) < this.maxAttempts) {
            if (!(await this.teardownConfirmed(entry))) {
                // A possibly-still-running child owns the slot, key, and snapshot.
                await this.publishAndQuarantine(entry, withUnconfirmedTeardown(outcome), attempt.now);
                return;
            }
            const failure = {
                failureClass: result.failureClass,
                transient: true,
                ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
            };
            entry.waited = true;
            await this.queue.scheduleRetry(entry, failure, new Error(result.error));
            return;
        }
        await this.publishAndSettle(entry, outcome, attempt.now);
    }
    /** Publish the settled attempt, then release or quarantine the slot. */
    async publishAndSettle(entry, outcome, now) {
        const teardownConfirmed = await this.teardownConfirmed(entry);
        // Teardown can take up to 30 seconds; recheck the reviewed inputs after it
        // and immediately before publishing a verdict, failing closed on change.
        // A verdict from a reviewer that may still be alive is never published.
        if (outcome.result.kind === 'verdict') {
            if (!teardownConfirmed) {
                const failure = await recordReviewFailure({
                    ...entry.request,
                    error: 'the reviewer teardown could not be confirmed, so its verdict is not published; the review slot stays held until teardown completes',
                    failureClass: 'timeout',
                }).catch(() => undefined);
                if (failure !== undefined) {
                    await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined);
                }
                this.quarantine(entry, 'failed');
                return;
            }
            const reason = await this.recheckGuard(entry);
            if (reason !== undefined) {
                const failure = await recordReviewFailure({
                    ...entry.request,
                    error: `reviewed inputs changed after the reviewer finished: ${reason}`,
                    failureClass: 'reviewed-inputs-changed',
                }).catch(() => undefined);
                if (failure !== undefined) {
                    await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined);
                }
                await this.queue.complete(entry, 'failed');
                return;
            }
        }
        const finalOutcome = teardownConfirmed ? outcome : withUnconfirmedTeardown(outcome);
        const result = await this.publish(entry, finalOutcome, now);
        const state = result.record?.verdict === 'PASS' ? 'completed' : 'failed';
        if (!teardownConfirmed) {
            this.quarantine(entry, state);
            return;
        }
        await this.queue.complete(entry, state);
    }
    /** The request's live-input guard, treated as a failure when it throws. */
    async recheckGuard(entry) {
        const guard = entry.request.prepared.liveGuard;
        if (guard === undefined)
            return undefined;
        try {
            return await guard();
        }
        catch (error) {
            return `the live-input recheck failed (${error instanceof Error ? error.message : String(error)})`;
        }
    }
    /** Publish a terminal attempt whose child teardown is not yet confirmed. */
    async publishAndQuarantine(entry, outcome, now) {
        const result = await this.publish(entry, outcome, now);
        this.quarantine(entry, result.record?.verdict === 'PASS' ? 'completed' : 'failed');
    }
    async publish(entry, outcome, now) {
        const result = await publishReviewOutcome(entry.request, outcome, now).catch(async (error) => {
            // A publication fault must still settle visibly; the queue then releases
            // or quarantines by the actual teardown state.
            return await recordReviewFailure({
                ...entry.request,
                error: error instanceof Error ? error.message : String(error),
                failureClass: 'unknown',
            }).catch(() => ({ run: entry.run }));
        });
        await this.host.persistRun(entry.workspace, result.run).catch(() => undefined);
        this.lastSettled.set(entry.run.id, {
            state: result.record?.verdict === 'PASS' ? 'completed' : 'failed',
            ...(result.recordPath === undefined ? {} : { recordPath: result.recordPath }),
            ...(result.record?.verdict === undefined ? {} : { verdict: result.record.verdict }),
        });
        return result;
    }
    /**
     * Hold the run's slot, key, live dedupe entry, and snapshot until the child
     * teardown succeeds; the queue retries the callback with backoff.
     */
    quarantine(entry, outcome) {
        // A quarantined run still owns its admission: an identical request must
        // join it until teardown confirms and releases the slot.
        if (entry.liveKey !== undefined) {
            this.liveRuns.set(entry.liveKey, entry.run);
            this.liveKeys.set(entry.run.id, entry.liveKey);
            this.liveByRun.set(entry.run.id, entry.run);
        }
        this.queue.quarantine(entry, async () => {
            await this.waitForTeardown(entry);
            this.forgetLive(entry.run.id);
            await this.host.discardSnapshot(entry.workspace, entry.run.id);
        }, outcome);
    }
    /** Whether the reviewer child is confirmed gone; false on failure or timeout. */
    async teardownConfirmed(entry) {
        const wait = entry.request.runner.waitForTeardown;
        if (wait === undefined)
            return true;
        let timer;
        const bound = new Promise((resolve) => {
            timer = setTimeout(() => resolve(false), Math.min(MAX_TEARDOWN_WAIT_MS, entry.request.timeoutMs));
            timer.unref?.();
        });
        try {
            return await Promise.race([
                wait.call(entry.request.runner).then(() => true, () => false),
                bound,
            ]);
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
        }
    }
    /** Await teardown, letting a rejection reach the queue's quarantine retry. */
    async waitForTeardown(entry) {
        await entry.request.runner.waitForTeardown?.();
    }
    rememberLive(entry, liveDigest) {
        this.forgetLive(entry.run.id);
        const key = liveIdentity({
            workspace: entry.workspace,
            rule: entry.rule,
            change: entry.change,
            ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
            digest: liveDigest,
            reviewer: entry.request.reviewer.id,
        });
        this.liveRuns.set(key, entry.run);
        this.liveKeys.set(entry.run.id, key);
        this.liveByRun.set(entry.run.id, entry.run);
        entry.liveKey = key;
    }
    forgetLive(runId) {
        this.liveByRun.delete(runId);
        const key = this.liveKeys.get(runId);
        if (key === undefined)
            return;
        if (this.liveRuns.get(key)?.id === runId)
            this.liveRuns.delete(key);
        this.liveKeys.delete(runId);
    }
    summary() {
        return this.queue.summary();
    }
    dispose() {
        this.queue.dispose();
    }
    async enqueue(input) {
        const reviewer = input.request.reviewer.id;
        const key = liveIdentity({
            workspace: input.workspace,
            rule: input.rule,
            change: input.change,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            digest: input.liveDigest ?? input.digest,
            reviewer,
        });
        const existing = this.liveRuns.get(key);
        if (existing !== undefined) {
            if (existing.id !== input.run.id) {
                void this.host.discardSnapshot(input.workspace, input.run.id).catch(() => undefined);
            }
            return { kind: 'duplicate', runId: existing.id };
        }
        const entry = {
            file: queueFile(input),
            workspace: input.workspace,
            run: input.run,
            rule: input.rule,
            change: input.change,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            request: input.request,
            liveKey: key,
            waited: false,
            reprepared: false,
            ...(input.reprepare === undefined ? {} : { reprepare: input.reprepare }),
        };
        let admission;
        try {
            admission = await this.queue.submit(entry);
        }
        catch (error) {
            // A terminal start failure publishes its ERROR through the fail hook; the
            // caller sees a settled admission, never an uncaught start error.
            if (error instanceof Error &&
                START_FAILURE_NAMES.has(error.name) &&
                !this.queue.owns(entry.file.id)) {
                return { kind: 'accepted', phase: 'settled' };
            }
            throw error;
        }
        switch (admission.kind) {
            case 'duplicate':
                if (admission.run.run.id !== input.run.id) {
                    void this.host.discardSnapshot(input.workspace, input.run.id).catch(() => undefined);
                }
                return { kind: 'duplicate', runId: admission.run.run.id };
            case 'full':
                return { kind: 'full', depth: admission.depth, maxQueued: admission.maxQueued };
            case 'settled':
                return { kind: 'accepted', phase: 'settled' };
            case 'accepted':
                if (admission.phase !== 'running')
                    entry.waited = true;
                if (this.queue.owns(entry.file.id)) {
                    this.rememberLive(entry, input.liveDigest ?? input.digest);
                }
                return { kind: 'accepted', phase: admission.phase };
        }
    }
}
