import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type { GoalRef, GoalView } from '@deepseek-ai/dsh-goal'
import type { ContextFormed, MessageId, UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session'
import type {
  SubagentActivation,
  SubagentProvider,
  SubagentRuntime,
} from '@deepseek-ai/dsh-subagent'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'goal-continuity': {
      kind: 'goal-continuity'
    } & ContextFormed
  }
}

/** Cordis plugin name, equal to the package name. */
export const name = '@dsh-setup/plugin-goal-continuity'

/** Services the supervisor needs. */
export const inject = ['agents', 'goals']

/** Independent block-review policy nested under `blockReview`. */
export interface BlockReviewConfig {
  /** Review proposed blocks at all (default true); the supervisor keeps running when false. */
  enabled?: boolean
  /** Registered subagent provider that starts the reviewer (default `spawn`). */
  provider?: string
  /** Reviewer model; omitted provider options fall back to the provider defaults. */
  model?: string
  /** Reviewer reasoning effort; same fallback as `model`. */
  reasoningEffort?: string
  /** Read-only preset the reviewer child joins (default `goal-reviewer`). */
  reviewerPreset?: string
  /** The goal tool's `blockedAfterConsecutiveRounds`; the gate reviews at this round (default 3). */
  blockedAfterConsecutiveRounds?: number
  /** One review's wall-clock bound in milliseconds (default 300000). */
  timeoutMs?: number
  /** Reviews a single goal may start (default 3); a reused verdict is free. */
  maxReviewsPerGoal?: number
  /** Policy for a target error, timeout, or malformed verdict (default `deny`). */
  onReviewError?: 'deny' | 'allow'
  /** Policy for a missing provider, preset, or child-scope restriction (default `allow`). */
  onUnavailable?: 'deny' | 'allow'
  /** Policy once `maxReviewsPerGoal` is reached (default `deny`). */
  onExhausted?: 'deny' | 'allow'
}

/** Row configuration. Every field is optional; omission selects the documented default. */
export interface Config {
  /** Supervise goals at all (default true). */
  enabled?: boolean
  /** Resume an active goal observed after process start (default false). */
  resumeAfterRestart?: boolean
  /** Re-arm after a user abort of a turn that is not a goal round (default `non-goal`). */
  resumeAfterUserStop?: 'non-goal' | 'never'
  /** Automatic resumes allowed per session (default 20). */
  maxSessionResumes?: number
  /** Rounds added by one cap extension (default 1000). */
  roundExtension?: number
  /** Cap extensions allowed per goal (default 2). */
  maxRoundExtensions?: number
  /** Upper bound for a goal's round cap (default 5000). */
  hardMaxGoalRounds?: number
  /** Independent review of a proposed goal block (enabled by default). */
  blockReview?: BlockReviewConfig
}

/** Fully resolved block-review policy; the plugin never runs on partial values. */
export interface ResolvedBlockReviewConfig {
  readonly enabled: boolean
  readonly provider: string
  readonly model: string
  readonly reasoningEffort: string
  readonly reviewerPreset: string
  readonly blockedAfterConsecutiveRounds: number
  readonly timeoutMs: number
  readonly maxReviewsPerGoal: number
  readonly onReviewError: 'deny' | 'allow'
  readonly onUnavailable: 'deny' | 'allow'
  readonly onExhausted: 'deny' | 'allow'
}

/** Fully resolved configuration; the plugin never runs on partial values. */
export interface ResolvedConfig {
  readonly enabled: boolean
  readonly resumeAfterRestart: boolean
  readonly resumeAfterUserStop: 'non-goal' | 'never'
  readonly maxSessionResumes: number
  readonly roundExtension: number
  readonly maxRoundExtensions: number
  readonly hardMaxGoalRounds: number
  readonly blockReview: ResolvedBlockReviewConfig
}

/** Id of the setup-declared reviewer preset; the composition fragment repeats it. */
const REVIEWER_PRESET_ID = 'goal-reviewer'

/** Documented block-review defaults; the composition fragment repeats them. */
export const DEFAULT_BLOCK_REVIEW_CONFIG: ResolvedBlockReviewConfig = Object.freeze({
  enabled: true,
  provider: 'spawn',
  model: 'deepseek-flash',
  reasoningEffort: 'max',
  reviewerPreset: REVIEWER_PRESET_ID,
  blockedAfterConsecutiveRounds: 3,
  timeoutMs: 300_000,
  maxReviewsPerGoal: 3,
  onReviewError: 'deny',
  onUnavailable: 'allow',
  onExhausted: 'deny',
})

/** Documented defaults; the composition fragment repeats them for the generated patch. */
export const DEFAULT_CONFIG: ResolvedConfig = Object.freeze({
  enabled: true,
  resumeAfterRestart: false,
  resumeAfterUserStop: 'non-goal',
  maxSessionResumes: 20,
  roundExtension: 1000,
  maxRoundExtensions: 2,
  hardMaxGoalRounds: 5000,
  blockReview: DEFAULT_BLOCK_REVIEW_CONFIG,
})

/** Bound for one notice summary, matching the harness context-summary bound. */
const CONTEXT_SUMMARY_MAX_CHARS = 120

/** Bound for the model-facing notice text. */
const NOTICE_TEXT_MAX_CHARS = 600

/** Bound for one durable block reason. */
const BLOCK_MESSAGE_MAX_CHARS = 400

/** Integer fields and their accepted inclusive range. */
const INTEGER_RANGES = {
  maxSessionResumes: [0, 1000],
  roundExtension: [1, 1_000_000],
  maxRoundExtensions: [0, 100],
  hardMaxGoalRounds: [1, 1_000_000],
} as const satisfies Record<string, readonly [number, number]>

type IntegerField = keyof typeof INTEGER_RANGES

/** Render one field diagnostic that names the field and its accepted range. */
function fieldError(field: string, requirement: string): Error {
  return new Error(`goal-continuity: \`${field}\` ${requirement}`)
}

/** Integer block-review fields and their accepted inclusive range. */
const BLOCK_REVIEW_INTEGER_RANGES = {
  blockedAfterConsecutiveRounds: [1, 1000],
  timeoutMs: [50, 3_600_000],
  maxReviewsPerGoal: [0, 100],
} as const satisfies Record<string, readonly [number, number]>

/** Validate one nested block-review policy and apply the documented defaults. */
function resolveBlockReview(raw: unknown): ResolvedBlockReviewConfig {
  const input = raw === undefined ? {} : raw
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw fieldError('blockReview', 'must be an object')
  }
  const record = input as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(DEFAULT_BLOCK_REVIEW_CONFIG, key)) {
      throw new Error(`goal-continuity: unknown config field "blockReview.${key}"`)
    }
  }

  const boolean = (field: 'enabled'): boolean => {
    const value = record[field]
    if (value === undefined) return DEFAULT_BLOCK_REVIEW_CONFIG[field]
    if (typeof value !== 'boolean') throw fieldError(`blockReview.${field}`, 'must be a boolean')
    return value
  }
  const text = (field: 'provider' | 'model' | 'reasoningEffort' | 'reviewerPreset'): string => {
    const value = record[field]
    if (value === undefined) return DEFAULT_BLOCK_REVIEW_CONFIG[field]
    if (typeof value !== 'string' || value.trim() === '') {
      throw fieldError(`blockReview.${field}`, 'must be a non-empty string')
    }
    return value
  }
  const integer = (field: keyof typeof BLOCK_REVIEW_INTEGER_RANGES): number => {
    const value = record[field]
    if (value === undefined) return DEFAULT_BLOCK_REVIEW_CONFIG[field]
    const [min, max] = BLOCK_REVIEW_INTEGER_RANGES[field]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw fieldError(`blockReview.${field}`, `must be an integer between ${min} and ${max}`)
    }
    return value
  }
  const policy = (field: 'onReviewError' | 'onUnavailable' | 'onExhausted'): 'deny' | 'allow' => {
    const value = record[field]
    if (value === undefined) return DEFAULT_BLOCK_REVIEW_CONFIG[field]
    if (value !== 'deny' && value !== 'allow') {
      throw fieldError(`blockReview.${field}`, 'must be "deny" or "allow"')
    }
    return value
  }

  return Object.freeze({
    enabled: boolean('enabled'),
    provider: text('provider'),
    model: text('model'),
    reasoningEffort: text('reasoningEffort'),
    reviewerPreset: text('reviewerPreset'),
    blockedAfterConsecutiveRounds: integer('blockedAfterConsecutiveRounds'),
    timeoutMs: integer('timeoutMs'),
    maxReviewsPerGoal: integer('maxReviewsPerGoal'),
    onReviewError: policy('onReviewError'),
    onUnavailable: policy('onUnavailable'),
    onExhausted: policy('onExhausted'),
  })
}

/**
 * Validate the row configuration fail-loud and apply the documented defaults.
 * @param raw - the loader-supplied config object, or undefined when the row has none.
 * @returns an immutable complete configuration.
 * @throws when a field is unknown, mistyped, or outside its allowed range.
 */
export function resolveConfig(raw: unknown): ResolvedConfig {
  const input = raw === undefined ? {} : raw
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('goal-continuity: config must be an object')
  }
  const record = input as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(DEFAULT_CONFIG, key)) {
      throw new Error(`goal-continuity: unknown config field "${key}"`)
    }
  }

  const boolean = (field: 'enabled' | 'resumeAfterRestart'): boolean => {
    const value = record[field]
    if (value === undefined) return DEFAULT_CONFIG[field]
    if (typeof value !== 'boolean') throw fieldError(field, 'must be a boolean')
    return value
  }
  const integer = (field: IntegerField): number => {
    const value = record[field]
    if (value === undefined) return DEFAULT_CONFIG[field]
    const [min, max] = INTEGER_RANGES[field]
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw fieldError(field, `must be an integer between ${min} and ${max}`)
    }
    return value
  }

  const rawResumeAfterUserStop = record.resumeAfterUserStop
  const resumeAfterUserStop =
    rawResumeAfterUserStop === undefined
      ? DEFAULT_CONFIG.resumeAfterUserStop
      : rawResumeAfterUserStop
  if (resumeAfterUserStop !== 'non-goal' && resumeAfterUserStop !== 'never') {
    throw fieldError('resumeAfterUserStop', 'must be "non-goal" or "never"')
  }

  return Object.freeze({
    enabled: boolean('enabled'),
    resumeAfterRestart: boolean('resumeAfterRestart'),
    resumeAfterUserStop,
    maxSessionResumes: integer('maxSessionResumes'),
    roundExtension: integer('roundExtension'),
    maxRoundExtensions: integer('maxRoundExtensions'),
    hardMaxGoalRounds: integer('hardMaxGoalRounds'),
    blockReview: resolveBlockReview(record.blockReview),
  })
}

/** Why an automatic resume is suppressed until the next direct user message. */
interface Suppression {
  readonly cause: StopCause
  /** A terminal stop blocks an active goal; a user stop only suppresses. */
  readonly terminal: boolean
  readonly detail: string
}

/** The cause named in a notice or block. */
type StopCause =
  | 'reset'
  | 'non-goal-stop'
  | 'restart'
  | 'in-process-disarm'
  | 'goal-round-stop'
  | 'user-stop-never'
  | 'user-pause'
  | 'user-clear'
  | 'user-complete'
  | 'model-reported'
  | 'final-hook'
  | 'unknown-hook'
  | 'max-tokens'
  | 'agent-error'
  | 'parent-stop'
  | 'round-limit'

/** Outcome of one attempted automatic resume. */
type ResumeResult = 'resumed' | 'exhausted' | 'failed'

/** Outcome of one cap-extension attempt. */
type CapEdit =
  | { readonly kind: 'edited'; readonly goal: GoalView }
  | { readonly kind: 'resumable'; readonly goal: GoalView }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' }

/** Per-agent supervisor state; the WeakMap and agent/disposed bound its life. */
interface AgentState {
  /** Current turn number, or null before the first observed turn. */
  turn: number | null
  /** Whether the current turn admitted a goal round. */
  goalRound: boolean
  /** Automatic resumes used in this session; never refilled by a goal round. */
  resumes: number
  /** Cap extensions used per goal id. */
  extensions: Map<string, number>
  /** Active suppression, cleared only by a direct user message. */
  suppression: Suppression | null
  /** The first observation is a restart and its policy has not been applied yet. */
  restartPending: boolean
  /** Whether the agent has been observed once. */
  observed: boolean
  /** A reconciliation is queued. */
  pending: boolean
  /** The cause the next reconciliation should name. */
  cause: StopCause | null
  /** The blocked goal revision already explained by a native-block refusal. */
  refusal: string | null
}

/** The three kinds of hook cancellation a turn can carry. */
type HookCause = 'reset' | 'final' | 'unknown'

/** Only a root session is supervised; forks and subagents are left untouched. */
function isRootAgent(agent: Agent): boolean {
  const header = agent.session.header
  return (
    header.origin !== 'subagent' &&
    (header.delegationDepth ?? 0) === 0 &&
    header.parentSession === undefined
  )
}

/** Classify one hook cancellation by its machine-readable reason prefix. */
function hookCause(reason: TurnEndReason): HookCause | undefined {
  if (reason.kind !== 'aborted' || reason.reason.kind !== 'hook') return undefined
  if (reason.reason.reason.startsWith('loop-guard:reset:')) return 'reset'
  if (reason.reason.reason.startsWith('loop-guard:final:')) return 'final'
  return 'unknown'
}

/** Whether a cause is a specific signal that outranks a generic disarm. */
function isSpecificCause(cause: StopCause): boolean {
  return cause !== 'in-process-disarm' && cause !== 'restart'
}

/** Human-readable cause used by notices and block reasons. */
function causeLabel(cause: StopCause): string {
  switch (cause) {
    case 'reset':
      return 'a recoverable loop-guard reset'
    case 'non-goal-stop':
      return 'your Stop on a turn that was not a goal round'
    case 'restart':
      return 'a session restart'
    case 'in-process-disarm':
      return 'an in-process disarm'
    case 'goal-round-stop':
      return 'your Stop during a goal round'
    case 'user-stop-never':
      return 'your Stop on a turn that was not a goal round'
    case 'user-pause':
      return 'your pause'
    case 'user-clear':
      return 'your clear'
    case 'user-complete':
      return 'completion'
    case 'model-reported':
      return 'a model-reported blocker'
    case 'final-hook':
      return 'the loop-guard final stop'
    case 'unknown-hook':
      return 'an unrecognized hook cancellation'
    case 'max-tokens':
      return 'the token limit'
    case 'agent-error':
      return 'an agent error'
    case 'parent-stop':
      return 'a parent cancellation'
    case 'round-limit':
      return 'the round limit'
  }
}

/** Bound one string without splitting a multi-byte code point. */
function bound(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

/** Exact current ref for one goal view. */
function goalRef(goal: GoalView): GoalRef {
  return { id: goal.id, revision: goal.revision }
}

/** Whether a rejected mutation is a compare-and-set stale reference. */
function isStale(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'GOAL_STALE_REVISION'
  )
}

/** Build one frozen, bounded, non-waking notice. */
function createNotice(text: string, summary: string): UserMessage {
  return Object.freeze({
    id: randomUUID() as MessageId,
    role: 'user',
    content: Object.freeze([{ type: 'text' as const, text: bound(text, NOTICE_TEXT_MAX_CHARS) }]),
    source: Object.freeze({
      kind: 'goal-continuity' as const,
      form: 'notice' as const,
      summary: bound(summary, CONTEXT_SUMMARY_MAX_CHARS),
    }),
  })
}

/** Deliver one non-waking notice; a disposed agent fails open. */
function deliverNotice(agent: Agent, text: string, summary: string): void {
  try {
    agent.inject(createNotice(text, summary))
  } catch {
    // A disposed agent simply receives no notice.
  }
}

/**
 * Independent block review: the only model call in this plugin. It reviews one
 * proposed `blocked` update and returns a tool-call decision; it never starts,
 * continues, or cancels a turn and never mutates the goal.
 */

/** Read-only tools the reviewer preset mounts and the child-scope allowlist admits. */
const REVIEWER_TOOLS = Object.freeze(['read', 'grep', 'glob'])

/** Local workspace state: goal-scoped review records and the machine-local grant ledger. */
const BLOCK_REVIEW_DIR = join('.dsh', 'goal-continuity', 'block-review')
const GRANTS_PATH = join('.dsh', 'goal-continuity', 'grants.json')

/** Bounds for the evidence bundle and the model-facing strings. */
const MAX_TOOL_ARGUMENT_CHARS = 400
const MAX_TOOL_RESULT_CHARS = 500
const MAX_TOOL_CALLS_PER_ROUND = 8
const EVIDENCE_ROUNDS = 3
const MAX_EVIDENCE_USER_MESSAGES = 5
const MAX_USER_MESSAGE_CHARS = 800
const MAX_RUNTIME_POLICY_CHARS = 600
const MAX_INSTRUCTIONS_CHARS = 6000
const MAX_GRANTS_CHARS = 4000
const MAX_REVIEW_PROMPT_CHARS = 24_000
const MAX_VERDICT_EVIDENCE = 5
const MAX_VERDICT_EVIDENCE_CHARS = 300
const MAX_REVIEW_ACTION_CHARS = 400
const MAX_DENY_REASON_CHARS = 1200

/** Visible error codes: a denial names its cause and the record. */
const REJECTED_CODE = 'GOAL_BLOCK_REVIEW_REJECTED'
const UNAVAILABLE_CODE = 'GOAL_BLOCK_REVIEW_UNAVAILABLE'
const REVIEW_ERROR_CODE = 'GOAL_BLOCK_REVIEW_ERROR'
const EXHAUSTED_CODE = 'GOAL_BLOCK_REVIEW_EXHAUSTED'

/** The reviewer's read-only preset id, selected only by this gate. */
const REVIEW_LABEL = 'goal-block-review'

/** Scope-restriction failures are configuration problems, not review errors. */
const SCOPE_FAILURE_PREFIX = 'goal-continuity: reviewer scope restriction failed'

/** Bundled reviewer instructions; resolved beside `lib/index.js`, read lazily. */
const assetsDirectory = fileURLToPath(new URL('../assets', import.meta.url))

/** One reviewer execution target, kept in the record without machine paths. */
interface ReviewTarget {
  readonly provider: string
  readonly model?: string
  readonly reasoningEffort?: string
  readonly preset: string
}

/** The strict verdict the reviewer must return. */
interface ReviewVerdict {
  readonly verdict: 'blocker' | 'not-blocker'
  readonly userAction?: string
  readonly nextStep?: string
  readonly evidence: readonly string[]
  readonly confidence?: string
}

/** The outcome of one attempted review. */
type ReviewOutcome =
  | { readonly kind: 'reviewed'; readonly verdict: ReviewVerdict; readonly target: ReviewTarget }
  | { readonly kind: 'unavailable'; readonly detail: string }
  | { readonly kind: 'error'; readonly detail: string; readonly started: boolean }

/** One tool call and its bounded result inside one goal round. */
interface EvidenceCall {
  readonly name: string
  readonly arguments: string
  result: string
}

/** One of the last goal rounds admitted before the block proposal. */
interface EvidenceRound {
  readonly round: number
  readonly calls: readonly EvidenceCall[]
}

/** The bounded, redacted evidence bundle; never contains the raw workspace path. */
interface ReviewEvidence {
  readonly objective: string
  readonly blockReason: string
  readonly rounds: readonly EvidenceRound[]
  readonly userMessages: readonly string[]
  readonly runtimePolicy: string
  readonly workspaceInstructions: string
  readonly grants: string
}

/** What the current open turn says about the block proposal. */
interface OpenTurn {
  readonly directMessages: readonly string[]
  readonly goalRound: boolean
}

/** One written review record. Local state: never a tracked file. */
interface BlockReviewRecord {
  version: 1
  goal: string
  revision: number
  objective: string
  digest: string
  verdict: 'blocker' | 'not-blocker' | 'unavailable' | 'review-error' | 'exhausted'
  verified: boolean
  reviewed: boolean
  userAction?: string
  nextStep?: string
  evidence: readonly string[]
  evidenceSummary: {
    rounds: number
    toolCalls: number
    userMessages: number
    runtimePolicy: string
    grantsPresent: boolean
    instructionsChars: number
  }
  target: ReviewTarget
  policy?: 'onUnavailable' | 'onReviewError' | 'onExhausted'
  detail?: string
  time: string
  session: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One line of failure detail, bounded for a record or a notice. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Read one optional service without failing the host when it is not mounted. */
function optionalService<T>(ctx: Context, name: string): T | undefined {
  try {
    return (ctx as unknown as { get(key: string): unknown }).get(name) as T | undefined
  } catch {
    return undefined
  }
}

/** Read the current goal without letting a goal-domain failure reach the gate. */
function readCurrentGoal(ctx: Context, agent: Agent): GoalView | undefined {
  try {
    return ctx.goals.get(agent)
  } catch {
    return undefined
  }
}

/** Text of one model-facing message. */
function messageText(message: UserMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n')
}

/** The session's committed events, or an empty list when the log is unavailable. */
function sessionEvents(agent: Agent): readonly SessionEvent[] {
  try {
    return agent.session.snapshotEvents()
  } catch {
    return []
  }
}

/** The current workspace directory, with the session header as the fallback. */
function workspaceFor(ctx: Context, agent: Agent): string {
  const service = optionalService<WorkingDirectoryService>(ctx, 'workingDirectory')
  if (service !== undefined) {
    try {
      return service.get(agent.session)
    } catch {
      // Fall through to the durable header.
    }
  }
  return agent.session.header.cwd ?? process.cwd()
}

/** Replace machine paths and obvious credentials before any evidence leaves the workspace. */
function redact(text: string, workspace: string): string {
  let output = text
  for (const candidate of [workspace, workspace.replaceAll('\\', '/')]) {
    if (candidate !== '') output = output.split(candidate).join('[workspace]')
  }
  return output
    .replace(/[A-Za-z]:[\\/][^\s"'`<>|]*/gu, '[path]')
    .replace(/\\\\[^\s"'`<>|]+/gu, '[path]')
    .replace(/\/(?:home|Users)\/[^\s"'`<>|]*/gu, '[path]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, '[redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer [redacted]')
    .replace(/\b(api[_-]?key|token|password|secret)\b\s*[:=]\s*[^\s,;]+/giu, '$1=[redacted]')
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
      '[redacted private key]',
    )
}

/** Read a bounded text file; a missing file is a named absence, not an error. */
function readBoundedFile(path: string, max: number): string {
  try {
    return readFileSync(path, 'utf8').slice(0, max)
  } catch {
    return '(missing)'
  }
}

/** The current open turn's direct user messages and whether this is the exact goal round. */
function openTurn(agent: Agent, goal: GoalView): OpenTurn {
  const events = sessionEvents(agent)
  let start = 0
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === 'turn/start') {
      start = index
      break
    }
  }
  const directMessages: string[] = []
  let goalRound = false
  for (let index = start; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'user/message') continue
    const source = event.data.source
    if (source.kind === 'user') {
      directMessages.push(bound(messageText(event.data), MAX_USER_MESSAGE_CHARS))
    } else if (
      source.kind === 'goal' &&
      source.goalId === goal.id &&
      source.revision === goal.revision &&
      source.round === goal.roundsStarted
    ) {
      goalRound = true
    }
  }
  return { directMessages: directMessages.slice(-3), goalRound }
}

/** Bounded explicit block-request vocabulary; anything else is reviewed. */
const EXPLICIT_BLOCK_PATTERNS = [
  /\b(?:please\s+)?(?:mark|report|declare|call|set)\s+(?:(?:the|this|it|my|our)\s+)*(?:goal\s+)?(?:as\s+)?(?:blocked|a blocker)\b/iu,
  /\b(?:the|this)\s+goal\s+(?:is|should be|can be)\s+(?:marked\s+)?(?:blocked|a blocker)\b/iu,
  /\byou\s+(?:can|may|should)\s+(?:mark|report|declare)\s+(?:it|the goal)\s+(?:as\s+)?blocked\b/iu,
  /\b(?:block|stop)\s+(?:the|this)\s+goal\b/iu,
]

/** Whether the open turn explicitly requested the block (a bounded text check). */
function explicitBlockRequest(messages: readonly string[]): boolean {
  return messages.some((message) =>
    EXPLICIT_BLOCK_PATTERNS.some((pattern) => pattern.test(message)),
  )
}

/** Format one tool result's text blocks. */
function toolResultText(event: Extract<SessionEvent, { type: 'tool/result' }>): string {
  return event.data.message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
}

/** The runtime permission policy from one runtime-context snapshot message. */
function runtimePolicyFrom(message: UserMessage, workspace: string): string {
  const source = message.source as unknown as {
    form?: string
    sections?: ReadonlyArray<{ name?: string; text?: string }>
  }
  if (source.form === 'snapshot' && Array.isArray(source.sections)) {
    const parts = source.sections
      .filter((section) =>
        /sandbox|permission|policy|approval|file/iu.test(
          `${section.name ?? ''} ${section.text ?? ''}`,
        ),
      )
      .map((section) => section.text ?? '')
      .filter((text) => text !== '')
    if (parts.length > 0) {
      return bound(redact(parts.join('\n'), workspace), MAX_RUNTIME_POLICY_CHARS)
    }
  }
  return bound(redact(messageText(message), workspace), MAX_RUNTIME_POLICY_CHARS)
}

/** Build the bounded, redacted evidence bundle from the session log and workspace files. */
function buildEvidence(
  agent: Agent,
  goal: GoalView,
  blockReason: string,
  workspace: string,
): ReviewEvidence {
  const events = sessionEvents(agent)
  const buckets = new Map<number, EvidenceCall[]>()
  const called = new Map<string, EvidenceCall>()
  let round: number | undefined
  const userMessages: string[] = []
  let runtimePolicy = '(not found)'

  for (const event of events) {
    if (event.type === 'turn/start') {
      round = undefined
      continue
    }
    if (event.type === 'user/message') {
      const source = event.data.source
      const sourceKind = (source as { kind: string }).kind
      if (sourceKind === 'runtime-context') {
        runtimePolicy = runtimePolicyFrom(event.data, workspace)
        continue
      }
      if (source.kind === 'goal') {
        if (source.goalId !== goal.id) {
          round = undefined
          continue
        }
        round = source.round
        if (!buckets.has(round)) buckets.set(round, [])
        continue
      }
      if (source.kind === 'user') {
        round = undefined
        userMessages.push(bound(redact(messageText(event.data), workspace), MAX_USER_MESSAGE_CHARS))
      }
      continue
    }
    if (event.type === 'tool/call' && round !== undefined) {
      const calls = buckets.get(round)
      if (calls !== undefined) {
        const call: EvidenceCall = {
          name: bound(event.data.name, 80),
          arguments: bound(redact(event.data.arguments, workspace), MAX_TOOL_ARGUMENT_CHARS),
          result: '',
        }
        calls.push(call)
        called.set(event.data.callId, call)
      }
      continue
    }
    if (event.type === 'tool/result') {
      const call = called.get(event.data.message.toolCallId)
      if (call !== undefined && call.result === '') {
        call.result = bound(redact(toolResultText(event), workspace), MAX_TOOL_RESULT_CHARS)
      }
    }
  }

  const rounds = [...buckets.entries()]
    .filter(([number]) => number <= goal.roundsStarted)
    .sort(([left], [right]) => left - right)
    .slice(-EVIDENCE_ROUNDS)
    .map(([number, calls]) => ({
      round: number,
      calls: calls.slice(-MAX_TOOL_CALLS_PER_ROUND),
    }))

  return {
    objective: bound(redact(goal.objective, workspace), 2000),
    blockReason: bound(redact(blockReason, workspace), 2000),
    rounds,
    userMessages: userMessages.slice(-MAX_EVIDENCE_USER_MESSAGES),
    runtimePolicy,
    workspaceInstructions: redact(
      readBoundedFile(join(workspace, 'AGENTS.md'), MAX_INSTRUCTIONS_CHARS),
      workspace,
    ),
    grants: redact(readBoundedFile(join(workspace, GRANTS_PATH), MAX_GRANTS_CHARS), workspace),
  }
}

/** SHA-256 over the objective, block reason, and the redacted evidence bundle. */
function evidenceDigest(objective: string, blockReason: string, evidence: ReviewEvidence): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        objective,
        blockReason,
        rounds: evidence.rounds,
        userMessages: evidence.userMessages,
        runtimePolicy: evidence.runtimePolicy,
        workspaceInstructions: evidence.workspaceInstructions,
        grants: evidence.grants,
      }),
    )
    .digest('hex')
}

/** One filesystem-safe goal directory name. */
function goalDirectoryName(goalId: string): string {
  const safe = goalId.replace(/[^A-Za-z0-9._-]+/gu, '_').slice(0, 80)
  return safe === '' ? createHash('sha256').update(goalId).digest('hex').slice(0, 16) : safe
}

/** Goal-scoped record directory under the workspace's local state. */
function recordDirectory(workspace: string, goalId: string): string {
  return join(workspace, BLOCK_REVIEW_DIR, goalDirectoryName(goalId))
}

/** The digest-addressed record path for one proposal. */
function recordPathFor(workspace: string, goalId: string, digest: string): string {
  return join(recordDirectory(workspace, goalId), `${digest}.json`)
}

/** The workspace-relative record path shown in model-facing text (never an absolute path). */
function displayRecordPath(workspace: string, goalId: string, digest: string): string {
  const path = recordPathFor(workspace, goalId, digest)
  return path.slice(workspace.length).replaceAll('\\', '/').replace(/^\//u, '')
}

/** Read one record object; an absent or malformed file is no record. */
function readRecordFile(path: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!isRecord(value) || value.version !== 1) return undefined
    return value
  } catch {
    return undefined
  }
}

/** A stored reviewed verdict for this exact proposal, if one exists. */
function cachedVerdict(
  workspace: string,
  goalId: string,
  digest: string,
): ReviewVerdict | undefined {
  const record = readRecordFile(recordPathFor(workspace, goalId, digest))
  if (record === undefined || record.digest !== digest) return undefined
  if (record.verified !== true) return undefined
  const evidence = Array.isArray(record.evidence)
    ? record.evidence.filter((item): item is string => typeof item === 'string')
    : []
  if (record.verdict === 'blocker') {
    if (typeof record.userAction !== 'string' || record.userAction === '') return undefined
    return { verdict: 'blocker', userAction: record.userAction, evidence }
  }
  if (record.verdict === 'not-blocker') {
    if (typeof record.nextStep !== 'string' || record.nextStep === '') return undefined
    return { verdict: 'not-blocker', nextStep: record.nextStep, evidence }
  }
  return undefined
}

/** Count the reviews this goal has actually spent; policy records do not count. */
async function countReviews(workspace: string, goalId: string): Promise<number> {
  let names: string[]
  try {
    names = await readdir(recordDirectory(workspace, goalId))
  } catch {
    return 0
  }
  let count = 0
  for (const name of names.slice(0, 500)) {
    if (!name.endsWith('.json')) continue
    const record = readRecordFile(join(recordDirectory(workspace, goalId), name))
    if (record !== undefined && record.reviewed === true) count += 1
  }
  return count
}

/** Write one local record atomically; the gate never fails a session on an audit write. */
async function writeRecord(path: string, record: BlockReviewRecord): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await rename(temporary, path)
  } catch {
    // Audit state is best-effort: the tool decision is already determined.
  }
}

/** Parse exactly one strict verdict; anything else is a review error. */
function parseVerdict(text: string, workspace: string): ReviewVerdict {
  const blocks: string[] = []
  const fence = /```[ \t]*[A-Za-z0-9_-]*[ \t]*\r?\n([\s\S]*?)```/gu
  for (const match of text.matchAll(fence)) blocks.push(match[1] ?? '')
  if (blocks.length === 0) throw new Error('the reviewer returned no fenced JSON verdict')
  if (blocks.length > 1) {
    throw new Error(
      `the reviewer returned ${blocks.length} fenced blocks; exactly one verdict is required`,
    )
  }
  let value: unknown
  try {
    value = JSON.parse(blocks[0] as string)
  } catch (error) {
    throw new Error(`the fenced verdict is not valid JSON: ${errorMessage(error)}`)
  }
  if (!isRecord(value)) throw new Error('the fenced verdict must be a JSON object')
  const allowed = new Set(['verdict', 'userAction', 'nextStep', 'evidence', 'confidence'])
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`the verdict has unknown field "${key}"`)
  }

  const nonEmpty = (field: string, raw: unknown): string => {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error(`the verdict "${field}" must be a non-empty string`)
    }
    return bound(redact(raw.trim(), workspace), MAX_REVIEW_ACTION_CHARS)
  }
  const optionalEvidence = (raw: unknown): string[] => {
    if (raw === undefined) return []
    if (!Array.isArray(raw)) throw new Error('the verdict "evidence" must be a list')
    if (raw.length > MAX_VERDICT_EVIDENCE) {
      throw new Error(`the verdict "evidence" must list at most ${MAX_VERDICT_EVIDENCE} items`)
    }
    return raw.map((item) => {
      if (typeof item !== 'string' || item.trim() === '') {
        throw new Error('every verdict evidence item must be a non-empty string')
      }
      return bound(redact(item.trim(), workspace), MAX_VERDICT_EVIDENCE_CHARS)
    })
  }

  const evidence = optionalEvidence(value.evidence)
  const confidence =
    value.confidence === undefined ? undefined : nonEmpty('confidence', value.confidence)
  if (value.verdict === 'blocker') {
    if (value.nextStep !== undefined && value.nextStep !== null) {
      throw new Error('a blocker verdict cannot also carry a nextStep')
    }
    return {
      verdict: 'blocker',
      userAction: nonEmpty('userAction', value.userAction),
      evidence,
      ...(confidence === undefined ? {} : { confidence }),
    }
  }
  if (value.verdict === 'not-blocker') {
    if (value.userAction !== undefined && value.userAction !== null) {
      throw new Error('a not-blocker verdict cannot also carry a userAction')
    }
    return {
      verdict: 'not-blocker',
      nextStep: nonEmpty('nextStep', value.nextStep),
      evidence,
      ...(confidence === undefined ? {} : { confidence }),
    }
  }
  throw new Error('the verdict must be "blocker" or "not-blocker"')
}

/** The bundled reviewer instructions; a missing asset is a review error. */
let reviewerInstructions: string | undefined
function loadReviewerInstructions(): string {
  if (reviewerInstructions === undefined) {
    reviewerInstructions = readFileSync(join(assetsDirectory, 'blocker-review.md'), 'utf8').trim()
  }
  return reviewerInstructions
}

/** Render the bounded reviewer prompt: instructions first, then the evidence bundle. */
function composeReviewPrompt(evidence: ReviewEvidence, workspace: string, goal: GoalView): string {
  const lines = [
    loadReviewerInstructions(),
    '',
    '## Review evidence',
    '',
    `- Workspace (read-only): ${workspace}`,
    `- Objective: ${evidence.objective}`,
    `- Rounds started: ${goal.roundsStarted} of ${goal.maxGoalRounds}`,
    `- Block reason: ${evidence.blockReason}`,
    '',
    '### Last goal rounds',
  ]
  if (evidence.rounds.length === 0) lines.push('(no goal-round tool activity recorded)')
  for (const round of evidence.rounds) {
    lines.push('', `Round ${round.round}:`)
    if (round.calls.length === 0) lines.push('- (no tool calls)')
    for (const call of round.calls) {
      lines.push(`- ${call.name} ${call.arguments}`)
      if (call.result !== '') lines.push(`  result: ${call.result}`)
    }
  }
  lines.push('', '### User messages (most recent last)')
  if (evidence.userMessages.length === 0) lines.push('(none recorded)')
  for (const message of evidence.userMessages) lines.push('', message)
  lines.push(
    '',
    '### Runtime permission policy',
    '',
    evidence.runtimePolicy,
    '',
    '### Workspace instructions (AGENTS.md)',
    '',
    evidence.workspaceInstructions,
    '',
    '### Standing grants (.dsh/goal-continuity/grants.json)',
    '',
    evidence.grants,
    '',
    'Return exactly one fenced JSON block in the schema the instructions require.',
  )
  return bound(lines.join('\n'), MAX_REVIEW_PROMPT_CHARS)
}

/** Output text of one settled subagent run. */
function outputText(output: readonly { type: string; text?: string }[]): string {
  const blocks: string[] = []
  for (const block of output) {
    if (block.type === 'text' && typeof block.text === 'string') blocks.push(block.text)
  }
  return blocks.join('\n').trim()
}

/** Await one review with a wall-clock bound and caller cancellation. */
async function awaitReview(
  activation: SubagentActivation,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<
  | { readonly kind: 'result'; readonly value: Awaited<SubagentActivation['result']> }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'aborted' }
  | { readonly kind: 'threw'; readonly error: unknown }
> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      activation.result.then(
        (value) => ({ kind: 'result' as const, value }),
        (error: unknown) => ({ kind: 'threw' as const, error }),
      ),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs)
      }),
      new Promise<{ kind: 'aborted' }>((resolve) => {
        abort = () => resolve({ kind: 'aborted' })
        if (signal.aborted) abort()
        else signal.addEventListener('abort', abort, { once: true })
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (abort !== undefined) signal.removeEventListener('abort', abort)
  }
}

/** Start and settle one read-only reviewer child. */
async function runReview(
  ctx: Context,
  agent: Agent,
  workspace: string,
  prompt: string,
  config: ResolvedBlockReviewConfig,
  signal: AbortSignal,
): Promise<ReviewOutcome> {
  const target: ReviewTarget = {
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    preset: config.reviewerPreset,
  }
  const subagents = optionalService<SubagentRuntime>(ctx, 'subagents')
  if (subagents === undefined) {
    return { kind: 'unavailable', detail: 'the subagent service is not mounted' }
  }
  let provider: SubagentProvider | undefined
  try {
    provider = subagents.getProvider(config.provider)
  } catch (error) {
    return {
      kind: 'unavailable',
      detail: `the provider registry failed: ${errorMessage(error)}`,
    }
  }
  if (provider === undefined) {
    let registered: string[] = []
    try {
      registered = subagents.list()
    } catch {
      // Keep the diagnostic after the provider lookup.
    }
    return {
      kind: 'unavailable',
      detail: `provider "${config.provider}" is not registered (registered: ${registered.join(', ') || 'none'})`,
    }
  }
  if (provider.capabilities?.agentPreset !== true) {
    return {
      kind: 'unavailable',
      detail: `provider "${provider.name}" does not support an independent agent preset`,
    }
  }
  if (provider.inheritsParentContext === true) {
    return {
      kind: 'unavailable',
      detail: `provider "${provider.name}" inherits the parent context; the reviewer needs a fresh context`,
    }
  }

  const agentOptions: { model?: string; reasoningEffort?: AgentOptions['reasoningEffort'] } = {}
  if (provider.capabilities.agentOptions === true) {
    agentOptions.model = config.model
    agentOptions.reasoningEffort = config.reasoningEffort as AgentOptions['reasoningEffort']
  }
  let activation: SubagentActivation
  try {
    activation = await subagents.startActivation({
      provider: provider.name,
      label: REVIEW_LABEL,
      request: {
        prompt: [{ type: 'text', text: prompt }],
        parent: agent,
        cwd: workspace,
        agentPreset: config.reviewerPreset,
        ...(Object.keys(agentOptions).length === 0 ? {} : { agentOptions }),
      },
      signal,
      delivery: 'caller',
    })
  } catch (error) {
    const message = errorMessage(error)
    if (message.startsWith(SCOPE_FAILURE_PREFIX)) return { kind: 'unavailable', detail: message }
    // A missing or disabled preset is a configuration problem; the manager's
    // mount diagnostic names it, so follow the unavailable policy.
    if (/agent preset|agentPreset|preset/iu.test(message)) {
      return { kind: 'unavailable', detail: message }
    }
    return { kind: 'error', detail: `the reviewer could not start: ${message}`, started: false }
  }

  try {
    const settled = await awaitReview(activation, config.timeoutMs, signal)
    if (settled.kind === 'timeout') {
      return {
        kind: 'error',
        detail: `the review did not finish within ${config.timeoutMs} ms`,
        started: true,
      }
    }
    if (settled.kind === 'aborted') {
      return { kind: 'error', detail: 'the review was cancelled', started: true }
    }
    if (settled.kind === 'threw') {
      return {
        kind: 'error',
        detail: `the review failed: ${errorMessage(settled.error)}`,
        started: true,
      }
    }
    if (settled.value.stopReason !== 'completed') {
      const diagnostic =
        settled.value.diagnostic === undefined ? '' : `: ${settled.value.diagnostic}`
      return {
        kind: 'error',
        detail: `the reviewer stopped with "${settled.value.stopReason}"${diagnostic}`,
        started: true,
      }
    }
    let verdict: ReviewVerdict
    try {
      verdict = parseVerdict(outputText(settled.value.output), workspace)
    } catch (error) {
      return {
        kind: 'error',
        detail: `the reviewer verdict is invalid: ${errorMessage(error)}`,
        started: true,
      }
    }
    return { kind: 'reviewed', verdict, target }
  } finally {
    await activation.dispose().catch(() => undefined)
  }
}

/** Deny with the reviewer's next action and a visible code. */
function denyWith(reason: string, code: string): PreToolDecision {
  return {
    kind: 'deny',
    reason: bound(reason, MAX_DENY_REASON_CHARS),
    info: { name: 'goal-block-review', code },
  }
}

/** The tool decision for one strict verdict; a verified blocker gets a notice. */
function verdictDecision(
  agent: Agent,
  verdict: ReviewVerdict,
  reused: boolean,
  recordPath: string,
): PreToolDecision | undefined {
  if (verdict.verdict === 'not-blocker') {
    return denyWith(
      `The independent block review rejected this goal block: ${verdict.nextStep} The goal stays active. Do that next step now; do not ask the user for permission this review already covers. Record: ${recordPath}.`,
      REJECTED_CODE,
    )
  }
  deliverNotice(
    agent,
    `Block review ${reused ? '(cached) ' : ''}confirmed a user-only blocker. The closing message must name exactly this user action: ${verdict.userAction}. Record: ${recordPath}.`,
    'goal-continuity: block review confirmed a blocker',
  )
  return undefined
}

/** Record one policy decision without pretending it is a review verdict. */
async function recordPolicy(
  agent: Agent,
  workspace: string,
  goal: GoalView,
  digest: string,
  verdict: 'unavailable' | 'review-error' | 'exhausted',
  policy: 'onUnavailable' | 'onReviewError' | 'onExhausted',
  detail: string,
  target: ReviewTarget,
  reviewed: boolean,
  evidence: ReviewEvidence | undefined,
): Promise<string> {
  await writeRecord(recordPathFor(workspace, goal.id, digest), {
    version: 1,
    goal: goal.id,
    revision: goal.revision,
    objective: bound(redact(goal.objective, workspace), 500),
    digest,
    verdict,
    verified: false,
    reviewed,
    evidence: [],
    evidenceSummary: {
      rounds: evidence?.rounds.length ?? 0,
      toolCalls: evidence?.rounds.reduce((total, round) => total + round.calls.length, 0) ?? 0,
      userMessages: evidence?.userMessages.length ?? 0,
      runtimePolicy: bound(evidence?.runtimePolicy ?? '', 200),
      grantsPresent: evidence !== undefined && evidence.grants !== '(missing)',
      instructionsChars: evidence?.workspaceInstructions.length ?? 0,
    },
    target,
    policy,
    detail: bound(redact(detail, workspace), 1000),
    time: new Date().toISOString(),
    session: agent.session.id,
  })
  return displayRecordPath(workspace, goal.id, digest)
}

/** Visible notice for a policy-allowed unverified block. */
function notifyUnverified(
  agent: Agent,
  record: string,
  policy: 'onUnavailable' | 'onReviewError' | 'onExhausted',
  detail: string,
): void {
  deliverNotice(
    agent,
    `Block review allowed this goal block UNVERIFIED (${policy}: ${bound(detail, 300)}). Record: ${record}. The goal will block without a confirmed user-only action.`,
    `goal-continuity: unverified block allowed (${policy})`,
  )
}

/** Install the pre-execute gate and the reviewer child-scope allowlist. */
function installBlockReview(ctx: Context, config: ResolvedBlockReviewConfig): void {
  if (!config.enabled) return
  ctx.on('agent/created', ({ agent }) => {
    if (agent.session.header.origin !== 'subagent') return undefined
    if (agent.session.header.agentPreset !== config.reviewerPreset) return undefined
    try {
      const tools = agent.ctx.tools
      if (typeof tools?.restrict !== 'function') {
        throw new Error('the reviewer child scope has no tools service')
      }
      const dispose = tools.restrict({ allow: [...REVIEWER_TOOLS] })
      if (typeof dispose !== 'function') {
        throw new Error('the child-scope restriction returned no disposer')
      }
    } catch (error) {
      // Fail creation: the child must not run a single step without the allowlist.
      throw new Error(`${SCOPE_FAILURE_PREFIX}: ${errorMessage(error)}`)
    }
    return undefined
  })

  ctx.on('tools/pre-execute', async (exec, next) => {
    try {
      return await decide(exec, next)
    } catch {
      // An unexpected gate failure must not mask every tool call in the session.
      return next()
    }
  })

  async function decide(
    exec: ToolExecution,
    next: () => Promise<PreToolDecision>,
  ): Promise<PreToolDecision> {
    const agent = exec.agent
    if (agent === undefined || !isRootAgent(agent)) return next()
    if (exec.name !== 'update_goal') return next()
    const args = exec.arguments
    if (!isRecord(args) || args.action !== 'blocked') return next()
    const goal = readCurrentGoal(ctx, agent)
    if (goal === undefined || goal.phase !== 'active') return next()
    if (args.goal_id !== goal.id || args.revision !== goal.revision) return next()
    const blockReason = typeof args.blocked_reason === 'string' ? args.blocked_reason : ''
    if (blockReason.trim() === '') return next()
    const turn = openTurn(agent, goal)
    if (explicitBlockRequest(turn.directMessages)) return next()
    if (turn.goalRound && goal.roundsStarted < config.blockedAfterConsecutiveRounds) return next()

    const workspace = workspaceFor(ctx, agent)
    const evidence = buildEvidence(agent, goal, blockReason, workspace)
    const digest = evidenceDigest(goal.objective, blockReason, evidence)
    const record = displayRecordPath(workspace, goal.id, digest)
    const cached = cachedVerdict(workspace, goal.id, digest)
    if (cached !== undefined) return verdictDecision(agent, cached, true, record) ?? next()

    const target: ReviewTarget = {
      provider: config.provider,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      preset: config.reviewerPreset,
    }
    const reviewed = await countReviews(workspace, goal.id)
    if (reviewed >= config.maxReviewsPerGoal) {
      const detail = `the per-goal review budget (${config.maxReviewsPerGoal}) is exhausted`
      const written = await recordPolicy(
        agent,
        workspace,
        goal,
        digest,
        'exhausted',
        'onExhausted',
        detail,
        target,
        false,
        evidence,
      )
      if (config.onExhausted === 'allow') {
        notifyUnverified(agent, written, 'onExhausted', detail)
        return next()
      }
      return denyWith(
        `Block review rejected this proposal: ${detail}. The goal stays active. Continue the objective with another authorized route, or record why only the user can proceed; raising maxReviewsPerGoal allows another review. Record: ${record}.`,
        EXHAUSTED_CODE,
      )
    }

    let prompt: string
    try {
      prompt = composeReviewPrompt(evidence, workspace, goal)
    } catch (error) {
      const detail = `the reviewer prompt could not be built: ${errorMessage(error)}`
      const written = await recordPolicy(
        agent,
        workspace,
        goal,
        digest,
        'review-error',
        'onReviewError',
        detail,
        target,
        false,
        evidence,
      )
      if (config.onReviewError === 'allow') {
        notifyUnverified(agent, written, 'onReviewError', detail)
        return next()
      }
      return denyWith(
        `Block review could not run (${detail}) and onReviewError is "deny". The goal stays active. Fix the review target or set blockReview.onReviewError to "allow". Record: ${record}.`,
        REVIEW_ERROR_CODE,
      )
    }

    const outcome = await runReview(ctx, agent, workspace, prompt, config, exec.signal)
    if (outcome.kind === 'unavailable') {
      const detail = redact(outcome.detail, workspace)
      const written = await recordPolicy(
        agent,
        workspace,
        goal,
        digest,
        'unavailable',
        'onUnavailable',
        detail,
        target,
        false,
        evidence,
      )
      if (config.onUnavailable === 'allow') {
        notifyUnverified(agent, written, 'onUnavailable', detail)
        return next()
      }
      return denyWith(
        `Block review is unavailable (${detail}) and onUnavailable is "deny". The goal stays active. Fix the reviewer provider or preset, or set blockReview.onUnavailable to "allow". Record: ${record}.`,
        UNAVAILABLE_CODE,
      )
    }
    if (outcome.kind === 'error') {
      const detail = redact(outcome.detail, workspace)
      const written = await recordPolicy(
        agent,
        workspace,
        goal,
        digest,
        'review-error',
        'onReviewError',
        detail,
        target,
        outcome.started,
        evidence,
      )
      if (config.onReviewError === 'allow') {
        notifyUnverified(agent, written, 'onReviewError', detail)
        return next()
      }
      return denyWith(
        `Block review failed (${detail}) and onReviewError is "deny". The goal stays active. Fix the reviewer target or set blockReview.onReviewError to "allow". Record: ${record}.`,
        REVIEW_ERROR_CODE,
      )
    }

    const calls = evidence.rounds.reduce((total, round) => total + round.calls.length, 0)
    await writeRecord(recordPathFor(workspace, goal.id, digest), {
      version: 1,
      goal: goal.id,
      revision: goal.revision,
      objective: bound(redact(goal.objective, workspace), 500),
      digest,
      verdict: outcome.verdict.verdict,
      verified: true,
      reviewed: true,
      ...(outcome.verdict.userAction === undefined
        ? {}
        : { userAction: outcome.verdict.userAction }),
      ...(outcome.verdict.nextStep === undefined ? {} : { nextStep: outcome.verdict.nextStep }),
      evidence: outcome.verdict.evidence,
      evidenceSummary: {
        rounds: evidence.rounds.length,
        toolCalls: calls,
        userMessages: evidence.userMessages.length,
        runtimePolicy: bound(evidence.runtimePolicy, 200),
        grantsPresent: evidence.grants !== '(missing)',
        instructionsChars: evidence.workspaceInstructions.length,
      },
      target: outcome.target,
      time: new Date().toISOString(),
      session: agent.session.id,
    })
    const decision = verdictDecision(agent, outcome.verdict, false, record)
    return decision ?? next()
  }
}

/** The roster shape the Web client reads through `agentPresets/list`. */
interface PresetRoster {
  presets: readonly { id: string }[]
}

/** The registry's Remote projection of the roster; the gate never uses it. */
interface PresetRosterService {
  remoteExportList: () => Promise<PresetRoster>
}

/**
 * Keep the reviewer preset out of the human mode roster. The Web client builds
 * its picker from `agentPresets/list`, while the gate starts the reviewer
 * through the registry's `retain`/`resolve` path, so filtering this one Remote
 * projection hides the mode without touching the mounted composition.
 *
 * shortcut: this wraps the registry's dynamic Remote method; upgrade when DSH
 * ships a hidden-preset flag. A changed dispatch only reveals the preset again.
 */
function installReviewerPresetHiding(ctx: Context): void {
  ctx.inject(['agentPresets'], (scope) => {
    const service = scope.get('agentPresets') as Partial<PresetRosterService> | undefined
    const original = service?.remoteExportList
    if (service === undefined || typeof original !== 'function') return
    service.remoteExportList = async function (this: PresetRosterService) {
      const roster = await original.call(this)
      return {
        ...roster,
        presets: roster.presets.filter((preset) => preset.id !== REVIEWER_PRESET_ID),
      }
    }
    scope.effect(() => () => {
      service.remoteExportList = original
    })
  })
}

/**
 * Install the supervisor and the block-review gate. The configuration is
 * validated at load, so a bad profile fails loudly; supervision itself fails
 * open and the review failures follow their configured policies.
 */
export function apply(ctx: Context, config?: Config): void {
  const resolved = resolveConfig(config)
  if (!resolved.enabled) return
  installBlockReview(ctx, resolved.blockReview)
  installReviewerPresetHiding(ctx)
  const mountedAt = Date.now()

  const states = new WeakMap<Agent, AgentState>()

  function stateFor(agent: Agent): AgentState {
    let state = states.get(agent)
    if (state === undefined) {
      state = {
        turn: null,
        goalRound: false,
        resumes: 0,
        extensions: new Map(),
        suppression: null,
        restartPending: false,
        observed: false,
        pending: false,
        cause: null,
        refusal: null,
      }
      states.set(agent, state)
    }
    return state
  }

  /** Read the current goal without letting a goal-domain failure reach the session. */
  function readGoal(agent: Agent): GoalView | undefined {
    try {
      return ctx.goals.get(agent)
    } catch {
      return undefined
    }
  }

  /** Queue one reconciliation after the current dispatch settles. */
  function schedule(agent: Agent, state: AgentState, cause?: StopCause): void {
    if (cause !== undefined && (isSpecificCause(cause) || state.cause === null)) {
      state.cause = cause
    }
    if (state.pending) return
    state.pending = true
    queueMicrotask(() => {
      state.pending = false
      if (states.get(agent) !== state) return
      const next = state.cause
      state.cause = null
      try {
        reconcile(agent, state, next)
      } catch {
        // Fail open: supervision must never fail a session.
      }
    })
  }

  /** Disarm an armed active goal before the driver's idle pause can see it. */
  function preventPause(agent: Agent): void {
    const goal = readGoal(agent)
    if (goal === undefined || goal.phase !== 'active' || goal.activation !== 'armed') return
    try {
      ctx.goals.disarm(agent)
    } catch {
      // Fail open: a rejected disarm leaves the driver's pause in place.
    }
  }

  /** Resume once, retrying once on a stale revision. */
  function resumeWithRetry(agent: Agent, goal: GoalView): GoalView | undefined {
    try {
      return ctx.goals.resume(agent, goalRef(goal))
    } catch (error) {
      if (!isStale(error)) return undefined
      const current = readGoal(agent)
      if (current === undefined) return undefined
      if (current.phase === 'active') {
        if (current.activation !== 'disarmed') return undefined
      } else if (current.phase !== 'blocked' || current.blockedReason?.code !== 'round-limit') {
        return undefined
      }
      if (current.roundsStarted >= current.maxGoalRounds) return undefined
      try {
        return ctx.goals.resume(agent, goalRef(current))
      } catch {
        return undefined
      }
    }
  }

  /** Resume and deliver exactly one notice, or report why no resume happened. */
  function resumeAndNotify(
    agent: Agent,
    state: AgentState,
    goal: GoalView,
    cause: StopCause,
    extension?: { readonly from: number; readonly to: number; readonly used: number },
  ): ResumeResult {
    if (state.resumes >= resolved.maxSessionResumes) return 'exhausted'
    const resumed = resumeWithRetry(agent, goal)
    if (resumed === undefined) return 'failed'
    state.resumes += 1
    const remaining = resolved.maxSessionResumes - state.resumes
    const action =
      extension === undefined
        ? `resumed the goal after ${causeLabel(cause)}`
        : `extended the round cap from ${extension.from} to ${extension.to} (extension ${extension.used} of ${resolved.maxRoundExtensions}) and resumed the goal after ${causeLabel(cause)}`
    deliverNotice(
      agent,
      `Goal continuity ${action}. Automatic resume ${state.resumes} of ${resolved.maxSessionResumes} for this session; ${remaining} remain. Next: continue the current objective.`,
      `goal-continuity: ${extension === undefined ? 'resumed' : 'extended and resumed'} after ${causeLabel(cause)}`,
    )
    return 'resumed'
  }

  /** Edit the round cap, retrying once on a stale revision. */
  function editCap(agent: Agent, goal: GoalView, expected: 'active' | 'blocked'): CapEdit {
    const attempt = (current: GoalView): CapEdit => {
      if (current.roundsStarted < current.maxGoalRounds) return { kind: 'resumable', goal: current }
      const cap = current.maxGoalRounds + resolved.roundExtension
      if (cap > resolved.hardMaxGoalRounds) return { kind: 'unavailable' }
      try {
        return {
          kind: 'edited',
          goal: ctx.goals.edit(agent, goalRef(current), { maxGoalRounds: cap }),
        }
      } catch {
        return { kind: 'failed' }
      }
    }
    if (goal.roundsStarted < goal.maxGoalRounds) return { kind: 'resumable', goal }
    const cap = goal.maxGoalRounds + resolved.roundExtension
    if (cap > resolved.hardMaxGoalRounds) return { kind: 'unavailable' }
    try {
      return { kind: 'edited', goal: ctx.goals.edit(agent, goalRef(goal), { maxGoalRounds: cap }) }
    } catch (error) {
      if (!isStale(error)) return { kind: 'failed' }
      const current = readGoal(agent)
      if (current === undefined) return { kind: 'failed' }
      if (expected === 'active') {
        if (current.phase !== 'active' || current.activation !== 'disarmed') {
          return { kind: 'failed' }
        }
      } else if (current.phase !== 'blocked' || current.blockedReason?.code !== 'round-limit') {
        return { kind: 'failed' }
      }
      return attempt(current)
    }
  }

  /** Explain a resume that failed after an automatic cap decision. */
  function notifyResumeFailure(agent: Agent, goal: GoalView, from?: number): void {
    const action =
      from === undefined
        ? 'could not resume the goal automatically'
        : `extended the round cap from ${from} to ${goal.maxGoalRounds} but could not resume the goal automatically`
    deliverNotice(
      agent,
      `Goal continuity ${action}. Next: review the goal and resume with /goal resume.`,
      'goal-continuity: resume failed',
    )
  }

  /** Record a terminal refusal: block an active goal where allowed, keep a native block. */
  function terminate(
    agent: Agent,
    state: AgentState,
    goal: GoalView,
    cause: StopCause,
    detail: string,
    nextAction: string,
  ): void {
    const refusal = `${goal.id}:${goal.revision}`
    if (goal.phase === 'blocked' && state.refusal === refusal) return
    const remaining = resolved.maxSessionResumes - state.resumes
    const budget = `Automatic resumes used ${state.resumes} of ${resolved.maxSessionResumes} for this session (${remaining} remain).`
    const message = bound(
      `Goal continuity stopped automatic continuation after ${causeLabel(cause)}: ${detail}. ${budget} Next: ${nextAction}.`,
      BLOCK_MESSAGE_MAX_CHARS,
    )
    if (goal.phase === 'active') {
      try {
        ctx.goals.block(agent, goalRef(goal), { code: 'continuity-stopped', message })
      } catch (error) {
        if (!isStale(error)) return
        const current = readGoal(agent)
        if (current === undefined || current.phase !== 'active') return
        try {
          ctx.goals.block(agent, goalRef(current), { code: 'continuity-stopped', message })
        } catch {
          return
        }
      }
    } else if (goal.phase !== 'blocked') {
      // A user pause or completion is preserved and is not explained by a notice.
      return
    }
    if (goal.phase === 'blocked') state.refusal = refusal
    deliverNotice(agent, message, `goal-continuity: stopped after ${causeLabel(cause)}`)
  }

  /** Refuse an automatic resume whose session budget is spent. */
  function stopForBudget(agent: Agent, state: AgentState, goal: GoalView, cause: StopCause): void {
    terminate(
      agent,
      state,
      goal,
      cause,
      'the automatic resume budget is exhausted',
      'resume manually with /goal resume after fixing the blocker, or pause with /goal pause',
    )
  }

  /** Extend until the cap covers the admitted rounds, or stop visibly. */
  function extendToCapacity(
    agent: Agent,
    state: AgentState,
    goal: GoalView,
    expected: 'active' | 'blocked',
    cause: StopCause,
  ): { goal: GoalView; from: number; used: number; extended: number } | undefined {
    const from = goal.maxGoalRounds
    let current = goal
    let used = state.extensions.get(goal.id) ?? 0
    let extended = 0
    while (current.roundsStarted >= current.maxGoalRounds) {
      if (used >= resolved.maxRoundExtensions) {
        terminate(
          agent,
          state,
          current,
          cause,
          `the round cap (${current.maxGoalRounds}) still does not cover the ${current.roundsStarted} rounds already started after ${used} of ${resolved.maxRoundExtensions} extensions`,
          'raise the goal round cap with the goal tool, then resume with /goal resume',
        )
        return undefined
      }
      const cap = editCap(agent, current, expected)
      if (cap.kind === 'failed') {
        if (extended > 0) {
          terminate(
            agent,
            state,
            current,
            cause,
            `the round cap was extended from ${from} to ${current.maxGoalRounds} but a further extension failed`,
            'review the goal and resume with /goal resume',
          )
        } else {
          notifyResumeFailure(agent, current)
        }
        return undefined
      }
      if (cap.kind === 'unavailable') {
        terminate(
          agent,
          state,
          current,
          cause,
          `the round cap (${current.maxGoalRounds}) is exhausted and the hard cap (${resolved.hardMaxGoalRounds}) leaves no extension room`,
          'raise the goal round cap with the goal tool, then resume with /goal resume',
        )
        return undefined
      }
      if (cap.kind === 'resumable') {
        current = cap.goal
        break
      }
      used += 1
      extended += 1
      state.extensions.set(goal.id, used)
      current = cap.goal
    }
    return { goal: current, from, used, extended }
  }

  /** Extend the cap of an active goal at its limit, then resume, or refuse visibly. */
  function continueAtCap(agent: Agent, state: AgentState, goal: GoalView, cause: StopCause): void {
    if (state.resumes >= resolved.maxSessionResumes) {
      stopForBudget(agent, state, goal, cause)
      return
    }
    if (goal.roundsStarted < goal.maxGoalRounds) {
      const result = resumeAndNotify(agent, state, goal, cause)
      if (result === 'exhausted') stopForBudget(agent, state, goal, cause)
      else if (result === 'failed') notifyResumeFailure(agent, goal)
      return
    }
    const outcome = extendToCapacity(agent, state, goal, 'active', cause)
    if (outcome === undefined) return
    const result = resumeAndNotify(
      agent,
      state,
      outcome.goal,
      cause,
      outcome.extended > 0
        ? { from: outcome.from, to: outcome.goal.maxGoalRounds, used: outcome.used }
        : undefined,
    )
    if (result === 'exhausted') stopForBudget(agent, state, outcome.goal, cause)
    else if (result === 'failed') {
      if (outcome.extended > 0) {
        terminate(
          agent,
          state,
          outcome.goal,
          cause,
          `the round cap was extended from ${outcome.from} to ${outcome.goal.maxGoalRounds} but the goal could not be resumed automatically`,
          'review the goal and resume with /goal resume',
        )
      } else {
        notifyResumeFailure(agent, outcome.goal)
      }
    }
  }

  /** Extend a goal blocked at the round limit, or keep the native block and explain. */
  function extendBlocked(agent: Agent, state: AgentState, goal: GoalView): void {
    if (state.suppression !== null) {
      if (state.suppression.terminal) {
        terminate(
          agent,
          state,
          goal,
          state.suppression.cause,
          state.suppression.detail,
          'resume manually with /goal resume after fixing the blocker',
        )
      }
      return
    }
    if (goal.roundsStarted < goal.maxGoalRounds) {
      // A previous extension is already in place; resume without extending again.
      const result = resumeAndNotify(agent, state, goal, 'round-limit')
      if (result === 'exhausted') stopForBudget(agent, state, goal, 'round-limit')
      else if (result === 'failed') notifyResumeFailure(agent, goal)
      return
    }
    if (state.resumes >= resolved.maxSessionResumes) {
      stopForBudget(agent, state, goal, 'round-limit')
      return
    }
    const outcome = extendToCapacity(agent, state, goal, 'blocked', 'round-limit')
    if (outcome === undefined) return
    const result = resumeAndNotify(
      agent,
      state,
      outcome.goal,
      'round-limit',
      outcome.extended > 0
        ? { from: outcome.from, to: outcome.goal.maxGoalRounds, used: outcome.used }
        : undefined,
    )
    if (result === 'exhausted') stopForBudget(agent, state, outcome.goal, 'round-limit')
    else if (result === 'failed') {
      if (outcome.extended > 0) {
        terminate(
          agent,
          state,
          outcome.goal,
          'round-limit',
          `the round cap was extended from ${outcome.from} to ${outcome.goal.maxGoalRounds} but the goal could not be resumed automatically`,
          'review the goal and resume with /goal resume',
        )
      } else {
        notifyResumeFailure(agent, outcome.goal)
      }
    }
  }

  /** One deferred decision for one settled agent. */
  function reconcile(agent: Agent, state: AgentState, cause: StopCause | null): void {
    if (!isRootAgent(agent)) return
    const restart = state.restartPending
    state.restartPending = false
    const goal = readGoal(agent)
    if (goal === undefined) return
    if (goal.phase === 'blocked') {
      if (goal.blockedReason?.code === 'round-limit') extendBlocked(agent, state, goal)
      return
    }
    if (goal.phase !== 'active') return
    if (state.suppression?.terminal === true) {
      terminate(
        agent,
        state,
        goal,
        state.suppression.cause,
        state.suppression.detail,
        'resume manually with /goal resume after fixing the blocker, or pause with /goal pause',
      )
      return
    }
    if (goal.activation !== 'disarmed') return
    if (restart && !resolved.resumeAfterRestart) return
    if (state.suppression !== null) return
    const named = cause ?? 'in-process-disarm'
    if (state.resumes >= resolved.maxSessionResumes) {
      stopForBudget(agent, state, goal, named)
      return
    }
    if (goal.roundsStarted >= goal.maxGoalRounds) {
      continueAtCap(agent, state, goal, named)
      return
    }
    resumeAndNotify(agent, state, goal, named)
  }

  /** Track a root agent's first observation and defer its restart decision. */
  function observeAgent(agent: Agent): void {
    if (!isRootAgent(agent)) return
    const state = stateFor(agent)
    const createdAt = agent.session.header.createdAt
    state.restartPending = Number.isSafeInteger(createdAt) ? createdAt < mountedAt : !state.observed
    state.observed = true
    schedule(agent, state, 'restart')
  }

  function handleTurnEnd(agent: Agent, state: AgentState, reason: TurnEndReason): void {
    const goalRound = state.goalRound
    state.goalRound = false
    const hook = hookCause(reason)
    if (hook !== undefined) {
      const cause: StopCause =
        hook === 'reset' ? 'reset' : hook === 'final' ? 'final-hook' : 'unknown-hook'
      if (hook !== 'reset') {
        state.suppression = {
          cause,
          terminal: true,
          detail:
            hook === 'final' ? 'the loop guard final stop' : 'an unrecognized hook cancellation',
        }
      }
      if (goalRound) preventPause(agent)
      schedule(agent, state, cause)
      return
    }
    if (reason.kind === 'aborted') {
      if (reason.reason.kind === 'user') {
        if (goalRound) {
          state.suppression = {
            cause: 'goal-round-stop',
            terminal: false,
            detail: 'your Stop during a goal round',
          }
          schedule(agent, state, 'goal-round-stop')
        } else if (resolved.resumeAfterUserStop === 'never') {
          state.suppression = {
            cause: 'user-stop-never',
            terminal: false,
            detail: 'your Stop on a turn that was not a goal round',
          }
          const goal = readGoal(agent)
          if (goal !== undefined && goal.phase === 'active') {
            deliverNotice(
              agent,
              'Goal continuity suppressed automatic continuation after your Stop on a turn that was not a goal round. Next: send a message to clear the suppression, or pause the goal with /goal pause to stop it explicitly.',
              'goal-continuity: suppressed after user Stop',
            )
          }
          schedule(agent, state, 'user-stop-never')
        } else {
          schedule(agent, state, 'non-goal-stop')
        }
        return
      }
      state.suppression = {
        cause: 'parent-stop',
        terminal: false,
        detail: 'the turn was cancelled by its parent',
      }
      return
    }
    if (reason.kind === 'completed') {
      schedule(agent, state)
      return
    }
    if (reason.kind === 'max-tokens') {
      state.suppression = {
        cause: 'max-tokens',
        terminal: true,
        detail: 'the turn reached the token limit',
      }
      schedule(agent, state, 'max-tokens')
      return
    }
    if (reason.kind === 'error') {
      state.suppression = {
        cause: 'agent-error',
        terminal: true,
        detail: 'the turn failed with an error',
      }
      schedule(agent, state, 'agent-error')
    }
  }

  function handleSessionEvent(session: Session, event: SessionEvent): void {
    const agent = ctx.agents.get(session.id)
    if (agent === undefined || agent.session !== session || !isRootAgent(agent)) return
    const state = states.get(agent)
    if (state === undefined) return
    switch (event.type) {
      case 'turn/start':
        state.turn = event.data.turn
        state.goalRound = false
        return
      case 'user/message':
        if (event.data.source.kind === 'goal') state.goalRound = true
        else if (event.data.source.kind === 'user') {
          state.suppression = null
          state.cause = null
        }
        return
      case 'turn/end':
        handleTurnEnd(agent, state, event.data.reason)
        return
      default:
        return
    }
  }

  for (const agent of ctx.agents.list()) observeAgent(agent)
  ctx.on('session/event', (session, event) => {
    try {
      handleSessionEvent(session, event)
    } catch {
      // Fail open: supervision must never fail a session.
    }
  })
  ctx.on('goal/activation-changed', (payload) => {
    try {
      if (payload.goal === undefined || payload.goal.activation !== 'disarmed') return
      const agent = ctx.agents.get(payload.sessionId)
      if (agent === undefined || agent.session.id !== payload.sessionId || !isRootAgent(agent)) {
        return
      }
      const state = states.get(agent)
      if (state !== undefined) schedule(agent, state, 'in-process-disarm')
    } catch {
      // Fail open.
    }
  })
  ctx.on('goal/changed', ({ agent, change }) => {
    try {
      if (!isRootAgent(agent)) return
      const state = states.get(agent)
      if (state === undefined) return
      if (change.operation === 'pause') {
        state.suppression = { cause: 'user-pause', terminal: false, detail: 'the goal is paused' }
        return
      }
      if (change.operation === 'complete') {
        state.suppression = {
          cause: 'user-complete',
          terminal: false,
          detail: 'the goal is complete',
        }
        return
      }
      if (change.operation === 'clear') {
        state.suppression = { cause: 'user-clear', terminal: false, detail: 'the goal was cleared' }
        state.extensions.clear()
        return
      }
      if (change.operation === 'block') {
        if (change.goal?.blockedReason?.code === 'round-limit') {
          schedule(agent, state, 'round-limit')
        } else if (change.goal?.blockedReason?.code === 'model-reported') {
          state.suppression = {
            cause: 'model-reported',
            terminal: false,
            detail: 'the model reported a blocker',
          }
        }
      }
    } catch {
      // Fail open.
    }
  })
  ctx.on('agent/error', ({ agent }) => {
    try {
      if (!isRootAgent(agent)) return
      const state = states.get(agent)
      if (state === undefined) return
      state.suppression = {
        cause: 'agent-error',
        terminal: true,
        detail: 'an agent error stopped the session',
      }
      schedule(agent, state, 'agent-error')
    } catch {
      // Fail open.
    }
  })
  ctx.on('agent/created', ({ agent }) => {
    observeAgent(agent)
    return undefined
  })
  ctx.on('agent/disposed', ({ agent }) => {
    states.delete(agent)
  })
}
