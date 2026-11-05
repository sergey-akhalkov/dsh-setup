import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cliOnPath,
  LIST_TIMEOUT_MS,
  listWorkspaceChanges,
  MALFORMED_MESSAGE,
  MISSING_CLI_MESSAGE,
  NO_LOCAL_ROOT_MESSAGE,
  TIMEOUT_MESSAGE,
} from '../src/host/change-list.ts'
import { CHANGES_ROUTE, registerChangeRoute } from '../src/host/index.ts'

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

function workspace(withRoot: boolean): string {
  const directory = temporaryDirectory('openspec-workspace-')
  if (withRoot) mkdirSync(join(directory, 'openspec'))
  return directory
}

/** A PATH that resolves the CLI under either platform branch. */
function cliPath(): string {
  const directory = temporaryDirectory('openspec-bin-')
  writeFileSync(join(directory, 'openspec'), '')
  // Match the stubbed PATHEXT casing so discovery works on case-sensitive filesystems.
  writeFileSync(join(directory, 'openspec.CMD'), '')
  return directory
}

function output(root: string, changes: unknown[] = []): string {
  return JSON.stringify({ changes, root: { path: root, source: 'nearest' } })
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

/** Force one platform branch for a test and restore it even when the test throws. */
async function withPlatform(platform: NodeJS.Platform, run: () => Promise<void>): Promise<void> {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
  try {
    await run()
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PATH', cliPath())
  vi.stubEnv('PATHEXT', '.CMD')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('openspec change list', () => {
  it('lists the changes the CLI reports for the workspace root', async () => {
    const cwd = workspace(true)
    spawnChild()
    const pending = listWorkspaceChanges(cwd)
    const child = spawnMock.mock.results[0]?.value as FakeChild
    complete(
      child,
      0,
      output(cwd, [
        {
          name: 'add-auth',
          completedTasks: 3,
          totalTasks: 14,
          lastModified: '2026-11-05T00:00:00.000Z',
          status: 'in-progress',
        },
      ]),
    )
    await expect(pending).resolves.toEqual([
      { name: 'add-auth', completedTasks: 3, totalTasks: 14, status: 'in-progress' },
    ])
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd })
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(
      process.platform === 'win32'
        ? ['/d', '/s', '/c', 'openspec', 'list', '--json']
        : ['list', '--json'],
    )
  })

  it('refuses a workspace without its own root before running the CLI', async () => {
    await expect(listWorkspaceChanges(workspace(false))).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('refuses an ancestor root reported by the CLI', async () => {
    const cwd = workspace(true)
    const ancestor = temporaryDirectory('openspec-ancestor-')
    spawnChild()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    const child = spawnMock.mock.results[0]?.value as FakeChild
    complete(child, 0, output(ancestor))
    await rejection
  })

  it('refuses a declared or default store root', async () => {
    const cwd = workspace(true)
    const store = temporaryDirectory('openspec-store-')
    spawnChild()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    const child = spawnMock.mock.results[0]?.value as FakeChild
    complete(child, 0, JSON.stringify({ changes: [], root: { path: store, source: 'store' } }))
    await rejection
  })

  it('refuses a null root', async () => {
    const cwd = workspace(true)
    spawnChild()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    const child = spawnMock.mock.results[0]?.value as FakeChild
    complete(child, 0, JSON.stringify({ changes: [], root: null }))
    await rejection
  })

  it('maps a missing CLI to the prerequisite error', async () => {
    vi.stubEnv('PATH', temporaryDirectory('openspec-empty-bin-'))
    expect(cliOnPath()).toBe(false)
    await expect(listWorkspaceChanges(workspace(true))).rejects.toThrow(MISSING_CLI_MESSAGE)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('maps a non-zero exit to its stderr', async () => {
    const cwd = workspace(true)
    spawnChild()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(
      '`openspec list` failed: not a valid workspace',
    )
    const child = spawnMock.mock.results[0]?.value as FakeChild
    complete(child, 1, '', 'not a valid workspace')
    await rejection
  })

  it('maps a non-zero exit that carries a null root to the no-root error', async () => {
    const cwd = workspace(true)
    spawnChild()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(NO_LOCAL_ROOT_MESSAGE)
    const child = spawnMock.mock.results[0]?.value as FakeChild
    complete(child, 1, JSON.stringify({ changes: [], root: null }))
    await rejection
  })

  it('maps malformed JSON and malformed changes to the readable error', async () => {
    const cwd = workspace(true)
    spawnChild()
    const firstRejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(MALFORMED_MESSAGE)
    const first = spawnMock.mock.results[0]?.value as FakeChild
    complete(first, 0, 'not json')
    await firstRejection

    spawnChild()
    const secondRejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(MALFORMED_MESSAGE)
    const second = spawnMock.mock.results[1]?.value as FakeChild
    complete(second, 0, output(cwd, [{ name: 'x', completedTasks: 1 }]))
    await secondRejection
  })

  it('times out and awaits the whole process tree kill', async () => {
    vi.useFakeTimers()
    execFileMock.mockImplementation(
      (_file: string, _args: string[], _options: unknown, callback: (error: null) => void) => {
        callback(null)
      },
    )
    const cwd = workspace(true)
    const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
    spawnChild()
    const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(TIMEOUT_MESSAGE)
    await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
    await rejection
    if (process.platform === 'win32') {
      expect(execFileMock).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '4242', '/T', '/F'],
        { windowsHide: true },
        expect.any(Function),
      )
    } else {
      expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    }
    kill.mockRestore()
  })

  it('keeps waiting while a hanging descendant holds the inherited pipes open', async () => {
    vi.useFakeTimers()
    await withPlatform('win32', async () => {
      execFileMock.mockImplementation(
        (_file: string, _args: string[], _options: unknown, callback: (error: null) => void) => {
          callback(null)
        },
      )
      const cwd = workspace(true)
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
      spawnChild()
      const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(TIMEOUT_MESSAGE)
      // The shim and its Node child are still running; only the pipes stay open.
      await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
      await rejection
      expect(execFileMock).toHaveBeenCalledWith(
        'taskkill',
        ['/pid', '4242', '/T', '/F'],
        { windowsHide: true },
        expect.any(Function),
      )
      expect(kill).not.toHaveBeenCalled()
      kill.mockRestore()
    })
  })

  it('does not taskkill a Windows PID whose process already exited', async () => {
    vi.useFakeTimers()
    await withPlatform('win32', async () => {
      execFileMock.mockImplementation(
        (_file: string, _args: string[], _options: unknown, callback: (error: null) => void) => {
          callback(null)
        },
      )
      const cwd = workspace(true)
      const child = spawnChild()
      const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(
        /could not be confirmed terminated/,
      )
      // The shim exited and its PID may be reused; never target it again.
      child.emit('exit', 0, null)
      await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
      await rejection
      expect(execFileMock).not.toHaveBeenCalled()
    })
  })

  it('reports a process tree it could not confirm terminated', async () => {
    vi.useFakeTimers()
    await withPlatform('win32', async () => {
      execFileMock.mockImplementation(
        (_file: string, _args: string[], _options: unknown, callback: (error: Error) => void) => {
          callback(new Error('denied'))
        },
      )
      const cwd = workspace(true)
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
      spawnChild()
      const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(
        /could not be confirmed terminated/,
      )
      await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
      await rejection
      kill.mockRestore()
    })
  })

  it('detaches the POSIX call and kills its process group', async () => {
    vi.useFakeTimers()
    await withPlatform('linux', async () => {
      const cwd = workspace(true)
      const kill = vi.spyOn(process, 'kill').mockReturnValue(true)
      spawnChild()
      const rejection = expect(listWorkspaceChanges(cwd)).rejects.toThrow(TIMEOUT_MESSAGE)
      await vi.advanceTimersByTimeAsync(LIST_TIMEOUT_MS)
      await rejection
      expect(spawnMock.mock.calls.at(-1)?.[2]).toMatchObject({ detached: true })
      expect(kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
      expect(execFileMock).not.toHaveBeenCalled()
      kill.mockRestore()
    })
  })
})

interface FetchRoute {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  fetch(request: Request): Promise<Response>
}

interface RouteHarness {
  readonly route: FetchRoute
}

/** A desktop shell host has `connection.fetch` but no `webServer` service. */
function routeHarness(workspaces: ReadonlyMap<string, string>): RouteHarness {
  let route: FetchRoute | undefined
  const services: Record<string, unknown> = {
    connection: {
      fetch: {
        register(value: FetchRoute) {
          route = value
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
    webServer: {
      register() {
        throw new Error('the change list route must not depend on webServer')
      },
    },
  }
  const ctx = {
    get(name: string) {
      return services[name]
    },
  }
  registerChangeRoute(ctx as never)
  if (route === undefined) throw new Error('route not registered')
  return { route }
}

async function answer(
  harness: RouteHarness,
  session: string | undefined,
  workspaceAt?: string,
): Promise<Response> {
  const query = session === undefined ? '' : `?session=${session}`
  const pending = harness.route.fetch(
    new Request(`http://localhost${CHANGES_ROUTE}${query}`, { method: 'GET' }),
  )
  const child = spawnMock.mock.results.at(-1)?.value as FakeChild | undefined
  if (workspaceAt !== undefined && child !== undefined) {
    complete(
      child,
      0,
      output(workspaceAt, [
        { name: 'add-auth', completedTasks: 3, totalTasks: 14, status: 'in-progress' },
      ]),
    )
  }
  return pending
}

describe('change list route', () => {
  it('registers an /api fetch route on the desktop shell carrier', () => {
    const harness = routeHarness(new Map())
    expect(harness.route).toMatchObject({
      path: CHANGES_ROUTE,
      methods: ['GET'],
      requestBody: 'buffered',
    })
  })

  it('scopes each session to its own workspace', async () => {
    const first = workspace(true)
    const second = workspace(true)
    const harness = routeHarness(
      new Map([
        ['s1', first],
        ['s2', second],
      ]),
    )
    const one = await answer(harness, 's1', first)
    expect(one.status).toBe(200)
    await expect(one.json()).resolves.toEqual({
      changes: [{ name: 'add-auth', completedTasks: 3, totalTasks: 14, status: 'in-progress' }],
    })
    const two = await answer(harness, 's2', second)
    expect(two.status).toBe(200)
    expect(spawnMock.mock.calls.map((call) => call[2])).toMatchObject([
      { cwd: first },
      { cwd: second },
    ])
  })

  it('rejects an unknown session without running the CLI', async () => {
    const harness = routeHarness(new Map())
    const response = await answer(harness, 'missing')
    expect(response.status).toBe(400)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('requires a session id', async () => {
    const harness = routeHarness(new Map())
    const response = await answer(harness, undefined)
    expect(response.status).toBe(400)
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('reports the no-root error when the workspace has no local root', async () => {
    const child = workspace(false)
    const harness = routeHarness(new Map([['s1', child]]))
    const response = await answer(harness, 's1')
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: NO_LOCAL_ROOT_MESSAGE })
    expect(spawnMock).not.toHaveBeenCalled()
  })

  it('ignores request text other than the session id', async () => {
    const cwd = workspace(true)
    const harness = routeHarness(new Map([['s1', cwd]]))
    const pending = harness.route.fetch(
      new Request(`http://localhost${CHANGES_ROUTE}?session=s1&path=/etc`),
    )
    const child = spawnMock.mock.results.at(-1)?.value as FakeChild
    complete(child, 0, output(cwd))
    const response = await pending
    expect(response.status).toBe(200)
    expect(spawnMock.mock.calls[0]?.[2]).toMatchObject({ cwd })
  })

  it('registers nothing on a host without the connection fetch registry', () => {
    const ctx = {
      get() {
        return undefined
      },
    }
    expect(() => registerChangeRoute(ctx as never)).not.toThrow()
  })
})
