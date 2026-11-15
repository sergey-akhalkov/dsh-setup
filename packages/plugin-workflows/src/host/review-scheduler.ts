import {
  type ReviewRunInput,
  type ReviewRunResult,
  recordReviewFailure,
  runReviewStep,
} from './review.js'
import {
  type FailureClass,
  type QueueLimits,
  type QueueRun,
  type QueueRunFile,
  ReviewQueue,
  type SettledRunState,
} from './review-queue.js'
import type { WorkflowRun } from './runs.js'

/**
 * The engine-side review scheduler: it admits one prepared review through the
 * bounded queue, runs the review executor in the background, persists the
 * settled workflow run, and releases the frozen snapshot. A review step stays
 * open while its run is admitted, so the turn-close gate still refuses a
 * PASS-dependent close until the record exists.
 */

export interface ScheduledReview {
  readonly workspace: string
  readonly run: WorkflowRun
  readonly request: ReviewRunInput
  /** The dedupe facts: rule + change + task + digest + reviewer. */
  readonly rule: string
  readonly change: string
  readonly taskId?: string
  readonly digest: string
}

interface ScheduledEntry extends QueueRun {
  readonly workspace: string
  readonly run: WorkflowRun
  readonly request: ReviewRunInput
}

/** The host-owned operations the scheduler cannot perform alone. */
export interface ReviewSchedulerHost {
  persistRun: (workspace: string, run: WorkflowRun) => Promise<WorkflowRun>
  discardSnapshot: (workspace: string, runId: string) => Promise<void>
  onSettled?: (status: {
    readonly runId: string
    readonly state: SettledRunState
    readonly recordPath?: string
    readonly verdict?: string
  }) => void
}

export type ReviewAdmission =
  | { readonly kind: 'accepted'; readonly phase: string }
  | { readonly kind: 'duplicate'; readonly runId: string }
  | { readonly kind: 'full'; readonly depth: number; readonly maxQueued: number }

function queueFile(input: ScheduledReview): QueueRunFile {
  const task = input.taskId ?? 'whole'
  return {
    id: `${input.run.id}:${input.rule}:${input.change}:${task}`,
    key: `${input.rule}/${input.change}/${task}`,
    identity: `${input.rule}/${input.change}/${task}/${input.digest}/${input.request.reviewer.id}`,
    state: 'queued',
  }
}

export class ReviewScheduler {
  private readonly maxAttempts: number
  private readonly queue: ReviewQueue<ScheduledEntry>
  /** The last settled result per run id, for a status read. */
  private readonly lastSettled = new Map<
    string,
    { state: SettledRunState; recordPath?: string; verdict?: string }
  >()
  /** Live reviews by workspace+rule+change+task, so the host admits before a snapshot. */
  private readonly liveRuns = new Map<string, WorkflowRun>()
  private readonly liveKeys = new Map<string, string>()

  private liveKey(input: {
    workspace: string
    rule: string
    change: string
    taskId?: string
  }): string {
    return `${input.workspace}\u0000${input.rule}\u0000${input.change}\u0000${input.taskId ?? ''}`
  }

  /** The run already covering this review, before any snapshot is prepared. */
  liveRun(input: {
    workspace: string
    rule: string
    change: string
    taskId?: string
  }): WorkflowRun | undefined {
    return this.liveRuns.get(this.liveKey(input))
  }

  constructor(
    limits: QueueLimits,
    private readonly host: ReviewSchedulerHost,
  ) {
    this.maxAttempts = limits.maxAttempts
    this.queue = new ReviewQueue<ScheduledEntry>(limits, {
      start: (entry) => {
        // The admission handshake must return before the reviewer starts: a
        // turn close may not wait for a model run. The launched review settles
        // the run and completes the queue entry itself.
        void this.launch(entry)
        return Promise.resolve()
      },
      persist: () => undefined,
      fail: async (entry, error, failureClass: FailureClass) => {
        const failure = await recordReviewFailure({
          ...entry.request,
          error: error instanceof Error ? error.message : String(error),
          failureClass,
        }).catch(() => undefined)
        if (failure === undefined) return
        await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined)
        this.lastSettled.set(entry.run.id, { state: 'failed' })
      },
      timeout: async (entry, info) => {
        const position = info.position === undefined ? '' : ` at position ${String(info.position)}`
        const failure = await recordReviewFailure({
          ...entry.request,
          error: `review queue wait timed out after ${String(info.waitMs)} ms${position}; no target started. Shorten the running reviews or start this review again after the queue drains`,
          failureClass: 'queue-timeout',
        }).catch(() => undefined)
        if (failure === undefined) return
        await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined)
        this.lastSettled.set(entry.run.id, { state: 'failed' })
      },
      settled: (entry, state) => {
        void this.host.discardSnapshot(entry.workspace, entry.run.id)
        const settled = this.lastSettled.get(entry.run.id)
        this.host.onSettled?.({
          runId: entry.run.id,
          state,
          ...(settled?.recordPath === undefined ? {} : { recordPath: settled.recordPath }),
          ...(settled?.verdict === undefined ? {} : { verdict: settled.verdict }),
        })
      },
      now: () => new Date(),
    })
  }

  private async launch(entry: ScheduledEntry): Promise<void> {
    let result: ReviewRunResult
    try {
      result = await runReviewStep(entry.request)
    } catch (error) {
      result = await recordReviewFailure({
        ...entry.request,
        error: error instanceof Error ? error.message : String(error),
        failureClass: 'unknown',
      })
    }
    const transientFailures = new Set(['child-limit', 'provider-not-started', 'timeout'])
    const failureClass = result.record?.failureClass
    if (
      failureClass !== undefined &&
      transientFailures.has(failureClass) &&
      this.queue.attemptsOf(entry.run.id) < this.maxAttempts
    ) {
      await this.queue.scheduleRetry(entry, {
        failureClass: failureClass as FailureClass,
        transient: true,
      })
      return
    }
    try {
      await this.host.persistRun(entry.workspace, result.run)
      this.lastSettled.set(entry.run.id, {
        state: result.record?.verdict === 'PASS' ? 'completed' : 'failed',
        ...(result.recordPath === undefined ? {} : { recordPath: result.recordPath }),
        ...(result.record?.verdict === undefined ? {} : { verdict: result.record.verdict }),
      })
    } finally {
      // Keep the capacity slot and snapshot until the reviewer is torn down; a
      // timed-out review must not overlap the next admitted reviewer.
      await entry.request.runner.waitForTeardown?.().catch(() => undefined)
      await this.queue.complete(entry, result.record?.verdict === 'PASS' ? 'completed' : 'failed')
      const key = this.liveKeys.get(entry.run.id)
      if (key !== undefined) {
        this.liveRuns.delete(key)
        this.liveKeys.delete(entry.run.id)
      }
    }
  }
  summary(): { enabled: boolean; concurrency: number; active: number; queued: number } {
    return this.queue.summary()
  }

  dispose(): void {
    this.queue.dispose()
  }

  async enqueue(input: ScheduledReview): Promise<ReviewAdmission> {
    const key = this.liveKey(input)
    const existing = this.liveRuns.get(key)
    if (existing !== undefined) return { kind: 'duplicate', runId: existing.id }
    const entry: ScheduledEntry = {
      file: queueFile(input),
      workspace: input.workspace,
      run: input.run,
      request: input.request,
    }
    const admission = await this.queue.submit(entry)
    switch (admission.kind) {
      case 'duplicate':
        return { kind: 'duplicate', runId: admission.run.run.id }
      case 'full':
        return { kind: 'full', depth: admission.depth, maxQueued: admission.maxQueued }
      case 'settled':
        return { kind: 'accepted', phase: 'settled' }
      case 'accepted':
        this.liveRuns.set(key, input.run)
        this.liveKeys.set(input.run.id, key)
        return { kind: 'accepted', phase: admission.phase }
    }
  }
}
