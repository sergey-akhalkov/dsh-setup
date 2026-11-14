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
            this.queue.attemptsOf(entry.run.id) < this.maxAttempts) {
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
            await this.queue.complete(entry, result.record?.verdict === 'PASS' ? 'completed' : 'failed');
        }
    }
    summary() {
        return this.queue.summary();
    }
    dispose() {
        this.queue.dispose();
    }
    async enqueue(input) {
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
                return { kind: 'accepted', phase: admission.phase };
        }
    }
}
