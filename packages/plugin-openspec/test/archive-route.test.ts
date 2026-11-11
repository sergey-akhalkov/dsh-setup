import { afterEach, describe, expect, it, vi } from 'vitest'

const { listMock, archiveMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  archiveMock: vi.fn(),
}))

// The route's two host-side effects are replaced: the CLI runner is faked and
// the CLI read is answered directly, so no process and no workspace are needed.
vi.mock('../src/host/change-list.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/change-list.ts')>()
  return { ...actual, listWorkspaceChanges: listMock, archiveWorkspaceChange: archiveMock }
})

import { ARCHIVE_ROUTE, registerChangeRoute } from '../src/host/index.ts'

interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  fetch(request: Request): Promise<Response>
}

interface GateDecision {
  readonly ok: true
}

interface Gate {
  authorizeAndCheck(
    workspace: string,
    change: string,
  ): Promise<GateDecision | { readonly ok: false; readonly reason: string }>
}

interface Harness {
  readonly route: FetchRoute
  readonly gateCalls: Array<{ workspace: string; change: string }>
}

function listOf(
  changes: Array<{ name: string; completedTasks: number; totalTasks: number }>,
  archived: Array<{ name: string }> = [],
): unknown {
  const rows = changes.map((row) => ({
    ...row,
    status: row.completedTasks === row.totalTasks ? 'complete' : 'in-progress',
    modified: null,
    archived: false,
    phase: row.completedTasks === row.totalTasks ? 'complete' : 'applying',
    archivedAt: null,
    summary: null,
    requirementCount: 0,
    deltaCapabilities: [],
    commit: null,
    presence: { proposal: true, design: true, tasks: true, specs: 0 },
  }))
  return {
    changes: rows,
    archived: archived.map((row) => ({
      ...row,
      completedTasks: row.name.includes('add-auth') ? 2 : 0,
      totalTasks: 2,
      status: 'complete',
      modified: null,
      archived: true,
      phase: 'archived',
      archivedAt: '2026-11-11',
      summary: null,
      requirementCount: 0,
      deltaCapabilities: [],
      commit: null,
      presence: { proposal: true, design: true, tasks: true, specs: 0 },
    })),
    counts: { active: rows.length, archived: archived.length, capabilities: 0 },
  }
}

function harness(workspaces: ReadonlyMap<string, string>, gate?: Gate): Harness {
  let route: FetchRoute | undefined
  const gateCalls: Array<{ workspace: string; change: string }> = []
  const services: Record<string, unknown> = {
    connection: {
      fetch: {
        register(value: FetchRoute) {
          if (value.path === ARCHIVE_ROUTE) route = value
          return () => {}
        },
      },
    },
    agents: {
      get(id: string) {
        const directory = workspaces.get(id)
        return directory === undefined ? undefined : { session: { directory } }
      },
    },
    workingDirectory: {
      get(session: { directory: string }) {
        return session.directory
      },
    },
  }
  if (gate !== undefined) {
    services.workflowsArchiveGate = {
      authorizeAndCheck: (workspace: string, change: string) => {
        gateCalls.push({ workspace, change })
        return gate.authorizeAndCheck(workspace, change)
      },
    }
  }
  const ctx = {
    get(name: string) {
      return services[name]
    },
    effect(callback: () => () => void) {
      return callback()
    },
  }
  registerChangeRoute(ctx as never)
  if (route === undefined) throw new Error('archive route not registered')
  return { route, gateCalls }
}

function archiveRequest(body: unknown): Request {
  return new Request(`http://localhost${ARCHIVE_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>
}

afterEach(() => {
  listMock.mockReset()
  archiveMock.mockReset()
})

describe('openspec archive route', () => {
  it('registers a POST route on the carrier-neutral fetch registry', () => {
    const target = harness(new Map())
    expect(target.route).toMatchObject({
      path: ARCHIVE_ROUTE,
      methods: ['POST'],
      requestBody: 'buffered',
    })
  })

  it('archives a complete change after the engine gate allows and returns the new archived name', async () => {
    listMock
      .mockResolvedValueOnce(listOf([{ name: 'add-auth', completedTasks: 2, totalTasks: 2 }]))
      .mockResolvedValueOnce(listOf([], []))
      .mockResolvedValueOnce(listOf([], [{ name: '2026-11-11-add-auth' }]))
    archiveMock.mockResolvedValue(undefined)
    const gate: Gate = { authorizeAndCheck: async () => ({ ok: true }) }
    const target = harness(new Map([['s1', '/workspace']]), gate)
    const response = await target.route.fetch(archiveRequest({ session: 's1', name: 'add-auth' }))
    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({ ok: true, name: '2026-11-11-add-auth' })
    expect(target.gateCalls).toEqual([{ workspace: '/workspace', change: 'add-auth' }])
    expect(archiveMock).toHaveBeenCalledWith('/workspace', 'add-auth')
  })

  it('returns the newly added row when a same-name change is already archived', async () => {
    const old = { name: '2026-10-27-add-auth' }
    listMock
      .mockResolvedValueOnce(
        listOf([{ name: 'add-auth', completedTasks: 2, totalTasks: 2 }], [old]),
      )
      .mockResolvedValueOnce(listOf([], [old]))
      .mockResolvedValueOnce(listOf([], [old, { name: '2026-11-11-add-auth' }]))
    archiveMock.mockResolvedValue(undefined)
    const target = harness(new Map([['s1', '/workspace']]))
    const response = await target.route.fetch(archiveRequest({ session: 's1', name: 'add-auth' }))
    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({ ok: true, name: '2026-11-11-add-auth' })
  })

  it('reports success without an address when the confirmation read fails', async () => {
    listMock
      .mockResolvedValueOnce(listOf([{ name: 'add-auth', completedTasks: 2, totalTasks: 2 }]))
      .mockResolvedValueOnce(listOf([], []))
      .mockRejectedValueOnce(new Error('the confirmation list failed'))
    archiveMock.mockResolvedValue(undefined)
    const target = harness(new Map([['s1', '/workspace']]))
    const response = await target.route.fetch(archiveRequest({ session: 's1', name: 'add-auth' }))
    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({ ok: true })
  })

  it('refuses an incomplete change without calling the gate or the CLI', async () => {
    listMock.mockResolvedValueOnce(listOf([{ name: 'add-auth', completedTasks: 1, totalTasks: 2 }]))
    const gate: Gate = { authorizeAndCheck: async () => ({ ok: true }) }
    const target = harness(new Map([['s1', '/workspace']]), gate)
    const response = await target.route.fetch(archiveRequest({ session: 's1', name: 'add-auth' }))
    expect(response.status).toBe(409)
    expect(String((await bodyOf(response)).error)).toMatch(/not complete/u)
    expect(target.gateCalls).toEqual([])
    expect(archiveMock).not.toHaveBeenCalled()
  })

  it('returns the gate refusal and archives nothing', async () => {
    listMock.mockResolvedValueOnce(listOf([{ name: 'add-auth', completedTasks: 2, totalTasks: 2 }]))
    const reason =
      'the archive of "add-auth" is refused: the current whole-spec PASS record is stale'
    const gate: Gate = { authorizeAndCheck: async () => ({ ok: false, reason }) }
    const target = harness(new Map([['s1', '/workspace']]), gate)
    const response = await target.route.fetch(archiveRequest({ session: 's1', name: 'add-auth' }))
    expect(response.status).toBe(409)
    expect((await bodyOf(response)).error).toBe(reason)
    expect(archiveMock).not.toHaveBeenCalled()
  })

  it('proceeds with the task check only when the engine gate is absent', async () => {
    listMock
      .mockResolvedValueOnce(listOf([{ name: 'add-auth', completedTasks: 2, totalTasks: 2 }]))
      .mockResolvedValueOnce(listOf([], []))
      .mockResolvedValueOnce(listOf([], [{ name: '2026-11-11-add-auth' }]))
    archiveMock.mockResolvedValue(undefined)
    const target = harness(new Map([['s1', '/workspace']]))
    const response = await target.route.fetch(archiveRequest({ session: 's1', name: 'add-auth' }))
    expect(response.status).toBe(200)
    expect(await bodyOf(response)).toEqual({ ok: true, name: '2026-11-11-add-auth' })
    expect(archiveMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a session that is not live in this host', async () => {
    const target = harness(new Map())
    const response = await target.route.fetch(
      archiveRequest({ session: 'missing', name: 'add-auth' }),
    )
    expect(response.status).toBe(400)
    expect((await bodyOf(response)).error).toMatch(/not live/u)
    expect(listMock).not.toHaveBeenCalled()
    expect(archiveMock).not.toHaveBeenCalled()
  })
})
