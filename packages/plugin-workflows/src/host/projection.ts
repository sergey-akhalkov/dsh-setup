import { createHash } from 'node:crypto'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isInside } from './fs-change.js'
import { redactPayload, redactText } from './redact.js'

/**
 * Read-only run projection over the process records the setup already writes:
 * work checkpoints, delegation runs, settled local review records, and portable
 * task approvals. No adapter writes, repairs, deletes, or re-runs a record.
 */

export type RunSource = 'checkpoint' | 'delegation' | 'review' | 'workflow'
export type RunAttribution = 'local' | 'portable' | 'unattributed'
export type RunStatus = 'running' | 'done' | 'failed' | 'unknown'

/** One step of a projected run; evidence is the file, call id, or target. */
export interface RunStep {
  readonly id: string
  readonly title: string
  readonly state: string
  readonly at?: number
  readonly evidence?: string
  readonly reason?: string
}

/** The one shape every adapter returns. */
export interface RunView {
  readonly id: string
  readonly source: RunSource
  readonly session?: string
  readonly attribution: RunAttribution
  readonly title: string
  readonly startedAt: number
  readonly status: RunStatus
  readonly steps: readonly RunStep[]
  readonly error?: string
  /** The absolute or workspace-relative record path this view came from. */
  readonly record?: string
}

export const KNOWN_STEP_STATES = new Set(['open', 'done', 'blocked', 'failed', 'cancelled'])

const WORK_CHECKPOINT_DIR = join('.dsh', 'work-checkpoints')
export const DELEGATION_DIR = join('.dsh', 'delegation')
export const WORKFLOW_EVENTS_DIR = join('.dsh', 'workflows', 'events')

/** The producer's checkpoint directory name: sha256 of the session id, first 16 hex. */
export function hashSession(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A record-derived display string with credential shapes removed. */
function safeText(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactText(value)
}

/** A failure detail that may carry arbitrary structured credentials. */
function safeError(value: string | undefined): string | undefined {
  return value === undefined ? undefined : redactPayload(value)
}

function parseTime(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return 0
}

type ReadResult = { readonly value: unknown } | { readonly error: string }

/** Canonical target when it stays inside the workspace; undefined otherwise. */
async function containedFile(workspace: string, file: string): Promise<string | undefined> {
  const root = await realpath(workspace).catch(() => undefined)
  if (root === undefined) return undefined
  const target = await realpath(file).catch(() => undefined)
  if (target === undefined || !isInside(root, target)) return undefined
  return target
}

async function readJson(workspace: string, file: string): Promise<ReadResult> {
  try {
    const target = await containedFile(workspace, file)
    if (target === undefined)
      return { error: 'the record path escapes the workspace or is unreadable' }
    return { value: JSON.parse(await readFile(target, 'utf8')) }
  } catch (error) {
    return { error: errorMessage(error) }
  }
}

async function listFiles(workspace: string, directory: string): Promise<string[]> {
  try {
    const target = await realpath(directory)
    const root = await realpath(workspace)
    if (!isInside(root, target)) return []
    return await readdir(target)
  } catch {
    return []
  }
}

function displayPath(workspace: string, file: string): string {
  return file.slice(workspace.length).replaceAll('\\', '/').replace(/^\//u, '')
}

function errorRun(
  id: string,
  source: RunSource,
  workspace: string,
  file: string | undefined,
  attribution: RunAttribution,
  session: string | undefined,
  error: string,
): RunView {
  const display = file === undefined ? undefined : displayPath(workspace, file)
  return {
    id,
    source,
    attribution,
    title: `Unreadable ${source} record`,
    startedAt: 0,
    status: 'unknown',
    steps: [],
    error: safeError(display === undefined ? error : `${display}: ${error}`),
    ...(display === undefined ? {} : { record: display }),
    ...(session === undefined ? {} : { session }),
  }
}

function laneSteps(value: unknown): RunStep[] {
  if (!Array.isArray(value)) return []
  const steps: RunStep[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue
    const scope = Array.isArray(entry.scope)
      ? entry.scope.filter((item): item is string => typeof item === 'string').join(', ')
      : undefined
    steps.push({
      id: `lane:${entry.id}`,
      title: typeof entry.owner === 'string' ? `${entry.id} (${entry.owner})` : entry.id,
      state: typeof entry.state === 'string' ? entry.state : 'unknown',
      ...(scope === undefined || scope === '' ? {} : { evidence: safeText(scope) }),
    })
  }
  return steps
}

/**
 * Checkpoints for the requesting session only. The directory is the producer's
 * hash of the session id; the directory name and the redacted `session` field
 * are never read back as a session identity.
 */
export async function checkpointRuns(workspace: string, sessionId: string): Promise<RunView[]> {
  const directory = join(workspace, WORK_CHECKPOINT_DIR, hashSession(sessionId))
  const runs: RunView[] = []
  for (const name of await listFiles(workspace, directory)) {
    if (!name.endsWith('.json')) continue
    const file = join(directory, name)
    const turn = name.slice(0, -'.json'.length)
    const parsed = await readJson(workspace, file)
    if ('error' in parsed) {
      runs.push(
        errorRun(
          `checkpoint:${turn}`,
          'checkpoint',
          workspace,
          file,
          'local',
          sessionId,
          parsed.error,
        ),
      )
      continue
    }
    if (!isRecord(parsed.value)) {
      runs.push(
        errorRun(
          `checkpoint:${turn}`,
          'checkpoint',
          workspace,
          file,
          'local',
          sessionId,
          'the record is not an object',
        ),
      )
      continue
    }
    const record = parsed.value
    const invalid = checkpointRecordError(record)
    if (invalid !== undefined) {
      runs.push(
        errorRun(`checkpoint:${turn}`, 'checkpoint', workspace, file, 'local', sessionId, invalid),
      )
      continue
    }
    const recordedTurn = record.turn
    const startedAt = parseTime(record.time)
    const steps: RunStep[] = [
      {
        id: 'outcome',
        title: 'Outcome',
        state: typeof record.outcome === 'string' ? record.outcome : 'unknown',
        ...(startedAt === 0 ? {} : { at: startedAt }),
      },
      ...laneSteps(record.lanes),
    ]
    if (isRecord(record.bottleneck) && typeof record.bottleneck.id === 'string') {
      const targets = Array.isArray(record.bottleneck.targets)
        ? record.bottleneck.targets
            .filter((item): item is string => typeof item === 'string')
            .join(', ')
        : undefined
      steps.push({
        id: 'bottleneck',
        title: `Bottleneck ${record.bottleneck.id}`,
        state: typeof record.bottleneck.action === 'string' ? record.bottleneck.action : 'unknown',
        ...(targets === undefined || targets === '' ? {} : { evidence: safeText(targets) }),
      })
    }
    if (typeof record.next === 'string') {
      steps.push({
        id: 'next',
        title: 'Next',
        state: 'next',
        evidence: safeText(record.next as string),
      })
    }
    runs.push({
      id: `checkpoint:${String(recordedTurn)}`,
      source: 'checkpoint',
      session: sessionId,
      attribution: 'local',
      title: `Checkpoint turn ${String(recordedTurn)}`,
      startedAt,
      status: record.outcome === 'done' ? 'done' : 'running',
      steps,
      record: displayPath(workspace, file),
    })
  }
  return runs
}

const LANE_STATES = new Set(['running', 'blocked', 'done'])

/** Every required lane field the producer guarantees. */
function validLanes(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (lane) =>
        isRecord(lane) &&
        typeof lane.id === 'string' &&
        typeof lane.owner === 'string' &&
        typeof lane.state === 'string' &&
        LANE_STATES.has(lane.state) &&
        Array.isArray(lane.scope) &&
        lane.scope.every((entry) => typeof entry === 'string'),
    )
  )
}

const BOTTLENECK_ACTIONS = new Set(['worker_start', 'lead_action', 'user_decision'])

function validBottleneck(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.owner !== 'string' ||
    typeof value.action !== 'string' ||
    !BOTTLENECK_ACTIONS.has(value.action)
  ) {
    return false
  }
  if (
    value.targets !== undefined &&
    (!Array.isArray(value.targets) || !value.targets.every((entry) => typeof entry === 'string'))
  ) {
    return false
  }
  if (value.action === 'lead_action') {
    if (!Array.isArray(value.targets) || value.targets.length === 0) return false
  }
  if (
    value.blockingLanes !== undefined &&
    (!Array.isArray(value.blockingLanes) ||
      !value.blockingLanes.every((entry) => typeof entry === 'string'))
  ) {
    return false
  }
  return true
}

/** One settled local review record and the file it came from. */
export interface LocalReviewRecord {
  readonly file: string
  readonly record: Record<string, unknown>
}

/** One unreadable or invalid local review record. */
export interface LocalReviewFailure {
  readonly file: string
  readonly error: string
}

export interface LocalReviewRead {
  readonly records: LocalReviewRecord[]
  readonly failures: LocalReviewFailure[]
}

const LOCAL_SKIP = new Set([
  'runs',
  'sessions',
  'task-progress',
  'worktrees',
  'owners',
  'snapshots',
])
const TASK_ID = /^[a-f0-9]{16}$/u
const DIGEST = /^[a-f0-9]{64}$/u
const VERDICTS = new Set(['PASS', 'FINDINGS', 'ERROR'])
const LOCAL_SCOPES = new Set(['whole', 'task'])

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function validFinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.severity === 'P0' || value.severity === 'P1') &&
    nonEmpty(value.title) &&
    nonEmpty(value.evidence) &&
    nonEmpty(value.fix)
  )
}

function validTarget(value: unknown): boolean {
  if (!isRecord(value) || typeof value.provider !== 'string' || value.provider === '') return false
  for (const field of ['model', 'reasoningEffort']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') return false
  }
  return true
}

/** The producer contract for a settled local review record. */
/** The goal-continuity checkpoint record shape every reader accepts. */
export function checkpointRecordError(record: Record<string, unknown>): string | undefined {
  if (
    typeof record.outcome !== 'string' ||
    (record.outcome !== 'done' && record.outcome !== 'continue') ||
    typeof record.turn !== 'number' ||
    !validLanes(record.lanes) ||
    typeof record.next !== 'string'
  ) {
    return 'missing or invalid outcome, turn, lanes, or next'
  }
  if (
    (record.outcome === 'continue' && !validBottleneck(record.bottleneck)) ||
    (record.bottleneck !== undefined && !validBottleneck(record.bottleneck))
  ) {
    return 'missing or invalid bottleneck for the checkpoint outcome'
  }
  return undefined
}

export function localRecordError(record: Record<string, unknown>): string | undefined {
  for (const field of ['rule', 'change', 'phase', 'scope', 'digest', 'verdict', 'time']) {
    if (typeof record[field] !== 'string' || record[field] === '') {
      return `missing or invalid field "${field}"`
    }
  }
  if (!DIGEST.test(record.digest as string)) return 'field "digest" must be 64 hex characters'
  if (!VERDICTS.has(record.verdict as string)) {
    return 'field "verdict" must be PASS, FINDINGS, or ERROR'
  }
  if (!LOCAL_SCOPES.has(record.scope as string)) {
    return 'field "scope" must be "whole" or "task"'
  }
  if (!Array.isArray(record.findings) || !record.findings.every(validFinding)) {
    return 'field "findings" must be a list of P0/P1 findings'
  }
  if (record.verdict === 'PASS' && record.findings.length > 0) {
    return 'a PASS record must have zero findings'
  }
  if (record.verdict === 'FINDINGS' && record.findings.length === 0) {
    return 'a FINDINGS record must have at least one finding'
  }
  if (!validTarget(record.target)) return 'field "target" must carry a provider'
  if (record.scope === 'task') {
    if (typeof record.taskId !== 'string' || !TASK_ID.test(record.taskId)) {
      return 'task-scoped record needs a 16-hex taskId'
    }
  }
  if (record.session !== undefined && typeof record.session !== 'string') {
    return 'field "session" must be a string'
  }
  if (record.runId !== undefined && typeof record.runId !== 'string') {
    return 'field "runId" must be a string'
  }
  if (record.failureClass !== undefined) {
    const failureClasses = new Set([
      'child-limit',
      'provider-not-started',
      'timeout',
      'reviewed-inputs-changed',
      'invalid-output',
      'config',
      'permission',
      'unknown',
      'queue-full',
      'queue-timeout',
      'queue-internal-error',
    ])
    if (typeof record.failureClass !== 'string' || !failureClasses.has(record.failureClass)) {
      return 'field "failureClass" must be a known failure class'
    }
  }
  if (
    record.worktreeDigest !== undefined &&
    (typeof record.worktreeDigest !== 'string' || !DIGEST.test(record.worktreeDigest))
  ) {
    return 'field "worktreeDigest" must be 64 hex characters'
  }
  if (record.error !== undefined && typeof record.error !== 'string') {
    return 'field "error" must be a string'
  }
  return undefined
}

/** The producer contract for a portable task approval. */
export function portableRecordError(record: Record<string, unknown>): string | undefined {
  for (const field of ['rule', 'change', 'scope', 'taskId', 'digest', 'verdict', 'time']) {
    if (typeof record[field] !== 'string' || record[field] === '') {
      return `missing or invalid field "${field}"`
    }
  }
  if (record.scope !== 'task') return 'field "scope" must be "task"'
  if (!DIGEST.test(record.digest as string)) return 'field "digest" must be 64 hex characters'
  if (!TASK_ID.test(record.taskId as string)) return 'field "taskId" must be 16 hex characters'
  if (record.verdict !== 'PASS') return 'a portable approval must be a PASS'
  if (!Array.isArray(record.findings) || record.findings.length !== 0) {
    return 'a portable approval must have zero findings'
  }
  if (!validTarget(record.target)) return 'field "target" must carry a provider'
  return undefined
}

/** Read every settled local review record; malformed and invalid files are reported. */
export async function readLocalReviewRecords(workspace: string): Promise<LocalReviewRead> {
  const delegation = join(workspace, DELEGATION_DIR)
  const records: LocalReviewRecord[] = []
  const failures: LocalReviewFailure[] = []
  for (const rule of await listFiles(workspace, delegation)) {
    if (LOCAL_SKIP.has(rule)) continue
    const ruleDirectory = join(delegation, rule)
    for (const change of await listFiles(workspace, ruleDirectory)) {
      const changeDirectory = join(ruleDirectory, change)
      for (const name of await listFiles(workspace, changeDirectory)) {
        const candidates: string[] = []
        if (name.endsWith('.json')) candidates.push(join(changeDirectory, name))
        if (name === 'tasks') {
          for (const task of await listFiles(workspace, join(changeDirectory, name))) {
            if (task.endsWith('.json')) candidates.push(join(changeDirectory, name, task))
          }
        }
        for (const file of candidates) {
          const parsed = await readJson(workspace, file)
          if ('error' in parsed) {
            failures.push({ file, error: parsed.error })
            continue
          }
          if (!isRecord(parsed.value)) {
            failures.push({ file, error: 'the record is not an object' })
            continue
          }
          const invalid = localRecordError(parsed.value)
          if (invalid !== undefined) {
            failures.push({ file, error: invalid })
            continue
          }
          records.push({ file, record: parsed.value })
        }
      }
    }
  }
  return { records, failures }
}

const RUN_STATES = new Set(['queued', 'running', 'completed', 'failed', 'discarded'])

function runStatus(state: unknown): RunStatus {
  if (state === 'queued' || state === 'running') return 'running'
  if (state === 'completed') return 'done'
  if (state === 'failed' || state === 'discarded') return 'failed'
  return 'unknown'
}

/**
 * Delegation runs. Session attribution comes from an observed starting/queuing
 * result or a settled record whose `runId` equals the run id; the run's record
 * path is a display hint only.
 */
export async function delegationRuns(
  workspace: string,
  observedSessions: ReadonlyMap<string, string>,
  localRecords: readonly LocalReviewRecord[],
): Promise<RunView[]> {
  const directory = join(workspace, DELEGATION_DIR, 'runs')
  const byRunId = new Map<string, LocalReviewRecord>()
  for (const local of localRecords) {
    if (typeof local.record.runId === 'string') byRunId.set(local.record.runId, local)
  }
  const runs: RunView[] = []
  for (const name of await listFiles(workspace, directory)) {
    if (!name.endsWith('.json')) continue
    const file = join(directory, name)
    const id = name.slice(0, -'.json'.length)
    const parsed = await readJson(workspace, file)
    if ('error' in parsed) {
      runs.push(
        errorRun(
          `delegation:${id}`,
          'delegation',
          workspace,
          file,
          'unattributed',
          undefined,
          parsed.error,
        ),
      )
      continue
    }
    if (!isRecord(parsed.value)) {
      runs.push(
        errorRun(
          `delegation:${id}`,
          'delegation',
          workspace,
          file,
          'unattributed',
          undefined,
          'the record is not an object',
        ),
      )
      continue
    }
    const record = parsed.value
    const runId = typeof record.id === 'string' ? record.id : id
    const invalidField = (['id', 'rule', 'change', 'state', 'record', 'startedAt'] as const).find(
      (field) => typeof record[field] !== 'string' || record[field] === '',
    )
    if (
      invalidField !== undefined ||
      !RUN_STATES.has(record.state as string) ||
      typeof record.id !== 'string'
    ) {
      runs.push(
        errorRun(
          `delegation:${id}`,
          'delegation',
          workspace,
          file,
          'unattributed',
          undefined,
          `missing or invalid field "${invalidField ?? (typeof record.id !== 'string' ? 'id' : 'state')}"`,
        ),
      )
      continue
    }
    const joined = byRunId.get(runId)
    const session =
      observedSessions.get(runId) ??
      (typeof joined?.record.session === 'string' ? joined.record.session : undefined)
    const rule = record.rule as string
    const change = record.change as string
    const state = record.state as string
    const steps: RunStep[] = [
      { id: 'rule', title: rule, state },
      {
        id: 'change',
        title: typeof record.taskId === 'string' ? record.taskId : change,
        state: 'review',
        evidence: change,
      },
      { id: 'state', title: 'Run state', state },
    ]
    if (joined !== undefined) {
      const verdict = typeof joined.record.verdict === 'string' ? joined.record.verdict : 'unknown'
      steps.push({
        id: 'record',
        title: 'Review verdict',
        state: verdict,
        at: parseTime(joined.record.time),
        evidence: displayPath(workspace, joined.file),
      })
      if (isRecord(joined.record.target)) {
        const provider = joined.record.target.provider
        const model = joined.record.target.model
        const parts: string[] = []
        if (typeof provider === 'string') parts.push(provider)
        if (typeof model === 'string') parts.push(model)
        steps.push({
          id: 'target',
          title: 'Review target',
          state: 'target',
          evidence: safeError(parts.join(' / ')),
        })
      }
    }
    const status = runStatus(record.state)
    runs.push({
      id: `delegation:${runId}`,
      source: 'delegation',
      ...(session === undefined ? {} : { session }),
      attribution: session === undefined ? 'unattributed' : 'local',
      title: `${record.rule} ${record.change}`,
      startedAt: parseTime(record.startedAt),
      status,
      steps,
      ...(typeof record.detail === 'string' && (status === 'failed' || status === 'unknown')
        ? { error: safeError(record.detail) }
        : {}),
      record: displayPath(workspace, file),
    })
  }
  return runs
}

/** Portable task approvals under `openspec/changes/*\/reviews/*.json`. */
export async function portableReviewRuns(
  workspace: string,
  localRecords: readonly LocalReviewRecord[],
): Promise<RunView[]> {
  const changesDirectory = join(workspace, 'openspec', 'changes')
  const runs: RunView[] = []
  for (const change of await listFiles(workspace, changesDirectory)) {
    const reviews = join(changesDirectory, change, 'reviews')
    for (const name of await listFiles(workspace, reviews)) {
      if (!name.endsWith('.json')) continue
      const file = join(reviews, name)
      const taskId = name.slice(0, -'.json'.length)
      const parsed = await readJson(workspace, file)
      if ('error' in parsed) {
        runs.push(
          errorRun(
            `review:${change}/${taskId}`,
            'review',
            workspace,
            file,
            'unattributed',
            undefined,
            parsed.error,
          ),
        )
        continue
      }
      if (!isRecord(parsed.value)) {
        runs.push(
          errorRun(
            `review:${change}/${taskId}`,
            'review',
            workspace,
            file,
            'unattributed',
            undefined,
            'the record is not an object',
          ),
        )
        continue
      }
      const record = parsed.value
      const invalid = portableRecordError(record)
      if (invalid !== undefined) {
        runs.push(
          errorRun(
            `review:${change}/${taskId}`,
            'review',
            workspace,
            file,
            'unattributed',
            undefined,
            invalid,
          ),
        )
        continue
      }
      const match = localRecords.find(
        (local) =>
          local.record.change === record.change &&
          local.record.taskId === record.taskId &&
          local.record.digest === record.digest &&
          typeof local.record.session === 'string',
      )
      const session = match?.record.session as string | undefined
      const startedAt = parseTime(record.time)
      const changeName = record.change as string
      const stableTask = record.taskId as string
      const verdict = record.verdict as string
      const digest = record.digest as string
      runs.push({
        id: `review:${changeName}/${stableTask}`,
        source: 'review',
        ...(session === undefined ? {} : { session }),
        attribution: session === undefined ? 'unattributed' : 'portable',
        title: `Review ${changeName} ${stableTask}`,
        startedAt,
        status: verdict === 'PASS' ? 'done' : verdict === 'ERROR' ? 'failed' : 'unknown',
        steps: [
          { id: 'verdict', title: 'Verdict', state: verdict, at: startedAt },
          {
            id: 'target',
            title: 'Target',
            state: 'target',
            evidence: isRecord(record.target)
              ? safeError(JSON.stringify(record.target))
              : undefined,
          },
          { id: 'digest', title: 'Digest', state: 'digest', evidence: safeText(digest) },
          { id: 'task', title: 'Task', state: stableTask },
        ],
        record: displayPath(workspace, file),
      })
    }
  }
  return runs
}

/**
 * Observed delegation ownership from the journal: the earliest `delegate`
 * result that reported starting or queuing a run. An `already pending` result
 * names the run but must not establish or transfer ownership.
 */
export async function delegationObservations(workspace: string): Promise<Map<string, string>> {
  const directory = join(workspace, WORKFLOW_EVENTS_DIR)
  const observed = new Map<string, { session: string; at: number }>()
  for (const name of await listFiles(workspace, directory)) {
    if (!/\.jsonl(?:\.1)?$/u.test(name)) continue
    let raw = ''
    try {
      const target = await containedFile(workspace, join(directory, name))
      if (target === undefined) continue
      raw = await readFile(target, 'utf8')
    } catch {
      continue
    }
    for (const line of raw.split('\n')) {
      if (line.trim() === '') continue
      let value: unknown
      try {
        value = JSON.parse(line)
      } catch {
        continue
      }
      if (!isRecord(value) || value.kind !== 'tools/result' || value.subject !== 'delegate')
        continue
      if (typeof value.session !== 'string' || typeof value.summary !== 'string') continue
      const started = /delegate review (started|queued); run: (run-[a-z0-9]+-[a-f0-9]{8})/u.exec(
        value.summary,
      )
      if (started === null || started[2] === undefined) continue
      const at = typeof value.at === 'number' ? value.at : 0
      const current = observed.get(started[2])
      if (current === undefined || at < current.at) {
        observed.set(started[2], { session: value.session, at })
      }
    }
  }
  const sessions = new Map<string, string>()
  for (const [runId, entry] of observed) sessions.set(runId, entry.session)
  return sessions
}

/**
 * Engine obligation runs from `.dsh/workflows/runs/`. They are display-only
 * here; authority reads authenticate them separately. A malformed or unsigned
 * file is shown as an unreadable row, never silently dropped.
 */
export async function engineRuns(workspace: string): Promise<RunView[]> {
  const directory = join(workspace, '.dsh', 'workflows', 'runs')
  const runs: RunView[] = []
  for (const name of await listFiles(workspace, directory)) {
    if (!name.endsWith('.json')) continue
    const file = join(directory, name)
    const display = displayPath(workspace, file)
    // A credential-shaped filename is redacted and never linked.
    const id = redactText(name.slice(0, -'.json'.length))
    const recordPath = redactText(display) === display ? display : undefined
    const parsed = await readJson(workspace, file)
    if ('error' in parsed) {
      runs.push(
        errorRun(
          `workflow:${id}`,
          'workflow',
          workspace,
          recordPath === undefined ? undefined : file,
          'unattributed',
          undefined,
          parsed.error,
        ),
      )
      continue
    }
    if (
      !isRecord(parsed.value) ||
      parsed.value.v !== 1 ||
      typeof parsed.value.id !== 'string' ||
      // A parseable file that is not a run record is a diagnostic, not a run.
      typeof parsed.value.definition !== 'string' ||
      typeof parsed.value.status !== 'string' ||
      typeof parsed.value.session !== 'string' ||
      !Array.isArray(parsed.value.steps)
    ) {
      runs.push(
        errorRun(
          `workflow:${id}`,
          'workflow',
          workspace,
          recordPath === undefined ? undefined : file,
          'unattributed',
          undefined,
          'the run record is missing required fields',
        ),
      )
      continue
    }
    const record = parsed.value
    const session = typeof record.session === 'string' ? record.session : undefined
    const statusValue = record.status
    const status: RunStatus =
      statusValue === 'completed'
        ? 'done'
        : statusValue === 'failed' || statusValue === 'cancelled'
          ? 'failed'
          : statusValue === 'running' || statusValue === 'blocked' || statusValue === 'interrupted'
            ? 'running'
            : 'unknown'
    const steps: RunStep[] = []
    for (const entry of Array.isArray(record.steps) ? record.steps : []) {
      if (!isRecord(entry) || typeof entry.id !== 'string') continue
      const evidence = isRecord(entry.evidence) ? entry.evidence : undefined
      steps.push({
        id: redactText(entry.id),
        title: redactText(entry.id),
        state:
          typeof entry.state === 'string' && KNOWN_STEP_STATES.has(entry.state)
            ? entry.state
            : 'unknown',
        ...(typeof entry.at === 'number' ? { at: entry.at } : {}),
        ...(typeof entry.reason === 'string' ? { reason: safeError(entry.reason) } : {}),
        ...(evidence === undefined
          ? {}
          : {
              evidence:
                typeof evidence.path === 'string'
                  ? safeText(evidence.path)
                  : typeof evidence.kind === 'string'
                    ? (safeText(evidence.kind) ?? 'evidence')
                    : 'evidence',
            }),
      })
    }
    const violations = Array.isArray(record.violations) ? record.violations : []
    for (const [index, violation] of violations.entries()) {
      if (!isRecord(violation)) continue
      steps.push({
        id: `violation:${String(index)}`,
        title: 'VIOLATION',
        state: typeof violation.kind === 'string' ? redactText(violation.kind) : 'VIOLATION',
        ...(typeof violation.at === 'number' ? { at: violation.at } : {}),
        ...(typeof violation.detail === 'string' ? { evidence: safeError(violation.detail) } : {}),
      })
    }
    runs.push({
      id: `workflow:${redactText(typeof record.id === 'string' ? record.id : id)}`,
      source: 'workflow',
      ...(session === undefined ? {} : { session }),
      attribution: session === undefined ? 'unattributed' : 'local',
      title: `${redactText(String(record.definition ?? 'workflow'))} intake`,
      startedAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
      status,
      steps,
      ...(typeof record.reason === 'string' && status === 'failed'
        ? { error: safeError(record.reason) }
        : {}),
      ...(recordPath === undefined ? {} : { record: recordPath }),
    })
  }
  return runs
}

/** Every projected run in one workspace, unattributed runs included. */
export async function workspaceRuns(workspace: string): Promise<RunView[]> {
  const [observations, local] = await Promise.all([
    delegationObservations(workspace),
    readLocalReviewRecords(workspace),
  ])
  const [delegation, reviews] = await Promise.all([
    delegationRuns(workspace, observations, local.records),
    portableReviewRuns(workspace, local.records),
  ])
  const failures = local.failures.map((failure) =>
    errorRun(
      `local-review:${displayPath(workspace, failure.file)}`,
      'review',
      workspace,
      failure.file,
      'unattributed',
      undefined,
      failure.error,
    ),
  )
  const engine = await engineRuns(workspace)
  return [...delegation, ...reviews, ...failures, ...engine].sort(compareRuns)
}

/** The requesting session's timeline: only attributed runs, in time order. */
export async function sessionRuns(workspace: string, sessionId: string): Promise<RunView[]> {
  const [checkpoints, workspaceRunsList] = await Promise.all([
    checkpointRuns(workspace, sessionId),
    workspaceRuns(workspace),
  ])
  return [...checkpoints, ...workspaceRunsList]
    .filter(
      (run) =>
        (run.attribution !== 'unattributed' && run.session === sessionId) ||
        // Only unattributed malformed workflow records are workspace diagnostics.
        (run.attribution === 'unattributed' &&
          run.source === 'workflow' &&
          run.error !== undefined),
    )
    .sort(compareRuns)
}

function compareRuns(left: RunView, right: RunView): number {
  if (left.startedAt !== right.startedAt) return left.startedAt - right.startedAt
  return left.id.localeCompare(right.id)
}

/** Whether a path is inside the workspace; adapters never read outside it. */
export function insideWorkspace(workspace: string, path: string): boolean {
  const relative = path.slice(workspace.length)
  return path.startsWith(workspace) && (relative === '' || /^[\\/]/u.test(relative))
}

/** A file's age, used only to display and order error rows. */
export async function fileTime(file: string): Promise<number> {
  try {
    return (await stat(file)).mtimeMs
  } catch {
    return 0
  }
}
