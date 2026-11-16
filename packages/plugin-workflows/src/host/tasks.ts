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

/** True only while the task is checked in the live tasks.md. */
export function isTaskChecked(workspace: string, change: string, taskId: string): boolean {
  return checkedTaskIdsOf(workspace, change)?.includes(taskId) ?? false
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

const normalizeText = (text: string): string => text.replace(/\s+/gu, ' ').trim()

/** One `tasks.md` level-2 section with its numbered tasks and checked coverage. */
export interface TaskSection {
  readonly key: string
  readonly title: string
  readonly tasks: readonly NumberedTaskLine[]
  readonly covered: readonly NumberedTaskLine[]
  readonly unchecked: readonly NumberedTaskLine[]
}

/** The leading heading number (`1`, `2.1`) of a level-2 title, when it has one. */
function sectionNumber(title: string): string | undefined {
  return /^(\d+(?:\.\d+)*)\.?(?:\s|$)/u.exec(title)?.[1]
}

/** The stable section key: heading number, normalized title, or `untitled`. */
function sectionKeyOf(title: string): string {
  const number = sectionNumber(title)
  if (number !== undefined) return number
  const normalized = normalizeText(title)
  return normalized === '' ? 'untitled' : normalized
}

/**
 * The stable 16-hex record id a section run's evidence path names in place of a
 * task id. It is not a task id: the section record covers several tasks.
 */
export function sectionRecordId(key: string): string {
  return createHash('sha256').update(`workflows-section-v1\u0000${key}`).digest('hex').slice(0, 16)
}

function sectionOf(title: string, tasks: NumberedTaskLine[]): TaskSection {
  return {
    key: sectionKeyOf(title),
    title,
    tasks,
    covered: tasks.filter((task) => task.checked),
    unchecked: tasks.filter((task) => !task.checked),
  }
}

/** Every level-2 section with its numbered tasks, checked or not. */
function taskSections(markdown: string): TaskSection[] {
  const sections: Array<{ title: string; tasks: NumberedTaskLine[] }> = []
  const untitled: NumberedTaskLine[] = []
  let current: { title: string; tasks: NumberedTaskLine[] } | undefined
  for (const line of markdown.split(/\r?\n/u)) {
    const heading = /^##[ \t]+(.+?)[ \t]*$/u.exec(line)
    if (heading !== null) {
      current = { title: normalizeText(heading[1] ?? ''), tasks: [] }
      sections.push(current)
      continue
    }
    const task = TASK_LINE.exec(line)
    TASK_LINE.lastIndex = 0
    if (task === null) continue
    const text = normalizeText(task[3] ?? '')
    const entry: NumberedTaskLine = {
      id: taskIdOf(text),
      number: task[2] ?? '',
      text,
      checked: task[1]?.toLowerCase() === 'x',
    }
    if (current === undefined) untitled.push(entry)
    else current.tasks.push(entry)
  }
  const built = sections.map((section) => sectionOf(section.title, section.tasks))
  return untitled.length === 0 ? built : [sectionOf('', untitled), ...built]
}

/** One-line description of a section's selectors, for a rejection message. */
function sectionLabel(section: TaskSection): string {
  const title = normalizeText(section.title)
  const number = sectionNumber(title)
  if (number === undefined) return title === '' ? 'untitled (untitled)' : title.slice(0, 80)
  const bare = normalizeText(title.slice(number.length).replace(/^\./u, ''))
  return `${number} ${bare.slice(0, 80)}`
}

/**
 * Resolve a section selector against the level-2 task groups: the heading
 * number (`1`), its wildcard form (`1.x`), the normalized or bare title, or
 * `untitled`. Every rejection names the available sections.
 */
export function resolveTaskSection(markdown: string, wanted: string, change: string): TaskSection {
  const sections = taskSections(markdown)
  const needle = normalizeText(wanted)
  const lower = needle.toLowerCase()
  const wildcard = /^(\d+(?:\.\d+)*)\.(?:x|\*)$/iu.exec(needle)
  const matches = sections.filter((section) => {
    const number = sectionNumber(section.title)
    const title = normalizeText(section.title)
    const bare =
      number === undefined ? title : normalizeText(title.slice(number.length).replace(/^\./u, ''))
    return (
      (title !== '' && title.toLowerCase() === lower) ||
      (title !== '' && bare.toLowerCase() === lower) ||
      (number !== undefined && number === needle) ||
      (number !== undefined && wildcard?.[1] === number) ||
      (title === '' && lower === 'untitled')
    )
  })
  if (matches.length === 0) {
    throw new Error(
      `section "${wanted}" was not found in change "${change}"; available sections: ${
        sections.map((section) => sectionLabel(section)).join('; ') || '(none)'
      }`,
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `section "${wanted}" is ambiguous in change "${change}"; it matches: ${matches
        .map((section) => sectionLabel(section))
        .join('; ')} - pass the heading number instead`,
    )
  }
  const section = matches[0] as TaskSection
  const sameKey = sections.filter((entry) => entry.key === section.key)
  if (sameKey.length > 1) {
    throw new Error(
      `section "${wanted}" resolves to key "${section.key}", shared by ${String(sameKey.length)} sections in change "${change}"; rename one heading so the key is unique. Available sections: ${sections
        .map((entry) => sectionLabel(entry))
        .join('; ')}`,
    )
  }
  if (section.tasks.length === 0) {
    throw new Error(
      `section "${wanted}" in change "${change}" has no numbered tasks; available sections: ${sections
        .map((entry) => sectionLabel(entry))
        .join('; ')}`,
    )
  }
  if (section.covered.length === 0) {
    throw new Error(
      `section "${wanted}" in change "${change}" has no checked task; tick the completed tasks, then run the section review. Unchecked tasks: ${section.tasks
        .map((task) => `${task.number} ${task.text}`)
        .join('; ')}`,
    )
  }
  return section
}

/**
 * Re-resolve one section by key and prove its submitted covered ids are still
 * checked; a changed set or checkbox needs a fresh review, never a widened one.
 */
export function sectionCoverage(
  markdown: string,
  key: string,
  taskIds: readonly string[],
):
  | { readonly section: TaskSection; readonly covered: NumberedTaskLine[] }
  | { readonly error: string } {
  const sections = taskSections(markdown)
  const sameKey = sections.filter((entry) => entry.key === key)
  if (sameKey.length !== 1) {
    return {
      error:
        sameKey.length === 0
          ? `section "${key}" is no longer present in tasks.md`
          : `section "${key}" is no longer unique in tasks.md`,
    }
  }
  const section = sameKey[0] as TaskSection
  const covered: NumberedTaskLine[] = []
  for (const id of taskIds) {
    const task = section.tasks.find((entry) => entry.id === id)
    if (task === undefined) {
      return { error: `a covered task is no longer present in section "${key}"` }
    }
    if (!task.checked) {
      return {
        error: `task "${task.number} ${task.text}" is not checked in section "${key}"`,
      }
    }
    covered.push(task)
  }
  return { section, covered }
}
