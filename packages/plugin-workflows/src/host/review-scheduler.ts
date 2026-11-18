import { readFile, unlink } from 'node:fs/promises'
import { reviewDigest } from './evidence.js'
import {
  beginReviewAttempt,
  containedRecordTarget,
  publishReviewOutcome,
  type ReviewAttemptHandle,
  type ReviewAttemptOutcome,
  type ReviewRecordBaseline,
  type ReviewRunInput,
  type ReviewRunResult,
  readReviewRecordFingerprint,
  recordReviewFailure,
  sectionReviewDigest,
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
 * The engine-side review scheduler: it admits one prepared review immediately
 * (only a shared unit key waits), runs the review executor in the background,
 * persists the settled workflow run, and releases the frozen snapshot. A review
 * step stays open while its run is live, so the turn-close gate still refuses a
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
  /** The stable snapshot path key; defaults to the run id. */
  readonly snapshotKey?: string
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
  /** The snapshot path this entry owns; the stable unit key. */
  readonly snapshotKey: string
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
  /** Remove one unit checkout; a different owner in its lease is left alone. */
  discardSnapshot: (workspace: string, key: string, owner?: string) => Promise<void>
  /** Persist the bounded attempt facts on the stored review step of a run. */
  persistReviewAttempts?: (
    workspace: string,
    runId: string,
    stepId: string,
    attempts: number,
    failureClass?: FailureClass,
  ) => Promise<void>
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

/** The task ids one review request's recorded coverage names. */
function coverageOf(request: ReviewRunInput): string[] {
  const section = request.prepared.section
  if (section !== undefined) return section.covered.map((task) => task.id)
  return request.task === undefined ? [] : [request.task.id]
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
  private readonly recordLocks = new Map<string, Promise<void>>()

  /**
   * Fence a run that settled without its review (completed-soft): a queued
   * attempt is cancelled before it starts, and a late verdict is discarded
   * instead of publishing over the terminal run.
   */
  fence(runId: string): void {
    if (this.disposed) return
    this.fenced.add(runId)
    const entry = this.admitted.get(runId)
    if (entry === undefined) return
    void this.discardFencedRecord(entry)
    if (entry.started) return
    void this.queue.cancel(entry.file.id).catch(() => undefined)
  }

  private recordKey(entry: ScheduledEntry): string {
    const definition = entry.request.definition.id
    const scope = entry.request.step.review?.scope ?? 'whole'
    const phase = entry.request.step.review?.phase ?? 'spec'
    const recordId = entry.request.prepared.section?.recordId ?? entry.request.task?.id
    return scope === 'task'
      ? `${entry.workspace}\u0000${definition}\u0000${entry.change}\u0000task\u0000${recordId ?? ''}`
      : `${entry.workspace}\u0000${definition}\u0000${entry.change}\u0000whole\u0000${phase}`
  }

  private async withRecordLock(key: string, action: () => Promise<void>): Promise<void> {
    const previous = this.recordLocks.get(key) ?? Promise.resolve()
    const next = previous.then(action, action).finally(() => {
      if (this.recordLocks.get(key) === next) this.recordLocks.delete(key)
    })
    this.recordLocks.set(key, next)
    return next
  }

  /** Remove a PASS record/approval a fenced settlement must not leave behind. */
  private async discardFencedRecord(entry: ScheduledEntry): Promise<void> {
    await this.withRecordLock(this.recordKey(entry), async () => {
      await this.discardFencedRecordUnlocked(entry)
    })
  }

  private async discardFencedRecordUnlocked(entry: ScheduledEntry): Promise<void> {
    const definition = entry.request.definition.id
    const scope = entry.request.step.review?.scope ?? 'whole'
    const phase = entry.request.step.review?.phase
    const section = entry.request.prepared.section
    const taskId = section?.recordId ?? entry.request.task?.id
    const suffix = scope === 'task' ? `tasks/${taskId ?? ''}.json` : `${phase ?? 'spec'}.json`
    const expectedDigest =
      section === undefined
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
        : sectionReviewDigest(
            section,
            entry.request.prepared.artifactDigest ?? entry.request.prepared.specDigest,
            entry.request.prepared.tree,
          )
    const removeIfOwned = async (relative: string): Promise<void> => {
      // Never follow a linked ancestor outside the workspace, and never remove
      // a record published by another digest.
      const target = await containedRecordTarget(entry.workspace, relative).catch(() => undefined)
      if (target === undefined) return
      const raw = await readFile(target, 'utf8').catch(() => undefined)
      if (raw === undefined) return
      let digest: string | undefined
      try {
        digest = (JSON.parse(raw) as { digest?: string }).digest
      } catch {
        return
      }
      if (digest === expectedDigest) await unlink(target).catch(() => undefined)
    }
    await removeIfOwned(`.dsh/workflows/records/${definition}/${entry.change}/${suffix}`)
    if (section !== undefined) {
      // A section PASS published one approval per covered checked task.
      for (const task of section.covered) {
        await removeIfOwned(`openspec/changes/${entry.change}/reviews/${task.id}.json`)
      }
    } else if (taskId !== undefined) {
      await removeIfOwned(`openspec/changes/${entry.change}/reviews/${taskId}.json`)
    }
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

  /**
   * A live review of the same unit at any input digest, under any rule. Two
   * review rules on one change and unit share the unit's snapshot path (the
   * unit key omits the rule), so a successor must not prepare over a checkout
   * its predecessor is still reading: preparation waits for the settlement and
   * cleanup instead.
   */
  liveUnit(input: {
    workspace: string
    rule: string
    change: string
    taskId?: string
    phase?: string
  }): WorkflowRun | undefined {
    // The live key is `workspace\0rule\0change\0taskId\0phase\0digest\0reviewer`;
    // ownership of the unit path deliberately ignores the rule.
    for (const [key, run] of this.liveRuns) {
      const parts = key.split('\u0000')
      if (parts[0] !== input.workspace) continue
      if (parts[2] !== input.change) continue
      if (parts[3] !== (input.taskId ?? '')) continue
      if (parts[4] !== (input.phase ?? '')) continue
      return run
    }
    return undefined
  }

  /**
   * A live review of this change that already covers one of these task ids: a
   * pending section run covers its recorded `taskIds`, a per-task run its own
   * id. A run with exactly this coverage is this unit's own successor and is
   * left to the queue's identity check, so a retry is never blocked here.
   */
  liveCovering(
    workspace: string,
    change: string,
    taskIds: readonly string[],
  ): WorkflowRun | undefined {
    if (taskIds.length === 0) return undefined
    for (const entry of this.admitted.values()) {
      if (entry.workspace !== workspace || entry.change !== change) continue
      const covered = coverageOf(entry.request)
      if (covered.length === 0) continue
      if (covered.length === taskIds.length && covered.every((id) => taskIds.includes(id))) {
        continue
      }
      if (covered.some((id) => taskIds.includes(id))) return entry.run
    }
    return undefined
  }

  /**
   * An already-admitted review whose coverage intersects this entry's under a
   * different unit shape: a section and one of its covered tasks must not both
   * admit. Same-shape admissions keep their own identity (a successor attempt
   * for the same unit with a new digest is a legitimate new review).
   */
  private coveringEntry(entry: ScheduledEntry): ScheduledEntry | undefined {
    const covered = coverageOf(entry.request)
    if (covered.length === 0) return undefined
    const entrySection = entry.request.prepared.section !== undefined
    for (const other of this.admitted.values()) {
      if (other === entry) continue
      if (other.workspace !== entry.workspace || other.change !== entry.change) continue
      if ((other.request.prepared.section !== undefined) === entrySection) continue
      if (coverageOf(other.request).some((id) => covered.includes(id))) return other
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
      persist: async (entry) => {
        try {
          await this.host.persistReviewAttempts?.(
            entry.workspace,
            entry.run.id,
            entry.request.step.id,
            Math.max(1, entry.file.attempts ?? 0),
            entry.file.failureClass,
          )
        } catch {
          // Attempt facts are diagnostics; they never fail a review.
        }
      },
      fail: async (entry, error, failureClass: FailureClass) => {
        if (this.disposed) return
        const failure = await recordReviewFailure({
          ...this.attemptRequest(entry),
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
      settled: (entry, state, info) => {
        this.fenced.delete(entry.run.id)
        const settled = this.lastSettled.get(entry.run.id)
        // A quarantined run keeps its slot, key, live dedupe entry, and
        // snapshot until teardown confirms; the quarantine callback releases
        // them, then discards the snapshot.
        if (info?.quarantined !== true) {
          // Release the live slot only after its checkout is gone: a successor
          // must not prepare the stable unit path while this cleanup can still
          // delete it.
          void this.host
            .discardSnapshot(entry.workspace, entry.snapshotKey, entry.run.id)
            .catch(() => undefined)
            .finally(() => {
              this.forgetLive(entry.run.id)
              this.admitted.delete(entry.run.id)
            })
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
    // The attempt's own record carries the transport attempt it settled.
    const attempt = await beginReviewAttempt(this.attemptRequest(entry))
    // Disposal can land while the asynchronous preparation reads its inputs.
    if (this.disposed || !this.queue.owns(entry.file.id)) {
      void attempt.result.catch(() => undefined)
      return
    }
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
          ...this.attemptRequest(entry),
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
      await this.host
        .discardSnapshot(entry.workspace, entry.snapshotKey, entry.run.id)
        .catch(() => undefined)
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
        // A possibly-still-running child owns the key and snapshot.
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
      await this.queue.scheduleRetry(entry, failure)
      return
    }
    await this.publishAndSettle(entry, outcome, attempt.now)
  }

  /** The request stamped with the transport attempts this settlement used. */
  private attemptRequest(entry: ScheduledEntry): ReviewRunInput {
    return {
      ...entry.request,
      attempts: Math.max(1, entry.file.attempts ?? this.queue.attemptsOf(entry.run.id)),
    }
  }

  /** Publish the settled attempt, then release or quarantine the key. */
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
          ...this.attemptRequest(entry),
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
          ...this.attemptRequest(entry),
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
    // The fence can land while the record is being verified/written; remove
    // any surviving PASS for the settled run before reporting completion.
    if (this.fenced.has(entry.run.id)) {
      await this.discardFencedRecord(entry)
      await this.queue.complete(entry, 'discarded')
      return
    }
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
    let result: ReviewRunResult | undefined
    await this.withRecordLock(this.recordKey(entry), async () => {
      result = await this.publishUnlocked(entry, outcome, now)
    })
    return result ?? { run: entry.run }
  }

  private async publishUnlocked(
    entry: ScheduledEntry,
    outcome: ReviewAttemptOutcome,
    now: number,
  ): Promise<ReviewRunResult> {
    const request = this.attemptRequest(entry)
    const result: ReviewRunResult = await publishReviewOutcome(request, outcome, now).catch(
      async (error: unknown): Promise<ReviewRunResult> => {
        // A publication fault must still settle visibly; the queue then releases
        // or quarantines by the actual teardown state.
        return await recordReviewFailure({
          ...request,
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
        // Discard the predecessor's checkout before releasing its live slot: a
        // successor that prepared in between would otherwise lose its snapshot.
        await this.host.discardSnapshot(entry.workspace, entry.snapshotKey, entry.run.id)
        this.forgetLive(entry.run.id)
        this.admitted.delete(entry.run.id)
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

  summary(): { enabled: boolean; active: number; attempts: number } {
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
        void this.host
          .discardSnapshot(entry.workspace, entry.snapshotKey, entry.run.id)
          .catch(() => undefined)
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
    await this.host.discardSnapshot(entry.workspace, entry.snapshotKey).catch(() => undefined)
  }

  /**
   * A duplicate admission prepared the unit's stable path, which the incumbent
   * reviewer is already reading: never delete a checkout another live run owns.
   */
  private discardDuplicateSnapshot(
    workspace: string,
    snapshotKey: string,
    incumbentRunId: string,
  ): void {
    const incumbent = this.admitted.get(incumbentRunId)
    if (incumbent !== undefined && incumbent.snapshotKey === snapshotKey) return
    void this.host.discardSnapshot(workspace, snapshotKey, incumbentRunId).catch(() => undefined)
  }

  async enqueue(input: ScheduledReview): Promise<ReviewAdmission> {
    if (this.disposed) {
      // Snapshot preparation can outlive disposal; never admit it.
      void this.host
        .discardSnapshot(input.workspace, input.snapshotKey ?? input.run.id)
        .catch(() => undefined)
      return { kind: 'accepted', phase: 'settled' }
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
        this.discardDuplicateSnapshot(
          input.workspace,
          input.snapshotKey ?? input.run.id,
          existing.id,
        )
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
      snapshotKey: input.snapshotKey ?? input.run.id,
      request: {
        ...input.request,
        cancelled: () => this.disposed || this.fenced.has(input.run.id),
      },
      ...(input.phase === undefined ? {} : { phase: input.phase }),
      liveKey: key,
      waited: false,
      reprepared: false,
      baselineCaptured: false,
      started: false,
      ...(input.reprepare === undefined ? {} : { reprepare: input.reprepare }),
    }
    this.admitted.set(entry.run.id, entry)
    // Reserve the coverage before awaiting the queue: a section and a task that
    // it covers must not both admit when two sessions advance at once.
    const overlapping = this.coveringEntry(entry)
    if (overlapping !== undefined) {
      this.admitted.delete(entry.run.id)
      this.discardDuplicateSnapshot(
        input.workspace,
        input.snapshotKey ?? input.run.id,
        overlapping.run.id,
      )
      return { kind: 'duplicate', runId: overlapping.run.id }
    }
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
          this.discardDuplicateSnapshot(
            input.workspace,
            input.snapshotKey ?? input.run.id,
            admission.run.run.id,
          )
        }
        return { kind: 'duplicate', runId: admission.run.run.id }
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
