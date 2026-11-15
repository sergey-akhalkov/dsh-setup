import { recordReviewFailure, runReviewStep, } from './review.js';
import { ReviewQueue, } from './review-queue.js';
function queueFile(input) {
    const task = input.taskId ?? 'whole';
    return {
        id: `${input.run.id}:${input.rule}:${input.change}:${task}`,
        key: `${input.rule}/${input.change}/${task}`,
        identity: `${input.rule}/${input.change}/${task}/${input.digest}/${input.request.reviewer.id}`,
        state: 'queued',
    };
}
export class ReviewScheduler {
    host;
    maxAttempts;
    queue;
    /** The last settled result per run id, for a status read. */
    lastSettled = new Map();
    /** Live reviews by workspace+rule+change+task, so the host admits before a snapshot. */
    liveRuns = new Map();
    liveKeys = new Map();
    liveKey(input) {
        return `${input.workspace}\u0000${input.rule}\u0000${input.change}\u0000${input.taskId ?? ''}\u0000${input.digest ?? ''}\u0000${input.reviewer ?? ''}`;
    }
    /** The run already covering this review, before any snapshot is prepared. */
    liveRun(input) {
        const exact = this.liveRuns.get(this.liveKey(input));
        if (exact !== undefined)
            return exact;
        // A precheck may omit facts that are not prepared yet; match the task.
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
            start: (entry) => {
                // The admission handshake must return before the reviewer starts: a
                // turn close may not wait for a model run. The launched review settles
                // the run and completes the queue entry itself.
                void this.launch(entry);
                return Promise.resolve();
            },
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
                this.lastSettled.set(entry.run.id, { state: 'failed' });
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
                this.lastSettled.set(entry.run.id, { state: 'failed' });
            },
            settled: (entry, state) => {
                const key = this.liveKeys.get(entry.run.id);
                if (key !== undefined) {
                    this.liveRuns.delete(key);
                    this.liveKeys.delete(entry.run.id);
                }
                void this.host.discardSnapshot(entry.workspace, entry.run.id);
                const settled = this.lastSettled.get(entry.run.id);
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
    async launch(entry) {
        let result;
        try {
            result = await runReviewStep(entry.request);
        }
        catch (error) {
            result = await recordReviewFailure({
                ...entry.request,
                error: error instanceof Error ? error.message : String(error),
                failureClass: 'unknown',
            });
        }
        const transientFailures = new Set(['child-limit', 'provider-not-started', 'timeout']);
        const failureClass = result.record?.failureClass;
        if (failureClass !== undefined &&
            transientFailures.has(failureClass) &&
            this.queue.attemptsOf(entry.file.id) < this.maxAttempts) {
            // Keep the capacity slot until the timed-out reviewer is torn down.
            await entry.request.runner.waitForTeardown?.().catch(() => undefined);
            await this.queue.scheduleRetry(entry, {
                failureClass: failureClass,
                transient: true,
            });
            return;
        }
        try {
            await this.host.persistRun(entry.workspace, result.run);
            this.lastSettled.set(entry.run.id, {
                state: result.record?.verdict === 'PASS' ? 'completed' : 'failed',
                ...(result.recordPath === undefined ? {} : { recordPath: result.recordPath }),
                ...(result.record?.verdict === undefined ? {} : { verdict: result.record.verdict }),
            });
        }
        finally {
            // Keep the capacity slot and snapshot until the reviewer is torn down; a
            // timed-out review must not overlap the next admitted reviewer.
            await entry.request.runner.waitForTeardown?.().catch(() => undefined);
            await this.queue.complete(entry, result.record?.verdict === 'PASS' ? 'completed' : 'failed');
            const key = this.liveKeys.get(entry.run.id);
            if (key !== undefined) {
                this.liveRuns.delete(key);
                this.liveKeys.delete(entry.run.id);
            }
        }
    }
    summary() {
        return this.queue.summary();
    }
    dispose() {
        this.queue.dispose();
    }
    async enqueue(input) {
        const key = this.liveKey({
            ...input,
            digest: input.liveDigest ?? input.digest,
            reviewer: input.request.reviewer.id,
        });
        const existing = this.liveRuns.get(key);
        if (existing !== undefined)
            return { kind: 'duplicate', runId: existing.id };
        const entry = {
            file: queueFile(input),
            workspace: input.workspace,
            run: input.run,
            request: input.request,
        };
        const admission = await this.queue.submit(entry);
        switch (admission.kind) {
            case 'duplicate':
                return { kind: 'duplicate', runId: admission.run.run.id };
            case 'full':
                return { kind: 'full', depth: admission.depth, maxQueued: admission.maxQueued };
            case 'settled':
                return { kind: 'accepted', phase: 'settled' };
            case 'accepted':
                this.liveRuns.set(key, input.run);
                this.liveKeys.set(input.run.id, key);
                return { kind: 'accepted', phase: admission.phase };
        }
    }
}
