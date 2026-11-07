import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { type Dirent, existsSync, readFileSync, statSync } from 'node:fs'
import {
  cp,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'
import type {
  SubagentActivation,
  SubagentProvider,
  SubagentResult,
  SubagentRuntime,
} from '@deepseek-ai/dsh-subagent'
import type {
  JsonSchemaNode,
  PreToolDecision,
  ToolDefinition,
  ToolExecution,
} from '@deepseek-ai/dsh-tools'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'
import {
  APPROVAL_MARKER_FILE,
  type ApprovalCoverage,
  type ApprovalRecordState,
  approvalSummaryLine,
  CHANGE_PATTERN,
  computeApprovalCoverage,
  DIGEST_PATTERN,
  formatApprovalGapLines,
  isReviewFinding,
  laneOfTask,
  type NumberedTask,
  normalizeCheckboxes,
  normalizeFindingClass,
  normalizeTaskText,
  type PortableTaskReviewRecord,
  parsePortableTaskReviewRecord,
  parseReviewApprovalMarker,
  parseTaskLanes,
  parseTasksText,
  portableTaskRecordDisplayPath,
  portableTaskRecordPath,
  REVIEWS_DIRECTORY,
  type ReviewApprovalMarker,
  type ReviewerBinding,
  type ReviewFinding,
  recognizeArchiveCommands,
  reviewerBindingOf,
  reviewerMatches,
  type ShellToken,
  sanitizeText,
  shellSegments,
  TASK_ID_PATTERN,
  type TaskLane,
  unparseableCheckedLines,
} from '../shared/approval.js'
import {
  appendFindingHistory,
  DEFAULT_HISTORY_WINDOW,
  MAX_HISTORY_WINDOW,
} from './finding-history.js'
import type { UserQuestionsService } from './learning-tools.js'
import { executeReviewLesson, REVIEW_LESSON_DESCRIPTION } from './learning-tools.js'
import {
  changeCapabilities,
  DEFAULT_MAX_LESSONS,
  type Lesson,
  matchingLessons,
  readLessons,
} from './lesson-store.js'
import { executeReviewRetro, REVIEW_RETRO_DESCRIPTION } from './retro.js'
import {
  type Admission,
  classifyFailure,
  type FailureClass,
  QueueInternalError,
  type QueueTimeoutInfo,
  ReviewQueue,
} from './review-queue.js'

/**
 * Delegation-rules plugin: a model-agnostic engine where rules, targets,
 * instructions, result contracts, and gate policies are configuration. The
 * Host registers the `delegate`, `task_progress`, and `delegation_status`
 * tools, one on-demand skill, and the `agent/turn-stopping` gate. It has no
 * always-on prompt section and no runtime dependency on any other DSH or
 * `@dsh-setup` package.
 */

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-delegation-rules'

/** Services the registrations depend on; the learning surfaces attach when present. */
export const inject = ['tools', 'subagents', 'skills', 'workingDirectory']

/** Skill name advertised in the catalog and loaded on demand. */
const SKILL_NAME = 'delegation-rules'

/** Skill provider name unique inside the global skill layer. */
const PROVIDER_NAME = 'dsh-setup-delegation-rules'

/**
 * `BUNDLED_SKILL_RANK` from `@deepseek-ai/dsh-skill@0.2.1-rc.3`, hardcoded
 * because the plugin intentionally imports no DSH package at runtime.
 */
const BUNDLED_SKILL_RANK = 600

const assetsDirectory = fileURLToPath(new URL('../../assets/delegation-rules', import.meta.url))

/**
 * Catalog text; a test keeps it identical to the asset frontmatter. Kept short
 * because the tool descriptions plus this line share the model-facing budget.
 */
export const skillDescription =
  'Delegation rules: authored triggers, targets, result contracts, and the task-by-task review workflow. Load when authoring or debugging delegation rules, when a gate steers, when reviewing a completed task or spec, or when consulting, researching, or patching through a delegated model.'

/**
 * Tool descriptions are model-facing policy: they are the only delegation
 * guidance present without opening the skill. A budget test pins their size.
 */
export const toolDescriptions = {
  delegate:
    'Run one configured delegation rule through its target. Manual tasks: `research` answers a question with evidence and sources; `advisor` gives a manual second opinion from the strong target on one decision; pass the exact question, constraints, and decisive evidence, and use it only for expensive-to-reverse, cross-module, security/data-integrity, or repeated-failure decisions - never routine edits, syntax, lookups, or locally verifiable facts, and at most three times per session; `blocker` consults on a stuck plan when the failure-streak hint appears; `bug-fix` runs a write target in an isolated git worktree and returns the diff and test report (never auto-merged). Gate rules: `spec-review` reviews the whole active OpenSpec change before implementation; `task-review` reviews the next checked task without a PASS/ERROR record; `integration-review` is the optional whole-worktree check. The engine validates the rule, starts the configured DSH subagent provider, parses the contract result, and writes a digest-bound record under `.dsh/delegation`; a review PASS needs zero P0/P1 findings, FINDINGS/ERROR are reported but do not pass a strict gate, and a matching PASS is reused without another run. The `answer` contract writes no gate record. Only a matching record satisfies the turn-stopping gate: a text claim does not. A missing or incompatible target is reported with the target id, provider name, and next action.',
  task_progress:
    'Record an explicit in-progress or blocked note for one unchecked task, with the reason and the current worktree digest. Use it when a task spans turns instead of ticking `tasks.md`: it runs no model and costs nothing. The note lets a code-changing turn close only while the worktree still matches it; after any further change it is stale and a fresh note or the tick plus `delegate` task review is required. A checked task never accepts a note, and a note never counts as a task-review PASS.',
  delegation_status:
    "Report registered DSH subagent providers and capabilities, configured delegation targets and rules, each active change's involvement by this session (created, spec changed, checked tasks), per-change task/progress-note state, review record state (matching, stale, missing, malformed), and missing-target diagnostics with the next action. It never attributes a change. Use it when a `delegate` call reports a target problem or before configuring rules.",
} as const

/** JSON output contract shared by the three tools: one rendered text result. */
const TOOL_OUTPUT_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
}

/** Media type of a gate steering message; attributed to the gate, not the user. */
const GATE_SOURCE_KIND = 'delegation-rules'

const DELEGATION_DIR = '.dsh/delegation'
/** Disposable task-review checkouts and their scratch indexes. */
const SNAPSHOT_DIR = `${DELEGATION_DIR}/snapshots`
const SCRATCH_DIR = `${DELEGATION_DIR}/scratch`
const SNAPSHOT_LEASE_MS = 5 * 60_000
const SNAPSHOT_REFRESH_MS = 30_000
const SNAPSHOT_SWEEP_MS = 10 * 60_000
const SNAPSHOT_NO_LEASE_GRACE_MS = 10 * 60_000
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * Tool calls that start a parallel worker. The set is deliberately broad: the
 * deprecated lane-boundary rule measures that parallel work happened in the
 * turn, while lane-assignment reads the `lane-tag` in the start's arguments.
 */
const WORKER_TOOLS = new Set(['subagent', 'subagent_fork', 'spawn_teammate', 'workflow'])

const DEFAULT_TIMEOUTS: TimeoutConfig = { review: 1_200_000, answer: 300_000, patch: 1_800_000 }
const DEFAULT_FAILURE_STREAK = 3

/** Queue defaults stay well below the DSH active-child limit so workers keep room. */
export const DEFAULT_REVIEW_QUEUE: Readonly<ReviewQueueConfig> = {
  enabled: true,
  concurrency: 2,
  maxQueued: 16,
  maxAttempts: 3,
  baseDelayMs: 5_000,
  maxDelayMs: 60_000,
  waitTimeoutMs: 300_000,
}
const REVIEW_QUEUE_KEYS = new Set([
  'enabled',
  'concurrency',
  'maxQueued',
  'maxAttempts',
  'baseDelayMs',
  'maxDelayMs',
  'waitTimeoutMs',
])
const MAX_ANSWER_CHARS = 12_000
const MAX_ERROR_CHARS = 4_000
const MAX_REASON_CHARS = 2_000

export type Trigger =
  | 'manual'
  | 'spec-ready'
  | 'spec-task-ready'
  | 'implementation-work'
  | 'lane-assignment'
  | 'lane-boundary'
  | 'implementation-complete'
  | 'failure-streak'
export type Contract = 'review' | 'answer' | 'patch' | 'note'
export type Gate = 'strict' | 'soft' | 'none'
export type ReviewScope = 'whole' | 'task'
export type ProgressStatus = 'in-progress' | 'blocked'
export type Verdict = 'PASS' | 'FINDINGS' | 'ERROR'

/** One LLM route override accepted by a DSH in-process provider. */
export interface AgentOptionsConfig {
  provider?: string
  model?: string
  reasoningEffort?: string
  maxTokens?: number
}

/** One target: a registered `ctx.subagents` provider plus optional options. */
export interface TargetConfig {
  provider: string
  model?: string
  reasoningEffort?: string
  agentOptions?: AgentOptionsConfig
  /** Declares that this provider instance may write; required by `patch` rules. */
  write?: boolean
}

/** One configured rule; every field is data, never a provider name hard-coded in code. */
export interface RuleConfig {
  id: string
  when: Trigger
  to?: string
  instruction?: string
  contract: Contract
  gate: Gate
  phase?: string
  scope?: ReviewScope
  threshold?: number
  isolation?: 'worktree'
}

/** Per-contract target-run timeouts in milliseconds. */
export interface TimeoutConfig {
  review: number
  answer: number
  patch: number
}

/** Per-profile review queue limits and retry policy. */
export interface ReviewQueueConfig {
  /** Off restores the direct target start. */
  enabled: boolean
  /** Live review targets allowed at once; below the DSH active-child limit. */
  concurrency: number
  /** Unique waiting runs allowed before admission is refused. */
  maxQueued: number
  /** Original attempt plus retries. */
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
  waitTimeoutMs: number
}

/** Per-profile review-learning limits. */
export interface ReviewLearningConfig {
  /** Off: no retro/lesson tool, no command, and no lesson injection. */
  enabled: boolean
  /** Settled reviews read by the retro and kept in the finding history. */
  window: number
  /** Lesson store cap; the byte cap still applies. */
  maxLessons: number
}

/** The documented defaults; `window` and `maxLessons` also bound their stores. */
export const DEFAULT_REVIEW_LEARNING: Readonly<ReviewLearningConfig> = {
  enabled: true,
  window: DEFAULT_HISTORY_WINDOW,
  maxLessons: DEFAULT_MAX_LESSONS,
}

/** Row configuration accepted by {@link apply}. */
export interface BundleConfig {
  targets?: Record<string, TargetConfig>
  rules?: RuleConfig[]
  timeouts?: Partial<TimeoutConfig>
  failureStreak?: number
  reviewQueue?: Partial<ReviewQueueConfig>
  reviewLearning?: Partial<ReviewLearningConfig>
}

/** Test seams; production uses the filesystem, git, and the wall clock. */
export interface ApplyOptions {
  runGit?: GitRunner
  now?: () => Date
  /** Called once per review run after it settles; the run is no longer pending. */
  onRunSettled?: (runId: string, state: SettledRunState) => void
  /** Test seam: observes each published review record. */
  onPublished?: (runId: string, record: ReviewRecord) => void
  /** Test seam: throws before admission to simulate an internal queue failure. */
  queueFault?: () => void
  /** Test seam: delays the once-per-workspace recovery scan. */
  recoverDelay?: () => Promise<void>
}

/** Terminal review-run states reported to the settlement observer. */
export type SettledRunState = 'completed' | 'failed' | 'discarded'

/** One fixed-argument git invocation; output is raw bytes so diffs stay lossless. */
export type GitRunner = (
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  /** Extra environment, merged over `process.env`; used for `GIT_INDEX_FILE`. */
  env?: Record<string, string>,
  /** Bytes written to the child's stdin and closed; used for `--stdin` path lists. */
  stdin?: string | Buffer,
) => Promise<Buffer>

interface EngineConfig {
  targets: Map<string, TargetConfig>
  rules: RuleConfig[]
  timeouts: TimeoutConfig
  failureStreak: number
  reviewQueue: ReviewQueueConfig
  reviewLearning: ReviewLearningConfig
}

class DelegationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DelegationError'
  }
}

/** A rule/target/provider configuration problem; never transient. */
class ConfigError extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/** The provider rejected a start before any child existed; retryable. */
class ProviderStartError extends DelegationError {
  constructor(
    message: string,
    /** The provider's own text, separated from rule/target identifiers. */
    readonly providerMessage: string,
    /** A provider-supplied retry-after hint, preserved for the queue policy. */
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ProviderStartError'
  }
}

/** The review target did not finish inside its contract timeout. */
class TimeoutError extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

/** A timeout whose child could not be confirmed cancelled; quarantine it. */
class UnconfirmedTimeoutError extends TimeoutError {
  constructor(
    message: string,
    readonly activation: SubagentActivation,
  ) {
    super(message)
    this.name = 'UnconfirmedTimeoutError'
  }
}

/** The reviewed inputs were written during the run; terminal, never retried. */
class InputMutationError extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'InputMutationError'
  }
}

/** The provider returned an unsuccessful result; classify its diagnostic alone. */
class ProviderResultError extends DelegationError {
  constructor(
    message: string,
    readonly providerMessage: string,
  ) {
    super(message)
    this.name = 'ProviderResultError'
  }
}

function fail(message: string): never {
  throw new DelegationError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireNonEmpty(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${at} must be a non-empty string; add a value`)
  }
  return value
}

function unknownKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(record).filter((key) => !allowed.has(key))
}

const TRIGGERS = new Set<string>([
  'manual',
  'spec-ready',
  'spec-task-ready',
  'implementation-work',
  'lane-assignment',
  'lane-boundary',
  'implementation-complete',
  'failure-streak',
])
const CONTRACTS = new Set<string>(['review', 'answer', 'patch', 'note'])
const GATES = new Set<string>(['strict', 'soft', 'none'])
const RULE_KEYS = new Set([
  'id',
  'when',
  'to',
  'instruction',
  'contract',
  'gate',
  'phase',
  'scope',
  'threshold',
  'isolation',
])
const TARGET_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'agentOptions', 'write'])
const AGENT_OPTION_KEYS = new Set(['provider', 'model', 'reasoningEffort', 'maxTokens'])
const TIMEOUT_KEYS = new Set(['review', 'answer', 'patch'])
const REVIEW_LEARNING_KEYS = new Set(['enabled', 'window', 'maxLessons'])

/**
 * Validate one row configuration. Configuration mistakes fail the row with the
 * rule/target id and a next action; a missing provider is deliberately not a
 * validation error, so the profile composes without the target installed.
 */
export function validateConfig(raw: unknown): EngineConfig {
  if (raw === undefined || raw === null) raw = {}
  if (!isRecord(raw)) fail('configuration must be a mapping')

  const unknownTop = unknownKeys(
    raw,
    new Set(['targets', 'rules', 'timeouts', 'failureStreak', 'reviewQueue', 'reviewLearning']),
  )
  if (unknownTop.length > 0) {
    fail(
      `unknown configuration field(s) ${unknownTop.join(', ')}; use targets, rules, timeouts, failureStreak, reviewQueue, or reviewLearning`,
    )
  }

  const targetsRaw = raw.targets ?? {}
  if (!isRecord(targetsRaw)) fail('targets must be a mapping of target id to target')
  const targets = new Map<string, TargetConfig>()
  for (const [id, value] of Object.entries(targetsRaw)) {
    if (!ID_PATTERN.test(id)) {
      fail(`target "${id}" is not kebab-case; use lower-case letters, digits, and single dashes`)
    }
    if (!isRecord(value))
      fail(`target "${id}" must be a mapping; add a provider (and optional model)`)
    const unknown = unknownKeys(value, TARGET_KEYS)
    if (unknown.length > 0) fail(`target "${id}": unknown field(s) ${unknown.join(', ')}`)
    const provider = requireNonEmpty(
      value.provider,
      `target "${id}".provider (a registered ctx.subagents provider name)`,
    )
    const target: TargetConfig = { provider }
    if (value.model !== undefined)
      target.model = requireNonEmpty(value.model, `target "${id}".model`)
    if (value.reasoningEffort !== undefined) {
      target.reasoningEffort = requireNonEmpty(
        value.reasoningEffort,
        `target "${id}".reasoningEffort`,
      )
    }
    if (value.write !== undefined) {
      if (typeof value.write !== 'boolean') fail(`target "${id}".write must be true or false`)
      target.write = value.write
    }
    if (value.agentOptions !== undefined) {
      if (!isRecord(value.agentOptions)) fail(`target "${id}".agentOptions must be a mapping`)
      const options: AgentOptionsConfig = {}
      for (const [key, option] of Object.entries(value.agentOptions)) {
        if (!AGENT_OPTION_KEYS.has(key)) {
          fail(
            `target "${id}".agentOptions: unknown option "${key}"; use provider, model, reasoningEffort, or maxTokens`,
          )
        }
        if (key === 'maxTokens') {
          if (typeof option !== 'number' || !Number.isSafeInteger(option) || option <= 0) {
            fail(`target "${id}".agentOptions.maxTokens must be a positive integer`)
          }
          options.maxTokens = option
        } else {
          const text = requireNonEmpty(option, `target "${id}".agentOptions.${key}`)
          if (key === 'provider') options.provider = text
          else if (key === 'model') options.model = text
          else options.reasoningEffort = text
        }
      }
      target.agentOptions = options
    }
    targets.set(id, target)
  }

  const rulesRaw = raw.rules ?? []
  if (!Array.isArray(rulesRaw)) fail('rules must be a list')
  const rules: RuleConfig[] = []
  const seenRules = new Set<string>()
  rulesRaw.forEach((value: unknown, index: number) => {
    const rule = validateRule(value, index, targets)
    if (seenRules.has(rule.id)) {
      fail(`duplicate rule id "${rule.id}"; every rule id must be unique`)
    }
    seenRules.add(rule.id)
    rules.push(rule)
  })

  const strictScopes = new Map<string, string>()
  for (const rule of rules) {
    if (rule.contract !== 'review' || rule.gate !== 'strict') continue
    const key = `${rule.when}|${rule.scope ?? ''}|${rule.phase ?? ''}`
    const existing = strictScopes.get(key)
    if (existing !== undefined) {
      fail(
        `rules "${existing}" and "${rule.id}" both gate the same digest scope as strict; keep one strict rule per trigger/scope/phase or lower one gate`,
      )
    }
    strictScopes.set(key, rule.id)
  }

  const timeouts: TimeoutConfig = { ...DEFAULT_TIMEOUTS }
  const timeoutsRaw = raw.timeouts
  if (timeoutsRaw !== undefined) {
    if (!isRecord(timeoutsRaw)) fail('timeouts must be a mapping of contract to milliseconds')
    for (const key of unknownKeys(timeoutsRaw, TIMEOUT_KEYS)) {
      fail(`timeouts: unknown contract "${key}"; use review, answer, or patch`)
    }
    for (const key of ['review', 'answer', 'patch'] as const) {
      const value = timeoutsRaw[key]
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        fail(`timeouts.${key} must be a positive integer number of milliseconds`)
      }
      timeouts[key] = value
    }
  }

  let failureStreak = DEFAULT_FAILURE_STREAK
  if (raw.failureStreak !== undefined) {
    if (
      typeof raw.failureStreak !== 'number' ||
      !Number.isSafeInteger(raw.failureStreak) ||
      raw.failureStreak <= 0
    ) {
      fail(
        'failureStreak must be a positive integer; use it as the default failure-streak threshold',
      )
    }
    failureStreak = raw.failureStreak
  }

  const reviewQueue = validateReviewQueue(raw.reviewQueue)
  const reviewLearning = validateReviewLearning(raw.reviewLearning)

  return { targets, rules, timeouts, failureStreak, reviewQueue, reviewLearning }
}

/**
 * Validate the review-learning block. The defaults bound the lesson store and
 * the retro window; an invalid field fails plugin load with its range.
 */
export function validateReviewLearning(raw: unknown): ReviewLearningConfig {
  const learning: ReviewLearningConfig = { ...DEFAULT_REVIEW_LEARNING }
  if (raw === undefined) return learning
  if (!isRecord(raw)) fail('reviewLearning must be a mapping')
  const unknown = unknownKeys(raw, REVIEW_LEARNING_KEYS)
  if (unknown.length > 0) {
    fail(
      `reviewLearning: unknown field(s) ${unknown.join(', ')}; use enabled, window, or maxLessons`,
    )
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') fail('reviewLearning.enabled must be true or false')
    learning.enabled = raw.enabled
  }
  const window = raw.window
  if (window !== undefined) {
    if (
      typeof window !== 'number' ||
      !Number.isSafeInteger(window) ||
      window < 1 ||
      window > MAX_HISTORY_WINDOW
    ) {
      fail(
        `reviewLearning.window must be a whole number from 1 to ${MAX_HISTORY_WINDOW}; it bounds the retro window and the finding history`,
      )
    }
    learning.window = window
  }
  const maxLessons = raw.maxLessons
  if (maxLessons !== undefined) {
    if (
      typeof maxLessons !== 'number' ||
      !Number.isSafeInteger(maxLessons) ||
      maxLessons < 1 ||
      maxLessons > 1_000
    ) {
      fail('reviewLearning.maxLessons must be a whole number from 1 to 1000')
    }
    learning.maxLessons = maxLessons
  }
  return learning
}

/**
 * Validate the review queue block. An omitted block enables the documented
 * defaults; an invalid field fails plugin load with the field and its range.
 */
export function validateReviewQueue(raw: unknown): ReviewQueueConfig {
  const queue: ReviewQueueConfig = { ...DEFAULT_REVIEW_QUEUE }
  if (raw === undefined) return queue
  if (!isRecord(raw)) fail('reviewQueue must be a mapping')
  const unknown = unknownKeys(raw, REVIEW_QUEUE_KEYS)
  if (unknown.length > 0) {
    fail(
      `reviewQueue: unknown field(s) ${unknown.join(', ')}; use enabled, concurrency, maxQueued, maxAttempts, baseDelayMs, maxDelayMs, or waitTimeoutMs`,
    )
  }
  if (raw.enabled !== undefined) {
    if (typeof raw.enabled !== 'boolean') fail('reviewQueue.enabled must be true or false')
    queue.enabled = raw.enabled
  }
  type NumericField =
    | 'concurrency'
    | 'maxQueued'
    | 'maxAttempts'
    | 'baseDelayMs'
    | 'maxDelayMs'
    | 'waitTimeoutMs'
  const integer = (field: NumericField, minimum: number, maximum?: number): void => {
    const value = raw[field]
    if (value === undefined) return
    const range = maximum === undefined ? `at least ${minimum}` : `from ${minimum} to ${maximum}`
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < minimum ||
      (maximum !== undefined && value > maximum)
    ) {
      fail(
        `reviewQueue.${field} must be a whole number ${range}; use ${JSON.stringify(queue[field])}`,
      )
    }
    queue[field] = value
  }
  integer('concurrency', 1, 4)
  integer('maxQueued', 1)
  integer('maxAttempts', 1)
  integer('baseDelayMs', 1)
  integer('maxDelayMs', 1)
  integer('waitTimeoutMs', 1)
  return queue
}

function validateRule(raw: unknown, index: number, targets: Map<string, TargetConfig>): RuleConfig {
  const at = `rule #${index + 1}`
  if (!isRecord(raw)) fail(`${at} must be a mapping`)
  const unknown = unknownKeys(raw, RULE_KEYS)
  if (unknown.length > 0) fail(`${at}: unknown field(s) ${unknown.join(', ')}`)
  const id = requireNonEmpty(raw.id, `${at}.id`)
  if (!ID_PATTERN.test(id))
    fail(`rule "${id}" is not kebab-case; use lower-case letters, digits, and single dashes`)
  const where = `rule "${id}"`

  const when = raw.when
  if (typeof when !== 'string' || !TRIGGERS.has(when)) {
    fail(
      `${where}: unknown trigger ${JSON.stringify(when)}; use manual, spec-ready, spec-task-ready, implementation-work, lane-assignment, lane-boundary, implementation-complete, or failure-streak`,
    )
  }
  const contract = raw.contract
  if (typeof contract !== 'string' || !CONTRACTS.has(contract)) {
    fail(
      `${where}: unknown contract ${JSON.stringify(contract)}; use review, answer, patch, or note`,
    )
  }
  const gate = raw.gate
  if (typeof gate !== 'string' || !GATES.has(gate)) {
    fail(`${where}: unknown gate ${JSON.stringify(gate)}; use strict, soft, or none`)
  }
  const rule: RuleConfig = {
    id,
    when: when as Trigger,
    contract: contract as Contract,
    gate: gate as Gate,
  }

  if (when === 'spec-ready') {
    if (contract !== 'review' || raw.scope !== 'whole') {
      fail(`${where}: spec-ready drives a whole-spec review; set contract: review and scope: whole`)
    }
  } else if (when === 'spec-task-ready') {
    if (contract !== 'review' || raw.scope !== 'task') {
      fail(
        `${where}: spec-task-ready drives a task-scoped review; set contract: review and scope: task`,
      )
    }
  } else if (when === 'implementation-work') {
    if (contract !== 'note') {
      fail(
        `${where}: implementation-work is satisfied only by a task progress note; set contract: note`,
      )
    }
  } else if (when === 'lane-assignment') {
    if (contract !== 'note') {
      fail(
        `${where}: lane-assignment is satisfied only by a lane assignment or a task progress note; set contract: note`,
      )
    }
  } else if (when === 'lane-boundary') {
    if (contract !== 'note') {
      fail(`${where}: lane-boundary is satisfied only by a task progress note; set contract: note`)
    }
  } else if (when === 'implementation-complete') {
    if (contract !== 'review' || raw.scope !== 'whole') {
      fail(
        `${where}: implementation-complete drives a whole-worktree review; set contract: review and scope: whole`,
      )
    }
  } else if (when === 'failure-streak') {
    if (contract !== 'answer' && contract !== 'patch') {
      fail(`${where}: a failure streak needs a consultation; set contract: answer or patch`)
    }
    if (gate === 'strict') {
      fail(`${where}: a ${contract} rule writes no gate record; use gate: soft or none`)
    }
  } else if (contract === 'note') {
    fail(`${where}: manual rules cannot use the note contract; use task_progress directly`)
  }

  if (contract === 'note') {
    for (const forbidden of [
      'to',
      'instruction',
      'phase',
      'scope',
      'isolation',
      'threshold',
    ] as const) {
      if (raw[forbidden] !== undefined) fail(`${where}: a note rule takes no "${forbidden}"`)
    }
    if (
      raw.when !== 'implementation-work' &&
      raw.when !== 'lane-assignment' &&
      raw.when !== 'lane-boundary'
    ) {
      fail(
        `${where}: only the implementation-work, lane-assignment, and lane-boundary triggers use a note rule`,
      )
    }
  } else {
    const to = requireNonEmpty(raw.to, `${where}.to (a configured target id)`)
    if (!targets.has(to)) {
      fail(
        `${where}: target "${to}" is not configured; add targets.${to} or point the rule at a configured target`,
      )
    }
    rule.to = to
    if (contract === 'review' || contract === 'answer' || contract === 'patch') {
      const instruction = requireNonEmpty(
        raw.instruction,
        `${where}.instruction (bundled:<name> or inline text)`,
      )
      rule.instruction = instruction
      if (instruction.startsWith('bundled:')) {
        const asset = instruction.slice('bundled:'.length)
        if (!ID_PATTERN.test(asset)) {
          fail(
            `${where}: bundled instruction "${asset}" is not kebab-case; use bundled:review-spec-style names`,
          )
        }
        if (!existsSync(join(assetsDirectory, `${asset}.md`))) {
          fail(
            `${where}: bundled instruction "${asset}" does not exist; use one of the bundled assets`,
          )
        }
      }
    }
  }

  if (contract === 'review') {
    if (raw.scope !== 'whole' && raw.scope !== 'task') {
      fail(`${where}: a review rule needs scope: whole or scope: task`)
    }
    rule.scope = raw.scope
    if (raw.scope === 'whole') {
      const phase = requireNonEmpty(
        raw.phase,
        `${where}.phase (the record key for the whole-scope review)`,
      )
      if (!ID_PATTERN.test(phase)) {
        fail(`${where}: phase "${phase}" is not kebab-case; it names the record file`)
      }
      rule.phase = phase
    } else if (raw.phase !== undefined) {
      fail(`${where}: a task-scoped review has no phase; its record is keyed by the task id`)
    }
  } else if (raw.scope !== undefined || raw.phase !== undefined) {
    fail(`${where}: only a review rule takes phase/scope`)
  }

  if (contract === 'patch') {
    if (raw.isolation !== 'worktree') {
      fail(
        `${where}: a patch rule must declare isolation: worktree so the diff is never auto-applied`,
      )
    }
    rule.isolation = 'worktree'
    const target = targets.get(rule.to ?? '')
    if (target?.write !== true) {
      fail(
        `${where}: target "${rule.to}" is not declared write-capable; set targets.${rule.to}.write: true only when that provider may modify files`,
      )
    }
  } else if (raw.isolation !== undefined) {
    fail(`${where}: isolation belongs only to a patch rule`)
  }

  if (raw.threshold !== undefined) {
    if (when !== 'failure-streak') fail(`${where}: threshold belongs only to a failure-streak rule`)
    if (
      typeof raw.threshold !== 'number' ||
      !Number.isSafeInteger(raw.threshold) ||
      raw.threshold <= 0
    ) {
      fail(`${where}: threshold must be a positive integer`)
    }
    rule.threshold = raw.threshold
  }

  if (when === 'manual' && gate !== 'none') {
    fail(`${where}: a manual rule has no automatic condition; set gate: none`)
  }

  return rule
}

/** Fixed-argument git runner. The shell is never used, so no input is interpolated. */
export function defaultGit(
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
  env?: Record<string, string>,
  stdin?: string | Buffer,
): Promise<Buffer> {
  return new Promise<Buffer>((done, failed) => {
    const child = spawn('git', [...args], {
      cwd,
      signal,
      windowsHide: true,
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    })
    const chunks: Buffer[] = []
    let stderr = ''
    let stdinFailure: Error | undefined
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      failed(new DelegationError(`git ${args[0] ?? 'command'} failed: ${error.message}`))
    })
    child.on('close', (code) => {
      if (code === 0) {
        if (stdinFailure === undefined) {
          done(Buffer.concat(chunks))
          return
        }
        failed(
          new DelegationError(
            `git ${args[0] ?? 'command'} could not receive stdin: ${stdinFailure.message}`,
          ),
        )
        return
      }
      const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
      failed(
        new DelegationError(
          `git ${args[0] ?? 'command'} failed (exit ${code ?? 'unknown'})${detail ? `: ${detail}` : ''}`,
        ),
      )
    })
    // Close stdin so a command that reads it (update-index --stdin) gets EOF.
    // Keep any write failure: a zero exit must not hide undelivered input.
    child.stdin.on('error', (error: Error) => {
      stdinFailure = error
    })
    child.stdin.end(stdin)
  })
}

interface GitServices {
  runGit: GitRunner
}

type TaskInfo = NumberedTask

interface ChangeInfo {
  name: string
  dir: string
  reviewReady: boolean
}

interface Snapshot {
  digest?: string
  implementationFingerprint?: string
  digestError?: string
  changes: Array<{ name: string; tasks: TaskInfo[]; specDigest?: string; error?: string }>
}

interface ReviewRecord {
  rule: string
  change: string
  phase: string
  scope: ReviewScope
  taskId?: string
  digest: string
  worktreeDigest?: string
  verdict: Verdict
  findings: Finding[]
  target: { provider: string; model?: string; reasoningEffort?: string }
  /** Owning DSH session id; absent on records written before thread scoping. */
  session?: string
  /** Background review run that wrote this record; absent on older records. */
  runId?: string
  time: string
  error?: string
}

type RunState =
  | 'queued'
  | 'starting'
  | 'running'
  | 'retry-wait'
  | 'completed'
  | 'failed'
  | 'discarded'
  | 'interrupted'

/** Durable, model-facing state of one asynchronous review run. */
interface RunFile {
  id: string
  rule: string
  change: string
  taskId?: string
  key: string
  identity: string
  state: RunState
  /** Record path relative to the workspace root. */
  record: string
  startedAt: string
  detail?: string
  /** Bounded queue facts; absent for runs that bypassed the queue. */
  queuePosition?: number
  queuedAt?: string
  waitMs?: number
  attempts?: number
  failureClass?: FailureClass
  lastRetryAt?: string
}

interface ManagedRun {
  file: RunFile
  workspaceRoot: string
  recordPath: string
  existingFingerprint?: string
  /** Disposable checkout this run reviews; absent when it reviews the live worktree. */
  snapshot?: ReviewSnapshot
  /** Prepared digest and inputs; set before admission. */
  prepared?: ReviewPreparation
  /** Publication baseline captured once, immediately before the first start. */
  baselineCaptured?: boolean
  /** The run waited in the admission queue before its first start. */
  waitedInQueue?: boolean
  /** A queued run re-prepared exactly once when its source inputs moved. */
  reprepared?: boolean
  /** A direct start used after a queue-internal fault. */
  fallback?: boolean
  /** Bounded queue-fault evidence kept through the fallback run. */
  queueFaultDetail?: string
  /** Cached-record text returned instead of a target start. */
  reusedText?: string
  context: {
    rule: RuleConfig
    change: ChangeInfo
    task?: TaskInfo
    agent: Agent
    cwd: string
    args: DelegateArguments
    signal: AbortSignal
  }
}

interface ReviewPreparation {
  digest: string
  worktreeDigest?: string
  path: string
  /** Live inputs to guard; absent for a frozen snapshot review. */
  signature?: InputSignature
  /** Source-input signature a queued run re-checks before it starts. */
  queueSignature: string
  /** Working directory the reviewer runs in; defaults to the session worktree. */
  reviewCwd?: string
  /** Content tree the snapshot digest binds to; absent in live mode. */
  snapshotTree?: string
  /** Why the live fallback is used; absent for a snapshot review. */
  fallbackReason?: string
}

interface PublishFields {
  digest: string
  worktreeDigest?: string
  verdict: Verdict
  findings: Finding[]
  target: ReviewRecord['target']
  error?: string
}

interface PendingReviewView {
  id: string
  state: RunState
  record: string
}

type Finding = ReviewFinding

interface ProgressNote {
  taskId: string
  status: ProgressStatus
  reason: string
  worktreeDigest: string
  time: string
}

/** One session's attributed work in one active change. */
interface InvolvementEntry {
  created: boolean
  specChanged: boolean
  tasks: string[]
  completed: boolean
}

/** The inverse owner map: one file per session lists the changes it created or modified. */
interface SessionInvolvement {
  session: string
  changes: Record<string, InvolvementEntry>
}

/** One turn's session-attributable write evidence for one change. */
interface ChangeEvidence {
  creation: boolean
  outsideTasks: boolean
  /** Canonical `tasks.md` before/after contents from a first-party write result. */
  taskWrites: Array<{ before: string | null; after: string }>
  /** A `tasks.md` write whose result exposed no canonical contents. */
  opaqueTaskWrite: boolean
}

type RecordState =
  | { kind: 'missing' }
  | { kind: 'malformed'; error: string }
  | { kind: 'record'; record: ReviewRecord }

function hashParts(parts: Array<string | Buffer>): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part)
    hash.update('\0')
  }
  return hash.digest('hex')
}

/** Stable hash of the source input set a queued review re-checks before start. */
function signatureHash(signature: InputSignature): string {
  const entries = [...signature.entries].sort(([left], [right]) => left.localeCompare(right))
  return hashParts([
    'queue-signature-v1',
    ...entries.map(([path, value]) => `${path}\u0000${value}`),
  ])
}

async function readTasks(changeDir: string): Promise<TaskInfo[]> {
  return parseTasksText(await readFile(join(changeDir, 'tasks.md'), 'utf8'))
}

async function statSafe(path: string): Promise<'file' | 'directory' | undefined> {
  try {
    const info = await stat(path)
    if (info.isFile()) return 'file'
    if (info.isDirectory()) return 'directory'
    return undefined
  } catch {
    return undefined
  }
}

async function listDirectory(path: string): Promise<string[]> {
  try {
    return (await readdir(path, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** Nearest ancestor that contains `openspec/changes`, from a possibly nested cwd. */
async function findOpenSpecRoot(cwd: string): Promise<string | undefined> {
  let current = resolve(cwd)
  for (;;) {
    if ((await statSafe(join(current, 'openspec', 'changes'))) === 'directory') {
      return join(current, 'openspec')
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

/** Synchronous workspace-root lookup for event-time write evidence. */
function findOpenSpecRootSync(cwd: string): string | undefined {
  let current = resolve(cwd)
  for (;;) {
    try {
      if (statSync(join(current, 'openspec', 'changes')).isDirectory()) {
        return join(current, 'openspec')
      }
    } catch {
      // Keep walking up.
    }
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function readChange(
  openspecRoot: string,
  changeName: string,
): Promise<ChangeInfo | undefined> {
  if (!CHANGE_PATTERN.test(changeName)) return undefined
  const dir = join(openspecRoot, 'changes', changeName)
  if ((await statSafe(dir)) !== 'directory') return undefined
  const reviewReady = await isReviewReady(dir)
  return { name: changeName, dir, reviewReady }
}

async function isReviewReady(dir: string): Promise<boolean> {
  for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
    if ((await statSafe(join(dir, file))) !== 'file') return false
  }
  const specs = await listDirectory(join(dir, 'specs'))
  if (specs.length === 0) return false
  for (const spec of specs) {
    if ((await statSafe(join(dir, 'specs', spec, 'spec.md'))) === 'file') return true
  }
  return false
}

/** Active changes only: `archive/` and non-change directories are ignored. */
async function listActiveChanges(openspecRoot: string): Promise<ChangeInfo[]> {
  const names = await listDirectory(join(openspecRoot, 'changes'))
  const changes: ChangeInfo[] = []
  for (const name of names.sort()) {
    if (name === 'archive' || !CHANGE_PATTERN.test(name)) continue
    const change = await readChange(openspecRoot, name)
    if (change !== undefined) changes.push(change)
  }
  return changes
}

/** Resolve the requested change, or the only active one, with an actionable error. */
async function openChange(
  cwd: string,
  requested?: string,
): Promise<{ change: ChangeInfo; openspecRoot: string }> {
  const openspecRoot = await findOpenSpecRoot(cwd)
  if (openspecRoot === undefined) {
    fail(
      'no openspec/changes directory was found from the session working directory; run the rule from an OpenSpec repository root',
    )
  }
  if (requested !== undefined) {
    if (!CHANGE_PATTERN.test(requested)) {
      fail(
        `change "${requested}" is not a plain change name; pass the directory name under openspec/changes`,
      )
    }
    const change = await readChange(openspecRoot, requested)
    if (change === undefined) {
      const names = (await listActiveChanges(openspecRoot)).map((entry) => entry.name)
      fail(
        `change "${requested}" was not found under openspec/changes; active changes: ${names.join(', ') || '(none)'}`,
      )
    }
    return { change, openspecRoot }
  }
  const changes = await listActiveChanges(openspecRoot)
  if (changes.length === 0)
    fail(
      'no active OpenSpec change was found under openspec/changes; create or resume a change first',
    )
  if (changes.length > 1) {
    fail(
      `multiple active OpenSpec changes (${changes.map((entry) => entry.name).join(', ')}); pass change: to choose one`,
    )
  }
  return { change: changes[0] as ChangeInfo, openspecRoot }
}

/** Hash every change artifact, normalizing `tasks.md` checkbox state. */
export async function specDigest(changeDir: string, signal?: AbortSignal): Promise<string> {
  const files: string[] = []
  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (signal?.aborted === true) fail('spec digest was cancelled')
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        // The portable approval directory is not a change artifact.
        if (relative(changeDir, path).split(sep).join('/') === REVIEWS_DIRECTORY) continue
        await walk(path)
      } else if (entry.isFile()) files.push(path)
    }
  }
  try {
    await walk(changeDir)
  } catch (error) {
    fail(`could not read the change directory for the spec digest: ${errorMessage(error)}`)
  }
  files.sort()
  const parts: string[] = ['change-artifacts-v1']
  for (const file of files) {
    const name = relative(changeDir, file).split(sep).join('/')
    if (name === '.openspec.yaml') continue
    let content = await readFile(file, 'utf8')
    if (name === 'tasks.md') content = content.replace(/^(\s*-\s*)\[[xX]\]/gm, '$1[ ]')
    parts.push(name, content)
  }
  return hashParts(parts)
}

/** Path entries and diff bytes, ignoring delegation state and scratch files. */
function ignoredForDigest(path: string): boolean {
  return path === '.dsh' || path.startsWith('.dsh/') || path === '.tmp' || path.startsWith('.tmp/')
}

/** Files that count as implementation work rather than documentation/plan state. */
function isImplementationPath(path: string): boolean {
  if (ignoredForDigest(path)) return false
  if (path === 'docs' || path.startsWith('docs/')) return false
  if (path === 'openspec' || path.startsWith('openspec/')) return false
  if (path === 'market' || path.startsWith('market/')) return false
  return !/\.(?:md|mdx)$/i.test(path)
}

interface StatusEntry {
  code: string
  path: string
}

function parseStatus(raw: Buffer): StatusEntry[] {
  const entries: StatusEntry[] = []
  const tokens = raw.toString('utf8').split('\0')
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string
    if (token.length < 4) continue
    const code = token.slice(0, 2)
    const path = token.slice(3)
    entries.push({ code, path })
    if (code.startsWith('R') || code.startsWith('C')) index += 1
  }
  return entries
}

async function repositoryRoot(
  cwd: string,
  services: GitServices,
  signal?: AbortSignal,
): Promise<string> {
  try {
    const raw = (await services.runGit(['rev-parse', '--show-toplevel'], cwd, signal))
      .toString('utf8')
      .trim()
    return raw === '' ? cwd : resolve(raw)
  } catch {
    return cwd
  }
}

async function worktreeDigest(
  cwd: string,
  services: GitServices,
  signal?: AbortSignal,
): Promise<string> {
  const root = await repositoryRoot(cwd, services, signal)
  const status = await services.runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    cwd,
    signal,
  )
  const entries = parseStatus(status)
  const visible = entries.filter((entry) => !ignoredForDigest(entry.path))
  const parts: Array<string | Buffer> = ['worktree-v1']
  for (const entry of visible.sort((left, right) => left.path.localeCompare(right.path))) {
    parts.push(`${entry.code} ${entry.path}`)
    if (entry.code === '??') {
      try {
        parts.push(await readFile(resolve(root, entry.path)))
      } catch {
        parts.push('[unreadable]')
      }
    }
  }
  parts.push(await services.runGit(['diff', '--binary', 'HEAD'], cwd, signal))
  return hashParts(parts)
}

/** One immutable review checkout; the digest binds to `tree`. */
export interface ReviewSnapshot {
  /** Content tree the task digest binds to. */
  tree: string
  /** Snapshot commit checked out in the disposable worktree. */
  commit: string
  /** Disposable worktree the reviewer runs in. */
  worktree: string
  /** Frozen change directory inside the worktree. */
  changeDir: string
  /** Change-artifact digest computed from the frozen copy. */
  specDigest: string
}

/**
 * Build the disposable task-review snapshot from the exact review input set.
 * Returns undefined when it cannot be built safely; the caller reviews the live
 * worktree with the mutation guard instead and gets the cause through `onUnavailable`.
 */
export async function createReviewSnapshot(
  cwd: string,
  change: ChangeInfo,
  runId: string,
  runGit: GitRunner,
  signal: AbortSignal,
  /** Test seam: runs after the change directory is frozen, before its digest. */
  afterCopy?: () => Promise<void> | void,
  /** Called once with a bounded cause when no snapshot is produced. */
  onUnavailable?: (reason: string) => void,
): Promise<ReviewSnapshot | undefined> {
  await sweepReviewSnapshots(cwd, runGit)
  const services: GitServices = { runGit }
  const root = await repositoryRoot(cwd, services, signal)
  // Compare canonical paths: a Windows short (8.3) name or a linked checkout can
  // make the path Git reports for the root differ from the session's form. The
  // same check rejects a linked change directory that resolves outside the repo.
  let relChange: string
  try {
    relChange = relative(await realpath(root), await realpath(change.dir))
      .split(sep)
      .join('/')
  } catch {
    onUnavailable?.('the repository or change directory path could not be resolved')
    return undefined
  }
  if (
    relChange === '' ||
    relChange === '.' ||
    relChange === '..' ||
    relChange.startsWith('../') ||
    isAbsolute(relChange)
  ) {
    onUnavailable?.('the change directory is outside the repository')
    return undefined
  }
  try {
    // A tracked or unignored .dsh would put the checkout inside the reviewed tree.
    // The directory must exist for a directory-only ignore rule to match.
    await mkdir(resolve(cwd, SCRATCH_DIR), { recursive: true })
    await runGit(['check-ignore', '-q', '--no-index', '.dsh'], cwd, signal)
  } catch {
    onUnavailable?.(
      'the .dsh scratch directory is not Git-ignored; add .dsh/ to .gitignore or .git/info/exclude',
    )
    return undefined
  }
  try {
    if ((await runGit(['ls-files', '-u'], root, signal)).toString('utf8').trim() !== '') {
      onUnavailable?.('the repository index has unmerged entries')
      return undefined
    }
  } catch {
    onUnavailable?.('the repository index could not be read for unmerged entries')
    return undefined
  }

  const worktree = resolve(cwd, SNAPSHOT_DIR, runId)
  const scratch = resolve(cwd, SCRATCH_DIR, `${runId}.index`)
  const env = { GIT_INDEX_FILE: scratch }
  try {
    const listed = (
      await runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root, signal)
    ).toString('utf8')
    const paths: string[] = []
    for (const path of listed.split('\0')) {
      if (path === '' || ignoredForDigest(path)) continue
      if (path === relChange || path.startsWith(`${relChange}/`)) continue
      try {
        await lstat(resolve(root, path))
      } catch {
        // A tracked path deleted from the worktree is what a live review sees.
        continue
      }
      paths.push(path)
    }
    await mkdir(dirname(scratch), { recursive: true })
    await mkdir(dirname(worktree), { recursive: true })
    if (paths.length > 0) {
      await runGit(
        ['update-index', '--add', '-z', '--stdin'],
        root,
        signal,
        env,
        `${paths.join('\0')}\0`,
      )
    }
    const tree = (await runGit(['write-tree'], root, signal, env)).toString('utf8').trim()
    let parent: string | undefined
    try {
      parent = (await runGit(['rev-parse', '--verify', 'HEAD'], root, signal))
        .toString('utf8')
        .trim()
    } catch {
      parent = undefined
    }
    const commit = (
      await runGit(
        [
          '-c',
          'user.name=dsh-delegation',
          '-c',
          'user.email=delegation@localhost',
          'commit-tree',
          tree,
          ...(parent === undefined ? [] : ['-p', parent]),
          '-m',
          'delegation: reviewed snapshot',
        ],
        root,
        signal,
      )
    )
      .toString('utf8')
      .trim()
    // The lease is written before the checkout exists, so a crash cannot leave
    // an unowned worktree; the sweep preserves a valid lease without a directory.
    await startSnapshotLease(cwd, runId)
    await runGit(['worktree', 'add', '--detach', worktree, commit], root, signal)
    const frozenChange = resolve(worktree, relChange)
    await mkdir(dirname(frozenChange), { recursive: true })
    await cp(change.dir, frozenChange, { recursive: true, force: true, dereference: true })
    if (afterCopy !== undefined) await afterCopy()
    const frozenSpec = await specDigest(frozenChange, signal)
    return { tree, commit, worktree, changeDir: frozenChange, specDigest: frozenSpec }
  } catch {
    await discardReviewSnapshot(cwd, runId, runGit)
    onUnavailable?.('the snapshot worktree could not be built (git error during snapshot creation)')
    return undefined
  }
}

/** Live snapshot leases, keyed by workspace snapshot directory and run id. */
interface SnapshotLease {
  stopped: boolean
  /** Pending and future renewal writes, chained so a stop can await them. */
  writes: Promise<void>
  timer?: NodeJS.Timeout
}
const snapshotLeases = new Map<string, SnapshotLease>()
/** Last per-workspace sweep time, for the throttle. */
const snapshotSweeps = new Map<string, number>()

function snapshotKey(cwd: string, runId: string): string {
  return `${resolve(cwd, SNAPSHOT_DIR)}\u0000${runId}`
}

function snapshotLeasePath(cwd: string, runId: string): string {
  return `${resolve(cwd, SNAPSHOT_DIR, runId)}.lease`
}

async function readSnapshotLease(path: string): Promise<number | undefined> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { expiresAt?: unknown }
    return typeof value.expiresAt === 'number' ? value.expiresAt : undefined
  } catch {
    return undefined
  }
}

async function writeSnapshotLease(cwd: string, runId: string): Promise<void> {
  await writeJsonAtomic(snapshotLeasePath(cwd, runId), {
    runId,
    expiresAt: Date.now() + SNAPSHOT_LEASE_MS,
  })
}

/**
 * Write the initial lease and start renewing it. The initial write is awaited,
 * so a lease exists before the worktree it protects is created.
 */
export async function startSnapshotLease(
  cwd: string,
  runId: string,
  refreshMs = SNAPSHOT_REFRESH_MS,
): Promise<void> {
  const state: SnapshotLease = { stopped: false, writes: writeSnapshotLease(cwd, runId) }
  const timer = setInterval(() => {
    if (state.stopped) return
    state.writes = state.writes.then(() => writeSnapshotLease(cwd, runId)).catch(() => undefined)
  }, refreshMs)
  timer.unref()
  state.timer = timer
  snapshotLeases.set(snapshotKey(cwd, runId), state)
  await state.writes
}

/** Stop renewal and await any in-flight write, so none lands after cleanup. */
export async function stopSnapshotLease(cwd: string, runId: string): Promise<void> {
  const key = snapshotKey(cwd, runId)
  const state = snapshotLeases.get(key)
  if (state === undefined) return
  state.stopped = true
  if (state.timer !== undefined) clearInterval(state.timer)
  snapshotLeases.delete(key)
  await state.writes.catch(() => undefined)
}

/**
 * Remove snapshots no live run owns. Ownership is the lease, never age or the
 * configured review timeout; a lease-less directory is given a grace period.
 * Orphaned leases before creation, scratch indexes, and stale worktree metadata
 * are also retried here. Runs at most once per throttle window and never throws.
 */
export async function sweepReviewSnapshots(
  cwd: string,
  runGit: GitRunner,
  now = Date.now(),
): Promise<void> {
  const dir = resolve(cwd, SNAPSHOT_DIR)
  if (now - (snapshotSweeps.get(dir) ?? 0) < SNAPSHOT_SWEEP_MS) return
  snapshotSweeps.set(dir, now)
  let entries: Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    entries = []
  }
  for (const entry of entries) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      const runId = entry.name
      const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId))
      if (expiresAt !== undefined && expiresAt > now) continue
      if (expiresAt === undefined) {
        try {
          if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS) continue
        } catch {
          continue
        }
      }
      await discardReviewSnapshot(cwd, runId, runGit)
      continue
    }
    if (entry.name.endsWith('.tmp') && entry.name.includes('.lease.')) {
      // An abandoned atomic-write temporary of a lease.
      const runId = entry.name.slice(0, entry.name.indexOf('.lease.'))
      const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId))
      if (expiresAt !== undefined && expiresAt > now) continue
      const path = resolve(dir, entry.name)
      try {
        if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS) continue
      } catch {
        continue
      }
      try {
        await unlink(path)
      } catch {
        // Missing is fine.
      }
      continue
    }
    if (entry.name.endsWith('.lease')) {
      const runId = entry.name.slice(0, -'.lease'.length)
      if (existsSync(resolve(dir, runId))) continue
      // A valid lease without a directory is a run between lease and creation.
      const expiresAt = await readSnapshotLease(path)
      if (expiresAt !== undefined && expiresAt > now) continue
      try {
        await unlink(path)
      } catch {
        // Missing is fine.
      }
    }
  }
  // A failed settlement removal can leave only the scratch index behind.
  let scratchEntries: Dirent[] = []
  try {
    scratchEntries = await readdir(resolve(cwd, SCRATCH_DIR), { withFileTypes: true })
  } catch {
    scratchEntries = []
  }
  for (const entry of scratchEntries) {
    if (!entry.isFile() || !entry.name.endsWith('.index')) continue
    const runId = entry.name.slice(0, -'.index'.length)
    const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId))
    if (expiresAt !== undefined && expiresAt > now) continue
    const path = resolve(cwd, SCRATCH_DIR, entry.name)
    try {
      if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS) continue
    } catch {
      continue
    }
    try {
      await unlink(path)
    } catch {
      // Retried by a later sweep.
    }
  }
  // Prune whenever the throttle allows, even when nothing was removed: a failed
  // prune must not wait for another directory removal to be retried.
  try {
    await runGit(['worktree', 'prune'], cwd)
  } catch {
    // Pruning is best effort.
  }
}

/** Remove one snapshot checkout, its lease, and its scratch index; best effort. */
export async function discardReviewSnapshot(
  cwd: string,
  runId: string,
  runGit: GitRunner,
  /** Test seam: the filesystem remover, so a failed removal can be injected. */
  remove: (path: string) => Promise<void> = (path) => rm(path, { recursive: true, force: true }),
): Promise<void> {
  await stopSnapshotLease(cwd, runId)
  const worktree = resolve(cwd, SNAPSHOT_DIR, runId)
  try {
    await runGit(['worktree', 'remove', '--force', worktree], cwd)
  } catch {
    // Not a registered worktree, already gone, or not a Git checkout.
  }
  for (const path of [worktree, resolve(cwd, SCRATCH_DIR, `${runId}.index`), `${worktree}.lease`]) {
    try {
      await remove(path)
    } catch {
      // Scratch leftovers are retried by the sweep.
    }
  }
}

async function implementationFingerprint(
  cwd: string,
  services: GitServices,
  signal?: AbortSignal,
): Promise<string> {
  const root = await repositoryRoot(cwd, services, signal)
  const status = await services.runGit(
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    cwd,
    signal,
  )
  const entries = parseStatus(status).filter((entry) => isImplementationPath(entry.path))
  const parts: Array<string | Buffer> = ['implementation-v1']
  for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
    parts.push(`${entry.code} ${entry.path}`)
    try {
      parts.push(await readFile(resolve(root, entry.path)))
    } catch {
      parts.push('[deleted]')
    }
  }
  return hashParts(parts)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function captureSnapshot(
  cwd: string,
  changes: ChangeInfo[],
  services: GitServices,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const snapshot: Snapshot = { changes: [] }
  try {
    snapshot.digest = await worktreeDigest(cwd, services, signal)
  } catch (error) {
    snapshot.digestError = errorMessage(error)
  }
  try {
    snapshot.implementationFingerprint = await implementationFingerprint(cwd, services, signal)
  } catch {
    snapshot.implementationFingerprint = undefined
  }
  for (const change of changes) {
    const entry: Snapshot['changes'][number] = { name: change.name, tasks: [] }
    // The artifact digest is independent of task parsing: a change whose
    // tasks.md is missing still has a digest, so a later write is detectable.
    try {
      entry.specDigest = await specDigest(change.dir, signal)
    } catch (error) {
      entry.error = `change artifacts are unreadable (${errorMessage(error)})`
    }
    try {
      entry.tasks = await readTasks(change.dir)
    } catch (error) {
      // A change artifact problem stays per-change; it is not a worktree git failure.
      entry.error = `tasks.md is missing or unreadable (${errorMessage(error)})`
    }
    snapshot.changes.push(entry)
  }
  return snapshot
}

/** One-line, redacted, bounded text for a public error message. */
function boundedMessage(error: unknown, maximum = MAX_ERROR_CHARS): string {
  return sanitizeText(errorMessage(error), maximum).replace(/\s+/g, ' ').trim()
}

function relativePath(cwd: string, path: string): string {
  return relative(cwd, path).split(sep).join('/')
}

function recordPath(cwd: string, rule: RuleConfig, change: string, taskId?: string): string {
  if (rule.scope === 'task') {
    if (taskId === undefined || !TASK_ID_PATTERN.test(taskId)) {
      fail(`rule "${rule.id}": a task-scoped record needs a stable task id`)
    }
    return join(cwd, DELEGATION_DIR, rule.id, change, 'tasks', `${taskId}.json`)
  }
  if (rule.phase === undefined) fail(`rule "${rule.id}": a whole-scope record needs a phase`)
  return join(cwd, DELEGATION_DIR, rule.id, change, `${rule.phase}.json`)
}

function notePath(cwd: string, change: string): string {
  return join(cwd, DELEGATION_DIR, 'task-progress', `${change}.json`)
}

function currentThread(agent: Agent): string {
  return String(agent.session.id)
}

function sessionsDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, DELEGATION_DIR, 'sessions')
}

function involvementFile(workspaceRoot: string, session: string): string {
  // Hashed file name: no path characters and no Windows device-name collisions.
  const name = createHash('sha256').update(session).digest('hex').slice(0, 16)
  return join(sessionsDirectory(workspaceRoot), `${name}.json`)
}

function emptyInvolvement(session: string): SessionInvolvement {
  return { session, changes: Object.create(null) as Record<string, InvolvementEntry> }
}

function freshEntry(): InvolvementEntry {
  return { created: false, specChanged: false, tasks: [], completed: false }
}

function parseInvolvement(value: unknown, session: string): SessionInvolvement | undefined {
  if (!isRecord(value) || value.session !== session || !isRecord(value.changes)) return undefined
  const involvement = emptyInvolvement(session)
  for (const [name, raw] of Object.entries(value.changes)) {
    if (!CHANGE_PATTERN.test(name) || !isRecord(raw)) return undefined
    if (
      typeof raw.created !== 'boolean' ||
      typeof raw.specChanged !== 'boolean' ||
      typeof raw.completed !== 'boolean' ||
      !Array.isArray(raw.tasks) ||
      !raw.tasks.every((task) => typeof task === 'string' && TASK_ID_PATTERN.test(task))
    ) {
      return undefined
    }
    involvement.changes[name] = {
      created: raw.created,
      specChanged: raw.specChanged,
      tasks: [...(raw.tasks as string[])],
      completed: raw.completed,
    }
  }
  return involvement
}

interface InvolvementRead {
  involvement: SessionInvolvement
  warning?: string
}

/** Missing state is empty; malformed state is empty plus a status warning, never a failure. */
async function readInvolvement(workspaceRoot: string, session: string): Promise<InvolvementRead> {
  const file = involvementFile(workspaceRoot, session)
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { involvement: emptyInvolvement(session) }
    }
    return {
      involvement: emptyInvolvement(session),
      warning: `session involvement at ${relativePath(workspaceRoot, file)} is unreadable (${errorMessage(error)}); treating it as empty`,
    }
  }
  try {
    const parsed = parseInvolvement(JSON.parse(raw), session)
    if (parsed !== undefined) return { involvement: parsed }
  } catch {
    // Fall through to the malformed warning.
  }
  return {
    involvement: emptyInvolvement(session),
    warning: `session involvement at ${relativePath(workspaceRoot, file)} is malformed; treating it as empty (delete it to reset)`,
  }
}

async function writeInvolvement(
  workspaceRoot: string,
  involvement: SessionInvolvement,
): Promise<void> {
  await writeJsonAtomic(involvementFile(workspaceRoot, involvement.session), involvement)
}

/** Serialize one session's read-modify-write involvement updates in this process. */
const involvementWrites = new Map<string, Promise<void>>()

async function withInvolvementLock<T>(
  workspaceRoot: string,
  session: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = `${workspaceRoot}\u0000${session}`
  const previous = involvementWrites.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.then(() => current)
  involvementWrites.set(key, queued)
  await previous
  try {
    return await task()
  } finally {
    release()
    if (involvementWrites.get(key) === queued) involvementWrites.delete(key)
  }
}

function involvementEntry(involvement: SessionInvolvement, change: string): InvolvementEntry {
  let entry = involvement.changes[change]
  if (entry === undefined) {
    entry = freshEntry()
    involvement.changes[change] = entry
  }
  return entry
}

function involvementSummary(entry: InvolvementEntry, checkedTasks: number): string {
  const parts: string[] = []
  if (entry.created) parts.push('created')
  if (entry.specChanged) parts.push('spec changed')
  parts.push(`${checkedTasks} checked task(s)`)
  return parts.join(' / ')
}

function freshEvidence(): ChangeEvidence {
  return { creation: false, outsideTasks: false, taskWrites: [], opaqueTaskWrite: false }
}

/** Resolve `openspec/changes/<change>/<file>` from an absolute or relative path. */
function changeFromEvidencePath(path: string): { change: string; file: string } | undefined {
  const normalized = path.replaceAll('\\', '/')
  const marker = 'openspec/changes/'
  const index = normalized.lastIndexOf(marker)
  if (index < 0) return undefined
  if (index > 0 && normalized[index - 1] !== '/') return undefined
  const rest = normalized.slice(index + marker.length)
  const slash = rest.indexOf('/')
  if (slash <= 0 || slash === rest.length - 1) return undefined
  const change = rest.slice(0, slash)
  if (!CHANGE_PATTERN.test(change) || change === 'archive') return undefined
  return { change, file: rest.slice(slash + 1) }
}

/** Resolve a write path only when it lands inside this workspace's active change. */
function evidenceTarget(
  workspaceCwd: string,
  executionCwd: string,
  rawPath: string,
): { change: string; file: string } | undefined {
  const path = rawPath.trim()
  if (path === '') return undefined
  const target = changeFromEvidencePath(path)
  if (target === undefined) return undefined
  const openspecRoot = findOpenSpecRootSync(workspaceCwd)
  if (openspecRoot === undefined) return undefined
  const activeDir = resolve(openspecRoot, 'changes', target.change)
  try {
    if (!statSync(activeDir).isDirectory()) return undefined
  } catch {
    return undefined
  }
  const absolute = resolve(executionCwd, path)
  const rel = relative(activeDir, absolute)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return undefined
  return target
}

const CONTROL_COMMANDS = new Set([
  'if',
  'else',
  'elseif',
  'for',
  'foreach',
  'while',
  'do',
  'switch',
  'try',
  'catch',
  'finally',
  'function',
  'filter',
  'begin',
  'process',
  'end',
  'return',
  'throw',
  'exit',
  'param',
  'using',
  'class',
  'enum',
  'trap',
])
const SIMPLE_REJECT = new Set(['{', '}', '(', ')'])
const WRITE_VERBS = new Set([
  'set-content',
  'add-content',
  'out-file',
  'copy-item',
  'move-item',
  'new-item',
  'rename-item',
  'remove-item',
  'cp',
  'mv',
  'rm',
  'touch',
  'tee',
])
const VALUE_OPTIONS = new Set([
  '-value',
  '-encoding',
  '-itemtype',
  '-type',
  '-name',
  '-newname',
  '-path',
  '-literalpath',
  '-filepath',
  '-destination',
  '-filter',
  '-include',
  '-exclude',
  '-erroraction',
])

/**
 * One explicit simple command form, or undefined for compound/control syntax.
 * Splitting a compound command would let a skipped branch attribute writes.
 */
function simpleCommand(command: string): ShellToken[] | undefined {
  const segments = shellSegments(command)
  if (segments.length !== 1) return undefined
  const tokens = segments[0]?.tokens ?? []
  if (tokens.length === 0) return undefined
  if ((tokens[0] as ShellToken).quoted) return undefined
  if (CONTROL_COMMANDS.has((tokens[0] as ShellToken).value.toLowerCase())) return undefined
  // PowerShell preview switches never perform the write they name.
  if (
    tokens.some(
      (token) => !token.quoted && /^-(?:whatif|wi|wh|what|whati)(?::|$)/iu.test(token.value),
    )
  ) {
    return undefined
  }
  if (tokens.some((token) => SIMPLE_REJECT.has(token.value))) return undefined
  return [...tokens]
}

/** Skip option values so the returned tokens are positional arguments only. */
function positionalTokens(args: readonly string[]): string[] {
  const tokens: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string
    if (arg.startsWith('-')) {
      if (VALUE_OPTIONS.has(arg.toLowerCase())) index += 1
      continue
    }
    tokens.push(arg)
  }
  return tokens
}

function namedArgument(args: readonly string[], names: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = (args[index] as string).toLowerCase()
    for (const name of names) {
      if (arg === name) return args[index + 1]
      if (arg.startsWith(`${name}:`)) return (args[index] as string).slice(name.length + 1)
    }
  }
  return undefined
}

function writeDestination(verb: string, args: readonly string[]): string | undefined {
  const positional = positionalTokens(args)
  if (/^(?:copy-item|move-item|cp|mv)$/u.test(verb)) {
    return namedArgument(args, ['-destination']) ?? positional[positional.length - 1]
  }
  return namedArgument(args, ['-path', '-literalpath', '-filepath']) ?? positional[0]
}

/** Only actual destinations inside this workspace; ambiguous forms stay unattributed. */
function shellWriteTargets(
  workspaceCwd: string,
  executionCwd: string,
  tokens: readonly ShellToken[],
): Array<{ change: string; file: string }> {
  const targets: Array<{ change: string; file: string }> = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index] as ShellToken
    if (token.quoted || (token.value !== '>' && token.value !== '>>')) continue
    const target = evidenceTarget(
      workspaceCwd,
      executionCwd,
      (tokens[index + 1] as ShellToken).value,
    )
    if (target !== undefined) targets.push(target)
  }
  const verb = ((tokens[0] as ShellToken).value ?? '').toLowerCase()
  if (!WRITE_VERBS.has(verb)) return targets
  const destination = writeDestination(
    verb,
    tokens.slice(1).map((token) => token.value),
  )
  const target =
    destination === undefined ? undefined : evidenceTarget(workspaceCwd, executionCwd, destination)
  if (target !== undefined) targets.push(target)
  return targets
}

// shortcut: shell evidence watches only one explicit simple command; quoted
// examples, comments, argument text, control/compound syntax, quoted
// operators, ambiguous option positions, and cross-workspace paths stay
// unattributed and need task_progress or an explicit review/patch delegate.

function recordWriteEvidence(
  state: DelegationState,
  agentId: string,
  cwd: string,
  exec: { name: string; arguments: unknown },
  result: { isError: boolean; value?: unknown },
): void {
  if (result.isError) return
  const args = isRecord(exec.arguments) ? exec.arguments : {}
  const value = isRecord(result.value) ? result.value : undefined
  if (exec.name === 'edit' || exec.name === 'write') {
    const canonical = typeof value?.path === 'string' ? value.path : undefined
    const argumentPath = typeof args.file_path === 'string' ? args.file_path : undefined
    const path = canonical ?? (argumentPath === undefined ? undefined : resolve(cwd, argumentPath))
    if (path === undefined) return
    const target = evidenceTarget(cwd, cwd, path)
    if (target === undefined) return
    const evidence = state.evidenceFor(agentId, target.change)
    if (target.file === 'tasks.md') {
      if (
        value !== undefined &&
        (value.before === null || typeof value.before === 'string') &&
        typeof value.after === 'string'
      ) {
        evidence.taskWrites.push({ before: value.before, after: value.after })
      } else {
        evidence.opaqueTaskWrite = true
      }
    } else {
      evidence.outsideTasks = true
    }
    return
  }
  if (exec.name !== 'pwsh' && exec.name !== 'bash') return
  const command = typeof args.command === 'string' ? args.command : undefined
  if (command === undefined) return
  // The installed shell tool reports ordinary command failures as a successful
  // tool call with a nonzero exit; a failed command wrote nothing attributable.
  if (value === undefined || value.exitCode !== 0) return
  const workspaceRoot = findOpenSpecRootSync(cwd)
  const reportedCwd = typeof value.cwd === 'string' ? value.cwd : undefined
  const executionCwd =
    reportedCwd !== undefined
      ? resolve(cwd, reportedCwd)
      : typeof args.workdir === 'string'
        ? resolve(cwd, args.workdir)
        : cwd
  const tokens = simpleCommand(command)
  const executionRoot = findOpenSpecRootSync(executionCwd)
  if (tokens !== undefined) {
    if (
      workspaceRoot !== undefined &&
      executionRoot === workspaceRoot &&
      (tokens[0] as ShellToken).value.toLowerCase() === 'openspec' &&
      (tokens[1] as ShellToken | undefined)?.value.toLowerCase() === 'new' &&
      (tokens[2] as ShellToken | undefined)?.value.toLowerCase() === 'change'
    ) {
      const change = tokens[3]?.value ?? ''
      if (CHANGE_PATTERN.test(change)) state.evidenceFor(agentId, change).creation = true
    }
    for (const target of shellWriteTargets(cwd, executionCwd, tokens)) {
      const evidence = state.evidenceFor(agentId, target.change)
      if (target.file === 'tasks.md') evidence.opaqueTaskWrite = true
      else evidence.outsideTasks = true
    }
  }
}

/**
 * The worker evidence label: `lane-tag: <change>#<n>`, n is the lane's plan
 * position. The label, the canonical positive integer, and the tag's end are
 * exact: `xlane-tag`, `#02`, and `#2x` are not the printed tag.
 */
const LANE_TAG_PATTERN =
  /(?<![A-Za-z0-9_-])lane-tag:\s*([a-z0-9][a-z0-9-]*)#([1-9][0-9]*)(?![0-9A-Za-z_])/u

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
 * Record the lane a successful worker start covered. The `tools/result`
 * listener is synchronous, so the plan is read synchronously and the lane title
 * is stored; a later rename therefore leaves the renamed lane unassigned. The
 * tag is searched in decoded argument strings, so a tag that starts a new line
 * still matches.
 */
function recordLaneAssignment(
  state: DelegationState,
  agentId: string,
  cwd: string,
  argumentsValue: unknown,
): void {
  const strings: string[] = []
  argumentStrings(argumentsValue, strings)
  let match: RegExpExecArray | null = null
  for (const text of strings) {
    match = LANE_TAG_PATTERN.exec(text)
    if (match !== null) break
  }
  if (match === null) return
  const change = match[1] as string
  const number = Number(match[2])
  if (!Number.isSafeInteger(number) || number < 1) return
  const openspecRoot = findOpenSpecRootSync(cwd)
  if (openspecRoot === undefined) return
  let plan: string
  try {
    plan = readFileSync(join(openspecRoot, 'changes', change, 'tasks.md'), 'utf8')
  } catch {
    return
  }
  const lane = parseTaskLanes(plan)[number - 1]
  if (lane === undefined || lane.title === '') return
  state.assignLane(agentId, change, lane.title)
}

/**
 * Attribute this turn's evidence. The snapshot baseline identifies a newly
 * created change and the current list; per-write canonical contents identify
 * checkbox transitions and substantive edits.
 */
function applyTurnEvidence(
  involvement: SessionInvolvement,
  evidence: ReadonlyMap<string, ChangeEvidence>,
  baseline: Snapshot,
  current: Snapshot,
): boolean {
  let changed = false
  for (const [name, changeEvidence] of evidence) {
    const currentChange = current.changes.find((entry) => entry.name === name)
    if (currentChange === undefined) continue
    const previous = JSON.stringify(involvement.changes[name])
    const entry = involvementEntry(involvement, name)
    const existed = baseline.changes.some((change) => change.name === name)
    if (!existed && changeEvidence.creation) {
      entry.created = true
      entry.specChanged = true
    } else if (changeEvidence.outsideTasks) {
      entry.specChanged = true
    }
    let writeCompletedList = false
    for (const write of changeEvidence.taskWrites) {
      const beforeText = write.before ?? ''
      if (normalizeCheckboxes(write.after) !== normalizeCheckboxes(beforeText)) {
        entry.specChanged = true
      }
      const checkedBefore = new Set(
        parseTasksText(beforeText)
          .filter((task) => task.checked)
          .map((task) => task.id),
      )
      const afterTasks = parseTasksText(write.after)
      let addedInWrite = false
      for (const task of afterTasks) {
        if (!task.checked || checkedBefore.has(task.id)) continue
        if (!entry.tasks.includes(task.id)) entry.tasks.push(task.id)
        addedInWrite = true
      }
      if (addedInWrite && afterTasks.length > 0 && afterTasks.every((task) => task.checked)) {
        writeCompletedList = true
      }
    }
    if (
      writeCompletedList &&
      currentChange.tasks.length > 0 &&
      currentChange.tasks.every((task) => task.checked)
    ) {
      entry.completed = true
    }
    if (JSON.stringify(involvement.changes[name]) !== previous) changed = true
  }
  return changed
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } finally {
    // A failed write or rename must not leave the temporary file behind.
    await unlink(temporary).catch(() => undefined)
  }
}

function runsDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, DELEGATION_DIR, 'runs')
}

function runFilePath(workspaceRoot: string, runId: string): string {
  return join(runsDirectory(workspaceRoot), `${runId}.json`)
}

function reviewConversationKey(
  change: string,
  task: TaskInfo | undefined,
  rule: RuleConfig,
): string {
  return task !== undefined
    ? `${change}\u0000task\u0000${task.id}`
    : `${change}\u0000whole\u0000${rule.phase ?? 'review'}`
}

/** The prepared-review identity: rule, change, task/phase, digest, and resolved reviewer. */
function reviewIdentity(
  rule: RuleConfig,
  change: string,
  task: TaskInfo | undefined,
  digest: string,
  reviewer: string,
): string {
  return `${rule.id}\u0000${change}\u0000${task?.id ?? rule.phase ?? 'whole'}\u0000${digest}\u0000${reviewer}`
}

/** The resolved reviewer identity a dedupe key binds: provider, model, and effort. */
function reviewerLabel(target: TargetConfig): string {
  const model = target.model ?? target.agentOptions?.model ?? ''
  const effort = target.reasoningEffort ?? target.agentOptions?.reasoningEffort ?? ''
  return `${target.provider}/${model}@${effort}`
}

/** Human/provider-readable key marker; a provider may resume one conversation per key. */
function reviewKeyForPrompt(change: string, task: TaskInfo | undefined, rule: RuleConfig): string {
  return task !== undefined
    ? `review:${change}:task:${task.id}`
    : `review:${change}:whole:${rule.phase ?? 'review'}`
}

function isRunState(value: unknown): value is RunState {
  return (
    value === 'queued' ||
    value === 'starting' ||
    value === 'running' ||
    value === 'retry-wait' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'discarded' ||
    value === 'interrupted'
  )
}

const RUN_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const RUN_ID = /^[a-z0-9][a-z0-9-]{0,80}$/
const FAILURE_CLASSES: ReadonlySet<string> = new Set<FailureClass>([
  'child-limit',
  'provider-not-started',
  'timeout',
  'reviewed-inputs-changed',
  'invalid-output',
  'config',
  'permission',
  'unknown',
  'queue-full',
  'queue-timeout',
  'queue-internal-error',
])

function isFailureClass(value: unknown): value is FailureClass {
  return typeof value === 'string' && FAILURE_CLASSES.has(value)
}

function isActiveRunState(state: RunState): boolean {
  return state === 'queued' || state === 'starting' || state === 'running' || state === 'retry-wait'
}

function isRunTimestamp(value: unknown): value is string {
  return typeof value === 'string' && RUN_TIMESTAMP.test(value)
}

/** A normalized workspace-relative record path; nested session roots are valid. */
function isSafeRecordPath(value: string): boolean {
  if (value === '' || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\\')) {
    return false
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    return false
  }
  return segments.includes('.dsh') && segments.includes('delegation')
}

function parseRunFile(value: unknown): RunFile | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.id !== 'string' ||
    !RUN_ID.test(value.id) ||
    typeof value.rule !== 'string' ||
    typeof value.change !== 'string' ||
    typeof value.key !== 'string' ||
    typeof value.identity !== 'string' ||
    !isRunState(value.state) ||
    typeof value.record !== 'string' ||
    !isSafeRecordPath(value.record) ||
    typeof value.startedAt !== 'string'
  ) {
    return undefined
  }
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return undefined
  if (value.detail !== undefined) {
    if (typeof value.detail !== 'string') return undefined
    // Normalize rather than discard an otherwise valid run: the engine bounds
    // details to 4000 characters, the status shows a shorter excerpt.
    value.detail = sanitizeText(value.detail, 500)
  }
  if (value.queuePosition !== undefined) {
    if (typeof value.queuePosition !== 'number' || !Number.isSafeInteger(value.queuePosition)) {
      return undefined
    }
  }
  if (value.queuedAt !== undefined && !isRunTimestamp(value.queuedAt)) return undefined
  if (value.waitMs !== undefined) {
    if (typeof value.waitMs !== 'number' || !Number.isFinite(value.waitMs) || value.waitMs < 0) {
      return undefined
    }
  }
  if (value.attempts !== undefined) {
    if (typeof value.attempts !== 'number' || !Number.isSafeInteger(value.attempts))
      return undefined
  }
  if (value.failureClass !== undefined && !isFailureClass(value.failureClass)) return undefined
  if (value.lastRetryAt !== undefined && !isRunTimestamp(value.lastRetryAt)) return undefined
  return value as unknown as RunFile
}

/** Recent review runs for one workspace, newest first; unreadable run files are ignored. */
async function listRunFiles(workspaceRoot: string): Promise<RunFile[]> {
  return (await listAllRunFiles(workspaceRoot)).slice(0, 30)
}

/** Every durable run, for reconciliation; status presentation applies its own limit. */
async function listAllRunFiles(workspaceRoot: string): Promise<RunFile[]> {
  let names: string[]
  try {
    names = await readdir(runsDirectory(workspaceRoot))
  } catch {
    return []
  }
  const runs: RunFile[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const run = parseRunFile(
        JSON.parse(await readFile(join(runsDirectory(workspaceRoot), name), 'utf8')),
      )
      // The durable id must match its file name so recovery can rewrite it safely.
      if (run !== undefined && `${run.id}.json` === name) runs.push(run)
    } catch {
      // A stale/partial run file is scratch; ignore it in the status view.
    }
  }
  return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt))
}

/** One owned review completion lost to an already-authoritative record. */
class DiscardedRun extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'DiscardedRun'
  }
}

interface InputSignature {
  /** Walk root, used to render changed paths in the discarded-verdict report. */
  root: string
  /** Absolute path -> stat signature; absolute keys make a merged set one entry per file. */
  entries: Map<string, string>
}

const CHANGE_INPUT_EXCLUDES = new Set(['.openspec.yaml', REVIEWS_DIRECTORY])

/** Stat signature (size + nanosecond mtime/ctime) for one reviewed path. */
async function inputStat(path: string): Promise<string> {
  try {
    const info = await stat(path, { bigint: true })
    return `${info.size}:${info.mtimeNs}:${info.ctimeNs}`
  } catch {
    // A deleted tracked file is a changed input, not an unreadable workspace.
    return '[missing]'
  }
}

/** Stat signature of every file under a walked root. */
async function inputSignature(
  root: string,
  excludes: ReadonlySet<string>,
): Promise<InputSignature> {
  const entries = new Map<string, string>()
  async function walk(directory: string, prefix: string): Promise<void> {
    let dirents: Dirent[]
    try {
      dirents = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      fail(
        `could not read reviewed inputs under ${prefix === '' ? '.' : prefix}: ${errorMessage(error)}`,
      )
    }
    for (const entry of dirents) {
      // Exclusions are change-root entries: a nested `reviews/` or
      // `.openspec.yaml` is a normal artifact and stays reviewed.
      if (prefix === '' && excludes.has(entry.name)) continue
      const name = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const absolute = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute, name)
        continue
      }
      if (!entry.isFile()) continue
      entries.set(absolute, await inputStat(absolute))
    }
  }
  await walk(root, '')
  return { root, entries }
}

/** The git-visible worktree file set the worktree digest covers. */
async function gitInputSignature(
  root: string,
  services: GitServices,
  signal?: AbortSignal,
): Promise<InputSignature> {
  let raw: Buffer
  try {
    raw = await services.runGit(
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      root,
      signal,
    )
  } catch (error) {
    fail(`could not list the reviewed worktree inputs: ${errorMessage(error)}`)
  }
  const entries = new Map<string, string>()
  for (const path of raw.toString('utf8').split('\0')) {
    // Keep the digest's two scratch exclusions; everything else git exposes is reviewed.
    if (path === '' || ignoredForDigest(path)) continue
    const absolute = resolve(root, path)
    entries.set(absolute, await inputStat(absolute))
  }
  return { root, entries }
}

/** Whole-spec reviews track the change artifacts; code reviews track the worktree. */
async function reviewedInputs(
  cwd: string,
  rule: RuleConfig,
  change: ChangeInfo,
  services: EngineServices,
  signal: AbortSignal,
): Promise<InputSignature> {
  if (rule.scope === 'whole' && rule.when !== 'implementation-complete') {
    return inputSignature(change.dir, CHANGE_INPUT_EXCLUDES)
  }
  const root = await repositoryRoot(cwd, services.git, signal)
  const signature = await gitInputSignature(root, services.git, signal)
  // The portable approval directory is engine output, not reviewed input: a
  // record another review writes during this run must not discard the verdict.
  let approvals = resolve(change.dir, REVIEWS_DIRECTORY)
  try {
    approvals = resolve(
      root,
      relative(await realpath(root), await realpath(change.dir)),
      REVIEWS_DIRECTORY,
    )
  } catch {
    // Fall back to the session's lexical form when the paths cannot be resolved.
  }
  for (const path of [...signature.entries.keys()]) {
    if (path === approvals || path.startsWith(`${approvals}${sep}`)) {
      signature.entries.delete(path)
    }
  }
  if (rule.scope !== 'task') return signature
  // A task digest also hashes the change artifacts, so they are guarded regardless of git.
  for (const [path, value] of (await inputSignature(change.dir, CHANGE_INPUT_EXCLUDES)).entries) {
    signature.entries.set(path, value)
  }
  return signature
}

/** Paths whose reviewed input changed (added, removed, or stat/content mutation). */
function changedInputPaths(signature: InputSignature, current: InputSignature): string[] {
  const changed = new Set<string>()
  for (const [path, value] of signature.entries) {
    if (current.entries.get(path) !== value) changed.add(relativePath(signature.root, path))
  }
  for (const path of current.entries.keys()) {
    if (!signature.entries.has(path)) changed.add(relativePath(signature.root, path))
  }
  return [...changed].sort()
}

/**
 * Publish lock per record: only one completion can decide the authoritative
 * record. A stale lock from a crashed run is broken after 30s.
 */
async function acquirePublishLock(recordPath: string): Promise<() => Promise<void>> {
  const lock = `${recordPath}.publish`
  await mkdir(dirname(lock), { recursive: true })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await writeFile(lock, '1', { encoding: 'utf8', flag: 'wx' })
      return async () => {
        await unlink(lock).catch(() => undefined)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    try {
      const info = await stat(lock)
      if (Date.now() - info.mtimeMs > 30_000) {
        await unlink(lock).catch(() => undefined)
        continue
      }
    } catch {
      // The lock vanished between EEXIST and stat; retry the exclusive create.
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  fail(
    `could not acquire the review publish lock at ${lock}; another completion is stuck or the workspace is read-only`,
  )
}

function checkedTaskList(tasks: TaskInfo[]): string {
  return tasks
    .filter((task) => task.checked)
    .map((task) => `${task.id} "${task.number} ${task.text}"`)
    .join(', ')
}

/** Resolve an explicit task id/text for one task-scoped review. */
function resolveTaskArgument(change: ChangeInfo, tasks: TaskInfo[], wanted: string): TaskInfo {
  const normalized = normalizeTaskText(wanted)
  const match = tasks.find(
    (task) =>
      task.id === wanted ||
      normalizeTaskText(task.text) === normalized ||
      normalizeTaskText(`${task.number} ${task.text}`) === normalized,
  )
  if (match === undefined) {
    fail(
      `task "${wanted}" was not found in change "${change.name}"; allowed checked tasks: ${checkedTaskList(tasks) || '(none)'}`,
    )
  }
  if (!match.checked) {
    fail(
      `task "${match.number} ${match.text}" is not checked in change "${change.name}"; only checked tasks can be reviewed. Allowed checked tasks: ${checkedTaskList(tasks) || '(none)'}`,
    )
  }
  return match
}

function parseRecord(value: unknown): ReviewRecord | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.rule !== 'string' ||
    typeof value.change !== 'string' ||
    typeof value.phase !== 'string' ||
    (value.scope !== 'whole' && value.scope !== 'task') ||
    typeof value.digest !== 'string' ||
    !DIGEST_PATTERN.test(value.digest) ||
    (value.verdict !== 'PASS' && value.verdict !== 'FINDINGS' && value.verdict !== 'ERROR') ||
    !Array.isArray(value.findings) ||
    !value.findings.every(isReviewFinding) ||
    !isRecord(value.target) ||
    typeof value.target.provider !== 'string' ||
    typeof value.time !== 'string'
  ) {
    return undefined
  }
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return undefined
  if (value.scope === 'task' && typeof value.taskId !== 'string') return undefined
  if (value.target.model !== undefined && typeof value.target.model !== 'string') return undefined
  if (
    value.target.reasoningEffort !== undefined &&
    typeof value.target.reasoningEffort !== 'string'
  ) {
    return undefined
  }
  if (value.worktreeDigest !== undefined && typeof value.worktreeDigest !== 'string')
    return undefined
  if (value.session !== undefined && (typeof value.session !== 'string' || value.session === '')) {
    return undefined
  }
  if (value.runId !== undefined && (typeof value.runId !== 'string' || value.runId === '')) {
    return undefined
  }
  if (value.error !== undefined && typeof value.error !== 'string') return undefined
  return value as unknown as ReviewRecord
}

async function inspectRecord(path: string): Promise<RecordState> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'malformed', error: errorMessage(error) }
  }
  try {
    const record = parseRecord(JSON.parse(raw))
    if (record === undefined) return { kind: 'malformed', error: 'record shape is invalid' }
    return { kind: 'record', record }
  } catch (error) {
    return { kind: 'malformed', error: errorMessage(error) }
  }
}

/** A record at the computed path must still identify the rule/change/task it claims. */
function recordIdentifies(
  record: ReviewRecord,
  rule: RuleConfig,
  change: string,
  taskId: string | undefined,
): boolean {
  if (record.rule !== rule.id || record.change !== change) return false
  if (record.scope !== (rule.scope ?? 'whole')) return false
  return rule.scope !== 'task' || record.taskId === taskId
}

/** A gate match: PASS/ERROR only, identified, with an optional current-digest check. */
function recordSatisfies(
  state: RecordState,
  change: string,
  scope: ReviewScope,
  digest: string | undefined,
  taskId?: string,
): boolean {
  if (state.kind !== 'record') return false
  const record = state.record
  if (record.change !== change || record.scope !== scope) return false
  if (record.verdict !== 'PASS' && record.verdict !== 'ERROR') return false
  // A queue fault is not a review: the gate must ask for a fresh review rather
  // than treating its fallback ERROR as the reviewed outcome.
  if (record.verdict === 'ERROR' && record.error?.startsWith('queue-internal-error')) return false
  if (scope === 'task' && record.taskId !== taskId) return false
  return digest === undefined || record.digest === digest
}

async function inspectNote(
  cwd: string,
  change: string,
): Promise<{ kind: 'missing' } | { kind: 'malformed' } | { kind: 'note'; note: ProgressNote }> {
  let raw: string
  try {
    raw = await readFile(notePath(cwd, change), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'malformed' }
  }
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return { kind: 'malformed' }
    if (
      typeof value.taskId !== 'string' ||
      !TASK_ID_PATTERN.test(value.taskId) ||
      (value.status !== 'in-progress' && value.status !== 'blocked') ||
      typeof value.reason !== 'string' ||
      typeof value.worktreeDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.worktreeDigest) ||
      typeof value.time !== 'string'
    ) {
      return { kind: 'malformed' }
    }
    return { kind: 'note', note: value as unknown as ProgressNote }
  } catch {
    return { kind: 'malformed' }
  }
}

/** The task-review rule whose portable PASS is the approval, with its reviewer binding. */
async function approvalRuleId(
  config: EngineConfig,
  openspecRoot: string,
): Promise<{ id: string; reviewer?: ReviewerBinding } | { error: string }> {
  const path = join(openspecRoot, APPROVAL_MARKER_FILE)
  let raw: string | undefined
  try {
    raw = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { error: `${APPROVAL_MARKER_FILE} is unreadable: ${errorMessage(error)}` }
    }
  }
  let marker: ReviewApprovalMarker | undefined
  if (raw !== undefined) {
    try {
      const parsed = parseReviewApprovalMarker(JSON.parse(raw))
      if (parsed.marker === undefined) {
        return { error: `${APPROVAL_MARKER_FILE}: ${parsed.error ?? 'invalid marker'}` }
      }
      marker = parsed.marker
    } catch (error) {
      return { error: `${APPROVAL_MARKER_FILE} is not valid JSON: ${errorMessage(error)}` }
    }
  }
  if (marker !== undefined) {
    const rule = config.rules.find((entry) => entry.id === marker?.taskRule)
    if (rule === undefined) {
      return { error: `marker taskRule "${marker.taskRule}" is not a configured rule` }
    }
    if (rule.contract !== 'review' || rule.scope !== 'task') {
      return { error: `marker taskRule "${rule.id}" is not a task-scoped review rule` }
    }
    if (rule.gate !== 'strict') {
      return { error: `marker taskRule "${rule.id}" is not a strict rule` }
    }
    const reviewer = reviewerBindingOf(marker)
    return { id: rule.id, ...(reviewer === undefined ? {} : { reviewer }) }
  }
  const taskRules = config.rules.filter(
    (rule) =>
      rule.when === 'spec-task-ready' && rule.contract === 'review' && rule.scope === 'task',
  )
  const strict = taskRules.find((rule) => rule.gate === 'strict')
  if (strict !== undefined) return { id: strict.id }
  const fallback = taskRules[0]
  return fallback === undefined
    ? { error: 'no task-scoped review rule is configured' }
    : { id: fallback.id }
}

/** The reviewer binding the marker declares, or why it could not be read. */
interface ReviewerRead {
  reviewer?: ReviewerBinding
  error?: string
}

/**
 * The reviewer binding the marker declares, read from an OpenSpec root. A
 * missing marker keeps provider-agnostic behavior; an unreadable or invalid
 * marker is reported so the live task gate can fail closed instead of treating
 * it as "no binding".
 */
async function readReviewerBinding(openspecRoot: string): Promise<ReviewerRead> {
  let raw: string
  try {
    raw = await readFile(join(openspecRoot, APPROVAL_MARKER_FILE), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    return { error: `${APPROVAL_MARKER_FILE} is unreadable: ${errorMessage(error)}` }
  }
  try {
    const parsed = parseReviewApprovalMarker(JSON.parse(raw))
    if (parsed.marker === undefined) {
      return { error: `${APPROVAL_MARKER_FILE}: ${parsed.error ?? 'invalid marker'}` }
    }
    const reviewer = reviewerBindingOf(parsed.marker)
    return reviewer === undefined ? {} : { reviewer }
  } catch (error) {
    return { error: `${APPROVAL_MARKER_FILE} is not valid JSON: ${errorMessage(error)}` }
  }
}

async function inspectPortableRecord(
  changeDir: string,
  taskId: string,
): Promise<ApprovalRecordState> {
  let raw: string
  try {
    raw = await readFile(portableTaskRecordPath(changeDir, taskId), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    return { kind: 'malformed', error: errorMessage(error) }
  }
  try {
    const parsed = parsePortableTaskReviewRecord(JSON.parse(raw))
    return parsed.record === undefined
      ? { kind: 'malformed', error: parsed.error ?? 'record shape is invalid' }
      : { kind: 'record', record: parsed.record }
  } catch (error) {
    return { kind: 'malformed', error: errorMessage(error) }
  }
}

/** PASS-only coverage over every checked task, independent of session attribution. */
async function changeApproval(
  config: EngineConfig,
  change: ChangeInfo,
  openspecRoot: string,
  tasks: TaskInfo[],
): Promise<{ coverage: ApprovalCoverage } | { error: string }> {
  const rule = await approvalRuleId(config, openspecRoot)
  if ('error' in rule) return rule
  let markdown: string
  try {
    markdown = await readFile(join(change.dir, 'tasks.md'), 'utf8')
  } catch (error) {
    return { error: `change "${change.name}" has no readable tasks.md: ${errorMessage(error)}` }
  }
  const coverage = await computeApprovalCoverage({
    change: change.name,
    rule: rule.id,
    ...(rule.reviewer === undefined ? {} : { reviewer: rule.reviewer }),
    tasks,
    unparseable: unparseableCheckedLines(markdown),
    recordPath: (taskId) =>
      portableTaskRecordDisplayPath(`openspec/changes/${change.name}`, taskId),
    inspect: (taskId) => inspectPortableRecord(change.dir, taskId),
  })
  return { coverage }
}

interface ParsedVerdict {
  verdict: 'PASS' | 'FINDINGS'
  findings: Finding[]
}

/** A reviewer result that cannot be accepted as a verdict. */
class InvalidOutputError extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOutputError'
  }
}

/** Accept exactly one fenced JSON verdict that echoes the requested digest. */
export function parseVerdict(text: string, expectedDigest: string): ParsedVerdict {
  try {
    return parseVerdictInner(text, expectedDigest)
  } catch (error) {
    // Every rejection here is the reviewer's output, never a transient target
    // failure: the classifier must not read keywords out of the payload.
    throw new InvalidOutputError(errorMessage(error))
  }
}

function parseVerdictInner(text: string, expectedDigest: string): ParsedVerdict {
  const blocks: string[] = []
  const fence = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/g
  for (const match of text.matchAll(fence)) {
    blocks.push(match[1] ?? '')
  }
  if (blocks.length === 0)
    fail('the target returned no fenced JSON verdict; the review needs exactly one block')
  if (blocks.length > 1)
    fail(`the target returned ${blocks.length} fenced blocks; exactly one JSON verdict is required`)
  let value: unknown
  try {
    value = JSON.parse(blocks[0] as string)
  } catch (error) {
    fail(`the fenced verdict is not valid JSON: ${errorMessage(error)}`)
  }
  if (!isRecord(value)) fail('the fenced verdict must be a JSON object')
  if (value.digest !== expectedDigest) {
    fail(
      'the verdict digest does not match the reviewed digest; re-run the review on the current artifacts',
    )
  }
  const verdict: unknown = value.verdict
  if (verdict !== 'PASS' && verdict !== 'FINDINGS') fail('the verdict must be "PASS" or "FINDINGS"')
  const findingsRaw = value.findings ?? []
  if (!Array.isArray(findingsRaw)) fail('the verdict findings must be a list')
  const findings: Finding[] = findingsRaw.map((finding: unknown, index: number) => {
    if (!isRecord(finding)) fail(`finding #${index + 1} must be an object`)
    if (finding.severity !== 'P0' && finding.severity !== 'P1') {
      fail(`finding #${index + 1} severity must be "P0" or "P1"`)
    }
    return {
      severity: finding.severity,
      class: normalizeFindingClass(finding.class),
      title: sanitizeText(requireNonEmpty(finding.title, `finding #${index + 1}.title`)),
      evidence: sanitizeText(requireNonEmpty(finding.evidence, `finding #${index + 1}.evidence`)),
      fix: sanitizeText(requireNonEmpty(finding.fix, `finding #${index + 1}.fix`)),
    }
  })
  if (verdict === 'PASS' && findings.length > 0) fail('verdict PASS requires zero P0/P1 findings')
  if (verdict === 'FINDINGS' && findings.length === 0)
    fail('verdict FINDINGS requires at least one P0/P1 finding')
  return { verdict, findings }
}

/** The steering message shape: role user, attributed to this gate. */
function gateMessage(text: string): UserMessage {
  const content = Object.freeze([Object.freeze({ type: 'text' as const, text })])
  const message = Object.freeze({
    id: randomUUID() as MessageId,
    role: 'user' as const,
    content,
    source: Object.freeze({ kind: GATE_SOURCE_KIND }),
  })
  return message as unknown as UserMessage
}

/** One session's decided state for one lane of one change. */
type LaneDecision = 'assigned' | 'serial'

interface AgentState {
  failures: number
  epoch: number
  consultedEpoch: number
  steered: Set<string>
  turn: number
  baseline?: Snapshot
  lastSnapshot?: Snapshot
  evidence: Map<string, ChangeEvidence>
  /** A parallel worker start observed in this turn; `beginTurn` clears it. */
  workerStarted: boolean
  /** Latest successful `work_checkpoint` call observed in this turn. */
  checkpoint?: { turn: number; arguments: unknown; result: unknown }
  /** Session-scoped lane decisions, keyed by change then lane title. */
  lanes: Map<string, Map<string, LaneDecision>>
}

/** Per-agent failure streak, consultation, steering, snapshots, and write evidence. */
class DelegationState {
  private readonly agents = new Map<string, AgentState>()

  private of(agentId: string): AgentState {
    let state = this.agents.get(agentId)
    if (state === undefined) {
      state = {
        failures: 0,
        epoch: 0,
        consultedEpoch: -1,
        steered: new Set(),
        turn: -1,
        evidence: new Map(),
        workerStarted: false,
        lanes: new Map(),
      }
      this.agents.set(agentId, state)
    }
    return state
  }

  recordToolResult(agentId: string, isError: boolean): void {
    const state = this.of(agentId)
    if (isError) {
      state.failures += 1
      return
    }
    if (state.failures > 0) {
      state.failures = 0
      state.epoch += 1
    }
  }

  beginTurn(agentId: string, turn: number): boolean {
    const state = this.of(agentId)
    if (state.turn === turn) return false
    state.turn = turn
    state.failures = 0
    state.epoch += 1
    state.steered.clear()
    state.baseline = undefined
    state.evidence = new Map()
    state.workerStarted = false
    delete state.checkpoint
    return true
  }

  evidenceFor(agentId: string, change: string): ChangeEvidence {
    const evidence = this.of(agentId).evidence
    let entry = evidence.get(change)
    if (entry === undefined) {
      entry = freshEvidence()
      evidence.set(change, entry)
    }
    return entry
  }

  evidenceOf(agentId: string): ReadonlyMap<string, ChangeEvidence> {
    return this.of(agentId).evidence
  }

  failuresOf(agentId: string): number {
    return this.of(agentId).failures
  }

  markWorkerStarted(agentId: string): void {
    this.of(agentId).workerStarted = true
  }

  hasWorkerStart(agentId: string): boolean {
    return this.of(agentId).workerStarted
  }

  /** Remember the latest successful checkpoint call for this agent's current turn. */
  recordCheckpoint(agentId: string, argumentsValue: unknown, resultValue: unknown): void {
    const state = this.of(agentId)
    state.checkpoint = { turn: state.turn, arguments: argumentsValue, result: resultValue }
  }

  /** The checkpoint observed for this exact turn; a stale turn is unreadable. */
  checkpointOf(agentId: string, turn: number): { arguments: unknown; result: unknown } | undefined {
    const checkpoint = this.of(agentId).checkpoint
    return checkpoint?.turn === turn ? checkpoint : undefined
  }

  private lanesFor(agentId: string, change: string): Map<string, LaneDecision> {
    const state = this.of(agentId)
    let lanes = state.lanes.get(change)
    if (lanes === undefined) {
      lanes = new Map()
      state.lanes.set(change, lanes)
    }
    return lanes
  }

  /** A successful tagged worker start assigns one lane for this session. */
  assignLane(agentId: string, change: string, lane: string): void {
    this.lanesFor(agentId, change).set(lane, 'assigned')
  }

  /** A successful progress note decides one lane serial; the decision outlives the digest. */
  markLaneSerial(agentId: string, change: string, lane: string): void {
    this.lanesFor(agentId, change).set(lane, 'serial')
  }

  laneDecision(agentId: string, change: string, lane: string): LaneDecision | undefined {
    return this.of(agentId).lanes.get(change)?.get(lane)
  }

  laneDecisions(agentId: string, change: string): ReadonlyMap<string, LaneDecision> {
    return this.of(agentId).lanes.get(change) ?? new Map()
  }

  /** Forget one lane's decision when it disappears, completes, or is renamed. */
  releaseLane(agentId: string, change: string, lane: string): void {
    const lanes = this.of(agentId).lanes.get(change)
    if (lanes === undefined) return
    lanes.delete(lane)
    if (lanes.size === 0) this.of(agentId).lanes.delete(change)
  }

  markConsulted(agentId: string): void {
    const state = this.of(agentId)
    state.consultedEpoch = state.epoch
  }

  consulted(agentId: string): boolean {
    const state = this.of(agentId)
    return state.consultedEpoch === state.epoch
  }

  epochOf(agentId: string): number {
    return this.of(agentId).epoch
  }

  markSteered(agentId: string, key: string): void {
    this.of(agentId).steered.add(key)
  }

  wasSteered(agentId: string, key: string): boolean {
    return this.of(agentId).steered.has(key)
  }

  setBaseline(agentId: string, snapshot: Snapshot): void {
    this.of(agentId).baseline = snapshot
  }

  baselineOf(agentId: string, turn: number): Snapshot | undefined {
    const state = this.of(agentId)
    if (state.baseline !== undefined && state.turn === turn) return state.baseline
    return state.lastSnapshot
  }

  /** The pre-step snapshot for this turn only; no fallback, because attribution needs a baseline. */
  turnBaselineOf(agentId: string, turn: number): Snapshot | undefined {
    const state = this.of(agentId)
    return state.turn === turn ? state.baseline : undefined
  }

  rememberSnapshot(agentId: string, snapshot: Snapshot): void {
    this.of(agentId).lastSnapshot = snapshot
  }
}

interface EngineServices {
  subagents: Pick<SubagentRuntime, 'list' | 'getProvider' | 'startActivation'>
  workingDirectory: Pick<WorkingDirectoryService, 'get'>
  state: DelegationState
  git: GitServices
  now: () => Date
  /** Direct-user-answer service; absent means a lesson cannot be accepted or applied. */
  userQuestions?: UserQuestionsService
  timeoutsFor(rule: RuleConfig): number
  /** Test seam: fired once per review run after it leaves the pending set. */
  onRunSettled?: (runId: string, state: SettledRunState) => void
  /** Test seam: observes each published review record. */
  onPublished?: (runId: string, record: ReviewRecord) => void
  /** Test seam: throws before admission to simulate an internal queue failure. */
  queueFault?: () => void
  /** Test seam: delays the once-per-workspace recovery scan. */
  recoverDelay?: () => Promise<void>
  /** Set by the engine after construction so the gate can see pending review runs. */
  pendingReview?: (
    workspaceRoot: string,
    ruleId: string,
    change: string,
    taskId?: string,
  ) => PendingReviewView | undefined
}

interface RunResult {
  text: string
  provider: string
  model?: string
  reasoningEffort?: string
}

interface RunRequest {
  rule: RuleConfig
  target: TargetConfig
  prompt: string
  agent: Agent
  cwd: string
  signal: AbortSignal
}

function readAsset(asset: string): string {
  try {
    return readFileSync(join(assetsDirectory, `${asset}.md`), 'utf8')
  } catch (error) {
    fail(`bundled instruction "${asset}" could not be read: ${errorMessage(error)}`)
  }
}

function instructionText(rule: RuleConfig): string {
  const instruction = rule.instruction
  if (instruction === undefined) fail(`rule "${rule.id}" has no instruction`)
  if (instruction.startsWith('bundled:')) return readAsset(instruction.slice('bundled:'.length))
  return instruction
}

function targetLabel(target: TargetConfig): string {
  const model = target.model ?? target.agentOptions?.model
  const effort = target.reasoningEffort ?? target.agentOptions?.reasoningEffort
  return `${target.provider}${model === undefined ? '' : `/${model}`}${effort === undefined ? '' : `@${effort}`}`
}

/** The target identity kept in a record: the selection, never a machine path. */
function targetIdentity(
  provider: string,
  model?: string,
  reasoningEffort?: string,
): ReviewRecord['target'] {
  return {
    provider,
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  }
}

function targetLabelFromIdentity(identity: ReviewRecord['target']): string {
  return `${identity.provider}${identity.model === undefined ? '' : `/${identity.model}`}${identity.reasoningEffort === undefined ? '' : `@${identity.reasoningEffort}`}`
}

function resolveAgentOptions(target: TargetConfig): AgentOptions | undefined {
  const options: AgentOptions = {}
  if (target.agentOptions !== undefined) {
    if (target.agentOptions.provider !== undefined) options.provider = target.agentOptions.provider
    if (target.agentOptions.model !== undefined) options.model = target.agentOptions.model
    if (target.agentOptions.reasoningEffort !== undefined) {
      options.reasoningEffort = target.agentOptions
        .reasoningEffort as AgentOptions['reasoningEffort']
    }
    if (target.agentOptions.maxTokens !== undefined)
      options.maxTokens = target.agentOptions.maxTokens
  }
  if (target.model !== undefined) options.model = target.model
  if (target.reasoningEffort !== undefined) {
    options.reasoningEffort = target.reasoningEffort as AgentOptions['reasoningEffort']
  }
  return Object.keys(options).length === 0 ? undefined : options
}

function outputText(result: SubagentResult): string {
  const blocks: string[] = []
  for (const block of result.output) {
    if (block.type === 'text') blocks.push(block.text)
  }
  return blocks.join('\n').trim()
}

interface StartedTarget {
  activation: SubagentActivation
  rule: RuleConfig
  target: TargetConfig
  provider: string
  model?: string
  reasoningEffort?: string
  timeoutMs: number
}

/** Validate the target and start it; the caller decides whether to await its result. */
async function startTarget(services: EngineServices, request: RunRequest): Promise<StartedTarget> {
  const { rule, target, agent, signal } = request
  const provider: SubagentProvider | undefined = services.subagents.getProvider(target.provider)
  if (provider === undefined) {
    const registered = services.subagents.list()
    throw new ConfigError(
      `rule "${rule.id}": target "${rule.to}" names provider "${target.provider}", which is not registered; install or enable that provider, or point the rule's target at one of: ${registered.join(', ') || '(none registered)'}`,
    )
  }
  const agentOptions = resolveAgentOptions(target)
  if (agentOptions !== undefined && provider.capabilities.agentOptions !== true) {
    throw new ConfigError(
      `rule "${rule.id}": target "${rule.to}" requests model/agent options, but provider "${provider.name}" does not support them; remove model/reasoningEffort/agentOptions from the target or choose a provider with agentOptions support`,
    )
  }
  const prompt: ContentBlock[] = [{ type: 'text', text: request.prompt }]
  let activation: SubagentActivation
  try {
    activation = await services.subagents.startActivation({
      provider: provider.name,
      label: `delegation:${rule.id}`,
      request: {
        prompt,
        parent: agent,
        cwd: request.cwd,
        ...(agentOptions === undefined ? {} : { agentOptions }),
      },
      signal,
      delivery: 'caller',
    })
  } catch (error) {
    // Classify the untruncated cause; expose only the bounded, redacted text.
    const providerMessage = errorMessage(error)
    const hint = isRecord(error) ? (error.retryAfterMs ?? error.retryAfter) : undefined
    const retryAfterMs =
      typeof hint === 'number' && Number.isFinite(hint) && hint > 0 ? Math.round(hint) : undefined
    throw new ProviderStartError(
      `rule "${rule.id}": target "${rule.to}" on provider "${provider.name}" could not start: ${boundedMessage(error)}; check targets.${rule.to} options against provider "${provider.name}", or run delegation_status for the next action`,
      providerMessage,
      retryAfterMs,
    )
  }
  const model = target.model ?? agentOptions?.model
  const reasoningEffort = target.reasoningEffort ?? agentOptions?.reasoningEffort
  return {
    activation,
    rule,
    target,
    provider: provider.name,
    ...(model === undefined ? {} : { model }),
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    timeoutMs: services.timeoutsFor(rule),
  }
}

/** Await one started target, dispose it, and normalize the terminal result. */
async function finishTarget(started: StartedTarget): Promise<RunResult> {
  const { rule, target } = started
  let timer: ReturnType<typeof setTimeout> | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let result: SubagentResult | undefined
  let raceError: unknown
  let disposeConfirmed = true
  let disposePending = false
  try {
    result = await Promise.race([
      started.activation.result,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new TimeoutError(
              `rule "${rule.id}": target "${targetLabel(target)}" did not finish within ${started.timeoutMs} ms; widen timeouts.${rule.contract} or narrow the task`,
            ),
          )
        }, started.timeoutMs)
      }),
    ])
  } catch (error) {
    raceError = error
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    // Cancellation gets a bounded grace: an unresponsive dispose must not hold
    // the run open forever; it becomes an unconfirmed timeout instead.
    const disposal = started.activation.dispose().then(
      () => undefined,
      () => {
        disposeConfirmed = false
      },
    )
    const graceMs = Math.min(30_000, started.timeoutMs)
    await Promise.race([
      disposal,
      new Promise<void>((resolve) => {
        graceTimer = setTimeout(() => {
          disposePending = true
          resolve()
        }, graceMs)
      }),
    ])
    if (graceTimer !== undefined) clearTimeout(graceTimer)
  }
  // Classify the failure that will be thrown; any timeout class (local timer,
  // rejected result, or provider diagnostic) needs confirmed cancellation.
  let candidate: unknown = raceError
  if (candidate === undefined && result !== undefined && result.stopReason !== 'completed') {
    const providerMessage =
      result.diagnostic === undefined
        ? `stopped with "${result.stopReason}"`
        : `stopped with "${result.stopReason}": ${result.diagnostic}`
    const diagnostic =
      result.diagnostic === undefined ? '' : `: ${boundedMessage(result.diagnostic)}`
    candidate = new ProviderResultError(
      `rule "${rule.id}": target "${targetLabel(target)}" stopped with "${result.stopReason}"${diagnostic}`,
      providerMessage,
    )
  }
  const wasTimeout =
    candidate !== undefined && classifyFailure(candidate, 'run').failureClass === 'timeout'
  if (wasTimeout && (!disposeConfirmed || disposePending)) {
    throw new UnconfirmedTimeoutError(
      `rule "${rule.id}": target "${targetLabel(target)}" timed out and the child could not be confirmed cancelled; check the provider before starting a fresh review`,
      started.activation,
    )
  }
  if (raceError !== undefined) throw raceError
  if (result === undefined)
    fail(`rule "${rule.id}": target "${targetLabel(target)}" returned no result`)
  if (result.stopReason !== 'completed') throw candidate
  const text = outputText(result)
  if (text === '') {
    throw new InvalidOutputError(
      `rule "${rule.id}": target "${targetLabel(target)}" returned no text output`,
    )
  }
  return {
    text,
    provider: started.provider,
    ...(started.model === undefined ? {} : { model: started.model }),
    ...(started.reasoningEffort === undefined ? {} : { reasoningEffort: started.reasoningEffort }),
  }
}

async function runTarget(services: EngineServices, request: RunRequest): Promise<RunResult> {
  return finishTarget(await startTarget(services, request))
}

/** One accepted/applied lesson section bound: the promise is 1200 characters. */
const MAX_LESSON_SECTION_CHARS = 1_200
const MAX_LESSONS_IN_PROMPT = 3

function lessonText(text: string): string {
  return text
    .replace(/\p{Cc}|\p{Zl}|\p{Zp}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LESSON_HEADING = '## Lessons from prior reviews'
const LESSON_JUDGMENT =
  'Treat these as advice from earlier reviews: apply judgment. They never change the P0/P1 rule, the review contract, or the approval gate.'

/** Bounded `## Lessons from prior reviews` lines, or none when nothing matches. */
function lessonSection(lessons: readonly Lesson[]): string[] {
  if (lessons.length === 0) return []
  // The 1200-character bound covers the whole section, heading and note included.
  const overhead = LESSON_HEADING.length + LESSON_JUDGMENT.length + 8
  const budget = MAX_LESSON_SECTION_CHARS - overhead
  const entries: string[] = []
  let used = 0
  for (const lesson of lessons.slice(0, MAX_LESSONS_IN_PROMPT)) {
    const entry = `- [${lesson.class}] ${lessonText(lesson.title)}\n  ${lessonText(lesson.body)}`
    const remaining = budget - used
    if (entry.length > remaining) {
      if (remaining < 20) break
      entries.push(`${entry.slice(0, remaining - 1)}…`)
      used = budget
      break
    }
    entries.push(entry)
    used += entry.length + 1
  }
  return ['', LESSON_HEADING, '', ...entries, '', LESSON_JUDGMENT]
}

/** Export for the prompt-budget tests; the engine is the only production caller. */
export function reviewPrompt(
  rule: RuleConfig,
  change: ChangeInfo,
  digest: string,
  task: TaskInfo | undefined,
  context: string | undefined,
  objective: string | undefined,
  snapshot = false,
  lessons: readonly Lesson[] = [],
): string {
  const lines = [
    instructionText(rule).trimEnd(),
    '',
    '## Delegated review',
    '',
    `- Rule: ${rule.id}`,
    `- Change: ${change.name}`,
    `- Scope: ${rule.scope ?? 'whole'}`,
  ]
  if (task !== undefined) lines.push(`- Task: ${task.number} ${task.text}`)
  lines.push(`- Review key: ${reviewKeyForPrompt(change.name, task, rule)}`)
  lines.push(`- Digest: ${digest}`)
  if (snapshot) {
    lines.push(
      '- Reviewed state: frozen worktree snapshot taken when the review started; later writes are not in it.',
    )
  }
  if (context !== undefined && context.trim() !== '')
    lines.push('', '## Context', '', context.trim())
  if (objective !== undefined && objective.trim() !== '')
    lines.push('', '## Objective', '', objective.trim())
  lines.push(...lessonSection(lessons))
  lines.push(
    '',
    'Return exactly one fenced JSON block whose `digest` is the value above, `verdict` is `PASS` or `FINDINGS`, and `findings` lists only P0/P1 items with `class`, title, evidence, and fix. Prose outside that block is ignored.',
  )
  return lines.join('\n')
}

function answerPrompt(
  rule: RuleConfig,
  change: ChangeInfo | undefined,
  context: string | undefined,
  objective: string | undefined,
): string {
  const lines = [instructionText(rule).trimEnd(), '', '## Delegated answer', '']
  if (change !== undefined) lines.push(`- Change: ${change.name}`)
  lines.push(`- Rule: ${rule.id}`)
  if (context !== undefined && context.trim() !== '')
    lines.push('', '## Context', '', context.trim())
  if (objective !== undefined && objective.trim() !== '')
    lines.push('', '## Objective', '', objective.trim())
  lines.push(
    '',
    'Answer within a bounded response. Name evidence and, for research, sources with dates. Do not modify files.',
  )
  return lines.join('\n')
}

function patchPrompt(rule: RuleConfig, context: string | undefined, objective: string): string {
  const lines = [
    instructionText(rule).trimEnd(),
    '',
    '## Isolated patch run',
    '',
    `- Rule: ${rule.id}`,
    `- Objective: ${objective}`,
  ]
  if (context !== undefined && context.trim() !== '')
    lines.push('', '## Context', '', context.trim())
  lines.push(
    '',
    'Work only inside this worktree. Run the relevant checks, report the root cause, changed files, commands, and results. Never touch the session worktree and never merge.',
  )
  return lines.join('\n')
}

function formatRecord(cwd: string, path: string, record: ReviewRecord, reused: boolean): string {
  const head = reused ? 'reused record' : 'wrote record'
  const findings = record.findings.map(
    (finding) =>
      `- ${finding.severity} ${finding.title}\n  class: ${normalizeFindingClass(finding.class)}\n  evidence: ${finding.evidence}\n  fix: ${finding.fix}`,
  )
  const lines = [
    `rule "${record.rule}" ${record.verdict} (${head} ${relativePath(cwd, path)})`,
    `change: ${record.change}`,
    `digest: ${record.digest}`,
  ]
  if (record.taskId !== undefined) lines.push(`task id: ${record.taskId}`)
  if (record.error !== undefined) lines.push(`error: ${record.error}`)
  lines.push(`target: ${targetLabelFromIdentity(record.target)}`)
  if (record.session !== undefined) lines.push(`session: ${record.session}`)
  lines.push('')
  lines.push(
    record.verdict === 'PASS'
      ? '0 P0/P1 findings. The gate accepts this record while its digest still matches.'
      : record.verdict === 'FINDINGS'
        ? `${record.findings.length} blocking finding(s):\n${findings.join('\n')}\n\nA FINDINGS record does not satisfy a strict gate; fix the findings and re-run the rule.`
        : 'The run failed and wrote an ERROR record. The gate accepts it with the failure visible; a later run retries after the cause is fixed.',
  )
  return lines.join('\n')
}

interface DelegateArguments {
  rule: string
  change?: string
  task?: string
  context?: string
  objective?: string
}

interface ToolAgentContext {
  agent?: Agent
  signal: AbortSignal
}

/** The engine behind the three tools: validation, target runs, records, status. */
class DelegationEngine {
  private readonly runs = new Map<string, ManagedRun>()
  private readonly recoveryPromises = new Map<string, Promise<void>>()
  private readonly queue: ReviewQueue<ManagedRun>

  constructor(
    private readonly config: EngineConfig,
    private readonly services: EngineServices,
  ) {
    this.queue = new ReviewQueue<ManagedRun>(config.reviewQueue, {
      start: (run) => this.startPreparedReview(run),
      persist: (run) => this.persistRun(run),
      fail: (run, error, failureClass) => this.failRun(run, error, run.prepared, failureClass),
      timeout: (run, info) => this.timeoutRun(run, info),
      settled: (run, state) => this.notifySettled(run, state),
      internalFault: async (run, message) => {
        run.file.failureClass = 'queue-internal-error'
        run.queueFaultDetail = `queue-internal-error: ${sanitizeText(message, MAX_ERROR_CHARS)}`
        await this.persistRun(run)
      },
      now: () => this.services.now(),
    })
  }

  private rule(ruleId: string): RuleConfig {
    const rule = this.config.rules.find((entry) => entry.id === ruleId)
    if (rule === undefined) {
      const ids = this.config.rules.map((entry) => entry.id)
      fail(`unknown rule "${ruleId}"; configured rules: ${ids.join(', ') || '(none configured)'}`)
    }
    return rule
  }

  private target(rule: RuleConfig): TargetConfig {
    const target = this.config.targets.get(rule.to ?? '')
    if (target === undefined) {
      fail(
        `rule "${rule.id}": target "${rule.to}" is not configured; add targets.${rule.to} or change the rule`,
      )
    }
    return target
  }

  private requireAgent(context: ToolAgentContext): Agent {
    if (context.agent === undefined) {
      fail('this tool needs a calling agent; run it from an agent turn, not a host startup')
    }
    return context.agent
  }

  private now(): string {
    return this.services.now().toISOString()
  }

  async runDelegate(args: DelegateArguments, context: ToolAgentContext): Promise<string> {
    const rule = this.rule(args.rule)
    if (rule.contract === 'note') {
      fail(
        `rule "${rule.id}" is the task-progress note; use task_progress(task, status, reason) instead of delegate`,
      )
    }
    if (args.task !== undefined && rule.contract !== 'review') {
      fail(
        `rule "${rule.id}" is a ${rule.contract} rule; task is only valid for a task-scoped review`,
      )
    }
    const agent = this.requireAgent(context)
    const cwd = this.services.workingDirectory.get(agent.session)
    const opened =
      rule.contract === 'review' || args.change !== undefined
        ? await openChange(cwd, args.change)
        : undefined
    const change = opened?.change
    const workspaceRoot = opened === undefined ? undefined : dirname(opened.openspecRoot)
    if (rule.contract === 'answer') {
      this.services.state.markConsulted(String(agent.id))
      const result = await runTarget(this.services, {
        rule,
        target: this.target(rule),
        prompt: answerPrompt(rule, change, args.context, args.objective),
        agent,
        cwd,
        signal: context.signal,
      })
      return `${result.text.slice(0, MAX_ANSWER_CHARS)}${result.text.length > MAX_ANSWER_CHARS ? '\n[answer truncated]' : ''}\n\n(no gate record: this answer does not satisfy a strict review rule)`
    }
    if (rule.contract === 'patch') {
      if (args.objective === undefined || args.objective.trim() === '') {
        fail(`rule "${rule.id}": a patch rule needs objective: to name the bug to fix`)
      }
      if (change !== undefined && workspaceRoot !== undefined) {
        await this.attributeChange(workspaceRoot, agent, change.name)
      }
      return this.runPatch(rule, args, agent, cwd, context.signal)
    }
    if (change === undefined || workspaceRoot === undefined) {
      fail(`rule "${rule.id}": a review needs an active OpenSpec change`)
    }
    if (rule.scope === 'whole' && !change.reviewReady) {
      fail(
        `change "${change.name}" is not review-ready; a whole-scope review needs proposal.md, design.md, tasks.md, and at least one specs/*/spec.md`,
      )
    }
    return this.startReview(rule, change, agent, cwd, workspaceRoot, args)
  }

  /** An explicit task_progress/review/patch call opts this session into the change. */
  private async attributeChange(
    workspaceRoot: string,
    agent: Agent,
    change: string,
    taskId?: string,
  ): Promise<void> {
    await withInvolvementLock(workspaceRoot, currentThread(agent), async () => {
      const { involvement } = await readInvolvement(workspaceRoot, currentThread(agent))
      const existed = involvement.changes[change] !== undefined
      const entry = involvementEntry(involvement, change)
      let changed = !existed
      if (taskId !== undefined && !entry.tasks.includes(taskId)) {
        entry.tasks.push(taskId)
        changed = true
      }
      if (changed) await writeInvolvement(workspaceRoot, involvement)
    })
  }

  private createRun(
    workspaceRoot: string,
    rule: RuleConfig,
    change: ChangeInfo,
    task: TaskInfo | undefined,
    agent: Agent,
    cwd: string,
    args: DelegateArguments,
  ): ManagedRun {
    const id = `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    const path = recordPath(cwd, rule, change.name, task?.id)
    const key = `${workspaceRoot}\u0000${reviewConversationKey(change.name, task, rule)}`
    const file: RunFile = {
      id,
      rule: rule.id,
      change: change.name,
      ...(task === undefined ? {} : { taskId: task.id }),
      key,
      // Replaced with the prepared digest/reviewer identity before admission.
      identity: `${workspaceRoot}\u0000pending\u0000${id}`,
      state: 'queued',
      record: relativePath(workspaceRoot, path),
      startedAt: this.now(),
    }
    return {
      file,
      workspaceRoot,
      recordPath: path,
      context: {
        rule,
        change,
        ...(task === undefined ? {} : { task }),
        agent,
        cwd,
        args,
        signal: new AbortController().signal,
      },
    }
  }

  /**
   * Validate, prepare, admit, and return the run handle without waiting for the
   * verdict. Preparation and cached-record reuse run before admission so a
   * cached verdict never consumes a queue slot.
   */
  private async startReview(
    rule: RuleConfig,
    change: ChangeInfo,
    agent: Agent,
    cwd: string,
    workspaceRoot: string,
    args: DelegateArguments,
  ): Promise<string> {
    await this.ensureRecovered(workspaceRoot)
    const tasks = await readTasks(change.dir)
    let task: TaskInfo | undefined
    if (args.task !== undefined) {
      if (rule.scope !== 'task') {
        fail(
          `rule "${rule.id}" reviews the whole scope; omit task (only a task-scoped review accepts one)`,
        )
      }
      task = resolveTaskArgument(change, tasks, args.task)
    } else if (rule.scope === 'task') {
      task = await this.nextTaskForReview(change, tasks, cwd)
    }
    // Explicit review: any session may run it; the call attributes the change,
    // and a task-scoped review also attributes the selected checked task.
    await this.attributeChange(workspaceRoot, agent, change.name, task?.id)

    const run = this.createRun(workspaceRoot, rule, change, task, agent, cwd, args)
    try {
      const reused = await this.prepareReviewRun(run)
      if (reused !== undefined) return reused
      const prepared = run.prepared
      if (prepared === undefined) fail(`run ${run.file.id} prepared no review inputs`)
      // Identity is computed only after preparation: a changed digest or
      // reviewer is a distinct run, never a join of the earlier handle.
      run.file.identity = `${workspaceRoot}\u0000${reviewIdentity(
        rule,
        change.name,
        task,
        prepared.digest,
        reviewerLabel(this.target(rule)),
      )}`
    } catch (error) {
      await this.failRun(run, error, run.prepared)
      throw error
    }
    this.runs.set(run.file.id, run)

    let admission: Admission<ManagedRun>
    try {
      this.services.queueFault?.()
    } catch (cause) {
      const internal = new QueueInternalError(
        `review queue internal error: ${errorMessage(cause)}`,
        cause,
      )
      return this.fallbackAfterQueueError(run, internal)
    }
    try {
      admission = await this.queue.submit(run)
    } catch (error) {
      if (!(error instanceof QueueInternalError)) throw error
      // Fallback: start directly once so a queue fault cannot trap the turn.
      return this.fallbackAfterQueueError(run, error)
    }
    if (admission.kind === 'duplicate') {
      await this.discardSnapshot(run)
      this.runs.delete(run.file.id)
      // A duplicate can join an in-flight start; wait it out so the handle
      // reports a settled admission state (running or queued), never starting.
      await this.queue.whenAdmitted(admission.run.file.id)
      return this.runHandleText(admission.run, 'duplicate')
    }
    if (admission.kind === 'accepted' && admission.phase !== 'running') {
      run.waitedInQueue = true
    }
    if (admission.kind === 'full') {
      const error = new DelegationError(
        `review queue full: ${admission.depth} waiting run(s) at maxQueued=${admission.maxQueued}; let the current reviews settle, then start this review again`,
      )
      await this.failRun(run, error, run.prepared, 'queue-full')
      throw error
    }
    if (admission.kind === 'settled') return this.runHandleText(run, 'settled')
    return this.runHandleText(run, admission.phase)
  }

  /** Re-read the selected task and refuse a task that is gone or unchecked. */
  private async validateSelectedTask(run: ManagedRun): Promise<void> {
    const tasks = await readTasks(run.context.change.dir)
    const task = run.context.task
    if (task === undefined) return
    const current = tasks.find((entry) => entry.id === task.id)
    if (current === undefined || !current.checked) {
      fail(
        `task "${task.number} ${task.text}" is no longer a checked task in change "${run.context.change.name}"; start a fresh review`,
      )
    }
    run.context.task = current
  }

  /**
   * Re-read the selected task, build the immutable digest/inputs, and reuse a
   * matching authoritative record. Returns the reused text when no target is
   * needed; the caller admits the run otherwise.
   */
  private async prepareReviewRun(run: ManagedRun): Promise<string | undefined> {
    await this.validateSelectedTask(run)
    const prepared = await this.prepareReview(run)
    run.prepared = prepared
    // This inspection decides cached reuse, not the publication baseline: a
    // queued run re-inspects when it becomes start-eligible.
    const existing = await inspectRecord(prepared.path)
    const reviewer = await readReviewerBinding(dirname(dirname(run.context.change.dir)))
    if (
      existing.kind === 'record' &&
      recordIdentifies(
        existing.record,
        run.context.rule,
        run.context.change.name,
        run.context.task?.id,
      )
    ) {
      const record = existing.record
      const reusable =
        record.verdict === 'PASS' ||
        (record.verdict === 'FINDINGS' && record.digest === prepared.digest)
      const current = run.context.rule.scope === 'task' ? true : record.digest === prepared.digest
      // A cached PASS from another reviewer is not reused: the marker binding
      // prescribes a fresh run of the configured reviewer instead. An
      // unreadable marker also forbids reuse until it is repaired.
      if (
        reusable &&
        current &&
        reviewer.error === undefined &&
        reviewerMatches(record.target, reviewer.reviewer)
      ) {
        await this.discardSnapshot(run)
        await this.markRun(run, 'completed', this.withFallbackDetail(prepared, 'reused record'))
        this.notifySettled(run, 'completed')
        return formatRecord(run.context.cwd, prepared.path, record, true)
      }
    }
    return undefined
  }

  /** Matching accepted/applied lessons; a broken learning store never fails a review. */
  private async reviewLessons(run: ManagedRun): Promise<Lesson[]> {
    if (!this.config.reviewLearning.enabled) return []
    try {
      const capabilities = await changeCapabilities(run.context.change.dir)
      const { lessons } = await readLessons(run.workspaceRoot)
      return matchingLessons(lessons, run.context.rule.id, capabilities)
    } catch {
      return []
    }
  }

  /** Start one admitted target; the queue owns the slot and settlement. */
  private async startPreparedReview(run: ManagedRun): Promise<void> {
    let prepared = run.prepared
    if (prepared === undefined) {
      fail(`run ${run.file.id} reached the queue without a prepared review; start the review again`)
    }
    if (run.baselineCaptured !== true) {
      // Start-eligible means the record's predecessor has settled: snapshot the
      // authoritative record now, but never again before a retry.
      const current = await inspectRecord(run.recordPath)
      run.existingFingerprint =
        current.kind === 'record' ? JSON.stringify(current.record) : undefined
      run.baselineCaptured = true
    }
    // Never retry into a run whose authoritative record changed while it
    // waited: the newer publication already decides this review.
    if (run.baselineCaptured === true) {
      const current = await inspectRecord(run.recordPath)
      const fingerprint = current.kind === 'record' ? JSON.stringify(current.record) : undefined
      if (
        current.kind === 'record' &&
        current.record.runId !== run.file.id &&
        fingerprint !== run.existingFingerprint
      ) {
        await this.markRun(
          run,
          'discarded',
          'a newer review record was published while this run waited; its completion is discarded',
        )
        await this.discardSnapshot(run)
        await this.settleReviewRun(run, 'discarded')
        return
      }
    }
    if (run.waitedInQueue === true && (await this.queuedInputsChanged(run))) {
      if (run.reprepared === true) {
        // The single re-preparation is spent: a later change must surface as a
        // terminal ERROR, never as a start on stale queued inputs.
        fail(
          'reviewed inputs changed again while the review waited in the queue; a review re-prepares only once — finish the writes and start a fresh review',
        )
      }
      // A queued run re-checks its source inputs before every attempt; a retry
      // after a rejected start must not begin on stale prepared inputs.
      await this.reprepareQueuedRun(run)
      // A collision settled this run as the duplicate; its successor proceeds.
      if (run.file.state === 'discarded' || run.file.state === 'failed') return
      prepared = run.prepared
      if (prepared === undefined) {
        fail(`run ${run.file.id} lost its prepared review after re-preparation`)
      }
    }
    const lessons = await this.reviewLessons(run)
    const started = await startTarget(this.services, {
      rule: run.context.rule,
      target: this.target(run.context.rule),
      prompt: reviewPrompt(
        run.context.rule,
        run.context.change,
        prepared.digest,
        run.context.task,
        run.context.args.context,
        run.context.args.objective,
        prepared.snapshotTree !== undefined,
        lessons,
      ),
      agent: run.context.agent,
      cwd: prepared.reviewCwd ?? run.context.cwd,
      signal: run.context.signal,
    })
    await this.markRun(
      run,
      'running',
      this.withQueueFault(
        run,
        this.withFallbackDetail(
          prepared,
          prepared.snapshotTree === undefined
            ? 'live worktree'
            : `snapshot ${prepared.snapshotTree.slice(0, 8)}`,
        ) ?? 'running',
      ),
    )
    void this.completeReviewRun(run, started, prepared)
  }

  /** Reserve fallback ownership, then start directly when it is safe. */
  private async fallbackAfterQueueError(run: ManagedRun, error: unknown): Promise<string> {
    if (this.queue.owns(run.file.id)) {
      // A start may already be in flight; never launch a second target.
      return this.runHandleText(run, 'running')
    }
    // Every fallback path, including a refused reservation, must carry the
    // gate-recognized queue-fault classification.
    run.file.failureClass = 'queue-internal-error'
    run.queueFaultDetail = `queue-internal-error: ${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)}`
    let reservation: Awaited<ReturnType<ReviewQueue<ManagedRun>['reserve']>>
    try {
      reservation = await this.queue.reserve(run)
    } catch (reserveError) {
      run.file.failureClass = 'queue-internal-error'
      await this.failRun(run, reserveError, run.prepared, 'queue-internal-error')
      throw reserveError
    }
    if (reservation.kind === 'duplicate') {
      await this.discardSnapshot(run)
      this.runs.delete(run.file.id)
      return this.runHandleText(reservation.run, 'duplicate')
    }
    if (reservation.kind === 'conflict') {
      const conflict = new QueueInternalError(
        'review queue internal error: another run for the same review conversation is already active; let it settle, then start this review again',
      )
      run.file.failureClass = 'queue-internal-error'
      if (reservation.run.recordPath === run.recordPath) {
        // Never publish to the incumbent's record path: report this run failed
        // without invalidating the active review's result.
        await this.markRun(run, 'failed', this.withQueueFault(run, conflict.message))
        await this.discardSnapshot(run)
        await this.settleReviewRun(run, 'failed')
      } else {
        // A different rule has its own record path; its ERROR is observable.
        await this.failRun(run, conflict, run.prepared, 'queue-internal-error')
      }
      throw conflict
    }
    run.fallback = true
    await this.startDirectFallback(run, error)
    return this.runHandleText(run, 'running')
  }

  /** Start prepared work directly once when the queue faults before admission. */
  private async startDirectFallback(run: ManagedRun, error: unknown): Promise<void> {
    run.file.failureClass = 'queue-internal-error'
    run.queueFaultDetail = `queue-internal-error: ${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)}`
    await this.markRun(run, 'running', run.queueFaultDetail)
    try {
      await this.startPreparedReview(run)
    } catch (startError) {
      run.file.failureClass = 'queue-internal-error'
      await this.failRun(run, startError, run.prepared, 'queue-internal-error')
      throw startError
    }
  }

  /** Keep the queue fault visible alongside a later fallback failure. */
  private withQueueFault(run: ManagedRun, detail: string): string {
    return run.queueFaultDetail === undefined ? detail : `${run.queueFaultDetail}; ${detail}`
  }

  /** Whether the live source inputs moved since this run was prepared. */
  private async queuedInputsChanged(run: ManagedRun): Promise<boolean> {
    const prepared = run.prepared
    if (prepared === undefined) return false
    const current = await reviewedInputs(
      run.context.cwd,
      run.context.rule,
      run.context.change,
      this.services,
      run.context.signal,
    )
    return signatureHash(current) !== prepared.queueSignature
  }

  /**
   * Rebuild the digest/snapshot for a queued run whose inputs moved. The
   * identity is replaced atomically; a collision settles this run as the
   * duplicate and the incumbent proceeds.
   */
  private async reprepareQueuedRun(run: ManagedRun): Promise<void> {
    await this.validateSelectedTask(run)
    await this.discardSnapshot(run)
    const next = await this.prepareReview(run)
    run.prepared = next
    const identity = `${run.workspaceRoot}\u0000${reviewIdentity(
      run.context.rule,
      run.context.change.name,
      run.context.task,
      next.digest,
      reviewerLabel(this.target(run.context.rule)),
    )}`
    const replaced = await this.queue.replaceIdentity(run, identity)
    if (!replaced.replaced) {
      await this.discardSnapshot(run)
      return
    }
    run.reprepared = true
    await this.markRun(run, 'starting', this.withFallbackDetail(next, 're-prepared while queued'))
  }

  private async prepareReview(run: ManagedRun): Promise<ReviewPreparation> {
    const { rule, change, cwd, signal } = run.context
    const path = recordPath(cwd, rule, change.name, run.context.task?.id)
    if (rule.scope === 'task') {
      const task = run.context.task
      if (task === undefined) fail(`rule "${rule.id}": a task-scoped review needs a task`)
      // Capture the source signature before the snapshot so a mutation during
      // snapshot creation can never be hidden behind a newer signature.
      const queueInputs = await reviewedInputs(cwd, rule, change, this.services, signal)
      let fallbackReason: string | undefined
      const snapshot = await createReviewSnapshot(
        cwd,
        change,
        run.file.id,
        this.services.git.runGit,
        signal,
        undefined,
        (reason) => {
          fallbackReason = reason
        },
      )
      if (snapshot !== undefined) {
        run.snapshot = snapshot
        const frozen = (await readTasks(snapshot.changeDir)).find((entry) => entry.id === task.id)
        if (frozen === undefined) {
          fail(
            `task "${task.number} ${task.text}" changed while the review snapshot was prepared in change "${change.name}"; re-run the review`,
          )
        }
        if (!frozen.checked) {
          fail(
            `task "${frozen.number} ${frozen.text}" is not checked in the frozen snapshot of change "${change.name}"; re-run the review`,
          )
        }
        // The source set was tracked before the snapshot so a queued run can
        // re-prepare when the live inputs moved while it waited.
        return {
          digest: hashParts([
            'task-review-v2',
            frozen.id,
            frozen.text,
            snapshot.specDigest,
            snapshot.tree,
          ]),
          worktreeDigest: hashParts(['task-review-snapshot-v1', snapshot.tree]),
          path,
          queueSignature: signatureHash(queueInputs),
          reviewCwd: snapshot.worktree,
          snapshotTree: snapshot.tree,
        }
      }
      // Fallback: review the live worktree under the mutation guard. Track the
      // inputs before hashing them, so a change between the two is caught.
      const signature = await reviewedInputs(cwd, rule, change, this.services, signal)
      const worktree = await worktreeDigest(cwd, this.services.git, signal)
      return {
        digest: hashParts([
          'task-review-v1',
          task.id,
          task.text,
          await specDigest(change.dir, signal),
          worktree,
        ]),
        worktreeDigest: worktree,
        path,
        signature,
        queueSignature: signatureHash(signature),
        fallbackReason,
      }
    }
    // Track the inputs before hashing them: any later mutation, including
    // edit-read-restore, invalidates the verdict via the completion check.
    const signature = await reviewedInputs(cwd, rule, change, this.services, signal)
    let digest: string
    let worktree: string | undefined
    if (rule.when === 'implementation-complete') {
      worktree = await worktreeDigest(cwd, this.services.git, signal)
      digest = worktree
    } else {
      digest = await specDigest(change.dir, signal)
    }
    return {
      digest,
      ...(worktree === undefined ? {} : { worktreeDigest: worktree }),
      path,
      signature,
      queueSignature: signatureHash(signature),
    }
  }

  /** Background completion: verdict + mutation guard + authoritative publish. */
  private async completeReviewRun(
    run: ManagedRun,
    started: StartedTarget,
    prepared: ReviewPreparation,
  ): Promise<void> {
    let outcome: SettledRunState = 'failed'
    let skipCleanup = false
    try {
      const result = await finishTarget(started)
      const parsed = parseVerdict(result.text, prepared.digest)
      if (prepared.signature !== undefined) {
        const current = await reviewedInputs(
          run.context.cwd,
          run.context.rule,
          run.context.change,
          this.services,
          run.context.signal,
        )
        const changed = changedInputPaths(prepared.signature, current)
        if (changed.length > 0) {
          const sample = changed.slice(0, 5).join(', ')
          throw new InputMutationError(
            `reviewed inputs changed during the run (${changed.length} changed: ${sample}${changed.length > 5 ? ', …' : ''}); a write inside the reviewed scope happened during the run — finish the writes, then re-run the review`,
          )
        }
      }
      const record = await this.publishRecord(run, {
        digest: prepared.digest,
        ...(prepared.worktreeDigest === undefined
          ? {}
          : { worktreeDigest: prepared.worktreeDigest }),
        verdict: parsed.verdict,
        findings: parsed.findings,
        target: targetIdentity(result.provider, result.model, result.reasoningEffort),
      })
      const historyDetail = await this.recordFindingHistory(run, record)
      const detail = [
        parsed.verdict === 'FINDINGS' ? `${parsed.findings.length} finding(s)` : undefined,
        historyDetail,
      ]
        .filter((part): part is string => part !== undefined)
        .join('; ')
      await this.markRun(
        run,
        'completed',
        this.withFallbackDetail(prepared, detail === '' ? undefined : detail),
      )
      outcome = 'completed'
    } catch (error) {
      if (error instanceof DiscardedRun) {
        await this.markRun(run, 'discarded', this.withFallbackDetail(prepared, error.message))
        outcome = 'discarded'
      } else {
        const failure = classifyFailure(error, 'run')
        const unconfirmed = error instanceof UnconfirmedTimeoutError
        const queued = this.queue.owns(run.file.id)
        run.file.failureClass =
          run.fallback === true ? 'queue-internal-error' : failure.failureClass
        if (unconfirmed) {
          // A possibly-still-running child owns its key, slot, and snapshot
          // until teardown is confirmed, regardless of publication outcome.
          let terminal: SettledRunState = 'failed'
          try {
            await this.publishRecord(run, {
              digest: prepared.digest,
              ...(prepared.worktreeDigest === undefined
                ? {}
                : { worktreeDigest: prepared.worktreeDigest }),
              verdict: 'ERROR',
              findings: [],
              target: targetIdentity(started.provider, started.model, started.reasoningEffort),
              error: sanitizeText(this.withQueueFault(run, errorMessage(error)), MAX_ERROR_CHARS),
            })
            await this.markRun(
              run,
              'failed',
              this.withQueueFault(
                run,
                this.withFallbackDetail(
                  prepared,
                  sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
                ) ?? '',
              ),
            )
          } catch (publishError) {
            if (publishError instanceof DiscardedRun) terminal = 'discarded'
            try {
              await this.markRun(
                run,
                publishError instanceof DiscardedRun ? 'discarded' : 'failed',
                this.withFallbackDetail(
                  prepared,
                  sanitizeText(
                    this.withQueueFault(run, errorMessage(publishError)),
                    MAX_ERROR_CHARS,
                  ),
                ),
              )
            } catch {
              // The run file is scratch; quarantine still protects the key.
            }
          }
          if (queued) {
            skipCleanup = true
            outcome = terminal
            this.queue.quarantine(
              run,
              async () => {
                await started.activation.dispose()
                await this.discardSnapshot(run)
              },
              terminal,
            )
            return
          }
        } else if (
          queued &&
          run.fallback !== true &&
          this.config.reviewQueue.enabled &&
          failure.transient &&
          this.queue.attemptsOf(run.file.id) < this.config.reviewQueue.maxAttempts
        ) {
          // A retry publishes no verdict and keeps its snapshot for the re-run.
          // Re-check the inputs before the next start, as for a queued run.
          run.waitedInQueue = true
          skipCleanup = true
          await this.queue.scheduleRetry(run, failure, error)
          return
        }
        try {
          await this.publishRecord(run, {
            digest: prepared.digest,
            ...(prepared.worktreeDigest === undefined
              ? {}
              : { worktreeDigest: prepared.worktreeDigest }),
            verdict: 'ERROR',
            findings: [],
            target: targetIdentity(started.provider, started.model, started.reasoningEffort),
            error: sanitizeText(this.withQueueFault(run, errorMessage(error)), MAX_ERROR_CHARS),
          })
          await this.markRun(
            run,
            'failed',
            this.withQueueFault(
              run,
              this.withFallbackDetail(
                prepared,
                sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
              ) ?? '',
            ),
          )
        } catch (publishError) {
          if (publishError instanceof DiscardedRun) {
            await this.markRun(
              run,
              'discarded',
              this.withFallbackDetail(prepared, publishError.message),
            )
            outcome = 'discarded'
          } else {
            await this.markRun(
              run,
              'failed',
              this.withFallbackDetail(
                prepared,
                sanitizeText(this.withQueueFault(run, errorMessage(publishError)), MAX_ERROR_CHARS),
              ),
            )
          }
        }
      }
    } finally {
      if (!skipCleanup) {
        await this.discardSnapshot(run)
        await this.settleReviewRun(run, outcome)
      }
    }
  }
  /** Write a record under the publish lock; a newer writer wins and this run is discarded. */
  private async publishRecord(run: ManagedRun, fields: PublishFields): Promise<ReviewRecord> {
    const release = await acquirePublishLock(run.recordPath)
    try {
      if (
        this.queue.owns(run.file.id) &&
        !this.queue.ownsIdentity(run.file.id, run.file.identity)
      ) {
        throw new DiscardedRun(
          'this run no longer owns the current review identity; its completion was discarded',
        )
      }
      const current = await inspectRecord(run.recordPath)
      if (current.kind === 'record' && current.record.runId !== run.file.id) {
        if (JSON.stringify(current.record) !== run.existingFingerprint) {
          throw new DiscardedRun(
            `a newer review record already exists at ${run.file.record}; this completion was discarded`,
          )
        }
      }
      const record: ReviewRecord = {
        rule: run.context.rule.id,
        change: run.context.change.name,
        phase: run.context.rule.phase ?? 'task',
        scope: run.context.rule.scope ?? 'whole',
        ...(run.context.task === undefined ? {} : { taskId: run.context.task.id }),
        digest: fields.digest,
        ...(fields.worktreeDigest === undefined ? {} : { worktreeDigest: fields.worktreeDigest }),
        verdict: fields.verdict,
        findings: fields.findings.map((finding) => ({
          ...finding,
          class: normalizeFindingClass(finding.class),
        })),
        target: fields.target,
        session: currentThread(run.context.agent),
        runId: run.file.id,
        time: this.now(),
        ...(fields.error === undefined ? {} : { error: fields.error }),
      }
      if (record.scope === 'task' && record.verdict === 'PASS' && record.taskId !== undefined) {
        // The portable approval is committed with the change; write it before
        // the local PASS so a failed write can never publish an approval.
        const path = portableTaskRecordPath(run.context.change.dir, record.taskId)
        const portable: PortableTaskReviewRecord = {
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
        try {
          await writeJsonAtomic(path, portable)
        } catch (error) {
          fail(
            `could not write the portable approval record at ${relativePath(run.context.cwd, path)}: ${errorMessage(error)}; no PASS record was published`,
          )
        }
      }
      await writeJsonAtomic(run.recordPath, record)
      try {
        this.services.onPublished?.(run.file.id, record)
      } catch {
        // The observer is a seam; it must not change publication.
      }
      return record
    } finally {
      await release()
    }
  }

  /**
   * Append one settled review's findings after its record is published. The
   * helper never throws; when neither the entry nor its gap marker is writable,
   * the run detail names the gap rather than changing any verdict.
   */
  private async recordFindingHistory(
    run: ManagedRun,
    record: ReviewRecord,
  ): Promise<string | undefined> {
    try {
      const result = await appendFindingHistory(
        run.workspaceRoot,
        {
          v: 1,
          kind: 'run',
          rule: record.rule,
          change: record.change,
          ...(record.taskId === undefined ? {} : { taskId: record.taskId }),
          verdict: record.verdict === 'FINDINGS' ? 'FINDINGS' : 'PASS',
          digest: record.digest,
          findings: record.findings.map((finding) => ({
            class: normalizeFindingClass(finding.class),
            title: finding.title,
            evidence: finding.evidence,
            fix: finding.fix,
          })),
          time: record.time,
        },
        { window: this.config.reviewLearning.window },
      )
      if (result.appended || result.gapAppended) return undefined
      return `history gap: ${result.detail ?? 'the finding history could not be written'}`
    } catch (error) {
      return `history gap: ${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)}`
    }
  }

  /** Best-effort failure path: write a visible ERROR record when inputs were prepared. */
  private async failRun(
    run: ManagedRun,
    error: unknown,
    prepared: ReviewPreparation | undefined,
    failureClass?: FailureClass,
  ): Promise<void> {
    if (failureClass !== undefined) run.file.failureClass = failureClass
    else if (!(error instanceof DiscardedRun)) {
      run.file.failureClass = classifyFailure(error, 'run').failureClass
    }
    let outcome: SettledRunState = 'failed'
    try {
      if (error instanceof DiscardedRun) {
        await this.markRun(run, 'discarded', this.withFallbackDetail(prepared, error.message))
        outcome = 'discarded'
      } else if (prepared !== undefined) {
        try {
          const target = this.config.targets.get(run.context.rule.to ?? '')
          await this.publishRecord(run, {
            digest: prepared.digest,
            ...(prepared.worktreeDigest === undefined
              ? {}
              : { worktreeDigest: prepared.worktreeDigest }),
            verdict: 'ERROR',
            findings: [],
            target:
              target === undefined
                ? { provider: run.context.rule.to ?? 'unknown' }
                : targetIdentity(
                    target.provider,
                    target.model ?? target.agentOptions?.model,
                    target.reasoningEffort ?? target.agentOptions?.reasoningEffort,
                  ),
            error: sanitizeText(this.withQueueFault(run, errorMessage(error)), MAX_ERROR_CHARS),
          })
          await this.markRun(
            run,
            'failed',
            this.withQueueFault(
              run,
              this.withFallbackDetail(
                prepared,
                sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
              ) ?? '',
            ),
          )
        } catch (publishError) {
          if (publishError instanceof DiscardedRun) {
            await this.markRun(
              run,
              'discarded',
              this.withFallbackDetail(prepared, publishError.message),
            )
            outcome = 'discarded'
          } else {
            await this.markRun(
              run,
              'failed',
              this.withFallbackDetail(
                prepared,
                sanitizeText(this.withQueueFault(run, errorMessage(publishError)), MAX_ERROR_CHARS),
              ),
            )
          }
        }
      } else {
        await this.markRun(
          run,
          'failed',
          this.withQueueFault(
            run,
            this.withFallbackDetail(prepared, sanitizeText(errorMessage(error), MAX_ERROR_CHARS)) ??
              '',
          ),
        )
      }
    } finally {
      await this.discardSnapshot(run)
      await this.settleReviewRun(run, outcome)
    }
  }

  /** Write the terminal wait-timeout ERROR; the queue finishes the run after this. */
  private async timeoutRun(run: ManagedRun, info: QueueTimeoutInfo): Promise<void> {
    const prepared = run.prepared
    const position = info.position === undefined ? '' : ` at position ${info.position}`
    const message = `review queue wait timed out after ${info.waitMs} ms${position}; no target started. Shorten the running reviews or start this review again after the queue drains`
    run.file.waitMs = info.waitMs
    if (run.file.attempts === undefined) run.file.attempts = 0
    // A newer publication during the wait decides this review; report the
    // discard instead of a timeout that would hide the authoritative record.
    const current = await inspectRecord(run.recordPath)
    const fingerprint = current.kind === 'record' ? JSON.stringify(current.record) : undefined
    if (
      current.kind === 'record' &&
      current.record.runId !== run.file.id &&
      fingerprint !== run.existingFingerprint
    ) {
      await this.markRun(
        run,
        'discarded',
        'a newer review record was published while this run waited; its completion is discarded',
      )
      await this.discardSnapshot(run)
      await this.settleReviewRun(run, 'discarded')
      return
    }
    if (prepared !== undefined) {
      try {
        const target = this.config.targets.get(run.context.rule.to ?? '')
        await this.publishRecord(run, {
          digest: prepared.digest,
          ...(prepared.worktreeDigest === undefined
            ? {}
            : { worktreeDigest: prepared.worktreeDigest }),
          verdict: 'ERROR',
          findings: [],
          target:
            target === undefined
              ? { provider: run.context.rule.to ?? 'unknown' }
              : targetIdentity(
                  target.provider,
                  target.model ?? target.agentOptions?.model,
                  target.reasoningEffort ?? target.agentOptions?.reasoningEffort,
                ),
          error: sanitizeText(message, MAX_ERROR_CHARS),
        })
      } catch (publishError) {
        if (publishError instanceof DiscardedRun) {
          await this.markRun(
            run,
            'discarded',
            'a newer review record was published while this run waited; its completion is discarded',
          )
          await this.discardSnapshot(run)
          await this.settleReviewRun(run, 'discarded')
          return
        }
        // A record write failure must not keep a timed-out run queued.
      }
    }
    run.file.failureClass = 'queue-timeout'
    await this.markRun(run, 'failed', this.withFallbackDetail(prepared, message))
    await this.discardSnapshot(run)
  }

  /** Persist the current run-file state without a state transition. */
  private async persistRun(run: ManagedRun): Promise<void> {
    try {
      await writeJsonAtomic(runFilePath(run.workspaceRoot, run.file.id), run.file)
    } catch {
      // Run state is local scratch; a write failure must not break the background run.
    }
  }

  /** Terminal cleanup and the single settlement observation for this run. */
  private async settleReviewRun(run: ManagedRun, state: SettledRunState): Promise<void> {
    if (this.queue.owns(run.file.id)) {
      await this.queue.complete(run, state)
      return
    }
    this.notifySettled(run, state)
  }

  private notifySettled(run: ManagedRun, state: SettledRunState): void {
    this.runs.delete(run.file.id)
    try {
      this.services.onRunSettled?.(run.file.id, state)
    } catch {
      // The observer is a test seam; it must not change run cleanup.
    }
  }

  /** Remove one finished run's disposable checkout; never changes the verdict. */
  private async discardSnapshot(run: ManagedRun): Promise<void> {
    if (run.snapshot === undefined) return
    run.snapshot = undefined
    await discardReviewSnapshot(run.context.cwd, run.file.id, this.services.git.runGit)
  }

  /**
   * Keep the live-fallback cause visible after the run settles: the completion
   * detail replaces the running detail, so append the cause to the verdict/error.
   */
  private withFallbackDetail(
    prepared: ReviewPreparation | undefined,
    detail: string | undefined,
  ): string | undefined {
    const reason = prepared?.fallbackReason
    if (reason === undefined) return detail
    const live = `live worktree: ${reason}`
    if (detail === undefined || detail === 'live worktree') return live
    return `${detail}; ${live}`
  }

  private async markRun(run: ManagedRun, state: RunState, detail?: string): Promise<void> {
    run.file.state = state
    if (detail === undefined) delete run.file.detail
    else run.file.detail = detail
    try {
      await writeJsonAtomic(runFilePath(run.workspaceRoot, run.file.id), run.file)
    } catch {
      // Run state is local scratch; a write failure must not break the background run.
    }
  }

  /** Reconcile crashed run files from the authoritative records once per workspace. */
  async recoverWorkspace(workspaceRoot: string): Promise<void> {
    await this.ensureRecovered(workspaceRoot)
  }

  /** Every caller waits for the same reconciliation before admitting new runs. */
  private async ensureRecovered(workspaceRoot: string): Promise<void> {
    const existing = this.recoveryPromises.get(workspaceRoot)
    if (existing !== undefined) return existing
    const recovery = this.recoverOnce(workspaceRoot)
    this.recoveryPromises.set(workspaceRoot, recovery)
    try {
      await recovery
    } catch {
      this.recoveryPromises.delete(workspaceRoot)
    }
  }

  private async recoverOnce(workspaceRoot: string): Promise<void> {
    await this.services.recoverDelay?.()
    for (const run of await listAllRunFiles(workspaceRoot)) {
      if (!isActiveRunState(run.state)) continue
      const current = await inspectRecord(join(workspaceRoot, run.record))
      if (current.kind === 'record' && current.record.runId === run.id) {
        run.state = current.record.verdict === 'ERROR' ? 'failed' : 'completed'
        run.detail = `recovered from the published ${current.record.verdict} record`
      } else if (current.kind === 'record') {
        // A record older than this run means the run is a rerun that crashed
        // before publishing; only a newer publication supersedes it.
        const publishedAt = Date.parse(current.record.time)
        const startedAt = Date.parse(run.startedAt)
        const superseded =
          Number.isFinite(publishedAt) && Number.isFinite(startedAt) && publishedAt >= startedAt
        run.state = superseded ? 'discarded' : 'interrupted'
        run.detail = superseded
          ? 'recovered: a newer review run holds the record'
          : 'recovered after restart without an authoritative record; run a fresh review'
      } else {
        run.state = 'interrupted'
        run.detail = 'recovered after restart without an authoritative record; run a fresh review'
      }
      try {
        await writeJsonAtomic(runFilePath(workspaceRoot, run.id), run)
      } catch {
        // Run state is scratch; recovery must not fail the caller.
      }
    }
  }

  /** Bounded queue facts; never a path, credential, or provider message. */
  private runFacts(file: RunFile): string {
    const facts: string[] = []
    if (file.queuePosition !== undefined) facts.push(`position=${file.queuePosition}`)
    if (file.queuedAt !== undefined) facts.push(`queuedAt=${file.queuedAt}`)
    const waitMs = file.waitMs ?? this.elapsedWaitMs(file)
    if (waitMs !== undefined) facts.push(`waitMs=${waitMs}`)
    if (file.attempts !== undefined) facts.push(`attempts=${file.attempts}`)
    if (file.lastRetryAt !== undefined) facts.push(`lastRetryAt=${file.lastRetryAt}`)
    if (file.failureClass !== undefined) facts.push(`failureClass=${file.failureClass}`)
    return facts.length === 0 ? '' : ` ${facts.join(' ')}`
  }

  /** Elapsed wait for a still-queued run; bounded to 30 days. */
  private elapsedWaitMs(file: RunFile): number | undefined {
    if (file.state !== 'queued' || file.queuedAt === undefined) return undefined
    const queuedAt = Date.parse(file.queuedAt)
    if (!Number.isFinite(queuedAt)) return undefined
    return Math.min(2_592_000_000, Math.max(0, this.services.now().getTime() - queuedAt))
  }

  private runHandleText(
    run: ManagedRun,
    mode: 'running' | 'queued' | 'retry-wait' | 'settled' | 'duplicate',
  ): string {
    const label =
      mode === 'duplicate'
        ? 'already pending'
        : mode === 'queued'
          ? 'queued'
          : mode === 'retry-wait'
            ? 'retrying'
            : mode === 'settled'
              ? 'finished'
              : 'started'
    const lines = [
      `rule "${run.file.rule}" review ${label}`,
      `run: ${run.file.id}`,
      `state: ${run.file.state}`,
      `change: ${run.file.change}`,
    ]
    if (run.file.taskId !== undefined) lines.push(`task id: ${run.file.taskId}`)
    lines.push(`record: ${run.file.record}`)
    if (run.file.queuePosition !== undefined) {
      lines.push(`queue position: ${run.file.queuePosition}`)
    }
    if (run.file.waitMs !== undefined) lines.push(`queue wait: ${run.file.waitMs} ms`)
    if (mode === 'retry-wait') {
      if (run.file.attempts !== undefined) lines.push(`attempt: ${run.file.attempts}`)
      if (run.file.failureClass !== undefined) lines.push(`failure class: ${run.file.failureClass}`)
      if (run.file.lastRetryAt !== undefined) lines.push(`last retry: ${run.file.lastRetryAt}`)
    }
    lines.push(
      '',
      mode === 'duplicate'
        ? 'Returned the existing run; no second target was started. The turn can continue.'
        : 'The run continues in the background; the turn can continue. Poll delegation_status or read the record path when it completes.',
    )
    return lines.join('\n')
  }

  /** Active run for one identity, used by the gate to avoid duplicate steers. */
  pendingReview(
    workspaceRoot: string,
    ruleId: string,
    change: string,
    taskId?: string,
  ): PendingReviewView | undefined {
    for (const run of this.runs.values()) {
      if (
        run.workspaceRoot !== workspaceRoot ||
        run.file.rule !== ruleId ||
        run.file.change !== change ||
        (run.context.task?.id ?? undefined) !== taskId
      ) {
        continue
      }
      if (
        run.file.state === 'queued' ||
        run.file.state === 'starting' ||
        run.file.state === 'running' ||
        run.file.state === 'retry-wait'
      ) {
        return { id: run.file.id, state: run.file.state, record: run.file.record }
      }
    }
    return undefined
  }

  private async nextTaskForReview(
    change: ChangeInfo,
    tasks: TaskInfo[],
    cwd: string,
  ): Promise<TaskInfo> {
    const checked = tasks.filter((task) => task.checked)
    if (checked.length === 0) {
      fail(
        `change "${change.name}" has no checked task; tick the completed task in tasks.md, then run its review`,
      )
    }
    for (const task of checked) {
      if (!(await this.taskHasReview(change, cwd, task.id))) return task
    }
    // Every checked task is already reviewed: return the last one so the caller
    // reuses its matching PASS/ERROR record instead of running the target again.
    return checked[checked.length - 1] as TaskInfo
  }

  private taskReviewRules(): RuleConfig[] {
    return this.config.rules.filter(
      (rule) =>
        rule.when === 'spec-task-ready' && rule.contract === 'review' && rule.scope === 'task',
    )
  }

  private async taskHasReview(change: ChangeInfo, cwd: string, taskId: string): Promise<boolean> {
    // A record from another reviewer is not a review: task selection must pick
    // this task so the delegate call starts the configured reviewer. An
    // unreadable marker cannot prove any record, so the task reads unreviewed.
    const reviewer = await readReviewerBinding(dirname(dirname(change.dir)))
    if (reviewer.error !== undefined) return false
    for (const rule of this.taskReviewRules()) {
      const state = await inspectRecord(recordPath(cwd, rule, change.name, taskId))
      if (
        state.kind === 'record' &&
        reviewerMatches(state.record.target, reviewer.reviewer) &&
        recordSatisfies(state, change.name, 'task', undefined, taskId)
      ) {
        return true
      }
    }
    return false
  }

  /** PASS-only approval over every checked task, independent of session attribution. */
  private async changeApproval(
    change: ChangeInfo,
    openspecRoot: string,
    tasks: TaskInfo[],
  ): Promise<{ coverage: ApprovalCoverage } | { error: string }> {
    return changeApproval(this.config, change, openspecRoot, tasks)
  }

  private async runPatch(
    rule: RuleConfig,
    args: DelegateArguments,
    agent: Agent,
    cwd: string,
    signal: AbortSignal,
  ): Promise<string> {
    const target = this.target(rule)
    if (target.write !== true) {
      fail(
        `rule "${rule.id}": target "${rule.to}" is not declared write-capable; a patch rule never silently escalates`,
      )
    }
    const runId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
    const worktree = join(cwd, DELEGATION_DIR, 'worktrees', runId)
    await this.services.git.runGit(['worktree', 'add', '--detach', worktree, 'HEAD'], cwd, signal)
    const result = await runTarget(this.services, {
      rule,
      target,
      prompt: patchPrompt(rule, args.context, args.objective ?? ''),
      agent,
      cwd: worktree,
      signal,
    })
    const status = (
      await this.services.git.runGit(['-C', worktree, 'status', '--porcelain=v1'], cwd, signal)
    )
      .toString('utf8')
      .trim()
    let diff = ''
    try {
      diff = (
        await this.services.git.runGit(['-C', worktree, 'diff', '--binary', 'HEAD'], cwd, signal)
      )
        .toString('utf8')
        .trim()
    } catch {
      diff = '[diff unavailable]'
    }
    const changed = status === '' ? '(no changed files reported)' : status
    return [
      `patch "${rule.id}" completed in isolated worktree ${relativePath(cwd, worktree)}`,
      '',
      'Changed files:',
      changed,
      '',
      `Diff${diff.length > 40_000 ? ' (truncated)' : ''}:`,
      diff.length === 0 ? '(empty)' : diff.slice(0, 40_000),
      '',
      'Target report:',
      result.text.slice(0, MAX_ANSWER_CHARS),
      '',
      'Nothing was applied to the session worktree. Review the diff and merge manually.',
    ].join('\n')
  }

  async taskProgress(
    args: { task: string; status: ProgressStatus; reason: string },
    context: ToolAgentContext,
  ): Promise<string> {
    const agent = this.requireAgent(context)
    const cwd = this.services.workingDirectory.get(agent.session)
    const openspecRoot = await findOpenSpecRoot(cwd)
    if (openspecRoot === undefined) {
      fail(
        'no openspec/changes directory was found from the session working directory; task progress notes belong to an OpenSpec change',
      )
    }
    const workspaceRoot = dirname(openspecRoot)
    const wanted = args.task.trim()
    if (wanted === '') fail('task_progress needs task: the task text from tasks.md (or a task id)')
    const matches: Array<{ change: ChangeInfo; task: TaskInfo }> = []
    for (const change of await listActiveChanges(openspecRoot)) {
      let tasks: TaskInfo[]
      try {
        tasks = await readTasks(change.dir)
      } catch {
        // An unrelated change with no readable tasks.md must not block this note.
        continue
      }
      for (const task of tasks) {
        const fullText = normalizeTaskText(`${task.number} ${task.text}`)
        if (
          task.id === wanted ||
          normalizeTaskText(task.text) === normalizeTaskText(wanted) ||
          fullText === normalizeTaskText(wanted)
        ) {
          matches.push({ change, task })
        }
      }
    }
    if (matches.length === 0) {
      fail(
        'task_progress: the task was not found in any active change; pass the full task text from tasks.md or its 16-character task id',
      )
    }
    if (matches.length > 1) {
      const changes = [...new Set(matches.map((match) => match.change.name))]
      fail(
        `task_progress: the task text matches more than one active change (${changes.join(', ')}); tick or note the task only in the change you are implementing`,
      )
    }
    const match = matches[0] as { change: ChangeInfo; task: TaskInfo }
    if (match.task.checked) {
      fail(
        `task_progress: task "${match.task.number} ${match.task.text}" is checked; a completed task needs its task-review PASS/ERROR, not a progress note`,
      )
    }
    // An explicit note opts this session into the change; it is valid in any session.
    await this.attributeChange(workspaceRoot, agent, match.change.name)
    const digest = await worktreeDigest(cwd, this.services.git, context.signal)
    const note: ProgressNote = {
      taskId: match.task.id,
      status: args.status,
      reason: sanitizeText(args.reason.trim() === '' ? args.status : args.reason, MAX_REASON_CHARS),
      worktreeDigest: digest,
      time: this.now(),
    }
    const path = notePath(cwd, match.change.name)
    await writeJsonAtomic(path, note)
    // The note is this session's serial decision for its lane; it stays decided
    // after later worktree changes, unlike the note's digest.
    const lanes = await readTaskLanes(match.change.dir)
    const lane = laneOfTask(lanes, match.task.id)
    if (lane !== undefined && lane.title !== '') {
      this.services.state.markLaneSerial(String(agent.id), match.change.name, lane.title)
    }
    return [
      `progress note written for change "${match.change.name}" (${relativePath(cwd, path)})`,
      `task: ${match.task.number} ${match.task.text}`,
      `task id: ${note.taskId}`,
      `status: ${note.status}`,
      `worktree digest: ${digest}`,
      '',
      'No model was run. This note lets a code-changing turn close only while the worktree matches that digest; after any further change it is stale, and the next turn must refresh it or tick the task and run its task review.',
    ].join('\n')
  }

  async delegationStatus(context: ToolAgentContext): Promise<string> {
    const agent = this.requireAgent(context)
    const cwd = this.services.workingDirectory.get(agent.session)
    const thread = currentThread(agent)
    const providers = this.services.subagents.list()
    const lines: string[] = ['Delegation status', '', 'Registered subagent providers:']
    if (providers.length === 0) lines.push('- (none)')
    for (const providerName of providers) {
      const provider = this.services.subagents.getProvider(providerName)
      if (provider === undefined) continue
      const capabilities = provider.capabilities
      const flags = [
        capabilities.agentOptions ? 'agentOptions' : '',
        capabilities.outputSchema ? 'outputSchema' : '',
        capabilities.depthLimit ? 'depthLimit' : '',
        capabilities.agentPreset ? 'agentPreset' : '',
      ].filter((flag) => flag !== '')
      lines.push(
        `- ${provider.name}: ${flags.join(', ') || 'no optional capabilities'}; inheritsParentContext=${provider.inheritsParentContext}`,
      )
    }
    lines.push('', 'Configured targets:')
    if (this.config.targets.size === 0) lines.push('- (none configured)')
    for (const [id, target] of this.config.targets) {
      const provider = this.services.subagents.getProvider(target.provider)
      const availability =
        provider === undefined
          ? `MISSING provider "${target.provider}" (install/enable it, or repoint targets.${id})`
          : 'available'
      const options = resolveAgentOptions(target)
      const model = options?.model
      const effort = options?.reasoningEffort
      const capabilityProblem =
        options !== undefined &&
        provider !== undefined &&
        provider.capabilities.agentOptions !== true
          ? '; provider does not support model/reasoningEffort/agentOptions'
          : ''
      lines.push(
        `- ${id}: provider=${target.provider}${model === undefined ? '' : ` model=${model}`}${effort === undefined ? '' : ` reasoningEffort=${effort}`}${target.write === true ? ' write=true' : ''} (${availability}${capabilityProblem})`,
      )
    }
    lines.push('', 'Configured rules:')
    if (this.config.rules.length === 0) lines.push('- (none configured; delegate reports no rules)')
    for (const rule of this.config.rules) {
      lines.push(
        `- ${rule.id}: when=${rule.when} contract=${rule.contract} gate=${rule.gate}${rule.to === undefined ? '' : ` to=${rule.to}`}${rule.scope === undefined ? '' : ` scope=${rule.scope}`}${rule.phase === undefined ? '' : ` phase=${rule.phase}`}`,
      )
    }
    const openspecRoot = await findOpenSpecRoot(cwd)
    lines.push('', 'OpenSpec changes and records:')
    if (openspecRoot === undefined) {
      lines.push('- no openspec/changes directory was found from the session working directory')
    } else {
      const changes = await listActiveChanges(openspecRoot)
      if (changes.length === 0) lines.push('- no active change')
      const workspaceRoot = dirname(openspecRoot)
      await this.ensureRecovered(workspaceRoot)
      const involvementRead = await readInvolvement(workspaceRoot, thread)
      if (involvementRead.warning !== undefined) {
        lines.push(`- session involvement: ${involvementRead.warning}`)
      }
      for (const change of changes) {
        const entry = involvementRead.involvement.changes[change.name]
        lines.push(`- ${change.name} (${change.reviewReady ? 'review-ready' : 'not review-ready'})`)
        let tasks: TaskInfo[] | undefined
        try {
          tasks = await readTasks(change.dir)
        } catch (error) {
          lines.push(`  tasks: unreadable (${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)})`)
        }
        const attributedChecked =
          entry === undefined
            ? 0
            : tasks === undefined
              ? entry.tasks.length
              : tasks.filter((task) => task.checked && entry.tasks.includes(task.id)).length
        lines.push(
          `  this session: ${entry === undefined ? 'not involved' : involvementSummary(entry, attributedChecked)}`,
        )
        if (tasks === undefined) continue
        const checked = tasks.filter((task) => task.checked)
        lines.push(`  tasks: ${checked.length}/${tasks.length} checked`)
        for (const rule of this.config.rules) {
          if (rule.contract !== 'review') continue
          if (rule.scope === 'task') continue
          if (rule.phase === undefined) continue
          const path = recordPath(cwd, rule, change.name)
          const state = await inspectRecord(path)
          let detail: string
          if (state.kind === 'missing') detail = 'missing'
          else if (state.kind === 'malformed') detail = `malformed (${state.error})`
          else {
            const fresh =
              rule.when === 'implementation-complete'
                ? await this.recordMatchesCurrentWorktree(cwd, state.record, context.signal)
                : (await specDigest(change.dir, context.signal)) === state.record.digest
            detail = `${state.record.verdict} (${fresh ? 'matching current digest' : 'stale'})`
          }
          lines.push(`  ${rule.id}: ${detail} at ${relativePath(cwd, path)}`)
        }
        const reviewer = await readReviewerBinding(dirname(dirname(change.dir)))
        if (reviewer.error !== undefined) {
          lines.push(
            `  approval marker: unreadable (${sanitizeText(reviewer.error, MAX_ERROR_CHARS)})`,
          )
        }
        for (const rule of this.taskReviewRules()) {
          const reviewed = new Set<string>()
          for (const task of checked) {
            const path = recordPath(cwd, rule, change.name, task.id)
            const state = await inspectRecord(path)
            if (
              reviewer.error === undefined &&
              state.kind === 'record' &&
              reviewerMatches(state.record.target, reviewer.reviewer) &&
              (state.record.verdict === 'PASS' || state.record.verdict === 'ERROR')
            ) {
              reviewed.add(task.id)
            }
          }
          lines.push(
            `  ${rule.id}: ${reviewed.size}/${checked.length} checked task(s) with a PASS/ERROR record`,
          )
        }
        const approval = await this.changeApproval(change, openspecRoot, tasks)
        if ('error' in approval) {
          lines.push(
            `  task approval: unavailable (${sanitizeText(approval.error, MAX_ERROR_CHARS)})`,
          )
        } else {
          const coverage = approval.coverage
          lines.push(`  task approval: ${approvalSummaryLine(coverage)}`)
          for (const gap of formatApprovalGapLines(coverage)) lines.push(`  ${gap}`)
        }
        const note = await inspectNote(cwd, change.name)
        if (note.kind === 'note') {
          let digest: string | undefined
          try {
            digest = await worktreeDigest(cwd, this.services.git, context.signal)
          } catch {
            digest = undefined
          }
          const task = tasks.find((entry) => entry.id === note.note.taskId)
          const fresh = digest !== undefined && digest === note.note.worktreeDigest
          const completed = task === undefined || task.checked
          lines.push(
            `  progress note: ${note.note.status}${task === undefined ? ' (task not found)' : ` for "${task.text}"`} - ${fresh && !completed ? 'active' : fresh ? 'stale (task completed)' : 'stale (worktree changed)'} at ${relativePath(cwd, notePath(cwd, change.name))}`,
          )
        } else if (note.kind === 'malformed') {
          lines.push(
            `  progress note: malformed at ${relativePath(cwd, notePath(cwd, change.name))}`,
          )
        } else {
          lines.push('  progress note: none')
        }
      }
      const queue = this.queue.summary()
      lines.push(
        '',
        `Review queue: enabled=${queue.enabled} concurrency=${queue.concurrency} active=${queue.active} queued=${queue.queued} depth=${queue.active + queue.queued}`,
      )
      const runs = await listRunFiles(workspaceRoot)
      lines.push('', 'Review runs:')
      if (runs.length === 0) lines.push('- none')
      for (const run of runs) {
        lines.push(
          `- run ${run.id}: rule=${run.rule} change=${run.change}${run.taskId === undefined ? '' : ` task=${run.taskId}`} state=${run.state} record=${run.record}${this.runFacts(run)}${run.detail === undefined ? '' : ` detail="${run.detail}"`}`,
        )
      }
    }
    return lines.join('\n')
  }

  private async recordMatchesCurrentWorktree(
    cwd: string,
    record: ReviewRecord,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      return (await worktreeDigest(cwd, this.services.git, signal)) === record.digest
    } catch {
      return false
    }
  }
}

interface GateIssue {
  ruleId: string
  text: string
  call: string
  soft: boolean
}

interface GateDeps {
  config: EngineConfig
  state: DelegationState
  services: EngineServices
  /** Visible worker-start tools for one agent; undefined keeps the lane gate enabled. */
  workerToolVisible?: (agent: Agent) => boolean | undefined
  /** Once-per-workspace durable-run reconciliation, run before gate evaluation. */
  recover?: (workspaceRoot: string) => Promise<void>
}

/** Per-turn steering once for a soft issue, keyed by rule/digest/task. */
function softIssue(
  deps: GateDeps,
  agentId: string,
  key: string,
  ruleId: string,
  text: string,
  call: string,
): GateIssue | undefined {
  if (deps.state.wasSteered(agentId, key)) return undefined
  deps.state.markSteered(agentId, key)
  return { ruleId, text, call, soft: true }
}

/** Group a change's task plan into lanes; an unreadable plan fails open. */
async function readTaskLanes(changeDir: string): Promise<TaskLane[]> {
  try {
    return parseTaskLanes(await readFile(join(changeDir, 'tasks.md'), 'utf8'))
  } catch {
    return []
  }
}

/**
 * Like {@link readTaskLanes}, but distinguishes an unreadable plan (undefined)
 * from a readable plan with no headings or tasks (an empty lane list).
 */
async function readTaskLanesOrUndefined(changeDir: string): Promise<TaskLane[] | undefined> {
  try {
    return parseTaskLanes(await readFile(join(changeDir, 'tasks.md'), 'utf8'))
  } catch {
    return undefined
  }
}

/** One checkpoint lane as the delegation gate reads it; every field is untrusted input. */
interface CheckpointLane {
  owner: string
  scope: string[]
}

interface CheckpointPlan {
  outcome: 'continue' | 'done'
  lanes: CheckpointLane[]
  bottleneck?: { id?: string; action: string; targets: string[] }
}

/**
 * Parse one successful `work_checkpoint` argument tree. Any unexpected shape is
 * unreadable and therefore fails open, so the consistency check never blocks on
 * evidence it cannot interpret.
 */
function checkpointPlanOf(argumentsValue: unknown): CheckpointPlan | undefined {
  if (!isRecord(argumentsValue)) return undefined
  const outcome = argumentsValue.outcome
  if (outcome !== 'continue' && outcome !== 'done') return undefined
  if (!Array.isArray(argumentsValue.lanes)) return undefined
  const lanes: CheckpointLane[] = []
  for (const value of argumentsValue.lanes) {
    if (!isRecord(value) || typeof value.owner !== 'string') return undefined
    if (!Array.isArray(value.scope) || !value.scope.every((entry) => typeof entry === 'string')) {
      return undefined
    }
    lanes.push({ owner: value.owner, scope: value.scope })
  }
  const raw = argumentsValue.bottleneck
  let bottleneck: CheckpointPlan['bottleneck']
  if (raw !== undefined) {
    if (!isRecord(raw) || typeof raw.action !== 'string') return undefined
    if (raw.id !== undefined && typeof raw.id !== 'string') return undefined
    if (
      raw.targets !== undefined &&
      (!Array.isArray(raw.targets) || !raw.targets.every((entry) => typeof entry === 'string'))
    ) {
      return undefined
    }
    bottleneck = {
      ...(typeof raw.id === 'string' ? { id: raw.id } : {}),
      action: raw.action,
      targets: Array.isArray(raw.targets) ? raw.targets : [],
    }
  }
  return { outcome, lanes, ...(bottleneck === undefined ? {} : { bottleneck }) }
}

/**
 * Normalize a plan path against one base: dot segments and a relative/absolute
 * spelling collapse to one comparable path, a trailing `/**` names the
 * directory it covers, and Windows compares case-insensitively.
 */
function planPath(value: string, base: string): string {
  const trimmed = value
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/\*\*$/u, '')
    .replace(/\/+$/u, '')
  if (trimmed === '') return ''
  const absolute = resolve(base, trimmed).replaceAll('\\', '/')
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/** Equal paths, or one path lies inside the other, each side against its own base. */
function pathsOverlap(left: string, right: string, leftBase: string, rightBase: string): boolean {
  const a = planPath(left, leftBase)
  const b = planPath(right, rightBase)
  if (a === '' || b === '') return false
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/**
 * A checkpoint lane covers a task lane when a scoped path touches an owned
 * path. Task-owned paths are repository-relative; checkpoint scopes follow the
 * goal-continuity contract and resolve against the session working directory.
 */
function checkpointCovers(
  entry: CheckpointLane,
  lane: TaskLane,
  workspace: string,
  cwd: string,
): boolean {
  return lane.owns.some((own) =>
    entry.scope.some((scope) => pathsOverlap(own, scope, workspace, cwd)),
  )
}

/** The worker-owner test the requirement uses; `lead` is the self-declared escape. */
function leadOwned(owner: string): boolean {
  return owner.trim().toLowerCase() === 'lead'
}

/** A worker-start tool lookup that an absent registry cannot answer (undefined). */
interface ToolLookup {
  get?(name: string, scope?: unknown): unknown
}

/** Visible worker-start tools per agent; undefined keeps the gate enabled. */
function workerToolVisibility(ctx: Context): (agent: Agent) => boolean | undefined {
  const tools = ctx.tools as unknown as ToolLookup
  const get = tools.get
  if (typeof get !== 'function') return () => undefined
  return (agent) => {
    try {
      return [...WORKER_TOOLS].some((name) => get.call(tools, name, agent) !== undefined)
    } catch {
      return undefined
    }
  }
}

/** An argument value safe to print inside a double-quoted suggested call. */
function quotedArg(text: string): string {
  return text.replace(/"/gu, "'")
}

/**
 * One ready-to-paste worker call that takes a lane in its own worktree. A
 * tagged call carries `lane-tag: <change>#<n>` in its arguments, where n is the
 * lane's position in the plan; the engine records that exact tag.
 */
function laneWorkerCall(
  changeName: string,
  lane: TaskLane,
  number: number,
  tagged = false,
): string {
  const worktree = `wt-${changeName}-${number}`
  const branch = `lane-${changeName}-${number}`
  const heading = `the heading '${lane.title}'`
  const tag = tagged ? `lane-tag: ${changeName}#${number}. ` : ''
  const prompt =
    `${tag}Implement the unchecked tasks under ${heading} in openspec/changes/${changeName}/tasks.md. ` +
    `Work in your own worktree: resolve the repository root with git rev-parse --show-toplevel, ` +
    `then from that root run git worktree add ../${worktree} -b ${branch} ` +
    '(pick another suffix if that path already exists; the worktree must be a sibling of the ' +
    'repository, never inside it), then run pnpm install --frozen-lockfile inside it. ' +
    `Read that change's proposal.md, design.md, and spec deltas first. ` +
    `Work only inside ${lane.owns.join(', ')}. ` +
    `Do not tick tasks.md; report the branch ${branch}, the files changed, and the commands you ran.`
  return `subagent(description: "${quotedArg(`Lane: ${lane.title}`.slice(0, 80))}", prompt: "${quotedArg(prompt)}")`
}

/** The lane-assignment steer: a root-anchored checkpoint, then one tagged call per lane. */
function laneAssignmentCall(
  changeName: string,
  lanes: readonly TaskLane[],
  remaining: readonly TaskLane[],
): string {
  const lines = [
    'commit the current worktree first, because a new checkout only sees commits;',
    'the :/ and :(top) pathspecs keep both commands anchored to the repository root:',
    `  git add -A :/; git add -f ":(top)openspec/changes/${changeName}"; git commit -m "lane checkpoint before fan-out"`,
    'start one worker per unassigned lane (they run in parallel); each call carries its lane-tag:',
  ]
  for (const lane of remaining) {
    lines.push(`  ${laneWorkerCall(changeName, lane, lanes.indexOf(lane) + 1, true)}`)
  }
  lines.push('or record a serial decision for a lane that cannot run in parallel:')
  for (const lane of remaining) {
    const next = lane.tasks.find((task) => !task.checked)
    if (next === undefined) continue
    lines.push(
      `  task_progress(task: "${next.number} ${next.text}", status: "in-progress", reason: "why this lane stays serial")`,
    )
  }
  return lines.join('\n')
}

/**
 * Evaluate every gated rule and steer the agent once when something is unmet.
 * This function never starts a target and returns no value; the caller (the
 * `agent/turn-stopping` listener) contains every failure.
 */
async function evaluateGate(
  deps: GateDeps,
  agent: Agent,
  turn: number,
  signal: AbortSignal,
): Promise<void> {
  if (agent.session.header.origin === 'subagent') return
  const agentId = String(agent.id)
  const thread = currentThread(agent)
  const cwd = deps.services.workingDirectory.get(agent.session)
  const openspecRoot = await findOpenSpecRoot(cwd)
  const workspaceRoot = openspecRoot === undefined ? undefined : dirname(openspecRoot)
  if (workspaceRoot !== undefined) await deps.recover?.(workspaceRoot)
  const changes = openspecRoot === undefined ? [] : await listActiveChanges(openspecRoot)
  // All active changes are snapshotted so a new or newly edited change is
  // detectable; only the session's involved changes are evaluated.
  const current = await captureSnapshot(cwd, changes, deps.services.git, signal)
  const baseline = deps.state.baselineOf(agentId, turn)
  const turnBaseline = deps.state.turnBaselineOf(agentId, turn)
  const involvement =
    workspaceRoot === undefined
      ? emptyInvolvement(thread)
      : await withInvolvementLock(workspaceRoot, thread, async () => {
          const read = await readInvolvement(workspaceRoot, thread)
          if (turnBaseline !== undefined) {
            const evidence = deps.state.evidenceOf(agentId)
            if (
              evidence.size > 0 &&
              applyTurnEvidence(read.involvement, evidence, turnBaseline, current)
            ) {
              await writeInvolvement(workspaceRoot, read.involvement)
            }
          }
          return read.involvement
        })
  const involved = changes.filter((change) => involvement.changes[change.name] !== undefined)
  const issues: GateIssue[] = []
  const digestShort = (digest: string | undefined): string =>
    digest === undefined ? '(unavailable)' : digest.slice(0, 12)

  const digestFailure = (): string | undefined => current.digestError

  const pushStrict = (ruleId: string, text: string, call: string): void => {
    issues.push({ ruleId, text, call, soft: false })
  }
  const pushSoft = (key: string, ruleId: string, text: string, call: string): void => {
    const issue = softIssue(deps, agentId, key, ruleId, text, call)
    if (issue !== undefined) issues.push(issue)
  }
  const noMatchDetail = (
    state: RecordState,
    expectedDigest: string | undefined,
    path: string,
  ): string => {
    const record = relativePath(cwd, path)
    if (state.kind !== 'record') return `no PASS/ERROR record at ${record}`
    if (state.record.verdict === 'FINDINGS') {
      return `its FINDINGS record at ${record} is unresolved; fix the findings and re-review`
    }
    return `${state.record.verdict} record at ${record} is stale (recorded ${digestShort(state.record.digest)}, current ${digestShort(expectedDigest)})`
  }
  const pendingFor = (
    ruleId: string,
    changeName: string,
    taskId?: string,
  ): PendingReviewView | undefined =>
    workspaceRoot === undefined
      ? undefined
      : deps.services.pendingReview?.(workspaceRoot, ruleId, changeName, taskId)

  if (openspecRoot !== undefined) {
    const reviewer = await readReviewerBinding(openspecRoot)
    for (const change of involved) {
      const entry = involvement.changes[change.name] as InvolvementEntry
      const changeSnapshot = current.changes.find((entry) => entry.name === change.name)
      const tasks = changeSnapshot?.tasks ?? []
      const changeSpecDigest = changeSnapshot?.specDigest
      if (changeSnapshot?.error !== undefined) {
        pushSoft(
          `change-artifacts:${change.name}`,
          'change-artifacts',
          `change "${change.name}" (session ${thread}) ${changeSnapshot.error}; repair that change's artifacts or archive the change so its gated reviews can be evaluated.`,
          `repair openspec/changes/${change.name} (or archive the change)`,
        )
        continue
      }
      for (const rule of deps.config.rules) {
        if (
          rule.when === 'spec-ready' &&
          rule.contract === 'review' &&
          rule.scope === 'whole' &&
          rule.gate !== 'none' &&
          (entry.created || entry.specChanged)
        ) {
          if (!change.reviewReady) continue
          const path = recordPath(cwd, rule, change.name)
          const state = await inspectRecord(path)
          const matching = recordSatisfies(state, change.name, 'whole', changeSpecDigest)
          if (matching) continue
          const pending = pendingFor(rule.id, change.name)
          const detail =
            pending === undefined
              ? noMatchDetail(state, changeSpecDigest, path)
              : `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`
          const text = `rule "${rule.id}": whole-spec review of change "${change.name}" is required for spec digest ${digestShort(changeSpecDigest)} (${detail}).`
          const call =
            pending === undefined
              ? `delegate(rule: "${rule.id}", change: "${change.name}")`
              : `delegation_status (run ${pending.id})`
          if (rule.gate === 'strict') pushStrict(rule.id, text, call)
          else
            pushSoft(
              `spec-review:${rule.id}:${change.name}:${changeSpecDigest ?? 'none'}`,
              rule.id,
              text,
              call,
            )
        }
        if (
          rule.when === 'implementation-complete' &&
          rule.contract === 'review' &&
          rule.scope === 'whole' &&
          rule.gate !== 'none' &&
          entry.completed &&
          tasks.length > 0 &&
          tasks.every((task) => task.checked)
        ) {
          const path = recordPath(cwd, rule, change.name)
          const state = await inspectRecord(path)
          const matching = recordSatisfies(state, change.name, 'whole', current.digest)
          if (matching) continue
          const pending = pendingFor(rule.id, change.name)
          const detail =
            pending === undefined
              ? noMatchDetail(state, current.digest, path)
              : `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`
          const text = `rule "${rule.id}": integration review of change "${change.name}" is ${rule.gate === 'soft' ? 'suggested' : 'required'} for worktree digest ${digestShort(current.digest)} (${detail}).`
          const call =
            pending === undefined
              ? `delegate(rule: "${rule.id}", change: "${change.name}")`
              : `delegation_status (run ${pending.id})`
          if (rule.gate === 'strict') pushStrict(rule.id, text, call)
          else
            pushSoft(
              `integration:${rule.id}:${change.name}:${current.digest ?? 'none'}`,
              rule.id,
              text,
              call,
            )
        }
      }

      const taskRules = deps.config.rules.filter(
        (rule) =>
          rule.when === 'spec-task-ready' && rule.contract === 'review' && rule.scope === 'task',
      )
      const strictTaskRule = taskRules.find((rule) => rule.gate === 'strict')
      const softTaskRule = taskRules.find((rule) => rule.gate === 'soft')
      // Only the checked tasks this session attributed are in its review scope.
      for (const task of tasks.filter((task) => task.checked && entry.tasks.includes(task.id))) {
        let satisfied = false
        let findingsOnly = false
        for (const rule of taskRules) {
          const state = await inspectRecord(recordPath(cwd, rule, change.name, task.id))
          if (
            reviewer.error === undefined &&
            state.kind === 'record' &&
            reviewerMatches(state.record.target, reviewer.reviewer) &&
            recordSatisfies(state, change.name, 'task', undefined, task.id)
          ) {
            satisfied = true
            break
          }
          if (state.kind === 'record' && state.record.verdict === 'FINDINGS') findingsOnly = true
        }
        if (satisfied) continue
        const ruleId = (strictTaskRule ?? softTaskRule)?.id ?? 'task-review'
        const pending = pendingFor(ruleId, change.name, task.id)
        const detail =
          reviewer.error !== undefined
            ? `the approval marker could not be read (${sanitizeText(reviewer.error, MAX_ERROR_CHARS)}); repair openspec/${APPROVAL_MARKER_FILE}`
            : pending !== undefined
              ? `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`
              : findingsOnly
                ? 'its review record has unresolved findings'
                : 'it has no task-review PASS/ERROR record'
        const text = `rule "${ruleId}": checked task "${task.number} ${task.text}" in change "${change.name}" requires its task-scoped review; ${detail}.`
        const call =
          reviewer.error !== undefined
            ? `repair openspec/${APPROVAL_MARKER_FILE}`
            : pending === undefined
              ? `delegate(rule: "${ruleId}", change: "${change.name}", task: "${task.id}")`
              : `delegation_status (run ${pending.id})`
        if (strictTaskRule !== undefined) pushStrict(ruleId, text, call)
        else if (softTaskRule !== undefined) {
          pushSoft(`task-review:${change.name}:${task.id}`, ruleId, text, call)
        }
      }

      // The completing session must obtain an approval for every checked task,
      // not only the tasks its own tick attributed.
      if (
        entry.completed &&
        taskRules.length > 0 &&
        tasks.length > 0 &&
        tasks.every((task) => task.checked)
      ) {
        const approval = await changeApproval(deps.config, change, openspecRoot, tasks)
        if ('error' in approval) {
          pushStrict(
            (strictTaskRule ?? softTaskRule)?.id ?? 'task-review',
            `completion of change "${change.name}" requires a portable task-review PASS for every checked task, but the approval could not be evaluated: ${approval.error}`,
            `repair openspec/changes/${change.name} (or ${APPROVAL_MARKER_FILE}) and run the task reviews`,
          )
        } else {
          for (const line of approval.coverage.unparseable) {
            pushStrict(
              approval.coverage.rule,
              `completion of change "${change.name}" cannot be approved: checked line ${line.line} "${line.text}" is not a numbered task`,
              `fix the checked line in openspec/changes/${change.name}/tasks.md`,
            )
          }
          for (const task of approval.coverage.tasks) {
            if (task.state === 'pass') continue
            const ruleId = approval.coverage.rule
            const pending = pendingFor(ruleId, change.name, task.id)
            const detail =
              pending !== undefined
                ? `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`
                : (task.detail ?? 'it has no portable PASS record')
            const text = `rule "${ruleId}": the task list of change "${change.name}" is fully checked, so completion requires a portable task-review PASS for checked task "${task.number} ${task.text}"; ${detail}.`
            const call =
              pending === undefined
                ? `delegate(rule: "${ruleId}", change: "${change.name}", task: "${task.id}")`
                : `delegation_status (run ${pending.id})`
            if (strictTaskRule !== undefined) pushStrict(ruleId, text, call)
            else if (softTaskRule !== undefined) {
              pushSoft(`completion:${change.name}:${task.id}`, ruleId, text, call)
            }
          }
        }
      }

      const workRules = deps.config.rules.filter(
        (rule) => rule.when === 'implementation-work' && rule.contract === 'note',
      )
      if (workRules.length > 0) {
        const base = baseline?.changes.find((entry) => entry.name === change.name)
        const baseChecked = new Set(
          (base?.tasks ?? []).filter((task) => task.checked).map((task) => task.id),
        )
        const newlyChecked = tasks.filter(
          (task) => task.checked && entry.tasks.includes(task.id) && !baseChecked.has(task.id),
        )
        const ownChecked = tasks.filter((task) => task.checked && entry.tasks.includes(task.id))
        const reviewedOwn = new Set<string>()
        for (const task of ownChecked) {
          for (const rule of taskRules) {
            const state = await inspectRecord(recordPath(cwd, rule, change.name, task.id))
            if (
              reviewer.error === undefined &&
              state.kind === 'record' &&
              reviewerMatches(state.record.target, reviewer.reviewer) &&
              recordSatisfies(state, change.name, 'task', undefined, task.id)
            ) {
              reviewedOwn.add(task.id)
              break
            }
          }
        }
        const tickedReviewed = newlyChecked.some((task) => reviewedOwn.has(task.id))
        let matchingNote = false
        const note = await inspectNote(cwd, change.name)
        if (note.kind === 'note' && current.digest !== undefined) {
          const task = tasks.find((entry) => entry.id === note.note.taskId)
          matchingNote =
            note.note.worktreeDigest === current.digest && task !== undefined && !task.checked
        }
        const changed =
          baseline !== undefined &&
          baseline.implementationFingerprint !== undefined &&
          current.implementationFingerprint !== undefined &&
          baseline.implementationFingerprint !== current.implementationFingerprint
        if (changed && !tickedReviewed && !matchingNote) {
          const nextTask = tasks.find((task) => !task.checked)
          const taskReviewRule = strictTaskRule ?? softTaskRule
          const ownReviewTarget = ownChecked.find((task) => !reviewedOwn.has(task.id))
          const what =
            nextTask === undefined
              ? ownReviewTarget === undefined
                ? 'the task list is fully checked and this session has no unreviewed task; add a task for follow-up work or archive the change'
                : `review task "${ownReviewTarget.number} ${ownReviewTarget.text}"`
              : taskReviewRule === undefined
                ? `tick the completed task, or record task_progress(task: "${nextTask.number} ${nextTask.text}", status: "in-progress", reason: "...")`
                : `tick the completed task and run delegate(rule: "${taskReviewRule.id}"), or record task_progress(task: "${nextTask.number} ${nextTask.text}", status: "in-progress", reason: "...")`
          const ruleId =
            workRules.find((rule) => rule.gate === 'strict')?.id ??
            workRules[0]?.id ??
            'task-progress'
          const text = `rule "${ruleId}": this turn changed implementation files in change "${change.name}" without a newly checked-and-reviewed task and without a matching progress note for worktree digest ${digestShort(current.digest)}; ${what}.`
          const call =
            nextTask === undefined && taskReviewRule !== undefined && ownReviewTarget !== undefined
              ? `delegate(rule: "${taskReviewRule.id}", change: "${change.name}", task: "${ownReviewTarget.id}")`
              : nextTask === undefined
                ? 'delegation_status: no unchecked or unreviewed session task remains; add a task for follow-up work or archive the change'
                : `task_progress(task: "${nextTask.number} ${nextTask.text}", status: "in-progress", reason: "...")`
          if (workRules.some((rule) => rule.gate === 'strict')) pushStrict(ruleId, text, call)
          else
            pushSoft(
              `implementation-work:${change.name}:${current.implementationFingerprint ?? 'none'}`,
              ruleId,
              text,
              call,
            )
        }
      }

      // The lane-assignment gate starts fan-out at the first implementation
      // tick and remembers each lane's tagged worker or serial decision across
      // turns. A lane ticked in this turn is current and is never reported.
      const assignmentRules = deps.config.rules.filter(
        (rule) =>
          rule.when === 'lane-assignment' && rule.contract === 'note' && rule.gate !== 'none',
      )
      // A profile with no visible worker-start tool cannot assign a lane, so the
      // gate reports nothing there instead of demanding an impossible call.
      if (assignmentRules.length > 0 && deps.workerToolVisible?.(agent) !== false) {
        const ruleId =
          assignmentRules.find((rule) => rule.gate === 'strict')?.id ??
          assignmentRules[0]?.id ??
          'lane-fanout'
        // An unreadable plan fails open; a readable plan with no headings or
        // tasks reports nothing but still releases every assignment.
        const lanes = await readTaskLanesOrUndefined(change.dir)
        const readable = lanes ?? []
        const titled = readable.filter((lane) => lane.title !== '')
        // Prune decisions for lanes that disappeared or completed; a renamed
        // lane is a new title and therefore a new, unassigned lane.
        if (lanes !== undefined) {
          for (const title of [...deps.state.laneDecisions(agentId, change.name).keys()]) {
            const lane = titled.find((entry) => entry.title === title)
            const complete =
              lane !== undefined &&
              lane.tasks.length > 0 &&
              lane.tasks.every((task) => task.checked)
            if (lane === undefined || complete) {
              deps.state.releaseLane(agentId, change.name, title)
            }
          }
        }
        if (titled.length > 0) {
          const parallel = titled.filter(
            (lane) => !/serial/iu.test(lane.title) && lane.tasks.length > 0,
          )
          // The lanes this session ticked in the current turn, from its own
          // canonical task-write pairs; another session's ticks never count.
          const evidence = deps.state.evidenceOf(agentId).get(change.name)
          const ticked = new Set<string>()
          for (const write of evidence?.taskWrites ?? []) {
            const before = new Set(
              parseTasksText(write.before ?? '')
                .filter((task) => task.checked)
                .map((task) => task.id),
            )
            for (const task of parseTasksText(write.after)) {
              if (task.checked && !before.has(task.id)) ticked.add(task.id)
            }
          }
          const currentTitles = new Set(
            parallel
              .filter((lane) => lane.tasks.some((task) => ticked.has(task.id)))
              .map((lane) => lane.title),
          )
          const unassigned = parallel.filter(
            (lane) =>
              lane.tasks.some((task) => !task.checked) &&
              !currentTitles.has(lane.title) &&
              deps.state.laneDecision(agentId, change.name, lane.title) === undefined,
          )
          const implementationChanged =
            baseline !== undefined &&
            baseline.implementationFingerprint !== undefined &&
            current.implementationFingerprint !== undefined &&
            baseline.implementationFingerprint !== current.implementationFingerprint
          if (
            parallel.length >= 2 &&
            unassigned.length > 0 &&
            unassigned.every((lane) => lane.owns.length > 0) &&
            (ticked.size > 0 || implementationChanged)
          ) {
            const titles = unassigned.map((lane) => `"${lane.title}"`).join(', ')
            const text = `rule "${ruleId}": lane assignment is missing in change "${change.name}": ${unassigned.length} unassigned non-serial lane(s) with unchecked tasks (${titles}); this turn ticked a task or changed implementation files, and no tagged worker start or serial note covers them.`
            const call = laneAssignmentCall(change.name, readable, unassigned)
            if (assignmentRules.some((rule) => rule.gate === 'strict')) {
              pushStrict(ruleId, text, call)
            } else {
              pushSoft(
                `lane-assignment:${change.name}:${unassigned.map((lane) => lane.title).join('|')}`,
                ruleId,
                text,
                call,
              )
            }
          }
        }

        // Worker-lane checkpoint consistency: a task lane assigned to a tagged
        // worker must appear as a non-lead checkpoint lane, and a bottleneck
        // targeting that lane's work needs a worker or the user, not the lead.
        // A missing checkpoint, an unreadable plan, or a task lane without owned
        // paths fails open.
        if (lanes !== undefined) {
          const checkpoint = deps.state.checkpointOf(agentId, turn)
          const checkpointPlan =
            checkpoint === undefined ? undefined : checkpointPlanOf(checkpoint.arguments)
          if (checkpointPlan !== undefined && checkpointPlan.outcome === 'continue') {
            const assigned = titled.filter(
              (lane) =>
                lane.owns.length > 0 &&
                deps.state.laneDecision(agentId, change.name, lane.title) === 'assigned',
            )
            const problems: string[] = []
            const planRoot = workspaceRoot ?? dirname(openspecRoot)
            for (const lane of assigned) {
              const covering = checkpointPlan.lanes.filter((entry) =>
                checkpointCovers(entry, lane, planRoot, cwd),
              )
              if (covering.length === 0) {
                problems.push(`lane "${lane.title}" has no matching checkpoint lane`)
              } else if (covering.every((entry) => leadOwned(entry.owner))) {
                problems.push(
                  `lane "${lane.title}" is covered only by lead-owned checkpoint lane(s)`,
                )
              }
            }
            if (problems.length > 0) {
              const affected = assigned.filter((lane) =>
                problems.some((problem) => problem.includes(`lane "${lane.title}"`)),
              )
              const text = `rule "${ruleId}": worker-assigned checkpoint lanes are missing or lead-owned in change "${change.name}": ${problems.join('; ')}. The continue checkpoint must carry one lane per worker-assigned task lane, scoped to its owned paths and owned by the worker, not lead.`
              const call = affected
                .map(
                  (lane) =>
                    `work_checkpoint lane: id "${quotedArg(lane.title)}", owner "<non-lead worker>", scope [${lane.owns.map((own) => `"${quotedArg(own)}"`).join(', ')}], state "running"`,
                )
                .join('\n')
              if (assignmentRules.some((rule) => rule.gate === 'strict')) {
                pushStrict(ruleId, text, call)
              } else {
                pushSoft(
                  `checkpoint-lanes:${change.name}:${affected.map((lane) => lane.title).join('|')}`,
                  ruleId,
                  text,
                  call,
                )
              }
            }
            const bottleneck = checkpointPlan.bottleneck
            if (bottleneck?.action === 'lead_action') {
              const hits: string[] = []
              for (const target of bottleneck.targets) {
                for (const lane of assigned) {
                  if (lane.owns.some((own) => pathsOverlap(own, target, planRoot, cwd))) {
                    hits.push(`target "${target}" in worker-assigned lane "${lane.title}"`)
                  }
                }
              }
              if (hits.length > 0) {
                const text = `rule "${ruleId}": a lead_action bottleneck may not edit worker-assigned work in change "${change.name}" (${hits.join('; ')}); use action "worker_start" (tagging both the checkpoint and the bottleneck id) or "user_decision".`
                const call = `work_checkpoint(..., bottleneck: { id: "${quotedArg(bottleneck.id ?? '<bottleneck id>')}", owner: "<worker>", action: "worker_start" })`
                if (assignmentRules.some((rule) => rule.gate === 'strict')) {
                  pushStrict(ruleId, text, call)
                } else {
                  pushSoft(
                    `checkpoint-lead-action:${change.name}:${bottleneck.id ?? hits.length}`,
                    ruleId,
                    text,
                    call,
                  )
                }
              }
            }
          }
        }
      }

      // A completed lane is a decision point: fan out the lanes that remain, or
      // record the serial decision. Everything here fails open.
      const laneRules = deps.config.rules.filter(
        (rule) => rule.when === 'lane-boundary' && rule.contract === 'note' && rule.gate !== 'none',
      )
      if (laneRules.length > 0 && !deps.state.hasWorkerStart(agentId)) {
        // Lane completion comes from this session's own canonical write pair, so
        // another session's final tick can never gate this one.
        const evidence = deps.state.evidenceOf(agentId).get(change.name)
        const completions: Array<{ title: string; taskIds: string[] }> = []
        for (const write of evidence?.taskWrites ?? []) {
          const before = parseTaskLanes(write.before ?? '')
          for (const lane of parseTaskLanes(write.after)) {
            if (lane.tasks.length === 0) continue
            if (!lane.tasks.every((task) => task.checked)) continue
            // A matching before-write lane with an unchecked task is the only
            // evidence that this write completed the lane; a renamed or newly
            // supplied lane has no such evidence and fails open. A deletion that
            // leaves the lane checked carries no checked-off transition, so it is
            // not a completion either.
            const previous = before.find((entry) => entry.title === lane.title)
            if (previous === undefined) continue
            const uncheckedBefore = new Set(
              previous.tasks.filter((task) => !task.checked).map((task) => task.id),
            )
            const completedTask = lane.tasks.some(
              (task) => task.checked && uncheckedBefore.has(task.id),
            )
            if (!completedTask) continue
            completions.push({ title: lane.title, taskIds: lane.tasks.map((task) => task.id) })
          }
        }
        if (completions.length > 0) {
          const lanes = await readTaskLanes(change.dir)
          // A completion only stands while the current plan still holds the lane
          // complete and every task that carried it; a removed or reopened task
          // invalidates the evidence instead of gating the turn.
          const completedTitles = new Set(
            completions
              .filter(({ title, taskIds }) => {
                const lane = lanes.find((entry) => entry.title === title)
                return (
                  lane !== undefined &&
                  lane.tasks.length > 0 &&
                  lane.tasks.every((task) => task.checked) &&
                  taskIds.every((id) => lane.tasks.some((task) => task.id === id))
                )
              })
              .map(({ title }) => title),
          )
          const firstTitle = [...completedTitles][0]
          if (firstTitle !== undefined) {
            // Any remaining unchecked lane without owned paths means the plan does
            // not follow the lane convention, so the whole boundary fails open.
            const candidates = lanes.filter(
              (lane) =>
                !/serial/iu.test(lane.title) &&
                !completedTitles.has(lane.title) &&
                lane.tasks.some((task) => !task.checked),
            )
            const remaining = candidates.filter((lane) => lane.owns.length > 0)
            if (remaining.length > 0 && remaining.length === candidates.length) {
              const note = await inspectNote(cwd, change.name)
              const noteTask = note.kind === 'note' ? note.note.taskId : undefined
              const escaped =
                noteTask !== undefined &&
                current.digest !== undefined &&
                note.kind === 'note' &&
                note.note.worktreeDigest === current.digest &&
                laneOfTask(remaining, noteTask) !== undefined
              if (!escaped) {
                const ruleId =
                  laneRules.find((rule) => rule.gate === 'strict')?.id ??
                  laneRules[0]?.id ??
                  'lane-fanout'
                const titles = remaining.map((lane) => `"${lane.title}"`).join(', ')
                const next = remaining[0]?.tasks.find((task) => !task.checked)
                const call = [
                  'commit the current worktree first, because a new checkout only sees commits;',
                  'the :/ and :(top) pathspecs keep both commands anchored to the repository root:',
                  `  git add -A :/; git add -f ":(top)openspec/changes/${change.name}"; git commit -m "lane checkpoint before fan-out"`,
                  'start one worker per lane (they run in parallel):',
                  ...remaining.map(
                    (lane, index) => `  ${laneWorkerCall(change.name, lane, index + 1)}`,
                  ),
                  'or record the serial decision:',
                  next === undefined
                    ? '  delegation_status'
                    : `  task_progress(task: "${next.number} ${next.text}", status: "in-progress", reason: "why this lane stays serial")`,
                ].join('\n')
                const text = `rule "${ruleId}": lane "${firstTitle}" is complete and ${remaining.length} other lane(s) still have unchecked tasks (${titles}); this turn started no parallel worker in change "${change.name}".`
                if (laneRules.some((rule) => rule.gate === 'strict')) pushStrict(ruleId, text, call)
                else pushSoft(`lane-boundary:${change.name}:${firstTitle}`, ruleId, text, call)
              }
            }
          }
        }
      }
    }
  }

  if (openspecRoot !== undefined && current.digestError !== undefined && involved.length > 0) {
    pushStrict(
      'digest',
      `the worktree digest could not be computed (${current.digestError}); fix the git workspace failure so gated rules can be evaluated.`,
      'git status --porcelain=v1 -z --untracked-files=all',
    )
  }

  for (const rule of deps.config.rules) {
    if (rule.when !== 'failure-streak' || rule.gate === 'none') continue
    const threshold = rule.threshold ?? deps.config.failureStreak
    const failures = deps.state.failuresOf(agentId)
    if (failures < threshold || deps.state.consulted(agentId)) continue
    const text = `rule "${rule.id}": ${failures} consecutive failed tool calls with no consultation attempt for this streak; consult before retrying the same approach again.`
    const call = `delegate(rule: "${rule.id}", context: "${failures} consecutive tool failures; here are the failing calls and the current plan")`
    if (rule.gate === 'strict') pushStrict(rule.id, text, call)
    else pushSoft(`failure-streak:${rule.id}:${deps.state.epochOf(agentId)}`, rule.id, text, call)
  }

  deps.state.rememberSnapshot(agentId, current)
  if (issues.length === 0) return
  const lines = [
    'Delegation gate (delegation-rules) is not satisfied; this turn needs another step.',
    '',
  ]
  issues.forEach((issue, index) => {
    lines.push(`${index + 1}. ${issue.soft ? 'Soft hint' : 'Required'} - ${issue.text}`)
    lines.push(`   Run: ${issue.call}`)
  })
  lines.push(
    '',
    'Only a matching record (or a fresh task_progress note) satisfies the gate; a text claim does not.',
  )
  const digestNote = digestFailure()
  if (digestNote !== undefined) lines.push(`Digest failure: ${digestNote}`)
  agent.steer(gateMessage(lines.join('\n')))
}

interface ShellInvocation {
  command: string
  cwd?: string
}

/** The shell command a tool execution runs, if it is one the guard understands. */
function archiveShellInvocation(exec: ToolExecution): ShellInvocation | undefined {
  const args = isRecord(exec.arguments) ? exec.arguments : {}
  if (exec.name === 'terminal_send') {
    return typeof args.text === 'string' ? { command: args.text } : undefined
  }
  if (exec.name !== 'pwsh' && exec.name !== 'bash') return undefined
  if (typeof args.command !== 'string') return undefined
  return typeof args.workdir === 'string'
    ? { command: args.command, cwd: args.workdir }
    : { command: args.command }
}

function archiveDenial(reason: string): PreToolDecision {
  return { kind: 'deny', reason }
}

/**
 * The opt-in archive gate: refuses the documented archive forms before they
 * run when a checked task lacks a portable task-review PASS. It applies to
 * subagents too; only the turn-stopping gate skips them.
 */
async function archiveGateDecision(
  deps: GateDeps,
  exec: ToolExecution,
): Promise<PreToolDecision | undefined> {
  if (exec.agent === undefined) return undefined
  const invocation = archiveShellInvocation(exec)
  if (invocation === undefined) return undefined
  const sessionCwd = deps.services.workingDirectory.get(exec.agent.session)
  const executionCwd =
    invocation.cwd === undefined ? sessionCwd : resolve(sessionCwd, invocation.cwd)
  const intents = recognizeArchiveCommands(invocation.command, executionCwd)
  if (intents.length === 0) return undefined
  const openspecRoot = findOpenSpecRootSync(executionCwd)
  if (openspecRoot === undefined) return undefined
  const markerPath = join(openspecRoot, APPROVAL_MARKER_FILE)
  let raw: string
  try {
    raw = await readFile(markerPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    return archiveDenial(
      `archive refused: the approval marker at ${relativePath(sessionCwd, markerPath)} is unreadable (${errorMessage(error)}); nothing was archived.`,
    )
  }
  let marker: ReviewApprovalMarker
  try {
    const parsed = parseReviewApprovalMarker(JSON.parse(raw))
    if (parsed.marker === undefined) {
      return archiveDenial(
        `archive refused: ${APPROVAL_MARKER_FILE}: ${parsed.error ?? 'invalid marker'}; nothing was archived.`,
      )
    }
    marker = parsed.marker
  } catch (error) {
    return archiveDenial(
      `archive refused: ${APPROVAL_MARKER_FILE} is not valid JSON (${errorMessage(error)}); nothing was archived.`,
    )
  }
  if (!marker.archiveGate) return undefined
  const rule = deps.config.rules.find((entry) => entry.id === marker.taskRule)
  if (rule === undefined) {
    return archiveDenial(
      `archive refused: marker taskRule "${marker.taskRule}" is not a configured rule; add it or fix ${APPROVAL_MARKER_FILE}. Nothing was archived.`,
    )
  }
  if (rule.contract !== 'review' || rule.scope !== 'task') {
    return archiveDenial(
      `archive refused: marker taskRule "${rule.id}" is not a task-scoped review rule; fix ${APPROVAL_MARKER_FILE}. Nothing was archived.`,
    )
  }
  if (rule.gate !== 'strict') {
    return archiveDenial(
      `archive refused: marker taskRule "${rule.id}" is not a strict rule; fix ${APPROVAL_MARKER_FILE}. Nothing was archived.`,
    )
  }
  const gaps: string[] = []
  for (const intent of intents) {
    const change = await readChange(openspecRoot, intent.change)
    if (change === undefined) continue
    let tasks: TaskInfo[]
    try {
      tasks = await readTasks(change.dir)
    } catch (error) {
      return archiveDenial(
        `archive refused: change "${change.name}" has no readable tasks.md (${errorMessage(error)}); nothing was archived.`,
      )
    }
    const approval = await changeApproval(deps.config, change, openspecRoot, tasks)
    if ('error' in approval) {
      return archiveDenial(
        `archive refused: change "${change.name}": ${approval.error}; nothing was archived.`,
      )
    }
    if (approval.coverage.archiveReady) continue
    gaps.push(
      `archive refused: change "${change.name}" is not approval-complete (${approvalSummaryLine(approval.coverage)}).`,
      ...formatApprovalGapLines(approval.coverage).map((line) => `  ${line}`),
    )
  }
  if (gaps.length === 0) return undefined
  gaps.push(
    'Nothing was archived: the change remains active. Fix the lines above, run the exact delegate calls, then archive again.',
    'Full audit: pnpm reviews:check --all',
  )
  return archiveDenial(gaps.join('\n'))
}

interface GateWiring {
  ctx: Context
  deps: GateDeps
}

function attachGate({ ctx, deps }: GateWiring): void {
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    try {
      if (payload.agent.session.header.origin === 'subagent') return decision
      const agentId = String(payload.agent.id)
      if (!deps.state.beginTurn(agentId, payload.turn)) return decision
      const cwd = deps.services.workingDirectory.get(payload.agent.session)
      const root = await findOpenSpecRoot(cwd)
      if (root !== undefined) await deps.recover?.(dirname(root))
      const changes = root === undefined ? [] : await listActiveChanges(root)
      deps.state.setBaseline(
        agentId,
        await captureSnapshot(cwd, changes, deps.services.git, payload.signal),
      )
    } catch {
      // A pre-step observer never fails the step.
    }
    return decision
  })

  ctx.on('tools/result', (exec, result) => {
    try {
      if (exec.agent !== undefined) {
        const agentId = String(exec.agent.id)
        deps.state.recordToolResult(agentId, result.isError)
        const cwd = deps.services.workingDirectory.get(exec.agent.session)
        recordWriteEvidence(deps.state, agentId, cwd, exec, result)
        if (!result.isError && exec.name === 'work_checkpoint') {
          deps.state.recordCheckpoint(agentId, exec.arguments, result.value)
        }
        if (!result.isError && WORKER_TOOLS.has(exec.name)) {
          deps.state.markWorkerStarted(agentId)
          recordLaneAssignment(deps.state, agentId, cwd, exec.arguments)
        }
      }
    } catch {
      // Observability never breaks tool dispatch.
    }
    return undefined
  })

  ctx.on('agent/turn-stopping', async (payload) => {
    try {
      await evaluateGate(deps, payload.agent, payload.turn, payload.signal)
    } catch (error) {
      try {
        payload.agent.steer(
          gateMessage(
            `Delegation gate (delegation-rules) could not evaluate this turn: ${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)}. Fix the workspace or plugin configuration; disabling the row is the explicit opt-out.`,
          ),
        )
      } catch {
        // The gate never throws into the turn.
      }
    }
  })

  // Archive guard: deny the documented archive forms before any effect. It
  // applies to subagents too, unlike the turn-stopping gate.
  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      const decision = await archiveGateDecision(deps, exec)
      if (decision !== undefined) return decision
    } catch (error) {
      return archiveDenial(
        `archive refused: the delegation-rules archive gate could not evaluate this command (${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)}); nothing was archived.`,
      )
    }
    return await next()
  })
}

function toolOutput(value: string): { text: string } {
  return { text: value }
}

function renderOutput(value: unknown): ContentBlock[] {
  const text = isRecord(value) && typeof value.text === 'string' ? value.text : String(value)
  return [{ type: 'text', text }]
}

/** The `note` contract runs no target, so it borrows the answer timeout. */
function timeoutForContract(timeouts: TimeoutConfig, contract: Contract): number {
  return contract === 'note' ? timeouts.answer : timeouts[contract]
}

/** The learning store is workspace-scoped like the review records. */
async function sessionWorkspaceRoot(services: EngineServices, agent: Agent): Promise<string> {
  const cwd = services.workingDirectory.get(agent.session)
  const openspecRoot = await findOpenSpecRoot(cwd)
  return openspecRoot === undefined ? cwd : dirname(openspecRoot)
}

/** Tool executions carry the calling agent; a sessionless call cannot scope a store. */
function requireToolAgent(agent: Agent | undefined): Agent {
  if (agent === undefined) fail('this tool needs a live agent session; call it from a session turn')
  return agent
}

function buildToolDefinitions(
  engine: DelegationEngine,
  config: EngineConfig,
  services: EngineServices,
): ToolDefinition[] {
  const ruleIds = config.rules.map((rule) => rule.id)
  const output = {
    schema: TOOL_OUTPUT_SCHEMA,
    render: (_args: unknown, value: unknown) => renderOutput(value),
  }
  const definitions: ToolDefinition[] = [
    {
      name: 'delegate',
      description: toolDescriptions.delegate,
      parameters: {
        type: 'object',
        properties: {
          rule: {
            type: 'string',
            enum: ruleIds,
            description: 'One configured rule id; the enum lists every rule the engine knows.',
          },
          change: {
            type: 'string',
            description:
              'Active OpenSpec change directory name; defaults to the only active change.',
          },
          task: {
            type: 'string',
            description:
              'Task-scoped review only: the checked task id (or its task text) to review. Omit to let the engine pick the next checked task.',
          },
          context: {
            type: 'string',
            description:
              'Facts the target needs: for the advisor, the exact question, constraints, and decisive evidence; otherwise failing output, relevant files, constraints.',
          },
          objective: {
            type: 'string',
            description: 'The concrete goal; required for the patch contract.',
          },
        },
        required: ['rule'],
        additionalProperties: false,
      },
      output,
      execute: async (args, exec) => {
        const parsed = parseDelegateArgs(args)
        const agent = exec.agent
        return toolOutput(await engine.runDelegate(parsed, { agent, signal: exec.signal }))
      },
    },
    {
      name: 'task_progress',
      description: toolDescriptions.task_progress,
      parameters: {
        type: 'object',
        properties: {
          task: {
            type: 'string',
            description: 'Full task text from tasks.md, or its 16-character task id.',
          },
          status: {
            type: 'string',
            enum: ['in-progress', 'blocked'],
            description: 'Explicit state of the unchecked task.',
          },
          reason: {
            type: 'string',
            description:
              'Why the task spans turns or is blocked; recorded with the worktree digest.',
          },
        },
        required: ['task', 'status', 'reason'],
        additionalProperties: false,
      },
      output,
      execute: async (args, exec) => {
        const parsed = parseProgressArgs(args)
        const agent = exec.agent
        return toolOutput(await engine.taskProgress(parsed, { agent, signal: exec.signal }))
      },
    },
    {
      name: 'delegation_status',
      description: toolDescriptions.delegation_status,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output,
      execute: async (_args, exec) => {
        const agent = exec.agent
        return toolOutput(await engine.delegationStatus({ agent, signal: exec.signal }))
      },
    },
  ]
  if (!config.reviewLearning.enabled) return definitions
  definitions.push(
    {
      name: 'review_retro',
      description: REVIEW_RETRO_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['report', 'propose'],
            description:
              'report: deterministic counts and repeat rate; propose: also store at most one proposed lesson draft.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output,
      execute: async (args, exec) => {
        const agent = requireToolAgent(exec.agent)
        const workspaceRoot = await sessionWorkspaceRoot(services, agent)
        return toolOutput(
          await executeReviewRetro(args, {
            workspaceRoot,
            now: services.now,
            window: config.reviewLearning.window,
            maxLessons: config.reviewLearning.maxLessons,
          }),
        )
      },
    },
    {
      name: 'review_lesson',
      description: REVIEW_LESSON_DESCRIPTION,
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'propose', 'decide', 'apply'],
            description:
              'A model may only propose; decide and apply ask the user and return without a write until the user answers.',
          },
          class: { type: 'string', description: 'One of the fixed finding-class vocabulary.' },
          title: { type: 'string', description: 'Short lesson title (dedupe key with the class).' },
          body: { type: 'string', description: 'The lesson text; stored as bounded data.' },
          appliesTo: {
            type: 'object',
            properties: {
              rules: { type: 'array', items: { type: 'string' } },
              capabilities: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          source: {
            type: 'object',
            properties: {
              change: { type: 'string' },
              taskId: { type: 'string' },
              findingHashes: { type: 'array', items: { type: 'string' } },
            },
            additionalProperties: false,
          },
          id: { type: 'string', description: 'Lesson revision id from list.' },
          decision: { type: 'string', enum: ['accept', 'reject'] },
          target: {
            type: 'string',
            description: 'Change, spec, file, or test the accepted lesson is applied to.',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output,
      execute: async (args, exec) => {
        const agent = requireToolAgent(exec.agent)
        const workspaceRoot = await sessionWorkspaceRoot(services, agent)
        return toolOutput(
          await executeReviewLesson(args, {
            workspaceRoot,
            now: services.now,
            maxLessons: config.reviewLearning.maxLessons,
            agent,
            signal: exec.signal,
            ...(services.userQuestions === undefined
              ? {}
              : { userQuestions: services.userQuestions }),
          }),
        )
      },
    },
  )
  return definitions
}

function parseDelegateArgs(args: unknown): DelegateArguments {
  if (!isRecord(args)) fail('delegate arguments must be an object')
  const rule = requireNonEmpty(args.rule, 'delegate.rule')
  const result: DelegateArguments = { rule }
  if (args.change !== undefined) result.change = requireNonEmpty(args.change, 'delegate.change')
  if (args.task !== undefined) result.task = requireNonEmpty(args.task, 'delegate.task')
  if (args.context !== undefined) {
    if (typeof args.context !== 'string') fail('delegate.context must be a string')
    result.context = args.context
  }
  if (args.objective !== undefined) {
    if (typeof args.objective !== 'string') fail('delegate.objective must be a string')
    result.objective = args.objective
  }
  return result
}

function parseProgressArgs(args: unknown): {
  task: string
  status: ProgressStatus
  reason: string
} {
  if (!isRecord(args)) fail('task_progress arguments must be an object')
  const task = requireNonEmpty(args.task, 'task_progress.task')
  if (args.status !== 'in-progress' && args.status !== 'blocked') {
    fail('task_progress.status must be "in-progress" or "blocked"')
  }
  if (typeof args.reason !== 'string' || args.reason.trim() === '') {
    fail('task_progress.reason must be a non-empty string')
  }
  return { task, status: args.status, reason: args.reason }
}

function skillAdapterNote(): string {
  return [
    '',
    '',
    '---',
    '',
    'DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-delegation-rules as first-party guidance for this Harness; it is not pinned upstream text. The engine has no provider dependency; the default targets are only data.',
  ].join('\n')
}

function createSkillProvider(note: string): SkillProvider {
  const invocation = { modelInvocable: true, userInvocable: true }
  const candidate: SkillCandidate = {
    name: SKILL_NAME,
    description: skillDescription,
    invocation,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: { kind: 'directory', path: assetsDirectory.replaceAll('\\', '/') },
    rank: BUNDLED_SKILL_RANK,
    locator: join(assetsDirectory, 'SKILL.md'),
  }
  return {
    name: PROVIDER_NAME,
    list: () => Promise.resolve([candidate]),
    async get(loaded, options) {
      if (loaded.name !== SKILL_NAME) return undefined
      const body = await readFile(join(assetsDirectory, 'SKILL.md'), {
        encoding: 'utf8',
        signal: options.signal,
      })
      return {
        name: SKILL_NAME,
        description: skillDescription,
        invocation,
        provider: PROVIDER_NAME,
        source: 'bundled',
        resourceBase: candidate.resourceBase,
        content: `${body}${note}`,
      }
    },
  }
}

/** One human command definition accepted by the DSH commands registry. */
interface CommandRegistry {
  register(definition: {
    definitionId: string
    name: string
    description: string
    handler: (invocation: { agent: Agent }) => Promise<unknown>
  }): unknown
}

/**
 * `/review-retro` is a read-only host command: it prints the deterministic
 * report and never accepts or applies a lesson. Disabled learning registers
 * nothing.
 */
function registerReviewRetroCommand(
  ctx: Context,
  config: EngineConfig,
  services: EngineServices,
): void {
  if (!config.reviewLearning.enabled) return
  // Read the optional service without declaring a Cordis inject dependency, so
  // the plugin still loads in a profile that has no command registry.
  const commands = (ctx as unknown as { get?: (name: string, strict?: boolean) => unknown }).get?.(
    'commands',
  ) as CommandRegistry | undefined
  if (commands === undefined) return
  const definition = {
    definitionId: '@dsh-setup/plugin-delegation-rules/review-retro',
    name: 'review-retro',
    description:
      'Report repeated review findings by class from the local bounded finding history; never accepts or applies a lesson.',
    handler: async (invocation: { agent: Agent }) => {
      try {
        const workspaceRoot = await sessionWorkspaceRoot(services, invocation.agent)
        const text = await executeReviewRetro(
          { action: 'report' },
          {
            workspaceRoot,
            now: services.now,
            window: config.reviewLearning.window,
          },
        )
        return { kind: 'success' as const, text }
      } catch (error) {
        return {
          kind: 'error' as const,
          text: `review retro failed: ${sanitizeText(errorMessage(error), MAX_ERROR_CHARS)}`,
        }
      }
    },
  }
  const effect = (ctx as unknown as { effect?: (work: () => unknown) => unknown }).effect
  if (typeof effect === 'function') effect(() => commands.register(definition))
  else commands.register(definition)
}

/**
 * Register the three tools, the on-demand skill, and the turn-stopping gate.
 * A missing subagent provider is not fatal here: it is diagnosed by the tools
 * and `delegation_status`, so the profile composes without that provider.
 */
export function apply(ctx: Context, config: BundleConfig = {}, options: ApplyOptions = {}): void {
  const validated = validateConfig(config)
  const state = new DelegationState()
  // Optional services are read through ctx.get(), not the service property: a
  // hard inject would stop the plugin loading in a profile without them.
  const userQuestions = (
    ctx as unknown as { get?: (name: string, strict?: boolean) => unknown }
  ).get?.('userQuestions') as UserQuestionsService | undefined
  const services: EngineServices = {
    subagents: ctx.subagents,
    workingDirectory: ctx.workingDirectory,
    state,
    git: { runGit: options.runGit ?? defaultGit },
    now: options.now ?? (() => new Date()),
    ...(userQuestions === undefined ? {} : { userQuestions }),
    timeoutsFor: (rule) => timeoutForContract(validated.timeouts, rule.contract),
    ...(options.onRunSettled === undefined ? {} : { onRunSettled: options.onRunSettled }),
    ...(options.onPublished === undefined ? {} : { onPublished: options.onPublished }),
    ...(options.queueFault === undefined ? {} : { queueFault: options.queueFault }),
    ...(options.recoverDelay === undefined ? {} : { recoverDelay: options.recoverDelay }),
  }
  const engine = new DelegationEngine(validated, services)
  services.pendingReview = (workspaceRoot, ruleId, change, taskId) =>
    engine.pendingReview(workspaceRoot, ruleId, change, taskId)
  for (const definition of buildToolDefinitions(engine, validated, services)) {
    ctx.tools.register(definition)
  }
  registerReviewRetroCommand(ctx, validated, services)
  ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()))
  attachGate({
    ctx,
    deps: {
      config: validated,
      state,
      services,
      workerToolVisible: workerToolVisibility(ctx),
      recover: (workspaceRoot) => engine.recoverWorkspace(workspaceRoot),
    },
  })
}
