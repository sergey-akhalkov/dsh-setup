/**
 * Approval audit and export for portable task-review records.
 *
 * `--change <name>` audits one active change, `--all` audits the archived
 * changes against the marker cutoff and exception, `--push` audits the archived
 * changes a push adds (reading the pre-push refs from stdin), and
 * `--export --change <name>` copies existing local `.dsh` PASS records into the
 * change. Every mode fails closed: an unknown range or unreadable evidence is a
 * refusal that names the manual command.
 */

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  APPROVAL_MARKER_FILE,
  type ApprovalCoverage,
  type ApprovalRecordState,
  approvalSummaryLine,
  computeApprovalCoverage,
  formatApprovalGapLines,
  localTaskRecordPath,
  type PortableTaskReviewRecord,
  parsePortableTaskReviewRecord,
  parseReviewApprovalMarker,
  parseTasksText,
  portableRecordFromLocal,
  portableTaskRecordDisplayPath,
  portableTaskRecordPath,
  REVIEWS_DIRECTORY,
  type ReviewApprovalMarker,
  unparseableCheckedLines,
} from '../packages/plugin-delegation-rules/src/shared/approval.ts'

const MANUAL_AUDIT = 'run `pnpm reviews:check --all` manually'
const ZERO_SHA = /^0+$/
const ARCHIVE_PREFIX = /^\d{4}-\d{2}-\d{2}-/
const ARCHIVE_PATH = /^openspec\/changes\/archive\/([^/]+)\//

export type MarkerRead =
  | { kind: 'missing' }
  | { kind: 'malformed'; error: string }
  | { kind: 'marker'; marker: ReviewApprovalMarker }

export interface AuditResult {
  ok: boolean
  lines: string[]
}

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

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function git(cwd: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw new Error(`git could not run: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = (result.stderr ?? '').trim().replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`git ${args[0] ?? 'command'} failed${detail === '' ? '' : `: ${detail}`}`)
  }
  return result.stdout
}

function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd,
    encoding: 'utf8',
  })
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(
    `git merge-base --is-ancestor failed${result.error === undefined ? '' : `: ${result.error.message}`}`,
  )
}

/** `2026-10-29-add-change` -> `add-change`. */
export function archivedChangeName(directory: string): string {
  return directory.replace(ARCHIVE_PREFIX, '')
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

/** The rule whose task-review PASS is the approval for a change. */
export function approvalRuleOf(marker: MarkerRead): string {
  return marker.kind === 'marker' ? marker.marker.taskRule : 'task-review'
}

function inspectPortableRecord(changeDir: string, taskId: string): ApprovalRecordState {
  let raw: string
  try {
    raw = readFileSync(portableTaskRecordPath(changeDir, taskId), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'malformed', error: message(error) }
  }
  try {
    const parsed = parsePortableTaskReviewRecord(JSON.parse(raw))
    return parsed.record === undefined
      ? { kind: 'malformed', error: parsed.error ?? 'record shape is invalid' }
      : { kind: 'record', record: parsed.record }
  } catch (error) {
    return { kind: 'malformed', error: message(error) }
  }
}

interface ChangeAudit {
  ok: boolean
  lines: string[]
  coverage?: ApprovalCoverage
}

/** PASS-only coverage of one change directory with the shared wording. */
async function auditChange(
  changeDir: string,
  displayDir: string,
  change: string,
  rule: string,
): Promise<ChangeAudit> {
  let markdown: string
  try {
    markdown = readFileSync(join(changeDir, 'tasks.md'), 'utf8')
  } catch (error) {
    return { ok: false, lines: [`${displayDir}: tasks.md is unreadable (${message(error)})`] }
  }
  const coverage = await computeApprovalCoverage({
    change,
    rule,
    tasks: parseTasksText(markdown),
    unparseable: unparseableCheckedLines(markdown),
    recordPath: (taskId) => `${displayDir}/${REVIEWS_DIRECTORY}/${taskId}.json`,
    inspect: (taskId) => inspectPortableRecord(changeDir, taskId),
  })
  const lines = [`${displayDir}: ${approvalSummaryLine(coverage)}`]
  for (const gap of formatApprovalGapLines(coverage)) lines.push(`  ${gap}`)
  return { ok: coverage.archiveReady, lines, coverage }
}

function treeFile(cwd: string, sha: string, path: string): string | undefined {
  try {
    return git(cwd, ['show', `${sha}:${path}`])
  } catch {
    return undefined
  }
}

function treeFiles(cwd: string, sha: string, path: string): string[] {
  try {
    return git(cwd, ['ls-tree', '-r', '--name-only', sha, '--', path])
      .split('\n')
      .filter((entry) => entry !== '')
  } catch {
    return []
  }
}

function treeHas(cwd: string, sha: string, path: string): boolean {
  try {
    git(cwd, ['cat-file', '-e', `${sha}:${path}`])
    return true
  } catch {
    return false
  }
}

function readMarkerFromTree(cwd: string, sha: string): MarkerRead {
  const raw = treeFile(cwd, sha, `openspec/${APPROVAL_MARKER_FILE}`)
  if (raw === undefined) return { kind: 'missing' }
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

/** Coverage read from one pushed commit tree, never from the working directory. */
async function auditTreeChange(
  cwd: string,
  sha: string,
  displayDir: string,
  change: string,
  rule: string,
): Promise<ChangeAudit> {
  const markdown = treeFile(cwd, sha, `${displayDir}/tasks.md`)
  if (markdown === undefined) {
    return {
      ok: false,
      lines: [`${displayDir}: tasks.md is missing from the pushed tree`],
    }
  }
  const records = new Map<string, string>()
  for (const path of treeFiles(cwd, sha, `${displayDir}/${REVIEWS_DIRECTORY}`)) {
    const name = path.slice(path.lastIndexOf('/') + 1)
    if (!name.endsWith('.json')) continue
    const content = treeFile(cwd, sha, path)
    if (content !== undefined) records.set(name.slice(0, -'.json'.length), content)
  }
  const coverage = await computeApprovalCoverage({
    change,
    rule,
    tasks: parseTasksText(markdown),
    unparseable: unparseableCheckedLines(markdown),
    recordPath: (taskId) => `${displayDir}/${REVIEWS_DIRECTORY}/${taskId}.json`,
    inspect: (taskId) => {
      const raw = records.get(taskId)
      if (raw === undefined) return { kind: 'missing' }
      try {
        const parsed = parsePortableTaskReviewRecord(JSON.parse(raw))
        return parsed.record === undefined
          ? { kind: 'malformed', error: parsed.error ?? 'record shape is invalid' }
          : { kind: 'record', record: parsed.record }
      } catch (error) {
        return { kind: 'malformed', error: message(error) }
      }
    },
  })
  const lines = [`${displayDir}: ${approvalSummaryLine(coverage)}`]
  for (const gap of formatApprovalGapLines(coverage)) lines.push(`  ${gap}`)
  return { ok: coverage.archiveReady, lines, coverage }
}

function invalidLocalAudit(reason: string): AuditResult {
  return { ok: false, lines: [`review approval: ${reason}`] }
}

/** Audit one active change under `openspec/changes/<name>`. */
export async function auditActive(cwd: string, change: string): Promise<AuditResult> {
  const openspecRoot = findOpenSpecRoot(cwd)
  if (openspecRoot === undefined) {
    return invalidLocalAudit('no openspec/changes directory was found from the working directory')
  }
  const changeDir = join(openspecRoot, 'changes', change)
  if (!statSync(changeDir, { throwIfNoEntry: false })?.isDirectory()) {
    return invalidLocalAudit(`change "${change}" was not found under openspec/changes`)
  }
  const marker = readMarker(openspecRoot)
  if (marker.kind === 'malformed') return invalidLocalAudit(marker.error)
  const rule = approvalRuleOf(marker)
  const audit = await auditChange(changeDir, `openspec/changes/${change}`, change, rule)
  return {
    ok: audit.ok,
    lines: [`review approval: change "${change}" (rule "${rule}")`, ...audit.lines],
  }
}

type ArchiveKind = { kind: 'baseline' } | { kind: 'exception'; reason: string } | { kind: 'normal' }

interface ArchiveClassification {
  kind?: ArchiveKind
  error?: string
}

function grandfatheredReason(marker: MarkerRead, change: string): string | undefined {
  return marker.kind === 'marker' ? marker.marker.grandfathered?.[change] : undefined
}

function archiveKind(reason: string | undefined): ArchiveKind {
  return reason === undefined ? { kind: 'baseline' } : { kind: 'exception', reason }
}

/** Baseline/exception/normal from git history: pre-cutoff and unmodified after the cutoff. */
function classifyArchive(
  cwd: string,
  change: string,
  displayDir: string,
  marker: MarkerRead,
  cutoffCommit: string | undefined,
): ArchiveClassification {
  if (marker.kind !== 'marker' || cutoffCommit === undefined) return { kind: { kind: 'normal' } }
  try {
    const added = git(cwd, ['log', '--diff-filter=A', '--format=%H', '--reverse', '--', displayDir])
      .trim()
      .split('\n')
      .filter((line) => line !== '')
    const first = added[0]
    if (first === undefined) {
      return { error: 'the archive has no commit that added it; commit it before auditing' }
    }
    const modifiedAfter = git(cwd, ['rev-list', `${cutoffCommit}..HEAD`, '--', displayDir]).trim()
    if (modifiedAfter !== '' || !isAncestor(cwd, first, cutoffCommit)) {
      return { kind: { kind: 'normal' } }
    }
    return { kind: archiveKind(grandfatheredReason(marker, change)) }
  } catch (error) {
    return { error: `cannot determine the archive history (${message(error)})` }
  }
}

/** Push classification from the pushed tip: every pushed commit touching the archive must be pre-cutoff. */
function classifyPushedArchive(
  cwd: string,
  tipSha: string,
  change: string,
  displayDir: string,
  commits: readonly string[],
  marker: MarkerRead,
  cutoffCommit: string | undefined,
): ArchiveClassification {
  if (marker.kind !== 'marker' || cutoffCommit === undefined) return { kind: { kind: 'normal' } }
  try {
    const added = git(cwd, [
      'log',
      tipSha,
      '--diff-filter=A',
      '--format=%H',
      '--reverse',
      '--',
      displayDir,
    ])
      .trim()
      .split('\n')
      .filter((line) => line !== '')
    const first = added[0]
    if (first === undefined) {
      return { error: 'the archive has no commit that added it; commit it before pushing' }
    }
    const beforeCutoff =
      isAncestor(cwd, first, cutoffCommit) &&
      commits.every((commit) => isAncestor(cwd, commit, cutoffCommit))
    if (!beforeCutoff) return { kind: { kind: 'normal' } }
    return { kind: archiveKind(grandfatheredReason(marker, change)) }
  } catch (error) {
    return { error: `cannot determine the archive history (${message(error)})` }
  }
}

function cutoffCommitOf(cwd: string, marker: MarkerRead): { commit?: string; error?: string } {
  const cutoff = marker.kind === 'marker' ? marker.marker.cutoff : undefined
  if (cutoff === undefined) return {}
  try {
    return { commit: git(cwd, ['rev-parse', `${cutoff}^{commit}`]).trim() }
  } catch (error) {
    return {
      error: `cannot resolve the approval cutoff tag "${cutoff}" (${message(error)}); ${MANUAL_AUDIT}`,
    }
  }
}

/** Audit every archived change against the marker cutoff and exception. */
export async function auditAll(cwd: string): Promise<AuditResult> {
  const openspecRoot = findOpenSpecRoot(cwd)
  if (openspecRoot === undefined) {
    return invalidLocalAudit('no openspec/changes directory was found from the working directory')
  }
  const marker = readMarker(openspecRoot)
  if (marker.kind === 'malformed') return invalidLocalAudit(marker.error)
  const rule = approvalRuleOf(marker)
  const cutoff = cutoffCommitOf(cwd, marker)
  if (cutoff.error !== undefined) return invalidLocalAudit(cutoff.error)
  const archiveRoot = join(openspecRoot, 'changes', 'archive')
  if (!statSync(archiveRoot, { throwIfNoEntry: false })?.isDirectory()) {
    return { ok: true, lines: ['review approval: no archived changes'] }
  }
  const directories = readdirSync(archiveRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const cutoffLabel = marker.kind === 'marker' ? marker.marker.cutoff : undefined
  const lines = [
    `review approval: ${directories.length} archived change(s) (rule "${rule}"${cutoffLabel === undefined ? '' : `, cutoff ${cutoffLabel}`})`,
  ]
  let ok = true
  for (const directory of directories) {
    const change = archivedChangeName(directory)
    const displayDir = `openspec/changes/archive/${directory}`
    const classification = classifyArchive(cwd, change, displayDir, marker, cutoff.commit)
    if (classification.error !== undefined) {
      ok = false
      lines.push(`${displayDir}: ${classification.error}; ${MANUAL_AUDIT}`)
      continue
    }
    const audit = await auditChange(join(archiveRoot, directory), displayDir, change, rule)
    if (audit.coverage === undefined) {
      ok = false
      lines.push(...audit.lines)
      continue
    }
    const kind = classification.kind as ArchiveKind
    if (kind.kind !== 'normal') {
      const label =
        kind.kind === 'exception'
          ? `v0.12.0 exception (${kind.reason})`
          : 'pre-cutoff historical baseline'
      lines.push(
        `${change}: ${label}, ${audit.coverage.checked} checked task(s), no retroactive portable records; reported, not enforced`,
      )
      continue
    }
    if (!audit.ok) ok = false
    lines.push(...audit.lines)
  }
  lines.push(
    ok
      ? 'review approval: every post-cutoff archived change is approved'
      : 'review approval: missing approvals; fix the lines above',
  )
  return { ok, lines }
}

function failClosed(reason: string): AuditResult {
  return { ok: false, lines: [`review approval: ${reason}; ${MANUAL_AUDIT} (fails closed)`] }
}

interface PushRef {
  localRef: string
  localSha: string
  remoteRef: string
  remoteSha: string
}

function parsePushRefs(stdin: string): PushRef[] | undefined {
  const refs: PushRef[] = []
  for (const line of stdin.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const [localRef, localSha, remoteRef, remoteSha] = trimmed.split(/\s+/)
    if (
      localRef === undefined ||
      localSha === undefined ||
      remoteRef === undefined ||
      remoteSha === undefined
    ) {
      return undefined
    }
    refs.push({ localRef, localSha, remoteRef, remoteSha })
  }
  return refs
}

interface PushedArchive {
  displayDir: string
  commits: string[]
}

function pushedCommits(cwd: string, ref: PushRef, tipSha: string): string[] {
  if (ZERO_SHA.test(ref.remoteSha)) {
    return git(cwd, ['rev-list', tipSha, '--not', '--remotes'])
      .split('\n')
      .filter((sha) => sha !== '')
  }
  try {
    git(cwd, ['cat-file', '-e', `${ref.remoteSha}^{commit}`])
  } catch {
    throw new Error(
      `the remote commit ${ref.remoteSha} for ${ref.remoteRef} is not available locally`,
    )
  }
  return git(cwd, ['rev-list', `${ref.remoteSha}..${tipSha}`])
    .split('\n')
    .filter((sha) => sha !== '')
}

/** Touched archive directories, including deletions and merge diffs, so nothing bypasses approval. */
function touchedArchives(cwd: string, commits: readonly string[]): Map<string, PushedArchive> {
  const touched = new Map<string, PushedArchive>()
  for (const sha of commits) {
    const output = git(cwd, [
      'diff-tree',
      '--root',
      '-m',
      '--no-commit-id',
      '--name-status',
      '-r',
      '--no-renames',
      sha,
    ])
    for (const row of output.split('\n')) {
      const [, path] = row.split('\t')
      if (path === undefined) continue
      const directory = ARCHIVE_PATH.exec(path)?.[1]
      if (directory === undefined) continue
      const entry = touched.get(directory) ?? {
        displayDir: `openspec/changes/archive/${directory}`,
        commits: [],
      }
      if (!entry.commits.includes(sha)) entry.commits.push(sha)
      touched.set(directory, entry)
    }
  }
  return touched
}

/** Audit the archived changes the pushed commit range adds or modifies. */
export async function auditPush(cwd: string, stdin: string): Promise<AuditResult> {
  const refs = parsePushRefs(stdin)
  if (refs === undefined) return failClosed('a pre-push line could not be parsed')
  if (refs.length === 0) return failClosed('no pre-push refs were provided on stdin')
  const live = refs.filter((ref) => !ZERO_SHA.test(ref.localSha))
  if (live.length === 0) {
    return {
      ok: true,
      lines: ['review approval: the pushed range adds or modifies no archived change'],
    }
  }
  const lines: string[] = []
  let ok = true
  let audited = 0
  for (const ref of live) {
    let tip: string
    try {
      tip = git(cwd, ['rev-parse', `${ref.localSha}^{commit}`]).trim()
    } catch (error) {
      return failClosed(`cannot resolve ${ref.localRef} (${message(error)})`)
    }
    const marker = readMarkerFromTree(cwd, tip)
    if (marker.kind === 'malformed') return failClosed(`${ref.localRef}: ${marker.error}`)
    if (marker.kind === 'missing') continue
    const rule = approvalRuleOf(marker)
    const cutoff = cutoffCommitOf(cwd, marker)
    if (cutoff.error !== undefined) return failClosed(cutoff.error)
    let touched: Map<string, PushedArchive>
    try {
      touched = touchedArchives(cwd, pushedCommits(cwd, ref, tip))
    } catch (error) {
      return failClosed(`cannot determine the pushed commit range (${message(error)})`)
    }
    if (touched.size === 0) continue
    lines.push(
      `review approval: ${ref.localRef} (${touched.size} archived change(s) in the pushed range, rule "${rule}")`,
    )
    for (const [directory, entry] of [...touched.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      if (!treeHas(cwd, tip, entry.displayDir)) continue
      audited += 1
      const change = archivedChangeName(directory)
      const firstCommit = entry.commits[0] as string
      const classification = classifyPushedArchive(
        cwd,
        tip,
        change,
        entry.displayDir,
        entry.commits,
        marker,
        cutoff.commit,
      )
      if (classification.error !== undefined) {
        ok = false
        lines.push(
          `${entry.displayDir} (commit ${firstCommit.slice(0, 12)}): ${classification.error}`,
        )
        continue
      }
      const audit = await auditTreeChange(cwd, tip, entry.displayDir, change, rule)
      const kind = classification.kind as ArchiveKind
      if (kind.kind !== 'normal') {
        lines.push(
          `${change} (commit ${firstCommit.slice(0, 12)}): ${kind.kind === 'exception' ? 'v0.12.0 exception' : 'pre-cutoff historical baseline'}, ${audit.coverage?.checked ?? 0} checked task(s); reported, not enforced`,
        )
        continue
      }
      if (!audit.ok) ok = false
      lines.push(...audit.lines.map((line) => `${line} (commit ${firstCommit.slice(0, 12)})`))
    }
  }
  if (audited === 0) {
    return {
      ok: true,
      lines: ['review approval: the pushed range adds or modifies no archived change'],
    }
  }
  lines.push(
    ok
      ? 'review approval: the pushed archived changes are approved'
      : 'review approval: refusing the push; fix the lines above',
  )
  return { ok, lines }
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

type CliMode = 'export' | 'change' | 'all' | 'push'

interface CliArguments {
  mode: CliMode
  change?: string
}

const USAGE = 'usage: reviews-check --export --change <name> | --change <name> | --all | --push'

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index < 0 ? undefined : argv[index + 1]
  if (value === undefined || value.trim() === '' || value.startsWith('--')) return undefined
  return value
}

function parseArguments(argv: readonly string[]): CliArguments | { error: string } {
  if (argv.includes('--export')) {
    const change = flagValue(argv, '--change')
    return change === undefined
      ? { error: 'reviews:export needs --change <name>' }
      : { mode: 'export', change }
  }
  if (argv.includes('--all')) return { mode: 'all' }
  if (argv.includes('--push')) return { mode: 'push' }
  const change = flagValue(argv, '--change')
  if (argv.includes('--change')) {
    return change === undefined
      ? { error: '--change needs a change name' }
      : { mode: 'change', change }
  }
  return { error: USAGE }
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArguments(argv)
  if ('error' in parsed) {
    console.error(parsed.error)
    return 2
  }
  let result: AuditResult
  if (parsed.mode === 'export') {
    result = exportChange(process.cwd(), parsed.change as string)
  } else if (parsed.mode === 'change') {
    result = await auditActive(process.cwd(), parsed.change as string)
  } else if (parsed.mode === 'all') {
    result = await auditAll(process.cwd())
  } else if (process.stdin.isTTY === true) {
    result = failClosed('no pre-push refs were provided on stdin')
  } else {
    try {
      result = await auditPush(process.cwd(), readFileSync(0, 'utf8'))
    } catch (error) {
      result = failClosed(`cannot read the pre-push refs from stdin (${message(error)})`)
    }
  }
  console.log(result.lines.join('\n'))
  return result.ok ? 0 : 1
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
