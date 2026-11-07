import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isInside } from './fs-change.js'

/**
 * Durable workflow obligation runs. A run is one JSON file under
 * `.dsh/workflows/runs/`; every transition replaces the file atomically so a
 * crash leaves the previous readable state, never a torn one.
 */

export const RUN_VERSION = 1

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
}

export interface RunStep {
  readonly id: string
  readonly state: StepState
  readonly requestedAt?: number
  readonly at?: number
  readonly attempts?: number
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
  readonly v: typeof RUN_VERSION
  readonly id: string
  readonly definition: string
  readonly trigger: string
  readonly session: string
  readonly workspaceKey: string
  readonly status: RunStatus
  readonly createdAt: number
  readonly updatedAt: number
  readonly context: Readonly<Record<string, unknown>>
  readonly steps: readonly RunStep[]
  readonly violations: readonly RunViolation[]
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
    context: input.context ?? {},
    steps: input.steps.map((id) => ({ id, state: 'open' })),
    violations: [],
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Replace a run file atomically: temp in the run directory, then rename. */
export async function writeRun(workspace: string, run: WorkflowRun): Promise<void> {
  const directory = runsDirectory(workspace)
  await mkdir(directory, { recursive: true })
  const target = runPath(workspace, run.id)
  const temporary = `${target}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, `${JSON.stringify(run, null, 2)}\n`, 'utf8')
  try {
    await rename(temporary, target)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/** Read one run; an unreadable or malformed file reads as absent. */
export async function readRun(workspace: string, id: string): Promise<WorkflowRun | undefined> {
  try {
    const root = await realpath(workspace)
    const target = await realpath(runPath(workspace, id))
    if (!isInside(root, target)) return undefined
    const value: unknown = JSON.parse(await readFile(target, 'utf8'))
    if (typeof value !== 'object' || value === null) return undefined
    const run = value as WorkflowRun
    if (run.v !== RUN_VERSION || run.id !== id || !Array.isArray(run.steps)) return undefined
    return run
  } catch {
    return undefined
  }
}

/** Every readable run in one workspace, oldest first. */
export async function listRuns(workspace: string): Promise<WorkflowRun[]> {
  let names: string[]
  try {
    names = await readdir(runsDirectory(workspace))
  } catch {
    return []
  }
  const runs: WorkflowRun[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const run = await readRun(workspace, name.slice(0, -'.json'.length))
    if (run !== undefined) runs.push(run)
  }
  return runs.sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  )
}

/** A bounded one-line failure reason for a run record. */
export function runFailure(error: unknown): string {
  return errorMessage(error).slice(0, 300)
}
