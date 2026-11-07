import type { WorkflowHealth } from './health.js'
import type { Journal, TriggerEvaluationRecord } from './journal.js'
import { type RunView, sessionRuns } from './projection.js'
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

/** Every stored evaluation for a session, keyed by trigger, last one wins. */
async function lastEvaluations(
  services: WorkflowApiServices,
  workspace: string,
  session: string,
): Promise<Map<string, { at: number; matched: boolean; reason: string }>> {
  const latest = new Map<string, { at: number; matched: boolean; reason: string }>()
  let cursor = 0
  for (;;) {
    const page = await services.journal.read(workspace, session, cursor, MAX_LIMIT)
    for (const record of page.records) {
      for (const evaluation of record.triggers ?? []) {
        latest.set(evaluation.id, {
          at: record.at,
          matched: evaluation.matched,
          reason: evaluation.reason,
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

/** Build the four read-only routes. */
export function createWorkflowRoutes(services: WorkflowApiServices): FetchRoute[] {
  return [
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
      const paging = parsePaging(new URL(request.url))
      if ('response' in paging) return paging.response
      const runs: RunView[] = await sessionRuns(resolved.workspace, resolved.session)
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
      return json(200, {
        session: resolved.session,
        triggers: services.triggers.map((trigger) => ({
          id: trigger.id,
          event: trigger.event,
          filter: trigger.filter,
          mode: trigger.mode,
          dedupe: trigger.dedupe,
          ...(evaluations.get(trigger.id) === undefined
            ? {}
            : { last: evaluations.get(trigger.id) }),
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
