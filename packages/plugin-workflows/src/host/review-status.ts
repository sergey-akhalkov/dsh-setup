import { readFile, realpath, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CHANGE_NAME } from './command-parse.js'
import type { Definition, Step } from './definitions.js'
import { currentSpecDigest, readWorkspaceFile } from './evidence.js'
import { isInside } from './fs-change.js'
import {
  checkedTaskLines,
  portableTaskReview,
  type ReviewApprovalBinding,
  reviewerBinding,
  type TaskLine,
} from './parity.js'
import { localRecordError } from './projection.js'
import type { WorkflowRun } from './runs.js'
import { taskOf } from './tasks.js'
import type { ReviewLiveness } from './tools.js'

/**
 * The review read model the change card and the session rows render: the static
 * whole-spec verdict at its digest with the portable task-review coverage the
 * archive gate counts, and the live projection of the reviews the scheduler is
 * running. One definition of "reviewed" — the gate's — so the card can never
 * disagree with an archive decision; liveness stays the executor's #7 rule and
 * is never re-derived here.
 */

export interface ChangeReviewSummary {
  /** The last local whole-spec record, or null when no local record exists. */
  readonly spec: {
    readonly verdict: 'PASS' | 'FINDINGS' | 'ERROR'
    /** The record digest equals the current change-artifact digest. */
    readonly current: boolean
    /** ISO timestamp of the record. */
    readonly at: string
    readonly findings: number
    readonly reviewer: string
    readonly model?: string
  } | null
  /** Checked-task coverage, or null when tasks.md is missing/unreadable. */
  readonly tasks: {
    readonly checked: number
    readonly passed: number
    /** The missing checked tasks' numbers, bounded to 20 entries. */
    readonly missing: readonly string[]
    /** Newest matching approval time, when there is at least one. */
    readonly at?: string
  } | null
}

/** One live or waiting review the card and the session rows render. */
export interface ReviewLiveEntry {
  readonly session: string
  readonly change: string
  readonly definition: string
  /** `spec` for a whole spec phase, `tasks` for task scope, `integration` for integration. */
  readonly unit: 'spec' | 'tasks' | 'integration'
  /** Bounded unit detail: a section title, a task number, or a phase. */
  readonly label?: string
  readonly state: 'starting' | 'live' | 'waiting'
  readonly attempt: number
  /** ISO timestamp of when the current attempt started (or began waiting). */
  readonly since: string
}

/** One pending review the host's #7 liveness projection still reports. */
export interface ReviewLiveCandidate {
  readonly run: WorkflowRun
  readonly liveness: ReviewLiveness
  /** This advance's admission is in flight, before the scheduler holds it. */
  readonly starting: boolean
}

/** The host-owned facts `live()` shapes; liveness itself is never re-derived here. */
export interface ReviewLiveSource {
  /** The pending review runs the host already tracks in memory. */
  candidatesFor(workspace: string): readonly ReviewLiveCandidate[]
  /** The installed definitions of one workspace, for the review step's scope. */
  definitionsFor(workspace: string): readonly Definition[]
}

/** The host service a feature plugin reads as `workflowsReviewStatus`. */
export interface WorkflowsReviewStatusService {
  summaries(
    workspace: string,
    changes: readonly string[],
  ): Promise<Record<string, ChangeReviewSummary>>
  /** Live entries for one workspace; an orphaned run is not returned. */
  live(workspace: string): Promise<ReviewLiveEntry[]>
}

/** Most missing checked tasks one summary names; the card's tooltip stays bounded. */
const MAX_MISSING = 20

/** Longest raw checked line a task summary repeats. */
const MAX_UNPARSED = 40

/** Longest unit label kept; the card's one review line stays one line. */
const MAX_LABEL = 80

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

type SpecState = NonNullable<ChangeReviewSummary['spec']>

/**
 * The local whole-spec record when it is a readable whole-scope spec record.
 * The record's digest is the artifact digest a current PASS must still match.
 */
async function readSpecState(
  workspace: string,
  change: string,
  currentDigest: string | undefined,
): Promise<SpecState | null> {
  // The gate's own reader: a linked or oversized record is not evidence.
  const record = await readWorkspaceFile(
    workspace,
    `.dsh/workflows/records/spec-review/${change}/spec.json`,
  )
  if (record === undefined) {
    // A fresh clone has no local record; absence is not a failed review.
    return null
  }
  let raw: unknown
  try {
    raw = JSON.parse(record.text)
  } catch {
    return null
  }
  if (!isRecord(raw) || localRecordError(raw) !== undefined) return null
  if (raw.rule !== 'spec-review' || raw.change !== change || raw.phase !== 'spec') return null
  if (raw.scope !== 'whole') return null
  const target = isRecord(raw.target) ? raw.target : {}
  const model = nonEmpty(target.model)
  return {
    verdict: raw.verdict as SpecState['verdict'],
    current: currentDigest !== undefined && raw.digest === currentDigest,
    at: String(raw.time),
    findings: Array.isArray(raw.findings) ? raw.findings.length : 0,
    reviewer: nonEmpty(raw.reviewer) ?? nonEmpty(target.provider) ?? 'reviewer',
    ...(model === undefined ? {} : { model }),
  }
}

/** Checked-task coverage by the archive gate's portable approval match. */
function taskCoverage(
  workspace: string,
  change: string,
  markdown: string,
  binding: ReviewApprovalBinding | undefined,
): NonNullable<ChangeReviewSummary['tasks']> {
  const rule = binding?.taskRule ?? 'task-review'
  const tasks: TaskLine[] = checkedTaskLines(markdown)
  const missing: string[] = []
  let checked = 0
  let passed = 0
  let at: string | undefined
  for (const task of tasks) {
    checked += 1
    const match =
      binding?.invalid === undefined
        ? portableTaskReview(workspace, change, task, rule, binding)
        : { mismatch: [binding.invalid] }
    if (match.mismatch.length === 0) {
      passed += 1
      if (
        match.time !== undefined &&
        (at === undefined || Date.parse(match.time) > Date.parse(at))
      ) {
        at = match.time
      }
    } else if (missing.length < MAX_MISSING) {
      missing.push(task.number)
    }
  }
  // A checked line the task parser cannot read is an unapproved checked task,
  // exactly as the completion coverage treats it: it counts and is named raw.
  for (const line of markdown.split('\n')) {
    if (!/^\s*[-*+]\s*\[[xX]\]/u.test(line)) continue
    if (/^\s*-\s*\[[xX]\]\s+\d+(?:\.\d+)*\s+\S/u.test(line)) continue
    checked += 1
    if (missing.length < MAX_MISSING) missing.push(line.trim().slice(0, MAX_UNPARSED))
  }
  return { checked, passed, missing, ...(at === undefined ? {} : { at }) }
}

/** One change's static review state; an unknown or unreadable change is undefined. */
export async function reviewSummary(
  workspace: string,
  change: string,
  /** Test seam for the artifact digest read; production uses `currentSpecDigest`. */
  digestOf: (workspace: string, change: string) => Promise<string | undefined> = currentSpecDigest,
): Promise<ChangeReviewSummary | undefined> {
  if (!CHANGE_NAME.test(change)) return undefined
  // A change directory that resolves outside the workspace is never a row: a
  // junction there would otherwise expose another tree's tasks to the card.
  const root = await realpath(workspace).catch(() => undefined)
  const changeDirectory = await realpath(join(workspace, 'openspec', 'changes', change)).catch(
    () => undefined,
  )
  if (root === undefined || changeDirectory === undefined || !isInside(root, changeDirectory)) {
    return undefined
  }
  const info = await stat(changeDirectory).catch(() => undefined)
  // A missing change directory is an unknown row, not an unreviewed one.
  if (info?.isDirectory() !== true) return undefined
  const binding = reviewerBinding(workspace)
  // A failed digest read does not hide the change: it only makes `current` false.
  const currentDigest = await digestOf(workspace, change).catch(() => undefined)
  const spec = await readSpecState(workspace, change, currentDigest)
  let tasks: ChangeReviewSummary['tasks'] = null
  try {
    const markdown = await readFile(
      join(workspace, 'openspec', 'changes', change, 'tasks.md'),
      'utf8',
    )
    tasks = taskCoverage(workspace, change, markdown, binding)
  } catch {
    // An unreadable tasks file omits the task unit instead of claiming coverage.
    tasks = null
  }
  return { spec, tasks }
}

/** Per-change summaries; an unknown or unreadable row is omitted, never thrown. */
export async function summaries(
  workspace: string,
  changes: readonly string[],
): Promise<Record<string, ChangeReviewSummary>> {
  const result: Record<string, ChangeReviewSummary> = {}
  for (const change of changes) {
    try {
      const summary = await reviewSummary(workspace, change)
      if (summary !== undefined) result[change] = summary
    } catch {
      // One unreadable change never fails the list request.
    }
  }
  return result
}

/** The unit one review step produces; a custom whole-scope phase reads as spec. */
function unitOf(step: Step): ReviewLiveEntry['unit'] {
  if (step.review?.scope === 'task') return 'tasks'
  return step.review?.phase === 'integration' ? 'integration' : 'spec'
}

/**
 * The bounded label the live route may return. User text never carries a machine
 * path off the host: the requesting workspace is the path the route knows, and a
 * drive or UNC path is hidden wherever it appears.
 */
export function redactReviewLabel(text: string, workspace: string): string | undefined {
  const root = workspace.replaceAll('\\', '/').replace(/\/+$/u, '')
  let safe = workspace === '' ? text : text.replaceAll(workspace, '[path]')
  if (root.length > 1) safe = safe.replaceAll(root, '[path]')
  safe = safe
    .replace(/\b[A-Za-z]:[\\/][^\s"'<>|]*/gu, '[path]')
    .replace(/\\\\[^\s"'<>|]+/gu, '[path]')
  const bounded = safe.trim().slice(0, MAX_LABEL)
  return bounded === '' ? undefined : bounded
}

/** The bounded unit label: a section title, or a task number and text for one task. */
function labelOf(
  workspace: string,
  change: string,
  context: Readonly<Record<string, unknown>>,
): string | undefined {
  const title = context.sectionTitle
  if (typeof title === 'string' && title.trim() !== '') return redactReviewLabel(title, workspace)
  // An individual task run records only its id; resolve the task so the card
  // can name it instead of showing a bare task unit.
  const taskId = context.taskId
  if (typeof taskId !== 'string') return undefined
  const task = taskOf(workspace, change, taskId)
  return task === undefined
    ? undefined
    : redactReviewLabel(`${task.number} ${task.text}`, workspace)
}

/**
 * One entry per live or waiting review in the workspace. The #7 projection
 * decides the state and the host's admission set decides `starting`; an
 * orphaned run with no executor is never reported.
 */
export function live(workspace: string, source: ReviewLiveSource): ReviewLiveEntry[] {
  const definitions = source.definitionsFor(workspace)
  const running: ReviewLiveEntry[] = []
  const waiting: ReviewLiveEntry[] = []
  for (const { run, liveness, starting } of source.candidatesFor(workspace)) {
    if (liveness.state === 'orphaned') continue
    const change = typeof run.context.name === 'string' ? run.context.name : ''
    if (!CHANGE_NAME.test(change)) continue
    const definition = definitions.find((entry) => entry.id === run.definition.id)
    const step = definition?.steps.find((entry) => entry.executor === 'review')
    const stored = step === undefined ? undefined : run.steps.find((entry) => entry.id === step.id)
    if (step === undefined || stored === undefined) continue
    const label = labelOf(workspace, change, run.context)
    const entry: ReviewLiveEntry = {
      session: run.session,
      change,
      definition: run.definition.id,
      unit: unitOf(step),
      ...(label === undefined ? {} : { label }),
      state: starting ? 'starting' : liveness.state,
      attempt: stored.attempts ?? liveness.attempt ?? 1,
      since: new Date(stored.requestedAt ?? run.updatedAt).toISOString(),
    }
    // A unit can be both running and waited on; the first entry a client picks
    // for that unit must be the running one, never its waiter.
    if (liveness.state === 'waiting') waiting.push(entry)
    else running.push(entry)
  }
  return [...running, ...waiting]
}
