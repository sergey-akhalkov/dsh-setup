import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Task identity for the deferred task-review workflow. The delegation engine
 * derives a stable id from the whitespace-normalized task text; these helpers
 * compute the same id locally so the engine can name the task a `tasks.md`
 * change just checked without a new event field.
 */

/** Stable 16-hex id of one numbered task's text. */
export function taskIdOf(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16)
}

/** The checked `- [x] N.N text` task ids, in file order. */
export function checkedTaskIds(markdown: string): string[] {
  const ids: string[] = []
  for (const match of markdown.matchAll(/^\s*-\s*\[[xX]\]\s+(\d+(?:\.\d+)*)\s+(\S.*?)\s*$/gmu)) {
    ids.push(taskIdOf(match[2] ?? ''))
  }
  return ids
}

/** The checked task ids of one change, or undefined when its tasks.md is unreadable. */
export function checkedTaskIdsOf(workspace: string, change: string): string[] | undefined {
  try {
    return checkedTaskIds(
      readFileSync(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8'),
    )
  } catch {
    return undefined
  }
}

export interface NumberedTask {
  readonly id: string
  readonly number: string
  readonly text: string
}

/** One numbered task by its stable id, checked or not. */
export function findTaskOf(markdown: string, taskId: string): NumberedTask | undefined {
  for (const match of markdown.matchAll(/^\s*-\s*\[[ xX]\]\s+(\d+(?:\.\d+)*)\s+(\S.*?)\s*$/gmu)) {
    const text = match[2] ?? ''
    if (taskIdOf(text) === taskId) {
      return { id: taskId, number: match[1] ?? '', text }
    }
  }
  return undefined
}

/** One numbered task of one change, or undefined when tasks.md is unreadable. */
export function taskOf(
  workspace: string,
  change: string,
  taskId: string,
): NumberedTask | undefined {
  try {
    return findTaskOf(
      readFileSync(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8'),
      taskId,
    )
  } catch {
    return undefined
  }
}

/** One numbered task line with its checkbox state. */
export interface NumberedTaskLine extends NumberedTask {
  readonly checked: boolean
}

const TASK_LINE = /^\s*-\s*\[([ xX])\]\s+(\d+(?:\.\d+)*)\s+(\S.*?)\s*$/gmu

/** Every numbered task in file order, checked or not. */
export function numberedTasks(markdown: string): NumberedTaskLine[] {
  const tasks: NumberedTaskLine[] = []
  for (const match of markdown.matchAll(TASK_LINE)) {
    const text = match[3] ?? ''
    tasks.push({
      id: taskIdOf(text),
      number: match[2] ?? '',
      text,
      checked: match[1]?.toLowerCase() === 'x',
    })
  }
  return tasks
}

/** One level-2 lane heading: its title, owned paths, and unchecked tasks. */
export interface TaskLaneView {
  readonly n: number
  readonly title: string
  readonly owned: readonly string[]
  readonly unchecked: readonly string[]
  readonly checked: readonly string[]
  readonly serial: boolean
}

/**
 * Parse the level-2 headings as lanes. A heading's backticked path-like tokens
 * are its owned paths; the numbered tasks until the next level-2 heading belong
 * to it. A title carrying "serial" is the plan's tail and never parallel work.
 */
export function taskLanes(markdown: string): TaskLaneView[] {
  const lanes: TaskLaneView[] = []
  let current:
    | {
        n: number
        title: string
        owned: string[]
        unchecked: string[]
        checked: string[]
      }
    | undefined
  for (const line of markdown.split(/\r?\n/u)) {
    if (line.startsWith('## ')) {
      const title = line.slice(3).trim()
      const owned = [...title.matchAll(/`([^`]+)`/gu)]
        .map((match) => match[1]?.trim() ?? '')
        .filter((entry) => /[\\/]|\*/u.test(entry))
      current = { n: lanes.length + 1, title, owned, unchecked: [], checked: [] }
      lanes.push({
        n: current.n,
        title,
        owned,
        unchecked: current.unchecked,
        checked: current.checked,
        serial: /serial/iu.test(title),
      })
      continue
    }
    if (current === undefined) continue
    const task = TASK_LINE.exec(line)
    TASK_LINE.lastIndex = 0
    if (task === null) continue
    if (task[1]?.toLowerCase() === 'x') current.checked.push(task[2] ?? '')
    else current.unchecked.push(task[2] ?? '')
  }
  return lanes
}
