import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { type Dirent, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
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
  type NumberedTask,
  normalizeCheckboxes,
  normalizeTaskText,
  type PortableTaskReviewRecord,
  parsePortableTaskReviewRecord,
  parseReviewApprovalMarker,
  parseTasksText,
  portableTaskRecordDisplayPath,
  portableTaskRecordPath,
  REVIEWS_DIRECTORY,
  type ReviewApprovalMarker,
  type ReviewFinding,
  recognizeArchiveCommands,
  type ShellToken,
  shellSegments,
  TASK_ID_PATTERN,
  unparseableCheckedLines,
} from '../shared/approval.js'

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

/** Services the registrations depend on. */
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
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const DEFAULT_TIMEOUTS: TimeoutConfig = { review: 600_000, answer: 300_000, patch: 1_800_000 }
const DEFAULT_FAILURE_STREAK = 3
const MAX_ANSWER_CHARS = 12_000
const MAX_FINDING_CHARS = 2_000
const MAX_ERROR_CHARS = 4_000
const MAX_REASON_CHARS = 2_000

export type Trigger =
  | 'manual'
  | 'spec-ready'
  | 'spec-task-ready'
  | 'implementation-work'
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

/** Row configuration accepted by {@link apply}. */
export interface BundleConfig {
  targets?: Record<string, TargetConfig>
  rules?: RuleConfig[]
  timeouts?: Partial<TimeoutConfig>
  failureStreak?: number
}

/** Test seams; production uses the filesystem, git, and the wall clock. */
export interface ApplyOptions {
  runGit?: GitRunner
  now?: () => Date
  /** Called once per review run after it settles; the run is no longer pending. */
  onRunSettled?: (runId: string, state: SettledRunState) => void
}

/** Terminal review-run states reported to the settlement observer. */
export type SettledRunState = 'completed' | 'failed' | 'discarded'

/** One fixed-argument git invocation; output is raw bytes so diffs stay lossless. */
export type GitRunner = (
  args: readonly string[],
  cwd: string,
  signal?: AbortSignal,
) => Promise<Buffer>

interface EngineConfig {
  targets: Map<string, TargetConfig>
  rules: RuleConfig[]
  timeouts: TimeoutConfig
  failureStreak: number
}

class DelegationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DelegationError'
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

/**
 * Validate one row configuration. Configuration mistakes fail the row with the
 * rule/target id and a next action; a missing provider is deliberately not a
 * validation error, so the profile composes without the target installed.
 */
export function validateConfig(raw: unknown): EngineConfig {
  if (raw === undefined || raw === null) raw = {}
  if (!isRecord(raw)) fail('configuration must be a mapping')

  const unknownTop = unknownKeys(raw, new Set(['targets', 'rules', 'timeouts', 'failureStreak']))
  if (unknownTop.length > 0) {
    fail(
      `unknown configuration field(s) ${unknownTop.join(', ')}; use targets, rules, timeouts, or failureStreak`,
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

  return { targets, rules, timeouts, failureStreak }
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
      `${where}: unknown trigger ${JSON.stringify(when)}; use manual, spec-ready, spec-task-ready, implementation-work, implementation-complete, or failure-streak`,
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
    if (raw.when !== 'implementation-work') {
      fail(`${where}: only the implementation-work trigger uses a note rule`)
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
function defaultGit(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<Buffer> {
  return new Promise<Buffer>((done, failed) => {
    const child = spawn('git', [...args], { cwd, signal, windowsHide: true })
    const chunks: Buffer[] = []
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < 2_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      failed(new DelegationError(`git ${args[0] ?? 'command'} failed: ${error.message}`))
    })
    child.on('close', (code) => {
      if (code === 0) {
        done(Buffer.concat(chunks))
        return
      }
      const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 300)
      failed(
        new DelegationError(
          `git ${args[0] ?? 'command'} failed (exit ${code ?? 'unknown'})${detail ? `: ${detail}` : ''}`,
        ),
      )
    })
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

type RunState = 'queued' | 'running' | 'completed' | 'failed' | 'discarded'

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
}

interface ManagedRun {
  file: RunFile
  workspaceRoot: string
  recordPath: string
  existingFingerprint?: string
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
  signature: InputSignature
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
async function specDigest(changeDir: string, signal?: AbortSignal): Promise<string> {
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

function sanitizeText(text: string, maximum = MAX_FINDING_CHARS): string {
  const redacted = text
    .replace(/\b[A-Za-z]:[\\/][^\s"'`)]*/g, '[path]')
    .replace(/\\\\[^\s"'`)]+/g, '[path]')
    .replace(/(?:^|\s)\/(?:Users|home)\/[^\s"'`)]+/g, ' [path]')
    .replace(
      /\b(?:sk-[A-Za-z0-9]{8,}|AKIA[0-9A-Z]{12,}|ghp_[A-Za-z0-9]{20,}|xox[bap]-[A-Za-z0-9-]{10,})\b/g,
      '[secret]',
    )
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      '[secret]',
    )
  return redacted.length <= maximum ? redacted : `${redacted.slice(0, maximum - 1)}…`
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
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
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

function reviewIdentity(rule: RuleConfig, change: string, task: TaskInfo | undefined): string {
  return `${rule.id}\u0000${change}\u0000${task?.id ?? rule.phase ?? 'whole'}`
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
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'discarded'
  )
}

function parseRunFile(value: unknown): RunFile | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.id !== 'string' ||
    value.id === '' ||
    typeof value.rule !== 'string' ||
    typeof value.change !== 'string' ||
    typeof value.key !== 'string' ||
    typeof value.identity !== 'string' ||
    !isRunState(value.state) ||
    typeof value.record !== 'string' ||
    typeof value.startedAt !== 'string'
  ) {
    return undefined
  }
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return undefined
  if (value.detail !== undefined && typeof value.detail !== 'string') return undefined
  return value as unknown as RunFile
}

/** Recent review runs for one workspace, newest first; unreadable run files are ignored. */
async function listRunFiles(workspaceRoot: string): Promise<RunFile[]> {
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
      if (run !== undefined) runs.push(run)
    } catch {
      // A stale/partial run file is scratch; ignore it in the status view.
    }
  }
  return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, 30)
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

/** The task-review rule whose portable PASS is the approval. */
async function approvalRuleId(
  config: EngineConfig,
  openspecRoot: string,
): Promise<{ id: string } | { error: string }> {
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
    return { id: rule.id }
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

/** Accept exactly one fenced JSON verdict that echoes the requested digest. */
function parseVerdict(text: string, expectedDigest: string): ParsedVerdict {
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

interface AgentState {
  failures: number
  epoch: number
  consultedEpoch: number
  steered: Set<string>
  turn: number
  baseline?: Snapshot
  lastSnapshot?: Snapshot
  evidence: Map<string, ChangeEvidence>
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
  timeoutsFor(rule: RuleConfig): number
  /** Test seam: fired once per review run after it leaves the pending set. */
  onRunSettled?: (runId: string, state: SettledRunState) => void
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
    fail(
      `rule "${rule.id}": target "${rule.to}" names provider "${target.provider}", which is not registered; install or enable that provider, or point the rule's target at one of: ${registered.join(', ') || '(none registered)'}`,
    )
  }
  const agentOptions = resolveAgentOptions(target)
  if (agentOptions !== undefined && provider.capabilities.agentOptions !== true) {
    fail(
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
    fail(
      `rule "${rule.id}": target "${rule.to}" on provider "${provider.name}" could not start: ${errorMessage(error)}; check targets.${rule.to} options against provider "${provider.name}", or run delegation_status for the next action`,
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
  let result: SubagentResult
  try {
    result = await Promise.race([
      started.activation.result,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new DelegationError(
              `rule "${rule.id}": target "${targetLabel(target)}" did not finish within ${started.timeoutMs} ms; widen timeouts.${rule.contract} or narrow the task`,
            ),
          )
        }, started.timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    await started.activation.dispose().catch(() => undefined)
  }
  if (result.stopReason !== 'completed') {
    const diagnostic =
      result.diagnostic === undefined ? '' : `: ${sanitizeText(result.diagnostic, MAX_ERROR_CHARS)}`
    fail(
      `rule "${rule.id}": target "${targetLabel(target)}" stopped with "${result.stopReason}"${diagnostic}`,
    )
  }
  const text = outputText(result)
  if (text === '')
    fail(`rule "${rule.id}": target "${targetLabel(target)}" returned no text output`)
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

function reviewPrompt(
  rule: RuleConfig,
  change: ChangeInfo,
  digest: string,
  task: TaskInfo | undefined,
  context: string | undefined,
  objective: string | undefined,
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
  if (context !== undefined && context.trim() !== '')
    lines.push('', '## Context', '', context.trim())
  if (objective !== undefined && objective.trim() !== '')
    lines.push('', '## Objective', '', objective.trim())
  lines.push(
    '',
    'Return exactly one fenced JSON block whose `digest` is the value above, `verdict` is `PASS` or `FINDINGS`, and `findings` lists only P0/P1 items with title, evidence, and fix. Prose outside that block is ignored.',
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
      `- ${finding.severity} ${finding.title}\n  evidence: ${finding.evidence}\n  fix: ${finding.fix}`,
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
  private readonly runIdentities = new Map<string, ManagedRun>()
  private readonly runKeyHeads = new Map<string, ManagedRun>()
  private readonly runQueues = new Map<string, ManagedRun[]>()

  constructor(
    private readonly config: EngineConfig,
    private readonly services: EngineServices,
  ) {}

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
      identity: `${workspaceRoot}\u0000${reviewIdentity(rule, change.name, task)}`,
      state: 'running',
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

  /** Validate, start, and return the run handle without waiting for the verdict. */
  private async startReview(
    rule: RuleConfig,
    change: ChangeInfo,
    agent: Agent,
    cwd: string,
    workspaceRoot: string,
    args: DelegateArguments,
  ): Promise<string> {
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
    const pending = this.runIdentities.get(run.file.identity)
    if (pending !== undefined) return this.runHandleText(pending, 'duplicate')
    this.runs.set(run.file.id, run)
    this.runIdentities.set(run.file.identity, run)

    const head = this.runKeyHeads.get(run.file.key)
    if (head !== undefined) {
      const queue = this.runQueues.get(run.file.key) ?? []
      queue.push(run)
      this.runQueues.set(run.file.key, queue)
      await this.markRun(run, 'queued', `queued behind run ${head.file.id}`)
      return this.runHandleText(run, 'queued')
    }
    this.runKeyHeads.set(run.file.key, run)
    const outcome = await this.beginReviewRun(run)
    return outcome.reusedText ?? this.runHandleText(run, 'running')
  }

  /** Prepare immutable digest/inputs and start the target; cleanup is owned here. */
  private async beginReviewRun(run: ManagedRun): Promise<{ reusedText?: string }> {
    let prepared: ReviewPreparation | undefined
    try {
      const tasks = await readTasks(run.context.change.dir)
      const task = run.context.task
      if (task !== undefined) {
        const current = tasks.find((entry) => entry.id === task.id)
        if (current === undefined || !current.checked) {
          fail(
            `task "${task.number} ${task.text}" is no longer a checked task in change "${run.context.change.name}"; start a fresh review`,
          )
        }
        run.context.task = current
      }
      prepared = await this.prepareReview(run)
      const existing = await inspectRecord(prepared.path)
      run.existingFingerprint =
        existing.kind === 'record' ? JSON.stringify(existing.record) : undefined
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
        if (reusable && current) {
          await this.markRun(run, 'completed', 'reused record')
          this.freeRun(run)
          await this.startNextRun(run.file.key)
          return {
            reusedText: formatRecord(run.context.cwd, prepared.path, record, true),
          }
        }
      }
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
        ),
        agent: run.context.agent,
        cwd: run.context.cwd,
        signal: run.context.signal,
      })
      await this.markRun(run, 'running')
      void this.completeReviewRun(run, started, prepared)
      return {}
    } catch (error) {
      await this.failRun(run, error, prepared)
      throw error
    }
  }

  private async prepareReview(run: ManagedRun): Promise<ReviewPreparation> {
    const { rule, change, cwd, signal } = run.context
    // Track the inputs before hashing them: any later mutation, including
    // edit-read-restore, invalidates the verdict via the completion check.
    const signature = await reviewedInputs(cwd, rule, change, this.services, signal)
    let digest: string
    let worktree: string | undefined
    if (rule.scope === 'task') {
      const task = run.context.task
      if (task === undefined) fail(`rule "${rule.id}": a task-scoped review needs a task`)
      worktree = await worktreeDigest(cwd, this.services.git, signal)
      digest = hashParts([
        'task-review-v1',
        task.id,
        task.text,
        await specDigest(change.dir, signal),
        worktree,
      ])
    } else if (rule.when === 'implementation-complete') {
      worktree = await worktreeDigest(cwd, this.services.git, signal)
      digest = worktree
    } else {
      digest = await specDigest(change.dir, signal)
    }
    return {
      digest,
      ...(worktree === undefined ? {} : { worktreeDigest: worktree }),
      path: recordPath(cwd, rule, change.name, run.context.task?.id),
      signature,
    }
  }

  /** Background completion: verdict + mutation guard + authoritative publish. */
  private async completeReviewRun(
    run: ManagedRun,
    started: StartedTarget,
    prepared: ReviewPreparation,
  ): Promise<void> {
    try {
      const result = await finishTarget(started)
      const parsed = parseVerdict(result.text, prepared.digest)
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
        fail(
          `reviewed inputs changed during the run (${changed.length} changed: ${sample}${changed.length > 5 ? ', …' : ''}); a write inside the reviewed scope happened during the run — finish the writes, then re-run the review`,
        )
      }
      await this.publishRecord(run, {
        digest: prepared.digest,
        ...(prepared.worktreeDigest === undefined
          ? {}
          : { worktreeDigest: prepared.worktreeDigest }),
        verdict: parsed.verdict,
        findings: parsed.findings,
        target: targetIdentity(result.provider, result.model, result.reasoningEffort),
      })
      await this.markRun(
        run,
        'completed',
        parsed.verdict === 'FINDINGS' ? `${parsed.findings.length} finding(s)` : undefined,
      )
    } catch (error) {
      if (error instanceof DiscardedRun) {
        await this.markRun(run, 'discarded', error.message)
      } else {
        try {
          await this.publishRecord(run, {
            digest: prepared.digest,
            ...(prepared.worktreeDigest === undefined
              ? {}
              : { worktreeDigest: prepared.worktreeDigest }),
            verdict: 'ERROR',
            findings: [],
            target: targetIdentity(started.provider, started.model, started.reasoningEffort),
            error: sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
          })
          await this.markRun(run, 'failed', sanitizeText(errorMessage(error), MAX_ERROR_CHARS))
        } catch (publishError) {
          if (publishError instanceof DiscardedRun) {
            await this.markRun(run, 'discarded', publishError.message)
          } else {
            await this.markRun(
              run,
              'failed',
              sanitizeText(errorMessage(publishError), MAX_ERROR_CHARS),
            )
          }
        }
      }
    } finally {
      this.freeRun(run)
      await this.startNextRun(run.file.key)
    }
  }

  /** Write a record under the publish lock; a newer writer wins and this run is discarded. */
  private async publishRecord(run: ManagedRun, fields: PublishFields): Promise<ReviewRecord> {
    const release = await acquirePublishLock(run.recordPath)
    try {
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
        findings: fields.findings,
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
      return record
    } finally {
      await release()
    }
  }

  /** Best-effort failure path: write a visible ERROR record when inputs were prepared. */
  private async failRun(
    run: ManagedRun,
    error: unknown,
    prepared: ReviewPreparation | undefined,
  ): Promise<void> {
    try {
      if (error instanceof DiscardedRun) {
        await this.markRun(run, 'discarded', error.message)
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
            error: sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
          })
          await this.markRun(run, 'failed', sanitizeText(errorMessage(error), MAX_ERROR_CHARS))
        } catch (publishError) {
          if (publishError instanceof DiscardedRun) {
            await this.markRun(run, 'discarded', publishError.message)
          } else {
            await this.markRun(
              run,
              'failed',
              sanitizeText(errorMessage(publishError), MAX_ERROR_CHARS),
            )
          }
        }
      } else {
        await this.markRun(run, 'failed', sanitizeText(errorMessage(error), MAX_ERROR_CHARS))
      }
    } finally {
      this.freeRun(run)
      await this.startNextRun(run.file.key).catch(() => undefined)
    }
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

  private freeRun(run: ManagedRun): void {
    this.runs.delete(run.file.id)
    this.runIdentities.delete(run.file.identity)
    const state = run.file.state
    if (state === 'queued' || state === 'running') return
    try {
      this.services.onRunSettled?.(run.file.id, state)
    } catch {
      // The observer is a test seam; it must not change run cleanup.
    }
  }

  private async startNextRun(key: string): Promise<void> {
    const queue = this.runQueues.get(key)
    const next = queue?.shift()
    if (queue !== undefined && queue.length === 0) this.runQueues.delete(key)
    if (next === undefined) {
      this.runKeyHeads.delete(key)
      return
    }
    this.runKeyHeads.set(key, next)
    try {
      await this.beginReviewRun(next)
    } catch {
      // beginReviewRun already cleaned up and surfaced a failed run file.
    }
  }

  private runHandleText(run: ManagedRun, mode: 'running' | 'queued' | 'duplicate'): string {
    const label =
      mode === 'duplicate' ? 'already pending' : mode === 'queued' ? 'queued' : 'started'
    const lines = [
      `rule "${run.file.rule}" review ${label}`,
      `run: ${run.file.id}`,
      `state: ${run.file.state}`,
      `change: ${run.file.change}`,
    ]
    if (run.file.taskId !== undefined) lines.push(`task id: ${run.file.taskId}`)
    lines.push(`record: ${run.file.record}`)
    if (mode === 'queued') {
      const head = this.runKeyHeads.get(run.file.key)
      if (head !== undefined) lines.push(`queued behind: ${head.file.id}`)
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
      if (run.file.state === 'queued' || run.file.state === 'running') {
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
    for (const rule of this.taskReviewRules()) {
      const state = await inspectRecord(recordPath(cwd, rule, change.name, taskId))
      if (recordSatisfies(state, change.name, 'task', undefined, taskId)) return true
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
        for (const rule of this.taskReviewRules()) {
          const reviewed = new Set<string>()
          for (const task of checked) {
            const path = recordPath(cwd, rule, change.name, task.id)
            const state = await inspectRecord(path)
            if (
              state.kind === 'record' &&
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
      const runs = await listRunFiles(workspaceRoot)
      lines.push('', 'Review runs:')
      if (runs.length === 0) lines.push('- none')
      for (const run of runs) {
        lines.push(
          `- run ${run.id}: rule=${run.rule} change=${run.change}${run.taskId === undefined ? '' : ` task=${run.taskId}`} state=${run.state} record=${run.record}${run.detail === undefined ? '' : ` detail="${run.detail}"`}`,
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
          if (recordSatisfies(state, change.name, 'task', undefined, task.id)) {
            satisfied = true
            break
          }
          if (state.kind === 'record' && state.record.verdict === 'FINDINGS') findingsOnly = true
        }
        if (satisfied) continue
        const ruleId = (strictTaskRule ?? softTaskRule)?.id ?? 'task-review'
        const pending = pendingFor(ruleId, change.name, task.id)
        const detail =
          pending !== undefined
            ? `review run ${pending.id} is ${pending.state}; wait for ${pending.record} instead of starting another run`
            : findingsOnly
              ? 'its review record has unresolved findings'
              : 'it has no task-review PASS/ERROR record'
        const text = `rule "${ruleId}": checked task "${task.number} ${task.text}" in change "${change.name}" requires its task-scoped review; ${detail}.`
        const call =
          pending === undefined
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
            if (recordSatisfies(state, change.name, 'task', undefined, task.id)) {
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

function buildToolDefinitions(engine: DelegationEngine, config: EngineConfig): ToolDefinition[] {
  const ruleIds = config.rules.map((rule) => rule.id)
  const output = {
    schema: TOOL_OUTPUT_SCHEMA,
    render: (_args: unknown, value: unknown) => renderOutput(value),
  }
  return [
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

/**
 * Register the three tools, the on-demand skill, and the turn-stopping gate.
 * A missing subagent provider is not fatal here: it is diagnosed by the tools
 * and `delegation_status`, so the profile composes without that provider.
 */
export function apply(ctx: Context, config: BundleConfig = {}, options: ApplyOptions = {}): void {
  const validated = validateConfig(config)
  const state = new DelegationState()
  const services: EngineServices = {
    subagents: ctx.subagents,
    workingDirectory: ctx.workingDirectory,
    state,
    git: { runGit: options.runGit ?? defaultGit },
    now: options.now ?? (() => new Date()),
    timeoutsFor: (rule) => timeoutForContract(validated.timeouts, rule.contract),
    ...(options.onRunSettled === undefined ? {} : { onRunSettled: options.onRunSettled }),
  }
  const engine = new DelegationEngine(validated, services)
  services.pendingReview = (workspaceRoot, ruleId, change, taskId) =>
    engine.pendingReview(workspaceRoot, ruleId, change, taskId)
  for (const definition of buildToolDefinitions(engine, validated)) {
    ctx.tools.register(definition)
  }
  ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()))
  attachGate({ ctx, deps: { config: validated, state, services } })
}
