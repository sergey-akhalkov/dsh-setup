import { isAbsolute, relative, resolve } from 'node:path'
import type { Definition, Step } from './definitions.js'
import { resolveOwnership } from './definitions.js'
import type { EvidenceCheck, EvidenceContext } from './evidence.js'
import { requestMainStep } from './executors.js'
import type { WorkflowReceipt } from './receipts.js'
import {
  addViolation,
  incrementTurnBlocks,
  resetStepAttempts,
  setRunStatus,
  settleStep,
  type WorkflowRun,
} from './runs.js'
import type { SteerTarget } from './steer.js'
import { taskLanes } from './tasks.js'

/**
 * The turn-close gate. It refuses a root turn close while the run has an open
 * `blockTurnClose` step that this engine owns; a deferred step never steers.
 * The refusal is bounded by `maxBlocks`; after the cap the close is allowed
 * exactly once and recorded as a visible VIOLATION, not a pass. A run that
 * reached its owned review step has no refusal budget that releases the close:
 * while a due review unit has no live review the close is refused, and while
 * every due unit has a live review the close is the waiting close (no
 * VIOLATION). Its refusals are delivered under the caller's per-turn budget:
 * after that bound the refusal no longer holds the turn, and the run stays
 * open. An internal error fails open so a plugin fault can never trap a turn.
 */

/**
 * The per-turn delivery budget for review refusals, owned by the turn-close
 * listener. A review site submits a message only while `remaining()` is
 * positive and calls `spend()` for each one; without a delivery object (direct
 * gate calls and tests) the delivery is unbounded.
 */
export interface ReviewDelivery {
  remaining(): number
  spend(): void
}

export type TurnCloseOutcome =
  | { readonly kind: 'allow'; readonly run: WorkflowRun; readonly reason: string }
  | {
      readonly kind: 'refuse'
      readonly run: WorkflowRun
      readonly stepId: string
      readonly text: string
      /** Whether the refusal holds this turn open; false after the delivery bound. */
      readonly hold: boolean
    }
  | { readonly kind: 'violation'; readonly run: WorkflowRun; readonly detail: string }

/** The due review units a review run owes, as the host resolved them after dispatch. */
export interface ReviewCloseInput {
  /** Due units without a live review; each entry is a ready steer with its start action. */
  readonly uncovered: readonly string[]
  /** The live review run ids that cover a due unit. */
  readonly live: readonly string[]
  /** A failed dispatch the refusal must name, when the host attempted one. */
  readonly failure?: string
}

/**
 * The label a non-review `nonCritical` step records when its turn-close budget
 * is exhausted: the run closes without its evidence and never counts as a pass.
 * A run containing an owned review step never reaches this settlement.
 */
export const SOFT_SETTLEMENT = 'completed-soft'

/** Whether a run was released by the soft settlement: terminal without a pass. */
export function isSoftSettled(run: WorkflowRun): boolean {
  return run.status === 'completed' && run.reason === SOFT_SETTLEMENT
}

/**
 * Whether a stored run may be replaced by an incoming state. A completed-soft
 * run is terminal without its review: a late reviewer publication must never
 * restore its open step or drop the recorded settlement violation.
 */
export function runReplaceable(current: WorkflowRun, incoming: WorkflowRun): boolean {
  return !isSoftSettled(current) || isSoftSettled(incoming)
}

/** Release an optional step and finish the run: no open required step, no pass. */
function releaseSoft(run: WorkflowRun, stepId: string, at: number): WorkflowRun {
  const reason = `${SOFT_SETTLEMENT}: the refusal budget was exhausted; the run closed without its evidence and never counts as a pass`
  return setRunStatus(
    settleStep(run, stepId, 'cancelled', { at, reason }),
    'completed',
    at,
    SOFT_SETTLEMENT,
  )
}

export interface TurnCloseInput {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly agent: SteerTarget
  readonly evidenceContext: EvidenceContext
  readonly turn: number
  readonly maxBlocks: number
  readonly origin?: 'root' | 'subagent'
  /** The legacy plugins the profile installs. */
  readonly installedLegacy: ReadonlySet<string>
  /** `${plugin}/signal` entries that would actually steer; absent means installed = enabled. */
  readonly enabledLegacy?: ReadonlySet<string>
  /** The owned completion-coverage decision for this turn, when it applies. */
  readonly completion?: { readonly ok: boolean; readonly text?: string }
  /** The owned checkpoint remedy/age decision for this turn, when it applies. */
  readonly checkpointIssue?: { readonly text: string }
  /**
   * The failed review steps whose current record is a contract-matching ERROR,
   * as verified by the host before the close. Absent means no failure is
   * provisional, so a recordless failure keeps the close blocked. Unused for a
   * run with an owned review step: that run takes the uncapped review path.
   */
  readonly provisionalReviews?: ReadonlySet<string>
  /** The owned review obligation of a review run, resolved by the host. */
  readonly review?: ReviewCloseInput
  /** The caller's per-turn review-refusal delivery budget. */
  readonly delivery?: ReviewDelivery
  readonly now?: number
  readonly onError?: (error: unknown) => void
}

/**
 * The first open `blockTurnClose` owned step, unless an earlier open step is
 * deferred or a failed review step holds the sequence: an unresolved deferred
 * prerequisite stops the selection (the legacy gate is the only steer for it),
 * and only a provisional review failure (a contract-matching current ERROR
 * record) allows the close without opening a later step.
 */
export function selectBlockingStep(
  run: WorkflowRun,
  definition: Definition,
  installedLegacy: ReadonlySet<string>,
  enabledLegacy?: ReadonlySet<string>,
  provisionalReviews?: ReadonlySet<string>,
): Step | undefined {
  const resolved = resolveOwnership(definition, installedLegacy, enabledLegacy)
  const ownership = new Map(resolved.steps.map((step) => [step.id, step.ownership]))
  for (const step of definition.steps) {
    const state = run.steps.find((entry) => entry.id === step.id)?.state
    // A failed review step is provisional turn-close evidence only while its
    // current record is a contract-matching ERROR; a recordless failure
    // (unreadable artifacts, an unpublished ERROR) or a foreign record stays
    // blocking. The walk stops there so a later step is never selected.
    if (step.executor === 'review' && state === 'failed') {
      if (ownership.get(step.id) === 'defer') return undefined
      if (provisionalReviews?.has(step.id) === true) return undefined
      return step.blockTurnClose === true ? step : undefined
    }
    if (state !== 'open' && state !== 'blocked') continue
    if (ownership.get(step.id) === 'defer') return undefined
    if (step.blockTurnClose === true) return step
  }
  return undefined
}

/** Whether the definition carries an owned review step: the uncapped review path. */
function hasOwnedReviewStep(
  definition: Definition,
  installedLegacy: ReadonlySet<string>,
  enabledLegacy?: ReadonlySet<string>,
): boolean {
  if (!definition.steps.some((step) => step.executor === 'review')) return false
  const resolved = resolveOwnership(definition, installedLegacy, enabledLegacy)
  const owned = new Set(
    resolved.steps.filter((step) => step.ownership === 'own').map((step) => step.id),
  )
  return definition.steps.some((step) => step.executor === 'review' && owned.has(step.id))
}

/**
 * Whether the run reached its review step and still owes it: every earlier
 * pipeline step settled and the review step is not done. A pipeline's ordinary
 * main steps keep their refusal budget until the review obligation begins.
 */
function reviewObligationReached(run: WorkflowRun, definition: Definition): boolean {
  const review = definition.steps.find((step) => step.executor === 'review')
  if (review === undefined) return false
  const index = definition.steps.indexOf(review)
  for (const earlier of definition.steps.slice(0, index)) {
    const state = run.steps.find((entry) => entry.id === earlier.id)?.state
    if (state !== 'done' && state !== 'cancelled') return false
  }
  const state = run.steps.find((entry) => entry.id === review.id)?.state
  return state !== 'done' && state !== 'cancelled'
}

/**
 * Refuse a review obligation, or let the refusal stop holding the turn once the
 * per-turn delivery budget is spent. Neither way settles anything: no pass, no
 * VIOLATION, and the run is returned unchanged so a silent attempt writes
 * nothing.
 */
function reviewRefusal(input: TurnCloseInput, stepId: string, text: string): TurnCloseOutcome {
  const delivery = input.delivery
  if (delivery !== undefined && delivery.remaining() <= 0) {
    return { kind: 'refuse', hold: false, run: input.run, stepId, text }
  }
  delivery?.spend()
  input.agent.steer(text)
  return { kind: 'refuse', hold: true, run: input.run, stepId, text }
}

/**
 * The review run's turn-close decision: no refusal budget releases the close, so
 * the close is refused while any due unit has no live review and allowed as the
 * waiting close while every due unit has one. Only a current PASS ends the
 * obligation; a failed dispatch, a FINDINGS, and an ERROR all leave the unit due.
 */
function evaluateReviewClose(
  input: TurnCloseInput,
  review: ReviewCloseInput,
  ownedText: string | undefined,
): TurnCloseOutcome {
  if (review.uncovered.length > 0) {
    const failure = review.failure === undefined ? '' : ` ${review.failure}`
    const owned = ownedText === undefined ? '' : ` ${ownedText}`
    const shown = review.uncovered.slice(0, 3).join('; ')
    const more =
      review.uncovered.length > 3
        ? `; and ${String(review.uncovered.length - 3)} more due unit(s)`
        : ''
    const text = `the close is refused: ${String(review.uncovered.length)} due review unit(s) have no live review and the review gate has no refusal budget; only a current PASS ends the review.${failure}${owned} ${shown}${more}`
    return reviewRefusal(input, 'review', text)
  }
  if (review.live.length === 0) {
    if (ownedText !== undefined) {
      // A host-owned completion gap with no due unit to point at is still
      // refused, never released by a budget.
      return reviewRefusal(input, input.definition.steps.at(-1)?.id ?? 'owned-rule', ownedText)
    }
    return { kind: 'allow', run: input.run, reason: 'no due review unit is outstanding' }
  }
  const names = review.live.map((id) => `"${id}"`).join(', ')
  const text = `waiting for the live review run${review.live.length === 1 ? '' : 's'} ${names}: write nothing in the reviewed scope while the verdict is pending; this is a waiting close with no VIOLATION and no approval is granted until a current PASS. The verdict delivery starts the next turn`
  // A waiting close is silent: no steer, no step, only the recorded reason.
  return { kind: 'allow', run: input.run, reason: text }
}

/** Evaluate one root turn stop. */
export function evaluateTurnClose(input: TurnCloseInput): TurnCloseOutcome {
  const at = input.now ?? Date.now()
  try {
    if (input.origin === 'subagent') {
      return { kind: 'allow', run: input.run, reason: 'a subagent turn is exempt' }
    }
    // A failed task-review dispatch is an unresolved obligation while the run
    // has retries left. A capped run is terminal (`failed`) and skips only this
    // branch; its completion coverage is still evaluated below.
    const blocksForTurn = (run: typeof input.run): number =>
      run.turnBlocksTurn === input.turn ? (run.turnBlocks ?? 0) : 0
    // A new turn starts from zero, not from the previous turn's count.
    const budgetRun = (run: typeof input.run): typeof input.run =>
      run.turnBlocksTurn === input.turn ? run : { ...run, turnBlocks: 0 }
    const markTurn = (run: typeof input.run): typeof input.run => ({
      ...run,
      turnBlocksTurn: input.turn,
    })
    // A host-computed owned decision (completion coverage or the checkpoint
    // remedy/age rule) refuses before the generic step walk.
    const ownedText =
      input.checkpointIssue?.text ??
      (input.completion?.ok === false
        ? (input.completion.text ?? 'the completion coverage is incomplete')
        : undefined)
    // A run that reached an owned review step never takes the refusal budget:
    // the host resolves its due units after dispatching them, and only a
    // current PASS on every due unit ends the obligation (design D3/D9).
    const ownedReview = hasOwnedReviewStep(
      input.definition,
      input.installedLegacy,
      input.enabledLegacy,
    )
    if (ownedReview && input.review !== undefined) {
      return evaluateReviewClose(input, input.review, ownedText)
    }
    // Once the run reached its review obligation the refusal budget no longer
    // exists; a pipeline's earlier main steps keep it until then.
    const releaseBlocked = ownedReview && reviewObligationReached(input.run, input.definition)
    if (!releaseBlocked && input.definition.id === 'task-review' && input.run.status !== 'failed') {
      const failed = input.definition.steps.find(
        (step) =>
          step.blockTurnClose === true &&
          input.run.steps.find((entry) => entry.id === step.id)?.state === 'failed',
      )
      if (failed !== undefined) {
        const blocks = blocksForTurn(input.run)
        if (blocks >= input.maxBlocks) {
          const detail = `step "${failed.id}" has a failed dispatch; the close is allowed once as a VIOLATION, never as a pass`
          return {
            kind: 'violation',
            run: markTurn(addViolation(input.run, detail, { step: failed.id, at })),
            detail,
          }
        }
        const text = `step "${failed.id}" has a failed dispatch; retry it with workflows resume before the close`
        input.agent.steer(text)
        return {
          kind: 'refuse',
          hold: true,
          run: markTurn(incrementTurnBlocks(input.run, at)),
          stepId: failed.id,
          text,
        }
      }
    }
    // The maxBlocks budget is per turn: a new turn starts a fresh budget, so a
    // capped run never suppresses the obligation on a later turn.
    // A provisional review ERROR is not coverage once the run reaches its owned
    // review obligation: only the host review resolution (a PASS or a live
    // review) ends it. That decision comes from ownership, never from a local
    // `settings.gate` a definition may omit. Earlier steps and other definitions
    // (the change intake) keep their spec'd intermediate close.
    const provisionalReviews = releaseBlocked ? undefined : input.provisionalReviews
    const step = selectBlockingStep(
      input.run,
      input.definition,
      input.installedLegacy,
      input.enabledLegacy,
      provisionalReviews,
    )
    const ownedRefusal = (text: string): TurnCloseOutcome => {
      const blocks = blocksForTurn(input.run)
      if (!releaseBlocked && blocks >= input.maxBlocks) {
        const detail = `turn close was refused ${String(blocks)} time(s) by an owned workflow rule; the close is allowed once as a VIOLATION, never as a pass`
        const run = markTurn(addViolation(input.run, detail, { at }))
        return { kind: 'violation', run, detail }
      }
      // The owned rule refuses through the same steer the step walk uses; a
      // returned outcome alone does not hold a turn open.
      input.agent.steer(text)
      return {
        kind: 'refuse',
        hold: true,
        run: markTurn(incrementTurnBlocks(budgetRun(input.run), at)),
        stepId: input.definition.steps.at(-1)?.id ?? 'owned-rule',
        text,
      }
    }
    // A terminal run is never revived by a later steer, and a run whose
    // session ended (interrupted) is not steered; the owned completion or
    // checkpoint decision still refuses a terminal run.
    if (
      input.run.status === 'completed' ||
      input.run.status === 'failed' ||
      input.run.status === 'cancelled' ||
      input.run.status === 'interrupted'
    ) {
      if (ownedText !== undefined) return ownedRefusal(ownedText)
      return {
        kind: 'allow',
        run: input.run,
        reason: `run "${input.run.id}" is terminal (${input.run.status}); no steer`,
      }
    }
    if (ownedText !== undefined && step === undefined) {
      return ownedRefusal(ownedText)
    }
    if (step === undefined) {
      return {
        kind: 'allow',
        run: input.run,
        reason: 'no open blockTurnClose step is owned by this engine',
      }
    }
    // A review step is never steered as a main step: without a resolved due-unit
    // status the safe answer is a refusal, not a budget release.
    if (releaseBlocked && step.executor === 'review') {
      const failed = input.run.steps.find((entry) => entry.id === step.id)
      const cause = failed?.reason === undefined ? '' : `: ${failed.reason.slice(0, 300)}`
      if (failed?.state === 'failed' && failed.evidence === undefined) {
        // A failed dispatch (no verdict record) stays the documented resume
        // attempt; the next close also retries it.
        return reviewRefusal(
          input,
          step.id,
          `step "${step.id}" has a failed dispatch${cause}; retry it with workflows resume before the close`,
        )
      }
      const text = `the review step "${step.id}" is ${failed?.state ?? 'open'}${failed?.state === 'failed' ? cause : ''}; the review gate has no refusal budget, so fix the findings if any and retry`
      return reviewRefusal(input, step.id, text)
    }
    const blocks = blocksForTurn(input.run)
    if (!releaseBlocked && blocks >= input.maxBlocks) {
      const soft = step.nonCritical === true
      const detail = `turn close was refused ${String(blocks)} time(s) with step "${step.id}" open; the close is allowed once as a VIOLATION, never as a pass${soft ? `; the optional step settles ${SOFT_SETTLEMENT} and the run keeps no open required step` : ''}`
      let run = markTurn(
        resetStepAttempts(addViolation(input.run, detail, { step: step.id, at }), step.id),
      )
      if (soft) run = releaseSoft(run, step.id, at)
      return { kind: 'violation', run, detail }
    }
    // A failed step cannot be requested again by the step walk, so its cause is
    // steered directly: a returned refusal alone does not hold the turn open.
    const failed = input.run.steps.find((entry) => entry.id === step.id)
    if (failed?.state === 'failed') {
      const cause = failed.reason === undefined ? '' : `: ${failed.reason.slice(0, 300)}`
      const text = `step "${step.id}" is failed${cause}; fix the cause and retry with workflows resume before the close`
      input.agent.steer(text)
      return {
        kind: 'refuse',
        hold: true,
        run: markTurn(incrementTurnBlocks(budgetRun(input.run), at)),
        stepId: step.id,
        text,
      }
    }
    // A new turn also starts a fresh request budget: without this reset the
    // previous turn's attempts would hit the request bound before the fresh
    // maxBlocks budget could steer.
    const steeringRun =
      input.run.turnBlocksTurn === input.turn
        ? input.run
        : resetStepAttempts(budgetRun(input.run), step.id)
    const steered = requestMainStep({
      run: steeringRun,
      definition: input.definition,
      step,
      agent: input.agent,
      evidenceContext: input.evidenceContext,
      turn: input.turn,
      maxAttempts: input.maxBlocks,
      ...(ownedText === undefined ? {} : { note: ownedText }),
      now: at,
    })
    const run = markTurn(incrementTurnBlocks(steered.run, at))
    if (!steered.steered) {
      if (steered.reason.includes('request bound')) {
        if (releaseBlocked) {
          // The review run has no refusal budget: name the bound and keep the
          // obligation open instead of releasing the close.
          const text = `step "${step.id}" reached its request bound; the run contains an owned review step, so the close is not released by a refusal budget. Continue the step and let the next round start the review`
          input.agent.steer(text)
          return {
            kind: 'refuse',
            hold: true,
            run: markTurn(incrementTurnBlocks(steered.run, at)),
            stepId: step.id,
            text,
          }
        }
        const soft = step.nonCritical === true
        const detail = `step "${step.id}" reached its request bound; the close is allowed once as a VIOLATION, never as a pass${soft ? `; the optional step settles ${SOFT_SETTLEMENT}` : ''}`
        const recorded = addViolation(input.run, detail, { step: step.id, at })
        let run = markTurn(resetStepAttempts(recorded, step.id))
        if (soft) run = releaseSoft(run, step.id, at)
        return { kind: 'violation', run, detail }
      }
      // A failed dispatch stays an obligation until the run advances/retries;
      // never let the close pass silently on the failed step.
      if (steered.reason.includes('already failed')) {
        const blocks = blocksForTurn(input.run)
        if (!releaseBlocked && blocks >= input.maxBlocks) {
          const soft = step.nonCritical === true
          const detail = `step "${step.id}" has a failed dispatch; the close is allowed once as a VIOLATION, never as a pass${soft ? `; the optional step settles ${SOFT_SETTLEMENT}` : ''}`
          let released = markTurn(addViolation(input.run, detail, { step: step.id, at }))
          if (soft) released = releaseSoft(released, step.id, at)
          return { kind: 'violation', run: released, detail }
        }
        return {
          kind: 'refuse',
          hold: true,
          run,
          stepId: step.id,
          text: `step "${step.id}" has a failed dispatch; retry it with workflows resume before the close`,
        }
      }
      const message = `step "${step.id}" could not be steered: ${steered.reason}`
      return {
        kind: 'allow',
        run: addViolation(input.run, message, { step: step.id, at }),
        reason: message,
      }
    }
    return { kind: 'refuse', hold: true, run, stepId: step.id, text: steered.text }
  } catch (error) {
    input.onError?.(error)
    const message = `the turn-close gate failed internally and the close is allowed: ${
      error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
    }`
    return {
      kind: 'allow',
      run: addViolation(input.run, message, { at }),
      reason: message,
    }
  }
}

/* ------------------------------------------------------------------ */
/* pre-execute intake gate                                             */
/* ------------------------------------------------------------------ */

export type IntakeGateDecision =
  | { readonly kind: 'allow'; readonly reason: string; readonly runId?: string }
  | {
      readonly kind: 'deny'
      readonly reason: string
      readonly action: 'started' | 'resumed' | 'adopt'
      readonly runId?: string
      readonly stepId?: string
    }

export interface IntakeGateInput {
  readonly name: string
  readonly session: string
  readonly workspace: string
  readonly callId?: string
  /** The matched definition that declares the intake gate. */
  readonly definition: Definition
  /** Every authenticated run in the workspace. */
  readonly runs: readonly WorkflowRun[]
  /** Every verified receipt in the workspace. */
  readonly receipts: readonly WorkflowReceipt[]
  /** Host-owned call ids the gate may dispatch. */
  readonly ownedCallIds: ReadonlySet<string>
  readonly changeExists: boolean
  readonly startRun: (definition: Definition, name: string) => Promise<{ runId: string }>
  readonly resumeRun: (runId: string) => Promise<{ stepId: string }>
}

function intakeName(run: WorkflowRun): string | undefined {
  const name = run.context.name
  return typeof name === 'string' ? name : undefined
}

function isCompletedIntake(run: WorkflowRun, name: string, definitionId: string): boolean {
  return (
    run.definition.id === definitionId && run.status === 'completed' && intakeName(run) === name
  )
}

function isResumableIntake(
  run: WorkflowRun,
  name: string,
  session: string,
  definitionId: string,
): boolean {
  return (
    run.definition.id === definitionId &&
    (run.status === 'interrupted' || run.status === 'blocked') &&
    intakeName(run) === name &&
    run.session === session
  )
}

/**
 * The pre-execute intake gate, in the required order: an authenticated
 * completed run or receipt allows; an owned create-change call allows; a
 * resumable intake resumes and is refused; an existing change directory is
 * redirected to adoption; otherwise the run starts and the call is refused.
 */
export async function evaluateIntakeGate(input: IntakeGateInput): Promise<IntakeGateDecision> {
  const name = input.name
  const definitionId = input.definition.id
  const completed = input.runs.find((run) => isCompletedIntake(run, name, definitionId))
  if (completed !== undefined) {
    return {
      kind: 'allow',
      reason: `the intake run "${completed.id}" is completed`,
      runId: completed.id,
    }
  }
  const receipt = input.receipts.find((entry) => entry.change === name)
  if (receipt !== undefined) {
    return {
      kind: 'allow',
      reason: `the host-authenticated ${receipt.kind} receipt for "${name}" authorizes the call`,
    }
  }
  if (input.callId !== undefined && input.ownedCallIds.has(input.callId)) {
    return { kind: 'allow', reason: 'the call id is owned by the intake run' }
  }
  const running = input.runs.find(
    (run) =>
      run.definition.id === definitionId &&
      run.status === 'running' &&
      run.session === input.session &&
      intakeName(run) === name,
  )
  if (running !== undefined) {
    const pending = running.steps.find((step) => step.state === 'open' || step.state === 'blocked')
    const stepId = pending?.id ?? 'requirements'
    return {
      kind: 'deny',
      action: 'resumed',
      runId: running.id,
      stepId,
      reason: `the intake run "${running.id}" is already in progress; continue at step "${stepId}" and do not create the change`,
    }
  }
  const resumable = input.runs.find((run) =>
    isResumableIntake(run, name, input.session, definitionId),
  )
  if (resumable !== undefined) {
    const resumed = await input.resumeRun(resumable.id)
    return {
      kind: 'deny',
      action: 'resumed',
      runId: resumable.id,
      stepId: resumed.stepId,
      reason: `the interrupted intake run "${resumable.id}" resumed; continue at step "${resumed.stepId}" and do not create the change`,
    }
  }
  if (input.changeExists) {
    return {
      kind: 'deny',
      action: 'adopt',
      reason: `\`openspec/changes/${name}/\` already exists and no resumable intake or authenticated receipt exists; run /workflows adopt ${name} instead`,
    }
  }
  if (!input.definition.steps.some((step) => step.id === 'create-change')) {
    throw new Error(`the "${definitionId}" definition has no create-change step`)
  }
  const started = await input.startRun(input.definition, name)
  const first = input.definition.steps[0]?.id ?? 'requirements'
  return {
    kind: 'deny',
    action: 'started',
    runId: started.runId,
    stepId: first,
    reason: `the intake run "${started.runId}" started; complete step "${first}" and the later steps before creating the change`,
  }
}

/* ------------------------------------------------------------------ */
/* deferred runtime                                                    */
/* ------------------------------------------------------------------ */

export interface DeferredStepInput {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly stepId: string
  readonly installedLegacy: ReadonlySet<string>
  /** `${plugin}/${signal}` entries that would actually steer. */
  readonly enabledLegacy?: ReadonlySet<string>
  /** The existing legacy reader; it never dispatches an executor. */
  readonly readRecord: (step: Step) => Promise<EvidenceCheck>
  readonly now?: number
}

export interface DeferredStepResult {
  readonly run: WorkflowRun
  /** A deferred step never dispatches its declared executor. */
  readonly dispatched: false
  /** A deferred step never steers; the legacy gate is the only steer. */
  readonly steered: false
  readonly stepId: string
}

/**
 * Run one deferred step at runtime. It reads the existing legacy record,
 * updates its own step, and never dispatches its executor or steers. A missing
 * or mismatched record leaves the step open and the run blocked for visibility;
 * the legacy gate alone is still the enforcing path.
 */
export async function runDeferredStep(input: DeferredStepInput): Promise<DeferredStepResult> {
  const at = input.now ?? Date.now()
  const resolved = resolveOwnership(input.definition, input.installedLegacy, input.enabledLegacy)
  const ownership = resolved.steps.find((step) => step.id === input.stepId)
  const step = input.definition.steps.find((entry) => entry.id === input.stepId)
  if (step === undefined) throw new Error(`the definition has no step "${input.stepId}"`)
  if (ownership === undefined || ownership.ownership !== 'defer') {
    throw new Error(`step "${input.stepId}" is not deferred; an owned step must run its executor`)
  }
  if (ownership.legacy === undefined) {
    return {
      run: setRunStatus(
        settleStep(input.run, input.stepId, 'blocked', {
          at,
          reason: 'the deferred step declares no legacy source',
        }),
        'blocked',
        at,
      ),
      dispatched: false,
      steered: false,
      stepId: input.stepId,
    }
  }
  const signalEnabled =
    input.enabledLegacy === undefined
      ? input.installedLegacy.has(ownership.legacy.plugin)
      : input.enabledLegacy.has(`${ownership.legacy.plugin}/${ownership.legacy.signal}`)
  if (!signalEnabled) {
    return {
      run: setRunStatus(
        settleStep(input.run, input.stepId, 'blocked', {
          at,
          reason: `the legacy source "${ownership.legacy.plugin}/${ownership.legacy.signal}" is not enabled; the retire-legacy-gates change owns the transition`,
        }),
        'blocked',
        at,
      ),
      dispatched: false,
      steered: false,
      stepId: input.stepId,
    }
  }
  let check: EvidenceCheck
  try {
    check = await input.readRecord(step)
  } catch (error) {
    return {
      run: setRunStatus(
        settleStep(input.run, input.stepId, 'blocked', {
          at,
          reason: `the legacy record could not be read: ${
            error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)
          }`,
        }),
        'blocked',
        at,
      ),
      dispatched: false,
      steered: false,
      stepId: input.stepId,
    }
  }
  if (!check.ok) {
    return {
      run: setRunStatus(
        settleStep(input.run, input.stepId, 'blocked', {
          at,
          reason: `waiting for the legacy gate: ${check.failure.reason} (${check.failure.detail.slice(0, 200)})`,
        }),
        'blocked',
        at,
      ),
      dispatched: false,
      steered: false,
      stepId: input.stepId,
    }
  }
  return {
    run: settleStep(input.run, input.stepId, 'done', { at, evidence: check.evidence }),
    dispatched: false,
    steered: false,
    stepId: input.stepId,
  }
}

/* ------------------------------------------------------------------ */
/* authorization write guard                                           */
/* ------------------------------------------------------------------ */

/** The write tools the guard recognizes; a shell write is the stated bypass. */
const WRITE_TOOLS = new Set(['write', 'edit'])

/** The host-owned directories and store a model write may never target. */
export const PROTECTED_WRITE_PREFIXES = [
  '.dsh/workflows/definitions/',
  '.dsh/workflows/approved.json',
  '.dsh/workflows/receipts/',
  '.dsh/workflows/runs/',
] as const

export interface FileWriteIntent {
  readonly tool: string
  /** Every non-empty path-like argument the tool may consume. */
  readonly paths: readonly string[]
  /** Two different targets are named; the guard must not guess which is written. */
  readonly conflict: boolean
}

/** The file-write intent of one tool execution, when it is a recognized write. */
export function recognizeFileWrite(exec: {
  readonly name: string
  readonly arguments?: unknown
}): FileWriteIntent | undefined {
  if (!WRITE_TOOLS.has(exec.name)) return undefined
  if (typeof exec.arguments !== 'object' || exec.arguments === null) return undefined
  const args = exec.arguments as Record<string, unknown>
  const paths = [args.path, args.file_path].filter(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  )
  if (paths.length === 0) return undefined
  return { tool: exec.name, paths, conflict: paths.some((path) => path !== paths[0]) }
}

/** Normalize a model path into a workspace-relative slash path, or refuse it. */
function workspaceRelativePath(workspace: string, path: string): string | undefined {
  const normalized = path.replaceAll('\\', '/')
  // A drive-relative target (D:foo) resolves against that drive's current
  // directory and a UNC or extended-length prefix names another namespace;
  // neither can be compared safely with the workspace prefixes, so refuse them.
  if (/^[A-Za-z]:(?!\/)/u.test(normalized) || normalized.startsWith('//')) return undefined
  // On Windows a colon also qualifies an NTFS directory stream; `.dsh::$INDEX_ALLOCATION`
  // names the same directory, so only a leading drive designator may keep one.
  // A component ending in a dot or space is stripped by Win32 and aliases the
  // real name; an 8.3 short name (DSH~1) aliases it too, so both are refused.
  if (process.platform === 'win32') {
    const rest = normalized.replace(/^[A-Za-z]:\//u, '')
    if (
      rest.includes(':') ||
      rest
        .split('/')
        .some(
          (part) =>
            part !== '' &&
            part !== '.' &&
            part !== '..' &&
            (part.endsWith('.') || part.endsWith(' ') || /~\d/u.test(part)),
        )
    ) {
      return undefined
    }
  }
  const absolute =
    isAbsolute(normalized) || normalized.startsWith('/') || /^[A-Za-z]:\//u.test(normalized)
  if (absolute) {
    // An absolute target inside the workspace is the same file as its relative
    // form; one outside is not this guard's store.
    const root = resolve(workspace)
    const relativePath = relative(root, resolve(root, normalized)).replaceAll('\\', '/')
    if (relativePath === '' || relativePath === '..' || relativePath.startsWith('../')) {
      return relativePath === '' ? '' : normalized
    }
    return relativePath
  }
  const parts: string[] = []
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

/** The path comparison follows the filesystem's case semantics. */
function foldPath(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

function isProtectedWritePath(relative: string): boolean {
  const folded = foldPath(relative)
  return PROTECTED_WRITE_PREFIXES.some((prefix) => {
    const expected = foldPath(prefix)
    return folded === expected || folded.startsWith(expected)
  })
}

export interface AuthorizationWriteInput {
  readonly workspace: string
  readonly exec: { readonly name: string; readonly arguments?: unknown }
  /** The host-owned call ids; only their writes may reach the protected paths. */
  readonly ownedCallIds: ReadonlySet<string>
  readonly callId?: string
}

/**
 * The pre-execute authorization write guard. A model-originated write to a
 * definition, the approval store, a receipt, or a run file is refused; an
 * owned host call is allowed. Returns undefined when the call is untouched.
 */
export function authorizationWriteDecision(
  input: AuthorizationWriteInput,
): { readonly kind: 'allow' } | { readonly kind: 'deny'; readonly reason: string } | undefined {
  const intent = recognizeFileWrite(input.exec)
  if (intent === undefined) return undefined
  if (input.callId !== undefined && input.ownedCallIds.has(input.callId)) {
    return { kind: 'allow' }
  }
  if (intent.conflict) {
    return {
      kind: 'deny',
      reason:
        'the write call names conflicting "path" and "file_path" targets; nothing was written',
    }
  }
  const relative = workspaceRelativePath(input.workspace, intent.paths[0] ?? '')
  if (relative === undefined) {
    return {
      kind: 'deny',
      reason: `the write target "${intent.paths[0] ?? ''}" escapes the workspace; nothing was written`,
    }
  }
  if (!isProtectedWritePath(relative)) return undefined
  return {
    kind: 'deny',
    reason: `the model cannot write "${relative}"; definitions are installed with /workflows install <path>, and approvals and receipts are written only by the host`,
  }
}

/* ------------------------------------------------------------------ */
/* pre-execute archive gate                                            */
/* ------------------------------------------------------------------ */

export interface ArchiveGateInput {
  readonly change: string
  /** Whether a run file failed authentication; a tampered store fails closed. */
  readonly tamperedRuns?: boolean
  /** Every authenticated run in the workspace. */
  readonly runs: readonly WorkflowRun[]
  /** Every verified receipt in the workspace. */
  readonly receipts: readonly WorkflowReceipt[]
  /** The whole-spec `PASS` record, already verified against the current digest. */
  readonly specRecord: EvidenceCheck
  /**
   * The change artifact eligibility — a delta spec or `skip_specs: true` —
   * rechecked after the record. A change with neither is never archivable.
   */
  readonly specEligibility?: EvidenceCheck
  /** The owned per-task portable PASS coverage, computed from the workspace. */
  readonly taskReview?: { readonly ok: boolean; readonly text?: string }
  /**
   * The required integration review once the task list is complete: its current
   * PASS is missing or stale. Absent when the list is incomplete or the review
   * is deferred to a legacy source; the user-clicked archive never reaches here.
   */
  readonly integrationReview?: { readonly ok: boolean; readonly text?: string }
}

export type ArchiveGateDecision =
  | { readonly kind: 'allow'; readonly reason: string }
  | { readonly kind: 'deny'; readonly reason: string }

function openRequiredStep(run: WorkflowRun): { step: string } | undefined {
  const step = run.steps.find(
    (entry) => entry.state === 'open' || entry.state === 'blocked' || entry.state === 'failed',
  )
  return step === undefined ? undefined : { step: step.id }
}

/**
 * The archive gate. It refuses while a related run has an open required step,
 * no authenticated completed intake run and no verified receipt exist, or the
 * current whole-spec PASS record is missing or stale. A text claim is never an
 * input; only the authenticated run, receipt, and record can allow.
 */
export function evaluateArchiveGate(input: ArchiveGateInput): ArchiveGateDecision {
  if (input.tamperedRuns === true) {
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: a workflow run file failed authentication; fix or remove it before archiving`,
    }
  }
  const related = input.runs.filter(
    (run) => run.status !== 'cancelled' && intakeName(run) === input.change,
  )
  const blocked = related
    .map((run) => ({ run, open: openRequiredStep(run) }))
    .find((entry) => entry.open !== undefined)
  if (blocked !== undefined && blocked.open !== undefined) {
    const coverage =
      input.taskReview !== undefined && !input.taskReview.ok
        ? `; ${input.taskReview.text ?? 'a checked task has no portable task-review PASS'}`
        : ''
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: run "${blocked.run.id}" step "${blocked.open.step}" is open and has no verified evidence${coverage}`,
    }
  }
  const completed = related.find((run) => isCompletedIntake(run, input.change, 'change-intake'))
  const receipt = input.receipts.find((entry) => entry.change === input.change)
  if (completed === undefined && receipt === undefined) {
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: no authenticated completed change-intake run and no authenticated receipt exists; complete the intake or run /workflows adopt ${input.change}`,
    }
  }
  if (!input.specRecord.ok || (input.specEligibility !== undefined && !input.specEligibility.ok)) {
    const parts: string[] = []
    if (!input.specRecord.ok) {
      parts.push(
        `the current whole-spec PASS record is ${
          input.specRecord.failure.reason === 'missing-file' ? 'missing' : 'stale or invalid'
        } (${input.specRecord.failure.detail.slice(0, 200)})`,
      )
    }
    if (input.specEligibility !== undefined && !input.specEligibility.ok) {
      parts.push(
        `the change artifact set is not eligible (${input.specEligibility.failure.detail.slice(0, 200)})`,
      )
    }
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: ${parts.join('; ')}`,
    }
  }
  if (input.taskReview !== undefined && !input.taskReview.ok) {
    const relatedRun = related.find((run) => run.definition.id === 'task-review')
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: ${input.taskReview.text ?? 'a checked task has no portable task-review PASS'}${relatedRun === undefined ? '' : ` (related review run "${relatedRun.id}")`}`,
    }
  }
  if (input.integrationReview !== undefined && !input.integrationReview.ok) {
    const relatedRun = related.find((run) => run.definition.id === 'integration-review')
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: ${input.integrationReview.text ?? 'the task list is complete and the current integration-review PASS is missing or stale'}${relatedRun === undefined ? '' : ` (related review run "${relatedRun.id}")`}`,
    }
  }
  return {
    kind: 'allow',
    reason: `the archive of "${input.change}" is allowed: the authenticated intake ${
      completed === undefined ? 'receipt' : 'run'
    } and the current whole-spec PASS record are present`,
  }
}

/** Parity-facing progress decision shared with the engine-owned gate. */
export interface ProgressParityInput {
  readonly codeChanged: boolean
  readonly tickedReviewed: boolean
  readonly note?: { readonly digest?: string; readonly currentDigest?: string }
}

export interface ParityGateDecision {
  readonly decision: 'allow' | 'refuse'
  readonly reason: string
}

export function evaluateProgressParity(input: ProgressParityInput): ParityGateDecision {
  if (!input.codeChanged)
    return { decision: 'allow', reason: 'the turn changed no implementation file' }
  if (input.tickedReviewed) {
    return { decision: 'allow', reason: 'the turn ticked a task with an owned PASS record' }
  }
  if (input.note !== undefined && input.note.digest === input.note.currentDigest) {
    return { decision: 'allow', reason: 'a progress note matches the current worktree digest' }
  }
  return {
    decision: 'refuse',
    reason: 'the turn changed implementation files without a reviewed tick or a current note',
  }
}

/** Parity-facing lane decision shared with the engine-owned gate. */
export interface LaneParityInput {
  readonly plan: string
  readonly ticked: readonly string[]
  readonly assigned: readonly string[]
  readonly implementationChanged: boolean
}

/** One lane the lane gate reports, with its owned paths and plan position. */
export interface LaneParityLane {
  readonly n: number
  readonly title: string
  readonly owned: readonly string[]
}

export function evaluateLaneParity(
  input: LaneParityInput,
): ParityGateDecision & { readonly lanes?: readonly LaneParityLane[] } {
  const lanes = taskLanes(input.plan)
  const parallel = lanes.filter(
    (lane) => !lane.serial && lane.checked.length + lane.unchecked.length > 0,
  )
  const ticked = new Set(input.ticked)
  const current = new Set(
    parallel
      .filter((lane) => [...lane.checked, ...lane.unchecked].some((number) => ticked.has(number)))
      .map((lane) => lane.title),
  )
  const unassigned = parallel.filter(
    (lane) =>
      lane.unchecked.length > 0 && !current.has(lane.title) && !input.assigned.includes(lane.title),
  )
  if (
    parallel.length >= 2 &&
    unassigned.length > 0 &&
    unassigned.every((lane) => lane.owned.length > 0) &&
    (ticked.size > 0 || input.implementationChanged)
  ) {
    return {
      decision: 'refuse',
      reason: `unassigned lanes: ${unassigned.map((lane) => lane.title).join(', ')}`,
      lanes: unassigned.map((lane) => ({ n: lane.n, title: lane.title, owned: lane.owned })),
    }
  }
  return { decision: 'allow', reason: 'no unassigned non-serial lane is actionable' }
}
