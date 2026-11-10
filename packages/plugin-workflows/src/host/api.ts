import { readFile, realpath, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { type Definition, loadShippedDefinitions } from './definitions.js'
import { isInside } from './fs-change.js'
import type { WorkflowHealth } from './health.js'
import type { Journal, TriggerEvaluationRecord } from './journal.js'
import { type RunView, sessionRuns } from './projection.js'
import type { WorkflowReceipt } from './receipts.js'
import { redactPayload, redactValue } from './redact.js'
import type { Trigger } from './triggers.js'

/**
 * The read-only Workflows API. Routes are registered through the carrier-neutral
 * `connection.fetch` registry the OpenSpec panel uses; the carrier owns owner
 * admission (a non-owner peer is refused before a handler runs), and every
 * handler below still accepts GET only and resolves the workspace from a live
 * session, never from request text.
 */

export const EVENTS_ROUTE = '/api/workflows/events'
export const RUNS_ROUTE = '/api/workflows/runs'
export const TRIGGERS_ROUTE = '/api/workflows/triggers'
export const HEALTH_ROUTE = '/api/workflows/health'
export const EVIDENCE_ROUTE = '/api/workflows/evidence'
export const DEFINITIONS_ROUTE = '/api/workflows/definitions'
export const TEMPLATES_ROUTE = '/api/workflows/templates'
export const RECEIPTS_ROUTE = '/api/workflows/receipts'

/** Default and maximum page sizes. */
export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200
/** Every method the carrier must dispatch so a non-GET reaches the 405 guard. */
export const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

/** One exact Fetch route of the Host Connection service. */
export interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: 'buffered'
  fetch(request: Request): Promise<Response>
}

/** The live-session lookup the routes resolve the workspace through. */
export interface SessionLookup {
  get(id: string): { readonly session: unknown } | undefined
}

export interface WorkflowApiServices {
  readonly agents: SessionLookup
  readonly workingDirectory: { get(session: unknown): string }
  readonly journal: Journal
  readonly healthFor: (workspace: string) => WorkflowHealth
  /** The requesting session's own last observed event time, if any. */
  readonly lastEventAtFor?: (session: string) => number | undefined
  readonly triggers: readonly Trigger[]
  /** The approved definitions of one workspace. */
  readonly definitionsFor?: (workspace: string) => readonly Definition[]
  /** The editor's list view: source and revision per definition. */
  readonly definitionEntriesFor?: (workspace: string) => Promise<{
    readonly definitions: readonly {
      readonly id: string
      readonly name: string
      readonly version: number
      readonly source: 'shipped' | 'local'
      readonly revision: string | null
    }[]
    readonly errors?: readonly string[]
  }>
  /** One definition document with the revision a write must send back. */
  readonly definitionDocumentFor?: (
    workspace: string,
    id: string,
  ) => Promise<
    | { readonly definition: unknown; readonly revision: string | null; readonly source: string }
    | undefined
  >
  /** The authenticated receipts of one workspace. */
  readonly receiptsFor?: (workspace: string) => Promise<readonly WorkflowReceipt[]>
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers })
}

function bounded(message: unknown): string {
  return String(message instanceof Error ? message.message : message).slice(0, 300)
}

function invalidMethod(method: string): Response {
  return json(405, { error: `method ${method} is not allowed; use GET` }, { allow: 'GET' })
}

function parsePaging(url: URL): { cursor: number; limit: number } | { response: Response } {
  const cursorRaw = url.searchParams.get('cursor')
  const limitRaw = url.searchParams.get('limit')
  const cursor = cursorRaw === null || cursorRaw === '' ? 0 : Number(cursorRaw)
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    return { response: json(400, { error: 'cursor must be a non-negative integer' }) }
  }
  const limit = limitRaw === null || limitRaw === '' ? DEFAULT_LIMIT : Number(limitRaw)
  if (!Number.isSafeInteger(limit) || limit < 1) {
    return { response: json(400, { error: 'limit must be a positive integer' }) }
  }
  return { cursor, limit: Math.min(limit, MAX_LIMIT) }
}

type Resolved =
  | { readonly workspace: string; readonly session: string }
  | { readonly response: Response }

function resolveSession(services: WorkflowApiServices, request: Request): Resolved {
  const session = new URL(request.url).searchParams.get('session')
  if (session === null || session === '') {
    return { response: json(400, { error: 'a session id is required' }) }
  }
  const agent = services.agents.get(session)
  if (agent === undefined) {
    return { response: json(400, { error: 'the session is not live in this host' }) }
  }
  try {
    return { workspace: services.workingDirectory.get(agent.session), session }
  } catch {
    return { response: json(400, { error: 'the session workspace is unavailable' }) }
  }
}

/** Every stored evaluation for a session: last one wins, plus the counters. */
async function lastEvaluations(
  services: WorkflowApiServices,
  workspace: string,
  session: string,
): Promise<
  Map<string, { at: number; matched: boolean; reason: string; matchedCount: number; total: number }>
> {
  const latest = new Map<
    string,
    { at: number; matched: boolean; reason: string; matchedCount: number; total: number }
  >()
  let cursor = 0
  for (;;) {
    const page = await services.journal.read(workspace, session, cursor, MAX_LIMIT)
    for (const record of page.records) {
      for (const evaluation of record.triggers ?? []) {
        const previous = latest.get(evaluation.id)
        latest.set(evaluation.id, {
          at: record.at,
          matched: evaluation.matched,
          reason: evaluation.reason,
          matchedCount: (previous?.matchedCount ?? 0) + (evaluation.matched ? 1 : 0),
          total: (previous?.total ?? 0) + 1,
        })
      }
    }
    if (page.next === undefined) break
    cursor = Number(page.next)
  }
  return latest
}

async function sessionHasMatched(
  services: WorkflowApiServices,
  workspace: string,
  session: string,
): Promise<boolean> {
  let cursor = 0
  for (;;) {
    const page = await services.journal.read(workspace, session, cursor, MAX_LIMIT)
    for (const record of page.records) {
      if (
        record.triggers?.some((evaluation: TriggerEvaluationRecord) => evaluation.matched) === true
      ) {
        return true
      }
    }
    if (page.next === undefined) return false
    cursor = Number(page.next)
  }
}

function route(path: string, handler: (request: Request) => Promise<Response>): FetchRoute {
  return {
    path,
    methods: [...ROUTE_METHODS],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method !== 'GET') return invalidMethod(request.method)
      try {
        return await handler(request)
      } catch (error) {
        return json(500, { error: `the workflows read failed: ${bounded(error)}` })
      }
    },
  }
}

/** Only settled record evidence inside the workspace may be served. */
const EVIDENCE_PREFIXES = [
  '.dsh/delegation/',
  '.dsh/work-checkpoints/',
  '.dsh/workflows/runs/',
  'openspec/changes/',
]

async function readEvidence(workspace: string, path: string): Promise<Response> {
  if (!EVIDENCE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return json(400, { error: 'the evidence path is not a record path' })
  }
  try {
    const root = await realpath(workspace)
    const target = await realpath(join(workspace, path))
    if (!isInside(root, target)) {
      return json(400, { error: 'the evidence path is outside the workspace' })
    }
    const canonicalPath = relative(root, target).replaceAll('\\', '/')
    if (!EVIDENCE_PREFIXES.some((prefix) => canonicalPath.startsWith(prefix))) {
      return json(400, { error: 'the evidence path is not a record path' })
    }
    const info = await stat(target)
    if (!info.isFile() || info.size > 256 * 1024)
      return json(404, { error: 'the evidence file is missing' })
    const text = await readFile(target, 'utf8')
    let body: string
    try {
      body = JSON.stringify(redactValue(JSON.parse(text)), null, 2)
    } catch {
      body = redactPayload(text)
    }
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  } catch {
    return json(404, { error: 'the evidence file is missing' })
  }
}

/** Build the read-only routes. */
export function createWorkflowRoutes(services: WorkflowApiServices): FetchRoute[] {
  return [
    route(EVIDENCE_ROUTE, async (request) => {
      const resolved = resolveSession(services, request)
      if ('response' in resolved) return resolved.response
      const path = new URL(request.url).searchParams.get('path')
      if (path === null || path === '') return json(400, { error: 'an evidence path is required' })
      return readEvidence(resolved.workspace, path)
    }),
    route(EVENTS_ROUTE, async (request) => {
      const resolved = resolveSession(services, request)
      if ('response' in resolved) return resolved.response
      const paging = parsePaging(new URL(request.url))
      if ('response' in paging) return paging.response
      const page = await services.journal.read(
        resolved.workspace,
        resolved.session,
        paging.cursor,
        paging.limit,
      )
      return json(200, {
        session: resolved.session,
        events: page.records,
        ...(page.next === undefined ? {} : { next: page.next }),
      })
    }),
    route(RUNS_ROUTE, async (request) => {
      const resolved = resolveSession(services, request)
      if ('response' in resolved) return resolved.response
      const url = new URL(request.url)
      const paging = parsePaging(url)
      if ('response' in paging) return paging.response
      const source = url.searchParams.get('source')
      const definition = url.searchParams.get('definition')
      const order = url.searchParams.get('order')
      const run = url.searchParams.get('run')
      let runs: RunView[] = await sessionRuns(resolved.workspace, resolved.session)
      if (source !== null && source !== '') runs = runs.filter((entry) => entry.source === source)
      if (definition !== null && definition !== '') {
        runs = runs.filter((entry) => entry.definition?.id === definition)
      }
      // Resolved after attribution, so another session's run is never returned.
      if (run !== null && run !== '') runs = runs.filter((entry) => entry.id === run)
      if (url.searchParams.get('stats') === '1') {
        const buckets = new Map<string, Record<string, number>>()
        for (const entry of runs) {
          if (entry.definition === undefined) continue
          const bucket =
            entry.lifecycle ??
            (entry.status === 'done'
              ? 'completed'
              : entry.status === 'failed'
                ? 'failed'
                : 'running')
          const counts = buckets.get(entry.definition.id) ?? {
            completed: 0,
            failed: 0,
            cancelled: 0,
            interrupted: 0,
            running: 0,
            blocked: 0,
            total: 0,
          }
          counts[bucket] = (counts[bucket] ?? 0) + 1
          counts.total = (counts.total ?? 0) + 1
          buckets.set(entry.definition.id, counts)
        }
        return json(200, {
          session: resolved.session,
          stats: { definitions: Object.fromEntries(buckets) },
        })
      }
      // A definition-filtered request is the editor overlay: newest first.
      if ((definition ?? '') !== '' || order === 'newest') runs = [...runs].reverse()
      const start = Math.min(paging.cursor, runs.length)
      const page = runs.slice(start, start + paging.limit)
      const next = start + page.length < runs.length ? String(start + page.length) : undefined
      return json(200, {
        session: resolved.session,
        runs: page,
        ...(next === undefined ? {} : { next }),
      })
    }),
    route(TRIGGERS_ROUTE, async (request) => {
      const resolved = resolveSession(services, request)
      if ('response' in resolved) return resolved.response
      const evaluations = await lastEvaluations(services, resolved.workspace, resolved.session)
      const definitions = services.definitionsFor?.(resolved.workspace) ?? []
      const lastOf = (id: string): { at: number; matched: boolean; reason: string } | undefined => {
        const evaluation = evaluations.get(id)
        return evaluation === undefined
          ? undefined
          : { at: evaluation.at, matched: evaluation.matched, reason: evaluation.reason }
      }
      const countsOf = (id: string): { matched: number; total: number } => {
        const evaluation = evaluations.get(id)
        return { matched: evaluation?.matchedCount ?? 0, total: evaluation?.total ?? 0 }
      }
      return json(200, {
        session: resolved.session,
        triggers: [
          ...services.triggers.map((trigger) => {
            const last = lastOf(trigger.id)
            return {
              id: trigger.id,
              event: trigger.event,
              filter: trigger.filter,
              mode: trigger.mode,
              dedupe: trigger.dedupe,
              ...(last === undefined ? {} : { last }),
              counts: countsOf(trigger.id),
            }
          }),
          ...definitions.map((definition) => {
            const id = `definition:${definition.id}`
            const last = lastOf(id)
            return {
              id,
              event: definition.trigger.kind,
              filter: definition.trigger.match,
              mode: definition.trigger.mode,
              dedupe: definition.trigger.dedupe,
              source: 'workflow-definition',
              ...(last === undefined ? {} : { last }),
              counts: countsOf(id),
            }
          }),
        ],
      })
    }),
    route(DEFINITIONS_ROUTE, async (request) => {
      const resolved = resolveSession(services, request)
      if ('response' in resolved) return resolved.response
      const id = new URL(request.url).searchParams.get('id')
      if (id !== null && id !== '') {
        // The carrier matches exact paths only, so one document is addressed by
        // `id` on the literal definitions route rather than a path segment.
        if (services.definitionDocumentFor === undefined) {
          return json(404, { error: 'the definition does not exist' })
        }
        try {
          const document = await services.definitionDocumentFor(resolved.workspace, id)
          if (document === undefined) return json(404, { error: 'the definition does not exist' })
          return json(200, document)
        } catch (error) {
          return json(400, { errors: [{ path: '', message: bounded(error) }] })
        }
      }
      const definitions = services.definitionsFor?.(resolved.workspace) ?? []
      const byId = new Map(definitions.map((definition) => [definition.id, definition]))
      const entries = await services.definitionEntriesFor?.(resolved.workspace)
      const summary = (definition: Definition): Record<string, unknown> => ({
        id: definition.id,
        name: definition.name,
        version: definition.version,
        trigger: definition.trigger,
        risk: definition.settings.risk,
        allowModelStart: definition.settings.allowModelStart,
        gateOwnership: definition.settings.gateOwnership,
        steps: definition.steps.map((step) => ({
          id: step.id,
          title: step.title,
          executor: step.executor,
          ownership: step.ownership ?? 'own',
          blockTurnClose: step.blockTurnClose === true,
        })),
      })
      const rows: Record<string, unknown>[] = []
      const covered = new Set<string>()
      // The editor store is authoritative for the list: a local definition
      // created after the runtime cache loaded must still appear.
      for (const entry of entries?.definitions ?? []) {
        covered.add(entry.id)
        let definition = byId.get(entry.id)
        if (definition === undefined && services.definitionDocumentFor !== undefined) {
          const document = await services
            .definitionDocumentFor(resolved.workspace, entry.id)
            .catch(() => undefined)
          definition = document?.definition as Definition | undefined
        }
        rows.push({
          ...(definition === undefined
            ? { id: entry.id, name: entry.name, version: entry.version }
            : summary(definition)),
          source: entry.source,
          revision: entry.revision,
        })
      }
      for (const definition of definitions) {
        if (!covered.has(definition.id)) rows.push(summary(definition))
      }
      return json(200, {
        session: resolved.session,
        definitions: rows,
        ...(entries?.errors === undefined || entries.errors.length === 0
          ? {}
          : { errors: entries.errors }),
      })
    }),
    route(TEMPLATES_ROUTE, async (request) => {
      const resolved = resolveSession(services, request)
      if ('response' in resolved) return resolved.response
      return json(200, {
        session: resolved.session,
        templates: loadShippedDefinitions().map((definition) => ({
          id: definition.id,
          name: definition.name,
          version: definition.version,
          stepCount: definition.steps.length,
          source: 'shipped',
          revision: null,
          definition,
        })),
      })
    }),
    route(RECEIPTS_ROUTE, async (request) => {
      const resolved = resolveSession(services, request)
      if ('response' in resolved) return resolved.response
      const receipts = (await services.receiptsFor?.(resolved.workspace)) ?? []
      return json(200, {
        session: resolved.session,
        receipts: receipts.map((receipt) => ({
          change: receipt.change,
          kind: receipt.kind,
          digest: receipt.digest,
          issuedAt: receipt.issuedAt,
        })),
      })
    }),
    route(HEALTH_ROUTE, async (request) => {
      const resolved = resolveSession(services, request)
      if ('response' in resolved) return resolved.response
      const health = services.healthFor(resolved.workspace)
      const matched = await sessionHasMatched(services, resolved.workspace, resolved.session)
      const lastEventAt = services.lastEventAtFor?.(resolved.session)
      const { lastEventAt: _workspaceLastEvent, ...snapshot } = health.snapshot()
      return json(200, {
        session: resolved.session,
        state: health.stateFor(matched, true),
        ...snapshot,
        ...(lastEventAt === undefined ? {} : { lastEventAt }),
      })
    }),
  ]
}

/** Register the routes on the host's Fetch carrier; absent means no API. */
export function registerWorkflowRoutes(
  ctx: {
    get(name: string): unknown
    effect(callback: () => () => void): () => void
  },
  services: WorkflowApiServices,
): boolean {
  const connection = ctx.get('connection') as
    | { readonly fetch?: { register(route: FetchRoute): () => void } }
    | undefined
  const register = connection?.fetch?.register
  if (typeof register !== 'function') return false
  for (const routeDefinition of createWorkflowRoutes(services)) {
    ctx.effect(() => register(routeDefinition))
  }
  return true
}
