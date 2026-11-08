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
  runToolStep,
  type ToolRunner,
} from './executors.js'
import { runDeferredStep } from './gates.js'
import type { HostAuth } from './host-auth.js'
import { issueCompletionReceipt } from './receipts.js'
import { setRunStatus, settleStep, type WorkflowRun, writeRun } from './runs.js'

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
  readonly questions?: HumanQuestionService
  /** The deferred-step record reader; it must not call delegate. */
  readonly readRecord?: (step: Step) => Promise<EvidenceCheck>
  readonly installedLegacy: ReadonlySet<string>
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

function pendingStep(run: WorkflowRun, definition: Definition): Step | undefined {
  for (const step of definition.steps) {
    const state = run.steps.find((entry) => entry.id === step.id)?.state
    if (state === 'open' || state === 'blocked') return step
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

/**
 * Advance the intake as far as the currently verified evidence allows. It never
 * marks a step done from text; a missing artifact or a non-zero check stops the
 * walk with the step open and names the contract and paths.
 */
export async function advanceIntake(input: IntakeAdvanceInput): Promise<IntakeAdvanceResult> {
  const at = input.now ?? Date.now()
  let run = input.run
  const resolved = resolveOwnership(input.definition, input.installedLegacy)
  for (let guard = 0; guard < input.definition.steps.length + 1; guard += 1) {
    const step = pendingStep(run, input.definition)
    if (step === undefined) {
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
      const alreadyDispatched = current?.state === 'done'
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
          return { run, completed: false, waiting: waitingFor(step, input.evidenceContext) }
        }
      }
      const check = await verifyEvidence(
        step.evidence ?? { kind: 'declaration' },
        input.evidenceContext,
      )
      if (!check.ok) {
        return {
          run: setRunStatus(run, 'blocked', at),
          completed: false,
          waiting: waitingFor(step, input.evidenceContext),
        }
      }
      run = settleStep(run, step.id, 'done', { at, evidence: check.evidence })
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
