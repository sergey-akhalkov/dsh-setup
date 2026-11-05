import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  artifactReadMessage,
  CAPABILITIES_MALFORMED_MESSAGE,
  listWorkspaceCapabilities,
  OUTSIDE_ROOT_MESSAGE,
  readWorkspaceCapability,
  readWorkspaceChange,
  unreportedCapabilityMessage,
  unreportedChangeMessage,
} from '../src/host/change-detail.ts'
import { NO_LOCAL_ROOT_MESSAGE } from '../src/host/change-list.ts'
import {
  CHANGE_DETAIL_ROUTE,
  CHANGES_ROUTE,
  registerChangeRoute,
  SPECS_ROUTE,
} from '../src/host/index.ts'

const { spawnMock, execFileMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  execFileMock: vi.fn(),
}))
vi.mock('node:child_process', () => ({ spawn: spawnMock, execFile: execFileMock }))

class FakeStream extends EventEmitter {
  setEncoding(): void {}
}

class FakeChild extends EventEmitter {
  readonly pid = 4242
  readonly stdout = new FakeStream()
  readonly stderr = new FakeStream()
}

const temporary: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporary.push(directory)
  return directory
}

function workspace(withRoot = true): string {
  const directory = temporaryDirectory('openspec-workspace-')
  if (withRoot) mkdirSync(join(directory, 'openspec'))
  return directory
}

/** A PATH that resolves the CLI under either platform branch. */
function cliPath(): string {
  const directory = temporaryDirectory('openspec-bin-')
  writeFileSync(join(directory, 'openspec'), '')
  writeFileSync(join(directory, 'openspec.CMD'), '')
  return directory
}

interface ChangeFixture {
  readonly proposal?: string
  readonly design?: string
  readonly tasks?: string
  readonly specs?: Readonly<Record<string, string>>
}

/** Write one change's artifacts under the workspace's own OpenSpec root. */
function writeChange(directory: string, name: string, fixture: ChangeFixture): string {
  const changeDirectory = join(directory, 'openspec', 'changes', name)
  mkdirSync(changeDirectory, { recursive: true })
  for (const artifact of ['proposal', 'design', 'tasks'] as const) {
    const body = fixture[artifact]
    if (body !== undefined) writeFileSync(join(changeDirectory, `${artifact}.md`), body)
  }
  for (const [capability, body] of Object.entries(fixture.specs ?? {})) {
    mkdirSync(join(changeDirectory, 'specs', capability), { recursive: true })
    writeFileSync(join(changeDirectory, 'specs', capability, 'spec.md'), body)
  }
  return changeDirectory
}

/** Link one directory portably; a Windows junction needs no admin privilege. */
function directoryLink(target: string, path: string): void {
  symlinkSync(target, path, process.platform === 'win32' ? 'junction' : 'dir')
}

/** Deterministic mtimes for the last-modified assertions. */
const AT_10 = '2026-11-05T10:00:00.000Z'
const AT_11 = '2026-11-05T11:00:00.000Z'
const AT_12 = '2026-11-05T12:00:00.000Z'
const AT_13 = '2026-11-05T13:00:00.000Z'
const AT_14 = '2026-11-05T14:00:00.000Z'

/** Stamp one existing fixture file with a deterministic mtime. */
function setModified(path: string, iso: string): void {
  const time = new Date(iso)
  utimesSync(path, time, time)
}

interface CliRow {
  readonly name: string
  readonly completedTasks: number
  readonly totalTasks: number
  readonly status: 'no-tasks' | 'complete' | 'in-progress'
}

function row(name: string): CliRow {
  return { name, completedTasks: 1, totalTasks: 2, status: 'in-progress' }
}

function changeListOutput(root: string, rows: readonly CliRow[]): string {
  return JSON.stringify({
    changes: rows.map((entry) => ({ ...entry, lastModified: '2026-11-05T00:00:00.000Z' })),
    root: { path: root, source: 'nearest' },
  })
}

function specsOutput(root: string, specs: unknown): string {
  return JSON.stringify({ specs, root: { path: root, source: 'nearest' } })
}

function spawnChild(): FakeChild {
  const child = new FakeChild()
  spawnMock.mockReturnValue(child)
  return child
}

function complete(child: FakeChild, code: number | null, stdout = '', stderr = ''): void {
  if (stdout !== '') child.stdout.emit('data', stdout)
  if (stderr !== '') child.stderr.emit('data', stderr)
  child.emit('close', code)
}

/** Answer the most recently spawned CLI call. */
function answer(stdout: string, code = 0, stderr = ''): void {
  const child = spawnMock.mock.results.at(-1)?.value as FakeChild | undefined
  if (child === undefined) throw new Error('the CLI was not spawned')
  complete(child, code, stdout, stderr)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PATH', cliPath())
  vi.stubEnv('PATHEXT', '.CMD')
})

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('openspec change detail', () => {
  it('reads every artifact, both delta specs and the CLI progress', async () => {
    const cwd = workspace()
    const directory = writeChange(cwd, 'add-auth', {
      proposal: '# Why\n',
      design: '# Design\n',
      tasks: '- [x] one\n',
      specs: { zeta: '# Zeta\n', alpha: '# Alpha\n' },
    })
    setModified(join(directory, 'proposal.md'), AT_10)
    setModified(join(directory, 'design.md'), AT_11)
    setModified(join(directory, 'tasks.md'), AT_12)
    setModified(join(directory, 'specs', 'alpha', 'spec.md'), AT_13)
    setModified(join(directory, 'specs', 'zeta', 'spec.md'), AT_14)
    spawnChild()
    const pending = readWorkspaceChange(cwd, 'add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    await expect(pending).resolves.toEqual({
      name: 'add-auth',
      status: 'in-progress',
      completedTasks: 1,
      totalTasks: 2,
      presence: { proposal: true, design: true, tasks: true, specs: 2 },
      modified: AT_14,
      artifacts: { proposal: '# Why\n', design: '# Design\n', tasks: '- [x] one\n' },
      specs: [
        { capability: 'alpha', body: '# Alpha\n', modified: AT_13 },
        { capability: 'zeta', body: '# Zeta\n', modified: AT_14 },
      ],
    })
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd })
  })

  it('reports a change without a design as null, not an empty document', async () => {
    const cwd = workspace()
    const directory = writeChange(cwd, 'add-auth', { proposal: '# Why\n', tasks: '- [ ] one\n' })
    setModified(join(directory, 'proposal.md'), AT_10)
    setModified(join(directory, 'tasks.md'), AT_12)
    spawnChild()
    const pending = readWorkspaceChange(cwd, 'add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    await expect(pending).resolves.toMatchObject({
      presence: { proposal: true, design: false, tasks: true, specs: 0 },
      modified: AT_12,
      artifacts: { proposal: '# Why\n', design: null, tasks: '- [ ] one\n' },
      specs: [],
    })
  })

  it('reports a null modified time when the change carries no artifact files', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', {})
    spawnChild()
    const pending = readWorkspaceChange(cwd, 'add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    await expect(pending).resolves.toMatchObject({
      presence: { proposal: false, design: false, tasks: false, specs: 0 },
      modified: null,
      artifacts: { proposal: null, design: null, tasks: null },
      specs: [],
    })
  })

  it('refuses a change the CLI does not report without reading its files', async () => {
    const cwd = workspace()
    // A directory where proposal.md would be: reading it would raise EISDIR.
    mkdirSync(join(cwd, 'openspec', 'changes', 'add-auth', 'proposal.md'), { recursive: true })
    spawnChild()
    const pending = readWorkspaceChange(cwd, 'add-auth')
    answer(changeListOutput(cwd, [row('other-change')]))
    await expect(pending).rejects.toThrow(unreportedChangeMessage('add-auth'))
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('refuses a traversal-shaped name even when the CLI reports it', async () => {
    const cwd = workspace()
    spawnChild()
    const pending = readWorkspaceChange(cwd, '../add-auth')
    answer(changeListOutput(cwd, [row('../add-auth')]))
    await expect(pending).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('refuses a change directory that links outside the OpenSpec root', async () => {
    const cwd = workspace()
    const outside = temporaryDirectory('openspec-outside-')
    writeFileSync(join(outside, 'proposal.md'), '# Outside\n')
    mkdirSync(join(cwd, 'openspec', 'changes'), { recursive: true })
    directoryLink(outside, join(cwd, 'openspec', 'changes', 'add-auth'))
    spawnChild()
    const pending = readWorkspaceChange(cwd, 'add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    await expect(pending).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('refuses an artifact that links outside the OpenSpec root', async () => {
    const cwd = workspace()
    const outside = temporaryDirectory('openspec-outside-')
    const changeDirectory = writeChange(cwd, 'add-auth', { tasks: '- [ ] one\n' })
    directoryLink(outside, join(changeDirectory, 'proposal.md'))
    spawnChild()
    const pending = readWorkspaceChange(cwd, 'add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    await expect(pending).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('refuses a delta spec that links outside the OpenSpec root', async () => {
    const cwd = workspace()
    const outside = temporaryDirectory('openspec-outside-')
    writeFileSync(join(outside, 'spec.md'), '# Outside\n')
    const changeDirectory = writeChange(cwd, 'add-auth', { proposal: '# Why\n' })
    mkdirSync(join(changeDirectory, 'specs'), { recursive: true })
    directoryLink(outside, join(changeDirectory, 'specs', 'alpha'))
    spawnChild()
    const pending = readWorkspaceChange(cwd, 'add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    await expect(pending).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('reports an unreadable artifact with its path and cause', async () => {
    const cwd = workspace()
    const directory = join(cwd, 'openspec', 'changes', 'add-auth')
    mkdirSync(join(directory, 'proposal.md'), { recursive: true })
    writeFileSync(join(directory, 'tasks.md'), '- [ ] one\n')
    spawnChild()
    const pending = readWorkspaceChange(cwd, 'add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    const error = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain(artifactReadMessage(join(directory, 'proposal.md'), 'EISDIR'))
    expect(message).toContain('proposal.md')
  })
})

describe('openspec capability reads', () => {
  it('lists the capability inventory the CLI reports', async () => {
    const cwd = workspace()
    spawnChild()
    const pending = listWorkspaceCapabilities(cwd)
    answer(
      specsOutput(cwd, [
        { id: 'openspec-panel', requirementCount: 4 },
        { id: 'alpha', requirementCount: 0 },
      ]),
    )
    await expect(pending).resolves.toEqual([
      { id: 'openspec-panel', requirementCount: 4 },
      { id: 'alpha', requirementCount: 0 },
    ])
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd })
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'openspec', 'list', '--specs', '--json']
        : ['list', '--specs', '--json'],
    )
  })

  it('reads one capability spec body', async () => {
    const cwd = workspace()
    mkdirSync(join(cwd, 'openspec', 'specs', 'openspec-panel'), { recursive: true })
    const file = join(cwd, 'openspec', 'specs', 'openspec-panel', 'spec.md')
    writeFileSync(file, '# Panel\n')
    setModified(file, AT_13)
    spawnChild()
    const pending = readWorkspaceCapability(cwd, 'openspec-panel')
    answer(specsOutput(cwd, [{ id: 'openspec-panel', requirementCount: 2 }]))
    await expect(pending).resolves.toEqual({
      id: 'openspec-panel',
      requirementCount: 2,
      body: '# Panel\n',
      modified: AT_13,
    })
  })

  it('refuses an id the CLI does not report without reading its spec', async () => {
    const cwd = workspace()
    // A directory where spec.md would be: reading it would raise EISDIR.
    mkdirSync(join(cwd, 'openspec', 'specs', 'wanted', 'spec.md'), { recursive: true })
    spawnChild()
    const pending = readWorkspaceCapability(cwd, 'wanted')
    answer(specsOutput(cwd, [{ id: 'other', requirementCount: 1 }]))
    await expect(pending).rejects.toThrow(unreportedCapabilityMessage('wanted'))
  })

  it('refuses a capability spec that links outside the OpenSpec root', async () => {
    const cwd = workspace()
    const outside = temporaryDirectory('openspec-outside-')
    writeFileSync(join(outside, 'spec.md'), '# Outside\n')
    mkdirSync(join(cwd, 'openspec', 'specs'), { recursive: true })
    directoryLink(outside, join(cwd, 'openspec', 'specs', 'openspec-panel'))
    spawnChild()
    const pending = readWorkspaceCapability(cwd, 'openspec-panel')
    answer(specsOutput(cwd, [{ id: 'openspec-panel', requirementCount: 1 }]))
    await expect(pending).rejects.toThrow(OUTSIDE_ROOT_MESSAGE)
  })

  it('refuses a workspace without a local root before running the CLI', async () => {
    await expect(listWorkspaceCapabilities(workspace(false))).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    await expect(readWorkspaceCapability(workspace(false), 'openspec-panel')).rejects.toThrow(
      NO_LOCAL_ROOT_MESSAGE,
    )
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('refuses an ancestor root the CLI reports', async () => {
    const cwd = workspace()
    const ancestor = temporaryDirectory('openspec-ancestor-')
    spawnChild()
    const pending = listWorkspaceCapabilities(cwd)
    answer(specsOutput(ancestor, []))
    await expect(pending).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
  })

  it('refuses malformed inventory output', async () => {
    const cwd = workspace()
    const malformed: unknown[] = [
      'not-an-array',
      [{ id: 'x' }],
      [{ id: '', requirementCount: 1 }],
      [{ id: 'x', requirementCount: -1 }],
      [{ id: 'x', requirementCount: 1.5 }],
    ]
    for (const specs of malformed) {
      spawnChild()
      const pending = listWorkspaceCapabilities(cwd)
      answer(specsOutput(cwd, specs))
      await expect(pending).rejects.toThrow(CAPABILITIES_MALFORMED_MESSAGE)
    }
  })

  it('reports a reported capability whose spec file cannot be read', async () => {
    const cwd = workspace()
    spawnChild()
    const pending = readWorkspaceCapability(cwd, 'ghost')
    answer(specsOutput(cwd, [{ id: 'ghost', requirementCount: 1 }]))
    const error = await pending.catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    const message = (error as Error).message
    expect(message).toContain('Could not read the OpenSpec capability spec')
    expect(message).toContain(join(cwd, 'openspec', 'specs', 'ghost', 'spec.md'))
  })
})

interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  fetch(request: Request): Promise<Response>
}

interface RouteHarness {
  readonly routes: Map<string, FetchRoute>
  request(path: string, query: string): Promise<Response>
}

/** A desktop shell host has `connection.fetch` but no `webServer` service. */
function routeHarness(workspaces: ReadonlyMap<string, string>): RouteHarness {
  const routes = new Map<string, FetchRoute>()
  const services: Record<string, unknown> = {
    connection: {
      fetch: {
        register(route: FetchRoute) {
          routes.set(route.path, route)
          return () => {
            routes.delete(route.path)
          }
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
    webServer: {
      register() {
        throw new Error('the OpenSpec read routes must not depend on webServer')
      },
    },
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
  return {
    routes,
    request(path, query) {
      const route = routes.get(path)
      if (route === undefined) throw new Error(`route ${path} not registered`)
      return route.fetch(new Request(`http://localhost${path}${query}`, { method: 'GET' }))
    },
  }
}

describe('openspec read routes', () => {
  it('registers the three exact GET routes on the desktop shell carrier', () => {
    const harness = routeHarness(new Map())
    expect([...harness.routes.keys()]).toEqual([CHANGES_ROUTE, CHANGE_DETAIL_ROUTE, SPECS_ROUTE])
    for (const route of harness.routes.values()) {
      expect(route).toMatchObject({ methods: ['GET'], requestBody: 'buffered' })
    }
  })

  it('extends the change list with each row artifact presence', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', { proposal: '# Why\n', specs: { 'openspec-panel': '# Panel\n' } })
    const harness = routeHarness(new Map([['s1', cwd]]))
    spawnChild()
    const pending = harness.request(CHANGES_ROUTE, '?session=s1')
    answer(changeListOutput(cwd, [row('add-auth')]))
    const response = await pending
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      changes: [
        {
          name: 'add-auth',
          completedTasks: 1,
          totalTasks: 2,
          status: 'in-progress',
          presence: { proposal: true, design: false, tasks: false, specs: 1 },
        },
      ],
    })
  })

  it('serves one change with every artifact body and its delta specs', async () => {
    const cwd = workspace()
    const directory = writeChange(cwd, 'add-auth', {
      proposal: '# Why\n',
      specs: { alpha: '# Alpha\n' },
    })
    setModified(join(directory, 'proposal.md'), AT_10)
    setModified(join(directory, 'specs', 'alpha', 'spec.md'), AT_13)
    const harness = routeHarness(new Map([['s1', cwd]]))
    spawnChild()
    const pending = harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    const response = await pending
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      change: {
        name: 'add-auth',
        status: 'in-progress',
        completedTasks: 1,
        totalTasks: 2,
        presence: { proposal: true, design: false, tasks: false, specs: 1 },
        modified: AT_13,
        artifacts: { proposal: '# Why\n', design: null, tasks: null },
        specs: [{ capability: 'alpha', body: '# Alpha\n', modified: AT_13 }],
      },
    })
  })

  it('serves an edited artifact body and its newer winning modified time on a re-read', async () => {
    const cwd = workspace()
    const directory = writeChange(cwd, 'add-auth', {
      proposal: '# First\n',
      specs: { alpha: '# Alpha\n' },
    })
    const proposalFile = join(directory, 'proposal.md')
    setModified(proposalFile, AT_10)
    setModified(join(directory, 'specs', 'alpha', 'spec.md'), AT_13)
    const harness = routeHarness(new Map([['s1', cwd]]))

    spawnChild()
    const firstPending = harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    const firstResponse = await firstPending
    expect(firstResponse.status).toBe(200)
    const first = (await firstResponse.json()) as {
      change: { modified: string; artifacts: { proposal: string | null } }
    }
    expect(first.change.artifacts.proposal).toBe('# First\n')
    expect(first.change.modified).toBe(AT_13)

    writeFileSync(proposalFile, '# Second\n')
    setModified(proposalFile, AT_14)
    spawnChild()
    const secondPending = harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    const secondResponse = await secondPending
    expect(secondResponse.status).toBe(200)
    const second = (await secondResponse.json()) as {
      change: {
        modified: string
        artifacts: { proposal: string | null }
        specs: { capability: string; body: string; modified: string }[]
      }
    }
    expect(second.change.artifacts.proposal).toBe('# Second\n')
    expect(second.change.modified).toBe(AT_14)
    expect(second.change.specs).toEqual([
      { capability: 'alpha', body: '# Alpha\n', modified: AT_13 },
    ])
  })

  it('serves the capability inventory when no id is given', async () => {
    const cwd = workspace()
    const harness = routeHarness(new Map([['s1', cwd]]))
    spawnChild()
    const pending = harness.request(SPECS_ROUTE, '?session=s1')
    answer(specsOutput(cwd, [{ id: 'openspec-panel', requirementCount: 4 }]))
    const response = await pending
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      capabilities: [{ id: 'openspec-panel', requirementCount: 4 }],
    })
  })

  it('serves one capability spec when an id is given', async () => {
    const cwd = workspace()
    mkdirSync(join(cwd, 'openspec', 'specs', 'openspec-panel'), { recursive: true })
    const file = join(cwd, 'openspec', 'specs', 'openspec-panel', 'spec.md')
    writeFileSync(file, '# Panel\n')
    setModified(file, AT_11)
    const harness = routeHarness(new Map([['s1', cwd]]))
    spawnChild()
    const pending = harness.request(SPECS_ROUTE, '?session=s1&id=openspec-panel')
    answer(specsOutput(cwd, [{ id: 'openspec-panel', requirementCount: 2 }]))
    const response = await pending
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      capability: {
        id: 'openspec-panel',
        requirementCount: 2,
        body: '# Panel\n',
        modified: AT_11,
      },
    })
  })

  it('requires a live session on every route without running the CLI', async () => {
    const harness = routeHarness(new Map())
    for (const path of [CHANGES_ROUTE, CHANGE_DETAIL_ROUTE, SPECS_ROUTE]) {
      const missing = await harness.request(path, '')
      expect(missing.status).toBe(400)
      await expect(missing.json()).resolves.toEqual({ error: 'A session id is required.' })
      const unknown = await harness.request(path, '?session=missing')
      expect(unknown.status).toBe(400)
      await expect(unknown.json()).resolves.toEqual({
        error: 'The session is not live in this host.',
      })
    }
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('rejects a missing change name and a blank capability id', async () => {
    const cwd = workspace()
    const harness = routeHarness(new Map([['s1', cwd]]))
    const change = await harness.request(CHANGE_DETAIL_ROUTE, '?session=s1')
    expect(change.status).toBe(400)
    await expect(change.json()).resolves.toEqual({ error: 'A change name is required.' })
    const capability = await harness.request(SPECS_ROUTE, '?session=s1&id=')
    expect(capability.status).toBe(400)
    await expect(capability.json()).resolves.toEqual({ error: 'A capability id is required.' })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('returns 400 for an item the CLI does not report', async () => {
    const cwd = workspace()
    const harness = routeHarness(new Map([['s1', cwd]]))
    spawnChild()
    const changePending = harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    answer(changeListOutput(cwd, [row('other-change')]))
    const change = await changePending
    expect(change.status).toBe(400)
    await expect(change.json()).resolves.toEqual({ error: unreportedChangeMessage('add-auth') })

    spawnChild()
    const capabilityPending = harness.request(SPECS_ROUTE, '?session=s1&id=missing')
    answer(specsOutput(cwd, []))
    const capability = await capabilityPending
    expect(capability.status).toBe(400)
    await expect(capability.json()).resolves.toEqual({
      error: unreportedCapabilityMessage('missing'),
    })
  })

  it('returns the CLI failure as a readable 500 cause', async () => {
    const cwd = workspace()
    const harness = routeHarness(new Map([['s1', cwd]]))
    spawnChild()
    const changePending = harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    answer('', 1, 'not a valid workspace')
    const change = await changePending
    expect(change.status).toBe(500)
    await expect(change.json()).resolves.toEqual({
      error: '`openspec list` failed: not a valid workspace',
    })

    spawnChild()
    const inventoryPending = harness.request(SPECS_ROUTE, '?session=s1')
    answer('', 1, 'inventory unavailable')
    const inventory = await inventoryPending
    expect(inventory.status).toBe(500)
    await expect(inventory.json()).resolves.toEqual({
      error: '`openspec list --specs` failed: inventory unavailable',
    })
  })

  it('returns an unreadable artifact cause as a 500', async () => {
    const cwd = workspace()
    const directory = join(cwd, 'openspec', 'changes', 'add-auth')
    mkdirSync(join(directory, 'proposal.md'), { recursive: true })
    const harness = routeHarness(new Map([['s1', cwd]]))
    spawnChild()
    const pending = harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    answer(changeListOutput(cwd, [row('add-auth')]))
    const response = await pending
    expect(response.status).toBe(500)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('Could not read the OpenSpec artifact')
    expect(body.error).toContain('proposal.md')
  })

  it('reports a missing local root on the specs route without running the CLI', async () => {
    const cwd = workspace(false)
    const harness = routeHarness(new Map([['s1', cwd]]))
    const response = await harness.request(SPECS_ROUTE, '?session=s1')
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: NO_LOCAL_ROOT_MESSAGE })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('scopes each session to its own workspace', async () => {
    const first = workspace()
    writeChange(first, 'add-auth', { proposal: '# First\n' })
    const second = workspace()
    writeChange(second, 'add-auth', { proposal: '# Second\n' })
    const harness = routeHarness(
      new Map([
        ['s1', first],
        ['s2', second],
      ]),
    )
    spawnChild()
    const one = harness.request(CHANGE_DETAIL_ROUTE, '?session=s1&name=add-auth')
    answer(changeListOutput(first, [row('add-auth')]))
    const firstResponse = await one
    expect(firstResponse.status).toBe(200)
    const firstBody = (await firstResponse.json()) as {
      change: { artifacts: { proposal: string } }
    }
    expect(firstBody.change.artifacts.proposal).toBe('# First\n')

    spawnChild()
    const two = harness.request(CHANGE_DETAIL_ROUTE, '?session=s2&name=add-auth')
    answer(changeListOutput(second, [row('add-auth')]))
    const secondResponse = await two
    expect(secondResponse.status).toBe(200)
    const secondBody = (await secondResponse.json()) as {
      change: { artifacts: { proposal: string } }
    }
    expect(secondBody.change.artifacts.proposal).toBe('# Second\n')
    expect(spawnMock.mock.calls.map((call) => call[2])).toMatchObject([
      { cwd: first },
      { cwd: second },
    ])
  })

  it('ignores request text other than the session and the item name', async () => {
    const cwd = workspace()
    writeChange(cwd, 'add-auth', { proposal: '# Why\n' })
    const harness = routeHarness(new Map([['s1', cwd]]))
    spawnChild()
    const pending = harness.request(
      CHANGE_DETAIL_ROUTE,
      '?session=s1&name=add-auth&path=/etc/passwd&name=../evil',
    )
    answer(changeListOutput(cwd, [row('add-auth')]))
    const response = await pending
    expect(response.status).toBe(200)
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd })
  })

  it('waits for late Host services and registers the three routes when they appear', () => {
    const registered: FetchRoute[] = []
    const disposers: (() => void)[] = []
    const services: Record<string, unknown> = {
      connection: {
        fetch: {
          register(route: FetchRoute) {
            registered.push(route)
            return () => {
              const index = registered.indexOf(route)
              if (index !== -1) registered.splice(index, 1)
            }
          },
        },
      },
      agents: { get: () => undefined },
      workingDirectory: { get: () => '' },
    }
    const serviceCtx = {
      get(name: string) {
        return services[name]
      },
      effect(callback: () => () => void) {
        const dispose = callback()
        disposers.push(dispose)
        return dispose
      },
    }
    let deps: readonly string[] | undefined
    let runInjected: ((serviceCtx: unknown) => void) | undefined
    const ctx = {
      get() {
        return undefined
      },
      inject(received: readonly string[], callback: (serviceCtx: unknown) => void) {
        deps = received
        runInjected = callback
        return { dispose() {} }
      },
    }

    registerChangeRoute(ctx as never)
    expect(registered).toEqual([])
    expect(deps).toEqual(['connection', 'agents', 'workingDirectory'])
    expect(runInjected).toBeDefined()

    runInjected?.(serviceCtx)
    expect(registered.map((route) => route.path)).toEqual([
      CHANGES_ROUTE,
      CHANGE_DETAIL_ROUTE,
      SPECS_ROUTE,
    ])
    for (const route of registered) {
      expect(route).toMatchObject({ methods: ['GET'], requestBody: 'buffered' })
    }
    for (const dispose of disposers) dispose()
    expect(registered).toEqual([])
  })

  it('registers immediately and never injects when the Host services already exist', () => {
    const registered: string[] = []
    let injectCalled = false
    const services: Record<string, unknown> = {
      connection: {
        fetch: {
          register(route: FetchRoute) {
            registered.push(route.path)
            return () => {}
          },
        },
      },
      agents: { get: () => undefined },
      workingDirectory: { get: () => '' },
    }
    const ctx = {
      get(name: string) {
        return services[name]
      },
      effect(callback: () => () => void) {
        return callback()
      },
      inject() {
        injectCalled = true
      },
    }
    registerChangeRoute(ctx as never)
    expect(registered).toEqual([CHANGES_ROUTE, CHANGE_DETAIL_ROUTE, SPECS_ROUTE])
    expect(injectCalled).toBe(false)
  })

  it('registers nothing on a host without the connection fetch registry', () => {
    const registered: string[] = []
    const partial = {
      get(name: string) {
        if (name !== 'connection') return undefined
        return {
          fetch: {
            register(route: FetchRoute) {
              registered.push(route.path)
            },
          },
        }
      },
    }
    expect(() => registerChangeRoute(partial as never)).not.toThrow()
    expect(registered).toEqual([])
    expect(() => registerChangeRoute({ get: () => undefined } as never)).not.toThrow()
  })
})
