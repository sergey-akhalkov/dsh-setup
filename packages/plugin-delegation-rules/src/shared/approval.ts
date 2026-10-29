/**
 * Pure approval core shared by the Host engine and the repository audit script.
 * No DSH imports and no filesystem access: the Host and `scripts/reviews-check.ts`
 * must compute the same task ids, records, coverage, and archive recognition.
 */

import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

/** Stable 16-hex task id: sha256 of the whitespace-normalized numbered task text. */
export const TASK_ID_PATTERN = /^[0-9a-f]{16}$/
/** Change directory names are plain kebab-ish names. */
export const CHANGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/
/** A review digest; the same shape for the task digest and the worktree digest. */
export const DIGEST_PATTERN = /^[0-9a-f]{64}$/
/** Kebab-case rule ids, matching the engine's rule validation. */
export const RULE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Reserved directory inside a change that holds portable approval records. */
export const REVIEWS_DIRECTORY = 'reviews'
/** Repository opt-in marker, relative to the OpenSpec root. */
export const APPROVAL_MARKER_FILE = 'review-approval.json'

/** One numbered checkbox task parsed from `tasks.md`. */
export interface NumberedTask {
  id: string
  at: number
  number: string
  text: string
  checked: boolean
}

export function normalizeTaskText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function taskIdOf(text: string): string {
  return createHash('sha256').update(normalizeTaskText(text)).digest('hex').slice(0, 16)
}

export function parseTasksText(markdown: string): NumberedTask[] {
  const tasks: NumberedTask[] = []
  const pattern = /^\s*-\s*\[([ xX])\]\s+(\d+(?:\.\d+)*)\s+(\S.*?)\s*$/gm
  for (const match of markdown.matchAll(pattern)) {
    const [, mark = ' ', number = '', body = ''] = match
    const text = normalizeTaskText(body)
    tasks.push({ id: taskIdOf(text), at: match.index ?? 0, number, text, checked: mark !== ' ' })
  }
  return tasks
}

/** Checkbox state only: a task tick alone never changes this normalized text. */
export function normalizeCheckboxes(markdown: string): string {
  return markdown.replace(/^(\s*-\s*)\[[xX]\]/gm, '$1[ ]')
}

/** One checked markdown line that is not a numbered task; approval fails closed on it. */
export interface UnparseableCheckedLine {
  line: number
  text: string
}

const CHECKED_CHECKBOX = /^\s*[-*+]\s*\[[xX]\]/
const CHECKED_NUMBERED_TASK = /^\s*-\s*\[[xX]\]\s+\d+(?:\.\d+)*\s+\S.*?$/

export function unparseableCheckedLines(markdown: string): UnparseableCheckedLine[] {
  const lines: UnparseableCheckedLine[] = []
  for (const [index, text] of markdown.split(/\r?\n/).entries()) {
    if (!CHECKED_CHECKBOX.test(text) || CHECKED_NUMBERED_TASK.test(text)) continue
    lines.push({ line: index + 1, text: normalizeTaskText(text) })
  }
  return lines
}

/** One review finding; the engine and the portable record share this shape. */
export interface ReviewFinding {
  severity: 'P0' | 'P1'
  title: string
  evidence: string
  fix: string
}

export type ReviewVerdict = 'PASS' | 'FINDINGS' | 'ERROR'

/** The target selection kept in a record; never a machine path. */
export interface ReviewTarget {
  provider: string
  model?: string
  reasoningEffort?: string
}

/** The sanitized, committed approval record for one checked task. */
export interface PortableTaskReviewRecord {
  rule: string
  change: string
  scope: 'task'
  taskId: string
  digest: string
  worktreeDigest?: string
  verdict: ReviewVerdict
  findings: ReviewFinding[]
  target: ReviewTarget
  time: string
}

const RECORD_KEYS = new Set([
  'rule',
  'change',
  'scope',
  'taskId',
  'digest',
  'worktreeDigest',
  'verdict',
  'findings',
  'target',
  'time',
])

const TARGET_KEYS = new Set(['provider', 'model', 'reasoningEffort'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** A field value that could leak the reviewing machine into a committed record. */
function hasMachinePath(text: string): boolean {
  return (
    /[A-Za-z]:[\\/]/.test(text) ||
    /\\\\/.test(text) ||
    /(?:^|[\s"'([{<])\/[^\s"'`)\]}>]+/.test(text) ||
    /(?:^|[\s"'([{<])~[/\\]/.test(text)
  )
}

function isCleanString(value: unknown): value is string {
  return isNonEmptyString(value) && !hasMachinePath(value)
}

export function isReviewFinding(value: unknown): value is ReviewFinding {
  if (!isRecord(value)) return false
  return (
    (value.severity === 'P0' || value.severity === 'P1') &&
    isNonEmptyString(value.title) &&
    isNonEmptyString(value.evidence) &&
    isNonEmptyString(value.fix)
  )
}

function isReviewTarget(value: unknown): value is ReviewTarget {
  if (!isRecord(value)) return false
  if (Object.keys(value).some((key) => !TARGET_KEYS.has(key))) return false
  if (!isCleanString(value.provider)) return false
  if (value.model !== undefined && !isCleanString(value.model)) return false
  if (value.reasoningEffort !== undefined && !isCleanString(value.reasoningEffort)) return false
  return true
}

/**
 * Validate the committed record: only the sanitized fields may appear, so a
 * record carrying a session id, run id, or machine path can never approve.
 */
export function parsePortableTaskReviewRecord(value: unknown): {
  record?: PortableTaskReviewRecord
  error?: string
} {
  if (!isRecord(value)) return { error: 'record must be a JSON object' }
  const unknown = Object.keys(value).filter((key) => !RECORD_KEYS.has(key))
  if (unknown.length > 0) {
    return { error: `record has unsupported field(s): ${unknown.sort().join(', ')}` }
  }
  if (!isCleanString(value.rule) || !RULE_ID_PATTERN.test(value.rule)) {
    return { error: 'record rule must be a kebab-case rule id' }
  }
  if (!isCleanString(value.change) || !CHANGE_PATTERN.test(value.change)) {
    return { error: 'record change must be a change directory name' }
  }
  if (value.scope !== 'task') return { error: 'record scope must be "task"' }
  if (typeof value.taskId !== 'string' || !TASK_ID_PATTERN.test(value.taskId)) {
    return { error: 'record taskId must be 16 lowercase hex characters' }
  }
  if (typeof value.digest !== 'string' || !DIGEST_PATTERN.test(value.digest)) {
    return { error: 'record digest must be a 64-character sha256 hex string' }
  }
  if (
    value.worktreeDigest !== undefined &&
    (typeof value.worktreeDigest !== 'string' || !DIGEST_PATTERN.test(value.worktreeDigest))
  ) {
    return { error: 'record worktreeDigest must be a 64-character sha256 hex string' }
  }
  if (value.verdict !== 'PASS' && value.verdict !== 'FINDINGS' && value.verdict !== 'ERROR') {
    return { error: 'record verdict must be PASS, FINDINGS, or ERROR' }
  }
  if (!Array.isArray(value.findings) || !value.findings.every(isReviewFinding)) {
    return { error: 'record findings must be a list of P0/P1 findings' }
  }
  if (value.verdict === 'PASS' && value.findings.length > 0) {
    return { error: 'a PASS record must have zero findings' }
  }
  if (value.verdict === 'FINDINGS' && value.findings.length === 0) {
    return { error: 'a FINDINGS record must have at least one finding' }
  }
  if (!isReviewTarget(value.target)) {
    return { error: 'record target must name a provider and optional model/effort' }
  }
  if (!isCleanString(value.time)) return { error: 'record time must be a non-empty timestamp' }
  return { record: value as unknown as PortableTaskReviewRecord }
}

/** Absolute path of one portable record inside a change. */
export function portableTaskRecordPath(changeDir: string, taskId: string): string {
  return join(changeDir, REVIEWS_DIRECTORY, `${taskId}.json`)
}

/** Repository-relative display path of one portable record, for messages. */
export function portableTaskRecordDisplayPath(changeDirectory: string, taskId: string): string {
  return `${changeDirectory}/${REVIEWS_DIRECTORY}/${taskId}.json`
}

/** Absolute path of one local `.dsh` task-review record the export may copy. */
export function localTaskRecordPath(
  workspaceRoot: string,
  rule: string,
  change: string,
  taskId: string,
): string {
  return join(workspaceRoot, '.dsh', 'delegation', rule, change, 'tasks', `${taskId}.json`)
}

/** What the coverage reader found at one record path. */
export type ApprovalRecordState =
  | { kind: 'missing' }
  | { kind: 'malformed'; error: string }
  | { kind: 'record'; record: PortableTaskReviewRecord }

export interface ApprovalTaskReport {
  number: string
  text: string
  id: string
  recordPath: string
  state: 'pass' | 'error' | 'missing'
  detail?: string
}

export interface ApprovalCoverage {
  change: string
  rule: string
  checked: number
  pass: number
  error: number
  missing: number
  unchecked: Array<{ number: string; text: string }>
  unparseable: UnparseableCheckedLine[]
  tasks: ApprovalTaskReport[]
  archiveReady: boolean
}

export interface ApprovalCoverageInput {
  change: string
  /** The strict task-review rule whose PASS is the approval. */
  rule: string
  tasks: readonly NumberedTask[]
  unparseable?: readonly UnparseableCheckedLine[]
  /** Repository-relative display path of the expected record for one task. */
  recordPath(taskId: string): string
  inspect(taskId: string): ApprovalRecordState | Promise<ApprovalRecordState>
}

/**
 * PASS-only coverage over every checked task, independent of session
 * attribution. Unchecked tasks are reported; they never block approval.
 */
export async function computeApprovalCoverage(
  input: ApprovalCoverageInput,
): Promise<ApprovalCoverage> {
  const coverage: ApprovalCoverage = {
    change: input.change,
    rule: input.rule,
    checked: 0,
    pass: 0,
    error: 0,
    missing: 0,
    unchecked: [],
    unparseable: [...(input.unparseable ?? [])],
    tasks: [],
    archiveReady: false,
  }
  for (const task of input.tasks) {
    if (!task.checked) {
      coverage.unchecked.push({ number: task.number, text: task.text })
      continue
    }
    coverage.checked += 1
    const recordPath = input.recordPath(task.id)
    const report: ApprovalTaskReport = {
      number: task.number,
      text: task.text,
      id: task.id,
      recordPath,
      state: 'missing',
    }
    const state = await input.inspect(task.id)
    if (state.kind === 'missing') {
      coverage.missing += 1
      report.detail = `no record at ${recordPath}`
    } else if (state.kind === 'malformed') {
      coverage.error += 1
      report.state = 'error'
      report.detail = `malformed record at ${recordPath}: ${state.error}`
    } else {
      const record = state.record
      const mismatch: string[] = []
      if (record.rule !== input.rule) mismatch.push(`rule "${record.rule}"`)
      if (record.change !== input.change) mismatch.push(`change "${record.change}"`)
      if (record.taskId !== task.id) mismatch.push(`task id "${record.taskId}"`)
      if (record.verdict !== 'PASS') mismatch.push(`verdict ${record.verdict}`)
      if (mismatch.length === 0) {
        coverage.pass += 1
        report.state = 'pass'
      } else {
        coverage.error += 1
        report.state = 'error'
        report.detail = `record at ${recordPath} is not an approval (${mismatch.join(', ')})`
      }
    }
    coverage.tasks.push(report)
  }
  coverage.archiveReady = coverage.unparseable.length === 0 && coverage.pass === coverage.checked
  return coverage
}

/** The shared audit/deny wording: one line per gap plus the next review call. */
export function formatApprovalGapLines(coverage: ApprovalCoverage): string[] {
  const lines: string[] = []
  for (const line of coverage.unparseable) {
    lines.push(
      `checked line ${line.line} "${line.text}" is not a numbered task; the approval cannot be proven`,
    )
  }
  for (const task of coverage.tasks) {
    if (task.state === 'pass') continue
    const label = task.state === 'missing' ? 'missing' : 'not approved'
    const detail = task.state === 'missing' || task.detail === undefined ? '' : ` (${task.detail})`
    lines.push(
      `${label} ${task.number} "${task.text}"${detail} -> delegate(rule: "${coverage.rule}", change: "${coverage.change}", task: "${task.id}")`,
    )
    lines.push(`record: ${task.recordPath}`)
  }
  return lines
}

/** `task-review PASS x/y, ERROR z, missing n; archive-ready: yes|no` */
export function approvalSummaryLine(coverage: ApprovalCoverage): string {
  return `${coverage.rule} PASS ${coverage.pass}/${coverage.checked}, ERROR ${coverage.error}, missing ${coverage.missing}; archive-ready: ${coverage.archiveReady ? 'yes' : 'no'}`
}

/** The repository opt-in marker read from `<OpenSpec root>/review-approval.json`. */
export interface ReviewApprovalMarker {
  version: 1
  archiveGate: boolean
  taskRule: string
  cutoff?: string
  grandfathered?: Record<string, string>
}

const MARKER_KEYS = new Set(['version', 'archiveGate', 'taskRule', 'cutoff', 'grandfathered'])

export function parseReviewApprovalMarker(value: unknown): {
  marker?: ReviewApprovalMarker
  error?: string
} {
  if (!isRecord(value)) return { error: 'marker must be a JSON object' }
  const unknown = Object.keys(value).filter((key) => !MARKER_KEYS.has(key))
  if (unknown.length > 0) {
    return { error: `marker has unsupported field(s): ${unknown.sort().join(', ')}` }
  }
  if (value.version !== 1) return { error: 'marker version must be 1' }
  if (typeof value.archiveGate !== 'boolean') {
    return { error: 'marker archiveGate must be true or false' }
  }
  if (typeof value.taskRule !== 'string' || !RULE_ID_PATTERN.test(value.taskRule)) {
    return { error: 'marker taskRule must be a kebab-case rule id' }
  }
  if (value.cutoff !== undefined && !isCleanString(value.cutoff)) {
    return { error: 'marker cutoff must be a tag name' }
  }
  const grandfathered: Record<string, string> = {}
  if (value.grandfathered !== undefined) {
    if (!isRecord(value.grandfathered)) {
      return { error: 'marker grandfathered must map change names to reasons' }
    }
    for (const [change, reason] of Object.entries(value.grandfathered)) {
      if (!CHANGE_PATTERN.test(change) || change === 'archive') {
        return { error: `marker grandfathered key "${change}" is not a change name` }
      }
      if (!isCleanString(reason)) {
        return { error: `marker grandfathered reason for "${change}" must be text` }
      }
      grandfathered[change] = reason
    }
  }
  return {
    marker: {
      version: 1,
      archiveGate: value.archiveGate,
      taskRule: value.taskRule,
      ...(value.cutoff === undefined ? {} : { cutoff: value.cutoff }),
      ...(value.grandfathered === undefined ? {} : { grandfathered }),
    },
  }
}

/** Quote-aware shell tokens; quoted text stays one argument and never becomes an operator. */
export interface ShellToken {
  readonly value: string
  readonly quoted: boolean
}

export interface ShellSegment {
  readonly tokens: readonly ShellToken[]
}

export function shellSegments(command: string): ShellSegment[] {
  const segments: ShellSegment[] = []
  let tokens: ShellToken[] = []
  let value = ''
  let quoted = false
  let quote: '"' | "'" | null = null
  const pushToken = (): void => {
    if (value !== '' || quoted) {
      tokens.push({ value, quoted })
      value = ''
      quoted = false
    }
  }
  const pushSegment = (): void => {
    pushToken()
    if (tokens.length > 0) segments.push({ tokens })
    tokens = []
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string
    if (quote !== null) {
      if (char === quote) {
        quote = null
        quoted = true
        continue
      }
      value += char
      quoted = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      quoted = true
      continue
    }
    if (char === '#') {
      const newline = command.indexOf('\n', index)
      if (newline < 0) {
        index = command.length
        break
      }
      index = newline
      pushSegment()
      continue
    }
    if (char === '\n' || char === '\r') {
      pushSegment()
      if (char === '\r' && command[index + 1] === '\n') index += 1
      continue
    }
    if (/\s/u.test(char)) {
      pushToken()
      continue
    }
    if (char === ';') {
      pushSegment()
      continue
    }
    if (char === '|') {
      if (command[index + 1] === '|') index += 1
      pushSegment()
      continue
    }
    if (char === '&' && command[index + 1] === '&') {
      index += 1
      pushSegment()
      continue
    }
    if (char === '>') {
      pushToken()
      const operator = command[index + 1] === '>' ? '>>' : '>'
      tokens.push({ value: operator, quoted: false })
      if (operator === '>>') index += 1
      continue
    }
    value += char
  }
  pushSegment()
  return segments
}

/** One recognized archive operation, before the listener resolves its evidence. */
export interface ArchiveIntent {
  kind: 'openspec-archive' | 'move'
  change: string
}

const OPENSPEC_COMMANDS = new Set(['openspec', 'openspec.cmd', 'openspec.exe'])
const RUNNER_COMMANDS = new Set(['pnpm', 'pnpm.cmd', 'npx', 'npx.cmd', 'npm', 'npm.cmd', 'yarn'])
const PREVIEW_SWITCH = /^-(?:whatif|wi|wh|what|whati)(?::|$)/iu
const OPTION_VALUE_NAMES = ['-path', '-literalpath', '-destination', '--change', '--path']

function baseName(value: string): string {
  const normalized = value.replaceAll('\\', '/')
  const index = normalized.lastIndexOf('/')
  return index < 0 ? normalized : normalized.slice(index + 1)
}

function positionalArguments(args: readonly string[]): string[] {
  const positional: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string
    if (arg.startsWith('-')) {
      if (OPTION_VALUE_NAMES.includes(arg.toLowerCase())) index += 1
      continue
    }
    positional.push(arg)
  }
  return positional
}

function namedArgument(args: readonly string[], names: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string
    const lower = arg.toLowerCase()
    for (const name of names) {
      if (lower === name) return args[index + 1]
      if (lower.startsWith(`${name}:`) || lower.startsWith(`${name}=`)) {
        return arg.slice(name.length + 1)
      }
    }
  }
  return undefined
}

function hasPreviewSwitch(tokens: readonly ShellToken[]): boolean {
  return tokens.some((token) => !token.quoted && PREVIEW_SWITCH.test(token.value))
}

/** Resolve one command path text against the executing directory, normalized to `/`. */
function normalizedPath(cwd: string, path: string): string {
  return resolve(cwd, path.replaceAll('\\', '/')).replaceAll('\\', '/')
}

/** Classify one path as an active change directory or a path under the archive directory. */
function changePath(
  cwd: string,
  path: string,
): { kind: 'source'; change: string } | { kind: 'archive' } | undefined {
  const normalized = normalizedPath(cwd, path)
  const marker = '/openspec/changes/'
  const index = normalized.lastIndexOf(marker)
  if (index < 0) return undefined
  const rest = normalized.slice(index + marker.length).replace(/\/+$/, '')
  if (rest === '') return undefined
  const segments = rest.split('/')
  if (segments[0] === 'archive') return { kind: 'archive' }
  if (segments.length === 1 && CHANGE_PATTERN.test(segments[0] as string)) {
    return { kind: 'source', change: segments[0] as string }
  }
  return undefined
}

function archiveMoveIntents(cwd: string, tokens: readonly ShellToken[]): ArchiveIntent[] {
  if (hasPreviewSwitch(tokens)) return []
  const words = tokens.map((token) => token.value)
  const verb = baseName(words[0] ?? '').toLowerCase()
  let args: string[]
  if (verb === 'git' && (words[1] ?? '').toLowerCase() === 'mv') {
    args = words.slice(2)
  } else if (verb === 'mv' || verb === 'move-item') {
    args = words.slice(1)
  } else {
    return []
  }
  const positionals = positionalArguments(args)
  const namedSource = namedArgument(args, ['-path', '-literalpath'])
  const destination = namedArgument(args, ['-destination']) ?? positionals[positionals.length - 1]
  if (destination === undefined) return []
  // Move-Item takes one -Path value (possibly a comma list); mv/git mv take
  // every positional except the destination as a source.
  const sources =
    namedSource !== undefined
      ? namedSource
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
      : positionals.slice(0, -1)
  const to = changePath(cwd, destination)
  if (to === undefined || to.kind !== 'archive') return []
  const intents: ArchiveIntent[] = []
  for (const source of sources) {
    const from = changePath(cwd, source)
    if (from !== undefined && from.kind === 'source') {
      intents.push({ kind: 'move', change: from.change })
    }
  }
  return intents
}

function openSpecArchiveIntent(tokens: readonly ShellToken[]): ArchiveIntent | undefined {
  const words = tokens.map((token) => token.value)
  const first = baseName(words[0] ?? '').toLowerCase()
  let start = -1
  if (OPENSPEC_COMMANDS.has(first)) start = 0
  else if (RUNNER_COMMANDS.has(first)) {
    const index = words.findIndex((word, position) => {
      if (position === 0 || position > 3) return false
      return OPENSPEC_COMMANDS.has(baseName(word).toLowerCase())
    })
    if (index > 0) start = index
  }
  if (start < 0) return undefined
  const args = words.slice(start + 1)
  if ((args[0] ?? '').toLowerCase() !== 'archive') return undefined
  const rest = args.slice(1)
  const change = namedArgument(rest, ['--change']) ?? positionalArguments(rest)[0]
  if (change === undefined || !CHANGE_PATTERN.test(change) || change === 'archive') return undefined
  return { kind: 'openspec-archive', change }
}

/**
 * Recognize the documented archive operations in one shell command. This is a
 * guard, not a sandbox: an intentionally obfuscated move is out of scope and
 * the push audit is the backstop.
 */
export function recognizeArchiveCommands(command: string, cwd: string): ArchiveIntent[] {
  const intents: ArchiveIntent[] = []
  for (const segment of shellSegments(command)) {
    const tokens = segment.tokens
    if (tokens.length === 0) continue
    if ((tokens[0] as ShellToken).quoted) continue
    const openSpec = openSpecArchiveIntent(tokens)
    if (openSpec !== undefined) {
      intents.push(openSpec)
      continue
    }
    intents.push(...archiveMoveIntents(cwd, tokens))
  }
  return intents
}

/** Identity a local `.dsh` task-review record must carry to be exported. */
export interface ExportRecordInput {
  value: unknown
  rule: string
  change: string
  taskId: string
}

/**
 * Turn one local `.dsh` PASS record into the sanitized portable record. Only a
 * PASS that names this rule, change, and task id is copied; the export cannot
 * invent an approval.
 */
export function portableRecordFromLocal(input: ExportRecordInput): {
  record?: PortableTaskReviewRecord
  error?: string
} {
  const value = input.value
  if (!isRecord(value)) return { error: 'local record must be a JSON object' }
  if (value.rule !== input.rule) {
    return { error: `local record rule "${String(value.rule)}" does not match "${input.rule}"` }
  }
  if (value.change !== input.change) {
    return {
      error: `local record change "${String(value.change)}" does not match "${input.change}"`,
    }
  }
  if (value.scope !== 'task') return { error: 'local record is not task-scoped' }
  if (value.taskId !== input.taskId) {
    return {
      error: `local record task id "${String(value.taskId)}" does not match "${input.taskId}"`,
    }
  }
  if (value.verdict !== 'PASS') {
    return { error: `local record verdict is ${String(value.verdict)}; only PASS is exported` }
  }
  if (typeof value.digest !== 'string' || !DIGEST_PATTERN.test(value.digest)) {
    return { error: 'local record digest is not a 64-character sha256 hex string' }
  }
  if (
    value.worktreeDigest !== undefined &&
    (typeof value.worktreeDigest !== 'string' || !DIGEST_PATTERN.test(value.worktreeDigest))
  ) {
    return { error: 'local record worktreeDigest is not a 64-character sha256 hex string' }
  }
  const findings: unknown[] = Array.isArray(value.findings) ? value.findings : []
  if (!Array.isArray(value.findings)) {
    return { error: 'local record findings must be a list' }
  }
  if (findings.length > 0) return { error: 'a PASS local record must have zero findings' }
  if (!isReviewTarget(value.target)) {
    return { error: 'local record target must name a provider and optional model/effort' }
  }
  if (!isNonEmptyString(value.time)) return { error: 'local record time must be a timestamp' }
  const record: PortableTaskReviewRecord = {
    rule: input.rule,
    change: input.change,
    scope: 'task',
    taskId: input.taskId,
    digest: value.digest,
    ...(value.worktreeDigest === undefined ? {} : { worktreeDigest: value.worktreeDigest }),
    verdict: 'PASS',
    findings: [],
    target: value.target,
    time: value.time,
  }
  const checked = parsePortableTaskReviewRecord(record)
  if (checked.record === undefined) {
    return { error: checked.error ?? 'the sanitized record is not valid' }
  }
  return { record: checked.record }
}
