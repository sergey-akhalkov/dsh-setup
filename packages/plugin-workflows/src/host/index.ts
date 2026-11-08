import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { adoptChange } from './adoption.js'
import { registerWorkflowRoutes } from './api.js'
import { installDefinition, loadApprovedDefinitions } from './approval-store.js'
import { parseArchiveCommand, parseOpenspecCommand } from './command-parse.js'
import { runWorkflowCommand, type WorkflowCommandHost } from './commands.js'
import {
  type Definition,
  KNOWN_LEGACY_SOURCES,
  loadShippedDefinitions,
  workspaceDefinitionsDirectory,
} from './definitions.js'
import { evaluateEvent, type ObservedEvent } from './evaluate.js'
import { verifyEvidence } from './evidence.js'
import { adaptUserQuestions, type DshUserQuestions, OwnedCalls } from './executors.js'
import { type FsChangeWatcher, startFsChangeWatcher } from './fs-change.js'
import {
  authorizationWriteDecision,
  evaluateArchiveGate,
  evaluateIntakeGate,
  evaluateTurnClose,
} from './gates.js'
import { WorkflowHealth } from './health.js'
import { HostAuth } from './host-auth.js'
import {
  Journal,
  type JournalInput,
  MAX_RECORD_BYTES,
  type TriggerEvaluationRecord,
  toolResultText,
  workflowsDirectory,
} from './journal.js'
import { registerActiveRunsContext } from './prompt.js'
import { listReceipts } from './receipts.js'
import { cancelRun, recoverRuns, resumeRun } from './resume.js'
import {
  createRun,
  DEFAULT_MAX_RUNS,
  hasTamperedRuns,
  listAuthenticatedRuns,
  openRunCount,
  pruneRuns,
  readAuthenticatedRun,
  runFailure,
  storedRuns,
  type WorkflowRun,
  writeRun,
  writeRunSync,
} from './runs.js'
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
export const inject = ['agents', 'workingDirectory', 'fs', 'connection']

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
      const events: DefinitionEvent[] = [
        {
          kind: 'fs.change',
          subject: path,
          path,
          ...(event.change === undefined ? {} : { name: event.change }),
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

const WORKER_TOOL_NAMES = new Set(['subagent', 'subagent_fork', 'spawn_teammate', 'workflow'])

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
  /** Load the shipped set plus the approved local overrides for one workspace. */
  const definitionLoads = new Map<string, Promise<void>>()
  const loadDefinitions = (workspace: string): Promise<void> => {
    const existing = definitionLoads.get(workspace)
    if (existing !== undefined) return existing
    if (pluginDisposed) return Promise.resolve()
    const promise = (async () => {
      try {
        if (await hasLocalDefinitionFiles(workspace)) await ensureAuth()
        const loaded = await loadApprovedDefinitions(workspace, {
          ...(storedAuth === undefined ? {} : { auth: storedAuth }),
          installedLegacy: installedLegacySources(),
        })
        if (pluginDisposed) return
        definitionsByWorkspace.set(workspace, loaded.definitions)
        // A run is authoritative only when signed, so an active definition
        // needs the host key ready before its first event.
        if (loaded.definitions.some((definition) => definition.trigger.mode === 'active')) {
          void ensureAuth()
        }
        // Definition-load refusals are diagnostics, not listener failures: they
        // must not overwrite the health strip's single last-error slot.
        for (const message of loaded.errors) {
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
      const run = createRun({
        definition: definition.id,
        trigger: definition.trigger.kind,
        session: event.session ?? '',
        workspace,
        ...(event.name === undefined ? {} : { context: { name: event.name } }),
        steps: definition.steps.map((step) => step.id),
        now: journal.time(),
        ...(dedupeKey === undefined ? {} : { dedupeKey }),
      })
      writeRunSync(workspace, run, auth)
      return { ok: true, runId: run.id }
    } catch (error) {
      return { ok: false, reason: runFailure(error) }
    } finally {
      releaseStart(workspace)
    }
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
  }
  const turnMetrics = new Map<string, TurnMetrics>()
  /** The session's current main-step owner; a second run waits for it to settle. */
  const mainStepOwners = new Map<string, string>()
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
      const knownRuns =
        storedAuth === undefined ? [] : await listAuthenticatedRuns(workspace, storedAuth)
      const runLimitReached = storedAuth !== undefined && atRunLimit(workspace, knownRuns)
      let startedThisEvent = 0
      const records = evaluateEvent(triggers, event, sessionSeen, true, input.at)
      const metrics = input.turn === undefined ? undefined : turnMetrics.get(input.session)
      const definitionRows = definitionEventsOf(input, event, workspace).flatMap(
        (definitionEvent) =>
          evaluateDefinitions(definitionsByWorkspace.get(workspace) ?? [], definitionEvent, {
            isDuplicate: (key) => sessionSeen.has(key),
            markKey: (key) => sessionSeen.set(key, input.at),
            startRun: (definition, matched) => {
              const full =
                storedAuth !== undefined &&
                (runLimitReached || openRunCount(knownRuns) + startedThisEvent >= maxRuns)
              const outcome = startDefinitionRun(workspace, definition, matched, full)
              if (outcome.ok) startedThisEvent += 1
              return outcome
            },
            resolveApplicability: (definition) => {
              if (definition.trigger.applicability !== 'checkpoint-required') return undefined
              const current =
                input.turn !== undefined && metrics !== undefined && metrics.turn === input.turn
                  ? metrics
                  : undefined
              return checkpointRequired({
                toolCalls: current?.toolCalls ?? 0,
                ...(current?.lastTool === undefined ? {} : { lastTool: current.lastTool }),
                written: current?.written ?? 0,
                workers: current?.workers ?? 0,
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
                      const run = createRun({
                        definition: definition.id,
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
                      writeRunSync(activeWorkspace, run, auth)
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
        if (exec.name === 'write' || exec.name === 'edit') metrics.written += 1
        if (WORKER_TOOL_NAMES.has(exec.name)) metrics.workers += 1
        const text = toolResultText(result)
        const summary = toolSummary(exec.name, result.isError, text)
        const bytes = Buffer.byteLength(text, 'utf8')
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
        bindLifecycle(agent)
        observeSession(agent.session)
      } catch {
        // A listener that cannot bind leaves the rest of the host working.
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
  let promptRuns: WorkflowRun[] = []
  const optionalService = <T>(name: string): T | undefined => {
    try {
      return (ctx as unknown as { get?: (serviceName: string) => unknown }).get?.(name) as
        | T
        | undefined
    } catch {
      return undefined
    }
  }
  const rawUserQuestions = optionalService<DshUserQuestions>('userQuestions')
  const userQuestions =
    rawUserQuestions === undefined ? undefined : adaptUserQuestions(rawUserQuestions)
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
    const runs = await listAuthenticatedRuns(workspace, auth)
    if (atRunLimit(workspace, runs)) {
      throw new Error(
        `the run limit (${String(maxRuns)}) is reached; finish or cancel an open run first`,
      )
    }
    reserveStart(workspace)
    try {
      const run = createRun({
        definition: definition.id,
        trigger: definition.trigger.kind,
        session: sessionId,
        workspace,
        context,
        steps: definition.steps.map((step) => step.id),
        now: journal.time(),
        ...(dedupeKey === undefined ? {} : { dedupeKey }),
      })
      await writeRun(workspace, run, auth)
      return run
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
        if (run.session === sessionId && run.dedupeKey !== undefined) {
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
                      const resumed = await resumeRun(workspace, runId, auth, Date.now(), sessionId)
                      await writeRun(workspace, resumed.run, auth)
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
            /^\\s*(?:rtk\\s+|pnpm\\s+exec\\s+)?openspec\\s+archive\\b/iu.test(command)
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
            const decision = evaluateArchiveGate({
              change: archive.change,
              tamperedRuns: auth === undefined ? false : await hasTamperedRuns(workspace, auth),
              runs: auth === undefined ? [] : await listAuthenticatedRuns(workspace, auth),
              receipts: auth === undefined ? [] : await listReceipts(workspace, auth),
              specRecord,
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
        const workspace = workspaceFor(services, payload.agent.session)
        if (workspace === undefined) return
        await ensureAuth()
        const auth = storedAuth
        if (auth === undefined) return
        const definitions = await definitionsFor(workspace)
        const runs = await listAuthenticatedRuns(workspace, auth)
        promptRuns = runs.filter(
          (run) =>
            run.status === 'running' || run.status === 'blocked' || run.status === 'interrupted',
        )
        const sessionId = String(payload.agent.session.id)
        const eligible = runs.filter(
          (run) =>
            run.session === sessionId && (run.status === 'running' || run.status === 'blocked'),
        )
        const ownerId = mainStepOwners.get(sessionId)
        const owner = ownerId === undefined ? undefined : eligible.find((run) => run.id === ownerId)
        if (ownerId !== undefined && owner === undefined) mainStepOwners.delete(sessionId)
        const ordered =
          owner === undefined ? eligible : [owner, ...eligible.filter((run) => run.id !== owner.id)]
        for (const run of ordered) {
          const definition = definitions.find((entry) => entry.id === run.definition)
          if (definition === undefined) continue
          const outcome = evaluateTurnClose({
            run,
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
            evidenceContext: { workspace, values: run.context },
            turn: payload.turn,
            maxBlocks: definition.settings.maxBlocks,
            installedLegacy: installedLegacySources(),
            onError: (error) => publishListenerError(workspace, error),
          })
          if (outcome.run !== run) await writeRun(workspace, outcome.run, auth)
          // Keep the session's main-step owner until its step settles; a
          // second run may take over only after that.
          if (outcome.kind !== 'allow') {
            mainStepOwners.set(sessionId, run.id)
            break
          }
          if (owner !== undefined && run.id === owner.id) {
            mainStepOwners.delete(sessionId)
          }
        }
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
  ): WorkflowsToolHost => ({
    workspace,
    session: String(agent.session.id),
    definitions,
    auth,
    maxRuns,
    ...(userQuestions === undefined ? {} : { questions: userQuestions }),
    now: () => journal.time(),
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
      const resumed = await resumeRun(workspace, runId, auth, Date.now(), String(agent.session.id))
      await writeRun(workspace, resumed.run, auth)
      return { run: resumed.run, stepId: resumed.stepId }
    },
    cancelRun: async (runId) => {
      await recoverIfNeeded(workspace)
      const cancelled = await cancelRun(
        workspace,
        runId,
        auth,
        Date.now(),
        String(agent.session.id),
      )
      await writeRun(workspace, cancelled, auth)
      return cancelled
    },
  })

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
                toolHostFor(agent, workspace, auth, definitions),
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
          handler: async (invocation: { agent: Agent; arguments?: unknown; text?: unknown }) => {
            try {
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
              const input =
                typeof invocation.arguments === 'string'
                  ? invocation.arguments
                  : typeof invocation.text === 'string'
                    ? invocation.text
                    : ''
              const host: WorkflowCommandHost = {
                workspace,
                session: sessionId,
                ...(userQuestions === undefined ? {} : { questions: userQuestions }),
                openView: () => 'The Workflows view is available in the Workflows tab.',
                run: async (definitionId) => {
                  await recoverIfNeeded(workspace)
                  const definition = definitions.find((entry) => entry.id === definitionId)
                  if (definition === undefined) throw new Error(`no definition "${definitionId}"`)
                  const run = await startRunFor(workspace, sessionId, auth, definition)
                  return { runId: run.id, firstStep: definition.steps[0]?.id ?? 'end' }
                },
                resume: async (runId) => {
                  await recoverIfNeeded(workspace)
                  const resumed = await resumeRun(workspace, runId, auth, Date.now(), sessionId)
                  await writeRun(workspace, resumed.run, auth)
                  return { stepId: resumed.stepId }
                },
                install: async (path) => {
                  const installed = await installDefinition(workspace, path, auth)
                  return { id: installed.definition.id }
                },
                adopt: async (name) => {
                  const adopted = await adoptChange({
                    workspace,
                    change: name,
                    auth,
                    userStarted: true,
                    ...(userQuestions === undefined ? {} : { questions: userQuestions }),
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
  registerActiveRunsContext(ctx as never, () => promptRuns)

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
    receiptsFor: async (workspace) => {
      const auth = storedAuth
      return auth === undefined ? [] : listReceipts(workspace, auth)
    },
  })
}
