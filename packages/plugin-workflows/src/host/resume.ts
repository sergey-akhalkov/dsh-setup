import type { HostAuth } from './host-auth.js'
import {
  listAuthenticatedRuns,
  readAuthenticatedRun,
  setRunStatus,
  settleStep,
  type WorkflowRun,
  writeRun,
} from './runs.js'

/**
 * Startup recovery and resume-by-run-id. An unfinished run from a previous
 * process is interrupted, never auto-completed; resume re-evaluates only its
 * pending step from authenticated durable state and never starts a second run
 * or recreates a change directory.
 */

export const INTERRUPTED_REASON = 'the host process ended while this run was unfinished'

export interface RecoverResult {
  readonly recovered: readonly string[]
  /** Runs that were unsigned or already terminal; left untouched. */
  readonly skipped: readonly string[]
}

/** Mark every authenticated running or blocked run as interrupted. */
export async function recoverRuns(
  workspace: string,
  auth: HostAuth,
  now = Date.now(),
): Promise<RecoverResult> {
  const recovered: string[] = []
  const skipped: string[] = []
  for (const run of await listAuthenticatedRuns(workspace, auth)) {
    if (run.status !== 'running' && run.status !== 'blocked') {
      skipped.push(run.id)
      continue
    }
    const interrupted = setRunStatus(run, 'interrupted', now, INTERRUPTED_REASON)
    await writeRun(workspace, interrupted, auth)
    recovered.push(run.id)
  }
  return { recovered, skipped }
}

/** The first step still open or blocked; the step resume re-evaluates. */
export function pendingStep(run: WorkflowRun): string | undefined {
  if (run.branchPath !== undefined && run.branchPath.length > 0) {
    for (const id of run.branchPath) {
      const step = run.steps.find((entry) => entry.id === id)
      if (step !== undefined && (step.state === 'open' || step.state === 'blocked')) {
        return step.id
      }
    }
  }
  if (run.nextStep !== undefined) {
    const selected = run.steps.find(
      (step) => step.id === run.nextStep && (step.state === 'open' || step.state === 'blocked'),
    )
    if (selected !== undefined) return selected.id
  }
  return run.steps.find((step) => step.state === 'open' || step.state === 'blocked')?.id
}

export interface ResumeResult {
  readonly run: WorkflowRun
  readonly stepId: string
}

/**
 * Resume one interrupted, blocked, or failed run at its pending step. A
 * completed, cancelled, or running run is refused.
 */
export async function resumeRun(
  workspace: string,
  runId: string,
  auth: HostAuth,
  now = Date.now(),
  session?: string,
): Promise<ResumeResult> {
  const run = await readAuthenticatedRun(workspace, runId, auth)
  if (run !== undefined && session !== undefined && run.session !== session) {
    throw new Error(
      `run "${runId}" belongs to session "${run.session}"; session "${session}" cannot resume it`,
    )
  }
  if (run === undefined) {
    throw new Error(`run "${runId}" is unsigned, modified, or unreadable; it cannot be resumed`)
  }
  if (run.status !== 'interrupted' && run.status !== 'blocked' && run.status !== 'failed') {
    throw new Error(
      `run "${runId}" is ${run.status}; only an interrupted, blocked, or failed run can be resumed`,
    )
  }
  // A failed step is reopened without its old failure evidence so the pending
  // step names the work the resume retries.
  const reopened: WorkflowRun = {
    ...run,
    steps: run.steps.map((step) =>
      step.state === 'failed' ? { id: step.id, state: 'open' as const, attempts: 0 } : step,
    ),
  }
  const stepId = pendingStep(reopened)
  if (stepId === undefined) {
    throw new Error(`run "${runId}" has no pending step; cancel it instead of resuming`)
  }
  let resumed = settleStep(reopened, stepId, 'open', { at: now })
  resumed = setRunStatus(resumed, 'running', now)
  await writeRun(workspace, resumed, auth)
  return { run: resumed, stepId }
}

/** Cancel one open run; an open or blocked step is recorded as cancelled. */
export async function cancelRun(
  workspace: string,
  runId: string,
  auth: HostAuth,
  now = Date.now(),
  session?: string,
): Promise<WorkflowRun> {
  const run = await readAuthenticatedRun(workspace, runId, auth)
  if (run !== undefined && session !== undefined && run.session !== session) {
    throw new Error(
      `run "${runId}" belongs to session "${run.session}"; session "${session}" cannot cancel it`,
    )
  }
  if (run === undefined) {
    throw new Error(`run "${runId}" is unsigned, modified, or unreadable; it cannot be cancelled`)
  }
  // A completed run is authorization evidence and stays; a failed run is
  // terminal but still counts as a related run for the archive gate, so
  // clearing it is the documented recovery path for a change it dead-locked.
  if (run.status === 'completed' || run.status === 'cancelled') {
    throw new Error(`run "${runId}" is ${run.status}; it is not cancelable`)
  }
  const stepId = pendingStep(run)
  let cancelled = run
  if (stepId !== undefined) {
    cancelled = settleStep(cancelled, stepId, 'cancelled', {
      at: now,
      reason: 'the user cancelled the run',
    })
  }
  cancelled = setRunStatus(cancelled, 'cancelled', now)
  await writeRun(workspace, cancelled, auth)
  return cancelled
}
