import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createWorkflowRoutes,
  EVENTS_ROUTE,
  type FetchRoute,
  HEALTH_ROUTE,
  RUNS_ROUTE,
  registerWorkflowRoutes,
  TRIGGERS_ROUTE,
  type WorkflowApiServices,
} from '../src/host/api.ts'
import { WorkflowHealth } from '../src/host/health.ts'
import { Journal, type JournalInput } from '../src/host/journal.ts'
import { loadCatalog } from '../src/host/triggers.ts'

interface Setup {
  readonly routes: FetchRoute[]
  readonly services: WorkflowApiServices
  readonly journal: Journal
  readonly health: WorkflowHealth
  readonly workspaceOne: string
  readonly workspaceTwo: string
}

const TEMP_DIRECTORIES: string[] = []

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }),
  )
})

async function setup(): Promise<Setup> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-api-'))
  TEMP_DIRECTORIES.push(root)
  const workspaceOne = join(root, 'one')
  const workspaceTwo = join(root, 'two')
  const sessions = new Map<string, { session: { id: string }; workspace: string }>([
    ['s1', { session: { id: 's1' }, workspace: workspaceOne }],
    ['s2', { session: { id: 's2' }, workspace: workspaceOne }],
    ['s3', { session: { id: 's3' }, workspace: workspaceTwo }],
  ])
  const journal = new Journal()
  const health = new WorkflowHealth({
    root: join(workspaceOne, '.dsh', 'workflows'),
    triggerCount: 9,
    probe: async () => true,
    write: async () => {},
  })
  health.setListenerCount(5)
  const services: WorkflowApiServices = {
    agents: {
      get: (id) => {
        const entry = sessions.get(id)
        return entry === undefined ? undefined : { session: entry.session }
      },
    },
    workingDirectory: {
      get: (session) => {
        for (const entry of sessions.values()) if (entry.session === session) return entry.workspace
        return workspaceOne
      },
    },
    journal,
    healthFor: () => health,
    triggers: loadCatalog(),
  }
  return {
    routes: createWorkflowRoutes(services),
    services,
    journal,
    health,
    workspaceOne,
    workspaceTwo,
  }
}

function input(overrides: Partial<JournalInput> = {}): JournalInput {
  return {
    at: 1_762_500_000_000,
    session: 's1',
    kind: 'tools/result',
    subject: 'read',
    summary: 'read ok; output omitted',
    bytes: 5,
    truncated: false,
    ...overrides,
  }
}

async function request(
  setupValue: Setup,
  path: string,
  options: { session?: string; query?: string; method?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const route = setupValue.routes.find((candidate) => candidate.path === path)
  if (route === undefined) throw new Error(`no route for ${path}`)
  const search = new URLSearchParams()
  if (options.session !== undefined) search.set('session', options.session)
  const query = options.query === undefined ? '' : `&${options.query}`
  const response = await route.fetch(
    new Request(`http://localhost${path}?${search.toString()}${query}`, {
      method: options.method ?? 'GET',
    }),
  )
  return { status: response.status, body: await response.json() }
}

describe('workflows read API', () => {
  it('registers four buffered Fetch routes with a GET guard through the carrier', async () => {
    const value = await setup()
    const paths = value.routes.map((route) => route.path)
    expect(paths).toEqual([EVENTS_ROUTE, RUNS_ROUTE, TRIGGERS_ROUTE, HEALTH_ROUTE])
    for (const route of value.routes) {
      expect(route.methods).toEqual(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
      expect(route.requestBody).toBe('buffered')
    }
    const registered: FetchRoute[] = []
    const ctx = {
      get: (name: string) =>
        name === 'connection'
          ? {
              fetch: {
                register: (route: FetchRoute) => {
                  registered.push(route)
                  return () => {}
                },
              },
            }
          : undefined,
      effect: (callback: () => () => void) => {
        callback()
        return () => {}
      },
    }
    expect(registerWorkflowRoutes(ctx, value.services)).toBe(true)
    expect(registered.map((route) => route.path)).toEqual(paths)
    expect(
      registerWorkflowRoutes({ get: () => undefined, effect: () => () => {} }, value.services),
    ).toBe(false)
  })

  it('admits owner requests and refuses unauthenticated, forbidden, and non-GET requests', async () => {
    const value = await setup()
    const target = value.routes.find((route) => route.path === EVENTS_ROUTE)
    if (target === undefined) throw new Error('the events route is missing')
    const original = target.fetch.bind(target)
    const handler = vi.fn(original)
    target.fetch = handler
    const dispatch = async (
      kind: 'owner' | 'unauthenticated' | 'forbidden',
      method = 'GET',
    ): Promise<Response> => {
      if (kind === 'unauthenticated')
        return new Response('{"error":"unauthorized"}', { status: 401 })
      if (kind === 'forbidden') return new Response('{"error":"forbidden"}', { status: 403 })
      if (!target.methods.includes(method)) return new Response('not found', { status: 404 })
      return target.fetch(new Request(`http://localhost${EVENTS_ROUTE}?session=s1`, { method }))
    }
    for (const carrier of ['desktop', 'browser']) {
      expect(carrier).toBeTruthy()
      handler.mockClear()
      const admitted = await dispatch('owner')
      expect(admitted.status).toBe(200)
      expect(handler).toHaveBeenCalledTimes(1)
      expect((await dispatch('unauthenticated')).status).toBe(401)
      expect((await dispatch('forbidden')).status).toBe(403)
      expect(handler).toHaveBeenCalledTimes(1)
      const refused = await dispatch('owner', 'POST')
      expect(refused.status).toBe(405)
      expect(refused.headers.get('allow')).toBe('GET')
      expect(handler).toHaveBeenCalledTimes(2)
    }
  })

  it('serves the response matrix over the browser HTTP and desktop in-process transports', async () => {
    const value = await setup()
    const dispatch = async (request: Request): Promise<Response> => {
      if (request.headers.get('origin') === 'http://evil.example') {
        return new Response('{"error":"forbidden"}', { status: 403 })
      }
      if (request.headers.get('authorization') !== 'Bearer owner') {
        return new Response('{"error":"unauthorized"}', { status: 401 })
      }
      const route = value.routes.find(
        (candidate) => candidate.path === new URL(request.url).pathname,
      )
      if (route === undefined || !route.methods.includes(request.method)) {
        return new Response('{"error":"not found"}', { status: 404 })
      }
      return route.fetch(request)
    }
    const url = `http://127.0.0.1${EVENTS_ROUTE}?session=s1`
    const server = createServer(async (incoming, outgoing) => {
      const response = await dispatch(
        new Request(new URL(incoming.url ?? '/', 'http://127.0.0.1'), {
          method: incoming.method,
          headers: incoming.headers as Record<string, string>,
        }),
      )
      outgoing.statusCode = response.status
      for (const [name, header] of response.headers) outgoing.setHeader(name, header)
      outgoing.end(Buffer.from(await response.arrayBuffer()))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('no server address')
    try {
      const browser = (method: string, headers: Record<string, string>): Promise<Response> =>
        fetch(`http://127.0.0.1:${String(address.port)}${EVENTS_ROUTE}?session=s1`, {
          method,
          headers,
        })
      const desktop = (method: string, headers: Record<string, string>): Promise<Response> =>
        dispatch(new Request(url, { method, headers }))
      for (const transport of ['desktop', 'browser'] as const) {
        const call = transport === 'desktop' ? desktop : browser
        expect((await call('GET', { authorization: 'Bearer owner' })).status).toBe(200)
        expect((await call('GET', {})).status).toBe(401)
        expect(
          (await call('GET', { authorization: 'Bearer owner', origin: 'http://evil.example' }))
            .status,
        ).toBe(403)
        const refused = await call('POST', { authorization: 'Bearer owner' })
        expect(refused.status).toBe(405)
        expect(refused.headers.get('allow')).toBe('GET')
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    const throwing = createWorkflowRoutes({
      ...value.services,
      healthFor: () => {
        throw new Error('x'.repeat(1000))
      },
    }).find((route) => route.path === HEALTH_ROUTE)
    if (throwing === undefined) throw new Error('the health route is missing')
    const bounded = await throwing.fetch(
      new Request(`http://localhost${HEALTH_ROUTE}?session=s1`, {
        headers: { authorization: 'Bearer owner' },
      }),
    )
    expect(bounded.status).toBe(500)
    const body = (await bounded.json()) as { error: string }
    expect(body.error.length).toBeLessThanOrEqual(330)
  })

  it('clamps an oversized limit to 200 and returns the remainder by cursor', async () => {
    const value = await setup()
    for (let index = 0; index < 250; index += 1) {
      const { record } = value.journal.record(input({ at: index, turn: index }))
      await value.journal.append(value.workspaceOne, record)
    }
    const first = await request(value, EVENTS_ROUTE, { session: 's1', query: 'limit=500' })
    expect(first.status).toBe(200)
    const firstBody = first.body as { events: unknown[]; next?: string }
    expect(firstBody.events).toHaveLength(200)
    expect(firstBody.next).toBe('200')
    const second = await request(value, EVENTS_ROUTE, {
      session: 's1',
      query: 'cursor=200&limit=500',
    })
    expect(second.status).toBe(200)
    const secondBody = second.body as { events: unknown[]; next?: string }
    expect(secondBody.events).toHaveLength(50)
    expect(secondBody.next).toBeUndefined()
  })

  it('pages runs with the default size and a cursor', async () => {
    const value = await setup()
    const runDirectory = join(value.workspaceOne, '.dsh', 'delegation', 'runs')
    await mkdir(runDirectory, { recursive: true })
    for (let index = 0; index < 60; index += 1) {
      const id = `run-mw6abcde-${index.toString(16).padStart(8, '0')}`
      await writeFile(
        join(runDirectory, `${id}.json`),
        JSON.stringify({
          id,
          rule: 'task-review',
          change: 'add-x',
          key: 'k',
          identity: 'i',
          state: 'running',
          record: `.dsh/delegation/task-review/add-x/tasks/${id}.json`,
          startedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        }),
        'utf8',
      )
      const { record } = value.journal.record(
        input({
          at: index,
          subject: 'delegate',
          summary: `delegate review started; run: ${id}`,
        }),
      )
      await value.journal.append(value.workspaceOne, record)
    }
    const first = await request(value, RUNS_ROUTE, { session: 's1' })
    expect(first.status).toBe(200)
    const firstBody = first.body as { runs: unknown[]; next?: string }
    expect(firstBody.runs).toHaveLength(50)
    expect(firstBody.next).toBe('50')
    const second = await request(value, RUNS_ROUTE, { session: 's1', query: 'cursor=50' })
    const secondBody = second.body as { runs: unknown[]; next?: string }
    expect(secondBody.runs).toHaveLength(10)
    expect(secondBody.next).toBeUndefined()
  })

  it('pages a long session with a clamped limit and a next cursor', async () => {
    const value = await setup()
    for (let index = 0; index < 120; index += 1) {
      const { record } = value.journal.record(input({ at: index, turn: index }))
      await value.journal.append(value.workspaceOne, record)
    }
    const first = await request(value, EVENTS_ROUTE, { session: 's1' })
    expect(first.status).toBe(200)
    const firstBody = first.body as { events: unknown[]; next?: string }
    expect(firstBody.events).toHaveLength(50)
    expect(firstBody.next).toBe('50')
    const second = await request(value, EVENTS_ROUTE, {
      session: 's1',
      query: `limit=500&cursor=${firstBody.next ?? ''}`,
    })
    const secondBody = second.body as { events: unknown[] }
    expect(secondBody.events).toHaveLength(70)
    const clamped = await request(value, EVENTS_ROUTE, { session: 's1', query: 'limit=500' })
    expect((clamped.body as { events: unknown[] }).events).toHaveLength(120)
    expect(
      (await request(value, EVENTS_ROUTE, { session: 's1', query: 'cursor=abc' })).status,
    ).toBe(400)
    expect((await request(value, EVENTS_ROUTE, { session: 's1', query: 'limit=0' })).status).toBe(
      400,
    )
  })

  it('serves runs, triggers, and health with the session selector', async () => {
    const value = await setup()
    const runs = await request(value, RUNS_ROUTE, { session: 's1' })
    expect(runs.status).toBe(200)
    expect((runs.body as { runs: unknown[] }).runs).toEqual([])
    const triggers = await request(value, TRIGGERS_ROUTE, { session: 's1' })
    expect(triggers.status).toBe(200)
    expect((triggers.body as { triggers: unknown[] }).triggers).toHaveLength(9)
    const health = await request(value, HEALTH_ROUTE, { session: 's1' })
    expect(health.status).toBe(200)
    expect(health.body).toMatchObject({ state: 'waiting', session: 's1', listenerCount: 5 })
    expect((await request(value, TRIGGERS_ROUTE, {})).status).toBe(400)
    expect((await request(value, HEALTH_ROUTE, {})).status).toBe(400)
  })

  it('serves the last trigger evaluation from the session journal', async () => {
    const value = await setup()
    const { record } = value.journal.record(
      input({
        at: 10,
        triggers: [
          { id: 'agent-turn-start', matched: true, reason: 'would-fire' },
          {
            id: 'delegate-result',
            matched: false,
            reason: 'filter-mismatch',
            path: 'read',
            filter: 'tool: delegate',
          },
        ],
      }),
    )
    await value.journal.append(value.workspaceOne, record)
    const result = await request(value, TRIGGERS_ROUTE, { session: 's1' })
    const body = result.body as {
      triggers: Array<{ id: string; last?: { at: number; matched: boolean; reason: string } }>
    }
    expect(body.triggers.find((trigger) => trigger.id === 'agent-turn-start')?.last).toEqual({
      at: 10,
      matched: true,
      reason: 'would-fire',
    })
    expect(body.triggers.find((trigger) => trigger.id === 'delegate-result')?.last?.reason).toBe(
      'filter-mismatch',
    )
  })

  it('scopes events, runs, and health to the requesting session and workspace', async () => {
    const value = await setup()
    for (const session of ['s1', 's2']) {
      const { record } = value.journal.record(input({ session, turn: 1 }))
      await value.journal.append(value.workspaceOne, record)
    }
    const other = value.journal.record(input({ session: 's3' }))
    await value.journal.append(value.workspaceTwo, other.record)
    const one = await request(value, EVENTS_ROUTE, { session: 's1' })
    const two = await request(value, EVENTS_ROUTE, { session: 's2' })
    const three = await request(value, EVENTS_ROUTE, { session: 's3' })
    expect((one.body as { events: unknown[] }).events).toHaveLength(1)
    expect((two.body as { events: unknown[] }).events).toHaveLength(1)
    expect((three.body as { events: unknown[] }).events).toHaveLength(1)
    expect((await request(value, EVENTS_ROUTE, { session: 'unknown' })).status).toBe(400)
  })

  it('rejects a non-GET and bounds an internal error body', async () => {
    const value = await setup()
    const post = await request(value, EVENTS_ROUTE, { session: 's1', method: 'POST' })
    expect(post.status).toBe(405)
    const throwing = createWorkflowRoutes({
      ...value.services,
      journal: {
        read: async () => {
          throw new Error('x'.repeat(1000))
        },
      } as unknown as Journal,
    })
    const route = throwing.find((candidate) => candidate.path === EVENTS_ROUTE)
    const response = await route?.fetch(new Request(`http://localhost${EVENTS_ROUTE}?session=s1`))
    expect(response?.status).toBe(500)
    const text = JSON.stringify(await response?.json())
    expect(text.length).toBeLessThan(400)
  })
})
