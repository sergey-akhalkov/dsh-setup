import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { join } from 'node:path'
import { isInside } from './fs-change.js'
import type { HostAuth } from './host-auth.js'

/**
 * Durable workflow obligation runs. A run is one JSON file under
 * `.dsh/workflows/runs/`; every transition replaces the file atomically so a
 * crash leaves the previous readable state, never a torn one. An authoritative
 * run carries a host HMAC signature over its persisted state; an unsigned or
 * modified file is refused for resume, gate admission, and receipt issuance.
 */

export const RUN_VERSION = 1

/** Domain separation for a run signature. */
const RUN_DOMAIN = 'workflows/run/v1'

export const RUN_STATUSES = [
  'running',
  'blocked',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

export const STEP_STATES = ['open', 'done', 'blocked', 'failed', 'cancelled'] as const
export type StepState = (typeof STEP_STATES)[number]

/** What satisfied one step. */
export interface RunEvidence {
  readonly kind: string
  readonly path?: string
  readonly detail?: string
  readonly digest?: string
  readonly answer?: string
  readonly callId?: string
  readonly bytes?: number
  readonly at?: number
  /** The schema-validated child result a subagent step settled on. */
  readonly result?: unknown
}

export interface RunStep {
  readonly id: string
  readonly state: StepState
  readonly requestedAt?: number
  readonly at?: number
  readonly attempts?: number
  /** The turn in which this step was last steered, so one turn steers once. */
  readonly lastTurn?: number
  readonly evidence?: RunEvidence
  readonly reason?: string
}

/** A visible refusal or bypass; never a pass. */
export interface RunViolation {
  readonly at: number
  readonly kind: string
  readonly step?: string
  readonly detail: string
}

export interface WorkflowRun {
  /** The branch or loop successor selected by the last executed edge. */
  readonly nextStep?: string
  /** The ordered selected path from the last executed edge. */
  readonly branchPath?: readonly string[]
  readonly v: typeof RUN_VERSION
  readonly id: string
  readonly definition: string
  readonly trigger: string
  readonly session: string
  readonly workspaceKey: string
  readonly status: RunStatus
  readonly createdAt: number
  readonly updatedAt: number
  /** A bounded explanation for an interrupted or blocked run. */
  readonly reason?: string
  /** Turn-close refusals since the last visible violation. */
  readonly turnBlocks?: number
  readonly context: Readonly<Record<string, unknown>>
  readonly steps: readonly RunStep[]
  readonly violations: readonly RunViolation[]
  /** The trigger identity that produced this run, for dedupe after reload. */
  readonly dedupeKey?: string
}

/** The persisted file shape; the signature covers every other field. */
interface StoredRun extends WorkflowRun {
  readonly signature: string
}

/** The run directory for one workspace. */
export function runsDirectory(workspace: string): string {
  return join(workspace, '.dsh', 'workflows', 'runs')
}

/** The run file for one id. */
export function runPath(workspace: string, id: string): string {
  return join(runsDirectory(workspace), `${id}.json`)
}

/** A fresh stable run id. */
export function newRunId(now = Date.now()): string {
  return `run-${now.toString(36)}-${randomBytes(4).toString('hex')}`
}

export interface CreateRunInput {
  readonly definition: string
  readonly trigger: string
  readonly session: string
  readonly workspace: string
  readonly context?: Readonly<Record<string, unknown>>
  readonly steps: readonly string[]
  readonly now?: number
  readonly id?: string
  readonly dedupeKey?: string
}

/** Build a new running run with every step open. */
export function createRun(input: CreateRunInput): WorkflowRun {
  const at = input.now ?? Date.now()
  return {
    v: RUN_VERSION,
    id: input.id ?? newRunId(at),
    definition: input.definition,
    trigger: input.trigger,
    session: input.session,
    workspaceKey: input.workspace,
    status: 'running',
    createdAt: at,
    updatedAt: at,
    context: boundContext(input.context ?? {}),
    steps: input.steps.map((id) => ({ id, state: 'open' })),
    violations: [],
    ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Persist one run atomically and sign its authoritative state. */
/** Persist one run atomically and sign its authoritative state. */
export interface WriteRunOptions {
  readonly renameSync?: typeof renameSync
}

export function writeRunSync(
  workspace: string,
  run: WorkflowRun,
  auth: HostAuth,
  options: WriteRunOptions = {},
): void {
  const directory = runsDirectory(workspace)
  mkdirSync(directory, { recursive: true })
  if (!isInside(realpathSync(workspace), realpathSync(directory))) {
    throw new Error('run refused: the runs directory escapes the workspace')
  }
  const stored: StoredRun = {
    ...run,
    signature: auth.sign(RUN_DOMAIN, run),
  }
  const target = runPath(workspace, run.id)
  const temporary = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
  writeFileSync(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  try {
    ;(options.renameSync ?? renameSync)(temporary, target)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // The temporary file is best-effort cleanup.
    }
    throw error
  }
}

export interface WriteRunAsyncOptions {
  readonly rename?: typeof rename
}

export async function writeRun(
  workspace: string,
  run: WorkflowRun,
  auth: HostAuth,
  options: WriteRunAsyncOptions = {},
): Promise<void> {
  const directory = runsDirectory(workspace)
  await mkdir(directory, { recursive: true })
  if (!isInside(await realpath(workspace), await realpath(directory))) {
    throw new Error('run refused: the runs directory escapes the workspace')
  }
  const stored: StoredRun = {
    ...run,
    signature: auth.sign(RUN_DOMAIN, run),
  }
  const target = runPath(workspace, run.id)
  const temporary = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  try {
    await (options.rename ?? rename)(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

function parseStored(value: unknown): { run: WorkflowRun; signature: unknown } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  const { signature, ...rest } = record
  if (
    rest.v !== RUN_VERSION ||
    typeof rest.id !== 'string' ||
    !Array.isArray(rest.steps) ||
    typeof rest.definition !== 'string' ||
    typeof rest.status !== 'string' ||
    !RUN_STATUSES.includes(rest.status as RunStatus)
  ) {
    return undefined
  }
  return { run: rest as unknown as WorkflowRun, signature }
}

/**
 * Read and authenticate one run. An unsigned, modified, or forged file reads as
 * absent: no caller may resume, admit, or issue a receipt from it.
 */
/** Compare the run's bound workspace with the workspace asking for it. */
export function sameWorkspace(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replaceAll('\\', '/').replace(/\/+$/u, '')
  const a = normalize(left)
  const b = normalize(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

export async function readAuthenticatedRun(
  workspace: string,
  id: string,
  auth: HostAuth,
): Promise<WorkflowRun | undefined> {
  const read = await readStored(workspace, id)
  if (read === undefined) return undefined
  if (!auth.verify(RUN_DOMAIN, read.run, read.signature)) return undefined
  // The host key is shared by every workspace, so a signed run copied into
  // another workspace must not authorize anything there.
  return sameWorkspace(read.run.workspaceKey, workspace) ? read.run : undefined
}

/** Read one run for display only; never use this for authority. */
export async function readRunUnverified(
  workspace: string,
  id: string,
): Promise<WorkflowRun | undefined> {
  return (await readStored(workspace, id))?.run
}

async function readStored(
  workspace: string,
  id: string,
): Promise<{ run: WorkflowRun; signature: unknown } | undefined> {
  try {
    const root = await realpath(workspace)
    const target = await realpath(runPath(workspace, id))
    if (!isInside(root, target)) return undefined
    const parsed = parseStored(JSON.parse(await readFile(target, 'utf8')))
    if (parsed === undefined || parsed.run.id !== id) return undefined
    return parsed
  } catch {
    return undefined
  }
}

export interface StoredRunEntry {
  readonly id: string
  readonly size: number
  readonly mtimeMs: number
}

/** Every run file on disk, oldest first, as retention sees it. */
export async function storedRuns(workspace: string): Promise<StoredRunEntry[]> {
  let names: string[]
  try {
    names = await readdir(runsDirectory(workspace))
  } catch {
    return []
  }
  const entries: StoredRunEntry[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const info = await stat(join(runsDirectory(workspace), name))
      entries.push({ id: name.slice(0, -'.json'.length), size: info.size, mtimeMs: info.mtimeMs })
    } catch {
      // A file another pass removed is simply gone.
    }
  }
  return entries.sort(
    (left, right) => left.mtimeMs - right.mtimeMs || left.id.localeCompare(right.id),
  )
}

/** Every readable run in one workspace, oldest first (display only). */
export async function listRuns(workspace: string): Promise<WorkflowRun[]> {
  const runs: WorkflowRun[] = []
  for (const entry of await storedRuns(workspace)) {
    const run = await readRunUnverified(workspace, entry.id)
    if (run !== undefined) runs.push(run)
  }
  return runs.sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  )
}

/** Every run that authenticates against the host key. */
export async function listAuthenticatedRuns(
  workspace: string,
  auth: HostAuth,
): Promise<WorkflowRun[]> {
  const runs: WorkflowRun[] = []
  for (const entry of await storedRuns(workspace)) {
    const run = await readAuthenticatedRun(workspace, entry.id, auth)
    if (run !== undefined) runs.push(run)
  }
  return runs.sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  )
}

/** Replace one step's state and stamp the run. Pure. */
export function settleStep(
  run: WorkflowRun,
  stepId: string,
  state: StepState,
  patch: { readonly at?: number; readonly evidence?: RunEvidence; readonly reason?: string } = {},
): WorkflowRun {
  if (!run.steps.some((step) => step.id === stepId)) {
    throw new Error(`run "${run.id}" has no step "${stepId}"`)
  }
  const at = patch.at ?? Date.now()
  return {
    ...run,
    updatedAt: at,
    steps: run.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            state,
            at,
            ...(patch.evidence === undefined ? {} : { evidence: patch.evidence }),
            ...(patch.reason === undefined ? {} : { reason: patch.reason }),
          }
        : step,
    ),
  }
}

/** Move a run to a terminal or blocked status and stamp it. Pure. */
export function setRunStatus(
  run: WorkflowRun,
  status: RunStatus,
  now = Date.now(),
  reason?: string,
): WorkflowRun {
  return {
    ...run,
    status,
    updatedAt: now,
    ...(reason === undefined ? {} : { reason }),
  }
}

/** Append a visible violation; a violation is never a pass. Pure. */
export function addViolation(
  run: WorkflowRun,
  detail: string,
  options: { readonly kind?: string; readonly step?: string; readonly at?: number } = {},
): WorkflowRun {
  const at = options.at ?? Date.now()
  return {
    ...run,
    updatedAt: at,
    violations: [
      ...run.violations,
      {
        at,
        kind: options.kind ?? 'VIOLATION',
        detail,
        ...(options.step === undefined ? {} : { step: options.step }),
      },
    ],
  }
}

/** Count one turn-close refusal on the run. Pure. */
export function incrementTurnBlocks(run: WorkflowRun, now = Date.now()): WorkflowRun {
  return { ...run, updatedAt: now, turnBlocks: (run.turnBlocks ?? 0) + 1 }
}

/** Reset the refusal count after the visible violation allows one close. Pure. */
export function resetTurnBlocks(run: WorkflowRun, now = Date.now()): WorkflowRun {
  return { ...run, updatedAt: now, turnBlocks: 0 }
}

/**
 * Terminally classify a run whose trigger later evaluates as not applicable.
 * It is completed before evidence so retention can prune it; it is never a pass.
 */
export function completeNotApplicable(run: WorkflowRun, now = Date.now()): WorkflowRun {
  return setRunStatus(run, 'completed', now, 'not-applicable')
}

/** Retention defaults: 30 days and 20 MB of run files. */
export const RUN_RETENTION_DAYS = 30
export const RUN_RETENTION_BYTES = 20 * 1024 * 1024
export const DAY_MS = 24 * 60 * 60 * 1000

export interface PruneOptions {
  readonly auth: HostAuth
  readonly now?: number
  readonly retentionMs?: number
  readonly maxBytes?: number
  /** Test seam: a deletion that throws never counts as removed. */
  readonly unlink?: (path: string) => Promise<void>
}

export interface PruneResult {
  readonly removed: readonly string[]
  readonly retained: readonly string[]
}

/**
 * Prune terminal runs first: expired (30 days) then, while the workspace is over
 * its byte cap, the oldest terminal run. A running or blocked run is retained.
 * Receipts live outside this directory and are never touched.
 */
export async function pruneRuns(workspace: string, options: PruneOptions): Promise<PruneResult> {
  const now = options.now ?? Date.now()
  const retentionMs = options.retentionMs ?? RUN_RETENTION_DAYS * DAY_MS
  const maxBytes = options.maxBytes ?? RUN_RETENTION_BYTES
  const entries = await storedRuns(workspace)
  const runs = new Map<string, WorkflowRun | undefined>()
  for (const entry of entries) {
    runs.set(entry.id, await readAuthenticatedRun(workspace, entry.id, options.auth))
  }
  const terminal = (id: string): boolean => {
    const status = runs.get(id)?.status
    // An interrupted run is resumable state, so it is retained like an open run.
    return status === 'completed' || status === 'cancelled' || status === 'failed'
  }
  const removal = options.unlink ?? unlink
  /** A failed deletion is not a removal; a missing file already satisfies it. */
  const remove = async (id: string): Promise<boolean> => {
    try {
      await removal(runPath(workspace, id))
      return true
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'ENOENT'
    }
  }
  const removed: string[] = []
  const kept: StoredRunEntry[] = []
  for (const entry of entries) {
    if (terminal(entry.id) && now - entry.mtimeMs > retentionMs && (await remove(entry.id))) {
      removed.push(entry.id)
    } else {
      kept.push(entry)
    }
  }
  let total = kept.reduce((sum, entry) => sum + entry.size, 0)
  for (const entry of kept) {
    if (total <= maxBytes) break
    if (!terminal(entry.id)) continue
    if (!(await remove(entry.id))) continue
    total -= entry.size
    removed.push(entry.id)
  }
  return {
    removed,
    retained: kept.filter((entry) => !removed.includes(entry.id)).map((entry) => entry.id),
  }
}

/** A run id's content identity for diagnostics; never a secret. */
export function runDigest(run: WorkflowRun): string {
  return createHash('sha256').update(JSON.stringify(run)).digest('hex')
}

/** A bounded one-line failure reason for a run record. */
export function runFailure(error: unknown): string {
  return errorMessage(error).slice(0, 300)
}

/** Run limits: concurrent open runs and the serialized context cap. */
export const DEFAULT_MAX_RUNS = 20
export const MAX_CONTEXT_BYTES = 4096

/** A run is open while it can still be resumed or steered. */
export function isOpenRun(run: WorkflowRun): boolean {
  return run.status === 'running' || run.status === 'blocked' || run.status === 'interrupted'
}

/** The number of open runs; terminal runs do not consume a slot. */
export function openRunCount(runs: readonly WorkflowRun[]): number {
  return runs.filter(isOpenRun).length
}

/** Whether one more run would exceed the configured limit. */
export function runLimitExceeded(runs: readonly WorkflowRun[], maxRuns: number): boolean {
  return openRunCount(runs) >= maxRuns
}

/** The open runs of one session; a different session cannot satisfy them. */
export function sessionRunsFor(runs: readonly WorkflowRun[], session: string): WorkflowRun[] {
  return runs.filter((run) => run.session === session && isOpenRun(run))
}

/**
 * A step belongs to the run's session. Another session may see the run in the
 * view but cannot satisfy its step.
 */
export function assertRunSession(run: WorkflowRun, session: string): void {
  if (run.session !== session) {
    throw new Error(
      `run "${run.id}" belongs to session "${run.session}"; session "${session}" cannot satisfy its step`,
    )
  }
}

/** The step currently requested and still open, if any. */
export function activeStep(run: WorkflowRun): RunStep | undefined {
  return run.steps.find(
    (step) => (step.state === 'open' || step.state === 'blocked') && step.requestedAt !== undefined,
  )
}

/**
 * Request one step. A run executes one main step at a time: requesting a second
 * step while another request is still open is refused. Re-requesting the same
 * step increments its bounded attempt count instead.
 */
export function requestStep(run: WorkflowRun, stepId: string, now = Date.now()): WorkflowRun {
  const target = run.steps.find((step) => step.id === stepId)
  if (target === undefined) throw new Error(`run "${run.id}" has no step "${stepId}"`)
  if (target.state !== 'open' && target.state !== 'blocked') {
    throw new Error(`run "${run.id}" step "${stepId}" is ${target.state}; it cannot be requested`)
  }
  const active = activeStep(run)
  if (active !== undefined && active.id !== stepId) {
    throw new Error(
      `run "${run.id}" already has step "${active.id}" requested; one main step runs at a time`,
    )
  }
  return {
    ...run,
    status: 'running',
    updatedAt: now,
    steps: run.steps.map((step) =>
      step.id === stepId
        ? {
            ...step,
            state: 'open',
            requestedAt: step.requestedAt ?? now,
            attempts: (step.attempts ?? 0) + 1,
          }
        : step,
    ),
  }
}

/** A bounded copy of a run context: an oversized value keeps its keys and a marker. */
export function boundContext(
  context: Readonly<Record<string, unknown>>,
  maxBytes = MAX_CONTEXT_BYTES,
): Readonly<Record<string, unknown>> {
  const text = JSON.stringify(context)
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= maxBytes) return context
  const candidate: Record<string, unknown> = { truncated: true, bytes }
  const keys: string[] = []
  for (const key of Object.keys(context).slice(0, 20)) {
    if (keys.length >= 20) break
    const name = key.slice(0, 32)
    const next = { ...candidate, keys: [...keys, name] }
    if (Buffer.byteLength(JSON.stringify(next), 'utf8') > maxBytes) break
    keys.push(name)
    candidate.keys = keys
  }
  if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > maxBytes) {
    return { truncated: true }
  }
  return candidate
}
