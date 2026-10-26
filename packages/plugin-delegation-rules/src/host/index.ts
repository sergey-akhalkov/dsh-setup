import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
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
import type { JsonSchemaNode, ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { WorkingDirectoryService } from '@deepseek-ai/dsh-working-directory'

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

const assetsDirectory = fileURLToPath(new URL('../assets/delegation-rules', import.meta.url))

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
    'Run one configured delegation rule through its target. Manual tasks: `research` answers a question with evidence and sources; `blocker` consults on a stuck plan when the failure-streak hint appears; `bug-fix` runs a write target in an isolated git worktree and returns the diff and test report (never auto-merged). Gate rules: `spec-review` reviews the whole active OpenSpec change before implementation; `task-review` reviews the next checked task without a PASS/ERROR record; `integration-review` is the optional whole-worktree check. The engine validates the rule, starts the configured DSH subagent provider, parses the contract result, and writes a digest-bound record under `.dsh/delegation`; a review PASS needs zero P0/P1 findings, FINDINGS/ERROR are reported but do not pass a strict gate, and a matching PASS is reused without another run. The `answer` contract writes no gate record. Only a matching record satisfies the turn-stopping gate: a text claim does not. A missing or incompatible target is reported with the target id, provider name, and next action.',
  task_progress:
    'Record an explicit in-progress or blocked note for one unchecked task, with the reason and the current worktree digest. Use it when a task spans turns instead of ticking `tasks.md`: it runs no model and costs nothing. The note lets a code-changing turn close only while the worktree still matches it; after any further change it is stale and a fresh note or the tick plus `delegate` task review is required. A checked task never accepts a note, and a note never counts as a task-review PASS.',
  delegation_status:
    'Report registered DSH subagent providers and capabilities, configured delegation targets and rules, per-change task/progress-note state, review record state (matching, stale, missing, malformed), and missing-target diagnostics with the next action. Use it when a `delegate` call reports a target problem or before configuring rules.',
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
const CHANGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/
const TASK_ID_PATTERN = /^[0-9a-f]{16}$/

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
}

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

interface TaskInfo {
  id: string
  at: number
  number: string
  text: string
  checked: boolean
}

interface ChangeInfo {
  name: string
  dir: string
  reviewReady: boolean
}

interface Snapshot {
  digest?: string
  implementationFingerprint?: string
  digestError?: string
  changes: Array<{ name: string; tasks: TaskInfo[]; specDigest?: string }>
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
  target: { provider: string; model?: string }
  time: string
  error?: string
}

interface Finding {
  severity: 'P0' | 'P1'
  title: string
  evidence: string
  fix: string
}

interface ProgressNote {
  taskId: string
  status: ProgressStatus
  reason: string
  worktreeDigest: string
  time: string
}

type RecordState =
  | { kind: 'missing' }
  | { kind: 'malformed'; error: string }
  | { kind: 'record'; record: ReviewRecord }

function normalizeTaskText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function taskIdOf(text: string): string {
  return createHash('sha256').update(normalizeTaskText(text)).digest('hex').slice(0, 16)
}

function hashParts(parts: Array<string | Buffer>): string {
  const hash = createHash('sha256')
  for (const part of parts) {
    hash.update(part)
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function readTasks(changeDir: string): Promise<TaskInfo[]> {
  const markdown = await readFile(join(changeDir, 'tasks.md'), 'utf8')
  const tasks: TaskInfo[] = []
  const pattern = /^\s*-\s*\[([ xX])\]\s+(\d+(?:\.\d+)*)\s+(.+?)\s*$/gm
  for (const match of markdown.matchAll(pattern)) {
    const [, mark = ' ', number = '', body = ''] = match
    const text = normalizeTaskText(body)
    tasks.push({ id: taskIdOf(text), at: match.index ?? 0, number, text, checked: mark !== ' ' })
  }
  return tasks
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
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) files.push(path)
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
    let tasks: TaskInfo[]
    try {
      tasks = await readTasks(change.dir)
    } catch (error) {
      snapshot.changes.push({ name: change.name, tasks: [] })
      snapshot.digestError = snapshot.digestError ?? errorMessage(error)
      continue
    }
    const entry: Snapshot['changes'][number] = { name: change.name, tasks }
    try {
      entry.specDigest = await specDigest(change.dir, signal)
    } catch (error) {
      snapshot.digestError = snapshot.digestError ?? errorMessage(error)
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

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

function isFinding(value: unknown): value is Finding {
  if (!isRecord(value)) return false
  return (
    (value.severity === 'P0' || value.severity === 'P1') &&
    typeof value.title === 'string' &&
    value.title !== '' &&
    typeof value.evidence === 'string' &&
    value.evidence !== '' &&
    typeof value.fix === 'string' &&
    value.fix !== ''
  )
}

function parseRecord(value: unknown): ReviewRecord | undefined {
  if (!isRecord(value)) return undefined
  if (
    typeof value.rule !== 'string' ||
    typeof value.change !== 'string' ||
    typeof value.phase !== 'string' ||
    (value.scope !== 'whole' && value.scope !== 'task') ||
    typeof value.digest !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.digest) ||
    (value.verdict !== 'PASS' && value.verdict !== 'FINDINGS' && value.verdict !== 'ERROR') ||
    !Array.isArray(value.findings) ||
    !value.findings.every(isFinding) ||
    !isRecord(value.target) ||
    typeof value.target.provider !== 'string' ||
    typeof value.time !== 'string'
  ) {
    return undefined
  }
  if (value.taskId !== undefined && typeof value.taskId !== 'string') return undefined
  if (value.scope === 'task' && typeof value.taskId !== 'string') return undefined
  if (value.worktreeDigest !== undefined && typeof value.worktreeDigest !== 'string')
    return undefined
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
}

/** Per-agent failure streak, consultation, steering, and turn-snapshot state. */
class DelegationState {
  private readonly agents = new Map<string, AgentState>()

  private of(agentId: string): AgentState {
    let state = this.agents.get(agentId)
    if (state === undefined) {
      state = { failures: 0, epoch: 0, consultedEpoch: -1, steered: new Set(), turn: -1 }
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
    return true
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
}

interface RunResult {
  text: string
  provider: string
  model?: string
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
  return target.model === undefined ? target.provider : `${target.provider}/${target.model}`
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

async function runTarget(services: EngineServices, request: RunRequest): Promise<RunResult> {
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
  const timeoutMs = services.timeoutsFor(rule)
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
    fail(`rule "${rule.id}": provider "${provider.name}" could not start: ${errorMessage(error)}`)
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  let result: SubagentResult
  try {
    result = await Promise.race([
      activation.result,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new DelegationError(
              `rule "${rule.id}": target "${targetLabel(target)}" did not finish within ${timeoutMs} ms; widen timeouts.${rule.contract} or narrow the task`,
            ),
          )
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    await activation.dispose().catch(() => undefined)
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
  const model = target.model ?? agentOptions?.model
  return {
    text,
    provider: provider.name,
    ...(model === undefined ? {} : { model }),
  }
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
  lines.push(
    `target: ${record.target.provider}${record.target.model === undefined ? '' : `/${record.target.model}`}`,
  )
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
  context?: string
  objective?: string
}

interface ToolAgentContext {
  agent?: Agent
  signal: AbortSignal
}

/** The engine behind the three tools: validation, target runs, records, status. */
class DelegationEngine {
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
    const agent = this.requireAgent(context)
    const cwd = this.services.workingDirectory.get(agent.session)
    const change =
      rule.contract === 'review' || args.change !== undefined
        ? (await openChange(cwd, args.change)).change
        : undefined
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
      return this.runPatch(rule, args, agent, cwd, context.signal)
    }
    if (change === undefined) fail(`rule "${rule.id}": a review needs an active OpenSpec change`)
    if (rule.scope === 'whole' && !change.reviewReady) {
      fail(
        `change "${change.name}" is not review-ready; a whole-scope review needs proposal.md, design.md, tasks.md, and at least one specs/*/spec.md`,
      )
    }
    return this.runReview(rule, change, agent, cwd, args, context.signal)
  }

  private async runReview(
    rule: RuleConfig,
    change: ChangeInfo,
    agent: Agent,
    cwd: string,
    args: DelegateArguments,
    signal: AbortSignal,
  ): Promise<string> {
    const tasks = await readTasks(change.dir)
    let task: TaskInfo | undefined
    let digest: string
    let worktree: string | undefined
    if (rule.scope === 'task') {
      task = await this.nextTaskForReview(change, tasks, cwd)
      const worktreeDigestValue = await worktreeDigest(cwd, this.services.git, signal)
      worktree = worktreeDigestValue
      digest = hashParts([
        'task-review-v1',
        task.id,
        task.text,
        await specDigest(change.dir, signal),
        worktreeDigestValue,
      ])
    } else if (rule.when === 'implementation-complete') {
      digest = await worktreeDigest(cwd, this.services.git, signal)
    } else {
      digest = await specDigest(change.dir, signal)
    }
    const path = recordPath(cwd, rule, change.name, task?.id)
    const existing = await inspectRecord(path)
    if (
      existing.kind === 'record' &&
      recordIdentifies(existing.record, rule, change.name, task?.id)
    ) {
      const record = existing.record
      const reusable =
        record.verdict === 'PASS' || (record.verdict === 'FINDINGS' && record.digest === digest)
      const current = rule.scope === 'task' ? true : record.digest === digest
      if (reusable && current) return formatRecord(cwd, path, record, true)
    }
    const target = this.target(rule)
    const reusedTargetLabel = targetLabel(target)
    let result: RunResult
    try {
      result = await runTarget(this.services, {
        rule,
        target,
        prompt: reviewPrompt(rule, change, digest, task, args.context, args.objective),
        agent,
        cwd,
        signal,
      })
    } catch (error) {
      const record: ReviewRecord = {
        rule: rule.id,
        change: change.name,
        phase: rule.phase ?? 'task',
        scope: rule.scope ?? 'whole',
        ...(task === undefined ? {} : { taskId: task.id }),
        digest,
        ...(worktree === undefined ? {} : { worktreeDigest: worktree }),
        verdict: 'ERROR',
        findings: [],
        target: {
          provider: target.provider,
          ...(target.model === undefined ? {} : { model: target.model }),
        },
        time: this.now(),
        error: sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
      }
      await writeJsonAtomic(path, record)
      fail(
        `rule "${rule.id}": the review run failed and an ERROR record was written to ${relativePath(cwd, path)}; the gate can close with that error visible, and a later run retries. Cause: ${errorMessage(error)}`,
      )
    }
    let parsed: ParsedVerdict
    try {
      parsed = parseVerdict(result.text, digest)
    } catch (error) {
      const record: ReviewRecord = {
        rule: rule.id,
        change: change.name,
        phase: rule.phase ?? 'task',
        scope: rule.scope ?? 'whole',
        ...(task === undefined ? {} : { taskId: task.id }),
        digest,
        ...(worktree === undefined ? {} : { worktreeDigest: worktree }),
        verdict: 'ERROR',
        findings: [],
        target: {
          provider: result.provider,
          ...(result.model === undefined ? {} : { model: result.model }),
        },
        time: this.now(),
        error: sanitizeText(errorMessage(error), MAX_ERROR_CHARS),
      }
      await writeJsonAtomic(path, record)
      fail(
        `rule "${rule.id}": the target returned no usable verdict and an ERROR record was written to ${relativePath(cwd, path)}; ${errorMessage(error)}`,
      )
    }
    const record: ReviewRecord = {
      rule: rule.id,
      change: change.name,
      phase: rule.phase ?? 'task',
      scope: rule.scope ?? 'whole',
      ...(task === undefined ? {} : { taskId: task.id }),
      digest,
      ...(worktree === undefined ? {} : { worktreeDigest: worktree }),
      verdict: parsed.verdict,
      findings: parsed.findings,
      target: {
        provider: result.provider,
        ...(result.model === undefined ? {} : { model: result.model }),
      },
      time: this.now(),
    }
    await writeJsonAtomic(path, record)
    if (parsed.verdict === 'FINDINGS') {
      return `${formatRecord(cwd, path, record, false)}\n(target ${reusedTargetLabel})`
    }
    return formatRecord(cwd, path, record, false)
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
    const wanted = args.task.trim()
    if (wanted === '') fail('task_progress needs task: the task text from tasks.md (or a task id)')
    const matches: Array<{ change: ChangeInfo; task: TaskInfo }> = []
    for (const change of await listActiveChanges(openspecRoot)) {
      for (const task of await readTasks(change.dir)) {
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
      const capabilityProblem =
        options !== undefined &&
        provider !== undefined &&
        provider.capabilities.agentOptions !== true
          ? '; provider does not support model/agentOptions'
          : ''
      lines.push(
        `- ${id}: provider=${target.provider}${target.model === undefined ? '' : ` model=${target.model}`}${target.write === true ? ' write=true' : ''} (${availability}${capabilityProblem})`,
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
      for (const change of changes) {
        lines.push(`- ${change.name} (${change.reviewReady ? 'review-ready' : 'not review-ready'})`)
        const tasks = await readTasks(change.dir)
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
  const cwd = deps.services.workingDirectory.get(agent.session)
  const openspecRoot = await findOpenSpecRoot(cwd)
  const changes = openspecRoot === undefined ? [] : await listActiveChanges(openspecRoot)
  const current = await captureSnapshot(cwd, changes, deps.services.git, signal)
  const baseline = deps.state.baselineOf(agentId, turn)
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

  if (openspecRoot !== undefined) {
    for (const change of changes) {
      const changeSnapshot = current.changes.find((entry) => entry.name === change.name)
      const tasks = changeSnapshot?.tasks ?? []
      const changeSpecDigest = changeSnapshot?.specDigest
      for (const rule of deps.config.rules) {
        if (
          rule.when === 'spec-ready' &&
          rule.contract === 'review' &&
          rule.scope === 'whole' &&
          rule.gate !== 'none'
        ) {
          if (!change.reviewReady) continue
          const path = recordPath(cwd, rule, change.name)
          const state = await inspectRecord(path)
          const matching = recordSatisfies(state, change.name, 'whole', changeSpecDigest)
          if (matching) continue
          const detail = noMatchDetail(state, changeSpecDigest, path)
          const text = `rule "${rule.id}": whole-spec review of change "${change.name}" is required for spec digest ${digestShort(changeSpecDigest)} (${detail}).`
          const call = `delegate(rule: "${rule.id}", change: "${change.name}")`
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
          tasks.length > 0 &&
          tasks.every((task) => task.checked)
        ) {
          const path = recordPath(cwd, rule, change.name)
          const state = await inspectRecord(path)
          const matching = recordSatisfies(state, change.name, 'whole', current.digest)
          if (matching) continue
          const detail = noMatchDetail(state, current.digest, path)
          const text = `rule "${rule.id}": integration review of change "${change.name}" is ${rule.gate === 'soft' ? 'suggested' : 'required'} for worktree digest ${digestShort(current.digest)} (${detail}).`
          const call = `delegate(rule: "${rule.id}", change: "${change.name}")`
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
      for (const task of tasks.filter((entry) => entry.checked)) {
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
        const detail = findingsOnly
          ? 'its review record has unresolved findings'
          : 'it has no task-review PASS/ERROR record'
        const text = `rule "${(strictTaskRule ?? softTaskRule)?.id ?? 'task-review'}": checked task "${task.number} ${task.text}" in change "${change.name}" requires its task-scoped review; ${detail}.`
        const ruleId = (strictTaskRule ?? softTaskRule)?.id ?? 'task-review'
        const call = `delegate(rule: "${ruleId}", change: "${change.name}")`
        if (strictTaskRule !== undefined) pushStrict(ruleId, text, call)
        else if (softTaskRule !== undefined) {
          pushSoft(`task-review:${change.name}:${task.id}`, ruleId, text, call)
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
        const newlyChecked = tasks.filter((task) => task.checked && !baseChecked.has(task.id))
        let tickedReviewed = false
        for (const task of newlyChecked) {
          for (const rule of taskRules) {
            const state = await inspectRecord(recordPath(cwd, rule, change.name, task.id))
            if (recordSatisfies(state, change.name, 'task', undefined, task.id)) {
              tickedReviewed = true
            }
          }
        }
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
          const what =
            nextTask === undefined
              ? 'tick the completed task and run its task review'
              : taskReviewRule === undefined
                ? `tick the completed task, or record task_progress(task: "${nextTask.number} ${nextTask.text}", status: "in-progress", reason: "...")`
                : `tick the completed task and run delegate(rule: "${taskReviewRule.id}"), or record task_progress(task: "${nextTask.number} ${nextTask.text}", status: "in-progress", reason: "...")`
          const ruleId =
            workRules.find((rule) => rule.gate === 'strict')?.id ??
            workRules[0]?.id ??
            'task-progress'
          const text = `rule "${ruleId}": this turn changed implementation files in change "${change.name}" without a newly checked-and-reviewed task and without a matching progress note for worktree digest ${digestShort(current.digest)}; ${what}.`
          const call =
            nextTask === undefined && taskReviewRule !== undefined
              ? `delegate(rule: "${taskReviewRule.id}", change: "${change.name}")`
              : nextTask === undefined
                ? 'none: no task-review rule is configured; disable the task-progress rule or add a task review'
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

  if (openspecRoot !== undefined && current.digestError !== undefined) {
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
        deps.state.recordToolResult(String(exec.agent.id), result.isError)
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
          context: {
            type: 'string',
            description: 'Facts the target needs: failing output, relevant files, constraints.',
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
  }
  const engine = new DelegationEngine(validated, services)
  for (const definition of buildToolDefinitions(engine, validated)) {
    ctx.tools.register(definition)
  }
  ctx.skills.registerProvider(() => createSkillProvider(skillAdapterNote()))
  attachGate({ ctx, deps: { config: validated, state, services } })
}
