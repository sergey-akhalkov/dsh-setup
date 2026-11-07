import { readdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SubagentRunEndInfo, SubagentRunInfo } from '@deepseek-ai/dsh-subagent'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { registerWorkflowRoutes } from './api.js'
import { loadApprovedDefinitions } from './approval-store.js'
import {
  type Definition,
  KNOWN_LEGACY_SOURCES,
  loadShippedDefinitions,
  workspaceDefinitionsDirectory,
} from './definitions.js'
import { evaluateEvent, type ObservedEvent } from './evaluate.js'
import { type FsChangeWatcher, startFsChangeWatcher } from './fs-change.js'
import { WorkflowHealth } from './health.js'
import { HostAuth } from './host-auth.js'
import {
  Journal,
  type JournalInput,
  MAX_RECORD_BYTES,
  toolResultText,
  workflowsDirectory,
} from './journal.js'
import { recoverRuns } from './resume.js'
import { createRun, runFailure, storedRuns, writeRun } from './runs.js'
import {
  type DefinitionEvent,
  evaluateDefinitions,
  loadCatalog,
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

/** Normalize one observed plugin event into definition trigger events. */
function definitionEventsOf(input: JournalInput, event: ObservedEvent): DefinitionEvent[] {
  const base = {
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
          ...(event.hash === undefined ? {} : { hash: event.hash }),
          ...base,
        },
      ]
      if (/(?:^|\/)reviews\/[^/]+\.json$/u.test(path)) {
        events.push({ kind: 'review.record', subject: path, path, ...base })
      }
      return events
    }
    case 'subagent.end':
      return [{ kind: 'subagent.end', subject: event.subject, ...base }]
    default:
      return []
  }
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
export function apply(ctx: Context): void {
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
  const definitionsLoading = new Set<string>()
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
  const loadDefinitions = (workspace: string): void => {
    if (
      pluginDisposed ||
      definitionsByWorkspace.has(workspace) ||
      definitionsLoading.has(workspace)
    ) {
      return
    }
    definitionsLoading.add(workspace)
    void (async () => {
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
      } finally {
        definitionsLoading.delete(workspace)
      }
    })()
  }
  /** Start one run for an active trigger; the writer settles in the background. */
  const startDefinitionRun = (
    workspace: string,
    definition: Definition,
    event: DefinitionEvent,
  ): StartRunOutcome => {
    const auth = storedAuth
    if (auth === undefined) {
      void ensureAuth()
      return {
        ok: false,
        reason: 'the host key is not ready yet; no unsigned run is created',
      }
    }
    try {
      const run = createRun({
        definition: definition.id,
        trigger: definition.trigger.kind,
        session: event.session ?? '',
        workspace,
        ...(event.name === undefined ? {} : { context: { name: event.name } }),
        steps: definition.steps.map((step) => step.id),
        now: journal.time(),
      })
      void writeRun(workspace, run, auth).catch((error: unknown) => {
        healthFor(workspace).recordError(error)
      })
      return { ok: true }
    } catch (error) {
      return { ok: false, reason: runFailure(error) }
    }
  }
  /** Mark unfinished runs from a previous process interrupted, never completed. */
  const recoverIfNeeded = (workspace: string): void => {
    void (async () => {
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
      } catch (error) {
        console.error(
          `workflows: run recovery failed (${error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)})`,
        )
      }
    })()
  }
  /** Begin health for a session workspace as soon as the session is known. */
  const observeSession = (session: Session): void => {
    try {
      const workspace = workspaceFor(services, session)
      if (workspace !== undefined) {
        activeSession.set(workspace, String(session.id))
        healthFor(workspace)
        watchChanges(workspace)
        loadDefinitions(workspace)
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

  const record = (workspace: string, input: JournalInput, event: ObservedEvent): void => {
    const health = healthFor(workspace)
    activeSession.set(workspace, input.session)
    const sessionSeen = seen.get(input.session) ?? new Map<string, number>()
    seen.set(input.session, sessionSeen)
    loadDefinitions(workspace)
    const records = evaluateEvent(triggers, event, sessionSeen, true, input.at)
    const definitionRows = definitionEventsOf(input, event).flatMap((definitionEvent) =>
      evaluateDefinitions(definitionsByWorkspace.get(workspace) ?? [], definitionEvent, {
        isDuplicate: (key) => sessionSeen.has(key),
        markKey: (key) => sessionSeen.set(key, input.at),
        startRun: (definition, matched) => startDefinitionRun(workspace, definition, matched),
      }).map((row) => ({
        id: `definition:${row.definition}`,
        matched: row.matched,
        reason: row.reason,
        ...(row.path === undefined ? {} : { path: row.path }),
        ...(row.filter === undefined ? {} : { filter: row.filter }),
        ...(row.detail === undefined ? {} : { detail: row.detail }),
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
    ctx.on('agent/pre-step', (payload, next) => {
      let workspace: string | undefined
      try {
        const session = payload.agent.session
        workspace = workspaceFor(services, session)
        if (workspace !== undefined) {
          turns.set(String(session.id), payload.turn)
          const origin = session.header.origin === 'subagent' ? 'subagent' : 'root'
          const summary = `step ${String(payload.step)}`
          record(
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
        }
      } catch (error) {
        // An observer never fails a step, but its failure stays visible.
        publishListenerError(workspace, error)
      }
      return next()
    }),
  )

  listen(() =>
    ctx.on('agent/turn-stopping', (payload) => {
      let workspace: string | undefined
      try {
        const session = payload.agent.session
        workspace = workspaceFor(services, session)
        if (workspace === undefined) return
        turns.set(String(session.id), payload.turn)
        const summary = `turn ${String(payload.turn)} stop attempt`
        record(
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
        const text = toolResultText(result)
        const summary = toolSummary(exec.name, result.isError, text)
        const bytes = Buffer.byteLength(text, 'utf8')
        record(
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
        )
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
    record(
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
    )
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
  // The read-only API is optional at runtime but present on the Web host that
  // also carries the Client view; a host without Fetch keeps recording only.
  registerWorkflowRoutes(ctx, {
    agents: services.agents,
    workingDirectory: services.workingDirectory as { get(session: unknown): string },
    journal,
    healthFor,
    lastEventAtFor: (session) => sessionEventAt.get(session),
    triggers,
  })
}
