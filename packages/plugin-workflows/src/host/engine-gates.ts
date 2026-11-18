import { readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { CHANGE_NAME } from './command-parse.js'
import type { Definition } from './definitions.js'
import { lastCodeWriteAt, type ToolCallObservation } from './evidence.js'
import { evaluateLaneParity, evaluateProgressParity, type LaneParityLane } from './gates.js'
import { defaultGit, type GitRunner, worktreeDigest } from './git.js'
import { notePathFor, type ProgressNote, readProgressNote } from './notes.js'
import {
  type ReviewUnit,
  type ReviewUnitRun,
  type ReviewUnitTextOptions,
  reviewerBinding,
  taskReviewCoverage,
} from './parity.js'
import {
  checkedTaskIds,
  type NumberedTaskLine,
  numberedTasks,
  sectionSelectable,
  taskLanes,
  taskSections,
} from './tasks.js'
import { normalizedWorkspacePath } from './write-attribution.js'

export type { ReviewUnit }

/**
 * The engine-owned gates: work progress, lane assignment, and goal completion.
 * Their decisions are the parity tables (`evaluateProgressParity`,
 * `evaluateLaneParity`), shared with the tracked parity report; this module only
 * gathers the evidence each decision needs. The host owns these gates; only the
 * checkpoint and verification definitions keep a legacy source.
 */

export interface GateEvidence {
  readonly workspace: string
  readonly change: string
  /** The session's observed tool calls, bounded by the host. */
  readonly calls: readonly ToolCallObservation[]
  readonly turn?: number
  readonly runGit?: GitRunner
  /** The turn's newly checked task ids the host retained beyond its bounded buffer. */
  readonly retainedTicks?: readonly string[]
}

export interface GateDecision {
  readonly decision: 'allow' | 'refuse'
  /** One line naming the refusal cause. */
  readonly reason: string
  /** The ready-to-paste remedy a steer prints; present on a refusal. */
  readonly steer?: string
}

const WORKER_LANE_TOOLS = new Set(['subagent', 'subagent_fork', 'spawn_teammate', 'workflow'])
const LANE_TAG =
  /(?<![A-Za-z0-9_-])lane-tag:\s*([a-z0-9][a-z0-9-]*)#([1-9][0-9]*)(?![0-9A-Za-z_])/gu

/** The plan markdown of one change, or undefined when it is unreadable. */
async function readPlan(workspace: string, change: string): Promise<string | undefined> {
  try {
    return await readFile(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8')
  } catch {
    return undefined
  }
}

/** The current worktree digest the note was bound to. */
async function noteDigest(input: GateEvidence): Promise<string | undefined> {
  return await worktreeDigest(input.workspace, input.runGit ?? defaultGit)
}

/** The active change names; the archive collection is not an active change. */
export async function activeChangeNames(workspace: string): Promise<Set<string>> {
  let names: string[]
  try {
    names = await readdir(join(workspace, 'openspec', 'changes'))
  } catch {
    return new Set()
  }
  return new Set(names.filter((name) => CHANGE_NAME.test(name) && name !== 'archive'))
}

/** The archived change names, from `openspec/changes/archive/<date>-<name>`. */
export async function archivedChangeNames(workspace: string): Promise<Set<string>> {
  let names: string[]
  try {
    names = await readdir(join(workspace, 'openspec', 'changes', 'archive'))
  } catch {
    return new Set()
  }
  const archived = new Set<string>()
  for (const entry of names) {
    const name = /^\d{4}-\d{2}-\d{2}-(.+)$/u.exec(entry)?.[1]
    if (name !== undefined && CHANGE_NAME.test(name)) archived.add(name)
  }
  return archived
}

/** Whether the turn wrote a non-documentation file. */
export function codeChangedThisTurn(
  calls: readonly ToolCallObservation[],
  workspace: string,
  turn: number | undefined,
): boolean {
  const current = calls.filter(
    (call) => turn === undefined || call.turn === undefined || call.turn === turn,
  )
  return lastCodeWriteAt(current, workspace) !== undefined
}

/**
 * The checked task ids one successful canonical `tasks.md` write newly ticks,
 * attributed to its change.
 */
export function taskTicksOf(
  workspace: string,
  call: ToolCallObservation,
): { readonly change: string; readonly taskIds: string[] } | undefined {
  if (call.name !== 'write' && call.name !== 'edit') return undefined
  if (call.ok === false || call.after === undefined) return undefined
  const raw = call.arguments.file_path ?? call.arguments.path
  if (typeof raw !== 'string') return undefined
  const rel = normalizedWorkspacePath(workspace, raw)
  const change = /^openspec\/changes\/([^/]+)\/tasks\.md$/u.exec(rel ?? '')?.[1]
  if (change === undefined) return undefined
  const before = new Set(checkedTaskIds(call.before ?? ''))
  return { change, taskIds: checkedTaskIds(call.after).filter((id) => !before.has(id)) }
}

/** The task ids one turn's canonical `tasks.md` writes newly checked. */
export function newlyCheckedTaskIds(
  calls: readonly ToolCallObservation[],
  workspace: string,
  change: string,
  turn: number | undefined,
): string[] {
  const ids = new Set<string>()
  for (const call of calls) {
    if (turn !== undefined && call.turn !== undefined && call.turn !== turn) continue
    const ticks = taskTicksOf(workspace, call)
    if (ticks === undefined || ticks.change !== change) continue
    for (const id of ticks.taskIds) ids.add(id)
  }
  return [...ids]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether one parsed record satisfies the task-review contract for a task. A
 * record with the wrong reviewed inputs, the wrong rule, or an internal failure
 * never counts.
 */
function recordApprovesTask(
  value: unknown,
  change: string,
  rule: string,
  verdicts: readonly string[],
): boolean {
  if (!isRecord(value)) return false
  if (
    value.rule !== rule ||
    value.change !== change ||
    value.scope !== 'task' ||
    (value.verdict !== 'PASS' && value.verdict !== 'ERROR' && value.verdict !== 'FINDINGS') ||
    !verdicts.includes(value.verdict) ||
    typeof value.digest !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(value.digest) ||
    !Array.isArray(value.findings) ||
    !isRecord(value.target) ||
    typeof value.target.provider !== 'string' ||
    typeof value.time !== 'string'
  ) {
    return false
  }
  return value.phase === 'task'
}

/** Whether one record names this task: its own id, or a section it covers. */
function recordNamesTask(value: unknown, taskId: string): boolean {
  if (!isRecord(value)) return false
  if (value.taskId === taskId) return true
  return Array.isArray(value.taskIds) && value.taskIds.includes(taskId)
}

/**
 * Whether one task has a matching task-review record with one of the requested
 * verdicts in the workflow store. The native record is a superset of the legacy
 * one, so one predicate covers both. A section record covers every checked task
 * it names, the same way its publication writes one approval each.
 */
async function taskReviewRecord(
  workspace: string,
  change: string,
  taskId: string,
  verdicts: readonly string[],
): Promise<boolean> {
  const binding = reviewerBinding(workspace)
  if (binding?.invalid !== undefined) return false
  const rule = binding?.taskRule ?? 'task-review'
  const directory = `.dsh/workflows/records/${rule}/${change}/tasks`
  let entries: string[]
  try {
    entries = await readdir(join(workspace, directory))
  } catch {
    return false
  }
  // Every well-formed record naming the task competes; the newest verdict is
  // authoritative, so a fresh section FINDINGS reopens a task an older
  // per-task PASS used to cover. On an equal timestamp a PASS wins to keep
  // historical fixtures stable.
  const matches: Array<{
    time: string
    verdict: string
    findings: number
    failureClass?: string
  }> = []
  for (const name of entries.filter((entry) => entry.endsWith('.json'))) {
    let value: unknown
    try {
      value = JSON.parse(await readFile(join(workspace, directory, name), 'utf8'))
    } catch {
      continue
    }
    if (!recordNamesTask(value, taskId)) continue
    if (!recordApprovesTask(value, change, rule, ['PASS', 'FINDINGS', 'ERROR'])) continue
    const record = value as {
      time: string
      verdict: string
      findings: unknown[]
      failureClass?: string
      target: { provider: string; model?: string }
    }
    if (binding?.provider !== undefined && record.target.provider !== binding.provider) continue
    if (binding?.model !== undefined && record.target.model !== binding.model) continue
    matches.push({
      time: record.time,
      verdict: record.verdict,
      findings: record.findings.length,
      ...(record.failureClass === undefined ? {} : { failureClass: record.failureClass }),
    })
  }
  if (matches.length === 0) return false
  matches.sort((left, right) => {
    if (left.time !== right.time) return left.time < right.time ? 1 : -1
    return (left.verdict === 'PASS' ? 0 : 1) - (right.verdict === 'PASS' ? 0 : 1)
  })
  const current = matches[0] as (typeof matches)[number]
  if (!verdicts.includes(current.verdict)) return false
  if (current.verdict === 'PASS' && current.findings !== 0) return false
  if (
    current.verdict === 'ERROR' &&
    (current.failureClass === 'reviewed-inputs-changed' ||
      current.failureClass === 'queue-internal-error')
  ) {
    return false
  }
  return true
}

/**
 * Whether one task has a matching task-review PASS/ERROR record in the
 * workflow store. The review step's own evidence accepts either verdict; only
 * the review units below require a PASS.
 */
export async function taskReviewEvidence(
  workspace: string,
  change: string,
  taskId: string,
): Promise<boolean> {
  return taskReviewRecord(workspace, change, taskId, ['PASS', 'ERROR'])
}

/** Whether one task has a current PASS: a FINDINGS or ERROR record keeps it due. */
async function taskReviewPass(workspace: string, change: string, taskId: string): Promise<boolean> {
  return taskReviewRecord(workspace, change, taskId, ['PASS'])
}

/**
 * The lane-first review units of one change: every checked task in a resolvable
 * level-2 section without a current PASS is one unit covering every checked task
 * of that section. A task outside any section, or in a section the start path
 * cannot resolve, keeps its per-task unit. Only `PASS` is coverage, so a
 * `FINDINGS` or `ERROR` record keeps the unit due. Undefined when the plan is
 * unreadable.
 */
export async function reviewUnits(
  workspace: string,
  change: string,
): Promise<ReviewUnit[] | undefined> {
  const plan = await readPlan(workspace, change)
  if (plan === undefined) return undefined
  const checked = numberedTasks(plan).filter((task) => task.checked)
  const missing = new Set<string>()
  for (const task of checked) {
    if (!(await taskReviewPass(workspace, change, task.id))) missing.add(task.id)
  }
  const units: ReviewUnit[] = []
  const sectioned = new Set<string>()
  // The section parser is the one `resolveTaskSection` and the start path use;
  // `taskLanes` reads only `## ` headings and would miss a tab-separated one.
  const sections = taskSections(plan)
  for (const section of sections) {
    // Tasks before the first heading are outside every section: per-task units.
    if (section.title === '') continue
    // The key must resolve to this one section through the resolver the review
    // start uses, or the unit's selector would be rejected there.
    if (!sectionSelectable(plan, section.key)) continue
    for (const task of section.covered) sectioned.add(task.id)
    const absent = section.covered.filter((task) => missing.has(task.id))
    if (absent.length === 0) continue
    units.push({
      section: { key: section.key, title: section.title },
      covered: section.covered,
      missing: absent,
    })
  }
  for (const task of checked) {
    if (!missing.has(task.id) || sectioned.has(task.id)) continue
    units.push({ covered: [task], missing: [task] })
  }
  return units
}

/** The most task numbers one unit line names before it summarizes the rest. */
const MAX_UNIT_NUMBERS = 20
/** The unit-text bound: the steer note and the status both deliver it. */
const MAX_UNIT_TEXT = 470

function boundedNumbers(tasks: readonly NumberedTaskLine[]): string {
  const shown = tasks
    .slice(0, MAX_UNIT_NUMBERS)
    .map((task) => task.number)
    .join(', ')
  return tasks.length <= MAX_UNIT_NUMBERS
    ? shown
    : `${shown}, and ${String(tasks.length - MAX_UNIT_NUMBERS)} more`
}

/** Bound a free-text field (a section key or title) without losing its start. */
function clipped(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

/** Keep the action whole: the head may lose its tail, the remedy never does. */
function clampUnitText(head: string, action: string): string {
  const room = MAX_UNIT_TEXT - action.length
  return head.length <= room
    ? `${head}${action}`
    : `${head.slice(0, Math.max(0, room - 1))}…${action}`
}

/** The task ids one open run's recorded identity covers. */
function runCoveredIds(run: ReviewUnitRun): string[] {
  const context = run.context
  const covered = Array.isArray(context.taskIds)
    ? context.taskIds.filter((entry): entry is string => typeof entry === 'string')
    : []
  if (typeof context.taskId === 'string' && !covered.includes(context.taskId)) {
    covered.push(context.taskId)
  }
  return covered
}

/** Whether one open run covers every checked task of the unit as it is now. */
function coversUnit(run: ReviewUnitRun, unit: ReviewUnit): boolean {
  const ids = runCoveredIds(run)
  return unit.covered.every((task) => ids.includes(task.id))
}

/**
 * The one-line lane unit: the section key with its covered and missing task
 * numbers (or the single task), the live runs that already cover it, and the
 * start action that covers the rest. Lane-first: only a PASS clears a unit, so
 * the text names a PASS where the review step's own evidence accepts ERROR too.
 * The completion coverage keeps its portable-approval formatter in parity.ts.
 */
export function reviewUnitText(
  change: string,
  unit: ReviewUnit,
  options: ReviewUnitTextOptions = {},
): string {
  const rule = options.rule ?? 'task-review'
  // Only a run covering the unit as it is now is pending; a run created before a
  // newly checked task does not cover the expanded lane.
  const pending = (options.openRuns ?? []).filter(
    (run) => run.change === change && coversUnit(run, unit),
  )
  const names = pending.map((run) => `"${run.id}"`).join(', ')
  const action = (selector: string): string =>
    pending.length === 0
      ? `; start it with workflows(action: "start", definitionId: "${rule}", change: "${change}", ${selector})`
      : `; the live review run${pending.length === 1 ? '' : 's'} ${names} cover${pending.length === 1 ? 's' : ''} it, so continue ${pending.length === 1 ? 'that run' : 'those runs'} instead of a new start`
  const section = unit.section
  if (section === undefined) {
    const task = unit.missing[0]
    if (task === undefined) return `change "${change}" has no outstanding review unit`
    const head = `task "${task.number} ${task.text}" (${task.id}) has no ${rule} PASS`
    return clampUnitText(head, action(`task: "${task.id}"`))
  }
  const head = `section "${clipped(section.key, 40)}" (${clipped(section.title, 60)}) is one lane unit; covered checked tasks ${boundedNumbers(unit.covered)}; missing a ${rule} PASS: ${boundedNumbers(unit.missing)}`
  return clampUnitText(head, action(`section: "${section.key}"`))
}

/**
 * The compact status form of one due unit: every due lane fits the delivered
 * status budget, so the title is omitted and the covered/missing task numbers
 * stay. Built from the same coverage as `reviewUnitText`.
 */
export function reviewUnitSummary(
  change: string,
  unit: ReviewUnit,
  options: ReviewUnitTextOptions = {},
): string {
  const rule = options.rule ?? 'task-review'
  const pending = (options.openRuns ?? []).filter(
    (run) => run.change === change && coversUnit(run, unit),
  )
  const live =
    pending.length === 0
      ? ''
      : `; live run${pending.length === 1 ? '' : 's'} ${pending.map((run) => `"${run.id}"`).join(', ')} cover${pending.length === 1 ? 's' : ''} it`
  const section = unit.section
  if (section === undefined) {
    const task = unit.missing[0]
    if (task === undefined) return `change "${change}" has no outstanding review unit`
    return `change "${change}" task "${clipped(task.number + ' ' + task.text, 40)}" (${task.id}): no ${rule} PASS${live}`
  }
  return `change "${change}" section "${clipped(section.key, 40)}": covered ${boundedNumbers(unit.covered)}; missing a ${rule} PASS: ${boundedNumbers(unit.missing)}${live}`
}

/**
 * The selected unit of one task-review run, rendered for an intermediate close:
 * a run whose review step is still open names its section and missing tasks
 * even while unchecked tasks remain (the completion coverage only speaks once
 * every task is checked).
 */
export async function reviewRunSteer(
  workspace: string,
  change: string,
  context: Readonly<Record<string, unknown>>,
  options: ReviewUnitTextOptions = {},
): Promise<string | undefined> {
  const units = await reviewUnits(workspace, change)
  if (units === undefined) return undefined
  const sectionKey = typeof context.section === 'string' ? context.section : undefined
  const taskId = typeof context.taskId === 'string' ? context.taskId : undefined
  const unit =
    sectionKey === undefined
      ? units.find((entry) => entry.missing.some((task) => task.id === taskId))
      : units.find((entry) => entry.section?.key === sectionKey)
  return unit === undefined ? undefined : reviewUnitText(change, unit, options)
}

export interface ProgressGateInput extends GateEvidence {
  readonly codeChanged: boolean
}

/**
 * The owned work-progress gate: a code-changing turn needs a newly checked and
 * reviewed task that is still checked, or a note whose digest matches the
 * current worktree. A stale note, a note for a completed task, and a note from
 * another path refuse.
 */
export async function evaluateOwnedProgressGate(input: ProgressGateInput): Promise<GateDecision> {
  const plan = await readPlan(input.workspace, input.change)
  const tasks = plan === undefined ? [] : numberedTasks(plan)
  // A tick is evidence only while its task is still checked: a task reopened or
  // removed before the close no longer earns its review record.
  const checked = new Set(tasks.filter((task) => task.checked).map((task) => task.id))
  const ticked = [
    ...newlyCheckedTaskIds(input.calls, input.workspace, input.change, input.turn),
    ...(input.retainedTicks ?? []),
  ].filter((taskId) => checked.has(taskId))
  let tickedReviewed = false
  for (const taskId of ticked) {
    if (await taskReviewEvidence(input.workspace, input.change, taskId)) {
      tickedReviewed = true
      break
    }
  }
  let note: { digest?: string; currentDigest?: string } | undefined
  let stale: string | undefined
  if (input.codeChanged && !tickedReviewed) {
    const saved = await readProgressNote(input.workspace, input.change)
    if (saved !== undefined) {
      const current = tasks.find((task) => task.id === saved.taskId)
      if (current !== undefined) {
        const digest = await noteDigest(input)
        note = { digest: saved.worktreeDigest, currentDigest: digest }
        if (digest !== undefined && digest !== saved.worktreeDigest) {
          stale = ` The last note is stale: it names worktree digest ${saved.worktreeDigest.slice(0, 12)}, current ${digest.slice(0, 12)}.`
        }
      }
    }
  }
  const decision = evaluateProgressParity({
    codeChanged: input.codeChanged,
    tickedReviewed,
    ...(note === undefined ? {} : { note }),
  })
  if (decision.decision === 'allow') return decision
  const task = tasks.find((entry) => !entry.checked)
  const noteCall =
    task === undefined
      ? `workflows { action: "note", change: "${input.change}", task: "<task text>", status: "in-progress", reason: "..." }`
      : `workflows { action: "note", change: "${input.change}", task: "${task.number} ${task.text}", status: "in-progress", reason: "..." }`
  const reviewCall =
    task === undefined
      ? `workflows status`
      : `workflows(action: "start", definitionId: "${reviewerBinding(input.workspace)?.taskRule ?? 'task-review'}", change: "${input.change}", task: "${task.id}")`
  const digest =
    note?.currentDigest === undefined ? '(unavailable)' : note.currentDigest.slice(0, 12)
  return {
    decision: 'refuse',
    reason: decision.reason,
    steer: `rule "task-progress": this turn changed implementation files in change "${input.change}" without a newly checked-and-reviewed task and without a current progress note for worktree digest ${digest}.${stale ?? ''} Tick the task and run ${reviewCall}, or record ${noteCall}. Only a matching record or a note whose worktree digest matches the current worktree satisfies this gate; a text claim does not.`,
  }
}

/** The change and lane number one worker-start argument tree tags. */
export interface LaneTag {
  readonly change: string
  readonly n: number
}

/** Collect every string value in a tool-argument tree, decoded (never JSON-escaped). */
function argumentStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) argumentStrings(item, into)
    return
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) argumentStrings(item, into)
  }
}

/**
 * The first lane tag in a worker start's arguments. The tag is searched in
 * decoded argument strings, so a tag that starts a new line still matches.
 */
export function laneTagOf(argumentsValue: Readonly<Record<string, unknown>>): LaneTag | undefined {
  const strings: string[] = []
  argumentStrings(argumentsValue, strings)
  for (const text of strings) {
    for (const match of text.matchAll(LANE_TAG)) {
      const n = Number(match[2])
      if (match[1] !== undefined && Number.isSafeInteger(n)) return { change: match[1], n }
    }
  }
  return undefined
}

/** The lane tag of a successful worker start, or undefined for any other tool call. */
export function workerLaneTag(
  name: string,
  ok: boolean,
  argumentsValue: Readonly<Record<string, unknown>>,
): LaneTag | undefined {
  if (!WORKER_LANE_TOOLS.has(name) || !ok) return undefined
  return laneTagOf(argumentsValue)
}

/** An argument value safe to print inside a double-quoted suggested call. */
function quotedArg(text: string): string {
  return text.replace(/"/gu, "'")
}

/**
 * One ready-to-paste worker call for a lane. It carries the lane tag, and the
 * worker gets its own sibling worktree and branch and never ticks `tasks.md`;
 * ported from the legacy lane-assignment steer so the migrated gate keeps the
 * same isolation instructions.
 */
function laneWorkerCall(change: string, lane: LaneParityLane): string {
  const worktree = `wt-${change}-${lane.n}`
  const branch = `lane-${change}-${lane.n}`
  const prompt =
    `lane-tag: ${change}#${lane.n}. Implement the unchecked tasks under the heading '${lane.title}' in openspec/changes/${change}/tasks.md. ` +
    `Work in your own worktree: resolve the repository root with git rev-parse --show-toplevel, ` +
    `then from that root run git worktree add ../${worktree} -b ${branch} ` +
    '(pick another suffix if that path already exists; the worktree must be a sibling of the ' +
    'repository, never inside it), then run pnpm install --frozen-lockfile inside it. ' +
    `Read that change's proposal.md, design.md, and spec deltas first. ` +
    `Work only inside ${lane.owned.join(', ')}. ` +
    `Do not tick tasks.md; report the branch ${branch}, the files changed, and the commands you ran.`
  return `subagent(description: "${quotedArg(`Lane: ${lane.title}`.slice(0, 80))}", prompt: "${quotedArg(prompt)}")`
}

/** How one lane was satisfied for the session: a tagged worker or a serial note. */
export type LaneDecision = 'assigned' | 'serial'

/**
 * Forget decisions for lanes that disappeared, lost their tasks, or completed.
 * A completed or removed lane also drops its own session's persisted serial
 * note, even when the decision map is empty as it is after a host reload, so
 * reopening the lane needs fresh evidence instead of the old note. A renamed
 * lane is a new title and therefore a new, unassigned lane. An unreadable plan
 * keeps the decisions: the gate already fails open there.
 */
export async function pruneLaneDecisions(
  workspace: string,
  change: string,
  decisions: Map<string, LaneDecision>,
  note: { readonly session: string },
): Promise<void> {
  const plan = await readPlan(workspace, change)
  if (plan === undefined) return
  const lanes = taskLanes(plan)
  // A heading with no tasks yet is not stale: the parity table skips it too.
  const stale = (title: string): boolean => {
    const lane = lanes.find((entry) => entry.title === title)
    return (
      lane === undefined ||
      (lane.checked.length + lane.unchecked.length > 0 && lane.unchecked.length === 0)
    )
  }
  for (const title of [...decisions.keys()]) if (stale(title)) decisions.delete(title)
  // Another session's note is that session's evidence and stays untouched.
  const saved = await readProgressNote(workspace, change)
  if (saved?.lane === undefined || saved.session !== note.session || !stale(saved.lane)) return
  await unlink(join(workspace, notePathFor(change))).catch(() => undefined)
}

export interface LaneGateInput extends GateEvidence {
  readonly codeChanged: boolean
  /** The calling session; its own lane decisions and session-bound notes decide. */
  readonly session: string
  /**
   * The session's satisfied lanes for this change, kept beyond the bounded tool
   * buffer and the single latest note; the host records them as they happen. A
   * tagged worker start records the lane title captured at start time, never a
   * numeric tag resolved against a later plan.
   */
  readonly decisions?: ReadonlyMap<string, LaneDecision>
}

export interface LaneGateDecision extends GateDecision {
  readonly lanes?: readonly LaneParityLane[]
}

/**
 * Whether a persisted note still describes the lane it would decide serial for
 * the calling session. A note records its lane title and its writing session,
 * so another session's note never decides this session's lane.
 */
async function noteDecidesLane(
  input: LaneGateInput,
  note: ProgressNote,
  title: string,
): Promise<boolean> {
  return note.lane === title && note.session === input.session
}

/**
 * The owned lane-assignment gate. A serial note naming a task in a lane decides
 * only that lane, only for the session that wrote it, and only while the note
 * still names the current lane title. Every other unassigned lane stays
 * reported. The gate fails open on an unreadable plan, a plan without level-2
 * headings, and a lane without owned paths (the shared parity table enforces
 * the last one).
 */
export async function evaluateOwnedLaneGate(input: LaneGateInput): Promise<LaneGateDecision> {
  const plan = await readPlan(input.workspace, input.change)
  if (plan === undefined) {
    return {
      decision: 'allow',
      reason: 'the tasks.md plan is unreadable and the lane gate fails open',
    }
  }
  const lanes = taskLanes(plan)
  if (lanes.length === 0) {
    return { decision: 'allow', reason: 'the plan has no level-2 lane headings' }
  }
  const tasks = numberedTasks(plan)
  const ticked = new Set(
    [
      ...newlyCheckedTaskIds(input.calls, input.workspace, input.change, input.turn),
      ...(input.retainedTicks ?? []),
    ]
      .map((taskId) => tasks.find((task) => task.id === taskId)?.number)
      .filter((number): number is string => number !== undefined),
  )
  const assigned = new Set<string>()
  // A kept decision outlives the tool buffer and a later note for another lane;
  // a decision whose lane completed or disappeared no longer counts.
  for (const title of input.decisions?.keys() ?? []) {
    const lane = lanes.find((entry) => entry.title === title)
    if (lane !== undefined && lane.unchecked.length > 0) assigned.add(title)
  }
  const note = await readProgressNote(input.workspace, input.change)
  if (note !== undefined) {
    const task = tasks.find((entry) => entry.id === note.taskId)
    if (task !== undefined) {
      const lane = lanes.find(
        (entry) => entry.checked.includes(task.number) || entry.unchecked.includes(task.number),
      )
      if (lane !== undefined && (await noteDecidesLane(input, note, lane.title))) {
        assigned.add(lane.title)
      }
    }
  }
  const decision = evaluateLaneParity({
    plan,
    ticked: [...ticked],
    assigned: [...assigned],
    implementationChanged: input.codeChanged,
  })
  if (decision.decision === 'allow') return decision
  const lines = [
    `rule "lane-assignment": lane assignment is missing in change "${input.change}": ${String(decision.lanes?.length ?? 0)} unassigned non-serial lane(s) with owned paths and unchecked tasks; this turn ticked a task or changed implementation files, and no tagged worker start or serial note covers them.`,
    'commit the current worktree first, because a new checkout only sees commits; the :/ and :(top) pathspecs keep both commands anchored to the repository root:',
    `  git add -A :/; git add -f ":(top)openspec/changes/${input.change}"; git commit -m "lane checkpoint before fan-out"`,
    'start one worker per unassigned lane (they run in parallel); each call carries its lane-tag:',
  ]
  for (const lane of decision.lanes ?? []) {
    lines.push(`  ${laneWorkerCall(input.change, lane)}`)
  }
  lines.push('or record a serial decision for a lane that cannot run in parallel:')
  for (const lane of decision.lanes ?? []) {
    const planLane = lanes.find((entry) => entry.title === lane.title)
    const nextNumber = planLane?.unchecked.at(0)
    const task = tasks.find((entry) => entry.number === nextNumber)
    if (task !== undefined) {
      lines.push(
        `  workflows { action: "note", change: "${input.change}", task: "${task.number} ${task.text}", status: "in-progress", reason: "why this lane stays serial" }`,
      )
    }
  }
  return {
    decision: 'refuse',
    reason: decision.reason,
    steer: lines.join('\n'),
    ...(decision.lanes === undefined ? {} : { lanes: decision.lanes }),
  }
}

export interface GoalGuardInput {
  readonly workspace: string
  readonly definitions: readonly Definition[]
  readonly exec: { readonly name: string; readonly arguments?: unknown }
}

/**
 * The goal-complete guard: completing a goal is refused while an active change
 * has a checked task without a portable task-review PASS. The check is the same
 * portable-approval coverage the archive gate uses.
 */
export async function goalCompletionRefusal(input: GoalGuardInput): Promise<string | undefined> {
  if (input.exec.name !== 'update_goal') return undefined
  if (!isRecord(input.exec.arguments) || input.exec.arguments.action !== 'complete') {
    return undefined
  }
  if (!input.definitions.some((definition) => definition.id === 'task-review')) return undefined
  let names: string[]
  try {
    names = await readdir(join(input.workspace, 'openspec', 'changes'))
  } catch {
    return undefined
  }
  const gaps: string[] = []
  for (const name of names) {
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(name) || name === 'archive') continue
    let markdown: string
    try {
      markdown = await readFile(
        join(input.workspace, 'openspec', 'changes', name, 'tasks.md'),
        'utf8',
      )
    } catch {
      return `goal completion refused: change "${name}" has no readable tasks.md; repair it or archive the change. The goal stays active.`
    }
    // A checked line the task parser cannot read is still an unapproved checked
    // task; the coverage below reports it instead of skipping the change.
    if (!/^\s*[-*+]\s*\[[xX]\]/mu.test(markdown)) continue
    const coverage = taskReviewCoverage(input.workspace, name)
    if (coverage.ok) continue
    gaps.push(
      `goal completion refused: change "${name}" is not approval-complete:`,
      ...coverage.gaps.map((gap) => `  ${gap}`),
    )
  }
  if (gaps.length === 0) return undefined
  gaps.push(
    'The goal stays active. Run the workflows review calls above and complete the goal again; to close the work instead, archive the change.',
  )
  return gaps.join('\n')
}
