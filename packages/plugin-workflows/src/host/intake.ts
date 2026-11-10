import { CHANGE_NAME } from './command-parse.js'
import { type Definition, resolveOwnership, type Step } from './definitions.js'
import {
  collectEvidencePaths,
  describeEvidence,
  type EvidenceCheck,
  type EvidenceContext,
  verifyEvidence,
} from './evidence.js'
import {
  type HumanQuestionService,
  type OwnedCalls,
  runHumanStep,
  runSubagentStep,
  runToolStep,
  type SubagentRunner,
  type ToolRunner,
} from './executors.js'
import { runDeferredStep } from './gates.js'
import type { HostAuth } from './host-auth.js'
import { issueCompletionReceipt } from './receipts.js'
import {
  MAX_TOOL_STEP_ATTEMPTS,
  setRunStatus,
  settleStep,
  type WorkflowRun,
  writeRun,
} from './runs.js'
import { checkedTaskIdsOf } from './tasks.js'

/**
 * The intake runner. It walks the declared steps in order, completes a main
 * step only through the evidence verifier, completes `create-change` only from
 * its owned tool call plus `.openspec.yaml`, reads the deferred `spec-review`
 * record without dispatching `delegate`, and asks the user only at `approval`.
 */

export interface IntakeAdvanceInput {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly values: Readonly<Record<string, unknown>>
  readonly evidenceContext: EvidenceContext
  readonly owned: OwnedCalls
  readonly toolRunner?: ToolRunner
  readonly subagentRunner?: SubagentRunner
  readonly questions?: HumanQuestionService
  /** The deferred-step record reader; it must not call delegate. */
  readonly readRecord?: (step: Step) => Promise<EvidenceCheck>
  readonly installedLegacy: ReadonlySet<string>
  /** `${plugin}/${signal}` entries that would actually steer. */
  readonly enabledLegacy?: ReadonlySet<string>
  /** When present, a completed intake writes its host-authenticated receipt. */
  readonly auth?: HostAuth
  readonly now?: number
  readonly signal?: AbortSignal
}

export interface IntakeWaiting {
  readonly stepId: string
  readonly title: string
  readonly contract: string
  readonly paths: readonly string[]
}

export interface IntakeAdvanceResult {
  readonly run: WorkflowRun
  readonly completed: boolean
  readonly waiting?: IntakeWaiting
  /** A completion receipt could not be issued; the run is still completed. */
  readonly receiptError?: string
}

/** The first step that is not done, with its state; failed steps stop the walk. */
function firstPending(
  run: WorkflowRun,
  definition: Definition,
): { readonly step: Step; readonly state: string } | undefined {
  for (const step of definition.steps) {
    const state = run.steps.find((entry) => entry.id === step.id)?.state
    if (state !== 'done') return { step, state: state ?? 'missing' }
  }
  return undefined
}

function waitingFor(step: Step, context: EvidenceContext): IntakeWaiting {
  return {
    stepId: step.id,
    title: step.title,
    contract: step.evidence === undefined ? 'none' : describeEvidence(step.evidence, context),
    paths: step.evidence === undefined ? [] : collectEvidencePaths(step.evidence, context),
  }
}

/** The bounded reason for a task-review dispatch that exhausted its attempts. */
function dispatchExhaustedReason(run: WorkflowRun, stepId: string): string {
  const failed = run.steps.find((entry) => entry.id === stepId)
  const attempts = failed?.attempts ?? 0
  return `the review dispatch failed ${String(attempts)} time(s); resume or cancel the run${
    failed?.reason === undefined ? '' : ` (${failed.reason.slice(0, 160)})`
  }`
}

/**
 * Advance the intake as far as the currently verified evidence allows. It never
 * marks a step done from text; a missing artifact or a non-zero check stops the
 * walk with the step open and names the contract and paths.
 */
export async function advanceIntake(input: IntakeAdvanceInput): Promise<IntakeAdvanceResult> {
  const at = input.now ?? Date.now()
  let run = input.run
  const resolved = resolveOwnership(input.definition, input.installedLegacy, input.enabledLegacy)
  for (let guard = 0; guard < input.definition.steps.length + 1; guard += 1) {
    const pending = firstPending(run, input.definition)
    // Only a fully done definition completes; a failed or cancelled step stops
    // the walk instead of being skipped.
    if (pending === undefined) {
      const completedRun = run.status === 'completed' ? run : setRunStatus(run, 'completed', at)
      if (input.auth !== undefined && input.definition.id === 'change-intake') {
        const name = run.context.name
        const digest = run.steps.find((entry) => entry.id === 'spec-review')?.evidence?.digest
        if (typeof name === 'string' && CHANGE_NAME.test(name) && typeof digest === 'string') {
          try {
            if (completedRun !== run) {
              await writeRun(input.evidenceContext.workspace, completedRun, input.auth)
            }
            await issueCompletionReceipt(
              input.evidenceContext.workspace,
              completedRun.id,
              digest,
              input.auth,
              at,
            )
            return { run: completedRun, completed: true }
          } catch (error) {
            return {
              run: completedRun,
              completed: true,
              receiptError:
                error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
            }
          }
        }
      }
      return { run: completedRun, completed: true }
    }
    // A task-review obligation whose checked task disappeared is superseded
    // before any step runs, including a run already waiting at await-review.
    if (input.definition.id === 'task-review') {
      const name = run.context.name
      const taskId = run.context.taskId
      if (typeof name === 'string' && typeof taskId === 'string') {
        const checked = checkedTaskIdsOf(input.evidenceContext.workspace, name)
        if (checked === undefined || !checked.includes(taskId)) {
          const reason =
            checked === undefined
              ? `openspec/changes/${name}/tasks.md is unreadable; the run is superseded`
              : `the checked task ${taskId} is no longer present in openspec/changes/${name}/tasks.md; the run is superseded`
          return {
            run: setRunStatus(
              settleStep(run, pending.step.id, 'cancelled', { at, reason }),
              'cancelled',
              at,
              reason,
            ),
            completed: false,
          }
        }
      }
    }
    if (
      pending.state === 'failed' &&
      pending.step.executor === 'tool' &&
      input.definition.id === 'task-review'
    ) {
      const failed = run.steps.find((entry) => entry.id === pending.step.id)
      const attempts = failed?.attempts ?? 0
      // After the bounded attempts the dispatch is terminal: the run stops
      // driving the close and resume/cancel is the documented recovery.
      if (attempts >= MAX_TOOL_STEP_ATTEMPTS) {
        return {
          run: setRunStatus(run, 'failed', at, dispatchExhaustedReason(run, pending.step.id)),
          completed: false,
        }
      }
      // A rejected dispatch stays retryable: reset the tool step so the next
      // close dispatches it again instead of closing without the obligation.
      run = {
        ...run,
        steps: run.steps.map((entry) =>
          entry.id === pending.step.id
            ? { ...entry, state: 'open', evidence: undefined, reason: undefined }
            : entry,
        ),
      }
    } else if (
      pending.state === 'failed' ||
      pending.state === 'cancelled' ||
      pending.state === 'missing'
    ) {
      return { run, completed: false }
    }
    const step = pending.step
    const ownership = resolved.steps.find((entry) => entry.id === step.id)?.ownership ?? 'own'
    if (ownership === 'defer') {
      if (input.readRecord === undefined) {
        return {
          run: setRunStatus(run, 'blocked', at),
          completed: false,
          waiting: waitingFor(step, input.evidenceContext),
        }
      }
      const deferred = await runDeferredStep({
        run,
        definition: input.definition,
        stepId: step.id,
        installedLegacy: input.installedLegacy,
        ...(input.enabledLegacy === undefined ? {} : { enabledLegacy: input.enabledLegacy }),
        readRecord: input.readRecord,
        now: at,
      })
      run = deferred.run
      if (run.steps.find((entry) => entry.id === step.id)?.state !== 'done') {
        return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) }
      }
      continue
    }
    if (step.executor === 'main') {
      const check = await verifyEvidence(
        step.evidence ?? { kind: 'declaration' },
        input.evidenceContext,
      )
      if (!check.ok)
        return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) }
      run = settleStep(run, step.id, 'done', { at, evidence: check.evidence })
      continue
    }
    if (step.executor === 'tool') {
      const current = run.steps.find((entry) => entry.id === step.id)
      // Task-review: a matching PASS/ERROR record settles the start step
      // without dispatching delegate again.
      if (input.definition.id === 'task-review' && step.id === 'start-review') {
        const name = run.context.name
        const taskId = run.context.taskId
        if (typeof name === 'string' && typeof taskId === 'string') {
          const reviewStep = input.definition.steps.find((entry) => entry.id === 'await-review')
          if (reviewStep?.evidence !== undefined) {
            const reused = await verifyEvidence(reviewStep.evidence, input.evidenceContext)
            if (reused.ok) {
              run = settleStep(run, step.id, 'done', { at, evidence: reused.evidence })
              continue
            }
          }
        }
      }
      // A dispatch already happened when the step still carries its tool
      // evidence; the missing file is rechecked without dispatching again.
      const alreadyDispatched = current?.state === 'done' || current?.evidence?.kind === 'tool'
      if (!alreadyDispatched) {
        if (input.toolRunner === undefined) {
          return {
            run: setRunStatus(run, 'blocked', at),
            completed: false,
            waiting: waitingFor(step, input.evidenceContext),
          }
        }
        run = await runToolStep({
          run,
          definition: input.definition,
          step,
          runner: input.toolRunner,
          owned: input.owned,
          evidenceContext: input.evidenceContext,
          now: at,
          ...(input.signal === undefined ? {} : { signal: input.signal }),
        })
        if (run.steps.find((entry) => entry.id === step.id)?.state !== 'done') {
          // A failed dispatch is a blocking obligation only for the owned
          // review retry; other workflows keep their terminal failure.
          if (input.definition.id !== 'task-review') {
            return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) }
          }
          const failed = run.steps.find((entry) => entry.id === step.id)
          const attempts = failed?.attempts ?? 0
          return {
            // The third failure is terminal immediately; no extra advance is
            // needed to stop the dispatch-specific refusal.
            run:
              attempts >= MAX_TOOL_STEP_ATTEMPTS
                ? setRunStatus(run, 'failed', at, dispatchExhaustedReason(run, step.id))
                : setRunStatus(run, 'blocked', at),
            completed: false,
            waiting: waitingFor(step, input.evidenceContext),
          }
        }
      }
      const check = await verifyEvidence(
        step.evidence ?? { kind: 'declaration' },
        input.evidenceContext,
      )
      if (!check.ok) {
        // The owned call alone is not the contract: keep the step open with
        // its dispatch evidence so the next advance rechecks the missing file.
        const dispatched = run.steps.find((entry) => entry.id === step.id)?.evidence
        return {
          run: setRunStatus(
            dispatched === undefined
              ? run
              : settleStep(run, step.id, 'open', { at, evidence: dispatched }),
            'blocked',
            at,
          ),
          completed: false,
          waiting: waitingFor(step, input.evidenceContext),
        }
      }
      run = settleStep(run, step.id, 'done', { at, evidence: check.evidence })
      continue
    }
    if (step.executor === 'subagent') {
      if (input.subagentRunner === undefined) {
        return {
          run: setRunStatus(run, 'blocked', at),
          completed: false,
          waiting: waitingFor(step, input.evidenceContext),
        }
      }
      run = await runSubagentStep({
        run,
        definition: input.definition,
        step,
        runner: input.subagentRunner,
        evidenceContext: input.evidenceContext,
        now: at,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      })
      if (run.steps.find((entry) => entry.id === step.id)?.state !== 'done') {
        return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) }
      }
      continue
    }
    if (step.executor === 'human') {
      if (input.questions === undefined) {
        return {
          run: setRunStatus(run, 'blocked', at),
          completed: false,
          waiting: waitingFor(step, input.evidenceContext),
        }
      }
      run = await runHumanStep({
        run,
        step,
        questions: input.questions,
        evidenceContext: input.evidenceContext,
        now: at,
      })
      if (run.steps.find((entry) => entry.id === step.id)?.state !== 'done') {
        return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) }
      }
      continue
    }
    return { run: setRunStatus(run, 'failed', at), completed: false }
  }
  return {
    run: setRunStatus(run, 'failed', at),
    completed: false,
  }
}
