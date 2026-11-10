import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type {
  SubagentRunEndInfo,
  SubagentRunInfo,
  SubagentRuntime,
} from '@deepseek-ai/dsh-subagent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { adoptChange } from './adoption.js'
import { registerWorkflowRoutes } from './api.js'
import { installDefinition, loadApprovedDefinitions } from './approval-store.js'
import { CHANGE_NAME, parseArchiveCommand, parseOpenspecCommand } from './command-parse.js'
import { runWorkflowCommand, type WorkflowCommandHost } from './commands.js'
import {
  type Definition,
  KNOWN_LEGACY_SOURCES,
  loadShippedDefinitions,
  resolveOwnership,
  workspaceDefinitionsDirectory,
} from './definitions.js'
import {
  listEditorDefinitions,
  readEditorDefinitionDocument,
  registerEditorRoutes,
} from './editor-api.js'
import { evaluateEvent, type ObservedEvent } from './evaluate.js'
import {
  commandMatches,
  ignoredWrite,
  lastCodeWriteAt,
  type ShellResultObservation,
  sameCheckDirectory,
  type ToolCallObservation,
  verifyEvidence,
} from './evidence.js'
import {
  adaptUserQuestions,
  type DshUserQuestions,
  OwnedCalls,
  requestMainStep,
  type SubagentRunner,
  type ToolRunner,
} from './executors.js'
import { type FsChangeWatcher, startFsChangeWatcher } from './fs-change.js'
import {
  authorizationWriteDecision,
  evaluateArchiveGate,
  evaluateIntakeGate,
  evaluateTurnClose,
} from './gates.js'
import { WorkflowHealth } from './health.js'
import { HostAuth } from './host-auth.js'
import { advanceIntake } from './intake.js'
import {
  Journal,
  type JournalInput,
  MAX_RECORD_BYTES,
  type TriggerEvaluationRecord,
  toolResultText,
  workflowsDirectory,
} from './journal.js'
import {
  type CheckpointObservation,
  checkpointGateIssue,
  parityLoadIssues,
  readParityReport,
  resolveVerifySettings,
  shippedParityReportPath,
  taskReviewCompletion,
  taskReviewCoverage,
  withVerifySettings,
} from './parity.js'
import { registerActiveRunsContext } from './prompt.js'
import { issueCompletionReceipt, listReceipts } from './receipts.js'
import { cancelRun, pendingStep, recoverRuns, resumeRun } from './resume.js'
import {
  addViolation,
  completeNotApplicable,
  createRun,
  DEFAULT_MAX_RUNS,
  hasTamperedRuns,
  incrementTurnBlocks,
  interruptEndedRun,
  isOpenRun,
  listAuthenticatedRuns,
  openRunCount,
  pruneRuns,
  readAuthenticatedRun,
  runFailure,
  setRunStatus,
  storedRuns,
  type WorkflowRun,
  writeRun,
  writeRunSync,
} from './runs.js'
import { checkedTaskIds } from './tasks.js'
import { executeWorkflowsTool, type WorkflowsToolHost } from './tools.js'
import {
  checkpointRequired,
  classifyIntent,
  type DefinitionEvent,
  evaluateDefinitions,
  evaluateDefinitionTrigger,
  evaluateIntents,
  intentDedupeKey,
  loadCatalog,
  obligationDedupeKey,
  type StartRunOutcome,
} from './triggers.js'

/** Workflows: a read-only Host recorder and the Workflows conversation view. */
export const name = '@dsh-setup/plugin-workflows'

/**
 * Host services the recorder needs. A host without them stays inert instead of
 * registering half a surface; the Client half independently checks its own.
 */
export const inject = ['agents', 'workingDirectory', 'fs', 'connection', 'systemPrompt']

/**
 * The tools whose presence means a legacy activation plugin is installed. The
 * row itself is not readable from a plugin, so its registered tools are the
 * mechanical proof the gate is live.
 */
const LEGACY_TOOL_NAMES: Readonly<Record<string, readonly string[]>> = {
  'delegation-rules': ['delegate', 'task_progress', 'delegation_status'],
  'goal-continuity': ['work_checkpoint'],
}

/** Whether a workspace carries any installed local definition file. */
async function hasLocalDefinitionFiles(workspace: string): Promise<boolean> {
  try {
    const names = await readdir(workspaceDefinitionsDirectory(workspace))
    return names.some((name) => name.endsWith('.json'))
  } catch {
    return false
  }
}

/** The verdict a review record carries, read for the review trigger filter. */
function reviewVerdict(workspace: string, path: string): string | undefined {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(workspace, path), 'utf8'))
    if (typeof raw === 'object' && raw !== null) {
      const verdict = (raw as { verdict?: unknown }).verdict
      return typeof verdict === 'string' ? verdict : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Normalize one observed plugin event into definition trigger events. */
export function definitionEventsOf(
  input: JournalInput,
  event: ObservedEvent,
  workspace: string,
): DefinitionEvent[] {
  const base = {
    workspace,
    session: input.session,
    ...(input.turn === undefined ? {} : { turn: input.turn }),
  }
  switch (event.kind) {
    case 'agent.turn-stop':
      return [{ kind: 'turn.stopping', subject: 'stop-attempt', ...base }]
    case 'tool.result':
      return event.tool === undefined
        ? []
        : [
            {
              kind: 'tool.result',
              subject: event.tool,
              tool: event.tool,
              ...(input.callId === undefined ? {} : { callId: input.callId }),
              ...base,
            },
          ]
    case 'fs.change': {
      const path = event.subject
      const changeName = /^openspec\/changes\/([^/]+)\//u.exec(path)?.[1]
      const events: DefinitionEvent[] = [
        {
          kind: 'fs.change',
          subject: path,
          path,
          ...(changeName === undefined ? {} : { name: changeName }),
          ...(event.hash === undefined ? {} : { hash: event.hash }),
          ...base,
        },
      ]
      if (/(?:^|\/)reviews\/[^/]+\.json$/u.test(path)) {
        const verdict = reviewVerdict(workspace, path)
        events.push({
          kind: 'review.record',
          subject: path,
          path,
          ...(verdict === undefined ? {} : { verdict }),
          ...(event.hash === undefined ? {} : { hash: event.hash }),
          ...base,
        })
      }
      return events
    }
    case 'subagent.end':
      return [{ kind: 'subagent.end', subject: event.subject, ...base }]
    default:
      return []
  }
}

/** The bounded text of the latest user message in a step payload. */
function lastUserText(messages: readonly unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (typeof message !== 'object' || message === null) continue
    const record = message as { readonly role?: unknown; readonly content?: unknown }
    if (record.role !== 'user') continue
    if (typeof record.content === 'string') return record.content.slice(0, 2000)
    if (!Array.isArray(record.content)) return undefined
    const text = record.content
      .map((part) => {
        if (typeof part !== 'object' || part === null) return ''
        const block = part as { readonly type?: unknown; readonly text?: unknown }
        return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
      })
      .filter((part) => part !== '')
      .join('\n')
    return text === '' ? undefined : text.slice(0, 2000)
  }
  return undefined
}

/** The Agent registry as far as the recorder reads it. */
interface AgentsService {
  get(id: string): Agent | undefined
  list(): Agent[]
}

/** Session working directories. */
interface WorkingDirectoryService {
  get(session: Session): string
}

/** The filesystem service's observation seam (used by the file watcher). */
interface FsWatchService {
  resolve(path: string, options?: { cwd?: string }): Promise<unknown>
  watch(
    target: unknown,
    changed: (error?: Error) => void,
    signal: AbortSignal,
  ): Promise<() => Promise<void>>
}

/** One exact Fetch route of the Host Connection service. */
interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered'
  fetch(request: Request): Promise<Response>
}

/** The carrier-neutral Fetch registry both the browser and desktop use. */
interface ConnectionService {
  readonly fetch: { register(route: FetchRoute): () => void }
}

interface HostServices {
  readonly agents: AgentsService
  readonly workingDirectory: WorkingDirectoryService
  readonly fs: FsWatchService
  readonly connection: ConnectionService
}

/** Probe every required service; `undefined` means the plugin stays inert. */
function hostServices(ctx: Context): HostServices | undefined {
  const agents = ctx.get('agents') as AgentsService | undefined
  const workingDirectory = ctx.get('workingDirectory') as WorkingDirectoryService | undefined
  const fs = ctx.get('fs') as FsWatchService | undefined
  const connection = ctx.get('connection') as ConnectionService | undefined
  if (
    agents === undefined ||
    typeof agents.get !== 'function' ||
    typeof agents.list !== 'function' ||
    workingDirectory === undefined ||
    typeof workingDirectory.get !== 'function' ||
    fs === undefined ||
    typeof fs.watch !== 'function' ||
    connection === undefined ||
    typeof connection.fetch?.register !== 'function'
  ) {
    return undefined
  }
  return { agents, workingDirectory, fs, connection }
}

/** The workspace one session's local files belong to, or undefined if it is gone. */
function workspaceFor(services: HostServices, session: Session): string | undefined {
  try {
    return services.workingDirectory.get(session)
  } catch {
    return undefined
  }
}

/** Render an unknown stop reason as one bounded line. */
function describe(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

const WORKER_TOOL_NAMES = new Set([
  'subagent',
  'subagent_fork',
  'spawn_teammate',
  'workflow',
  'delegate',
])

/** Whether a delegate result's first line reports a started run rather than reuse. */
function delegateStarted(resultText: string): boolean {
  // Answer-contract results always ran a target and END with this trailer; a
  // cached record may quote it inside its evidence, which proves nothing.
  if (
    resultText
      .trimEnd()
      .endsWith('(no gate record: this answer does not satisfy a strict review rule)')
  ) {
    return true
  }
  const first = resultText.split(/\r?\n/u)[0] ?? ''
  if (/^rule "[^"]+" review (?:already pending|queued)$/u.test(first)) return false
  // Only the engine's own cached-record envelope is a reuse.
  return !/^rule "[^"]+" (?:PASS|FINDINGS|ERROR) \(reused record /u.test(first)
}

/** Characters a tool name may keep in a journal summary. */
const SAFE_NAME = /[^A-Za-z0-9._-]+/gu

/** The handle `delegate` mints: `run-<base36>-<8 hex>`. */
const RUN_ID = /^run-[a-z0-9]+-[a-f0-9]{8}$/u

/**
 * The journal stores an index, never the tool's output text. Only fixed,
 * validated identity fields are kept; the raw payload stays in the session log,
 * so a credential in a tool result cannot reach the journal at all. A delegate
 * result keeps its run handle because the run projection attributes it.
 */
function toolSummary(name: string, isError: boolean, text: string): string {
  const tool = name.replace(SAFE_NAME, '_').slice(0, 80)
  if (tool === 'delegate') {
    const lines = text.split('\n').slice(0, 6)
    const mode = lines
      .map(
        (line) => /\brule\s+"[^"]*"\s+review\s+(started|queued|already pending)\b/u.exec(line)?.[1],
      )
      .find((value) => value !== undefined)
    const runLine = lines.find((line) => line.trimStart().startsWith('run:'))
    const run = runLine?.replace(/^\s*run:\s*/u, '').trim()
    if (mode !== undefined && run !== undefined && RUN_ID.test(run)) {
      return `delegate review ${mode}; run: ${run}`
    }
  }
  return `${tool} ${isError ? 'failed' : 'ok'}; output omitted`
}

/** The row-level retro applicability settings; they mirror the goal-continuity row. */
export interface CheckpointApplicabilityConfig {
  /** Minimum tool calls in a turn before a checkpoint is required; default 4. */
  readonly minToolCalls?: number
  /** Require a write or a started worker; default true. */
  readonly requireWrite?: boolean
  /** Consecutive checkpoints a bottleneck may persist before a route change; default 2. */
  readonly bottleneckAge?: number
  /** Steps after the latest checkpoint before it is stale; default 40. */
  readonly stepInterval?: number
  /** Require a tagged worker start for computed parallel lanes; default true. */
  readonly enforceParallel?: boolean
}

export interface ResolvedCheckpointApplicability {
  readonly minToolCalls: number
  readonly requireWrite: boolean
  readonly bottleneckAge: number
  readonly stepInterval: number
  readonly enforceParallel: boolean
}

export const DEFAULT_CHECKPOINT_APPLICABILITY: ResolvedCheckpointApplicability = Object.freeze({
  minToolCalls: 4,
  requireWrite: true,
  bottleneckAge: 2,
  stepInterval: 40,
  enforceParallel: true,
})

/** Validate the row's checkpoint applicability fail-loud, naming the field. */
function resolveCheckpointApplicability(raw: unknown): ResolvedCheckpointApplicability {
  if (raw === undefined) return DEFAULT_CHECKPOINT_APPLICABILITY
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('workflows checkpointApplicability must be an object')
  }
  const record = raw as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (
      key !== 'minToolCalls' &&
      key !== 'requireWrite' &&
      key !== 'bottleneckAge' &&
      key !== 'stepInterval' &&
      key !== 'enforceParallel'
    ) {
      throw new Error(`workflows checkpointApplicability has an unknown field "${key}"`)
    }
  }
  const minToolCalls = record.minToolCalls
  if (
    minToolCalls !== undefined &&
    (typeof minToolCalls !== 'number' ||
      !Number.isSafeInteger(minToolCalls) ||
      minToolCalls < 1 ||
      minToolCalls > 1000)
  ) {
    throw new Error(
      'workflows checkpointApplicability.minToolCalls must be an integer between 1 and 1000',
    )
  }
  const requireWrite = record.requireWrite
  if (requireWrite !== undefined && typeof requireWrite !== 'boolean') {
    throw new Error('workflows checkpointApplicability.requireWrite must be a boolean')
  }
  const bottleneckAge = record.bottleneckAge
  if (
    bottleneckAge !== undefined &&
    (typeof bottleneckAge !== 'number' ||
      !Number.isSafeInteger(bottleneckAge) ||
      bottleneckAge < 1 ||
      bottleneckAge > 1000)
  ) {
    throw new Error(
      'workflows checkpointApplicability.bottleneckAge must be an integer between 1 and 1000',
    )
  }
  const stepInterval = record.stepInterval
  if (
    stepInterval !== undefined &&
    (typeof stepInterval !== 'number' ||
      !Number.isSafeInteger(stepInterval) ||
      stepInterval < 1 ||
      stepInterval > 10_000)
  ) {
    throw new Error(
      'workflows checkpointApplicability.stepInterval must be an integer between 1 and 10000',
    )
  }
  const enforceParallel = record.enforceParallel
  if (enforceParallel !== undefined && typeof enforceParallel !== 'boolean') {
    throw new Error('workflows checkpointApplicability.enforceParallel must be a boolean')
  }
  return {
    minToolCalls:
      (minToolCalls as number | undefined) ?? DEFAULT_CHECKPOINT_APPLICABILITY.minToolCalls,
    requireWrite:
      (requireWrite as boolean | undefined) ?? DEFAULT_CHECKPOINT_APPLICABILITY.requireWrite,
    bottleneckAge:
      (bottleneckAge as number | undefined) ?? DEFAULT_CHECKPOINT_APPLICABILITY.bottleneckAge,
    stepInterval:
      (stepInterval as number | undefined) ?? DEFAULT_CHECKPOINT_APPLICABILITY.stepInterval,
    enforceParallel:
      (enforceParallel as boolean | undefined) ?? DEFAULT_CHECKPOINT_APPLICABILITY.enforceParallel,
  }
}

/**
 * Register the recorder. Every listener is observe-only: it never calls
 * `agent.steer`, `agent.inject`, or a tool, and a thrown observation is
 * contained so the turn is unaffected.
 */
export interface WorkflowsConfig {
  /** The engine-level opt-in for the optional intent trigger; default false. */
  readonly allowIntent?: boolean
  /** The open-run limit for every admission path; default 20. */
  readonly maxRuns?: number
  /** The retro applicability settings; must mirror the goal-continuity row. */
  readonly checkpointApplicability?: CheckpointApplicabilityConfig
  /** The validate-only profile settings for the `verify` definition. */
  readonly verify?: { readonly commands?: readonly string[]; readonly maxBlocks?: number }
}

export function apply(ctx: Context, config: WorkflowsConfig = {}): void {
  if (config.allowIntent !== undefined && typeof config.allowIntent !== 'boolean') {
    throw new Error('workflows allowIntent must be a boolean')
  }
  if (config.maxRuns !== undefined && (!Number.isInteger(config.maxRuns) || config.maxRuns < 1)) {
    throw new Error('workflows maxRuns must be a positive integer')
  }
  const engineAllowIntent = config.allowIntent === true
  const maxRuns = config.maxRuns ?? DEFAULT_MAX_RUNS
  const checkpointApplicability = resolveCheckpointApplicability(config.checkpointApplicability)
  const verifySettings = resolveVerifySettings(config.verify)
  // A malformed shipped trigger refuses the plugin load, naming the field.
  const triggers = loadCatalog()
  // A malformed or duplicate shipped definition refuses the plugin load too.
  loadShippedDefinitions()
  const services = hostServices(ctx)
  if (services === undefined) {
    console.error('workflows: required Host services are unavailable; the recorder is inert')
    return
  }
  const journal = new Journal()
  /** Latest turn per session, so a tool result belongs to a turn. */
  const turns = new Map<string, number>()
  /** De-duplication identities already evaluated for one session. */
  const seen = new Map<string, Map<string, number>>()
  /** One health writer per workspace, created on its first event. */
  const healths = new Map<string, WorkflowHealth>()
  let pluginDisposed = false
  /** The session most recently observed in each workspace. */
  const activeSession = new Map<string, string>()
  /** Whether a session is a root agent; the legacy gates exclude children. */
  const rootSessions = new Map<string, boolean>()
  /** One change-tree watcher per workspace, started on its first event. */
  const watchers = new Map<string, FsChangeWatcher>()
  const watching = new Set<string>()
  /** Whether a workspace's change source started successfully. */
  const watchHealthy = new Map<string, boolean>()
  let listenerCount = 0
  let scopedFailures = 0
  let registrationError: unknown
  const triggerCount = triggers.length
  /** The count every published health file must use right now. */
  const publishedListenerCount = (workspace: string): number =>
    Math.max(0, listenerCount + (watchHealthy.get(workspace) === true ? 1 : 0) - scopedFailures)
  const healthFor = (workspace: string): WorkflowHealth => {
    const existing = healths.get(workspace)
    if (existing !== undefined) return existing
    const health = new WorkflowHealth({
      root: workflowsDirectory(workspace),
      triggerCount,
    })
    health.setListenerCount(publishedListenerCount(workspace))
    if (registrationError !== undefined) health.recordError(registrationError)
    void health.start().catch((error: unknown) => {
      console.error(`workflows: health could not start (${String(error)})`)
    })
    healths.set(workspace, health)
    return health
  }
  /** Register one required observer, publishing a failure instead of throwing. */
  const listen = (register: () => unknown): void => {
    try {
      register()
      listenerCount += 1
    } catch (error) {
      registrationError ??= error
    }
  }
  /** The engine gates register without changing the observability listener count. */
  const listenEngine = (register: () => unknown): void => {
    try {
      register()
    } catch (error) {
      registrationError ??= error
    }
  }
  /** A scoped per-agent registration failure is visible and lowers the count. */
  const failScopedListener = (error: unknown): void => {
    scopedFailures += 1
    registrationError ??= error
    for (const [workspace, health] of healths) {
      health.recordError(error)
      health.setListenerCount(publishedListenerCount(workspace))
    }
  }
  /** Publish one contained observer failure as the health's last error. */
  const publishListenerError = (workspace: string | undefined, error: unknown): void => {
    if (workspace === undefined) return
    try {
      healthFor(workspace).recordError(error)
    } catch {
      // Health reporting never breaks dispatch.
    }
  }
  /** Approved definitions per workspace, loaded once on first observation. */
  const definitionsByWorkspace = new Map<string, readonly Definition[]>()
  let storedAuth: HostAuth | undefined
  let authPromise: Promise<HostAuth | undefined> | undefined
  /** Load the host key once; a failure is reported and leaves runs unsigned. */
  const ensureAuth = (): Promise<HostAuth | undefined> => {
    authPromise ??= HostAuth.load()
      .then((auth) => {
        storedAuth = auth
        return auth
      })
      .catch((error: unknown) => {
        console.error(
          `workflows: the host key could not be loaded (${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)})`,
        )
        return undefined
      })
    return authPromise
  }
  /** The legacy sources the installed profile proves through its tools. */
  const installedLegacySources = (): Set<string> => {
    const installed = new Set<string>()
    try {
      const tools = ctx.get('tools') as { get?: (name: string) => unknown } | undefined
      for (const plugin of KNOWN_LEGACY_SOURCES) {
        const names = LEGACY_TOOL_NAMES[plugin] ?? []
        if (names.some((name) => tools?.get?.(name) !== undefined)) installed.add(plugin)
      }
    } catch {
      // An unreadable tool registry proves nothing; ownership then refuses defer.
    }
    return installed
  }
  /**
   * The legacy per-signal state: installed providers plus the signals whose
   * gate-only switch is on. The legacy plugins publish their switch through a
   * small status service; a missing service means the signal does not steer.
   */
  const legacySignalState = (): { installed: Set<string>; enabled: Set<string> } => {
    const installed = installedLegacySources()
    const enabled = new Set<string>()
    try {
      if (installed.has('delegation-rules')) {
        // The spec-review, progress, and lane gates stay on under either switch
        // value; only the task-review rule and the archive gate follow it. The
        // spec-review signal exists only while a steering rule is configured.
        const status = ctx.get('delegationRulesStatus') as
          | { workflowOwned?: unknown; specReview?: unknown; taskReview?: unknown }
          | undefined
        for (const signal of ['task-progress', 'lane-assignment', 'lane-boundary']) {
          enabled.add(`delegation-rules/${signal}`)
        }
        if (status?.specReview !== false) enabled.add('delegation-rules/spec-review')
        if (status?.workflowOwned !== false && status?.taskReview !== false) {
          enabled.add('delegation-rules/task-review')
          enabled.add('delegation-rules/archive')
        }
      }
      const checkpoint = ctx.get('goalContinuityStatus') as { automation?: unknown } | undefined
      if (checkpoint?.automation === true) {
        enabled.add('goal-continuity/work_checkpoint')
      }
      const verification = ctx.get('verificationGateStatus') as { steering?: unknown } | undefined
      if (verification !== undefined) {
        installed.add('verification-gate')
        if (verification.steering === true) enabled.add('verification-gate/verification-gate')
      }
    } catch {
      // An unreadable status service proves nothing; the signal stays disabled.
    }
    return { installed, enabled }
  }
  /** Load the shipped set plus the approved local overrides for one workspace. */
  const definitionLoads = new Map<string, Promise<void>>()
  const loadDefinitions = (workspace: string): Promise<void> => {
    const existing = definitionLoads.get(workspace)
    if (existing !== undefined) return existing
    if (pluginDisposed) return Promise.resolve()
    const promise = (async () => {
      try {
        if (await hasLocalDefinitionFiles(workspace)) await ensureAuth()
        const legacy = legacySignalState()
        const loaded = await loadApprovedDefinitions(workspace, {
          ...(storedAuth === undefined ? {} : { auth: storedAuth }),
          installedLegacy: legacy.installed,
          enabledLegacy: legacy.enabled,
        })
        // The release-bound parity report gates every `own` definition; the
        // verified profile settings are applied only after its template check.
        const parity = readParityReport()
        const parityCheck = parityLoadIssues(
          loaded.definitions,
          parity.report,
          shippedParityReportPath(),
          parity.error,
        )
        const loadErrors = [...loaded.errors, ...parityCheck.issues]
        const accepted = loaded.definitions
          .filter((definition) => !parityCheck.refused.has(definition.id))
          .map((definition) => withVerifySettings(definition, verifySettings))
        if (pluginDisposed) return
        definitionsByWorkspace.set(workspace, accepted)
        // A run is authoritative only when signed, so an active definition
        // needs the host key ready before its first event.
        if (accepted.some((definition) => definition.trigger.mode === 'active')) {
          void ensureAuth()
        }
        // Definition-load refusals are diagnostics, not listener failures: they
        // must not overwrite the health strip's single last-error slot.
        for (const message of loadErrors) {
          console.error(`workflows: ${message.slice(0, 300)}`)
        }
      } catch (error) {
        if (!pluginDisposed) {
          definitionsByWorkspace.set(workspace, [])
          console.error(
            `workflows: the definitions could not be loaded (${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)})`,
          )
        }
      }
    })()
    definitionLoads.set(workspace, promise)
    return promise
  }
  /** The approved definitions of one workspace, loaded on first use. */
  const definitionsFor = async (workspace: string): Promise<Definition[]> => {
    await loadDefinitions(workspace)
    return [...(definitionsByWorkspace.get(workspace) ?? [])]
  }
  /** Start one run for an active trigger; persistence happens before success. */
  const startDefinitionRun = (
    workspace: string,
    definition: Definition,
    event: DefinitionEvent,
    blocked = false,
    extraContext: Readonly<Record<string, unknown>> = {},
  ): StartRunOutcome => {
    const auth = storedAuth
    if (auth === undefined) {
      void ensureAuth()
      return {
        ok: false,
        reason: 'the host key is not ready yet; no unsigned run is created',
      }
    }
    if (blocked) {
      return {
        ok: false,
        reason: `the run limit (${String(maxRuns)}) is reached; finish or cancel an open run first`,
      }
    }
    reserveStart(workspace)
    try {
      const dedupeKey = obligationDedupeKey(definition.id, definition.trigger, event)
      const session = event.session ?? ''
      const entryGeneration = sessionGeneration(session)
      const run = createRun({
        definition: { id: definition.id, name: definition.name, version: definition.version },

        trigger: definition.trigger.kind,
        session: event.session ?? '',
        workspace,
        context: {
          ...(event.name === undefined ? {} : { name: event.name }),
          ...extraContext,
        },
        steps: definition.steps.map((step) => step.id),
        now: journal.time(),
        ...(dedupeKey === undefined ? {} : { dedupeKey }),
      })
      // A queued trigger evaluation can run after the session was disposed.
      creationCounter += 1
      runCreationOrder.set(run.id, creationCounter)
      knownRunIds.add(run.id)
      const fenced = endedSessionIds.has(session) || entryGeneration !== sessionGeneration(session)
      writeRunSync(
        workspace,
        fenced
          ? setRunStatus(
              run,
              'interrupted',
              journal.time(),
              'the session ended before the run started',
            )
          : run,
        auth,
      )
      storeRevision += 1
      lifecycleEpoch += 1
      void refreshPromptRuns(workspace)
      return { ok: true, runId: run.id }
    } catch (error) {
      return { ok: false, reason: runFailure(error) }
    } finally {
      releaseStart(workspace)
    }
  }
  /** The prompt's active runs per workspace, refreshed after every transition. */
  const promptRunsByWorkspace = new Map<string, WorkflowRun[]>()
  const sessionWorkspaces = new Map<string, string>()
  let promptWorkspace: string | undefined
  const refreshPromptRuns = async (workspace: string): Promise<void> => {
    const auth = storedAuth
    if (auth === undefined) return
    try {
      const runs = await listAuthenticatedRuns(workspace, auth)
      promptRunsByWorkspace.set(
        workspace,
        runs.filter(
          (run) =>
            run.status === 'running' || run.status === 'blocked' || run.status === 'interrupted',
        ),
      )
      promptWorkspace = workspace
    } catch {
      // Keep the last good prompt when a refresh cannot read the store.
    }
  }
  /** The session a prompt assembly scope names, when the engine supplies one. */
  const scopeSession = (scope: unknown): string | undefined => {
    if (typeof scope === 'string') return scope
    if (scope === null || typeof scope !== 'object') return undefined
    const record = scope as Record<string, unknown>
    for (const key of ['sessionId', 'session', 'id']) {
      if (typeof record[key] === 'string') return record[key] as string
    }
    return undefined
  }
  /** The active runs for the assembly's session, or the last refreshed workspace. */
  const activePromptRuns = (context?: { readonly scope?: unknown }): WorkflowRun[] => {
    const session = scopeSession(context?.scope)
    const workspace =
      session === undefined ? promptWorkspace : (sessionWorkspaces.get(session) ?? promptWorkspace)
    if (workspace === undefined) return []
    const runs = promptRunsByWorkspace.get(workspace) ?? []
    // Another session's run is viewable in the UI but is not this session's
    // obligation; an unknown scope keeps the workspace-scoped list.
    return session === undefined ? runs : runs.filter((run) => run.session === session)
  }
  /** Mark unfinished runs from a previous process interrupted, never completed. */
  const recoveries = new Map<string, Promise<void>>()
  /** One startup recovery per workspace; later agents must not re-interrupt live runs. */
  const recoverIfNeeded = (workspace: string): Promise<void> => {
    const existing = recoveries.get(workspace)
    if (existing !== undefined) return existing
    const promise = (async () => {
      try {
        if ((await storedRuns(workspace)).length === 0 || pluginDisposed) return
        const auth = await ensureAuth()
        if (auth === undefined || pluginDisposed) return
        const result = await recoverRuns(workspace, auth)
        if (result.recovered.length > 0) {
          console.error(
            `workflows: ${String(result.recovered.length)} unfinished run(s) marked interrupted; resume or cancel them instead of auto-completing`,
          )
        }
        if (!pluginDisposed) {
          // Retention runs at boot, before the next session adds history.
          await pruneRuns(workspace, { auth })
          await refreshPromptRuns(workspace)
        }
      } catch (error) {
        console.error(
          `workflows: run recovery failed (${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)})`,
        )
      }
    })()
    recoveries.set(workspace, promise)
    return promise
  }
  /** Begin health for a session workspace as soon as the session is known. */
  const observeSession = (session: Session): void => {
    try {
      const workspace = workspaceFor(services, session)
      if (workspace !== undefined) {
        activeSession.set(workspace, String(session.id))
        sessionWorkspaces.set(String(session.id), workspace)
        const header = session.header as {
          origin?: string
          delegationDepth?: number
          parentSession?: unknown
        }
        rootSessions.set(
          String(session.id),
          header.origin !== 'subagent' &&
            (header.delegationDepth ?? 0) === 0 &&
            header.parentSession === undefined,
        )
        seedCheckedTasks(workspace, String(session.id))
        healthFor(workspace)
        watchChanges(workspace)
        void loadDefinitions(workspace)
        recoverIfNeeded(workspace)
      }
    } catch {
      // A session without a usable workspace keeps the rest of the host working.
    }
  }
  ctx.effect(() => () => {
    pluginDisposed = true
    for (const health of healths.values()) health.dispose()
    healths.clear()
    for (const watcher of watchers.values()) void watcher.dispose()
    watchers.clear()
    watching.clear()
  })

  const sessionEventAt = new Map<string, number>()
  interface TurnMetrics {
    turn: number
    toolCalls: number
    lastTool?: string
    written: number
    workers: number
    /** Latest successful code write, independent of observation eviction. */
    lastWriteAt?: number
    lastWritePath?: string
    /** Latest successful configured verification check. */
    lastCheckAt?: number
  }
  const turnMetrics = new Map<string, TurnMetrics>()
  /** Bounded per-session observations the evidence verifier may consume. */
  const sessionToolCalls = new Map<string, ToolCallObservation[]>()
  /** A monotonic observation counter; eviction must not reuse sequence numbers. */
  const observationSeq = new Map<string, number>()
  /** Invocation order per call, so a result recorded later keeps its call order. */
  const pendingCallSeq = new Map<string, number>()
  const nextObservationSeq = (session: string): number => {
    const next = observationSeq.get(session) ?? 0
    observationSeq.set(session, next + 1)
    return next
  }
  const sessionShellResults = new Map<string, ShellResultObservation[]>()
  /** The current pre-step index per session, for checkpoint freshness. */
  const turnSteps = new Map<string, number>()
  /** The checked task ids last seen per session and change, for the delta. */
  const checkedTasksSeen = new Map<string, ReadonlySet<string>>()
  /** Every newly-checked task id for a tasks.md change, newest last. */
  const checkedTaskDelta = (
    workspace: string,
    session: string,
    change: string,
    path: string,
  ): string[] => {
    try {
      const markdown = readFileSync(join(workspace, path), 'utf8')
      const ids = checkedTaskIds(markdown)
      const key = `${session}\u0000${change}`
      const previous = checkedTasksSeen.get(key)
      checkedTasksSeen.set(key, new Set(ids))
      if (previous === undefined) return []
      return ids.filter((id) => !previous.has(id))
    } catch {
      // A vanished or unreadable tasks.md resets the baseline: restoring the
      // file must count every checked task as newly checked again.
      checkedTasksSeen.set(`${session}\u0000${change}`, new Set())
      return []
    }
  }
  /** The goal-continuity session key: a SHA-256 prefix of the session id. */
  const sessionHash = (session: string): string =>
    createHash('sha256').update(session).digest('hex').slice(0, 16)
  /** Seed the checked-task baselines from the current workspace changes. */
  const seedCheckedTasks = (workspace: string, session: string): void => {
    let changes: string[]
    try {
      changes = readdirSync(join(workspace, 'openspec', 'changes'))
    } catch {
      // No readable change tree yet; the first event seeds the baseline.
      return
    }
    for (const change of changes) {
      // The archive collection is not an active change, and one incomplete
      // change must not stop the remaining baselines from seeding.
      if (!CHANGE_NAME.test(change) || change === 'archive') continue
      try {
        const markdown = readFileSync(
          join(workspace, 'openspec', 'changes', change, 'tasks.md'),
          'utf8',
        )
        checkedTasksSeen.set(`${session}\u0000${change}`, new Set(checkedTaskIds(markdown)))
      } catch {
        // An incomplete change has no tasks.md; keep seeding the rest.
      }
    }
  }
  /** The session's current main-step owner; a second run waits for it to settle. */
  const mainStepOwners = new Map<string, string>()
  /** Runs whose session ended; a later stale advance must not revive them. */
  const endedRunIds = new Set<string>()
  /** Sessions whose agent was disposed; fenced synchronously before any store read. */
  const endedSessionIds = new Set<string>()
  /** Per-run lifecycle generations; a disposal or resume invalidates in-flight advances. */
  const runGenerations = new Map<string, number>()
  /** A monotonic creation order, so a disposal batch never touches newer runs. */
  let creationCounter = 0
  const runCreationOrder = new Map<string, number>()
  /** Run ids known before a disposal; fenced until an explicit resume. */
  const knownRunIds = new Set<string>()
  const disposalFenced = new Set<string>()
  /** Global lifecycle epoch, bumped by every generation bump. */
  let lifecycleEpoch = 0
  /** The run-store revision: every committed write bumps it. */
  let storeRevision = 0
  /** Per-session lifecycle generations; a disposal invalidates in-flight advances. */
  const sessionGenerations = new Map<string, number>()
  const sessionGeneration = (session: string): number => sessionGenerations.get(session) ?? 0
  const bumpSessionGeneration = (session: string): void => {
    lifecycleEpoch += 1
    sessionGenerations.set(session, sessionGeneration(session) + 1)
  }
  const runGeneration = (runId: string): number => runGenerations.get(runId) ?? 0
  const bumpRunGeneration = (runId: string): void => {
    lifecycleEpoch += 1
    runGenerations.set(runId, runGeneration(runId) + 1)
  }
  /**
   * Read the runs together with the generation snapshot, retrying when a
   * resume/disposal lands during the asynchronous read so a snapshot read
   * before the bump cannot be paired with the post-bump generation.
   */
  const stableRuns = async (
    workspace: string,
    auth: HostAuth,
  ): Promise<
    {
      readonly runs: WorkflowRun[]
      readonly generations: Map<string, number>
    } & { readonly stable: boolean }
  > => {
    const snapshot = (runs: WorkflowRun[], stable: boolean) => {
      for (const run of runs) knownRunIds.add(run.id)
      return {
        runs,
        generations: new Map(runs.map((run) => [run.id, runGeneration(run.id)] as const)),
        stable,
      }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const epoch = storeRevision
      const runs = await listAuthenticatedRuns(workspace, auth)
      if (storeRevision === epoch) return snapshot(runs, true)
    }
    // Never act on an unchecked snapshot: a run created, resumed or cancelled
    // during the last read is not bound to the generations captured here.
    return snapshot(await listAuthenticatedRuns(workspace, auth), false)
  }
  /** The last turn whose user message was classified, one classification per turn. */
  const intentTurns = new Map<string, number>()
  const metricsFor = (session: string, turn: number): TurnMetrics => {
    const existing = turnMetrics.get(session)
    if (existing !== undefined && existing.turn === turn) return existing
    const fresh: TurnMetrics = { turn, toolCalls: 0, written: 0, workers: 0 }
    turnMetrics.set(session, fresh)
    return fresh
  }
  /** Record one engine-only evaluation in the same journal the recorder writes. */
  const recordEngineEvaluation = async (
    workspace: string,
    session: string,
    turn: number | undefined,
    kind: string,
    subject: string,
    summary: string,
    rows: readonly TriggerEvaluationRecord[],
  ): Promise<void> => {
    const { record: bounded } = journal.record({
      at: journal.time(),
      session,
      ...(turn === undefined ? {} : { turn }),
      kind,
      subject,
      summary,
      bytes: Buffer.byteLength(summary, 'utf8'),
      truncated: false,
      ...(rows.length === 0 ? {} : { triggers: rows }),
    })
    healthFor(workspace).markEvent(bounded.at)
    sessionEventAt.set(session, bounded.at)
    const result = await journal.append(workspace, bounded)
    if (!result.ok) {
      healthFor(workspace).setJournalWritable(false)
      healthFor(workspace).recordError(result.error)
    }
  }

  const recordNow = async (
    workspace: string,
    input: JournalInput,
    event: ObservedEvent,
  ): Promise<void> => {
    const health = healthFor(workspace)
    activeSession.set(workspace, input.session)
    const entrySessionGeneration = sessionGeneration(input.session)
    await loadDefinitions(workspace)
    await recoverIfNeeded(workspace)
    try {
      await seedTriggerIdentities(workspace, input.session)
    } catch {
      // A later event retries the seed; evaluation still proceeds.
    }
    const sessionSeen = seen.get(input.session) ?? new Map<string, number>()
    seen.set(input.session, sessionSeen)
    if (
      (definitionsByWorkspace.get(workspace) ?? []).some(
        (definition) => definition.trigger.mode === 'active',
      )
    ) {
      try {
        await ensureAuth()
      } catch {
        // A run start is suppressed and journaled if the key cannot load.
      }
    }
    const releaseAdmission = await acquireAdmission(workspace)
    try {
      const stableKnown =
        storedAuth === undefined
          ? {
              runs: [] as WorkflowRun[],
              generations: new Map<string, number>(),
              stable: true,
            }
          : await stableRuns(workspace, storedAuth)
      const knownRuns = stableKnown.runs
      const knownRunGenerations = stableKnown.generations
      const runLimitReached = storedAuth !== undefined && atRunLimit(workspace, knownRuns)
      let startedThisEvent = 0
      const records = evaluateEvent(triggers, event, sessionSeen, true, input.at)
      const metrics = input.turn === undefined ? undefined : turnMetrics.get(input.session)
      // The checked-task delta names the task a task-review run reads. It is
      // computed here, not added to the observed fs.change event.
      const changedName =
        event.kind === 'fs.change'
          ? /^openspec\/changes\/([^/]+)\//u.exec(event.subject)?.[1]
          : undefined
      const taskReviewTaskIds =
        changedName !== undefined && /(?:^|\/)tasks\.md$/u.test(event.subject)
          ? checkedTaskDelta(workspace, input.session, changedName, event.subject)
          : []
      const definitionRows = definitionEventsOf(input, event, workspace).flatMap(
        (definitionEvent) =>
          evaluateDefinitions(definitionsByWorkspace.get(workspace) ?? [], definitionEvent, {
            // A newly checked task must reach the per-task live-run guard even
            // when the whole-file content key was already seen for another
            // task's run; the guard below still prevents duplicates.
            isDuplicate: (key, definition) =>
              definition?.id === 'task-review' && taskReviewTaskIds.length > 0
                ? false
                : sessionSeen.has(key),
            markKey: (key) => sessionSeen.set(key, input.at),
            startRun: (definition, matched) => {
              const limited = (): boolean =>
                storedAuth !== undefined &&
                (runLimitReached || openRunCount(knownRuns) + startedThisEvent >= maxRuns)
              if (definition.id === 'task-review') {
                // The watcher coalesces writes, so every newly checked task
                // gets its own observational run.
                if (taskReviewTaskIds.length === 0) {
                  return { ok: false, reason: 'no newly checked task in this tasks.md change' }
                }
                let first: StartRunOutcome | undefined
                let suppressed: StartRunOutcome | undefined
                // Task identity hashes only the text, so two checked tasks with
                // the same text share an id and must not start two runs.
                for (const taskId of new Set(taskReviewTaskIds)) {
                  // A live run for the same change and task already owns the
                  // obligation; a dead-session run must not block the new one.
                  const duplicate = knownRuns.find(
                    (run) =>
                      run.definition.id === 'task-review' &&
                      run.context.name === matched.name &&
                      run.context.taskId === taskId &&
                      isOpenRun(run) &&
                      services.agents.get(run.session) !== undefined,
                  )
                  if (duplicate !== undefined) {
                    suppressed ??= {
                      ok: false,
                      reason: `a live run "${duplicate.id}" already covers task "${taskId}"`,
                    }
                    continue
                  }
                  const outcome = startDefinitionRun(workspace, definition, matched, limited(), {
                    taskId,
                  })
                  if (outcome.ok) {
                    startedThisEvent += 1
                    first ??= outcome
                  } else {
                    suppressed ??= outcome
                  }
                }
                return (
                  first ??
                  suppressed ?? { ok: false, reason: 'the observational run was not started' }
                )
              }
              const extraContext =
                definition.id === 'retro' &&
                matched.turn !== undefined &&
                matched.session !== undefined
                  ? {
                      checkpoint: `.dsh/work-checkpoints/${sessionHash(String(matched.session))}/${String(matched.turn)}.json`,
                    }
                  : {}
              const outcome = startDefinitionRun(
                workspace,
                definition,
                matched,
                limited(),
                extraContext,
              )
              if (outcome.ok) startedThisEvent += 1
              return outcome
            },
            resolveApplicability: (definition) => {
              if (definition.trigger.applicability === 'code-write') {
                // The verify definition observes only a turn that wrote code.
                if (rootSessions.get(input.session) !== true) return false
                const calls = (sessionToolCalls.get(input.session) ?? []).filter(
                  (call) => call.turn === undefined || call.turn === input.turn,
                )
                return (
                  lastCodeWriteAt(calls, workspace) !== undefined ||
                  (metrics?.turn === input.turn && metrics?.lastWriteAt !== undefined)
                )
              }
              if (definition.trigger.applicability !== 'checkpoint-required') return undefined
              // The legacy checkpoint gate excludes subagent sessions.
              if (rootSessions.get(input.session) !== true) return false
              const current =
                input.turn !== undefined && metrics !== undefined && metrics.turn === input.turn
                  ? metrics
                  : undefined
              return checkpointRequired({
                toolCalls: current?.toolCalls ?? 0,
                ...(current?.lastTool === undefined ? {} : { lastTool: current.lastTool }),
                written: current?.written ?? 0,
                workers: current?.workers ?? 0,
                minToolCalls: checkpointApplicability.minToolCalls,
                requireWrite: checkpointApplicability.requireWrite,
              })
            },
          }).map((row) => ({
            id: `definition:${row.definition}`,
            matched: row.matched,
            reason: row.reason,
            ...(row.path === undefined ? {} : { path: row.path }),
            ...(row.filter === undefined ? {} : { filter: row.filter }),
            ...(row.detail === undefined ? {} : { detail: row.detail }),
            ...(row.runId === undefined ? {} : { runId: row.runId }),
          })),
      )
      const evaluations = [...records, ...definitionRows]
      // A deferred observational run whose trigger later evaluates as not
      // applicable is completed so retention can prune it, never left blocked.
      // Skip it on an unstable read: a run cancelled during the final listing
      // must not be completed from the stale snapshot.
      if (storedAuth !== undefined && stableKnown.stable) {
        for (const row of definitionRows) {
          if (row.reason !== 'not-applicable') continue
          const definitionId = row.id.slice('definition:'.length)
          const existing = knownRuns.find(
            (run) =>
              run.definition.id === definitionId &&
              run.session === input.session &&
              (run.status === 'running' || run.status === 'blocked'),
          )
          if (existing === undefined) continue
          await persistRun(
            workspace,
            completeNotApplicable(existing, input.at),
            storedAuth,
            knownRunGenerations.get(existing.id),
            entrySessionGeneration,
            existing.updatedAt,
          )
        }
      }
      const { record: bounded } = journal.record({
        ...input,
        ...(evaluations.length === 0 ? {} : { triggers: evaluations }),
      })
      // The event was observed even if its record cannot be written.
      health.markEvent(bounded.at)
      sessionEventAt.set(input.session, bounded.at)
      void journal.append(workspace, bounded).then((result) => {
        if (result.ok) return
        health.setJournalWritable(false)
        health.recordError(result.error)
        console.error(`workflows: the session journal could not be written (${result.error})`)
      })
      watchChanges(workspace)
    } finally {
      releaseAdmission()
    }
  }

  /** Preserve observation order per session while definitions and keys load. */
  const recordQueues = new Map<string, Promise<void>>()
  const record = (workspace: string, input: JournalInput, event: ObservedEvent): Promise<void> => {
    const previous = recordQueues.get(input.session) ?? Promise.resolve()
    const next = previous
      .then(async () => recordNow(workspace, input, event))
      .catch((error: unknown) => publishListenerError(workspace, error))
    recordQueues.set(input.session, next)
    return next
  }

  // One change-tree watcher per workspace; it starts on the workspace's first
  // observed event and attributes a change to the session active there.
  const watchChanges = (workspace: string): void => {
    if (watchers.has(workspace) || watching.has(workspace)) return
    watching.add(workspace)
    let watchFailed = false
    void startFsChangeWatcher({
      workspace,
      fs: services.fs,
      onChange: (event) => {
        if (pluginDisposed) return
        const session = activeSession.get(workspace)
        if (session === undefined) return
        const summary = `${event.change} ${event.path}`
        record(
          workspace,
          {
            at: journal.time(),
            session,
            ...(turns.get(session) === undefined ? {} : { turn: turns.get(session) as number }),
            kind: 'fs.change',
            subject: event.path,
            summary,
            bytes: Buffer.byteLength(summary, 'utf8'),
            truncated: false,
          },
          {
            kind: 'fs.change',
            subject: event.path,
            change: event.change,
            ...(event.hash === undefined ? {} : { hash: event.hash }),
          },
        )
      },
      onError: (error) => {
        if (pluginDisposed) return
        watchFailed = true
        watchHealthy.set(workspace, false)
        healthFor(workspace).recordError(error)
        healthFor(workspace).setListenerCount(publishedListenerCount(workspace))
        console.error(`workflows: the change watcher reported an error (${error.message})`)
      },
      onRescan: (reason) => {
        if (pluginDisposed) return
        healthFor(workspace).recordError(new Error(reason))
      },
    })
      .then((watcher) => {
        if (pluginDisposed) {
          void watcher.dispose()
          return
        }
        watching.delete(workspace)
        watchers.set(workspace, watcher)
        watchHealthy.set(workspace, !watchFailed)
        healthFor(workspace).setListenerCount(publishedListenerCount(workspace))
      })
      .catch((error: unknown) => {
        if (pluginDisposed) return
        watching.delete(workspace)
        watchHealthy.set(workspace, false)
        healthFor(workspace).recordError(error)
        healthFor(workspace).setListenerCount(publishedListenerCount(workspace))
        console.error(
          `workflows: the change watcher could not start (${error instanceof Error ? error.message : String(error)})`,
        )
      })
  }

  listen(() =>
    ctx.on('agent/pre-step', async (payload, next) => {
      let workspace: string | undefined
      try {
        const session = payload.agent.session
        workspace = workspaceFor(services, session)
        if (workspace !== undefined) {
          const activeWorkspace = workspace
          turns.set(String(session.id), payload.turn)
          turnSteps.set(String(session.id), payload.step)
          metricsFor(String(session.id), payload.turn)
          const origin = session.header.origin === 'subagent' ? 'subagent' : 'root'
          const summary = `step ${String(payload.step)}`
          await record(
            workspace,
            {
              at: journal.time(),
              session: String(session.id),
              turn: payload.turn,
              kind: 'agent/pre-step',
              subject: origin,
              summary,
              bytes: Buffer.byteLength(summary, 'utf8'),
              truncated: false,
            },
            { kind: 'agent.turn-start', subject: origin },
          )
          const sessionId = String(session.id)
          const text = lastUserText(payload.messages as readonly unknown[])
          if (text !== undefined && intentTurns.get(sessionId) !== payload.turn) {
            intentTurns.set(sessionId, payload.turn)
            const classification = classifyIntent(text)
            const definitions = await definitionsFor(activeWorkspace)
            const intentDefinitions = definitions.filter(
              (definition) => definition.trigger.kind === 'intent',
            )
            if (classification !== undefined && intentDefinitions.length > 0) {
              await recoverIfNeeded(activeWorkspace)
              const releaseIntentAdmission = await acquireAdmission(activeWorkspace)
              try {
                const intentAuth = storedAuth
                const intentRuns =
                  intentAuth === undefined
                    ? []
                    : await listAuthenticatedRuns(activeWorkspace, intentAuth)
                const intentFull =
                  intentAuth !== undefined && atRunLimit(activeWorkspace, intentRuns)
                let intentStarted = 0
                const sessionSeen = seen.get(sessionId) ?? new Map<string, number>()
                seen.set(sessionId, sessionSeen)
                const rows = evaluateIntents(intentDefinitions, classification, {
                  allowIntent: engineAllowIntent,
                  confirmed: true,
                  enabled: true,
                  ready: true,
                  session: sessionId,
                  workspace: activeWorkspace,
                  turn: payload.turn,
                  isDuplicate: (key) => sessionSeen.has(key),
                  markKey: (key) => sessionSeen.set(key, journal.time()),
                  startRun: (definition) => {
                    const auth = storedAuth
                    if (auth === undefined) {
                      return {
                        ok: false,
                        reason: 'the host key is unavailable; no run was created',
                      }
                    }
                    if (intentFull || openRunCount(intentRuns) + intentStarted >= maxRuns) {
                      return {
                        ok: false,
                        reason: `the run limit (${String(maxRuns)}) is reached; finish or cancel an open run first`,
                      }
                    }
                    reserveStart(activeWorkspace)
                    try {
                      const key = intentDedupeKey(definition, classification, {
                        session: sessionId,
                        turn: payload.turn,
                      })
                      const entryGeneration = sessionGeneration(sessionId)
                      const run = createRun({
                        definition: {
                          id: definition.id,
                          name: definition.name,
                          version: definition.version,
                        },
                        trigger: 'intent',
                        session: sessionId,
                        workspace: activeWorkspace,
                        context: {
                          intent: classification.intent,
                          confidence: classification.confidence,
                          classifier: classification.classifier,
                        },
                        steps: definition.steps.map((step) => step.id),
                        now: journal.time(),
                        ...(key === undefined ? {} : { dedupeKey: key }),
                      })
                      creationCounter += 1
                      runCreationOrder.set(run.id, creationCounter)
                      knownRunIds.add(run.id)
                      const fenced =
                        endedSessionIds.has(sessionId) ||
                        entryGeneration !== sessionGeneration(sessionId)
                      writeRunSync(
                        activeWorkspace,
                        fenced
                          ? setRunStatus(
                              run,
                              'interrupted',
                              journal.time(),
                              'the session ended before the run started',
                            )
                          : run,
                        auth,
                      )
                      storeRevision += 1
                      lifecycleEpoch += 1
                      intentStarted += 1
                      return { ok: true, runId: run.id }
                    } catch (error) {
                      return { ok: false, reason: runFailure(error) }
                    } finally {
                      releaseStart(activeWorkspace)
                    }
                  },
                })
                await recordEngineEvaluation(
                  activeWorkspace,
                  sessionId,
                  payload.turn,
                  'intent',
                  classification.intent,
                  `intent ${classification.intent} (${classification.confidence.toFixed(2)})`,
                  rows.map((row) => ({
                    id: `definition:${row.definition}`,
                    matched: row.matched,
                    reason: row.reason,
                    ...(row.path === undefined ? {} : { path: row.path }),
                    ...(row.filter === undefined ? {} : { filter: row.filter }),
                    ...(row.detail === undefined ? {} : { detail: row.detail }),
                    ...(row.runId === undefined ? {} : { runId: row.runId }),
                  })),
                )
              } finally {
                releaseIntentAdmission()
              }
            }
          }
        }
      } catch (error) {
        // An observer never fails a step, but its failure stays visible.
        publishListenerError(workspace, error)
      }
      return next()
    }),
  )

  listen(() =>
    ctx.on('agent/turn-stopping', async (payload) => {
      let workspace: string | undefined
      try {
        const session = payload.agent.session
        workspace = workspaceFor(services, session)
        if (workspace === undefined) return
        turns.set(String(session.id), payload.turn)
        const summary = `turn ${String(payload.turn)} stop attempt`
        void record(
          workspace,
          {
            at: journal.time(),
            session: String(session.id),
            turn: payload.turn,
            kind: 'agent/turn-stopping',
            subject: 'stop-attempt',
            summary,
            bytes: Buffer.byteLength(summary, 'utf8'),
            truncated: false,
          },
          { kind: 'agent.turn-stop', subject: 'stop-attempt' },
        )
      } catch (error) {
        // An observer never fails a turn, but its failure stays visible.
        publishListenerError(workspace, error)
      }
    }),
  )

  listen(() =>
    ctx.on('tools/result', (exec: Readonly<ToolExecution>, result) => {
      let workspace: string | undefined
      try {
        const agent = exec.agent
        if (agent === undefined) return
        const session = agent.session
        workspace = workspaceFor(services, session)
        if (workspace === undefined) return
        const metrics = metricsFor(String(session.id), turns.get(String(session.id)) ?? 0)
        metrics.toolCalls += 1
        metrics.lastTool = exec.name
        const text = toolResultText(result)
        const args =
          typeof exec.arguments === 'object' && exec.arguments !== null
            ? (exec.arguments as Record<string, unknown>)
            : {}
        // Match the goal-continuity evidence collection: only a successful
        // write with a path and a successfully started worker count.
        if (!result.isError) {
          if (
            (exec.name === 'write' || exec.name === 'edit') &&
            typeof args.file_path === 'string'
          ) {
            metrics.written += 1
            if (!ignoredWrite(resolve(workspace, args.file_path))) {
              metrics.lastWriteAt = journal.time()
              metrics.lastWritePath = args.file_path
            }
          }
          if (
            WORKER_TOOL_NAMES.has(exec.name) &&
            (exec.name !== 'delegate' || delegateStarted(text))
          ) {
            metrics.workers += 1
          }
        }
        const summary = toolSummary(exec.name, result.isError, text)
        const bytes = Buffer.byteLength(text, 'utf8')
        const sessionId = String(session.id)
        const shellOutcome = shellOutcomeOf(result)
        const isShellTool = exec.name === 'pwsh' || exec.name === 'bash'
        const observed = sessionToolCalls.get(sessionId) ?? []
        observed.push({
          callId: String(exec.callId),
          name: exec.name,
          arguments: args,
          ok: isShellTool ? shellOutcome.ok : !result.isError,
          at: journal.time(),
          detail: text.slice(0, 500),
          seq: pendingCallSeq.get(String(exec.callId)) ?? nextObservationSeq(sessionId),
          ...(turns.get(sessionId) === undefined ? {} : { turn: turns.get(sessionId) }),
          ...(turnSteps.get(sessionId) === undefined ? {} : { step: turnSteps.get(sessionId) }),
        })
        if (observed.length > 100) observed.shift()
        sessionToolCalls.set(sessionId, observed)
        pendingCallSeq.delete(String(exec.callId))
        const command = isShellTool ? shellCommandOf(exec) : undefined
        if (
          command !== undefined &&
          shellOutcome.ok &&
          shellOutcome.background !== true &&
          shellOutcome.aborted !== true &&
          (shellOutcome.cwd === undefined || sameCheckDirectory(shellOutcome.cwd, workspace)) &&
          verifySettings.commands.some((configured) => commandMatches(configured, command))
        ) {
          metrics.lastCheckAt = journal.time()
        }
        // A background or unreadable shell result cannot satisfy a check.
        if (command !== undefined && shellOutcome.background !== true) {
          const results = sessionShellResults.get(sessionId) ?? []
          results.push({
            callId: String(exec.callId),
            command,
            at: journal.time(),
            foreground: true,
            exitCode: shellOutcome.exitCode,
            ok: shellOutcome.ok,
            ...(shellOutcome.timedOut === true ? { timedOut: true } : {}),
            ...(shellOutcome.signal === undefined ? {} : { signal: shellOutcome.signal }),
            ...(shellOutcome.sandboxDenied === true ? { sandboxDenied: true } : {}),
            ...(shellOutcome.aborted === true ? { aborted: true } : {}),
            ...(shellOutcome.cwd === undefined ? {} : { cwd: shellOutcome.cwd }),
          })
          if (results.length > 50) results.shift()
          sessionShellResults.set(sessionId, results)
        }
        void record(
          workspace,
          {
            at: journal.time(),
            session: String(session.id),
            ...(turns.get(String(session.id)) === undefined
              ? {}
              : { turn: turns.get(String(session.id)) as number }),
            kind: 'tools/result',
            subject: exec.name,
            callId: String(exec.callId),
            ok: !result.isError,
            summary,
            bytes,
            truncated: bytes > MAX_RECORD_BYTES,
          },
          { kind: 'tool.result', subject: exec.name, tool: exec.name },
        ).catch((error: unknown) => publishListenerError(workspace, error))
      } catch (error) {
        // Observability never breaks tool dispatch; the failure is published.
        publishListenerError(workspace, error)
      }
    }),
  )

  // DSH dispatches `subagent/start` and `subagent/end` inside the delegating
  // parent's scoped context and passes only the run info to listeners. A
  // listener bound to one agent's context sees that agent's own delegations;
  // bind every created agent (subagents included), prefer the child session's
  // recorded direct parent, and de-duplicate by run so an enclosing scope that
  // also sees a descendant's event cannot add a second record.
  const parentByRun = new Map<string, string>()
  const recordedLifecycles = new Set<string>()
  const parentSessionFor = (
    info: SubagentRunInfo | SubagentRunEndInfo,
    fallback: Agent,
  ): string => {
    const remembered = parentByRun.get(String(info.runId))
    if (remembered !== undefined) return remembered
    try {
      const child = services.agents.get(String(info.id))
      const direct = child?.session.header.parentSession
      if (direct !== undefined) {
        parentByRun.set(String(info.runId), String(direct))
        return String(direct)
      }
    } catch {
      // A provider without a live child falls back to the scoped owner.
    }
    return String(fallback.session.id)
  }
  const recordSubagent = (
    owner: Agent,
    kind: 'subagent/start' | 'subagent/end',
    info: SubagentRunInfo | SubagentRunEndInfo,
  ): void => {
    const lifecycle = `${kind}:${String(info.runId)}`
    if (recordedLifecycles.has(lifecycle)) return
    const sessionId = parentSessionFor(info, owner)
    const parent = services.agents.get(sessionId)
    const session = parent?.session ?? owner.session
    const workspace = workspaceFor(services, session)
    if (workspace === undefined) return
    recordedLifecycles.add(lifecycle)
    const summary =
      kind === 'subagent/start'
        ? `child ${String(info.id)} started via ${info.provider}`
        : `child ${String(info.id)} ended: ${describe((info as SubagentRunEndInfo).stopReason)}`
    const turn = turns.get(sessionId)
    void record(
      workspace,
      {
        at: journal.time(),
        session: sessionId,
        ...(turn === undefined ? {} : { turn }),
        kind,
        subject: String(info.id),
        summary,
        bytes: Buffer.byteLength(summary, 'utf8'),
        truncated: false,
      },
      {
        kind: kind === 'subagent/start' ? 'subagent.start' : 'subagent.end',
        subject: String(info.id),
      },
    ).catch((error: unknown) => publishListenerError(workspace, error))
  }
  const bindings: Array<() => unknown> = []
  const boundAgents = new WeakSet<Agent>()
  ctx.effect(() => () => {
    for (const dispose of bindings.splice(0)) {
      try {
        dispose()
      } catch {
        // A listener that cannot unbind cannot stop the recorder's disposal.
      }
    }
  })
  const bindLifecycle = (agent: Agent): void => {
    if (boundAgents.has(agent)) return
    boundAgents.add(agent)
    try {
      bindings.push(
        agent.ctx.on('subagent/start', (info) => {
          try {
            recordSubagent(agent, 'subagent/start', info)
          } catch (error) {
            publishListenerError(workspaceFor(services, agent.session), error)
          }
        }),
      )
    } catch (error) {
      failScopedListener(error)
    }
    try {
      bindings.push(
        agent.ctx.on('subagent/end', (info) => {
          try {
            recordSubagent(agent, 'subagent/end', info)
          } catch (error) {
            publishListenerError(workspaceFor(services, agent.session), error)
          }
        }),
      )
    } catch (error) {
      failScopedListener(error)
    }
  }
  listen(() =>
    ctx.on('agent/created', ({ agent }) => {
      try {
        // A new agent generation makes the session live again.
        endedSessionIds.delete(String(agent.session.id))
        bindLifecycle(agent)
        observeSession(agent.session)
      } catch {
        // A listener that cannot bind leaves the rest of the host working.
      }
      return undefined
    }),
  )
  /** A disposed session can no longer satisfy its runs; mark them interrupted. */
  const markSessionRunsInterrupted = async (
    sessionId: string,
    workspace: string,
    expectedGenerations: ReadonlyMap<string, number>,
    disposalSeq: number,
  ): Promise<void> => {
    const auth = storedAuth ?? (await ensureAuth())
    if (auth === undefined) return
    const observed = await listAuthenticatedRuns(workspace, auth)
    for (const run of observed) {
      if (run.session !== sessionId) continue
      if (run.status !== 'running' && run.status !== 'blocked') continue
      // A run created after the disposal event belongs to the replacement
      // agent and must survive this batch.
      if ((runCreationOrder.get(run.id) ?? 0) > disposalSeq) continue
      // Bind to the generation captured when the disposal event arrived; a run
      // resumed afterwards must not be interrupted by this delayed batch.
      if ((expectedGenerations.get(run.id) ?? 0) !== runGeneration(run.id)) continue
      await withRunLock(run.id, async () => {
        if ((expectedGenerations.get(run.id) ?? 0) !== runGeneration(run.id)) return
        const current = await readAuthenticatedRun(workspace, run.id, auth)
        if (current === undefined) return
        if (current.status !== 'running' && current.status !== 'blocked') return
        endedRunIds.add(run.id)
        await writeCommit(
          workspace,
          setRunStatus(
            current,
            'interrupted',
            journal.time(),
            'the session ended while this run was unfinished',
          ),
          auth,
        )
        // Invalidate any advance after the interrupted state is durable, so a
        // concurrent reader cannot pair the new generation with the old file.
        bumpRunGeneration(run.id)
      })
    }
    await refreshPromptRuns(workspace)
  }
  listen(() =>
    ctx.on('agent/disposed', ({ agent }) => {
      // Fence the session synchronously; the store read below is asynchronous
      // and an in-flight advance must not win the race. The session generation
      // keeps the invalidation after a recreated agent clears the fence.
      endedSessionIds.add(String(agent.session.id))
      bumpSessionGeneration(String(agent.session.id))
      const expectedGenerations = new Map(runGenerations)
      // Runs created after this event belong to the replacement agent.
      const disposalSeq = creationCounter
      // Fence the runs known at the event synchronously: a recreated agent
      // must not complete them while this batch is still listing the store.
      for (const runId of knownRunIds) disposalFenced.add(runId)
      try {
        const workspace = workspaceFor(services, agent.session)
        if (workspace === undefined) return undefined
        void markSessionRunsInterrupted(
          String(agent.session.id),
          workspace,
          expectedGenerations,
          disposalSeq,
        ).catch((error: unknown) => publishListenerError(workspace, error))
      } catch (error) {
        publishListenerError(workspaceFor(services, agent.session), error)
      }
      return undefined
    }),
  )
  // A reload or late mount keeps observing agents that are already live; a
  // quiet workspace still gets its health file and self-check at boot.
  try {
    for (const agent of services.agents.list()) {
      bindLifecycle(agent)
      observeSession(agent.session)
    }
  } catch {
    // An unreadable registry leaves the recorder inert for existing agents.
  }
  // The four main observers are registered; the per-workspace change source is
  // the fifth expected listener. A failed registration lowers the count so
  // health reports listener-down instead of healthy.
  for (const [workspace, health] of healths) {
    health.setListenerCount(publishedListenerCount(workspace))
  }

  /* ------------------------------------------------------------------ */
  /* obligation engine wiring                                            */
  /* ------------------------------------------------------------------ */

  const ownedCalls = new OwnedCalls()
  /** In-flight run starts count against maxRuns until their write settles. */
  const reservedStarts = new Map<string, number>()
  const reserveStart = (workspace: string): void => {
    reservedStarts.set(workspace, (reservedStarts.get(workspace) ?? 0) + 1)
  }
  const releaseStart = (workspace: string): void => {
    const left = (reservedStarts.get(workspace) ?? 1) - 1
    if (left <= 0) reservedStarts.delete(workspace)
    else reservedStarts.set(workspace, left)
  }
  const atRunLimit = (workspace: string, runs: readonly WorkflowRun[]): boolean =>
    openRunCount(runs) + (reservedStarts.get(workspace) ?? 0) >= maxRuns
  /** Serialize capacity read, admission, and persistence across sessions. */
  const admissionTails = new Map<string, Promise<void>>()
  const acquireAdmission = async (workspace: string): Promise<() => void> => {
    const previous = admissionTails.get(workspace) ?? Promise.resolve()
    let release!: () => void
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    admissionTails.set(
      workspace,
      previous.then(() => hold),
    )
    await previous
    return release
  }
  /** Dedupe keys whose triggering call has not finished starting its run yet. */
  const inFlightTriggers = new Set<string>()
  const optionalService = <T>(name: string): T | undefined => {
    try {
      return (ctx as unknown as { get?: (serviceName: string) => unknown }).get?.(name) as
        | T
        | undefined
    } catch {
      return undefined
    }
  }
  const subagentRuntime = optionalService<SubagentRuntime>('subagents')
  /** The host subagent runner for the subagent executor; absent without the seam. */
  const hostSubagentRunner = (agent: Agent): SubagentRunner | undefined => {
    if (subagentRuntime === undefined) return undefined
    return {
      run: async (request, signal) => {
        const controller = signal ?? new AbortController().signal
        const activation = await subagentRuntime.startActivation({
          provider: request.provider,
          label: `workflows ${request.provider}`.slice(0, 120),
          request: {
            parent: agent,
            prompt: [{ type: 'text', text: request.prompt }],
            ...(request.schema === undefined ? {} : { outputSchema: request.schema as never }),
          },
          signal: controller,
          delivery: 'caller',
        })
        const result = await activation.result
        return {
          childId: String(activation.childId),
          completed: result.stopReason === 'completed',
          ...(result.structured === undefined ? {} : { result: result.structured }),
          ...(result.diagnostic === undefined ? {} : { error: result.diagnostic }),
        }
      },
    }
  }
  const rawUserQuestions = optionalService<DshUserQuestions>('userQuestions')
  /** The live agent is the answerer scope, so the adapter is built per agent. */
  const questionsFor = (agent: Agent) =>
    rawUserQuestions === undefined ? undefined : adaptUserQuestions(rawUserQuestions, agent)
  const shellWorkdirOf = (exec: Readonly<ToolExecution>): string | undefined => {
    const args = exec.arguments
    if (typeof args !== 'object' || args === null) return undefined
    const record = args as Record<string, unknown>
    const workdir = record.workdir ?? record.cwd
    return typeof workdir === 'string' && workdir !== '' ? workdir : undefined
  }
  const shellCommandOf = (exec: Readonly<ToolExecution>): string | undefined => {
    const args = exec.arguments
    if (typeof args !== 'object' || args === null) return undefined
    const record = args as Record<string, unknown>
    if (exec.name === 'terminal_send') {
      return typeof record.text === 'string' ? record.text : undefined
    }
    if (exec.name === 'pwsh' || exec.name === 'bash') {
      return typeof record.command === 'string' ? record.command : undefined
    }
    return undefined
  }
  const changeDirectoryExists = async (workspace: string, name: string): Promise<boolean> => {
    try {
      return (await stat(join(workspace, 'openspec', 'changes', name))).isDirectory()
    } catch {
      return false
    }
  }
  /** Decode the canonical shell result instead of inferring success from isError. */
  interface ShellOutcome {
    readonly readable: boolean
    readonly ok: boolean
    readonly exitCode: number
    readonly timedOut?: boolean
    readonly aborted?: boolean
    readonly signal?: string
    readonly sandboxDenied?: boolean
    readonly background?: boolean
    readonly cwd?: string
  }
  const shellOutcomeOf = (result: unknown): ShellOutcome => {
    const record =
      typeof result === 'object' && result !== null
        ? (result as Record<string, unknown>)
        : undefined
    const value =
      record !== undefined && typeof record.value === 'object' && record.value !== null
        ? (record.value as Record<string, unknown>)
        : undefined
    const unreadable: ShellOutcome = {
      readable: false,
      ok: false,
      exitCode: 1,
    }
    if (record === undefined || value === undefined) return unreadable
    if (value.kind !== 'foreground') return { ...unreadable, background: true }
    const exitCode = value.exitCode
    const signal = value.signal
    if (typeof exitCode !== 'number' && exitCode !== null) return unreadable
    if (typeof signal !== 'string' && signal !== null) return unreadable
    if (typeof value.timedOut !== 'boolean' || typeof value.aborted !== 'boolean') {
      return unreadable
    }
    let denied = false
    let runnerFailed = false
    if (value.sandbox !== undefined) {
      const sandbox = value.sandbox
      if (
        typeof sandbox !== 'object' ||
        sandbox === null ||
        typeof (sandbox as Record<string, unknown>).denied !== 'boolean'
      ) {
        return unreadable
      }
      const sandboxRecord = sandbox as Record<string, unknown>
      denied = sandboxRecord.denied === true
      runnerFailed = sandboxRecord.runnerFailed === true
    }
    const ok =
      record.isError !== true &&
      exitCode === 0 &&
      signal === null &&
      value.timedOut === false &&
      value.aborted === false &&
      !denied &&
      !runnerFailed
    return {
      readable: true,
      ok,
      exitCode: typeof exitCode === 'number' ? exitCode : 1,
      ...(value.timedOut === true ? { timedOut: true } : {}),
      ...(typeof signal === 'string' ? { signal } : {}),
      ...(denied ? { sandboxDenied: true } : {}),
      ...(typeof value.cwd === 'string' && value.cwd !== '' ? { cwd: value.cwd } : {}),
    }
  }
  /** A host-owned tool dispatch through the registered tool service, if present. */
  /**
   * The bounded failure message of one tool result. The host puts it on
   * `error.message` and repeats it as text content; either names the cause.
   */
  const toolFailureDetail = (result: unknown): string | undefined => {
    if (typeof result !== 'object' || result === null) return undefined
    const record = result as Record<string, unknown>
    const error = record.error
    if (typeof error === 'object' && error !== null) {
      const message = (error as Record<string, unknown>).message
      if (typeof message === 'string' && message.trim() !== '') return message.slice(0, 200)
    }
    const content = record.content
    if (!Array.isArray(content)) return undefined
    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      const text = (block as Record<string, unknown>).text
      if (typeof text === 'string' && text.trim() !== '') return text.slice(0, 200)
    }
    return undefined
  }
  const liveToolRunner = (agent: Agent): ToolRunner | undefined => {
    const tools = ctx.get('tools') as
      | {
          execute?: (input: {
            calls: ReadonlyArray<{
              type: 'tool-call'
              id: string
              name: string
              arguments: string
            }>
            signal: AbortSignal
            agent: Agent
          }) => Promise<{
            results: ReadonlyArray<{ callId: string; result: unknown }>
          }>
        }
      | undefined
    if (typeof tools?.execute !== 'function') return undefined
    const execute = tools.execute.bind(tools)
    return {
      async call(request) {
        const batch = await execute({
          // The host executor takes model-shaped tool-call blocks: a `type` and
          // the JSON string the model would send, not a decoded object.
          calls: [
            {
              type: 'tool-call',
              id: request.callId,
              name: request.name,
              arguments: JSON.stringify(request.arguments),
            },
          ],
          signal: AbortSignal.timeout(60_000),
          agent,
        })
        const first = batch.results[0]
        if (first === undefined) {
          return { ok: false, error: `the ${request.name} tool call failed: no result` }
        }
        const isShellTool =
          request.name === 'pwsh' || request.name === 'bash' || request.name === 'terminal_send'
        const shell = isShellTool ? shellOutcomeOf(first.result) : undefined
        const failure = toolFailureDetail(first.result)
        const failed = (detail: string | undefined): { ok: false; error: string } => ({
          ok: false,
          error: `the ${request.name} tool call failed${detail === undefined ? '' : `: ${detail}`}`,
        })
        if (shell !== undefined && (shell.background === true || !shell.ok)) {
          return failed(failure ?? `exit code ${String(shell.exitCode)}`)
        }
        if (
          shell === undefined &&
          (first.result as { isError?: unknown } | undefined)?.isError === true
        ) {
          return failed(failure)
        }
        // The host already observed its own dispatch; record it for evidence
        // verification even if the result event is delivered later.
        const sessionId = String(agent.session.id)
        const observed = sessionToolCalls.get(sessionId) ?? []
        observed.push({
          callId: request.callId,
          name: request.name,
          arguments: { ...request.arguments },
          ok: true,
          at: journal.time(),
          detail: JSON.stringify(first.result).slice(0, 500),
          seq: pendingCallSeq.get(String(request.callId)) ?? nextObservationSeq(sessionId),
          ...(turns.get(sessionId) === undefined ? {} : { turn: turns.get(sessionId) }),
          ...(turnSteps.get(sessionId) === undefined ? {} : { step: turnSteps.get(sessionId) }),
        })
        if (observed.length > 100) observed.shift()
        sessionToolCalls.set(sessionId, observed)
        pendingCallSeq.delete(String(request.callId))
        const command = request.arguments.command
        if (typeof command === 'string' && (request.name === 'pwsh' || request.name === 'bash')) {
          const results = sessionShellResults.get(sessionId) ?? []
          results.push({
            callId: request.callId,
            command,
            at: journal.time(),
            foreground: true,
            exitCode: shell?.exitCode ?? 0,
            ...(shell?.timedOut === true ? { timedOut: true } : {}),
            ...(shell?.signal === undefined ? {} : { signal: shell.signal }),
            ...(shell?.sandboxDenied === true ? { sandboxDenied: true } : {}),
            ...(shell?.cwd === undefined ? {} : { cwd: shell.cwd }),
          })
          if (results.length > 50) results.shift()
          sessionShellResults.set(sessionId, results)
        }
        return { ok: true }
      },
    }
  }
  /** Serialize lifecycle commits per run so a stale advance cannot win a race. */
  const runWriteLocks = new Map<string, Promise<void>>()
  const withRunLock = async <T>(runId: string, action: () => Promise<T>): Promise<T> => {
    const previous = runWriteLocks.get(runId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    runWriteLocks.set(runId, tail)
    await previous.catch(() => undefined)
    try {
      return await action()
    } finally {
      release()
      if (runWriteLocks.get(runId) === tail) runWriteLocks.delete(runId)
    }
  }
  /** Write one run without a lock/expected check; commits use the guards below. */
  const writeCommit = async (
    workspace: string,
    run: WorkflowRun,
    auth: HostAuth,
  ): Promise<void> => {
    await writeRun(workspace, run, auth)
    storeRevision += 1
    lifecycleEpoch += 1
  }
  /** Persist an advance unless the run's snapshot, session or state moved. */
  const persistRun = async (
    workspace: string,
    run: WorkflowRun,
    auth: HostAuth,
    generation?: number,
    capturedSessionGeneration?: number,
    expectedUpdatedAt?: number,
  ): Promise<WorkflowRun> =>
    withRunLock(run.id, async () => {
      const current = await readAuthenticatedRun(workspace, run.id, auth)
      if (current === undefined) return run
      const sessionStale = (): boolean =>
        capturedSessionGeneration !== undefined &&
        capturedSessionGeneration !== sessionGeneration(run.session)
      if (
        (generation !== undefined && generation !== runGeneration(run.id)) ||
        sessionStale() ||
        (expectedUpdatedAt !== undefined && current.updatedAt !== expectedUpdatedAt) ||
        current.status === 'cancelled' ||
        (current.status === 'interrupted' &&
          run.status !== 'interrupted' &&
          run.status !== 'completed' &&
          run.status !== 'cancelled')
      ) {
        // The stored state is newer; the stale advance must not be written.
        return current
      }
      const ended = (): boolean =>
        endedRunIds.has(run.id) || endedSessionIds.has(run.session) || disposalFenced.has(run.id)
      const interruptedFrom = (): WorkflowRun =>
        interruptEndedRun(current, true, journal.time()) ?? current
      // A disposal already fenced the session: never persist the running
      // proposal, and keep the prior durable pending steps so resume works.
      if (ended() || sessionStale()) {
        const replacement = interruptedFrom()
        if (replacement !== current) await writeCommit(workspace, replacement, auth)
        return replacement
      }
      if (run !== current) await writeCommit(workspace, run, auth)
      // A disposal can fence the session during the write; the lock serializes
      // the writers, but the fence and the session generation are set
      // synchronously, so re-check both after the write.
      if (ended() || sessionStale()) {
        const replacement = interruptedFrom()
        if (replacement !== run) await writeCommit(workspace, replacement, auth)
        return replacement
      }
      return run
    })
  /** Advance one run through its verified evidence; a deferred step never steers. */
  const advanceRun = async (
    workspace: string,
    run: WorkflowRun,
    definition: Definition,
    agent: Agent,
    auth: HostAuth,
    installedLegacy: ReadonlySet<string>,
    enabledLegacy: ReadonlySet<string>,
    turn: number,
    capturedGeneration?: number,
    capturedSessionGeneration?: number,
  ): Promise<WorkflowRun> => {
    if (capturedGeneration !== undefined && capturedGeneration !== runGeneration(run.id)) {
      // The snapshot was read before a resume replaced its lifecycle; never
      // dispatch or persist from it.
      return (await readAuthenticatedRun(workspace, run.id, auth)) ?? run
    }
    const generation = capturedGeneration ?? runGeneration(run.id)
    const sessionGenerationAtStart =
      capturedSessionGeneration ?? sessionGeneration(String(agent.session.id))
    if (sessionGenerationAtStart !== sessionGeneration(String(agent.session.id))) {
      // The session ended or was recreated while this snapshot waited.
      return (await readAuthenticatedRun(workspace, run.id, auth)) ?? run
    }
    const writeMetrics = turnMetrics.get(String(agent.session.id))
    // Only a fully applicable deferred observation advances; a run whose
    // trigger is no longer applicable becomes terminal and pruneable.
    if (definition.trigger.applicability === 'checkpoint-required') {
      const metrics = turnMetrics.get(String(agent.session.id))
      const current = metrics !== undefined && metrics.turn === turn ? metrics : undefined
      const applicable = checkpointRequired({
        toolCalls: current?.toolCalls ?? 0,
        ...(current?.lastTool === undefined ? {} : { lastTool: current.lastTool }),
        written: current?.written ?? 0,
        workers: current?.workers ?? 0,
        minToolCalls: checkpointApplicability.minToolCalls,
        requireWrite: checkpointApplicability.requireWrite,
      })
      if (!applicable) {
        return await persistRun(
          workspace,
          completeNotApplicable(run, journal.time()),
          auth,
          generation,
          sessionGenerationAtStart,
          run.updatedAt,
        )
      }
    }
    if (definition.trigger.applicability === 'code-write') {
      // The verify definition observes only a turn that wrote code; a
      // documentation-only or inspection turn completes the run as inapplicable.
      const calls = (sessionToolCalls.get(String(agent.session.id)) ?? []).filter(
        (call) => call.turn === undefined || call.turn === turn,
      )
      const writeAt =
        lastCodeWriteAt(calls, workspace) ??
        (writeMetrics?.turn === turn ? writeMetrics.lastWriteAt : undefined)
      if (writeAt === undefined) {
        return await persistRun(
          workspace,
          completeNotApplicable(run, journal.time()),
          auth,
          generation,
          sessionGenerationAtStart,
          run.updatedAt,
        )
      }
    }
    const pending = run.steps.find((step) => step.state === 'open' || step.state === 'blocked')
    const sessionId = String(agent.session.id)
    // The host dispatch records into these live arrays, and the verifier must
    // read the same arrays it was handed.
    const toolCalls = sessionToolCalls.get(sessionId) ?? []
    const shellResults = sessionShellResults.get(sessionId) ?? []
    sessionToolCalls.set(sessionId, toolCalls)
    sessionShellResults.set(sessionId, shellResults)
    const runner = liveToolRunner(agent)
    const subagentRunner = hostSubagentRunner(agent)
    const questions = questionsFor(agent)
    const result = await advanceIntake({
      run,
      definition,
      values: run.context,
      evidenceContext: {
        workspace,
        values: run.context,
        toolCalls,
        shellResults,
        checkCommands: verifySettings.commands,
        ...(lastCodeWriteAt(toolCalls, workspace) === undefined &&
        writeMetrics?.lastWriteAt === undefined
          ? {}
          : { lastWriteAt: lastCodeWriteAt(toolCalls, workspace) ?? writeMetrics?.lastWriteAt }),
        ...(writeMetrics?.lastWritePath === undefined
          ? {}
          : { lastWritePath: writeMetrics.lastWritePath }),
        ...(writeMetrics?.lastCheckAt === undefined
          ? {}
          : { lastCheckAt: writeMetrics.lastCheckAt }),
        ...(pending?.requestedAt === undefined ? {} : { stepStartedAt: pending.requestedAt }),
      },
      owned: ownedCalls,
      ...(runner === undefined ? {} : { toolRunner: runner }),
      ...(subagentRunner === undefined ? {} : { subagentRunner }),
      ...(questions === undefined ? {} : { questions }),
      readRecord: (step) =>
        verifyEvidence(step.evidence ?? { kind: 'declaration' }, {
          workspace,
          values: run.context,
        }),
      installedLegacy,
      enabledLegacy,
      auth,
      // The completion commit and its receipt go through the same lifecycle
      // guard as every other advance: a run interrupted by a disposal before
      // this write must not be revived as completed or receipted.
      completeRun: async (completedRun, digest) => {
        const persisted = await persistRun(
          workspace,
          completedRun,
          auth,
          generation,
          sessionGenerationAtStart,
          run.updatedAt,
        )
        if (persisted.status !== 'completed') return { run: persisted }
        try {
          await issueCompletionReceipt(workspace, persisted.id, digest, auth, journal.time())
          return { run: persisted }
        } catch (error) {
          return {
            run: persisted,
            receiptError:
              error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
          }
        }
      },
      now: journal.time(),
    })
    if (result.run !== run) {
      return await persistRun(
        workspace,
        result.run,
        auth,
        generation,
        sessionGenerationAtStart,
        run.updatedAt,
      )
    }
    return result.run
  }
  const boundedError = (error: unknown): string =>
    (error instanceof Error ? error.message : String(error)).slice(0, 200)
  const startRunForUnlocked = async (
    workspace: string,
    sessionId: string,
    auth: HostAuth,
    definition: Definition,
    context: Readonly<Record<string, unknown>> = {},
    dedupeKey?: string,
  ): Promise<WorkflowRun> => {
    const entryGeneration = sessionGeneration(sessionId)
    const runs = await listAuthenticatedRuns(workspace, auth)
    if (atRunLimit(workspace, runs)) {
      throw new Error(
        `the run limit (${String(maxRuns)}) is reached; finish or cancel an open run first`,
      )
    }
    reserveStart(workspace)
    try {
      const run = createRun({
        definition: { id: definition.id, name: definition.name, version: definition.version },

        trigger: definition.trigger.kind,
        session: sessionId,
        workspace,
        context,
        steps: definition.steps.map((step) => step.id),
        now: journal.time(),
        ...(dedupeKey === undefined ? {} : { dedupeKey }),
      })
      creationCounter += 1
      runCreationOrder.set(run.id, creationCounter)
      knownRunIds.add(run.id)
      // A start that raced a disposal is persisted interrupted: the disposal's
      // listing may have finished before this file appeared.
      const fenced =
        endedSessionIds.has(sessionId) || entryGeneration !== sessionGeneration(sessionId)
      const toWrite = fenced
        ? setRunStatus(
            run,
            'interrupted',
            journal.time(),
            'the session ended before the run started',
          )
        : run
      // The initial write and its disposal rollback share the per-run lock
      // with resume/cancel, so a cancellation always wins or is seen here.
      const committed = await withRunLock(run.id, async () => {
        await writeCommit(workspace, toWrite, auth)
        // A disposal can finish listing runs before this new file appeared.
        if (
          !fenced &&
          (endedSessionIds.has(sessionId) || entryGeneration !== sessionGeneration(sessionId))
        ) {
          const interrupted = setRunStatus(
            toWrite,
            'interrupted',
            journal.time(),
            'the session ended during the start',
          )
          await writeCommit(workspace, interrupted, auth)
          return interrupted
        }
        return toWrite
      })
      void refreshPromptRuns(workspace)
      return committed
    } finally {
      releaseStart(workspace)
    }
  }
  const startRunFor = async (
    workspace: string,
    sessionId: string,
    auth: HostAuth,
    definition: Definition,
    context: Readonly<Record<string, unknown>> = {},
    dedupeKey?: string,
  ): Promise<WorkflowRun> => {
    const release = await acquireAdmission(workspace)
    try {
      return await startRunForUnlocked(workspace, sessionId, auth, definition, context, dedupeKey)
    } finally {
      release()
    }
  }
  const seeding = new Map<string, Promise<void>>()
  /** Restore persisted trigger identities after a reload; one shared read per session. */
  const seedTriggerIdentities = (workspace: string, sessionId: string): Promise<void> => {
    const existing = seeding.get(sessionId)
    if (existing !== undefined) return existing
    const promise = (async () => {
      let auth = storedAuth
      if (auth === undefined) {
        try {
          auth = await ensureAuth()
        } catch {
          auth = undefined
        }
      }
      if (auth === undefined) throw new Error('the host key is unavailable')
      const runs = await listAuthenticatedRuns(workspace, auth)
      const map = seen.get(sessionId) ?? new Map<string, number>()
      seen.set(sessionId, map)
      for (const run of runs) {
        if (
          run.session === sessionId &&
          run.dedupeKey !== undefined &&
          run.status !== 'cancelled'
        ) {
          map.set(run.dedupeKey, run.updatedAt)
        }
      }
    })()
    seeding.set(sessionId, promise)
    void promise.catch(() => {
      seeding.delete(sessionId)
    })
    return promise
  }

  // Tools pre-execute: intake, archive, and the authorization write guard.
  listenEngine(() =>
    ctx.on('tools/pre-execute', async (exec, next) => {
      try {
        const agent = exec.agent
        if (agent === undefined) return await next()
        // Capture the session lifecycle before any await: a disposal during the
        // receipt/change reads must invalidate this call's gate.
        const sessionGenerationAtEntry = sessionGeneration(String(agent.session.id))
        // Invocation order: a call that started before a checkpoint amendment
        // but returned after it must not count as a later remedy call.
        if (workspaceFor(services, agent.session) !== undefined) {
          pendingCallSeq.set(String(exec.callId), nextObservationSeq(String(agent.session.id)))
        }
        const workspace = workspaceFor(services, agent.session)
        if (workspace === undefined) return await next()
        let auth = storedAuth
        if (auth === undefined) {
          try {
            auth = await ensureAuth()
          } catch {
            auth = undefined
          }
        }
        const command = shellCommandOf(exec)
        const create = command === undefined ? undefined : parseOpenspecCommand(command)
        const sessionId = String(agent.session.id)
        const definitions = await definitionsFor(workspace)
        await recoverIfNeeded(workspace)
        await seedTriggerIdentities(workspace, sessionId).catch(() => undefined)
        const releaseAdmission = await acquireAdmission(workspace)
        try {
          const knownRuns = auth === undefined ? [] : await listAuthenticatedRuns(workspace, auth)
          const sessionSeen = seen.get(sessionId) ?? new Map<string, number>()
          seen.set(sessionId, sessionSeen)
          const observed: DefinitionEvent = {
            kind: 'tool.pre-execute',
            subject: exec.name,
            tool: exec.name,
            workspace,
            session: sessionId,
            ...(exec.callId === undefined ? {} : { callId: String(exec.callId) }),
            ...(turns.get(sessionId) === undefined ? {} : { turn: turns.get(sessionId) }),
            ...(create?.kind === 'create-change'
              ? { command: 'openspec new change <name>', name: create.name }
              : create?.kind === 'archive'
                ? { command: 'openspec archive <name>', name: create.change }
                : {}),
          }
          const currentMetrics = turnMetrics.get(sessionId)
          const triggerRows: TriggerEvaluationRecord[] = []
          let startedThisEvent = 0
          let concurrentIntakeReason: string | undefined
          let capacityReason: string | undefined
          let keyUnavailableReason: string | undefined
          let intakeDecision: Awaited<ReturnType<typeof evaluateIntakeGate>> | undefined
          for (const definition of definitions) {
            const applicability =
              definition.trigger.applicability === 'checkpoint-required'
                ? checkpointRequired({
                    toolCalls: currentMetrics?.toolCalls ?? 0,
                    ...(currentMetrics?.lastTool === undefined
                      ? {}
                      : { lastTool: currentMetrics.lastTool }),
                    written: currentMetrics?.written ?? 0,
                    workers: currentMetrics?.workers ?? 0,
                  })
                : undefined
            const evaluation = evaluateDefinitionTrigger(definition, observed, {
              ...(applicability === undefined ? {} : { applicability }),
              isDuplicate: (key) => sessionSeen.has(key),
            })
            const row: TriggerEvaluationRecord = {
              id: `definition:${definition.id}`,
              matched: evaluation.matched,
              reason: evaluation.reason,
              ...(evaluation.path === undefined ? {} : { path: evaluation.path }),
              ...(evaluation.filter === undefined ? {} : { filter: evaluation.filter }),
              ...(evaluation.detail === undefined ? {} : { detail: evaluation.detail }),
            }
            const createsIntake =
              definition.id === 'change-intake' && create?.kind === 'create-change'
            if (!evaluation.matched && evaluation.reason !== 'dedupe') {
              triggerRows.push(row)
              continue
            }
            if (definition.trigger.mode === 'shadow') {
              if (!evaluation.matched) {
                // A duplicate shadow event keeps the dedupe reason instead of
                // being reported as a fresh would-fire.
                triggerRows.push(row)
                continue
              }
              const key = obligationDedupeKey(definition.id, definition.trigger, observed)
              if (key !== undefined) sessionSeen.set(key, journal.time())
              triggerRows.push({ ...row, reason: 'would-fire' })
              continue
            }
            const repeats = definition.trigger.repeat === true
            const dedupeKey = obligationDedupeKey(definition.id, definition.trigger, observed)
            // A concurrent call that already reserved the key must not start a
            // second run or invoke the intake gate again, unless the trigger
            // repeats on every matching event.
            if (!repeats && dedupeKey !== undefined && inFlightTriggers.has(dedupeKey)) {
              triggerRows.push({
                ...row,
                matched: true,
                reason: 'run-suppressed',
                detail: 'a matching event is already being evaluated',
              })
              if (createsIntake) {
                concurrentIntakeReason = `an intake evaluation for "${create.name}" is already in progress; no second run was created`
              }
              continue
            }
            const reserve = !repeats && evaluation.matched && dedupeKey !== undefined
            if (reserve) inFlightTriggers.add(dedupeKey)
            try {
              // An intake call is authorized only after the active trigger
              // matched (or deduped to an existing intake); a shadow or filtered
              // trigger never creates a run and must not invoke the intake gate.
              if (createsIntake && (evaluation.matched || evaluation.reason === 'dedupe')) {
                if (auth === undefined) {
                  triggerRows.push({
                    ...row,
                    matched: true,
                    reason: 'run-suppressed',
                    detail: 'the host key is unavailable; no run was created',
                  })
                  keyUnavailableReason = `workflows: the host key is unavailable, so the intake run for "${create.name}" was not created; the call was refused`
                  continue
                }
                let decision: Awaited<ReturnType<typeof evaluateIntakeGate>>
                try {
                  decision = await evaluateIntakeGate({
                    name: create.name,
                    session: sessionId,
                    workspace,
                    callId: String(exec.callId),
                    definition,
                    runs: knownRuns,
                    receipts: await listReceipts(workspace, auth),
                    ownedCallIds: new Set(ownedCalls.list()),
                    changeExists: await changeDirectoryExists(workspace, create.name),
                    startRun: async (entry, name) => {
                      if (
                        atRunLimit(workspace, knownRuns) ||
                        openRunCount(knownRuns) + startedThisEvent >= maxRuns
                      ) {
                        throw new Error('workflows-run-limit')
                      }
                      const run = await startRunForUnlocked(
                        workspace,
                        sessionId,
                        auth,
                        entry,
                        { name },
                        dedupeKey,
                      )
                      startedThisEvent += 1
                      return { runId: run.id }
                    },
                    resumeRun: async (runId) => {
                      const entryGeneration = sessionGenerationAtEntry
                      const resumed = await withRunLock(runId, async () => {
                        try {
                          const prior = await readAuthenticatedRun(workspace, runId, auth)
                          const result = await resumeRun(
                            workspace,
                            runId,
                            auth,
                            Date.now(),
                            sessionId,
                            false,
                          )
                          if (entryGeneration !== sessionGeneration(sessionId)) return undefined
                          await writeCommit(workspace, result.run, auth)
                          if (entryGeneration !== sessionGeneration(sessionId)) {
                            // Always persist the prior interrupted state:
                            // interruptEndedRun returns undefined for an already
                            // interrupted run.
                            const replacement =
                              prior === undefined
                                ? undefined
                                : (interruptEndedRun(prior, true, journal.time()) ?? prior)
                            if (replacement !== undefined) {
                              await writeCommit(workspace, replacement, auth)
                            }
                            bumpRunGeneration(runId)
                            return undefined
                          }
                          endedRunIds.delete(runId)
                          disposalFenced.delete(runId)
                          endedSessionIds.delete(sessionId)
                          bumpRunGeneration(runId)
                          return result
                        } catch {
                          return undefined
                        }
                      })
                      if (resumed === undefined) {
                        throw new Error('the run could not be resumed; retry')
                      }
                      return { stepId: resumed.stepId }
                    },
                  })
                } catch (error) {
                  if (error instanceof Error && error.message === 'workflows-run-limit') {
                    triggerRows.push({
                      ...row,
                      matched: true,
                      reason: 'run-suppressed',
                      detail: 'the run limit is reached; no intake run was created',
                    })
                    capacityReason = `workflows: the run limit (${String(maxRuns)}) is reached, so the intake run for "${create.name}" was not created; the call was refused`
                    continue
                  }
                  throw error
                }
                intakeDecision = decision
                if (decision.kind === 'deny' && decision.action === 'started') {
                  if (dedupeKey !== undefined) sessionSeen.set(dedupeKey, journal.time())
                  triggerRows.push({
                    ...row,
                    matched: true,
                    reason: 'run-created',
                    ...(decision.runId === undefined ? {} : { runId: decision.runId }),
                    detail: decision.reason,
                  })
                } else if (decision.kind === 'deny') {
                  triggerRows.push({
                    ...row,
                    matched: true,
                    reason: 'run-suppressed',
                    ...(decision.runId === undefined ? {} : { runId: decision.runId }),
                    detail: decision.reason,
                  })
                } else {
                  triggerRows.push({
                    ...row,
                    matched: true,
                    reason: 'run-suppressed',
                    detail: decision.reason,
                  })
                }
                continue
              }
              if (!evaluation.matched) {
                triggerRows.push(row)
                continue
              }
              // A non-intake active definition starts its own observational run.
              if (auth === undefined) {
                triggerRows.push({
                  ...row,
                  matched: true,
                  reason: 'run-suppressed',
                  detail: 'the host key is unavailable; no run was created',
                })
                continue
              }
              if (
                atRunLimit(workspace, knownRuns) ||
                openRunCount(knownRuns) + startedThisEvent >= maxRuns
              ) {
                triggerRows.push({
                  ...row,
                  matched: true,
                  reason: 'run-suppressed',
                  detail: 'the run limit is reached; no run was created',
                })
                continue
              }
              try {
                const run = await startRunForUnlocked(
                  workspace,
                  sessionId,
                  auth,
                  definition,
                  {},
                  dedupeKey,
                )
                startedThisEvent += 1
                if (!repeats && dedupeKey !== undefined) sessionSeen.set(dedupeKey, journal.time())
                triggerRows.push({ ...row, matched: true, reason: 'run-created', runId: run.id })
              } catch (error) {
                if (reserve && dedupeKey !== undefined) sessionSeen.delete(dedupeKey)
                triggerRows.push({
                  ...row,
                  matched: true,
                  reason: 'run-suppressed',
                  detail: boundedError(error),
                })
              }
            } finally {
              if (reserve && dedupeKey !== undefined) inFlightTriggers.delete(dedupeKey)
            }
          }
          await recordEngineEvaluation(
            workspace,
            sessionId,
            turns.get(sessionId),
            'tools/pre-execute',
            exec.name,
            `pre-execute ${exec.name}`,
            triggerRows,
          )
          if (intakeDecision?.kind === 'deny') {
            return { kind: 'deny', reason: intakeDecision.reason }
          }
          if (concurrentIntakeReason !== undefined) {
            return { kind: 'deny', reason: concurrentIntakeReason }
          }
          if (keyUnavailableReason !== undefined) {
            return { kind: 'deny', reason: keyUnavailableReason }
          }
          if (capacityReason !== undefined) {
            return { kind: 'deny', reason: capacityReason }
          }
        } finally {
          releaseAdmission()
        }
        if (command !== undefined) {
          const declaredWorkdir = shellWorkdirOf(exec)
          const resolvedWorkdir =
            declaredWorkdir === undefined
              ? normalize(workspace)
              : normalize(
                  isAbsolute(declaredWorkdir) ? declaredWorkdir : join(workspace, declaredWorkdir),
                )
          const relativeWorkdir = relative(normalize(workspace), resolvedWorkdir)
          const inside =
            relativeWorkdir === '' ||
            (!isAbsolute(relativeWorkdir) &&
              relativeWorkdir !== '..' &&
              !relativeWorkdir.startsWith(`..${sep}`) &&
              !relativeWorkdir.startsWith('../') &&
              !relativeWorkdir.startsWith('..\\'))
          const archive = parseArchiveCommand(
            command,
            workspace,
            inside ? resolvedWorkdir : undefined,
          )
          const normalizedCommand = command.replaceAll('\\', '/')
          const relativeArchiveWorkdir =
            relativeWorkdir.replaceAll('\\', '/') === 'openspec/changes'
          const mentionsOpenSpecArchive =
            /openspec\/changes\/archive(?:\/|$)/iu.test(normalizedCommand) ||
            (relativeArchiveWorkdir &&
              /(?:^|\s)["']?archive\/?["']?(?:\s|$)/iu.test(normalizedCommand))
          const looksLikeMove =
            /(?:^|\s)(?:git\s+mv|mv|move-item)\s/iu.test(command) && mentionsOpenSpecArchive
          if (
            archive === undefined &&
            /^\s*(?:rtk\s+|pnpm\s+exec\s+)?openspec\s+archive\b/iu.test(command)
          ) {
            return {
              kind: 'deny',
              reason:
                'the archive command could not be parsed safely; use openspec archive <name> with a valid change name',
            }
          }
          if (archive === undefined && looksLikeMove) {
            return {
              kind: 'deny',
              reason:
                'the archive move could not be parsed safely; use openspec archive <name> or a plain move of openspec/changes/<name> into openspec/changes/archive/',
            }
          }
          if (archive?.kind === 'archive' && archive.form === 'openspec') {
            if (/--store(?:=|\s)/iu.test(command)) {
              return {
                kind: 'deny',
                reason:
                  'the archive command selects a different OpenSpec store; workflow evidence is read only for the session workspace store',
              }
            }
            let cursor = resolvedWorkdir
            for (;;) {
              const hasOpenSpec = await stat(join(cursor, 'openspec'))
                .then((info) => info.isDirectory())
                .catch(() => false)
              if (hasOpenSpec) {
                const foldPath = (value: string): string =>
                  process.platform === 'win32' ? value.toLowerCase() : value
                if (foldPath(normalize(cursor)) !== foldPath(normalize(workspace))) {
                  return {
                    kind: 'deny',
                    reason: `the archive command targets the nested OpenSpec project "${cursor}"; evidence is read only for the session workspace "${normalize(workspace)}"`,
                  }
                }
                break
              }
              const parent = dirname(cursor)
              if (parent === cursor || relative(workspace, parent).startsWith('..')) break
              cursor = parent
            }
          }
          if (archive?.kind === 'archive') {
            if (archive.multipleSources === true) {
              return {
                kind: 'deny',
                reason:
                  'a multi-source archive move cannot be authorized as one obligation; archive each change separately',
              }
            }
            if (!inside) {
              return {
                kind: 'deny',
                reason: `the archive command runs in "${resolvedWorkdir}", outside the session workspace "${normalize(workspace)}"; its evidence cannot authorize this archive`,
              }
            }
            const specRecord = await verifyEvidence(
              {
                kind: 'record',
                rule: 'spec-review',
                change: archive.change,
                phase: 'spec',
                scope: 'whole',
                verdict: 'PASS',
                digest: 'current',
              },
              { workspace, values: { name: archive.change } },
            )
            const taskReviewOwned = definitions.some(
              (definition) =>
                definition.id === 'task-review' && definition.settings.gateOwnership === 'own',
            )
            const coverage = taskReviewOwned
              ? taskReviewCoverage(workspace, archive.change)
              : undefined
            const decision = evaluateArchiveGate({
              change: archive.change,
              tamperedRuns: auth === undefined ? false : await hasTamperedRuns(workspace, auth),
              runs: auth === undefined ? [] : await listAuthenticatedRuns(workspace, auth),
              receipts: auth === undefined ? [] : await listReceipts(workspace, auth),
              specRecord,
              ...(coverage === undefined
                ? {}
                : {
                    taskReview: {
                      ok: coverage.ok,
                      ...(coverage.gaps.length === 0 ? {} : { text: coverage.gaps.join('; ') }),
                    },
                  }),
            })
            if (decision.kind === 'deny') return { kind: 'deny', reason: decision.reason }
          }
        }
        const writeDecision = authorizationWriteDecision({
          workspace,
          exec: { name: exec.name, arguments: exec.arguments },
          ownedCallIds: new Set(ownedCalls.list()),
          callId: String(exec.callId),
        })
        if (writeDecision?.kind === 'deny') return { kind: 'deny', reason: writeDecision.reason }
        return await next()
      } catch (error) {
        return {
          kind: 'deny',
          reason: `workflows: the pre-execute gate failed internally (${boundedError(error)}); the call was not run`,
        }
      }
    }),
  )

  // Turn close: steer the first owned open blockTurnClose step, bounded.
  listenEngine(() =>
    ctx.on('agent/turn-stopping', async (payload) => {
      try {
        if (payload.agent.session.header.origin === 'subagent') return
        // Capture the session lifecycle before any await: a disposal and
        // recreation during the queue/auth/store waits must abandon this close.
        const sessionGenerationAtEntry = sessionGeneration(String(payload.agent.session.id))
        const workspace = workspaceFor(services, payload.agent.session)
        if (workspace === undefined) return
        // The journal record that creates an observational run is queued before
        // this listener; settle it so a run created by this stop is advanced now.
        const queuedRecord = recordQueues.get(String(payload.agent.session.id))
        if (queuedRecord !== undefined) await queuedRecord.catch(() => undefined)
        await ensureAuth()
        const auth = storedAuth
        if (auth === undefined) return
        const definitions = await definitionsFor(workspace)
        const snapshot = await stableRuns(workspace, auth)
        if (sessionGenerationAtEntry !== sessionGeneration(String(payload.agent.session.id))) {
          // The session ended while this close awaited its queue or store; the
          // new agent owns the next close, not this stale one.
          await refreshPromptRuns(workspace)
          return
        }
        if (!snapshot.stable) {
          // Never dispatch or persist from a listing a cancel/dispose can race.
          // Fail open like an internal error; the next stop retries the read.
          await refreshPromptRuns(workspace)
          return
        }
        const runs = snapshot.runs
        const runGenerationsAtRead = snapshot.generations
        const sessionGenerationAtRead = sessionGenerationAtEntry
        const sessionId = String(payload.agent.session.id)
        // A later code write invalidates a completed verification for the same
        // turn; reopen the run so a fresh check is required before the close.
        const verifyWriteAt =
          turnMetrics.get(sessionId)?.turn === payload.turn
            ? turnMetrics.get(sessionId)?.lastWriteAt
            : undefined
        if (verifyWriteAt !== undefined) {
          const bufferCheckAt = (sessionShellResults.get(sessionId) ?? [])
            .filter(
              (result) =>
                result.foreground &&
                result.ok !== false &&
                result.exitCode === 0 &&
                result.aborted !== true &&
                result.signal === undefined &&
                result.timedOut !== true &&
                result.sandboxDenied !== true &&
                verifySettings.commands.some((configured) =>
                  commandMatches(configured, result.command),
                ) &&
                (result.cwd === undefined || sameCheckDirectory(result.cwd, workspace)),
            )
            .map((result) => result.at)
            .sort((left, right) => right - left)[0]
          const metricsCheckAt = turnMetrics.get(sessionId)?.lastCheckAt
          const checkTimes = [bufferCheckAt, metricsCheckAt].filter(
            (entry): entry is number => entry !== undefined,
          )
          const lastCheckAt = checkTimes.length === 0 ? undefined : Math.max(...checkTimes)
          const completedVerify = runs.find(
            (run) =>
              run.definition.id === 'verify' &&
              run.session === sessionId &&
              run.status === 'completed' &&
              Number(run.dedupeKey?.split('\u0000').at(-1)) === payload.turn,
          )
          if (
            completedVerify !== undefined &&
            (lastCheckAt === undefined || verifyWriteAt > lastCheckAt)
          ) {
            const reopened: WorkflowRun = {
              ...completedVerify,
              status: 'running',
              updatedAt: journal.time(),
              steps: completedVerify.steps.map((step) => ({
                ...(Object.fromEntries(
                  Object.entries(step).filter(([key]) => key !== 'evidence' && key !== 'reason'),
                ) as typeof step),
                state: 'open' as const,
                attempts: 0,
              })),
            }
            const persisted = await persistRun(
              workspace,
              reopened,
              auth,
              runGenerationsAtRead.get(completedVerify.id),
              sessionGenerationAtRead,
              completedVerify.updatedAt,
            )
            runs.splice(runs.indexOf(completedVerify), 1, persisted)
          }
        }
        const eligible = runs.filter(
          (run) =>
            run.session === sessionId &&
            (run.status === 'running' ||
              run.status === 'blocked' ||
              // A terminal task-review run still owns its change's completion
              // coverage, so the close cannot skip it after exhaustion.
              (run.definition.id === 'task-review' && run.status === 'failed')),
        )
        const ownerId = mainStepOwners.get(sessionId)
        const owner = ownerId === undefined ? undefined : eligible.find((run) => run.id === ownerId)
        if (ownerId !== undefined && owner === undefined) mainStepOwners.delete(sessionId)
        const ordered =
          owner === undefined ? eligible : [owner, ...eligible.filter((run) => run.id !== owner.id)]
        const legacy = legacySignalState()
        const workflowOwnsCheckpoint = !legacy.enabled.has('goal-continuity/work_checkpoint')
        const checkpointObservations = (session: string): CheckpointObservation[] =>
          (sessionToolCalls.get(session) ?? []).map((call) => ({
            toolName: call.name,
            arguments: call.arguments,
            ok: call.ok,
            ...(call.at === undefined ? {} : { at: call.at }),
            ...(call.detail === undefined ? {} : { detail: call.detail }),
            ...(call.seq === undefined ? {} : { seq: call.seq }),
          }))
        const checkpointFreshness = (
          session: string,
          turn: number,
        ): { fresh: boolean; checkpointAt?: number } => {
          const calls = (sessionToolCalls.get(session) ?? []).filter(
            (call) => call.name === 'work_checkpoint' && call.ok && call.turn === turn,
          )
          const last = calls.at(-1)
          const steps = turnSteps.get(session) ?? 0
          return {
            fresh:
              last !== undefined && steps - (last.step ?? 0) < checkpointApplicability.stepInterval,
            ...(last?.at === undefined ? {} : { checkpointAt: last.at }),
          }
        }
        const workerToolVisible = (agent: unknown): boolean => {
          try {
            const tools = ctx.get('tools') as
              | { get?: (name: string, caller?: unknown) => unknown }
              | undefined
            return ['subagent', 'subagent_fork', 'spawn_teammate', 'workflow', 'delegate'].some(
              (name) => tools?.get?.(name, agent) !== undefined,
            )
          } catch {
            return true
          }
        }
        const checkpointOptions = (turn: number) => ({
          ...checkpointFreshness(sessionId, turn),
          workerVisible: workerToolVisible(payload.agent),
          enforceParallel: checkpointApplicability.enforceParallel,
        })
        const checkpointTurnOf = (path: string): number | undefined => {
          const name = path.replaceAll('\\', '/').split('/').at(-1) ?? ''
          const turn = Number(name.replace(/\.json$/u, ''))
          return Number.isSafeInteger(turn) ? turn : undefined
        }
        let refusedThisClose = false
        // Advance every run first: an owned tool step (the review start) must
        // dispatch for every newly checked task before one close is refused.
        const advanced = new Map<string, WorkflowRun>()
        const advancedGenerations = new Map<string, number>()
        const definitionOf = new Map<string, Definition>()
        for (const run of ordered) {
          const definition = definitions.find((entry) => entry.id === run.definition.id)
          if (definition === undefined) continue
          const generation = runGenerationsAtRead.get(run.id) ?? runGeneration(run.id)
          // A retro run must not complete on the record alone: while the host
          // checkpoint remedy/age rule fails, keep the run open and steer.
          if (
            workflowOwnsCheckpoint &&
            definition.id === 'retro' &&
            typeof run.context.checkpoint === 'string' &&
            checkpointTurnOf(run.context.checkpoint) === payload.turn
          ) {
            const DEBUG_ISSUE = checkpointGateIssue(
              workspace,
              run.context.checkpoint,
              checkpointObservations(sessionId),
              checkpointApplicability.bottleneckAge,
              checkpointOptions(payload.turn),
            )
            if (DEBUG_ISSUE !== undefined) {
              advanced.set(run.id, run)
              advancedGenerations.set(run.id, generation)
              definitionOf.set(run.id, definition)
              continue
            }
          }
          // A terminal task-review run is not advanced again; the gate below
          // still evaluates its change's completion coverage.
          if (run.definition.id === 'task-review' && run.status === 'failed') {
            advanced.set(run.id, run)
            advancedGenerations.set(run.id, generation)
            definitionOf.set(run.id, definition)
            continue
          }
          const current = await advanceRun(
            workspace,
            run,
            definition,
            payload.agent,
            auth,
            legacy.installed,
            legacy.enabled,
            payload.turn,
            generation,
            sessionGenerationAtRead,
          )
          advanced.set(run.id, current)
          advancedGenerations.set(run.id, generation)
          definitionOf.set(run.id, definition)
          // A superseded run no longer suppresses a restored identical event;
          // this pass always visits every run, unlike the gate loop that breaks
          // at the first refusal.
          if (current.status === 'cancelled' && (current.reason ?? '').includes('superseded')) {
            const sessionSeen = seen.get(current.session)
            if (sessionSeen !== undefined && current.dedupeKey !== undefined) {
              sessionSeen.delete(current.dedupeKey)
            }
            // Invalidate the cached checked-task baseline for this change too:
            // a restore may land before the deletion event flushes.
            if (typeof current.context.name === 'string') {
              checkedTasksSeen.set(`${current.session}\u0000${current.context.name}`, new Set())
            }
          }
        }
        for (const run of ordered) {
          const current = advanced.get(run.id)
          const definition = definitionOf.get(run.id)
          if (current === undefined || definition === undefined) continue
          // A prior turn's retro obligation is obsolete: work_checkpoint only
          // writes the current turn's record, so supersede it (keeping its
          // violation history) instead of demanding the old record forever.
          if (
            current.definition.id === 'retro' &&
            (current.status === 'running' || current.status === 'blocked') &&
            typeof current.context.checkpoint === 'string' &&
            checkpointTurnOf(current.context.checkpoint) !== payload.turn
          ) {
            const superseded = {
              ...current,
              status: 'cancelled' as const,
              updatedAt: journal.time(),
            }
            await persistRun(
              workspace,
              superseded,
              auth,
              advancedGenerations.get(current.id),
              sessionGenerationAtRead,
              current.updatedAt,
            )
            ordered.splice(ordered.indexOf(run), 1, superseded)
            continue
          }
          const sessionCalls = sessionToolCalls.get(sessionId) ?? []
          const observations = sessionCalls.map((call) => ({
            toolName: call.name,
            arguments: call.arguments,
            ok: call.ok,
            ...(call.at === undefined ? {} : { at: call.at }),
            ...(call.detail === undefined ? {} : { detail: call.detail }),
            ...(call.seq === undefined ? {} : { seq: call.seq }),
          }))
          const completion =
            definition.id === 'task-review' && typeof current.context.name === 'string'
              ? taskReviewCompletion(workspace, current.context.name)
              : undefined
          const checkpointIssue =
            definition.id === 'retro' && typeof current.context.checkpoint === 'string'
              ? checkpointGateIssue(
                  workspace,
                  current.context.checkpoint,
                  observations,
                  checkpointApplicability.bottleneckAge,
                  checkpointOptions(payload.turn),
                )
              : undefined
          const outcome = evaluateTurnClose({
            run: current,
            definition,
            agent: {
              steer: (text: string) =>
                payload.agent.steer({
                  id: randomUUID(),
                  role: 'user',
                  content: [{ type: 'text', text }],
                  source: { kind: 'workflows-gate' },
                } as never),
            },
            evidenceContext: {
              workspace,
              values: current.context,
              ...(definition.id === 'verify'
                ? {
                    checkCommands: verifySettings.commands,
                    ...(turnMetrics.get(sessionId)?.lastWriteAt === undefined
                      ? {}
                      : {
                          lastWriteAt: turnMetrics.get(sessionId)?.lastWriteAt,
                          ...(turnMetrics.get(sessionId)?.lastWritePath === undefined
                            ? {}
                            : { lastWritePath: turnMetrics.get(sessionId)?.lastWritePath }),
                          ...(turnMetrics.get(sessionId)?.lastCheckAt === undefined
                            ? {}
                            : { lastCheckAt: turnMetrics.get(sessionId)?.lastCheckAt }),
                        }),
                  }
                : {}),
            },
            turn: payload.turn,
            maxBlocks: definition.settings.maxBlocks,
            installedLegacy: legacy.installed,
            enabledLegacy: legacy.enabled,
            ...(completion === undefined ? {} : { completion }),
            ...(checkpointIssue === undefined ? {} : { checkpointIssue }),
            onError: (error) => publishListenerError(workspace, error),
          })
          if (outcome.run !== current) {
            await persistRun(
              workspace,
              outcome.run,
              auth,
              advancedGenerations.get(run.id),
              sessionGenerationAtRead,
              current.updatedAt,
            )
          }
          // Keep the session's main-step owner until its step settles; a
          // second run may take over only after that.
          if (outcome.kind !== 'allow') {
            refusedThisClose = true
            mainStepOwners.set(sessionId, run.id)
            break
          }
          if (owner !== undefined && run.id === owner.id) {
            mainStepOwners.delete(sessionId)
          }
        }
        // A completed retro run must not hide a checkpoint that went stale
        // later in the same turn: re-check the current-turn record on every
        // close and steer when the obligation reappears.
        if (!refusedThisClose && workflowOwnsCheckpoint) {
          const candidate = runs.find(
            (run) =>
              run.definition.id === 'retro' &&
              typeof run.context.checkpoint === 'string' &&
              checkpointTurnOf(run.context.checkpoint) === payload.turn &&
              run.session === sessionId,
          )
          // Use the post-advance state; a retrospective run cancelled by this
          // close (or ended by a disposal) must not be revived by this cleanup.
          const currentRetro =
            candidate === undefined ? undefined : (advanced.get(candidate.id) ?? candidate)
          if (
            currentRetro !== undefined &&
            currentRetro.status !== 'cancelled' &&
            currentRetro.status !== 'interrupted' &&
            currentRetro.status !== 'failed' &&
            typeof currentRetro.context.checkpoint === 'string'
          ) {
            const issue = checkpointGateIssue(
              workspace,
              currentRetro.context.checkpoint,
              checkpointObservations(sessionId),
              checkpointApplicability.bottleneckAge,
              checkpointOptions(payload.turn),
            )
            const blocks =
              currentRetro.turnBlocksTurn === payload.turn ? (currentRetro.turnBlocks ?? 0) : 0
            const limit = definitions.find((entry) => entry.id === 'retro')?.settings.maxBlocks ?? 3
            const alreadyUnchecked = (currentRetro.violations ?? []).some(
              (violation) => violation.reason?.includes('checkpoint freshness refused') === true,
            )
            if (issue !== undefined && !alreadyUnchecked && blocks < limit) {
              await persistRun(
                workspace,
                {
                  ...incrementTurnBlocks(currentRetro, journal.time()),
                  turnBlocksTurn: payload.turn,
                },
                auth,
                runGenerationsAtRead.get(currentRetro.id),
                sessionGenerationAtRead,
                currentRetro.updatedAt,
              )
              payload.agent.steer({
                id: randomUUID(),
                role: 'user',
                content: [{ type: 'text', text: issue.text }],
                source: { kind: 'workflows-gate' },
              } as never)
              refusedThisClose = true
            } else if (issue !== undefined && blocks === limit) {
              const violated = addViolation(
                currentRetro,
                `checkpoint freshness refused ${String(limit)} time(s); the close is allowed once as a VIOLATION`,
                { at: journal.time() },
              )
              await persistRun(
                workspace,
                { ...violated, turnBlocksTurn: payload.turn, turnBlocks: limit + 1 },
                auth,
                runGenerationsAtRead.get(currentRetro.id),
                sessionGenerationAtRead,
                currentRetro.updatedAt,
              )
              payload.agent.steer({
                id: randomUUID(),
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Work checkpoint UNCHECKED: ${issue.text} This is not a pass.`,
                  },
                ],
                source: { kind: 'workflows-gate' },
              } as never)
            }
          }
        }
        await refreshPromptRuns(workspace)
      } catch (error) {
        publishListenerError(workspaceFor(services, payload.agent.session), error)
      }
    }),
  )

  const toolHostFor = (
    agent: Agent,
    workspace: string,
    auth: HostAuth,
    definitions: Definition[],
    sessionGenerationAtEntry: number,
  ): WorkflowsToolHost => {
    const questions = questionsFor(agent)
    return {
      workspace,
      session: String(agent.session.id),
      definitions,
      auth,
      maxRuns,
      ...(questions === undefined ? {} : { questions }),
      now: () => journal.time(),
      sessionLive: (session) => services.agents.get(session) !== undefined,
      evidenceContext: (run, step) => {
        const sessionId = String(agent.session.id)
        const state = run.steps.find((entry) => entry.id === step.id)
        const calls = sessionToolCalls.get(sessionId) ?? []
        const metrics = turnMetrics.get(sessionId)
        const lastWrite = lastCodeWriteAt(calls, workspace) ?? metrics?.lastWriteAt
        return {
          toolCalls: calls,
          shellResults: sessionShellResults.get(sessionId) ?? [],
          checkCommands: verifySettings.commands,
          ...(lastWrite === undefined ? {} : { lastWriteAt: lastWrite }),
          ...(metrics?.lastWritePath === undefined ? {} : { lastWritePath: metrics.lastWritePath }),
          ...(metrics?.lastCheckAt === undefined ? {} : { lastCheckAt: metrics.lastCheckAt }),
          ...(state?.requestedAt === undefined ? {} : { stepStartedAt: state.requestedAt }),
          ...(typeof state?.evidence?.answer === 'string'
            ? { answers: [{ answer: state.evidence.answer }] }
            : {}),
        }
      },
      listRuns: async () => {
        await recoverIfNeeded(workspace)
        return listAuthenticatedRuns(workspace, auth)
      },
      readRun: async (runId) => {
        await recoverIfNeeded(workspace)
        return readAuthenticatedRun(workspace, runId, auth)
      },
      startRun: async (definition) => {
        await recoverIfNeeded(workspace)
        const run = await startRunFor(workspace, String(agent.session.id), auth, definition)
        return { run, firstStep: definition.steps[0]?.id ?? 'end' }
      },
      resumeRun: async (runId) => {
        await recoverIfNeeded(workspace)
        const sessionId = String(agent.session.id)
        const entryGeneration = sessionGenerationAtEntry
        // The transition is read, validated and committed inside the lock; a
        // disposal that lands while it waits makes the commit fail.
        const committed = await withRunLock(runId, async () => {
          try {
            const prior = await readAuthenticatedRun(workspace, runId, auth)
            const resumed = await resumeRun(workspace, runId, auth, Date.now(), sessionId, false)
            if (entryGeneration !== sessionGeneration(sessionId)) return undefined
            await writeCommit(workspace, resumed.run, auth)
            // A disposal can land during the write; keep its fence and restore
            // the prior pending steps so the run remains resumable.
            if (entryGeneration !== sessionGeneration(sessionId)) {
              // Always persist the prior interrupted state: interruptEndedRun
              // returns undefined for an already interrupted run.
              const replacement =
                prior === undefined
                  ? undefined
                  : (interruptEndedRun(prior, true, journal.time()) ?? prior)
              if (replacement !== undefined) await writeCommit(workspace, replacement, auth)
              bumpRunGeneration(runId)
              return undefined
            }
            endedRunIds.delete(runId)
            disposalFenced.delete(runId)
            endedSessionIds.delete(sessionId)
            bumpRunGeneration(runId)
            return resumed
          } catch {
            return undefined
          }
        })
        if (committed === undefined) throw new Error('the run could not be resumed; retry')
        void refreshPromptRuns(workspace)
        return { run: committed.run, stepId: committed.stepId }
      },
      cancelRun: async (runId) => {
        await recoverIfNeeded(workspace)
        // The transition is read, validated and committed inside the lock; a
        // delayed disposal either goes first (and the cancel reads it) or sees
        // the terminal cancellation and skips.
        const committed = await withRunLock(runId, async () => {
          try {
            const cancelled = await cancelRun(workspace, runId, auth, Date.now(), undefined, false)
            await writeCommit(workspace, cancelled, auth)
            bumpRunGeneration(runId)
            return cancelled
          } catch {
            return undefined
          }
        })
        if (committed === undefined) throw new Error('the run could not be cancelled; retry')
        void refreshPromptRuns(workspace)
        return committed
      },
    }
  }

  // The model-facing tool is optional; a host without a tool registry keeps the
  // gates and the recorder.
  const toolsService = optionalService<{ register(definition: unknown): unknown }>('tools')
  if (toolsService?.register !== undefined) {
    ctx.effect(
      () =>
        toolsService.register({
          name: 'workflows',
          description:
            'List, start, resume, inspect, evidence-check, or cancel a stored workflow run. It never accepts a script or definition, never installs a definition, never starts an adoption, and never writes an approval or receipt.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['list', 'start', 'resume', 'status', 'evidence', 'cancel'],
                description: 'The bounded action to run.',
              },
              definitionId: { type: 'string', description: 'A stored definition id.' },
              runId: { type: 'string', description: 'A workflow run id.' },
              stepId: { type: 'string', description: 'A step id of the run.' },
              evidence: {
                type: 'object',
                properties: {
                  kind: { type: 'string' },
                  ref: { type: 'string' },
                },
                required: ['kind', 'ref'],
                additionalProperties: false,
                description: 'The evidence the host verifier must check; a text claim is refused.',
              },
            },
            required: ['action'],
            additionalProperties: false,
          },
          output: {
            schema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
            render: (_args: unknown, value: unknown) => [
              { type: 'text', text: String((value as { text?: unknown }).text ?? '') },
            ],
          },
          execute: async (args: unknown, exec: { agent?: Agent }) => {
            const agent = exec.agent
            if (agent === undefined) throw new Error('workflows: the tool needs a live session')
            // Capture the session lifecycle before any await: a disposal while
            // the pre-run reads are pending must invalidate a resume.
            const sessionGenerationAtEntry = sessionGeneration(String(agent.session.id))
            const workspace = workspaceFor(services, agent.session)
            if (workspace === undefined)
              throw new Error('workflows: the session workspace is unavailable')
            await ensureAuth()
            const auth = storedAuth
            if (auth === undefined) throw new Error('workflows: the host key is unavailable')
            const definitions = await definitionsFor(workspace)
            return {
              text: await executeWorkflowsTool(
                args,
                toolHostFor(agent, workspace, auth, definitions, sessionGenerationAtEntry),
              ),
            }
          },
        }) as never,
    )
  }

  // The user-started `/workflows` command.
  const commandsService = optionalService<{ register(definition: unknown): unknown }>('commands')
  if (commandsService?.register !== undefined) {
    ctx.effect(
      () =>
        commandsService.register({
          definitionId: '@dsh-setup/plugin-workflows/workflows',
          name: 'workflows',
          description:
            'Open the Workflows view, run/resume a workflow, install a definition after confirmation, adopt an existing change, or print a bounded status.',
          handler: async (invocation: {
            agent: Agent
            rawInput?: unknown
            arguments?: unknown
            text?: unknown
          }) => {
            try {
              const sessionGenerationAtEntry = sessionGeneration(
                String(invocation.agent.session.id),
              )
              const workspace = workspaceFor(services, invocation.agent.session)
              if (workspace === undefined) {
                return { kind: 'error', text: 'the session workspace is unavailable' }
              }
              await ensureAuth()
              const auth = storedAuth
              if (auth === undefined) {
                return { kind: 'error', text: 'the workflows host key is unavailable' }
              }
              const definitions = await definitionsFor(workspace)
              const sessionId = String(invocation.agent.session.id)
              // DSH passes the exact text after the command name as rawInput;
              // arguments/text stay for older callers and tests.
              const input =
                typeof invocation.rawInput === 'string'
                  ? invocation.rawInput
                  : typeof invocation.arguments === 'string'
                    ? invocation.arguments
                    : typeof invocation.text === 'string'
                      ? invocation.text
                      : ''
              // An idle driver starts a turn from steer; request the pending
              // main step so the turn-close gate can advance the run.
              const steerPending = async (agent: Agent, runId: string): Promise<void> => {
                const run = await readAuthenticatedRun(workspace, runId, auth)
                if (run === undefined) return
                const definition = definitions.find((entry) => entry.id === run.definition.id)
                if (definition === undefined) return
                const step = definition.steps.find((entry) => entry.id === pendingStep(run))
                if (step === undefined) return
                // A deferred step is never steered; only its legacy gate steers.
                const state = legacySignalState()
                const resolved = resolveOwnership(
                  definition,
                  state.installed,
                  state.enabled,
                ).steps.find((entry) => entry.id === step.id)
                if (resolved?.ownership !== 'own') return
                // The host dispatches a tool, subagent, or human step at the
                // turn close; steering the model would ask it to forge evidence.
                if (step.executor !== 'main') return
                // An explicit user run or resume gets a fresh bounded budget.
                const budgeted: WorkflowRun = {
                  ...run,
                  steps: run.steps.map((entry) =>
                    entry.id === step.id ? { ...entry, attempts: 0 } : entry,
                  ),
                }
                const steered = requestMainStep({
                  run: budgeted,
                  definition,
                  step,
                  agent: {
                    steer: (text: string) =>
                      agent.steer({
                        id: randomUUID(),
                        role: 'user',
                        content: [{ type: 'text', text }],
                        source: { kind: 'workflows-gate' },
                      } as never),
                  },
                  evidenceContext: { workspace, values: run.context },
                  turn: turns.get(String(agent.session.id)) ?? 0,
                  maxAttempts: definition.settings.maxBlocks,
                  now: journal.time(),
                })
                if (!steered.steered) {
                  throw new Error(
                    `the pending step "${step.id}" could not be steered: ${steered.reason}`,
                  )
                }
                // A command steer writes the same guarded store: a disposal
                // during it must not revive the run.
                await persistRun(
                  workspace,
                  steered.run,
                  auth,
                  runGeneration(run.id),
                  sessionGeneration(String(agent.session.id)),
                  run.updatedAt,
                )
              }
              const questions = questionsFor(invocation.agent)
              const host: WorkflowCommandHost = {
                workspace,
                session: sessionId,
                ...(questions === undefined ? {} : { questions }),
                openView: () =>
                  'The Workflows tab is the session entry point and the Workflow design card is the editor entry point; a Host command result cannot open a client view.',
                run: async (definitionId) => {
                  await recoverIfNeeded(workspace)
                  const definition = definitions.find((entry) => entry.id === definitionId)
                  if (definition === undefined) throw new Error(`no definition "${definitionId}"`)
                  const run = await startRunFor(workspace, sessionId, auth, definition)
                  await steerPending(invocation.agent, run.id)
                  return { runId: run.id, firstStep: definition.steps[0]?.id ?? 'end' }
                },
                resume: async (runId) => {
                  await recoverIfNeeded(workspace)
                  const entryGeneration = sessionGenerationAtEntry
                  const resumed = await withRunLock(runId, async () => {
                    try {
                      const prior = await readAuthenticatedRun(workspace, runId, auth)
                      const result = await resumeRun(
                        workspace,
                        runId,
                        auth,
                        Date.now(),
                        sessionId,
                        false,
                      )
                      if (entryGeneration !== sessionGeneration(sessionId)) return undefined
                      await writeCommit(workspace, result.run, auth)
                      if (entryGeneration !== sessionGeneration(sessionId)) {
                        // Always persist the prior interrupted state:
                        // interruptEndedRun returns undefined for an already
                        // interrupted run.
                        const replacement =
                          prior === undefined
                            ? undefined
                            : (interruptEndedRun(prior, true, journal.time()) ?? prior)
                        if (replacement !== undefined) {
                          await writeCommit(workspace, replacement, auth)
                        }
                        bumpRunGeneration(runId)
                        return undefined
                      }
                      endedRunIds.delete(runId)
                      disposalFenced.delete(runId)
                      endedSessionIds.delete(sessionId)
                      bumpRunGeneration(runId)
                      return result
                    } catch {
                      return undefined
                    }
                  })
                  if (resumed === undefined) throw new Error('the run could not be resumed; retry')
                  void refreshPromptRuns(workspace)
                  await steerPending(invocation.agent, runId)
                  return { stepId: resumed.stepId }
                },
                install: async (path) => {
                  const installed = await installDefinition(workspace, path, auth)
                  // The next command must see the definition without a restart.
                  definitionLoads.delete(workspace)
                  definitionsByWorkspace.delete(workspace)
                  return { id: installed.definition.id }
                },
                adopt: async (name) => {
                  const adopted = await adoptChange({
                    workspace,
                    change: name,
                    auth,
                    userStarted: true,
                    ...(questions === undefined ? {} : { questions }),
                    now: journal.time(),
                  })
                  return adopted.ok ? { ok: true } : { ok: false, reason: adopted.reason }
                },
                status: async () => {
                  await recoverIfNeeded(workspace)
                  const runs = await listAuthenticatedRuns(workspace, auth)
                  const open = runs.filter(
                    (run) => run.status === 'running' || run.status === 'blocked',
                  )
                  return `definitions: ${String(definitions.length)}; open runs: ${String(open.length)}; receipts: ${String((await listReceipts(workspace, auth)).length)}`
                },
              }
              const result = await runWorkflowCommand(input, host)
              return { kind: result.kind === 'error' ? 'error' : 'success', text: result.text }
            } catch (error) {
              return { kind: 'error', text: boundedError(error) }
            }
          },
        }) as never,
    )
  }

  // The bounded active-run system-prompt context.
  registerActiveRunsContext(ctx as never, activePromptRuns)

  // The read-only API is optional at runtime but present on the Web host that
  // also carries the Client view; a host without Fetch keeps recording only.
  registerWorkflowRoutes(ctx, {
    agents: services.agents,
    workingDirectory: services.workingDirectory as { get(session: unknown): string },
    journal,
    healthFor,
    lastEventAtFor: (session) => sessionEventAt.get(session),
    triggers,
    definitionsFor: (workspace) => definitionsByWorkspace.get(workspace) ?? [],
    definitionEntriesFor: (workspace) => listEditorDefinitions(workspace),
    definitionDocumentFor: (workspace, id) => readEditorDefinitionDocument(workspace, id),
    receiptsFor: async (workspace) => {
      const auth = storedAuth
      return auth === undefined ? [] : listReceipts(workspace, auth)
    },
  })

  // The Design mode's write API shares the read API's carrier and host key, so a
  // saved definition is approved exactly as a `/workflows install` would be.
  registerEditorRoutes(ctx, {
    agents: services.agents,
    workingDirectory: services.workingDirectory as { get(session: unknown): string },
    auth: async () => (storedAuth === undefined ? ensureAuth() : storedAuth),
  })
}
