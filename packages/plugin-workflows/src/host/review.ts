import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CHANGE_NAME } from './command-parse.js'
import {
  type Definition,
  type Evidence,
  type RecordEvidence,
  reviewIdentityOf,
  reviewStoreOf,
  type Step,
} from './definitions.js'
import { type EvidenceContext, reviewDigest, verifyEvidence } from './evidence.js'
import type { SubagentRunner, SubagentRunResult } from './executors.js'
import { isInside } from './fs-change.js'
import { defaultGit, type GitRunner, repositoryRoot } from './git.js'
import { localRecordError } from './projection.js'
import { classifyFailure, type FailureClass } from './review-queue.js'
import { setRunStatus, settleStep, type WorkflowRun } from './runs.js'

/**
 * The native review executor. It resolves a reviewer from the row's
 * `reviewers` map, renders a bundled instruction with the change, task and
 * digest context, accepts exactly one fenced JSON verdict that echoes the
 * prepared digest, writes the local record (and, for a task PASS, the committed
 * approval first), and settles the step from its own evidence. Every failure
 * writes an ERROR record and publishes no PASS.
 */

export const TASK_ID_PATTERN = /^[0-9a-f]{16}$/u

/**
 * Typed review failures: the queue's classifier reads the name and provider
 * message, so a permanent cause is never retried as a transient one.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export class ProviderStartError extends Error {
  constructor(
    message: string,
    readonly providerMessage?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ProviderStartError'
  }
}

export class ProviderResultError extends Error {
  constructor(
    message: string,
    readonly providerMessage?: string,
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ProviderResultError'
  }
}

export class InputMutationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputMutationError'
  }
}

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

/** A focused re-review confirms every prior finding by its stable per-record id. */
export interface ReviewConfirmation {
  readonly id: string
  readonly status: 'closed' | 'open'
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
  concurrency: 10,
  maxQueued: 16,
  maxAttempts: 3,
  baseDelayMs: 5_000,
  maxDelayMs: 60_000,
  // Above the default review timeout: a review waiting behind the concurrency
  // limit must outlast a full review, or the section runs the engine starts
  // together settle as queue-timeout before a slot frees.
  waitTimeoutMs: 1_200_000,
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
        : integerIn(raw.concurrency, 'concurrency', 1, 10),
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

/** One section-scope task review: the resolved section and its checked coverage. */
export interface SectionReview {
  readonly key: string
  readonly title: string
  /** The stable 16-hex id the step's record evidence names in place of a task id. */
  readonly recordId: string
  readonly covered: ReadonlyArray<{
    readonly id: string
    readonly number: string
    readonly text: string
  }>
  readonly unchecked: ReadonlyArray<{
    readonly id: string
    readonly number: string
    readonly text: string
  }>
}

/** The section digest: key, title, sorted covered ids/numbers/texts, the frozen
 * change artifacts, and the snapshot tree. Any coverage change invalidates it. */
export function sectionReviewDigest(
  section: SectionReview,
  artifactDigest: string,
  tree?: string,
): string {
  const covered = [...section.covered].sort((left, right) => {
    const leftKey = `${left.id}\u0000${left.number}`
    const rightKey = `${right.id}\u0000${right.number}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
  return hashParts([
    'section-review-v2',
    section.key,
    section.title,
    ...covered.flatMap((task) => [task.id, task.number, task.text]),
    artifactDigest,
    tree ?? '',
  ])
}

/** One review record; the local file is a provenance superset of the approval. */
export interface ReviewRecord {
  readonly definition: string
  readonly rule: string
  readonly change: string
  readonly phase: string
  readonly scope: 'whole' | 'task'
  readonly taskId?: string
  /** A section-scope task review: the section key, title, and covered task ids. */
  readonly section?: string
  readonly sectionTitle?: string
  readonly taskIds?: readonly string[]
  readonly digest: string
  readonly worktreeDigest?: string
  /** The snapshot tree the verdict was rendered from; a focused re-review diffs from it. */
  readonly reviewedTree?: string
  /** The focused re-review confirmations; local only, never in the committed approval. */
  readonly previous?: readonly ReviewConfirmation[]
  readonly verdict: ReviewVerdict
  readonly findings: readonly ReviewFinding[]
  readonly target: Readonly<{ provider: string; model?: string; reasoningEffort?: string }>
  readonly reviewer: string
  readonly session?: string
  readonly runId?: string
  /** The transport attempt count this record settled. */
  readonly attempts?: number
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
  | {
      readonly ok: true
      readonly verdict: 'PASS' | 'FINDINGS'
      readonly findings: ReviewFinding[]
      readonly previous?: readonly ReviewConfirmation[]
    }
  | { readonly ok: false; readonly error: string }

/**
 * Accept exactly one fenced JSON verdict that echoes the requested digest. With
 * prior ids the verdict is a focused re-review: it confirms every prior finding
 * by id, and an open prior id is repeated by exactly one finding.
 */
export function parseReviewVerdict(
  text: string,
  expectedDigest: string,
  priorIds?: readonly string[],
): ParsedVerdict {
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
  let previous: ReviewConfirmation[] | undefined
  if (priorIds !== undefined) {
    const rawPrevious = value.previous
    if (!Array.isArray(rawPrevious)) {
      return {
        ok: false,
        error:
          'a focused re-review verdict needs a "previous" list with exactly one confirmation per prior finding id',
      }
    }
    const known = new Set(priorIds)
    const open = new Set<string>()
    const seen = new Set<string>()
    previous = []
    for (const [index, raw] of rawPrevious.entries()) {
      const position = `previous #${String(index + 1)}`
      if (!isRecord(raw)) return { ok: false, error: `${position} must be an object` }
      if (typeof raw.id !== 'string') {
        return { ok: false, error: `${position}.id must be a string` }
      }
      if (!known.has(raw.id)) {
        return {
          ok: false,
          error: `${position} names unknown prior finding id "${raw.id}"; use the ids listed in the prompt`,
        }
      }
      if (seen.has(raw.id)) {
        return {
          ok: false,
          error: `${position} repeats prior finding id "${raw.id}"; exactly one confirmation per prior id is required`,
        }
      }
      if (raw.status !== 'closed' && raw.status !== 'open') {
        return { ok: false, error: `${position}.status must be "closed" or "open"` }
      }
      seen.add(raw.id)
      if (raw.status === 'open') open.add(raw.id)
      previous.push({ id: raw.id, status: raw.status })
    }
    const missing = priorIds.filter((id) => !seen.has(id))
    if (missing.length > 0) {
      return {
        ok: false,
        error: `the verdict omits prior finding id(s) ${missing.join(', ')}; exactly one confirmation per prior id is required`,
      }
    }
    if (verdict === 'PASS' && open.size > 0) {
      return { ok: false, error: 'verdict PASS requires every prior finding to be closed' }
    }
    const named = new Map<string, number>()
    for (const [index, raw] of rawFindings.entries()) {
      const position = `finding #${String(index + 1)}`
      const previousId = isRecord(raw) ? raw.previousId : undefined
      if (previousId === undefined) continue
      if (typeof previousId !== 'string') {
        return { ok: false, error: `${position}.previousId must be a string` }
      }
      if (!known.has(previousId)) {
        return {
          ok: false,
          error: `${position}.previousId names unknown prior finding id "${previousId}"`,
        }
      }
      if (!open.has(previousId)) {
        return {
          ok: false,
          error: `${position} names prior finding "${previousId}", but that confirmation is "closed"; a closed finding is not reported again`,
        }
      }
      named.set(previousId, (named.get(previousId) ?? 0) + 1)
    }
    for (const id of open) {
      const count = named.get(id) ?? 0
      if (count !== 1) {
        return {
          ok: false,
          error:
            count === 0
              ? `the open prior finding "${id}" is not named by a finding; add previousId "${id}" to exactly one finding`
              : `the open prior finding "${id}" is named by ${String(count)} findings; exactly one finding may carry previousId "${id}"`,
        }
      }
    }
  }
  if (verdict === 'PASS' && findings.length > 0) {
    return { ok: false, error: 'verdict PASS requires zero P0/P1 findings' }
  }
  if (verdict === 'FINDINGS' && findings.length === 0) {
    return { ok: false, error: 'verdict FINDINGS requires at least one P0/P1 finding' }
  }
  return {
    ok: true,
    verdict,
    findings,
    ...(previous === undefined ? {} : { previous }),
  }
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

/** One prior finding keyed by its stable per-record id (`f1`..`fn`). */
export interface FocusedFinding {
  readonly id: string
  readonly finding: ReviewFinding
}

/** The bounded change set between the prior reviewed tree and the current one. */
export interface ReviewChangeSet {
  readonly fromTree: string
  readonly toTree: string
  /** The changed-path list, bounded to the first entries. */
  readonly paths: readonly string[]
  readonly pathsTruncated: boolean
  readonly patch: string
  readonly patchTruncated: boolean
  /** The current snapshot checkout, named when the patch is truncated. */
  readonly reviewCwd?: string
}

/** The focused re-review context rendered after the review's sections. */
export interface FocusedReviewContext {
  /** The complete prior-finding inventory, in the prior record's order. */
  readonly previous: readonly FocusedFinding[]
  /** The bounded diff; absent means it could not be built. */
  readonly changes?: ReviewChangeSet
  /** Why the diff is unavailable, named in the prompt. */
  readonly diffUnavailable?: string
}

export interface ReviewPromptInput {
  readonly instruction: string
  readonly rule: string
  readonly change: string
  readonly scope: 'whole' | 'task'
  readonly phase?: string
  readonly task?: { readonly id: string; readonly number?: string; readonly text: string }
  readonly section?: SectionReview
  readonly digest: string
  readonly snapshot: boolean
  readonly extra?: string
  /** The prior findings and bounded diff when this unit's last record is a moved FINDINGS. */
  readonly focused?: FocusedReviewContext
}

/** One-line prompt token: the review-key line must never be split by its unit. */
function promptKeyToken(value: string): string {
  const token = value
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (token === '') return 'untitled'
  if (token.length <= 120) return token
  // Two long headings can share their first 120 characters; the hash keeps the
  // shortened key (and its snapshot path) unique to the complete parser key.
  const hash = createHash('sha256').update(token).digest('hex').slice(0, 12)
  return `${token.slice(0, 106)}-${hash}`
}

/**
 * The stable review key: `review:<change>:section:<key>` for a section unit,
 * `:task:<id>` for a per-task unit, or `:whole:<phase>` for a whole-scope
 * review. The prompt line is the Codex provider's thread key, so the same unit
 * resumes the same reviewer conversation and a different unit never does.
 */
export function reviewUnitKey(input: {
  readonly change: string
  readonly scope: 'whole' | 'task'
  readonly phase?: string
  readonly task?: { readonly id: string }
  readonly section?: { readonly key: string }
}): string {
  if (input.scope !== 'task') {
    return `review:${input.change}:whole:${promptKeyToken(reviewPhase('whole', input.phase))}`
  }
  if (input.section !== undefined) {
    return `review:${input.change}:section:${promptKeyToken(input.section.key)}`
  }
  if (input.task !== undefined) {
    return `review:${input.change}:task:${input.task.id}`
  }
  throw new Error('a task review prompt needs a task id or a section unit')
}

/** Bounds for the focused diff; only the diff is bounded, never the prior inventory. */
const MAX_CHANGED_PATHS = 200
const MAX_DIFF_LINES = 400
const MAX_DIFF_BYTES = 32 * 1024
const MAX_PREVIOUS_FINDINGS_BYTES = 256 * 1024
/** A snapshot tree is a 40-hex git tree id; a live-worktree digest is 64 hex. */
const GIT_TREE = /^[0-9a-f]{40}$/u

/** The complete prior-finding inventory, keyed by its stable id. Never truncated. */
function previousFindingsBlock(previous: readonly FocusedFinding[]): string {
  const lines = ['## Previous findings', '']
  for (const entry of previous) {
    const finding = entry.finding
    lines.push(
      `- ${entry.id} [${finding.severity}] (${finding.class}) ${finding.title}`,
      `  - Evidence: ${finding.evidence}`,
      `  - Fix: ${finding.fix}`,
    )
  }
  return lines.join('\n')
}

/** The changed-path list and the fenced bounded patch. */
function changesSinceBlock(changes: ReviewChangeSet): string {
  const lines = [
    '## Changes since the last review',
    '',
    `The prior reviewed tree is \`${changes.fromTree}\`; the current reviewed tree is \`${changes.toTree}\`.`,
    '',
    changes.pathsTruncated
      ? `Changed paths (the first ${String(changes.paths.length)}; the list is bounded):`
      : `Changed paths (${String(changes.paths.length)}):`,
  ]
  if (changes.paths.length === 0) lines.push('(none)')
  for (const path of changes.paths) lines.push(`- ${path}`)
  if (changes.patchTruncated) {
    const readable =
      changes.reviewCwd === undefined
        ? 'the current reviewed worktree'
        : `the current snapshot checkout at ${changes.reviewCwd}`
    lines.push(
      '',
      `The patch is truncated at the ${String(MAX_DIFF_LINES)}-line / ${String(MAX_DIFF_BYTES / 1024)} KiB bound; read the full change in ${readable}.`,
    )
  }
  lines.push('', '```diff', changes.patch, '```')
  return lines.join('\n')
}

/** The fallback line naming why no diff could be rendered. */
function unavailableDiffBlock(focused: FocusedReviewContext): string {
  const cause = focused.diffUnavailable ?? 'the prior diff is unavailable'
  return `The diff since the prior reviewed tree is unavailable: ${cause}. Confirm the prior findings above from the current reviewed state, and report as new only a P0/P1 introduced since the prior review.`
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
  if (input.section !== undefined) {
    lines.push(
      `- Section: ${input.section.title === '' ? '(untitled)' : input.section.title} (key ${input.section.key})`,
    )
    lines.push('- Covered checked tasks:')
    for (const task of input.section.covered) {
      lines.push(`  - ${task.number} ${task.text} (${task.id})`)
    }
    if (input.section.unchecked.length > 0) {
      lines.push('- Unchecked tasks in this section (not reviewed):')
      for (const task of input.section.unchecked) {
        lines.push(`  - ${task.number} ${task.text}`)
      }
    }
    lines.push(
      '- One verdict covers the whole section. Name the affected task number in every finding, and report a finding when one covered task is incomplete.',
    )
  }
  lines.push(`- Digest: ${input.digest}`)
  lines.push(`- Review key: ${reviewUnitKey(input)}`)
  lines.push(
    input.snapshot
      ? '- Reviewed state: a frozen worktree snapshot taken when the review started; later writes are not in it.'
      : '- Reviewed state: the live worktree; a changed input discards the verdict.',
  )
  const contextParts = [input.extra]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value !== '')
  if (contextParts.length > 0) lines.push('', '## Context', '', contextParts.join('\n\n'))
  if (input.focused !== undefined) {
    lines.push('', previousFindingsBlock(input.focused.previous))
    lines.push(
      '',
      input.focused.changes === undefined
        ? unavailableDiffBlock(input.focused)
        : changesSinceBlock(input.focused.changes),
    )
    // The frozen snapshot excludes the active change directory, so the tree
    // diff never carries the artifacts the digest also binds.
    lines.push(
      '',
      'The change artifacts (proposal, design, delta specs, and tasks) are outside this tree diff; read them in the current snapshot before confirming.',
    )
  }
  lines.push(
    '',
    'Return exactly one fenced JSON block whose `digest` is the value above, `verdict` is `PASS` or `FINDINGS`, and `findings` lists only P0/P1 items with `class`, `title`, `evidence`, and `fix`. Prose outside that block is ignored.',
  )
  if (input.focused !== undefined) {
    lines.push(
      '',
      'This is a focused re-review: also return `previous` with exactly one `{ "id": "f1", "status": "closed" | "open" }` entry for every prior id listed above, and repeat each `open` prior id by exactly one finding carrying `previousId` with that id. A `closed` prior id must not be named by a finding.',
    )
  }
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

/** The per-scope digest lives with the evidence verifier; kept importable here. */
export { reviewDigest } from './evidence.js'

/** Write one file atomically: temp beside the target, then rename. */
export async function writeReviewFileAtomic(
  file: string,
  bytes: string,
  cancelled?: () => boolean,
  createParents = true,
): Promise<void> {
  // A portable approval is written only into an existing change directory; the
  // caller creates the leaf itself so a late verdict cannot recreate an
  // archived change's tree.
  if (createParents) await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${String(process.pid)}.${randomBytes(4).toString('hex')}.tmp`
  await writeFile(temporary, bytes)
  try {
    // The run may settle completed-soft while the temporary file is prepared;
    // the commit must not land in that window.
    if (cancelled?.() === true) {
      throw new Error(
        'the run settled completed-soft before its record was committed; the late verdict is discarded',
      )
    }
    await rename(temporary, file)
    // A fence can land while the rename is in flight; never leave the
    // committed record behind for a settled integration run.
    if (cancelled?.() === true) {
      await unlink(file).catch(() => undefined)
      throw new Error(
        'the run settled completed-soft while its record was committed; the late verdict is discarded',
      )
    }
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
export async function containedRecordTarget(workspace: string, relative: string): Promise<string> {
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
  cancelled?: () => boolean,
): Promise<ReviewWrite> {
  try {
    const path = localReviewRecordPath(record)
    const target = await containedRecordTarget(workspace, path)
    // The run may have settled completed-soft while the target was resolved.
    if (cancelled?.() === true) {
      return {
        ok: false,
        error:
          'the run settled completed-soft before its record was written; the late verdict is discarded',
      }
    }
    await writeReviewFileAtomic(target, jsonText(record), cancelled)
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
  cancelled?: () => boolean,
): Promise<ReviewWrite> {
  if (record.scope !== 'task' || record.taskId === undefined) {
    return { ok: false, error: 'a committed approval is written only for a task-scoped PASS' }
  }
  if (cancelled?.() === true) {
    return {
      ok: false,
      error:
        'the run settled completed-soft before its approval was written; the late verdict is discarded',
    }
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
  // A publication that lands after the change left the active tree must not
  // recreate its directory: validate containment first, then create only the
  // `reviews` leaf and write without creating parents.
  const relative = portableApprovalPath(record.change, record.taskId)
  let resolved: string
  try {
    resolved = await containedRecordTarget(workspace, relative)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  try {
    await mkdir(dirname(resolved), { recursive: false })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      return {
        ok: false,
        error:
          'the change is not active under openspec/changes; the late verdict is discarded and no directory is created',
      }
    }
  }
  try {
    await writeReviewFileAtomic(resolved, jsonText(portableApprovalOf(record)), cancelled, false)
    return { ok: true, path: relative }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** A review's runner: it can report when the target actually started. */
export interface ReviewSubagentRunner extends SubagentRunner {
  /** Resolves once the most recent target activation is published; rejects on a start failure. */
  awaitStart?(): Promise<void>
}

export interface ReviewRunInput {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly step: Step
  readonly reviewer: ResolvedReviewer
  readonly runner: ReviewSubagentRunner
  readonly context: EvidenceContext
  readonly change: string
  readonly task?: { readonly id: string; readonly number?: string; readonly text: string }
  readonly prepared: {
    readonly specDigest: string
    /** A content tree digest for a frozen task snapshot. */
    readonly tree?: string
    /** The frozen change-artifact digest for a task review. */
    readonly artifactDigest?: string
    /** The frozen checkout to run in; absent means the live worktree. */
    readonly reviewCwd?: string
    /** The authoritative section coverage of a section-scope task review. */
    readonly section?: SectionReview
    /** Re-check the reviewed input set after the run; a reason discards the verdict. */
    readonly liveGuard?: () => Promise<string | undefined>
  }
  readonly timeoutMs: number
  readonly session: string
  readonly now?: number
  /** The transport attempt this verdict/error settled, for the durable record. */
  readonly attempts?: number
  readonly signal?: AbortSignal
  /** The git runner the focused diff uses; production spawns the bounded runner. */
  readonly runGit?: GitRunner
  /** Captured before the first start; a retry preserves it across attempts. */
  readonly baseline?: ReviewRecordBaseline
  /** True once the run settled completed-soft; a late verdict is discarded. */
  readonly cancelled?: () => boolean
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
  /** A newer authoritative record superseded this attempt; nothing was written. */
  readonly discarded?: boolean
}

/**
 * The authoritative record fingerprint captured immediately before a review's
 * first start; a retry keeps it, so only the settled attempt may publish.
 */
export interface ReviewRecordBaseline {
  /** The record file's normalized JSON, or undefined when no record existed. */
  readonly fingerprint: string | undefined
}

/** The local record path one review attempt publishes to. */
export function reviewRecordPathOf(
  input: Pick<ReviewRunInput, 'definition' | 'change' | 'step' | 'task' | 'prepared'>,
): string {
  const spec = input.step.review
  if (spec === undefined) throw new Error(`step "${input.step.id}" declares no review`)
  const taskId = input.prepared.section?.recordId ?? input.task?.id
  return localReviewRecordPath({
    definition: reviewStoreOf(input.definition, input.step),
    change: input.change,
    scope: spec.scope,
    ...(spec.phase === undefined ? {} : { phase: spec.phase }),
    ...(taskId === undefined ? {} : { taskId }),
  })
}

/** Read the authoritative record's comparable fingerprint; absent or unreadable is undefined. */
export async function readReviewRecordFingerprint(
  workspace: string,
  input: Pick<ReviewRunInput, 'definition' | 'change' | 'step' | 'task' | 'prepared'>,
): Promise<string | undefined> {
  try {
    const raw = await readFile(join(workspace, reviewRecordPathOf(input)), 'utf8')
    return JSON.stringify(JSON.parse(raw))
  } catch {
    return undefined
  }
}

/**
 * Discard a completion whose authoritative record changed after the start
 * baseline: a superseded or late attempt never writes over its successor.
 */
async function supersededOutcome(
  input: ReviewRunInput,
  now: number,
): Promise<ReviewRunResult | undefined> {
  if (input.baseline === undefined) return undefined
  const current = await readReviewRecordFingerprint(input.context.workspace, input)
  if (current === input.baseline.fingerprint) return undefined
  const reason =
    'a newer review record was published while this review ran; its late completion is discarded and the authoritative record is unchanged'
  return {
    run: settleStep(input.run, input.step.id, 'failed', { at: now, reason }),
    error: reason,
    discarded: true,
  }
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
  /** A started attempt's start baseline; a pre-start failure carries none. */
  readonly baseline?: ReviewRecordBaseline
  /** True once the run was stopped; a cancelled publication writes no record. */
  readonly cancelled?: () => boolean
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
  const identity = reviewIdentityOf(input.definition, input.step)
  const section = input.prepared.section
  const artifactDigest = input.prepared.artifactDigest ?? input.prepared.specDigest
  return {
    definition: reviewStoreOf(input.definition, input.step),
    rule: identity,
    change: input.change,
    phase: reviewPhase(spec.scope, spec.phase),
    scope: spec.scope,
    ...(section === undefined
      ? input.task === undefined
        ? {}
        : { taskId: input.task.id }
      : {
          taskId: section.recordId,
          section: section.key,
          sectionTitle: section.title,
          taskIds: section.covered.map((task) => task.id),
        }),
    digest:
      section === undefined
        ? reviewDigest({
            scope: spec.scope,
            specDigest: input.prepared.specDigest,
            ...(input.prepared.tree === undefined ? {} : { tree: input.prepared.tree }),
            ...(input.prepared.artifactDigest === undefined
              ? {}
              : { artifactDigest: input.prepared.artifactDigest }),
          })
        : sectionReviewDigest(section, artifactDigest, input.prepared.tree),
    ...(input.prepared.tree === undefined
      ? {}
      : {
          worktreeDigest: hashParts([
            section === undefined ? 'task-review-snapshot-v1' : 'section-review-snapshot-v1',
            input.prepared.tree,
          ]),
          reviewedTree: input.prepared.tree,
        }),
    ...(input.attempts === undefined ? {} : { attempts: input.attempts }),
    target: targetIdentity(input.reviewer),
    reviewer: input.reviewer.id,
    session: input.session,
    runId: input.run.id,
    time: new Date(now).toISOString(),
  }
}

/**
 * The step's record contract narrowed to the ERROR verdict, when it is one.
 * Shared with the intake, which consumes a current matching ERROR without
 * starting a second review.
 */
export function errorContractOf(evidence: Evidence): RecordEvidence | undefined {
  if (evidence.kind !== 'record') return undefined
  const { verdict: _verdict, verdicts: _verdicts, ...rest } = evidence
  return { ...rest, verdict: 'ERROR' }
}

/**
 * The step's record contract narrowed to the PASS verdict, when it is one.
 * Shared with the intake: a whole-scope step's declared PASS|ERROR contract must
 * never complete a new run's step from a predecessor's stored ERROR.
 */
export function passContractOf(evidence: Evidence): RecordEvidence | undefined {
  if (evidence.kind !== 'record') return undefined
  const { verdict: _verdict, verdicts: _verdicts, ...rest } = evidence
  return { ...rest, verdict: 'PASS' }
}

/**
 * The failed review steps whose current record is a contract-matching ERROR.
 * Only those failures are provisional turn-close evidence: a recordless failure
 * (unreadable artifacts, an unpublished ERROR) or a record that no longer
 * matches the step contract keeps the close blocked.
 */
export async function provisionalReviewSteps(
  run: WorkflowRun,
  definition: Definition,
  context: EvidenceContext,
): Promise<ReadonlySet<string>> {
  const steps = new Set<string>()
  for (const step of definition.steps) {
    if (step.executor !== 'review') continue
    if (run.steps.find((entry) => entry.id === step.id)?.state !== 'failed') continue
    const contract = errorContractOf(step.evidence ?? { kind: 'declaration' })
    if (contract !== undefined && (await verifyEvidence(contract, context)).ok) steps.add(step.id)
  }
  return steps
}

/** Settle a review step from the record it just wrote. */
async function settleFromRecord(
  input: ReviewRunInput,
  record: ReviewRecord,
  recordPath: string,
  now: number,
): Promise<WorkflowRun> {
  const declared = input.step.evidence ?? { kind: 'declaration' }
  const check = await verifyEvidence(declared, input.context)
  // The step settles only from the record this run just wrote, never from an
  // older PASS the declared evidence happens to satisfy. The published file
  // must still be this run's own verdict: a concurrent review with the same
  // digest can replace it between write and verification.
  let persisted: ReviewRecord | undefined
  try {
    persisted = JSON.parse(
      await readFile(join(input.context.workspace, recordPath), 'utf8'),
    ) as ReviewRecord
  } catch {
    persisted = undefined
  }
  const samePublication =
    persisted !== undefined &&
    persisted.runId === input.run.id &&
    persisted.verdict === record.verdict &&
    persisted.digest === record.digest
  const bound =
    check.ok &&
    check.evidence.path === recordPath &&
    check.evidence.digest === record.digest &&
    samePublication
  if (bound) {
    return settleStep(input.run, input.step.id, 'done', { at: now, evidence: check.evidence })
  }
  // An ERROR that otherwise matches the step's record contract is provisional
  // turn-close evidence: only a PASS completes the step, so the close stays
  // allowed with the failure visible, approval and completion stay unavailable,
  // and the next advance retries the review. FINDINGS and a stale or foreign
  // record stay blocked.
  const errorContract =
    !check.ok && samePublication && record.verdict === 'ERROR'
      ? errorContractOf(declared)
      : undefined
  const provisional =
    errorContract === undefined ? undefined : await verifyEvidence(errorContract, input.context)
  if (provisional?.ok === true) {
    const detail = record.error ?? (check.ok ? '' : check.failure.detail)
    return settleStep(input.run, input.step.id, 'failed', {
      at: now,
      reason: `the review returned ERROR; the step stays incomplete without approval or completion, the close is allowed with the failure visible, and the next close retries the review: ${detail.slice(0, 160)}`,
      evidence: { kind: 'record', path: recordPath, digest: record.digest },
      // The record's class is the attempt's fact: it keeps the retry budget and
      // the refusal diagnostic consistent across the lifecycle write.
      ...(typeof record.failureClass === 'string' ? { failureClass: record.failureClass } : {}),
    })
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
    ...(typeof record.failureClass === 'string' ? { failureClass: record.failureClass } : {}),
  })
}

/** One stored verdict that settles its review unit for the round it reviewed. */
export interface SettledReviewRound {
  readonly record: ReviewRecord
  readonly verdict: ReviewVerdict
  readonly digest: string
  readonly recordPath: string
  /** The checked task ids the round covered; empty for a whole-scope unit. */
  readonly covered: readonly string[]
}

/** Failure classes that discarded their verdict: retryable, never a settled round. */
const DISCARDED_REVIEW_FAILURES: ReadonlySet<string> = new Set([
  'reviewed-inputs-changed',
  'queue-internal-error',
])

/**
 * The settled round of one review unit, read from the record at the path the
 * unit publishes to. It is well-formed and binds the verdict to the digest of
 * the round it reviewed; a section record covers exactly the unit's checked
 * task set. A discarded-input or queue-fault ERROR carries no verdict and does
 * not settle. `digests` may be lazy so an absent record costs no git work.
 */
export async function readSettledReviewRound(input: {
  readonly workspace: string
  readonly definition: Definition
  readonly step: Step
  readonly change: string
  /** The task or section record id; absent for a whole-scope unit. */
  readonly recordId?: string
  /** Every digest the unit's current round would record; any match settles it. */
  readonly digests: readonly string[] | (() => Promise<readonly string[]>)
  /** The checked-task set a section record must cover. */
  readonly covered?: readonly string[]
}): Promise<SettledReviewRound | undefined> {
  const spec = input.step.review
  if (spec === undefined) return undefined
  let recordPath: string
  try {
    recordPath = localReviewRecordPath({
      definition: reviewStoreOf(input.definition, input.step),
      change: input.change,
      scope: spec.scope,
      ...(spec.phase === undefined ? {} : { phase: spec.phase }),
      ...(input.recordId === undefined ? {} : { taskId: input.recordId }),
    })
  } catch {
    return undefined
  }
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(input.workspace, recordPath), 'utf8'))
  } catch {
    return undefined
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  if (localRecordError(raw as Record<string, unknown>) !== undefined) return undefined
  const record = raw as ReviewRecord
  if (record.change !== input.change || record.scope !== spec.scope) return undefined
  if (record.rule !== reviewIdentityOf(input.definition, input.step)) return undefined
  if (spec.scope === 'task' && record.taskId !== input.recordId) return undefined
  if (record.verdict === 'ERROR' && DISCARDED_REVIEW_FAILURES.has(record.failureClass ?? '')) {
    return undefined
  }
  if (record.section !== undefined) {
    if (input.covered === undefined) return undefined
    const covered = [...(record.taskIds ?? [])].sort().join('\u0000')
    if (covered !== [...input.covered].sort().join('\u0000')) return undefined
  }
  const digests = typeof input.digests === 'function' ? await input.digests() : input.digests
  if (!digests.includes(record.digest)) return undefined
  return {
    record,
    verdict: record.verdict,
    digest: record.digest,
    recordPath,
    covered: record.taskIds ?? (record.taskId === undefined ? [] : [record.taskId]),
  }
}

/**
 * Settle a review step from a verdict its unit already stored. A matching PASS
 * settles done when the step's contract accepts it; a FINDINGS settles blocked
 * and an ERROR settles failed, both naming the verdict, the digest, the record,
 * and the explicit fresh-round remedy. An already settled step is returned
 * unchanged so a repeated close writes nothing.
 */
export async function settleStoredReviewRound(input: {
  readonly run: WorkflowRun
  readonly definition: Definition
  readonly step: Step
  readonly context: EvidenceContext
  readonly settled: SettledReviewRound
  readonly now: number
}): Promise<WorkflowRun> {
  const { run, step, context, settled } = input
  const existing = run.steps.find((entry) => entry.id === step.id)
  const carries =
    existing?.evidence?.kind === 'record' &&
    existing.evidence.path === settled.recordPath &&
    existing.evidence.digest === settled.digest
  const evidence = { kind: 'record', path: settled.recordPath, digest: settled.digest }
  if (settled.verdict === 'PASS') {
    const declared = step.evidence ?? { kind: 'declaration' }
    const check = await verifyEvidence(passContractOf(declared) ?? declared, context)
    const accepted =
      check.ok &&
      check.evidence.path === settled.recordPath &&
      check.evidence.digest === settled.digest
    if (accepted) {
      if (existing?.state === 'done' && carries) return run
      return settleStep(run, step.id, 'done', { at: input.now, evidence: check.evidence })
    }
    if (existing?.state === 'blocked' && carries) return run
    const detail = check.ok ? 'the verified evidence is not this record' : check.failure.detail
    return settleStep(run, step.id, 'blocked', {
      at: input.now,
      reason: `the stored PASS at ${settled.recordPath} does not satisfy the step: ${detail.slice(0, 160)}`,
      evidence,
    })
  }
  const remedy = `fix the findings so the reviewed digest moves, or start a fresh round with workflows(action: "start", definitionId: "${input.definition.id}", change: "${settled.record.change}")`
  if (settled.verdict === 'FINDINGS') {
    if (existing?.state === 'blocked' && carries) return run
    return settleStep(run, step.id, 'blocked', {
      at: input.now,
      reason: `the review settled on FINDINGS (${String(settled.record.findings.length)} P0/P1) at digest ${settled.digest} (record ${settled.recordPath}); ${remedy}`,
      evidence,
    })
  }
  if (existing?.state === 'failed' && carries) return run
  const failureClass = settled.record.failureClass
  const detail = settled.record.error === undefined ? '' : `: ${settled.record.error.slice(0, 160)}`
  return settleStep(run, step.id, 'failed', {
    at: input.now,
    reason: `the review settled on ERROR${failureClass === undefined ? '' : ` (${failureClass})`} at digest ${settled.digest} (record ${settled.recordPath})${detail}; ${remedy}`,
    evidence,
    ...(failureClass === undefined ? {} : { failureClass }),
  })
}

/**
 * The duplicate admission settlement: a review attempt the scheduler rejected
 * because a live run already covers the unit is terminal. It settles cancelled
 * naming that run and writes no review record, so it can never linger blocked
 * with an open step and no executor.
 */
export function settleDuplicateReviewAttempt(
  run: WorkflowRun,
  stepId: string,
  coveringRunId: string,
  at: number,
): WorkflowRun {
  const reason = `the live review run "${coveringRunId}" already covers this unit; that run carries the review`
  return setRunStatus(settleStep(run, stepId, 'cancelled', { at, reason }), 'cancelled', at, reason)
}

async function writeErrorRecord(
  input: ReviewRunInput,
  record: Omit<ReviewRecord, 'verdict' | 'findings'>,
  error: string,
  failureClass: string,
  now: number,
): Promise<ReviewRunResult> {
  const superseded = await supersededOutcome(input, now)
  if (superseded !== undefined) return superseded
  const failed: ReviewRecord = {
    ...record,
    verdict: 'ERROR',
    findings: [],
    failureClass,
    error: sanitizeReviewText(error),
  }
  const writeLocal = input.writeLocal ?? writeLocalReviewRecord
  // The stop can land while the target path is resolved: never publish then.
  const written = await writeLocal(input.context.workspace, failed, input.cancelled)
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
/** The review identity every attempt carries before a verdict exists. */
type ReviewRecordBase = Omit<ReviewRecord, 'verdict' | 'findings'>

export type ReviewAttemptResult =
  | {
      readonly kind: 'verdict'
      readonly verdict: 'PASS' | 'FINDINGS'
      readonly findings: readonly ReviewFinding[]
      /** The focused re-review confirmations; present only with prior ids. */
      readonly previous?: readonly ReviewConfirmation[]
    }
  | {
      readonly kind: 'failure'
      readonly error: string
      readonly failureClass: FailureClass
      readonly transient: boolean
      readonly retryAfterMs?: number
    }

/** One executed attempt, unpublished: the scheduler decides whether it settles. */
export interface ReviewAttemptOutcome {
  readonly record?: ReviewRecordBase
  readonly result: ReviewAttemptResult
}

export interface ReviewAttemptHandle {
  /** Resolves when the target actually started; rejects with the raw start failure. */
  readonly started: Promise<void>
  /** The attempt result; it never rejects. */
  readonly result: Promise<ReviewAttemptOutcome>
  readonly now: number
}

function failureOutcome(
  record: ReviewRecordBase | undefined,
  error: string,
  failureClass: FailureClass,
  transient: boolean,
  retryAfterMs?: number,
): ReviewAttemptOutcome {
  return {
    ...(record === undefined ? {} : { record }),
    result: {
      kind: 'failure',
      error,
      failureClass,
      transient,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
  }
}

/** The prior record's focused inputs, read tolerantly from an engine-written file. */
interface PriorFindings {
  readonly digest: string
  readonly findings: readonly ReviewFinding[]
  readonly reviewedTree?: string
  /** The checked tasks the prior review covered, for a section unit. */
  readonly taskIds?: readonly string[]
}

function priorFindingsOf(value: unknown): PriorFindings | undefined {
  if (!isRecord(value) || value.verdict !== 'FINDINGS') return undefined
  if (typeof value.digest !== 'string') return undefined
  if (!Array.isArray(value.findings) || value.findings.length === 0) return undefined
  const findings: ReviewFinding[] = []
  for (const raw of value.findings) {
    if (!isRecord(raw)) return undefined
    if (raw.severity !== 'P0' && raw.severity !== 'P1') return undefined
    if (
      typeof raw.title !== 'string' ||
      typeof raw.evidence !== 'string' ||
      typeof raw.fix !== 'string'
    ) {
      return undefined
    }
    findings.push({
      severity: raw.severity,
      class: normalizeFindingClass(raw.class),
      title: raw.title,
      evidence: raw.evidence,
      fix: raw.fix,
    })
  }
  return {
    digest: value.digest,
    findings,
    ...(typeof value.reviewedTree === 'string' ? { reviewedTree: value.reviewedTree } : {}),
    ...(Array.isArray(value.taskIds)
      ? {
          taskIds: value.taskIds.filter(
            (entry): entry is string => typeof entry === 'string' && TASK_ID_PATTERN.test(entry),
          ),
        }
      : {}),
  }
}

/** The unit's own latest record, when it is a FINDINGS record this change can focus. */
async function priorFindingsFor(input: ReviewRunInput): Promise<PriorFindings | undefined> {
  try {
    const raw = await readFile(join(input.context.workspace, reviewRecordPathOf(input)), 'utf8')
    return priorFindingsOf(JSON.parse(raw))
  } catch {
    return undefined
  }
}

interface BuiltChanges {
  readonly changes?: ReviewChangeSet
  readonly cause?: string
}

/** Bound the changed-path list and the patch; the prior inventory is never bounded. */
function boundedChanges(
  fromTree: string,
  toTree: string,
  statuses: string,
  patch: string,
  reviewCwd: string | undefined,
): ReviewChangeSet {
  const entries = statuses
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line !== '')
  const lines = patch.split('\n')
  let used = 0
  let bytes = 0
  for (const line of lines) {
    const size = Buffer.byteLength(line, 'utf8') + 1
    if (used >= MAX_DIFF_LINES || bytes + size > MAX_DIFF_BYTES) break
    used += 1
    bytes += size
  }
  return {
    fromTree,
    toTree,
    paths: entries.slice(0, MAX_CHANGED_PATHS),
    pathsTruncated: entries.length > MAX_CHANGED_PATHS,
    patch: lines.slice(0, used).join('\n').trimEnd(),
    patchTruncated: used < lines.length,
    ...(reviewCwd === undefined ? {} : { reviewCwd }),
  }
}

/** The diff from the prior reviewed tree; any unusable input is a named fallback. */
async function changesSince(
  input: ReviewRunInput,
  priorTree: string | undefined,
): Promise<BuiltChanges> {
  const currentTree = input.prepared.tree
  if (priorTree === undefined) {
    return { cause: 'the prior review record carries no reviewed tree' }
  }
  if (currentTree === undefined) {
    return { cause: 'the current review has no frozen tree to compare with the prior tree' }
  }
  if (!GIT_TREE.test(priorTree)) {
    return { cause: `the prior reviewed tree "${priorTree}" is not a git tree id` }
  }
  if (!GIT_TREE.test(currentTree)) {
    return {
      cause: 'the current reviewed tree is not a git tree id (the review ran on the live worktree)',
    }
  }
  const runGit = input.runGit ?? defaultGit
  try {
    const root = await repositoryRoot(input.context.workspace, runGit)
    try {
      await runGit(['cat-file', '-e', `${priorTree}^{tree}`], root)
    } catch {
      return {
        cause: `the prior reviewed tree ${priorTree} is no longer in the repository object database`,
      }
    }
    const statuses = await runGit(['diff', '--name-status', priorTree, currentTree], root)
    const patch = await runGit(
      ['diff', '--no-color', '--no-ext-diff', '--unified=3', priorTree, currentTree],
      root,
    )
    return {
      changes: boundedChanges(
        priorTree,
        currentTree,
        statuses.toString('utf8'),
        patch.toString('utf8'),
        input.prepared.reviewCwd,
      ),
    }
  } catch (error) {
    return {
      cause: `the diff from the prior reviewed tree could not be read (${error instanceof Error ? error.message : String(error)})`,
    }
  }
}

interface FocusedAttempt {
  readonly context: FocusedReviewContext
  readonly ids: readonly string[]
}

/** The focused prompt inputs when the unit's own latest record is a moved FINDINGS. */
async function focusedAttempt(
  input: ReviewRunInput,
  record: ReviewRecordBase,
): Promise<FocusedAttempt | undefined> {
  // Whole-spec reviews have no stored tree to diff, so they stay full reviews.
  if (input.step.review?.scope !== 'task') return undefined
  const prior = await priorFindingsFor(input)
  if (prior === undefined || prior.digest === record.digest) return undefined
  // A section whose covered set changed is a different review scope: a newly
  // checked task may have existed before the prior tree, so its defects stay
  // outside the focused diff and would be approved unread.
  const section = input.prepared.section
  if (section !== undefined) {
    const covered = section.covered.map((task) => task.id)
    const priorCovered = prior.taskIds
    if (
      priorCovered === undefined ||
      priorCovered.length !== covered.length ||
      !covered.every((id) => priorCovered.includes(id))
    ) {
      return undefined
    }
  }
  const previous: FocusedFinding[] = prior.findings.map((finding, index) => ({
    id: `f${String(index + 1)}`,
    finding,
  }))
  const built = await changesSince(input, prior.reviewedTree)
  return {
    ids: previous.map((entry) => entry.id),
    context: {
      previous,
      ...(built.changes === undefined ? {} : { changes: built.changes }),
      ...(built.cause === undefined ? {} : { diffUnavailable: built.cause }),
    },
  }
}

/** Validate the step, prepare the focused context, and render the prompt. */
async function prepareAttempt(
  input: ReviewRunInput,
  now: number,
): Promise<
  | { kind: 'ready'; record: ReviewRecordBase; prompt: string; priorIds?: readonly string[] }
  | { kind: 'failed'; outcome: ReviewAttemptOutcome }
> {
  const spec = input.step.review
  if (spec === undefined) {
    return {
      kind: 'failed',
      outcome: failureOutcome(
        undefined,
        `step "${input.step.id}" declares no review`,
        'config',
        false,
      ),
    }
  }
  if (spec.scope === 'task' && input.task === undefined && input.prepared.section === undefined) {
    return {
      kind: 'failed',
      outcome: failureOutcome(
        undefined,
        'a task review needs the run context task id or a section coverage',
        'config',
        false,
      ),
    }
  }
  const rule = reviewIdentityOf(input.definition, input.step)
  const declared = input.step.evidence
  if (declared === undefined || declared.kind !== 'record' || declared.rule !== rule) {
    const reason = `the review step must declare a "record" evidence contract for rule "${rule}"; a review never settles from unrelated evidence`
    return { kind: 'failed', outcome: failureOutcome(undefined, reason, 'config', false) }
  }
  const record = baseRecord(input, now)
  const focused = await focusedAttempt(input, record)
  if (focused !== undefined) {
    // The complete inventory is never truncated; if it cannot fit whole, the
    // attempt fails loud instead of dropping findings the reviewer must confirm.
    const inventory = Buffer.byteLength(previousFindingsBlock(focused.context.previous), 'utf8')
    if (inventory > MAX_PREVIOUS_FINDINGS_BYTES) {
      return {
        kind: 'failed',
        outcome: failureOutcome(
          record,
          `the complete prior-finding inventory is ${String(inventory)} bytes, over the ${String(MAX_PREVIOUS_FINDINGS_BYTES)}-byte focused review limit; the review did not start because dropping prior findings would break the confirmation contract`,
          'config',
          false,
        ),
      }
    }
  }
  const promptInput: ReviewPromptInput = {
    instruction: spec.instruction,
    rule: record.rule,
    change: input.change,
    scope: spec.scope,
    ...(spec.phase === undefined ? {} : { phase: spec.phase }),
    ...(input.task === undefined ? {} : { task: input.task }),
    ...(input.prepared.section === undefined ? {} : { section: input.prepared.section }),
    digest: record.digest,
    snapshot: input.prepared.reviewCwd !== undefined,
    ...(input.step.prompt === undefined ? {} : { extra: input.step.prompt }),
    ...(focused === undefined ? {} : { focused: focused.context }),
  }
  try {
    const prompt = (input.renderPrompt ?? renderReviewPrompt)(promptInput)
    return {
      kind: 'ready',
      record,
      prompt,
      ...(focused === undefined ? {} : { priorIds: focused.ids }),
    }
  } catch (error) {
    return {
      kind: 'failed',
      outcome: failureOutcome(
        record,
        `the bundled review instruction "${spec.instruction}" could not be rendered: ${error instanceof Error ? error.message : String(error)}`,
        'config',
        false,
      ),
    }
  }
}

function resultFailure(error: unknown, fallback: FailureClass): ReviewAttemptOutcome['result'] {
  const message = error instanceof Error ? error.message : String(error)
  const failure = classifyFailure(error, 'run')
  return {
    kind: 'failure',
    error: message,
    failureClass: failure.failureClass === 'unknown' ? fallback : failure.failureClass,
    transient: failure.transient,
    ...(failure.retryAfterMs === undefined ? {} : { retryAfterMs: failure.retryAfterMs }),
  }
}

async function executeAttempt(
  input: ReviewRunInput,
  record: ReviewRecordBase,
  prompt: string,
  priorIds: readonly string[] | undefined,
  controller: AbortController,
  stopped: Promise<never>,
): Promise<ReviewAttemptOutcome> {
  let child: SubagentRunResult
  try {
    child = await Promise.race([
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
  } catch (error) {
    // A timeout, a permission denial, and a capacity rejection classify
    // differently; the scheduler retries only the transient classes.
    return { record, result: resultFailure(error, 'provider-not-started') }
  }
  if (!child.completed) {
    // The provider reported a terminal stop: classify its diagnostic rather
    // than assuming every non-completion is a transient start failure.
    const diagnostic = child.error === undefined ? '' : `: ${child.error.slice(0, 200)}`
    const providerMessage =
      child.error === undefined
        ? 'the reviewer stopped without completing'
        : `the reviewer stopped without completing: ${child.error}`
    const failure = new ProviderResultError(
      `review target "${input.reviewer.id}" (provider "${input.reviewer.provider}") did not complete${diagnostic}; check the provider, then re-run the review`,
      providerMessage,
    )
    return { record, result: resultFailure(failure, 'unknown') }
  }
  if (child.text === undefined || child.text.trim() === '') {
    return {
      record,
      result: {
        kind: 'failure',
        error: 'the reviewer returned no text verdict; re-run the review',
        failureClass: 'invalid-output',
        transient: false,
      },
    }
  }
  const parsed = parseReviewVerdict(child.text, record.digest, priorIds)
  if (!parsed.ok) {
    return {
      record,
      result: {
        kind: 'failure',
        error: `${parsed.error}; re-run the review on the current digest`,
        failureClass: 'invalid-output',
        transient: false,
      },
    }
  }
  // A frozen snapshot is authoritative: a write during the run belongs to the
  // next round and makes the record stale, never discards this verdict. The
  // mutation guard applies only to the live-worktree fallback.
  if (input.prepared.liveGuard !== undefined && input.prepared.reviewCwd === undefined) {
    const changed = await input.prepared
      .liveGuard()
      .catch((error: unknown) =>
        error instanceof Error
          ? `the reviewed inputs could not be re-checked: ${error.message}`
          : 'the reviewed inputs could not be re-checked',
      )
    if (changed !== undefined) {
      const failure = new InputMutationError(
        `reviewed inputs changed during the run (${changed}); finish the writes and re-run the review`,
      )
      return { record, result: resultFailure(failure, 'reviewed-inputs-changed') }
    }
  }
  return {
    record,
    result: {
      kind: 'verdict',
      verdict: parsed.verdict,
      findings: parsed.findings,
      ...(parsed.previous === undefined ? {} : { previous: parsed.previous }),
    },
  }
}

/**
 * Prepare one review attempt and return only after the target actually started.
 * The result continues in the background; the queue's start hook awaits
 * `started`, so an activation failure is classified and retried before the
 * acceptance deadline is cleared. No record is written here.
 */
export async function beginReviewAttempt(input: ReviewRunInput): Promise<ReviewAttemptHandle> {
  const now = input.now ?? Date.now()
  const prepared = await prepareAttempt(input, now)
  if (prepared.kind === 'failed') {
    return { started: Promise.resolve(), result: Promise.resolve(prepared.outcome), now }
  }
  // The asynchronous preparation (prior record, focused diff) can outlive the
  // scheduler's disposal or a fence: a disposed run must not start a reviewer on
  // a checkout that was already released.
  if (input.cancelled?.() === true) {
    return {
      started: Promise.resolve(),
      result: Promise.resolve(
        failureOutcome(
          prepared.record,
          'the run was fenced or the review scheduler disposed while the review prepared; no reviewer started',
          'config',
          false,
        ),
      ),
      now,
    }
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
  const result = executeAttempt(
    input,
    prepared.record,
    prepared.prompt,
    prepared.priorIds,
    controller,
    stopped,
  )
    .finally(() => {
      if (timer !== undefined) clearTimeout(timer)
      input.signal?.removeEventListener('abort', forwardAbort)
    })
    .catch((error: unknown) => ({
      record: prepared.record,
      result: resultFailure(error, 'unknown'),
    }))
  const runner = input.runner
  const started = typeof runner.awaitStart === 'function' ? runner.awaitStart() : Promise.resolve()
  // The scheduler awaits this to classify a start failure; direct callers only
  // await the result, so an unobserved rejection must not be unhandled.
  started.catch(() => undefined)
  return { started, result, now }
}

/**
 * Whether a covered task's current portable PASS already satisfies the
 * publication checks; a matching record stays byte-identical.
 */
async function approvalSatisfies(
  workspace: string,
  record: ReviewRecord,
  taskId: string,
): Promise<boolean> {
  try {
    const raw = JSON.parse(
      await readFile(join(workspace, portableApprovalPath(record.change, taskId)), 'utf8'),
    ) as unknown
    if (!isRecord(raw)) return false
    const target = raw.target
    if (!isRecord(target)) return false
    // The portable schema: a matching approval stays byte-identical, but a
    // malformed one is replaced rather than preserved into the archive audit.
    const portableKeys = new Set([
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
    const targetKeys = new Set(['provider', 'model', 'reasoningEffort'])
    if (
      Object.keys(raw).some((key) => !portableKeys.has(key)) ||
      Object.keys(target).some((key) => !targetKeys.has(key)) ||
      typeof raw.rule !== 'string' ||
      typeof raw.change !== 'string' ||
      typeof raw.taskId !== 'string' ||
      typeof raw.digest !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(raw.digest) ||
      raw.scope !== 'task' ||
      typeof raw.time !== 'string' ||
      raw.time.trim() === '' ||
      typeof target.provider !== 'string' ||
      target.provider === '' ||
      (raw.worktreeDigest !== undefined &&
        (typeof raw.worktreeDigest !== 'string' || !/^[0-9a-f]{64}$/u.test(raw.worktreeDigest)))
    ) {
      return false
    }
    return (
      raw.rule === record.rule &&
      raw.change === record.change &&
      raw.taskId === taskId &&
      raw.verdict === 'PASS' &&
      Array.isArray(raw.findings) &&
      raw.findings.length === 0 &&
      target.provider === record.target.provider &&
      target.model === record.target.model &&
      target.reasoningEffort === record.target.reasoningEffort
    )
  } catch {
    return false
  }
}

/**
 * Publish one settled attempt: write the ERROR record or the verdict record
 * (and the committed approval first for a task PASS), then settle the step from
 * its own evidence. Only the scheduler's settled attempt reaches this.
 */
export async function publishReviewOutcome(
  input: ReviewRunInput,
  outcome: ReviewAttemptOutcome,
  now = input.now ?? Date.now(),
): Promise<ReviewRunResult> {
  // A successor published while this attempt ran: publish neither the portable
  // approval nor the local record.
  const superseded = await supersededOutcome(input, now)
  if (superseded !== undefined) return superseded
  if (input.cancelled?.() === true) {
    return {
      run: settleStep(input.run, input.step.id, 'failed', {
        at: now,
        reason:
          'the run settled completed-soft while this review published; the late verdict is discarded',
      }),
      discarded: true,
    }
  }
  const record = outcome.record
  const result = outcome.result
  if (record === undefined) {
    const error = result.kind === 'failure' ? result.error : 'the review produced no record'
    return {
      run: settleStep(input.run, input.step.id, 'failed', { at: now, reason: error }),
      error,
    }
  }
  if (result.kind === 'failure') {
    return writeErrorRecord(input, record, result.error, result.failureClass, now)
  }
  const published: ReviewRecord = {
    ...record,
    verdict: result.verdict,
    findings: result.findings,
    ...(result.previous === undefined ? {} : { previous: result.previous }),
  }
  if (published.scope === 'task' && published.verdict === 'PASS') {
    // The committed approval is written first; a failed publish publishes no PASS.
    const writePortable =
      input.writePortable ??
      ((workspace: string, record: ReviewRecord) =>
        writePortableApproval(workspace, record, input.cancelled))
    // A section PASS approves every covered checked task: one per-task commit
    // each, then the single section verdict record below.
    const approved =
      published.section === undefined ? [published.taskId] : (published.taskIds ?? [])
    if (approved.length === 0 || approved.some((taskId) => taskId === undefined)) {
      return await writeErrorRecord(
        input,
        record,
        'a PASS review has no covered task to approve',
        'unknown',
        now,
      )
    }
    for (const taskId of approved as string[]) {
      // An already valid approval for a covered task stays byte-identical.
      if (
        published.section !== undefined &&
        (await approvalSatisfies(input.context.workspace, published, taskId))
      ) {
        continue
      }
      const approval = await writePortable(input.context.workspace, { ...published, taskId })
      if (!approval.ok) {
        return await writeErrorRecord(
          input,
          record,
          `the committed approval at ${portableApprovalPath(published.change, taskId)} could not be written: ${approval.error}`,
          'unknown',
          now,
        )
      }
    }
  }
  const writeLocal =
    input.writeLocal ??
    ((workspace: string, record: ReviewRecord) =>
      writeLocalReviewRecord(workspace, record, input.cancelled))
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

/**
 * Run one review step synchronously: execute the attempt and publish it. The
 * queue wraps `beginReviewAttempt` and `publishReviewOutcome` instead, so a
 * retried attempt publishes nothing.
 */
export async function runReviewStep(input: ReviewRunInput): Promise<ReviewRunResult> {
  const attempt = await beginReviewAttempt(input)
  return publishReviewOutcome(input, await attempt.result, attempt.now)
}
