/**
 * Approval audit and export for portable task-review records.
 *
 * `--export --change <name>` copies existing local `.dsh` PASS records into the
 * change as committed `reviews/<taskId>.json` approval evidence. It copies an
 * existing PASS only; it cannot invent one.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  APPROVAL_MARKER_FILE,
  localTaskRecordPath,
  type PortableTaskReviewRecord,
  parsePortableTaskReviewRecord,
  parseReviewApprovalMarker,
  parseTasksText,
  portableRecordFromLocal,
  portableTaskRecordDisplayPath,
  portableTaskRecordPath,
  type ReviewApprovalMarker,
  unparseableCheckedLines,
} from '../packages/plugin-delegation-rules/src/shared/approval.ts'

export type MarkerRead =
  | { kind: 'missing' }
  | { kind: 'malformed'; error: string }
  | { kind: 'marker'; marker: ReviewApprovalMarker }

/** Nearest ancestor of `cwd` that contains `openspec/changes`. */
export function findOpenSpecRoot(cwd: string): string | undefined {
  let current = cwd
  for (;;) {
    if (statSync(join(current, 'openspec', 'changes'), { throwIfNoEntry: false })?.isDirectory()) {
      return join(current, 'openspec')
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function readMarker(openspecRoot: string): MarkerRead {
  const path = join(openspecRoot, APPROVAL_MARKER_FILE)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'malformed', error: `could not read ${APPROVAL_MARKER_FILE}: ${message(error)}` }
  }
  try {
    const parsed = parseReviewApprovalMarker(JSON.parse(raw))
    return parsed.marker === undefined
      ? { kind: 'malformed', error: `${APPROVAL_MARKER_FILE}: ${parsed.error ?? 'invalid marker'}` }
      : { kind: 'marker', marker: parsed.marker }
  } catch (error) {
    return {
      kind: 'malformed',
      error: `${APPROVAL_MARKER_FILE} is not valid JSON: ${message(error)}`,
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporary, path)
}

export interface ExportResult {
  ok: boolean
  lines: string[]
}

/** The rule whose task-review PASS is the approval for a change. */
export function approvalRuleOf(marker: MarkerRead): string {
  return marker.kind === 'marker' ? marker.marker.taskRule : 'task-review'
}

/** Copy each checked task's local `.dsh` PASS into the change's reviews/ directory. */
export function exportChange(cwd: string, change: string): ExportResult {
  const lines: string[] = []
  const openspecRoot = findOpenSpecRoot(cwd)
  if (openspecRoot === undefined) {
    return {
      ok: false,
      lines: ['no openspec/changes directory was found from the working directory'],
    }
  }
  const changeDir = join(openspecRoot, 'changes', change)
  if (!statSync(changeDir, { throwIfNoEntry: false })?.isDirectory()) {
    return { ok: false, lines: [`change "${change}" was not found under openspec/changes`] }
  }
  const marker = readMarker(openspecRoot)
  if (marker.kind === 'malformed') {
    return { ok: false, lines: [marker.error] }
  }
  const rule = approvalRuleOf(marker)

  let markdown: string
  try {
    markdown = readFileSync(join(changeDir, 'tasks.md'), 'utf8')
  } catch (error) {
    return { ok: false, lines: [`change "${change}" has no readable tasks.md: ${message(error)}`] }
  }
  const tasks = parseTasksText(markdown)
  const unparseable = unparseableCheckedLines(markdown)
  lines.push(`reviews:export change "${change}" (rule "${rule}")`)
  let failed = false
  let written = 0
  for (const line of unparseable) {
    failed = true
    lines.push(
      `  failed: checked line ${line.line} "${line.text}" is not a numbered task; fix tasks.md first`,
    )
  }
  for (const task of tasks) {
    if (!task.checked) continue
    const portablePath = portableTaskRecordPath(changeDir, task.id)
    if (existsSync(portablePath)) {
      const existing = readExistingRecord(portablePath)
      if (
        existing !== undefined &&
        existing.rule === rule &&
        existing.change === change &&
        existing.taskId === task.id &&
        existing.verdict === 'PASS'
      ) {
        lines.push(
          `  already present: ${portableTaskRecordDisplayPath(`openspec/changes/${change}`, task.id)}`,
        )
        continue
      }
      failed = true
      lines.push(
        `  failed ${task.number} "${task.text}": an existing record at ${portableTaskRecordDisplayPath(`openspec/changes/${change}`, task.id)} is not a valid PASS; review it manually`,
      )
      continue
    }
    const localPath = localTaskRecordPath(cwd, rule, change, task.id)
    let localValue: unknown
    try {
      localValue = JSON.parse(readFileSync(localPath, 'utf8'))
    } catch (error) {
      failed = true
      lines.push(
        `  failed ${task.number} "${task.text}": no readable local PASS record at ${localTaskRecordPath('.', rule, change, task.id).replaceAll('\\', '/')} (${message(error)})`,
      )
      continue
    }
    const copied = portableRecordFromLocal({ value: localValue, rule, change, taskId: task.id })
    if (copied.record === undefined) {
      failed = true
      lines.push(`  failed ${task.number} "${task.text}": ${copied.error}`)
      continue
    }
    writeJsonAtomic(portablePath, copied.record)
    written += 1
    lines.push(`  wrote ${portableTaskRecordDisplayPath(`openspec/changes/${change}`, task.id)}`)
  }
  lines.push(
    failed
      ? `export incomplete: ${written} record(s) written; fix the failures above and re-run`
      : `export complete: ${written} record(s) written`,
  )
  return { ok: !failed, lines }
}

function readExistingRecord(path: string): PortableTaskReviewRecord | undefined {
  try {
    const parsed = parsePortableTaskReviewRecord(JSON.parse(readFileSync(path, 'utf8')))
    return parsed.record
  } catch {
    return undefined
  }
}

interface ExportArguments {
  change: string
}

function parseExportArguments(argv: readonly string[]): ExportArguments | undefined {
  const index = argv.indexOf('--change')
  const change = index < 0 ? undefined : argv[index + 1]
  if (change === undefined || change.trim() === '') return undefined
  return { change }
}

function main(argv: readonly string[] = process.argv.slice(2)): number {
  if (!argv.includes('--export')) {
    console.error(
      'usage: reviews-check --export --change <name> | --change <name> | --all | --push',
    )
    return 2
  }
  const args = parseExportArguments(argv)
  if (args === undefined) {
    console.error('reviews:export needs --change <name>')
    return 2
  }
  const result = exportChange(process.cwd(), args.change)
  console.log(result.lines.join('\n'))
  return result.ok ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
