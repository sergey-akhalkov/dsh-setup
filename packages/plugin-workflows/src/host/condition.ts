import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CHANGE_NAME } from './command-parse.js'
import { currentSpecDigest } from './evidence.js'
import { evaluateJsonLogic } from './executors.js'
import { type GitRunner, worktreeDigest } from './git.js'
import { localRecordError } from './projection.js'
import { numberedTasks, taskLanes } from './tasks.js'

/**
 * The trigger condition's bounded context. It carries the event, the change's
 * tasks and lanes, the current whole-spec and task records with their digests,
 * the current spec and worktree digests, and the session's involvement — no
 * prose, no run state, and no machine path. The predicate itself is JSONLogic.
 */

export interface ConditionEvent {
  readonly kind: string
  readonly tool?: string
  readonly command?: string
  readonly path?: string
}

export interface ConditionTaskView {
  readonly id: string
  readonly number: string
  readonly text: string
  readonly checked: boolean
}

export interface ConditionLaneView {
  readonly n: number
  readonly title: string
  readonly owned: readonly string[]
  readonly unchecked: readonly string[]
}

export interface ConditionContext {
  readonly event: ConditionEvent
  readonly change: {
    readonly name: string
    readonly tasks: {
      readonly checked: readonly string[]
      readonly unchecked: readonly string[]
      readonly items: readonly ConditionTaskView[]
    }
    readonly lanes: readonly ConditionLaneView[]
  }
  readonly records: {
    readonly spec?: {
      readonly verdict: string
      readonly digest: string
      readonly current: boolean
      readonly pass: boolean
    }
    readonly tasks: Readonly<Record<string, { readonly verdict: string; readonly digest: string }>>
  }
  readonly digests: {
    readonly spec?: string
    readonly worktree?: string
  }
  readonly session: {
    readonly involved: boolean
    readonly changedSpec: boolean
    readonly completed: boolean
  }
}

export interface ConditionContextInput {
  readonly workspace: string
  readonly change?: string
  readonly event: ConditionEvent
  /** The git seam; absent leaves the worktree digest unavailable. */
  readonly runGit?: GitRunner
  /** Whether this session is attributed to the change. */
  readonly involved?: boolean
  /** Whether this turn changed the change artifacts. */
  readonly changedSpec?: boolean
  /** Whether this turn completed the tracked work. */
  readonly completed?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readRecord(
  workspace: string,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(join(workspace, path), 'utf8'))
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

async function readTaskRecords(
  workspace: string,
  change: string,
  directories: readonly string[],
): Promise<Record<string, { verdict: string; digest: string }>> {
  const records: Record<string, { verdict: string; digest: string }> = {}
  for (const directory of directories) {
    let names: string[]
    try {
      names = await readdir(join(workspace, directory))
    } catch {
      continue
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const taskId = name.slice(0, -'.json'.length)
      if (records[taskId] !== undefined) continue
      const record = await readRecord(workspace, `${directory}/${name}`)
      if (
        record === undefined ||
        localRecordError(record) !== undefined ||
        record.rule !== 'task-review' ||
        record.change !== change ||
        record.scope !== 'task' ||
        record.taskId !== taskId
      ) {
        continue
      }
      records[taskId] = { verdict: String(record.verdict), digest: String(record.digest) }
    }
  }
  return records
}

/** Build the one bounded context every condition for this event evaluates over. */
export async function buildConditionContext(
  input: ConditionContextInput,
): Promise<ConditionContext> {
  const change = input.change !== undefined && CHANGE_NAME.test(input.change) ? input.change : ''
  let markdown = ''
  if (change !== '') {
    try {
      markdown = await readFile(
        join(input.workspace, 'openspec', 'changes', change, 'tasks.md'),
        'utf8',
      )
    } catch {
      markdown = ''
    }
  }
  const tasks = numberedTasks(markdown)
  const lanes = taskLanes(markdown)
  const specDigest = change === '' ? undefined : await currentSpecDigest(input.workspace, change)
  const worktree =
    input.runGit === undefined
      ? undefined
      : await worktreeDigest(input.workspace, input.runGit).catch(() => undefined)
  let specRecord: ConditionContext['records']['spec']
  const tasksRecords: Record<string, { verdict: string; digest: string }> = {}
  if (change !== '') {
    const workflowSpec = await readRecord(
      input.workspace,
      `.dsh/workflows/records/spec-review/${change}/spec.json`,
    )
    const legacySpec =
      workflowSpec === undefined
        ? await readRecord(input.workspace, `.dsh/delegation/spec-review/${change}/spec.json`)
        : undefined
    const record = workflowSpec ?? legacySpec
    if (
      record !== undefined &&
      localRecordError(record) === undefined &&
      record.rule === 'spec-review' &&
      record.change === change &&
      record.phase === 'spec' &&
      record.scope === 'whole'
    ) {
      specRecord = {
        verdict: String(record.verdict),
        digest: String(record.digest),
        current: record.digest === specDigest,
        pass: record.verdict === 'PASS',
      }
    }
    Object.assign(
      tasksRecords,
      await readTaskRecords(input.workspace, change, [
        `.dsh/workflows/records/task-review/${change}/tasks`,
        `.dsh/delegation/task-review/${change}/tasks`,
      ]),
    )
  }
  // A condition may not read a filesystem path out of the workspace: an
  // absolute or traversing lane/path value would leak it into a predicate.
  // shortcut: a POSIX path wrapped in Markdown emphasis (**/etc/x**) is
  // indistinguishable from a legitimate glob (**/spec.md), so it is treated as
  // a glob; upgrade if task prose becomes untrusted input instead of an
  // owner-authored plan. Drive, traversal, UNC, and delimiter-adjacent absolute
  // paths are always rejected.
  const startsPath = /^(?:[A-Za-z]:[\\/]|[\\/])/u
  // A drive path needs a separator or a non-space right after the colon, so
  // prose labels such as "release A: migration" stay readable.
  const drivePath = /(?:^|[^A-Za-z0-9])[A-Za-z]:(?:[\\/]|[^\s])/u
  const absolutePath = /(?:^|[\s"'`=([[{(<:;,]|[|?&!])\/[^\s'"`*]/u
  const uncPath = /(?:^|[^A-Za-z0-9])\\\\(?:[^\\/\s]+[\\/]|\?[\\/]UNC[\\/])/u
  // `..` counts only as a whole path segment, never as the ellipsis in
  // ".../tasks/<taskId>.json".
  const traverses = /(?:^|[^A-Za-z0-9.])\.\.(?:[^A-Za-z0-9.]|$)/u
  const assertNoPath = (value: string | undefined): void => {
    if (
      value !== undefined &&
      (startsPath.test(value) ||
        drivePath.test(value) ||
        absolutePath.test(value) ||
        uncPath.test(value) ||
        traverses.test(value))
    ) {
      throw new Error('condition context contains a filesystem path')
    }
  }
  assertNoPath(input.event.path)
  for (const lane of lanes) {
    assertNoPath(lane.title)
    for (const owned of lane.owned) assertNoPath(owned)
  }
  for (const task of tasks) assertNoPath(task.text)
  return {
    event: input.event,
    change: {
      name: change,
      tasks: {
        checked: tasks.filter((task) => task.checked).map((task) => task.id),
        unchecked: tasks.filter((task) => !task.checked).map((task) => task.id),
        items: tasks,
      },
      lanes: lanes.map((lane) => ({
        n: lane.n,
        title: lane.title,
        owned: lane.owned,
        unchecked: lane.unchecked,
      })),
    },
    records: {
      ...(specRecord === undefined ? {} : { spec: specRecord }),
      tasks: tasksRecords,
    },
    digests: {
      ...(specDigest === undefined ? {} : { spec: specDigest }),
      ...(worktree === undefined ? {} : { worktree }),
    },
    session: {
      involved: input.involved ?? true,
      changedSpec: input.changedSpec ?? false,
      // Completion is derived from the change's own task list when the caller
      // does not know better: every numbered task is checked.
      completed: input.completed ?? (tasks.length > 0 && tasks.every((task) => task.checked)),
    },
  }
}

/** Evaluate one definition's condition over the built context; false starts no run. */
export function evaluateCondition(
  condition: Readonly<Record<string, unknown>> | undefined,
  context: ConditionContext,
): boolean {
  if (condition === undefined) return true
  const value = evaluateJsonLogic(condition, context)
  // JSONLogic truthiness, not JavaScript's: an empty array is false.
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}

/** Every condition-bearing definition's decision for one event context. */
export function evaluateConditions(
  definitions: readonly {
    readonly id: string
    readonly trigger: { readonly condition?: Readonly<Record<string, unknown>> }
  }[],
  context: ConditionContext,
): Map<string, boolean> {
  const decisions = new Map<string, boolean>()
  for (const definition of definitions) {
    if (definition.trigger.condition === undefined) continue
    try {
      decisions.set(definition.id, evaluateCondition(definition.trigger.condition, context))
    } catch {
      // An over-budget or malformed predicate never starts a run.
      decisions.set(definition.id, false)
    }
  }
  return decisions
}
