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
  resetTurnBlocks,
  setRunStatus,
  settleStep,
  type WorkflowRun,
} from './runs.js'
import type { SteerTarget } from './steer.js'

/**
 * The turn-close gate. It refuses a root turn close while the run has an open
 * `blockTurnClose` step that this engine owns; a deferred step never steers.
 * The refusal is bounded by `maxBlocks`; after the cap the close is allowed
 * exactly once and recorded as a visible VIOLATION, not a pass. An internal
 * error fails open so a plugin fault can never trap a turn.
 */

export type TurnCloseOutcome =
  | { readonly kind: 'allow'; readonly run: WorkflowRun; readonly reason: string }
  | {
      readonly kind: 'refuse'
      readonly run: WorkflowRun
      readonly stepId: string
      readonly text: string
    }
  | { readonly kind: 'violation'; readonly run: WorkflowRun; readonly detail: string }

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
  readonly now?: number
  readonly onError?: (error: unknown) => void
}

function stepIsOpen(run: WorkflowRun, stepId: string): boolean {
  const state = run.steps.find((step) => step.id === stepId)?.state
  return state === 'open' || state === 'blocked'
}

/**
 * The first open `blockTurnClose` owned step, unless an earlier open step is
 * deferred: an unresolved deferred prerequisite stops the selection no matter
 * whether it blocks the turn close itself, because the legacy gate is the only
 * steer for it.
 */
export function selectBlockingStep(
  run: WorkflowRun,
  definition: Definition,
  installedLegacy: ReadonlySet<string>,
  enabledLegacy?: ReadonlySet<string>,
): Step | undefined {
  const resolved = resolveOwnership(definition, installedLegacy, enabledLegacy)
  const ownership = new Map(resolved.steps.map((step) => [step.id, step.ownership]))
  for (const step of definition.steps) {
    if (!stepIsOpen(run, step.id)) continue
    if (ownership.get(step.id) === 'defer') return undefined
    if (step.blockTurnClose === true) return step
  }
  return undefined
}

/** Evaluate one root turn stop. */
export function evaluateTurnClose(input: TurnCloseInput): TurnCloseOutcome {
  const at = input.now ?? Date.now()
  try {
    if (input.origin === 'subagent') {
      return { kind: 'allow', run: input.run, reason: 'a subagent turn is exempt' }
    }
    // A failed task-review dispatch is an unresolved obligation: it must not
    // let the run terminal-allow before the review retry path is used.
    if (input.definition.id === 'task-review') {
      const failed = input.definition.steps.find(
        (step) =>
          step.blockTurnClose === true &&
          input.run.steps.find((entry) => entry.id === step.id)?.state === 'failed',
      )
      if (failed !== undefined) {
        const blocks = input.run.turnBlocks ?? 0
        if (blocks >= input.maxBlocks) {
          const detail = `step "${failed.id}" has a failed dispatch; the close is allowed once as a VIOLATION, never as a pass`
          return {
            kind: 'violation',
            run: resetTurnBlocks(addViolation(input.run, detail, { step: failed.id, at }), at),
            detail,
          }
        }
        const text = `step "${failed.id}" has a failed dispatch; retry it before the close`
        input.agent.steer(text)
        return {
          kind: 'refuse',
          run: incrementTurnBlocks(input.run, at),
          stepId: failed.id,
          text,
        }
      }
    }
    // A terminal run is never revived by a later steer.
    if (
      input.run.status === 'completed' ||
      input.run.status === 'failed' ||
      input.run.status === 'cancelled'
    ) {
      return {
        kind: 'allow',
        run: input.run,
        reason: `run "${input.run.id}" is terminal (${input.run.status}); no steer`,
      }
    }
    const step = selectBlockingStep(
      input.run,
      input.definition,
      input.installedLegacy,
      input.enabledLegacy,
    )
    // A host-computed owned decision (completion coverage or the checkpoint
    // remedy/age rule) refuses before the generic step walk.
    const ownedText =
      input.checkpointIssue?.text ??
      (input.completion?.ok === false
        ? (input.completion.text ?? 'the completion coverage is incomplete')
        : undefined)
    if (ownedText !== undefined && step === undefined) {
      const blocks = input.run.turnBlocks ?? 0
      if (blocks >= input.maxBlocks) {
        const detail = `turn close was refused ${String(blocks)} time(s) by an owned workflow rule; the close is allowed once as a VIOLATION, never as a pass`
        const run = resetTurnBlocks(addViolation(input.run, detail, { at }), at)
        return { kind: 'violation', run, detail }
      }
      return {
        kind: 'refuse',
        run: incrementTurnBlocks(input.run, at),
        stepId: input.definition.steps.at(-1)?.id ?? 'owned-rule',
        text: ownedText,
      }
    }
    if (step === undefined) {
      return {
        kind: 'allow',
        run: input.run,
        reason: 'no open blockTurnClose step is owned by this engine',
      }
    }
    const blocks = input.run.turnBlocks ?? 0
    if (blocks >= input.maxBlocks) {
      const detail = `turn close was refused ${String(blocks)} time(s) with step "${step.id}" open; the close is allowed once as a VIOLATION, never as a pass`
      const run = resetStepAttempts(
        resetTurnBlocks(addViolation(input.run, detail, { step: step.id, at }), at),
        step.id,
      )
      return { kind: 'violation', run, detail }
    }
    const steered = requestMainStep({
      run: input.run,
      definition: input.definition,
      step,
      agent: input.agent,
      evidenceContext: input.evidenceContext,
      turn: input.turn,
      maxAttempts: input.maxBlocks,
      ...(ownedText === undefined ? {} : { note: ownedText }),
      now: at,
    })
    const run = incrementTurnBlocks(steered.run, at)
    if (!steered.steered) {
      if (steered.reason.includes('request bound')) {
        const detail = `step "${step.id}" reached its request bound; the close is allowed once as a VIOLATION, never as a pass`
        const recorded = addViolation(input.run, detail, { step: step.id, at })
        return {
          kind: 'violation',
          run: resetStepAttempts(resetTurnBlocks(recorded, at), step.id),
          detail,
        }
      }
      // A failed dispatch stays an obligation until the run advances/retries;
      // never let the close pass silently on the failed step.
      if (steered.reason.includes('already failed')) {
        const blocks = input.run.turnBlocks ?? 0
        if (blocks >= input.maxBlocks) {
          const detail = `step "${step.id}" has a failed dispatch; the close is allowed once as a VIOLATION, never as a pass`
          return {
            kind: 'violation',
            run: resetTurnBlocks(addViolation(input.run, detail, { step: step.id, at }), at),
            detail,
          }
        }
        return {
          kind: 'refuse',
          run,
          stepId: step.id,
          text: `step "${step.id}" has a failed dispatch; retry it before the close`,
        }
      }
      const message = `step "${step.id}" could not be steered: ${steered.reason}`
      return {
        kind: 'allow',
        run: addViolation(input.run, message, { step: step.id, at }),
        reason: message,
      }
    }
    return { kind: 'refuse', run, stepId: step.id, text: steered.text }
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
  /** The loaded `change-intake` definition. */
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

function isCompletedIntake(run: WorkflowRun, name: string): boolean {
  return (
    run.definition.id === 'change-intake' && run.status === 'completed' && intakeName(run) === name
  )
}

function isResumableIntake(run: WorkflowRun, name: string, session: string): boolean {
  return (
    run.definition.id === 'change-intake' &&
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
  const completed = input.runs.find((run) => isCompletedIntake(run, name))
  if (completed !== undefined) {
    return {
      kind: 'allow',
      reason: `the change-intake run "${completed.id}" is completed`,
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
      run.definition.id === 'change-intake' &&
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
  const resumable = input.runs.find((run) => isResumableIntake(run, name, input.session))
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
    throw new Error('the change-intake definition has no create-change step')
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
  /** The owned per-task portable PASS coverage, computed from the workspace. */
  readonly taskReview?: { readonly ok: boolean; readonly text?: string }
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
  const completed = related.find((run) => isCompletedIntake(run, input.change))
  const receipt = input.receipts.find((entry) => entry.change === input.change)
  if (completed === undefined && receipt === undefined) {
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: no authenticated completed change-intake run and no authenticated receipt exists; complete the intake or run /workflows adopt ${input.change}`,
    }
  }
  if (!input.specRecord.ok) {
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: the current whole-spec PASS record is ${
        input.specRecord.failure.reason === 'missing-file' ? 'missing' : 'stale or invalid'
      } (${input.specRecord.failure.detail.slice(0, 200)})`,
    }
  }
  if (input.taskReview !== undefined && !input.taskReview.ok) {
    const relatedRun = related.find((run) => run.definition === 'task-review')
    return {
      kind: 'deny',
      reason: `the archive of "${input.change}" is refused: ${input.taskReview.text ?? 'a checked task has no portable task-review PASS'}${relatedRun === undefined ? '' : ` (related review run "${relatedRun.id}")`}`,
    }
  }
  return {
    kind: 'allow',
    reason: `the archive of "${input.change}" is allowed: the authenticated intake ${
      completed === undefined ? 'receipt' : 'run'
    } and the current whole-spec PASS record are present`,
  }
}
