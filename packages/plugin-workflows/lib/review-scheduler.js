import { readFile, unlink } from 'node:fs/promises';
import { reviewDigest } from './evidence.js';
import { beginReviewAttempt, containedRecordTarget, publishReviewOutcome, readReviewRecordFingerprint, recordReviewFailure, sectionReviewDigest, } from './review.js';
import { ReviewQueue, retryDelayMs, } from './review-queue.js';
import { settleStep } from './runs.js';
function liveIdentity(input) {
    return `${input.workspace}\u0000${input.rule}\u0000${input.change}\u0000${input.taskId ?? ''}\u0000${input.phase ?? ''}\u0000${input.digest ?? ''}\u0000${input.reviewer ?? ''}`;
}
function queueIdentity(input) {
    const scope = input.taskId ?? input.phase ?? 'whole';
    return `${input.workspace}/${input.rule}/${input.change}/${scope}/${input.digest}/${input.reviewer}`;
}
function queueFile(input) {
    const scope = input.taskId ?? input.phase ?? 'whole';
    return {
        id: `${input.workspace}:${input.run.id}:${input.rule}:${input.change}:${scope}`,
        // The rule stays in the identity, not the serialization key: different
        // rules on the same task share one conversation and must run serially.
        key: `${input.workspace}/${input.change}/${scope}`,
        identity: queueIdentity({
            workspace: input.workspace,
            rule: input.rule,
            change: input.change,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            ...(input.phase === undefined ? {} : { phase: input.phase }),
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
    limits;
    maxAttempts;
    queue;
    /** Every admitted entry by run id, so disposal can clean its snapshot up. */
    admitted = new Map();
    disposed = false;
    /** The last settled result per run id, for a status read. */
    lastSettled = new Map();
    /** Live reviews by complete identity, so the host admits before a snapshot. */
    liveRuns = new Map();
    liveKeys = new Map();
    liveByRun = new Map();
    /** Runs fenced by a completed-soft settlement; their late verdict is discarded. */
    fenced = new Set();
    recordLocks = new Map();
    /**
     * Fence a run that settled without its review (completed-soft): a queued
     * attempt is cancelled before it starts, and a late verdict is discarded
     * instead of publishing over the terminal run.
     */
    fence(runId) {
        if (this.disposed)
            return;
        this.fenced.add(runId);
        const entry = this.admitted.get(runId);
        if (entry === undefined)
            return;
        void this.discardFencedRecord(entry);
        if (entry.started)
            return;
        void this.queue.cancel(entry.file.id).catch(() => undefined);
    }
    recordKey(entry) {
        const definition = entry.request.definition.id;
        const scope = entry.request.step.review?.scope ?? 'whole';
        const phase = entry.request.step.review?.phase ?? 'spec';
        const recordId = entry.request.prepared.section?.recordId ?? entry.request.task?.id;
        return scope === 'task'
            ? `${entry.workspace}\u0000${definition}\u0000${entry.change}\u0000task\u0000${recordId ?? ''}`
            : `${entry.workspace}\u0000${definition}\u0000${entry.change}\u0000whole\u0000${phase}`;
    }
    async withRecordLock(key, action) {
        const previous = this.recordLocks.get(key) ?? Promise.resolve();
        const next = previous.then(action, action).finally(() => {
            if (this.recordLocks.get(key) === next)
                this.recordLocks.delete(key);
        });
        this.recordLocks.set(key, next);
        return next;
    }
    /** Remove a PASS record/approval a fenced settlement must not leave behind. */
    async discardFencedRecord(entry) {
        await this.withRecordLock(this.recordKey(entry), async () => {
            await this.discardFencedRecordUnlocked(entry);
        });
    }
    async discardFencedRecordUnlocked(entry) {
        const definition = entry.request.definition.id;
        const scope = entry.request.step.review?.scope ?? 'whole';
        const phase = entry.request.step.review?.phase;
        const section = entry.request.prepared.section;
        const taskId = section?.recordId ?? entry.request.task?.id;
        const suffix = scope === 'task' ? `tasks/${taskId ?? ''}.json` : `${phase ?? 'spec'}.json`;
        const expectedDigest = section === undefined
            ? reviewDigest({
                scope,
                specDigest: entry.request.prepared.specDigest,
                ...(entry.request.prepared.tree === undefined
                    ? {}
                    : { tree: entry.request.prepared.tree }),
                ...(entry.request.prepared.artifactDigest === undefined
                    ? {}
                    : { artifactDigest: entry.request.prepared.artifactDigest }),
            })
            : sectionReviewDigest(section, entry.request.prepared.artifactDigest ?? entry.request.prepared.specDigest, entry.request.prepared.tree);
        const removeIfOwned = async (relative) => {
            // Never follow a linked ancestor outside the workspace, and never remove
            // a record published by another digest.
            const target = await containedRecordTarget(entry.workspace, relative).catch(() => undefined);
            if (target === undefined)
                return;
            const raw = await readFile(target, 'utf8').catch(() => undefined);
            if (raw === undefined)
                return;
            let digest;
            try {
                digest = JSON.parse(raw).digest;
            }
            catch {
                return;
            }
            if (digest === expectedDigest)
                await unlink(target).catch(() => undefined);
        };
        await removeIfOwned(`.dsh/workflows/records/${definition}/${entry.change}/${suffix}`);
        if (section !== undefined) {
            // A section PASS published one approval per covered checked task.
            for (const task of section.covered) {
                await removeIfOwned(`openspec/changes/${entry.change}/reviews/${task.id}.json`);
            }
        }
        else if (taskId !== undefined) {
            await removeIfOwned(`openspec/changes/${entry.change}/reviews/${taskId}.json`);
        }
    }
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
        this.limits = limits;
        this.maxAttempts = limits.maxAttempts;
        this.queue = new ReviewQueue(limits, {
            start: (entry) => this.start(entry),
            persist: () => undefined,
            fail: async (entry, error, failureClass) => {
                if (this.disposed)
                    return;
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
                if (this.disposed)
                    return;
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
                this.fenced.delete(entry.run.id);
                const settled = this.lastSettled.get(entry.run.id);
                // A quarantined run keeps its slot, key, live dedupe entry, and
                // snapshot until teardown confirms; the quarantine callback releases
                // them, then discards the snapshot.
                if (info?.quarantined !== true) {
                    this.forgetLive(entry.run.id);
                    this.admitted.delete(entry.run.id);
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
        if (!entry.baselineCaptured) {
            // Start-eligible means the predecessor has settled: this record is the
            // publication baseline, and a retry keeps it rather than re-reading it.
            entry.baselineCaptured = true;
            entry.baseline = {
                fingerprint: await readReviewRecordFingerprint(entry.workspace, entry.request),
            };
            entry.request = { ...entry.request, baseline: entry.baseline };
        }
        // The baseline read may have awaited; disposal or a successor can land
        // while it is pending, so ownership is checked again before start.
        if (this.disposed || !this.queue.owns(entry.file.id))
            return;
        entry.started = true;
        const attempt = await beginReviewAttempt(entry.request);
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
                if (this.disposed || !this.queue.owns(entry.file.id))
                    return;
                void attempt.result.catch(() => undefined);
                const failure = await recordReviewFailure({
                    ...entry.request,
                    error: 'provider activation timed out before the reviewer started; the reviewer could not be confirmed cancelled, so its review slot stays held until teardown completes',
                    failureClass: 'timeout',
                }).catch(() => undefined);
                if (failure !== undefined) {
                    await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined);
                }
                this.quarantine(entry, failure?.discarded === true ? 'discarded' : 'failed');
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
        if (this.disposed || !this.queue.owns(entry.file.id)) {
            // A replacement snapshot may have been built after disposal; release it.
            await this.host.discardSnapshot(entry.workspace, entry.run.id).catch(() => undefined);
            return;
        }
        if (outcome.kind === 'unchanged')
            return;
        const identity = queueIdentity({
            workspace: entry.workspace,
            rule: entry.rule,
            change: entry.change,
            ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
            ...(entry.phase === undefined ? {} : { phase: entry.phase }),
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
        if (this.fenced.has(entry.run.id)) {
            // The run settled completed-soft without its review: the late verdict is
            // discarded, never published over the terminal state or retried.
            if (await this.teardownConfirmed(entry))
                await this.queue.complete(entry, 'discarded');
            else
                this.quarantine(entry, 'discarded');
            return;
        }
        const result = outcome.result;
        if (result.kind === 'failure' &&
            result.transient &&
            this.queue.attemptsOf(entry.file.id) < this.maxAttempts) {
            if (!(await this.teardownConfirmed(entry))) {
                // A possibly-still-running child owns the slot, key, and snapshot.
                // Disposal during that await must not publish or restore the live key.
                if (this.disposed || !this.queue.owns(entry.file.id))
                    return;
                await this.publishAndQuarantine(entry, withUnconfirmedTeardown(outcome), attempt.now);
                return;
            }
            if (this.disposed || !this.queue.owns(entry.file.id))
                return;
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
        // Disposal or a superseded admission during the awaited teardown must not
        // publish; ownership is rechecked immediately before any record write.
        if (this.disposed || !this.queue.owns(entry.file.id))
            return;
        // A completed-soft settlement may land during the teardown await; the
        // late verdict is discarded, never published over the terminal run.
        if (this.fenced.has(entry.run.id)) {
            if (teardownConfirmed)
                await this.queue.complete(entry, 'discarded');
            else
                this.quarantine(entry, 'discarded');
            return;
        }
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
                this.quarantine(entry, failure?.discarded === true ? 'discarded' : 'failed');
                return;
            }
            const reason = await this.recheckGuard(entry);
            // The guard may await a filesystem or lock check; disposal or a successor
            // can land in that window, so ownership is checked again before writing.
            if (this.disposed || !this.queue.owns(entry.file.id))
                return;
            // The fence can land while the guard awaits; check it again before
            // either publication branch.
            if (this.fenced.has(entry.run.id)) {
                await this.queue.complete(entry, 'discarded');
                return;
            }
            if (reason !== undefined) {
                const failure = await recordReviewFailure({
                    ...entry.request,
                    error: `reviewed inputs changed after the reviewer finished: ${reason}`,
                    failureClass: 'reviewed-inputs-changed',
                }).catch(() => undefined);
                if (failure !== undefined) {
                    await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined);
                }
                await this.queue.complete(entry, failure?.discarded === true ? 'discarded' : 'failed');
                return;
            }
        }
        const finalOutcome = teardownConfirmed ? outcome : withUnconfirmedTeardown(outcome);
        const result = await this.publish(entry, finalOutcome, now);
        // The fence can land while the record is being verified/written; remove
        // any surviving PASS for the settled run before reporting completion.
        if (this.fenced.has(entry.run.id)) {
            await this.discardFencedRecord(entry);
            await this.queue.complete(entry, 'discarded');
            return;
        }
        const state = result.discarded === true
            ? 'discarded'
            : result.record?.verdict === 'PASS'
                ? 'completed'
                : 'failed';
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
        this.quarantine(entry, result.discarded === true
            ? 'discarded'
            : result.record?.verdict === 'PASS'
                ? 'completed'
                : 'failed');
    }
    async publish(entry, outcome, now) {
        let result;
        await this.withRecordLock(this.recordKey(entry), async () => {
            result = await this.publishUnlocked(entry, outcome, now);
        });
        return result ?? { run: entry.run };
    }
    async publishUnlocked(entry, outcome, now) {
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
            state: result.discarded === true
                ? 'discarded'
                : result.record?.verdict === 'PASS'
                    ? 'completed'
                    : 'failed',
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
            this.admitted.delete(entry.run.id);
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
            ...(entry.phase === undefined ? {} : { phase: entry.phase }),
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
        if (this.disposed)
            return;
        this.disposed = true;
        this.queue.dispose();
        const admitted = [...this.admitted.values()];
        this.admitted.clear();
        this.liveRuns.clear();
        this.liveKeys.clear();
        this.liveByRun.clear();
        for (const entry of admitted) {
            if (!entry.started) {
                // No child ever read this checkout: release it and its lease now.
                void this.host.discardSnapshot(entry.workspace, entry.run.id).catch(() => undefined);
                continue;
            }
            // A live reviewer may still be reading its checkout; keep the lease
            // renewing until teardown confirms, then release the snapshot.
            void this.discardAfterTeardown(entry);
        }
    }
    /** Wait out a disposed reviewer child, then release its snapshot and lease. */
    async discardAfterTeardown(entry) {
        for (let attempt = 1;; attempt += 1) {
            try {
                await this.waitForTeardown(entry);
                break;
            }
            catch {
                // Keep the checkout leased while the child is still alive; the stale
                // sweep must not reclaim a snapshot a running reviewer is reading.
                const delay = Math.max(retryDelayMs(attempt, this.limits), 10);
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, delay);
                    timer.unref?.();
                });
            }
        }
        await this.host.discardSnapshot(entry.workspace, entry.run.id).catch(() => undefined);
    }
    async enqueue(input) {
        if (this.disposed) {
            // Snapshot preparation can outlive disposal; never admit it.
            void this.host.discardSnapshot(input.workspace, input.run.id).catch(() => undefined);
            return { kind: 'full', depth: 0, maxQueued: 0 };
        }
        const reviewer = input.request.reviewer.id;
        const key = liveIdentity({
            workspace: input.workspace,
            rule: input.rule,
            change: input.change,
            ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
            ...(input.phase === undefined ? {} : { phase: input.phase }),
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
            request: {
                ...input.request,
                cancelled: () => this.fenced.has(input.run.id),
            },
            ...(input.phase === undefined ? {} : { phase: input.phase }),
            liveKey: key,
            waited: false,
            reprepared: false,
            baselineCaptured: false,
            started: false,
            ...(input.reprepare === undefined ? {} : { reprepare: input.reprepare }),
        };
        this.admitted.set(entry.run.id, entry);
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
                this.admitted.delete(entry.run.id);
                return { kind: 'accepted', phase: 'settled' };
            }
            this.admitted.delete(entry.run.id);
            throw error;
        }
        switch (admission.kind) {
            case 'duplicate':
                this.admitted.delete(entry.run.id);
                if (admission.run.run.id !== input.run.id) {
                    void this.host.discardSnapshot(input.workspace, input.run.id).catch(() => undefined);
                }
                return { kind: 'duplicate', runId: admission.run.run.id };
            case 'full':
                this.admitted.delete(entry.run.id);
                return { kind: 'full', depth: admission.depth, maxQueued: admission.maxQueued };
            case 'settled':
                this.admitted.delete(entry.run.id);
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
