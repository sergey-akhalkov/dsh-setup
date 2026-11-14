import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANGE_NAME } from './command-parse.js'
import type { Definition, Step } from './definitions.js'
import { type EvidenceContext, verifyEvidence } from './evidence.js'
import type { SubagentRunner } from './executors.js'
import { isInside } from './fs-change.js'
import { settleStep, type WorkflowRun } from './runs.js'

/**
 * The native review executor. It resolves a reviewer from the row's
 * `reviewers` map, renders a bundled instruction with the change, task and
 * digest context, accepts exactly one fenced JSON verdict that echoes the
 * prepared digest, writes the local record (and, for a task PASS, the committed
 * approval first), and settles the step from its own evidence. Every failure
 * writes an ERROR record and publishes no PASS.
 */

export const TASK_ID_PATTERN = /^[0-9a-f]{16}$/u

/** The fixed finding vocabulary every review producer shares. */
export const FINDING_CLASSES = [
  'spec-ambiguity',
  'missing-test',
  'path-boundary',
  'state-persistence',
  'stale-input',
  'api-contract',
  'plan-shape',
  'docs-drift',
  'security',
  'other',
] as const
export type FindingClass = (typeof FINDING_CLASSES)[number]
const FINDING_CLASS_SET: ReadonlySet<string> = new Set(FINDING_CLASSES)

export function normalizeFindingClass(value: unknown): FindingClass {
  return typeof value === 'string' && FINDING_CLASS_SET.has(value)
    ? (value as FindingClass)
    : 'other'
}

export interface ReviewFinding {
  readonly severity: 'P0' | 'P1'
  readonly class: FindingClass
  readonly title: string
  readonly evidence: string
  readonly fix: string
}

export type ReviewVerdict = 'PASS' | 'FINDINGS' | 'ERROR'

/** Where a reviewer comes from: a profile target id, never a provider. */
export interface ReviewerTargetConfig {
  readonly provider: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly agentOptions?: Readonly<Record<string, unknown>>
}

export type ReviewerMap = Readonly<Record<string, ReviewerTargetConfig>>

export interface ResolvedReviewer {
  readonly id: string
  readonly provider: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly agentOptions?: Readonly<Record<string, unknown>>
}

const REVIEWER_ID = /^[a-z][a-z0-9-]*$/u
/** A value that could leak the reviewing machine into a committed approval. */
const MACHINE_PATH =
  /[A-Za-z]:[\\/]|\\\\|file:\/\/|(?:^|[\s"'=([{<`])\/[^\s"'`)\]}>]+|(?:^|[\s"'=([{<`])~[/\\]/iu
const REVIEWER_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'agentOptions'])
const AGENT_OPTION_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`workflows ${field} must be a non-empty string`)
  }
  return value
}

/**
 * Validate the row's `reviewers` map. A provider that is registered without
 * `agentOptions` support rejects a model or effort at load; an unregistered
 * provider is not a load error and fails the run with the target name.
 */
export function resolveReviewers(
  raw: unknown,
  providerSupportsOptions?: (provider: string) => boolean | undefined,
): ReviewerMap {
  if (raw === undefined) return {}
  if (!isRecord(raw)) throw new Error('workflows reviewers must be an object')
  const reviewers: Record<string, ReviewerTargetConfig> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!REVIEWER_ID.test(id)) {
      throw new Error(`workflows reviewers.${id} must be a lowercase kebab-case reviewer id`)
    }
    if (!isRecord(value)) throw new Error(`workflows reviewers.${id} must be an object`)
    for (const key of Object.keys(value)) {
      if (!REVIEWER_KEYS.has(key)) {
        throw new Error(`workflows reviewers.${id} has an unknown field "${key}"`)
      }
    }
    const provider = nonEmpty(value.provider, `reviewers.${id}.provider`)
    const model =
      value.model === undefined ? undefined : nonEmpty(value.model, `reviewers.${id}.model`)
    const reasoningEffort =
      value.reasoningEffort === undefined
        ? undefined
        : nonEmpty(value.reasoningEffort, `reviewers.${id}.reasoningEffort`)
    let agentOptions: Readonly<Record<string, unknown>> | undefined
    if (value.agentOptions !== undefined) {
      if (!isRecord(value.agentOptions)) {
        throw new Error(`workflows reviewers.${id}.agentOptions must be an object`)
      }
      for (const key of Object.keys(value.agentOptions)) {
        if (!AGENT_OPTION_KEYS.has(key)) {
          throw new Error(`workflows reviewers.${id}.agentOptions has an unknown field "${key}"`)
        }
      }
      for (const field of ['provider', 'model', 'reasoningEffort'] as const) {
        const nested = value.agentOptions[field]
        if (nested !== undefined) {
          nonEmpty(nested, `reviewers.${id}.agentOptions.${field}`)
        }
      }
      const maxTokens = value.agentOptions.maxTokens
      if (
        maxTokens !== undefined &&
        (typeof maxTokens !== 'number' || !Number.isSafeInteger(maxTokens) || maxTokens < 1)
      ) {
        throw new Error(
          `workflows reviewers.${id}.agentOptions.maxTokens must be a positive safe integer`,
        )
      }
      agentOptions = value.agentOptions
    }
    for (const value of [model, reasoningEffort]) {
      if (value !== undefined && MACHINE_PATH.test(value)) {
        throw new Error(
          `workflows reviewers.${id} must name a model or effort id, not a machine path`,
        )
      }
    }
    for (const value of Object.values(agentOptions ?? {})) {
      if (typeof value === 'string' && MACHINE_PATH.test(value)) {
        throw new Error(`workflows reviewers.${id}.agentOptions must not carry a machine path`)
      }
    }
    if (
      (model !== undefined || reasoningEffort !== undefined || agentOptions !== undefined) &&
      providerSupportsOptions?.(provider) === false
    ) {
      throw new Error(
        `workflows reviewers.${id} sets model/reasoningEffort/agentOptions, but provider "${provider}" does not declare agentOptions support; remove the option or choose a capable provider`,
      )
    }
    reviewers[id] = {
      provider,
      ...(model === undefined ? {} : { model }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(agentOptions === undefined ? {} : { agentOptions }),
    }
  }
  return reviewers
}

/** Resolve one reviewer for a run; a missing id names the config and remedy. */
export function resolveReviewer(
  reviewers: ReviewerMap,
  target: string,
):
  | { readonly ok: true; readonly reviewer: ResolvedReviewer }
  | { readonly ok: false; readonly error: string } {
  const config = reviewers[target]
  if (config === undefined) {
    return {
      ok: false,
      error: `review target "${target}" is not configured; add reviewers.${target} to the workflows row with a provider`,
    }
  }
  return {
    ok: true,
    reviewer: {
      id: target,
      provider: config.provider,
      ...(config.model === undefined ? {} : { model: config.model }),
      ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort }),
      ...(config.agentOptions === undefined ? {} : { agentOptions: config.agentOptions }),
    },
  }
}

/** The review queue's validated profile settings. */
export interface ReviewQueueConfig {
  readonly enabled: boolean
  readonly concurrency: number
  readonly maxQueued: number
  readonly maxAttempts: number
  readonly baseDelayMs: number
  readonly maxDelayMs: number
  readonly waitTimeoutMs: number
}

export const DEFAULT_REVIEW_QUEUE: ReviewQueueConfig = Object.freeze({
  enabled: true,
  concurrency: 2,
  maxQueued: 16,
  maxAttempts: 3,
  baseDelayMs: 5_000,
  maxDelayMs: 60_000,
  waitTimeoutMs: 300_000,
})

const REVIEW_QUEUE_KEYS = new Set([
  'enabled',
  'concurrency',
  'maxQueued',
  'maxAttempts',
  'baseDelayMs',
  'maxDelayMs',
  'waitTimeoutMs',
])

function integerIn(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(
      `workflows reviewQueue.${field} must be an integer between ${String(min)} and ${String(max)}`,
    )
  }
  return value
}

export function resolveReviewQueue(raw: unknown): ReviewQueueConfig {
  if (raw === undefined) return DEFAULT_REVIEW_QUEUE
  if (!isRecord(raw)) throw new Error('workflows reviewQueue must be an object')
  for (const key of Object.keys(raw)) {
    if (!REVIEW_QUEUE_KEYS.has(key)) {
      throw new Error(`workflows reviewQueue has an unknown field "${key}"`)
    }
  }
  const enabled = raw.enabled
  if (enabled !== undefined && typeof enabled !== 'boolean') {
    throw new Error('workflows reviewQueue.enabled must be a boolean')
  }
  return {
    enabled: enabled ?? DEFAULT_REVIEW_QUEUE.enabled,
    concurrency:
      raw.concurrency === undefined
        ? DEFAULT_REVIEW_QUEUE.concurrency
        : integerIn(raw.concurrency, 'concurrency', 1, 4),
    maxQueued:
      raw.maxQueued === undefined
        ? DEFAULT_REVIEW_QUEUE.maxQueued
        : integerIn(raw.maxQueued, 'maxQueued', 1, 100),
    maxAttempts:
      raw.maxAttempts === undefined
        ? DEFAULT_REVIEW_QUEUE.maxAttempts
        : integerIn(raw.maxAttempts, 'maxAttempts', 1, 10),
    baseDelayMs:
      raw.baseDelayMs === undefined
        ? DEFAULT_REVIEW_QUEUE.baseDelayMs
        : integerIn(raw.baseDelayMs, 'baseDelayMs', 0, 3_600_000),
    maxDelayMs:
      raw.maxDelayMs === undefined
        ? DEFAULT_REVIEW_QUEUE.maxDelayMs
        : integerIn(raw.maxDelayMs, 'maxDelayMs', 0, 3_600_000),
    waitTimeoutMs:
      raw.waitTimeoutMs === undefined
        ? DEFAULT_REVIEW_QUEUE.waitTimeoutMs
        : integerIn(raw.waitTimeoutMs, 'waitTimeoutMs', 1_000, 3_600_000),
  }
}

export const DEFAULT_REVIEW_TIMEOUT_MS = 600_000

/** Resolve `timeouts.review`; a timeout outside the bounded range fails load. */
export function resolveReviewTimeout(raw: unknown): number {
  if (raw === undefined) return DEFAULT_REVIEW_TIMEOUT_MS
  if (!isRecord(raw)) throw new Error('workflows timeouts must be an object')
  for (const key of Object.keys(raw)) {
    if (key !== 'review') throw new Error(`workflows timeouts has an unknown field "${key}"`)
  }
  if (raw.review === undefined) return DEFAULT_REVIEW_TIMEOUT_MS
  return integerIn(raw.review, 'review', 1_000, 3_600_000)
}

/** The review step's record phase; a task-scoped record is always phase "task". */
export function reviewPhase(scope: 'whole' | 'task', phase: string | undefined): string {
  return scope === 'task' ? 'task' : (phase ?? 'spec')
}

/** The workspace-relative local record path for one review. */
export function localReviewRecordPath(input: {
  readonly definition: string
  readonly change: string
  readonly scope: 'whole' | 'task'
  readonly phase?: string
  readonly taskId?: string
}): string {
  if (!CHANGE_NAME.test(input.change)) throw new Error(`"${input.change}" is not a change name`)
  const root = `.dsh/workflows/records/${input.definition}/${input.change}`
  if (input.scope === 'task') {
    if (input.taskId === undefined || !TASK_ID_PATTERN.test(input.taskId)) {
      throw new Error('a task-scoped review record needs a 16-hex task id')
    }
    return `${root}/tasks/${input.taskId}.json`
  }
  return `${root}/${reviewPhase('whole', input.phase)}.json`
}

/** The committed portable approval path; the format is unchanged. */
export function portableApprovalPath(change: string, taskId: string): string {
  if (!CHANGE_NAME.test(change)) throw new Error(`"${change}" is not a change name`)
  if (!TASK_ID_PATTERN.test(taskId)) throw new Error(`"${taskId}" is not a task id`)
  return `openspec/changes/${change}/reviews/${taskId}.json`
}

/** One review record; the local file is a provenance superset of the approval. */
export interface ReviewRecord {
  readonly definition: string
  readonly rule: string
  readonly change: string
  readonly phase: string
  readonly scope: 'whole' | 'task'
  readonly taskId?: string
  readonly digest: string
  readonly worktreeDigest?: string
  readonly verdict: ReviewVerdict
  readonly findings: readonly ReviewFinding[]
  readonly target: Readonly<{ provider: string; model?: string; reasoningEffort?: string }>
  readonly reviewer: string
  readonly session?: string
  readonly runId?: string
  readonly failureClass?: string
  readonly error?: string
  readonly time: string
}

const MAX_FIELD_CHARS = 2_000

/** Redact machine paths and credentials, then bound the result. */
export function sanitizeReviewText(text: string, maximum = MAX_FIELD_CHARS): string {
  const redacted = text
    .replace(/\bauthorization(?:\\?["'])?\s*[=:][\s\S]*?(?=\r?\n|$)/gi, '[secret]')
    .replace(/\b(?:cookie|set-cookie)(?:\\?["'])?\s*[=:][\s\S]*?(?=\r?\n|$)/gi, '[secret]')
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi, '$1[secret]@')
    .replace(/\bfile:\/\/[^\s"'`)]*/gi, '[path]')
    .replace(/\b[A-Za-z]:[\\/][^\s"'`)]*/g, '[path]')
    .replace(/\\\\[^\s"'`)]+/g, '[path]')
    .replace(/~[/\\][^\s"'`)]*/g, '[path]')
    .replace(/(^|[\s"'=([{<`])\/[^\s"'`)\]}<>]+/g, '$1[path]')
    .replace(
      /\b[A-Za-z0-9_.-]*(?:token|password|passwd|secret|passphrase|api[_-]?key|apikey|private[_-]?key|cookie|session)[A-Za-z0-9_.-]*(?:\\?["'])?\s*[=:]\s*(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\\"(?:[^"\\]|\\.)*?\\"|\\'(?:[^'\\]|\\.)*?\\'|[^\s"',;}]+)/gi,
      '[secret]',
    )
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[secret]')
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{8,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,})\b/g,
      '[secret]',
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
      '[secret]',
    )
  return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum - 1)}…`
}

export type ParsedVerdict =
  | { readonly ok: true; readonly verdict: 'PASS' | 'FINDINGS'; readonly findings: ReviewFinding[] }
  | { readonly ok: false; readonly error: string }

/** Accept exactly one fenced JSON verdict that echoes the requested digest. */
export function parseReviewVerdict(text: string, expectedDigest: string): ParsedVerdict {
  const blocks: string[] = []
  // Every fenced block counts, whatever its language: one verdict, no extras.
  const fence = /```[^\n]*\r?\n([\s\S]*?)```/g
  for (const match of text.matchAll(fence)) blocks.push(match[1] ?? '')
  if (blocks.length === 0) {
    return {
      ok: false,
      error: 'the reviewer returned no fenced JSON verdict; exactly one fenced block is required',
    }
  }
  if (blocks.length > 1) {
    return {
      ok: false,
      error: `the reviewer returned ${String(blocks.length)} fenced blocks; exactly one JSON verdict is required`,
    }
  }
  let value: unknown
  try {
    value = JSON.parse(blocks[0] as string)
  } catch (error) {
    return {
      ok: false,
      error: `the fenced verdict is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!isRecord(value)) return { ok: false, error: 'the fenced verdict must be a JSON object' }
  if (value.digest !== expectedDigest) {
    return {
      ok: false,
      error:
        'the verdict digest does not match the prepared digest; re-run the review on the current inputs',
    }
  }
  const verdict = value.verdict
  if (verdict !== 'PASS' && verdict !== 'FINDINGS') {
    return { ok: false, error: 'the verdict must be "PASS" or "FINDINGS"' }
  }
  const rawFindings = value.findings ?? []
  if (!Array.isArray(rawFindings)) {
    return { ok: false, error: 'the verdict findings must be a list' }
  }
  const findings: ReviewFinding[] = []
  for (const [index, raw] of rawFindings.entries()) {
    const position = `finding #${String(index + 1)}`
    if (!isRecord(raw)) return { ok: false, error: `${position} must be an object` }
    if (raw.severity !== 'P0' && raw.severity !== 'P1') {
      return { ok: false, error: `${position} severity must be "P0" or "P1"` }
    }
    if (typeof raw.title !== 'string' || raw.title.trim() === '') {
      return { ok: false, error: `${position}.title must be a non-empty string` }
    }
    if (typeof raw.evidence !== 'string' || raw.evidence.trim() === '') {
      return { ok: false, error: `${position}.evidence must be a non-empty string` }
    }
    if (typeof raw.fix !== 'string' || raw.fix.trim() === '') {
      return { ok: false, error: `${position}.fix must be a non-empty string` }
    }
    findings.push({
      severity: raw.severity,
      class: normalizeFindingClass(raw.class),
      title: sanitizeReviewText(raw.title),
      evidence: sanitizeReviewText(raw.evidence),
      fix: sanitizeReviewText(raw.fix),
    })
  }
  if (verdict === 'PASS' && findings.length > 0) {
    return { ok: false, error: 'verdict PASS requires zero P0/P1 findings' }
  }
  if (verdict === 'FINDINGS' && findings.length === 0) {
    return { ok: false, error: 'verdict FINDINGS requires at least one P0/P1 finding' }
  }
  return { ok: true, verdict, findings }
}

/** The shipped bundled review instructions live beside the definitions. */
export function reviewAssetsDirectory(): string {
  const candidates = [
    fileURLToPath(new URL('../../assets/reviews', import.meta.url)),
    fileURLToPath(new URL('../assets/reviews', import.meta.url)),
  ]
  for (const candidate of candidates) {
    try {
      readFileSync(join(candidate, 'review-task.md'), 'utf8')
      return candidate
    } catch {
      // try the next layout
    }
  }
  throw new Error(`workflow review instructions were not found at ${candidates.join(' or ')}`)
}

export function readReviewInstruction(id: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
    throw new Error(`review instruction "${id}" is not a bundled instruction id`)
  }
  try {
    return readFileSync(join(reviewAssetsDirectory(), `${id}.md`), 'utf8')
  } catch (error) {
    throw new Error(
      `bundled review instruction "${id}" could not be read: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export interface ReviewPromptInput {
  readonly instruction: string
  readonly rule: string
  readonly change: string
  readonly scope: 'whole' | 'task'
  readonly phase?: string
  readonly task?: { readonly id: string; readonly number?: string; readonly text: string }
  readonly digest: string
  readonly snapshot: boolean
  readonly extra?: string
}

/** Render the bundled instruction with the review's digest-bound context. */
export function renderReviewPrompt(input: ReviewPromptInput): string {
  const lines = [
    readReviewInstruction(input.instruction).trimEnd(),
    '',
    '## Native review',
    '',
    `- Rule: ${input.rule}`,
    `- Change: ${input.change}`,
    `- Scope: ${input.scope}`,
  ]
  if (input.phase !== undefined) lines.push(`- Phase: ${input.phase}`)
  if (input.task !== undefined) {
    lines.push(`- Task: ${input.task.number ?? ''} ${input.task.text}`.trimEnd())
    lines.push(`- Task id: ${input.task.id}`)
  }
  lines.push(`- Digest: ${input.digest}`)
  lines.push(
    input.snapshot
      ? '- Reviewed state: a frozen worktree snapshot taken when the review started; later writes are not in it.'
      : '- Reviewed state: the live worktree; a changed input discards the verdict.',
  )
  if (input.extra !== undefined && input.extra.trim() !== '') {
    lines.push('', '## Context', '', input.extra.trim())
  }
  lines.push(
    '',
    'Return exactly one fenced JSON block whose `digest` is the value above, `verdict` is `PASS` or `FINDINGS`, and `findings` lists only P0/P1 items with `class`, `title`, `evidence`, and `fix`. Prose outside that block is ignored.',
  )
  return lines.join('\n')
}

function hashParts(parts: readonly string[]): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part)
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** The task-scope digest binds the frozen tree; whole scope binds the artifacts. */
export function reviewDigest(input: {
  readonly scope: 'whole' | 'task'
  readonly specDigest: string
  readonly tree?: string
}): string {
  return input.scope === 'task'
    ? hashParts(['task-review-snapshot-v1', input.tree ?? ''])
    : input.specDigest
}

/** Write one file atomically: temp beside the target, then rename. */
export async function writeReviewFileAtomic(file: string, bytes: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, bytes)
  try {
    await rename(temporary, file)
  } catch (error) {
    await unlink(temporary).catch(() => undefined)
    throw error
  }
}

/**
 * Resolve a workspace-relative record path and prove every existing ancestor
 * stays inside the canonical workspace. A linked store would otherwise publish
 * outside the workspace, which evidence validation cannot undo after the write.
 */
async function containedRecordTarget(workspace: string, relative: string): Promise<string> {
  if (isAbsolute(relative) || relative.split('/').includes('..')) {
    throw new Error(`the record path "${relative}" escapes the workspace`)
  }
  const root = await realpath(workspace)
  const segments = relative.split('/')
  if (segments.some((segment) => segment === '' || segment === '.')) {
    throw new Error(`the record path "${relative}" is not a normalized path`)
  }
  let current = root
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment)
    const info = await lstat(current).catch(() => undefined)
    if (info === undefined) break
    if (info.isSymbolicLink()) {
      throw new Error(`the record directory "${relative}" passes through a link; remove the link`)
    }
    const real = await realpath(current).catch(() => undefined)
    if (real === undefined || !isInside(root, real)) {
      throw new Error(`the record directory "${relative}" escapes the workspace`)
    }
  }
  return join(root, ...segments)
}

const jsonText = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

/** The committed approval subset; the field set and order are the stable format. */
export function portableApprovalOf(record: ReviewRecord): Readonly<Record<string, unknown>> {
  return {
    rule: record.rule,
    change: record.change,
    scope: 'task',
    taskId: record.taskId,
    digest: record.digest,
    ...(record.worktreeDigest === undefined ? {} : { worktreeDigest: record.worktreeDigest }),
    verdict: 'PASS',
    findings: [],
    target: record.target,
    time: record.time,
  }
}

export type ReviewWrite =
  | { readonly ok: true; readonly path: string }
  | { readonly ok: false; readonly error: string }

/** Write the local review record; the path is derived from the record. */
export async function writeLocalReviewRecord(
  workspace: string,
  record: ReviewRecord,
): Promise<ReviewWrite> {
  try {
    const path = localReviewRecordPath(record)
    await writeReviewFileAtomic(await containedRecordTarget(workspace, path), jsonText(record))
    return { ok: true, path }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Write the committed approval before the local record; a task PASS only. */
export async function writePortableApproval(
  workspace: string,
  record: ReviewRecord,
): Promise<ReviewWrite> {
  if (record.scope !== 'task' || record.taskId === undefined) {
    return { ok: false, error: 'a committed approval is written only for a task-scoped PASS' }
  }
  if (record.verdict !== 'PASS') {
    return { ok: false, error: 'a committed approval requires a PASS verdict' }
  }
  const target = record.target
  if (
    target.provider.trim() === '' ||
    MACHINE_PATH.test(target.provider) ||
    (target.model !== undefined && MACHINE_PATH.test(target.model)) ||
    (target.reasoningEffort !== undefined && MACHINE_PATH.test(target.reasoningEffort))
  ) {
    return {
      ok: false,
      error:
        'the approval target carries a machine path or empty provider; use a provider/model id, not a filesystem path',
    }
  }
  try {
    const path = portableApprovalPath(record.change, record.taskId)
    await writeReviewFileAtomic(
      await containedRecordTarget(workspace, path),
      jsonText(portableApprovalOf(record)),
    )
    return { ok: true, path }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export interface ReviewRunInput {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly step: Step
  readonly reviewer: ResolvedReviewer
  readonly runner: SubagentRunner
  readonly context: EvidenceContext
  readonly change: string
  readonly task?: { readonly id: string; readonly number?: string; readonly text: string }
  readonly prepared: {
    readonly specDigest: string
    /** A content tree digest for a frozen task snapshot. */
    readonly tree?: string
    /** The frozen checkout to run in; absent means the live worktree. */
    readonly reviewCwd?: string
    /** Re-check the change digest after the run and discard a changed verdict. */
    readonly liveGuard?: () => Promise<boolean>
  }
  readonly timeoutMs: number
  readonly session: string
  readonly now?: number
  readonly signal?: AbortSignal
  /** Test seams; production writes the real stores. */
  readonly writePortable?: typeof writePortableApproval
  readonly writeLocal?: typeof writeLocalReviewRecord
  /** Test seam: the prompt renderer; production reads the bundled instruction. */
  readonly renderPrompt?: (prompt: ReviewPromptInput) => string
}

export interface ReviewRunResult {
  readonly run: WorkflowRun
  readonly record?: ReviewRecord
  readonly recordPath?: string
  readonly error?: string
}

/** Record an engine-side failure (queue full, timeout) as an ERROR review record. */
export async function recordReviewFailure(input: {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly step: Step
  readonly reviewer: ResolvedReviewer
  readonly context: EvidenceContext
  readonly change: string
  readonly task?: { readonly id: string; readonly number?: string; readonly text: string }
  readonly prepared: ReviewRunInput['prepared']
  readonly session: string
  readonly error: string
  readonly failureClass: string
  readonly now?: number
  readonly writeLocal?: typeof writeLocalReviewRecord
}): Promise<ReviewRunResult> {
  const now = input.now ?? Date.now()
  const request: ReviewRunInput = { ...input, runner: {} as SubagentRunner, timeoutMs: 0 }
  const record = baseRecord(request, now)
  return writeErrorRecord(request, record, input.error, input.failureClass, now)
}

function targetIdentity(reviewer: ResolvedReviewer): ReviewRecord['target'] {
  // The record carries the effective selection, including options supplied
  // through agentOptions; the reviewer binding compares these exact values.
  const options = reviewer.agentOptions ?? {}
  const model = reviewer.model ?? (typeof options.model === 'string' ? options.model : undefined)
  const reasoningEffort =
    reviewer.reasoningEffort ??
    (typeof options.reasoningEffort === 'string' ? options.reasoningEffort : undefined)
  return {
    provider: reviewer.provider,
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

function baseRecord(
  input: ReviewRunInput,
  now: number,
): Omit<ReviewRecord, 'verdict' | 'findings'> {
  const spec = input.step.review
  if (spec === undefined) throw new Error(`step "${input.step.id}" declares no review`)
  const rule = input.definition.settings.gateIdentity ?? input.definition.id
  return {
    definition: input.definition.id,
    rule,
    change: input.change,
    phase: reviewPhase(spec.scope, spec.phase),
    scope: spec.scope,
    ...(input.task === undefined ? {} : { taskId: input.task.id }),
    digest: reviewDigest({
      scope: spec.scope,
      specDigest: input.prepared.specDigest,
      ...(input.prepared.tree === undefined ? {} : { tree: input.prepared.tree }),
    }),
    ...(input.prepared.tree === undefined
      ? {}
      : { worktreeDigest: hashParts(['task-review-snapshot-v1', input.prepared.tree]) }),
    target: targetIdentity(input.reviewer),
    reviewer: input.reviewer.id,
    session: input.session,
    runId: input.run.id,
    time: new Date(now).toISOString(),
  }
}

/** Settle a review step from the record it just wrote. */
async function settleFromRecord(
  input: ReviewRunInput,
  record: ReviewRecord,
  recordPath: string,
  now: number,
): Promise<WorkflowRun> {
  const check = await verifyEvidence(input.step.evidence ?? { kind: 'declaration' }, input.context)
  // The step settles only from the record this run just wrote, never from an
  // older PASS the declared evidence happens to satisfy.
  const bound =
    check.ok && check.evidence.path === recordPath && check.evidence.digest === record.digest
  if (bound) {
    return settleStep(input.run, input.step.id, 'done', { at: now, evidence: check.evidence })
  }
  const reason = !check.ok
    ? record.verdict === 'FINDINGS'
      ? `the review returned FINDINGS (${String(record.findings.length)} P0/P1); fix them and re-run the review`
      : `the review record at ${recordPath} does not satisfy the step: ${check.failure.detail}`
    : `the verified evidence is not the record this review wrote at ${recordPath}; the step stays open`
  return settleStep(input.run, input.step.id, 'blocked', {
    at: now,
    reason,
    evidence: { kind: 'record', path: recordPath, digest: record.digest },
  })
}

async function writeErrorRecord(
  input: ReviewRunInput,
  record: Omit<ReviewRecord, 'verdict' | 'findings'>,
  error: string,
  failureClass: string,
  now: number,
): Promise<ReviewRunResult> {
  const failed: ReviewRecord = {
    ...record,
    verdict: 'ERROR',
    findings: [],
    failureClass,
    error: sanitizeReviewText(error),
  }
  const writeLocal = input.writeLocal ?? writeLocalReviewRecord
  const written = await writeLocal(input.context.workspace, failed)
  const reason = `${error}${written.ok ? `; an ERROR record was written at ${written.path}` : `; the ERROR record could not be written: ${written.error}`}`
  if (!written.ok) {
    const settled = settleStep(input.run, input.step.id, 'failed', {
      at: now,
      reason,
      failureClass,
    })
    return { run: settled, record: failed, error }
  }
  // An accepted ERROR is usable evidence for an intermediate close: settle the
  // step from the record and let the gate refuse a PASS-dependent close. The
  // run names the failure and the next action; it never approves.
  const run = await settleFromRecord(input, failed, written.path, now)
  return { run, record: failed, recordPath: written.path, error }
}
/**
 * Run one review step. It awaits the reviewer (the queue and asynchronous
 * admission wrap this function), writes the record, and settles the step from
 * the evidence verifier. A failed start, a timeout, a malformed verdict, or a
 * changed whole-scope input writes an ERROR record and publishes no PASS.
 */
export async function runReviewStep(input: ReviewRunInput): Promise<ReviewRunResult> {
  const now = input.now ?? Date.now()
  const spec = input.step.review
  if (spec === undefined) {
    return {
      run: settleStep(input.run, input.step.id, 'failed', {
        at: now,
        reason: 'the step declares no review',
      }),
      error: 'the step declares no review',
    }
  }
  if (spec.scope === 'task' && input.task === undefined) {
    return {
      run: settleStep(input.run, input.step.id, 'failed', {
        at: now,
        reason: 'a task review needs the run context task id',
      }),
      error: 'a task review needs the run context task id',
    }
  }
  const rule = input.definition.settings.gateIdentity ?? input.definition.id
  const declared = input.step.evidence
  if (declared === undefined || declared.kind !== 'record' || declared.rule !== rule) {
    const reason = `the review step must declare a "record" evidence contract for rule "${rule}"; a review never settles from unrelated evidence`
    return {
      run: settleStep(input.run, input.step.id, 'failed', { at: now, reason }),
      error: reason,
    }
  }
  const record = baseRecord(input, now)
  const promptInput: ReviewPromptInput = {
    instruction: spec.instruction,
    rule: record.rule,
    change: input.change,
    scope: spec.scope,
    ...(spec.phase === undefined ? {} : { phase: spec.phase }),
    ...(input.task === undefined ? {} : { task: input.task }),
    digest: record.digest,
    snapshot: input.prepared.reviewCwd !== undefined,
    ...(input.step.prompt === undefined ? {} : { extra: input.step.prompt }),
  }
  let prompt: string
  try {
    prompt = (input.renderPrompt ?? renderReviewPrompt)(promptInput)
  } catch (error) {
    return await writeErrorRecord(
      input,
      record,
      `the bundled review instruction "${spec.instruction}" could not be rendered: ${error instanceof Error ? error.message : String(error)}`,
      'config',
      now,
    )
  }

  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort()
  input.signal?.addEventListener('abort', forwardAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  const stopped = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('the review timed out after the configured review timeout')),
      { once: true },
    )
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('the review timed out after the configured review timeout'))
    }, input.timeoutMs)
  })

  let text: string
  try {
    const child = await Promise.race([
      input.runner.run(
        {
          provider: input.reviewer.provider,
          prompt,
          reviewer: input.reviewer.id,
          label: `delegation:${record.rule}`,
          delivery: 'parent',
          ...(input.prepared.reviewCwd === undefined ? {} : { cwd: input.prepared.reviewCwd }),
          ...(input.reviewer.model === undefined ? {} : { model: input.reviewer.model }),
          ...(input.reviewer.reasoningEffort === undefined
            ? {}
            : { reasoningEffort: input.reviewer.reasoningEffort }),
          ...(input.reviewer.agentOptions === undefined
            ? {}
            : { agentOptions: input.reviewer.agentOptions }),
        },
        controller.signal,
      ),
      stopped,
    ])
    if (!child.completed) {
      const reason = `the reviewer did not complete${child.error === undefined ? '' : `: ${child.error.slice(0, 200)}`}`
      return await writeErrorRecord(input, record, reason, 'provider-not-started', now)
    }
    if (child.text === undefined || child.text.trim() === '') {
      return await writeErrorRecord(
        input,
        record,
        'the reviewer returned no text verdict; re-run the review',
        'invalid-output',
        now,
      )
    }
    text = child.text
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = message.includes('timed out')
    return await writeErrorRecord(
      input,
      record,
      message,
      timedOut ? 'timeout' : 'provider-not-started',
      now,
    )
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    input.signal?.removeEventListener('abort', forwardAbort)
  }

  const parsed = parseReviewVerdict(text, record.digest)
  if (!parsed.ok) {
    return await writeErrorRecord(
      input,
      record,
      `${parsed.error}; re-run the review on the current digest`,
      'invalid-output',
      now,
    )
  }
  if (input.prepared.liveGuard !== undefined) {
    const stillCurrent = await input.prepared.liveGuard().catch(() => false)
    if (!stillCurrent) {
      return await writeErrorRecord(
        input,
        record,
        'reviewed inputs changed during the run; finish the writes and re-run the review',
        'reviewed-inputs-changed',
        now,
      )
    }
  }

  const published: ReviewRecord = { ...record, verdict: parsed.verdict, findings: parsed.findings }
  if (published.scope === 'task' && published.verdict === 'PASS') {
    // The committed approval is written first; a failed publish publishes no PASS.
    const writePortable = input.writePortable ?? writePortableApproval
    const approval = await writePortable(input.context.workspace, published)
    if (!approval.ok) {
      return await writeErrorRecord(
        input,
        record,
        `the committed approval at ${portableApprovalPath(published.change, published.taskId ?? '')} could not be written: ${approval.error}`,
        'unknown',
        now,
      )
    }
  }
  const writeLocal = input.writeLocal ?? writeLocalReviewRecord
  const local = await writeLocal(input.context.workspace, published)
  if (!local.ok) {
    return {
      run: settleStep(input.run, input.step.id, 'failed', {
        at: now,
        reason: `the review record could not be written: ${local.error}`,
      }),
      error: local.error,
    }
  }
  const run = await settleFromRecord(input, published, local.path, now)
  return { run, record: published, recordPath: local.path }
}
