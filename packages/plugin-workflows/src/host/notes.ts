import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CHANGE_NAME } from './command-parse.js'
import { defaultGit, type GitRunner, worktreeDigest } from './git.js'
import { sanitizeReviewText } from './review.js'
import { taskIdOf, taskLanes } from './tasks.js'

/**
 * The engine-owned work-progress note, written by the `note` action to
 * `.dsh/workflows/notes/<change>.json`. The note is the only evidence that
 * lets a code-changing turn close with its task still unchecked: it is bound to
 * the worktree digest it was written against, so a later write makes it stale.
 * A serial note also names its lane and the session that wrote it, so the
 * workflow lane gate treats that one lane as the serial decision only for the
 * writing session.
 */

/** Where the engine keeps its progress note. */
export const NOTES_DIR = '.dsh/workflows/notes'

export type ProgressStatus = 'in-progress' | 'blocked'

export const PROGRESS_STATUSES: readonly ProgressStatus[] = ['in-progress', 'blocked']

const TASK_ID = /^[0-9a-f]{16}$/u
const DIGEST = /^[0-9a-f]{64}$/u
const MAX_REASON_CHARS = 2_000

export interface ProgressNote {
  readonly taskId: string
  readonly status: ProgressStatus
  readonly reason: string
  readonly worktreeDigest: string
  readonly time: string
  /** The lane the note decided serial; absent on a legacy note or outside a lane. */
  readonly lane?: string
  /** The session whose serial decision the lane is; absent on a legacy note. */
  readonly session?: string
}

export interface NoteInput {
  readonly change: string
  readonly task: string
  readonly status: ProgressStatus
  readonly reason?: string
}

/** The workspace-relative note path of one change. */
export function notePathFor(change: string): string {
  if (!CHANGE_NAME.test(change)) throw new Error(`"${change}" is not a change name`)
  return `${NOTES_DIR}/${change}.json`
}

/** Parse one note; a malformed document is undefined, never a partial note. */
export function parseProgressNote(value: unknown): ProgressNote | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.taskId !== 'string' || !TASK_ID.test(record.taskId)) return undefined
  if (record.status !== 'in-progress' && record.status !== 'blocked') return undefined
  if (typeof record.reason !== 'string') return undefined
  if (typeof record.worktreeDigest !== 'string' || !DIGEST.test(record.worktreeDigest)) {
    return undefined
  }
  if (typeof record.time !== 'string') return undefined
  if (record.lane !== undefined && typeof record.lane !== 'string') return undefined
  if (record.session !== undefined && typeof record.session !== 'string') return undefined
  return {
    taskId: record.taskId,
    status: record.status,
    reason: record.reason,
    worktreeDigest: record.worktreeDigest,
    time: record.time,
    ...(typeof record.lane === 'string' && record.lane !== '' ? { lane: record.lane } : {}),
    ...(typeof record.session === 'string' && record.session !== ''
      ? { session: record.session }
      : {}),
  }
}

/** The engine's note for a change, or undefined when absent or malformed. */
export async function readProgressNote(
  workspace: string,
  change: string,
): Promise<ProgressNote | undefined> {
  try {
    return parseProgressNote(
      JSON.parse(await readFile(join(workspace, notePathFor(change)), 'utf8')),
    )
  } catch {
    return undefined
  }
}

function normalizeTaskText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

interface ResolvedTask {
  readonly id: string
  readonly number: string
  readonly text: string
  readonly lane?: string
}

/**
 * Resolve the task a note names by its stable id, its text, or its numbered
 * form. The lane is where the number appears in the plan, so the note decides
 * exactly that lane's serial state.
 */
function resolveTask(markdown: string, wanted: string): ResolvedTask {
  const needle = normalizeTaskText(wanted)
  const lanes = taskLanes(markdown)
  for (const match of markdown.matchAll(/^\s*-\s*\[([ xX])\]\s+(\d+(?:\.\d+)*)\s+(\S.*?)\s*$/gmu)) {
    const number = match[2] ?? ''
    const text = match[3] ?? ''
    const id = taskIdOf(text)
    if (
      id !== wanted &&
      normalizeTaskText(text) !== needle &&
      normalizeTaskText(`${number} ${text}`) !== needle
    ) {
      continue
    }
    const lane = lanes.find(
      (entry) => entry.checked.includes(number) || entry.unchecked.includes(number),
    )
    return {
      id,
      number,
      text,
      ...(lane === undefined || lane.title === '' ? {} : { lane: lane.title }),
    }
  }
  throw new Error(
    `the task "${wanted}" was not found in the change's tasks.md; pass its task text or its 16-character task id`,
  )
}

export interface WrittenNote {
  readonly text: string
  readonly note: ProgressNote
  /** The lane title the note decided serial, when it named a lane. */
  readonly lane?: string
}

/**
 * Write the engine's progress note. The worktree digest is captured now, so the
 * note authorizes only the worktree it was written against. An unreadable
 * tasks.md or an uncomputable digest refuses the note instead of writing
 * evidence the gates could never accept.
 */
export async function writeProgressNote(
  workspace: string,
  input: NoteInput,
  options: {
    readonly runGit?: GitRunner
    readonly now?: number
    /** The writing session, so the lane decision is bound to it. */
    readonly session?: string
  } = {},
): Promise<WrittenNote> {
  let markdown: string
  try {
    markdown = await readFile(
      join(workspace, 'openspec', 'changes', input.change, 'tasks.md'),
      'utf8',
    )
  } catch {
    throw new Error(
      `the change "${input.change}" has no readable tasks.md; fix openspec/changes/${input.change}/tasks.md and retry`,
    )
  }
  const task = resolveTask(markdown, input.task)
  const digest = await worktreeDigest(workspace, options.runGit ?? defaultGit)
  if (digest === undefined) {
    throw new Error(
      'the worktree digest could not be computed (git status failed); fix the git workspace so the note can be checked against it',
    )
  }
  const reason =
    input.reason === undefined || input.reason.trim() === '' ? input.status : input.reason
  const note: ProgressNote = {
    taskId: task.id,
    status: input.status,
    reason: sanitizeReviewText(reason, MAX_REASON_CHARS),
    worktreeDigest: digest,
    time: new Date(options.now ?? Date.now()).toISOString(),
    ...(task.lane === undefined ? {} : { lane: task.lane }),
    ...(options.session === undefined || options.session === ''
      ? {}
      : { session: options.session }),
  }
  const relative = notePathFor(input.change)
  const path = join(workspace, relative)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(note, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
  const text = [
    `progress note written for change "${input.change}" (${relative})`,
    `task: ${task.number} ${task.text}`,
    `task id: ${note.taskId}`,
    `status: ${note.status}`,
    ...(note.lane === undefined ? [] : [`lane: ${note.lane}`]),
    `worktree digest: ${digest}`,
    '',
    'No model was run. This note lets a code-changing turn close only while the worktree matches that digest; after any further change it is stale, and the next turn must refresh it or tick the task and run its task review.',
  ].join('\n')
  return { text, note, ...(task.lane === undefined ? {} : { lane: task.lane }) }
}
