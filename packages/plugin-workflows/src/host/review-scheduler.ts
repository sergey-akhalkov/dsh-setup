import {
  beginReviewAttempt,
  publishReviewOutcome,
  type ReviewAttemptHandle,
  type ReviewAttemptOutcome,
  type ReviewRecordBaseline,
  type ReviewRunInput,
  type ReviewRunResult,
  readReviewRecordFingerprint,
  recordReviewFailure,
} from './review.js'
import {
  type ClassifiedFailure,
  type FailureClass,
  type QueueLimits,
  type QueueRun,
  type QueueRunFile,
  ReviewQueue,
  retryDelayMs,
  type SettledRunState,
} from './review-queue.js'
import { settleStep, type WorkflowRun } from './runs.js'

/**
 * The engine-side review scheduler: it admits one prepared review through the
 * bounded queue, runs the review executor in the background, persists the
 * settled workflow run, and releases the frozen snapshot. A review step stays
 * open while its run is admitted, so the turn-close gate still refuses a
 * PASS-dependent close until the record exists.
 */

/** The re-prepared inputs of a queued review whose source set moved. */
export interface RepreparedReview {
  readonly kind: 'replaced'
  readonly prepared: ReviewRunInput['prepared']
  readonly digest: string
  readonly liveDigest: string
  readonly task?: NonNullable<ReviewRunInput['task']>
}

export type ReviewReprepareOutcome = { readonly kind: 'unchanged' } | RepreparedReview

export interface ScheduledReview {
  readonly workspace: string
  readonly run: WorkflowRun
  readonly request: ReviewRunInput
  /** The dedupe facts: rule + change + task + digest + reviewer. */
  readonly rule: string
  readonly change: string
  readonly taskId?: string
  /** The whole-scope record phase (`spec`, `integration`, ...). */
  readonly phase?: string
  readonly digest: string
  /** The digest known before the snapshot exists, for the live-admission key. */
  readonly liveDigest?: string
  /**
   * Re-check the live source inputs when the entry becomes start-eligible. The
   * callback reports `unchanged`, or rebuilds once and returns the replacement;
   * it throws a classified failure when the inputs moved a second time.
   */
  readonly reprepare?: (reprepared: boolean) => Promise<ReviewReprepareOutcome>
}

interface ScheduledEntry extends QueueRun {
  readonly workspace: string
  readonly run: WorkflowRun
  readonly rule: string
  readonly change: string
  readonly taskId?: string
  readonly phase?: string
  request: ReviewRunInput
  /** The live-admission key, kept through quarantine until teardown confirms. */
  liveKey?: string
  /** The entry waited in the queue or in retry backoff at least once. */
  waited: boolean
  /** The single input re-preparation is spent. */
  reprepared: boolean
  /** The authoritative-record baseline was captured before the first start. */
  baselineCaptured: boolean
  /** The settled attempt must not publish over the captured record. */
  baseline?: ReviewRecordBaseline
  /** The start hook began an attempt; disposal must await its teardown. */
  started: boolean
  reprepare?: (reprepared: boolean) => Promise<ReviewReprepareOutcome>
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

function liveIdentity(input: {
  workspace: string
  rule: string
  change: string
  taskId?: string
  phase?: string
  digest?: string
  reviewer?: string
}): string {
  return `${input.workspace}\u0000${input.rule}\u0000${input.change}\u0000${input.taskId ?? ''}\u0000${input.phase ?? ''}\u0000${input.digest ?? ''}\u0000${input.reviewer ?? ''}`
}

function queueIdentity(input: {
  workspace: string
  rule: string
  change: string
  taskId?: string
  phase?: string
  digest: string
  reviewer: string
}): string {
  const scope = input.taskId ?? input.phase ?? 'whole'
  return `${input.workspace}/${input.rule}/${input.change}/${scope}/${input.digest}/${input.reviewer}`
}

function queueFile(input: ScheduledReview): QueueRunFile {
  const scope = input.taskId ?? input.phase ?? 'whole'
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
  }
}

/** The bounded wait for a child teardown; an unresponsive dispose is unconfirmed. */
const MAX_TEARDOWN_WAIT_MS = 30_000

/** Typed failures a start hook raises deliberately; the queue already settled. */
const START_FAILURE_NAMES: ReadonlySet<string> = new Set([
  'ConfigError',
  'ProviderStartError',
  'PermissionError',
  'TimeoutError',
  'InvalidOutputError',
  'InputMutationError',
])

/** Keep a failure's diagnostic and say the slot stays held until teardown. */
function withUnconfirmedTeardown(outcome: ReviewAttemptOutcome): ReviewAttemptOutcome {
  const result = outcome.result
  if (result.kind !== 'failure') return outcome
  return {
    ...outcome,
    result: {
      ...result,
      error: `${result.error}; the reviewer could not be confirmed cancelled, so its review slot stays held until teardown completes — check the provider before starting a fresh review`,
    },
  }
}

export class ReviewScheduler {
  private readonly limits: QueueLimits
  private readonly maxAttempts: number
  private readonly queue: ReviewQueue<ScheduledEntry>
  /** Every admitted entry by run id, so disposal can clean its snapshot up. */
  private readonly admitted = new Map<string, ScheduledEntry>()
  private disposed = false
  /** The last settled result per run id, for a status read. */
  private readonly lastSettled = new Map<
    string,
    { state: SettledRunState; recordPath?: string; verdict?: string }
  >()
  /** Live reviews by complete identity, so the host admits before a snapshot. */
  private readonly liveRuns = new Map<string, WorkflowRun>()
  private readonly liveKeys = new Map<string, string>()
  private readonly liveByRun = new Map<string, WorkflowRun>()
  /** Runs fenced by a completed-soft settlement; their late verdict is discarded. */
  private readonly fenced = new Set<string>()

  /**
   * Fence a run that settled without its review (completed-soft): a queued
   * attempt is cancelled before it starts, and a late verdict is discarded
   * instead of publishing over the terminal run.
   */
  fence(runId: string): void {
    if (this.disposed) return
    this.fenced.add(runId)
    const entry = this.admitted.get(runId)
    if (entry === undefined || entry.started) return
    void this.queue.cancel(entry.file.id).catch(() => undefined)
  }

  /** The live review of this workflow run, regardless of current input changes. */
  liveRunById(runId: string): WorkflowRun | undefined {
    return this.liveByRun.get(runId)
  }

  /** The run already covering this review, before any snapshot is prepared. */
  liveRun(input: {
    workspace: string
    rule: string
    change: string
    taskId?: string
    phase?: string
    digest?: string
    reviewer?: string
  }): WorkflowRun | undefined {
    const exact = this.liveRuns.get(liveIdentity(input))
    if (exact !== undefined) return exact
    // Only a precheck that supplied no digest/reviewer may match the task
    // prefix: an exact caller must bind the complete identity.
    if (input.digest !== undefined || input.reviewer !== undefined) return undefined
    const prefix = `${input.workspace}\u0000${input.rule}\u0000${input.change}\u0000${input.taskId ?? ''}\u0000`
    for (const [key, run] of this.liveRuns) {
      if (key.startsWith(prefix)) return run
    }
    return undefined
  }

  constructor(
    limits: QueueLimits,
    private readonly host: ReviewSchedulerHost,
  ) {
    this.limits = limits
    this.maxAttempts = limits.maxAttempts
    this.queue = new ReviewQueue<ScheduledEntry>(limits, {
      start: (entry) => this.start(entry),
      persist: () => undefined,
      fail: async (entry, error, failureClass: FailureClass) => {
        if (this.disposed) return
        const failure = await recordReviewFailure({
          ...entry.request,
          error: error instanceof Error ? error.message : String(error),
          failureClass,
        }).catch(() => undefined)
        if (failure === undefined) return
        await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined)
        this.lastSettled.set(entry.run.id, {
          state: 'failed',
          ...(failure.recordPath === undefined ? {} : { recordPath: failure.recordPath }),
          ...(failure.record?.verdict === undefined ? {} : { verdict: failure.record.verdict }),
        })
      },
      timeout: async (entry, info) => {
        if (this.disposed) return
        const position = info.position === undefined ? '' : ` at position ${String(info.position)}`
        const failure = await recordReviewFailure({
          ...entry.request,
          error: `review queue wait timed out after ${String(info.waitMs)} ms${position}; no target started. Shorten the running reviews or start this review again after the queue drains`,
          failureClass: 'queue-timeout',
        }).catch(() => undefined)
        if (failure === undefined) return
        await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined)
        this.lastSettled.set(entry.run.id, {
          state: 'failed',
          ...(failure.recordPath === undefined ? {} : { recordPath: failure.recordPath }),
          ...(failure.record?.verdict === undefined ? {} : { verdict: failure.record.verdict }),
        })
      },
      settled: (entry, state, info) => {
        this.fenced.delete(entry.run.id)
        const settled = this.lastSettled.get(entry.run.id)
        // A quarantined run keeps its slot, key, live dedupe entry, and
        // snapshot until teardown confirms; the quarantine callback releases
        // them, then discards the snapshot.
        if (info?.quarantined !== true) {
          this.forgetLive(entry.run.id)
          this.admitted.delete(entry.run.id)
          void this.host.discardSnapshot(entry.workspace, entry.run.id).catch(() => undefined)
        }
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

  /** The queue's start hook: start the target and report once it is live. */
  private async start(entry: ScheduledEntry): Promise<void> {
    await this.reprepareIfChanged(entry)
    if (!this.queue.owns(entry.file.id)) return
    if (!entry.baselineCaptured) {
      // Start-eligible means the predecessor has settled: this record is the
      // publication baseline, and a retry keeps it rather than re-reading it.
      entry.baselineCaptured = true
      entry.baseline = {
        fingerprint: await readReviewRecordFingerprint(entry.workspace, entry.request),
      }
      entry.request = { ...entry.request, baseline: entry.baseline }
    }
    // The baseline read may have awaited; disposal or a successor can land
    // while it is pending, so ownership is checked again before start.
    if (this.disposed || !this.queue.owns(entry.file.id)) return
    entry.started = true
    const attempt = beginReviewAttempt(entry.request)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      // The acceptance deadline is cleared only by this success, after the
      // provider activation is published; a failed start reaches the queue's
      // classifier and keeps its deadline across the retry backoff. A hanging
      // activation must not outlive the timeout: publish and quarantine it.
      const started = await new Promise<'started' | 'timeout'>((resolve, reject) => {
        timer = setTimeout(() => resolve('timeout'), entry.request.timeoutMs)
        attempt.started.then(
          () => resolve('started'),
          (error: unknown) => reject(error),
        )
      })
      if (started === 'timeout') {
        if (this.disposed || !this.queue.owns(entry.file.id)) return
        void attempt.result.catch(() => undefined)
        const failure = await recordReviewFailure({
          ...entry.request,
          error:
            'provider activation timed out before the reviewer started; the reviewer could not be confirmed cancelled, so its review slot stays held until teardown completes',
          failureClass: 'timeout',
        }).catch(() => undefined)
        if (failure !== undefined) {
          await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined)
        }
        this.quarantine(entry, failure?.discarded === true ? 'discarded' : 'failed')
        return
      }
    } catch (error) {
      // The queue classifies this start failure and decides retry or terminal
      // settlement; the background attempt publishes nothing.
      void attempt.result.catch(() => undefined)
      throw error
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
    void this.finish(entry, attempt)
  }

  /** Re-check and re-prepare a queued entry's inputs exactly once. */
  private async reprepareIfChanged(entry: ScheduledEntry): Promise<void> {
    if (!entry.waited || entry.reprepare === undefined) return
    const outcome = await entry.reprepare(entry.reprepared)
    if (this.disposed || !this.queue.owns(entry.file.id)) {
      // A replacement snapshot may have been built after disposal; release it.
      await this.host.discardSnapshot(entry.workspace, entry.run.id).catch(() => undefined)
      return
    }
    if (outcome.kind === 'unchanged') return
    const identity = queueIdentity({
      workspace: entry.workspace,
      rule: entry.rule,
      change: entry.change,
      ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
      ...(entry.phase === undefined ? {} : { phase: entry.phase }),
      digest: outcome.digest,
      reviewer: entry.request.reviewer.id,
    })
    const replaced = await this.queue.replaceIdentity(entry, identity)
    if (!replaced.replaced) {
      // A live successor already holds the new identity; the queue settled
      // this entry as its duplicate and its follower proceeds. Persist a
      // terminal durable state so the discarded run cannot be advanced again.
      const settled = settleStep(entry.request.run, entry.request.step.id, 'failed', {
        at: Date.now(),
        reason:
          'a live successor already holds this review identity; this queued entry was discarded without replacing its record',
      })
      await this.host.persistRun(entry.workspace, settled).catch(() => undefined)
      return
    }
    entry.reprepared = true
    entry.request = {
      ...entry.request,
      prepared: outcome.prepared,
      ...(outcome.task === undefined ? {} : { task: outcome.task }),
    }
    this.rememberLive(entry, outcome.liveDigest)
  }

  /** Settle a finished attempt: retry (publishing nothing) or publish once. */
  private async finish(entry: ScheduledEntry, attempt: ReviewAttemptHandle): Promise<void> {
    const outcome = await attempt.result
    // A start failure, cancellation, or re-preparation collision already
    // settled this entry; its attempt must not publish a second verdict.
    if (!this.queue.owns(entry.file.id)) return
    if (this.fenced.has(entry.run.id)) {
      // The run settled completed-soft without its review: the late verdict is
      // discarded, never published over the terminal state or retried.
      if (await this.teardownConfirmed(entry)) await this.queue.complete(entry, 'discarded')
      else this.quarantine(entry, 'discarded')
      return
    }
    const result = outcome.result
    if (
      result.kind === 'failure' &&
      result.transient &&
      this.queue.attemptsOf(entry.file.id) < this.maxAttempts
    ) {
      if (!(await this.teardownConfirmed(entry))) {
        // A possibly-still-running child owns the slot, key, and snapshot.
        // Disposal during that await must not publish or restore the live key.
        if (this.disposed || !this.queue.owns(entry.file.id)) return
        await this.publishAndQuarantine(entry, withUnconfirmedTeardown(outcome), attempt.now)
        return
      }
      if (this.disposed || !this.queue.owns(entry.file.id)) return
      const failure: ClassifiedFailure = {
        failureClass: result.failureClass,
        transient: true,
        ...(result.retryAfterMs === undefined ? {} : { retryAfterMs: result.retryAfterMs }),
      }
      entry.waited = true
      await this.queue.scheduleRetry(entry, failure, new Error(result.error))
      return
    }
    await this.publishAndSettle(entry, outcome, attempt.now)
  }

  /** Publish the settled attempt, then release or quarantine the slot. */
  private async publishAndSettle(
    entry: ScheduledEntry,
    outcome: ReviewAttemptOutcome,
    now: number,
  ): Promise<void> {
    const teardownConfirmed = await this.teardownConfirmed(entry)
    // Disposal or a superseded admission during the awaited teardown must not
    // publish; ownership is rechecked immediately before any record write.
    if (this.disposed || !this.queue.owns(entry.file.id)) return
    // A completed-soft settlement may land during the teardown await; the
    // late verdict is discarded, never published over the terminal run.
    if (this.fenced.has(entry.run.id)) {
      if (teardownConfirmed) await this.queue.complete(entry, 'discarded')
      else this.quarantine(entry, 'discarded')
      return
    }
    // Teardown can take up to 30 seconds; recheck the reviewed inputs after it
    // and immediately before publishing a verdict, failing closed on change.
    // A verdict from a reviewer that may still be alive is never published.
    if (outcome.result.kind === 'verdict') {
      if (!teardownConfirmed) {
        const failure = await recordReviewFailure({
          ...entry.request,
          error:
            'the reviewer teardown could not be confirmed, so its verdict is not published; the review slot stays held until teardown completes',
          failureClass: 'timeout',
        }).catch(() => undefined)
        if (failure !== undefined) {
          await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined)
        }
        this.quarantine(entry, failure?.discarded === true ? 'discarded' : 'failed')
        return
      }
      const reason = await this.recheckGuard(entry)
      // The guard may await a filesystem or lock check; disposal or a successor
      // can land in that window, so ownership is checked again before writing.
      if (this.disposed || !this.queue.owns(entry.file.id)) return
      // The fence can land while the guard awaits; check it again before
      // either publication branch.
      if (this.fenced.has(entry.run.id)) {
        await this.queue.complete(entry, 'discarded')
        return
      }
      if (reason !== undefined) {
        const failure = await recordReviewFailure({
          ...entry.request,
          error: `reviewed inputs changed after the reviewer finished: ${reason}`,
          failureClass: 'reviewed-inputs-changed',
        }).catch(() => undefined)
        if (failure !== undefined) {
          await this.host.persistRun(entry.workspace, failure.run).catch(() => undefined)
        }
        await this.queue.complete(entry, failure?.discarded === true ? 'discarded' : 'failed')
        return
      }
    }
    const finalOutcome = teardownConfirmed ? outcome : withUnconfirmedTeardown(outcome)
    const result = await this.publish(entry, finalOutcome, now)
    const state: SettledRunState =
      result.discarded === true
        ? 'discarded'
        : result.record?.verdict === 'PASS'
          ? 'completed'
          : 'failed'
    if (!teardownConfirmed) {
      this.quarantine(entry, state)
      return
    }
    await this.queue.complete(entry, state)
  }

  /** The request's live-input guard, treated as a failure when it throws. */
  private async recheckGuard(entry: ScheduledEntry): Promise<string | undefined> {
    const guard = entry.request.prepared.liveGuard
    if (guard === undefined) return undefined
    try {
      return await guard()
    } catch (error) {
      return `the live-input recheck failed (${error instanceof Error ? error.message : String(error)})`
    }
  }

  /** Publish a terminal attempt whose child teardown is not yet confirmed. */
  private async publishAndQuarantine(
    entry: ScheduledEntry,
    outcome: ReviewAttemptOutcome,
    now: number,
  ): Promise<void> {
    const result = await this.publish(entry, outcome, now)
    this.quarantine(
      entry,
      result.discarded === true
        ? 'discarded'
        : result.record?.verdict === 'PASS'
          ? 'completed'
          : 'failed',
    )
  }

  private async publish(
    entry: ScheduledEntry,
    outcome: ReviewAttemptOutcome,
    now: number,
  ): Promise<ReviewRunResult> {
    const result: ReviewRunResult = await publishReviewOutcome(entry.request, outcome, now).catch(
      async (error: unknown): Promise<ReviewRunResult> => {
        // A publication fault must still settle visibly; the queue then releases
        // or quarantines by the actual teardown state.
        return await recordReviewFailure({
          ...entry.request,
          error: error instanceof Error ? error.message : String(error),
          failureClass: 'unknown',
        }).catch(() => ({ run: entry.run }))
      },
    )
    await this.host.persistRun(entry.workspace, result.run).catch(() => undefined)
    this.lastSettled.set(entry.run.id, {
      state:
        result.discarded === true
          ? 'discarded'
          : result.record?.verdict === 'PASS'
            ? 'completed'
            : 'failed',
      ...(result.recordPath === undefined ? {} : { recordPath: result.recordPath }),
      ...(result.record?.verdict === undefined ? {} : { verdict: result.record.verdict }),
    })
    return result
  }

  /**
   * Hold the run's slot, key, live dedupe entry, and snapshot until the child
   * teardown succeeds; the queue retries the callback with backoff.
   */
  private quarantine(entry: ScheduledEntry, outcome: SettledRunState): void {
    // A quarantined run still owns its admission: an identical request must
    // join it until teardown confirms and releases the slot.
    if (entry.liveKey !== undefined) {
      this.liveRuns.set(entry.liveKey, entry.run)
      this.liveKeys.set(entry.run.id, entry.liveKey)
      this.liveByRun.set(entry.run.id, entry.run)
    }
    this.queue.quarantine(
      entry,
      async () => {
        await this.waitForTeardown(entry)
        this.forgetLive(entry.run.id)
        this.admitted.delete(entry.run.id)
        await this.host.discardSnapshot(entry.workspace, entry.run.id)
      },
      outcome,
    )
  }

  /** Whether the reviewer child is confirmed gone; false on failure or timeout. */
  private async teardownConfirmed(entry: ScheduledEntry): Promise<boolean> {
    const wait = entry.request.runner.waitForTeardown
    if (wait === undefined) return true
    let timer: ReturnType<typeof setTimeout> | undefined
    const bound = new Promise<boolean>((resolve) => {
      timer = setTimeout(
        () => resolve(false),
        Math.min(MAX_TEARDOWN_WAIT_MS, entry.request.timeoutMs),
      )
      timer.unref?.()
    })
    try {
      return await Promise.race([
        wait.call(entry.request.runner).then(
          () => true,
          () => false,
        ),
        bound,
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  /** Await teardown, letting a rejection reach the queue's quarantine retry. */
  private async waitForTeardown(entry: ScheduledEntry): Promise<void> {
    await entry.request.runner.waitForTeardown?.()
  }

  private rememberLive(entry: ScheduledEntry, liveDigest: string): void {
    this.forgetLive(entry.run.id)
    const key = liveIdentity({
      workspace: entry.workspace,
      rule: entry.rule,
      change: entry.change,
      ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
      ...(entry.phase === undefined ? {} : { phase: entry.phase }),
      digest: liveDigest,
      reviewer: entry.request.reviewer.id,
    })
    this.liveRuns.set(key, entry.run)
    this.liveKeys.set(entry.run.id, key)
    this.liveByRun.set(entry.run.id, entry.run)
    entry.liveKey = key
  }

  private forgetLive(runId: string): void {
    this.liveByRun.delete(runId)
    const key = this.liveKeys.get(runId)
    if (key === undefined) return
    if (this.liveRuns.get(key)?.id === runId) this.liveRuns.delete(key)
    this.liveKeys.delete(runId)
  }

  summary(): { enabled: boolean; concurrency: number; active: number; queued: number } {
    return this.queue.summary()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.queue.dispose()
    const admitted = [...this.admitted.values()]
    this.admitted.clear()
    this.liveRuns.clear()
    this.liveKeys.clear()
    this.liveByRun.clear()
    for (const entry of admitted) {
      if (!entry.started) {
        // No child ever read this checkout: release it and its lease now.
        void this.host.discardSnapshot(entry.workspace, entry.run.id).catch(() => undefined)
        continue
      }
      // A live reviewer may still be reading its checkout; keep the lease
      // renewing until teardown confirms, then release the snapshot.
      void this.discardAfterTeardown(entry)
    }
  }

  /** Wait out a disposed reviewer child, then release its snapshot and lease. */
  private async discardAfterTeardown(entry: ScheduledEntry): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.waitForTeardown(entry)
        break
      } catch {
        // Keep the checkout leased while the child is still alive; the stale
        // sweep must not reclaim a snapshot a running reviewer is reading.
        const delay = Math.max(retryDelayMs(attempt, this.limits), 10)
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay)
          timer.unref?.()
        })
      }
    }
    await this.host.discardSnapshot(entry.workspace, entry.run.id).catch(() => undefined)
  }

  async enqueue(input: ScheduledReview): Promise<ReviewAdmission> {
    if (this.disposed) {
      // Snapshot preparation can outlive disposal; never admit it.
      void this.host.discardSnapshot(input.workspace, input.run.id).catch(() => undefined)
      return { kind: 'full', depth: 0, maxQueued: 0 }
    }
    const reviewer = input.request.reviewer.id
    const key = liveIdentity({
      workspace: input.workspace,
      rule: input.rule,
      change: input.change,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      digest: input.liveDigest ?? input.digest,
      reviewer,
    })
    const existing = this.liveRuns.get(key)
    if (existing !== undefined) {
      if (existing.id !== input.run.id) {
        void this.host.discardSnapshot(input.workspace, input.run.id).catch(() => undefined)
      }
      return { kind: 'duplicate', runId: existing.id }
    }
    const entry: ScheduledEntry = {
      file: queueFile(input),
      workspace: input.workspace,
      run: input.run,
      rule: input.rule,
      change: input.change,
      ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
      request: input.request,
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      liveKey: key,
      waited: false,
      reprepared: false,
      baselineCaptured: false,
      started: false,
      ...(input.reprepare === undefined ? {} : { reprepare: input.reprepare }),
    }
    this.admitted.set(entry.run.id, entry)
    let admission: Awaited<ReturnType<ReviewQueue<ScheduledEntry>['submit']>>
    try {
      admission = await this.queue.submit(entry)
    } catch (error) {
      // A terminal start failure publishes its ERROR through the fail hook; the
      // caller sees a settled admission, never an uncaught start error.
      if (
        error instanceof Error &&
        START_FAILURE_NAMES.has(error.name) &&
        !this.queue.owns(entry.file.id)
      ) {
        this.admitted.delete(entry.run.id)
        return { kind: 'accepted', phase: 'settled' }
      }
      this.admitted.delete(entry.run.id)
      throw error
    }
    switch (admission.kind) {
      case 'duplicate':
        this.admitted.delete(entry.run.id)
        if (admission.run.run.id !== input.run.id) {
          void this.host.discardSnapshot(input.workspace, input.run.id).catch(() => undefined)
        }
        return { kind: 'duplicate', runId: admission.run.run.id }
      case 'full':
        this.admitted.delete(entry.run.id)
        return { kind: 'full', depth: admission.depth, maxQueued: admission.maxQueued }
      case 'settled':
        this.admitted.delete(entry.run.id)
        return { kind: 'accepted', phase: 'settled' }
      case 'accepted':
        if (admission.phase !== 'running') entry.waited = true
        if (this.queue.owns(entry.file.id)) {
          this.rememberLive(entry, input.liveDigest ?? input.digest)
        }
        return { kind: 'accepted', phase: admission.phase }
    }
  }
}
