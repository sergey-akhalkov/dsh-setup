import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: execFileMock }))

import {
  createStatusCache,
  detectElevation,
  isDesktopExecutable,
  isDesktopHost,
  parseElevation,
} from '../src/host/elevation.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const WIN = String.fromCharCode(92)
const APP = ['C:', 'Apps', 'DeepSeek Harness.exe'].join(WIN)
const NODE = ['C:', 'Apps', 'node.exe'].join(WIN)
const DESKTOP_HOST = [
  'C:',
  'Apps',
  'resources',
  'app.asar',
  'dsh',
  'node_modules',
  '@deepseek-ai',
  'dsh-desktop-host',
  'lib',
  'index.js',
].join(WIN)
const CLI = ['C:', 'Apps', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'].join(WIN)

interface FakeRequest {
  method?: string
  headers: Record<string, string>
}

interface FakeResponseState {
  status: number
  headers: Record<string, string>
  body: string
}

interface FakeRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: FakeRequest, res: FakeResponse) => void | Promise<void>
}

interface FakeResponse {
  writeHead: (status: number, headers?: Record<string, string>) => FakeResponse
  end: (chunk?: string) => void
}

interface FakeContext {
  effect: (callback: () => () => void) => () => void
  webServer: { register: (route: FakeRoute) => () => void; getOrigin: () => string }
  commands: { register: (definition: unknown) => () => void }
}

interface PluginModule {
  name: string
  inject: string[]
  apply: (ctx: FakeContext) => void
}

let platformSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  execFileMock.mockReset()
  platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
})

afterEach(() => {
  platformSpy.mockRestore()
})

function mockWhoami(result: string | Error): void {
  execFileMock.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: object,
      callback: (error: Error | null, stdout: string) => void,
    ) => {
      if (result instanceof Error) callback(result, '')
      else callback(null, result)
    },
  )
}

function createResponse(): { res: FakeResponse; state: FakeResponseState } {
  const state: FakeResponseState = { status: 0, headers: {}, body: '' }
  const res: FakeResponse = {
    writeHead(status, headers = {}) {
      state.status = status
      state.headers = headers
      return res
    },
    end(chunk = '') {
      state.body = chunk
    },
  }
  return { res, state }
}

async function loadPlugin(): Promise<PluginModule> {
  const file = join(packageDir, 'lib', 'index.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  return (await import(pathToFileURL(file).href)) as unknown as PluginModule
}

async function loadRoutes(): Promise<{ plugin: PluginModule; routes: FakeRoute[] }> {
  const plugin = await loadPlugin()
  const routes: FakeRoute[] = []
  const ctx: FakeContext = {
    effect: (callback) => callback(),
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
      getOrigin: () => 'http://127.0.0.1:1234',
    },
    commands: {
      register() {
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  return { plugin, routes }
}

describe('admin indicator Host status', () => {
  it('parses the high and system mandatory labels as administrator', () => {
    expect(parseElevation('Mandatory Label\\High Mandatory Level    S-1-16-12288')).toBe(
      'administrator',
    )
    expect(parseElevation('Mandatory Label\\System Mandatory Level    S-1-16-16384')).toBe(
      'administrator',
    )
  })

  it('treats the untrusted, low, and medium mandatory labels as standard', () => {
    expect(parseElevation('Mandatory Label\\Medium Mandatory Level    S-1-16-8192')).toBe(
      'standard',
    )
    expect(parseElevation('Mandatory Label\\Low Mandatory Level    S-1-16-4096')).toBe('standard')
    expect(parseElevation('Mandatory Label\\Untrusted Mandatory Level    S-1-16-0')).toBe(
      'standard',
    )
  })

  it('returns unknown when the mandatory label is missing or unrecognized', () => {
    expect(parseElevation('')).toBe('unknown')
    expect(parseElevation('Mandatory Label\\Medium Mandatory Level')).toBe('unknown')
    expect(parseElevation('Mandatory Label\\Protected Mandatory Level    S-1-16-20480')).toBe(
      'unknown',
    )
  })

  it('detects administrator, standard, and failure states from whoami', async () => {
    mockWhoami('Mandatory Label\\High Mandatory Level    S-1-16-12288')
    await expect(detectElevation()).resolves.toBe('administrator')
    mockWhoami('Mandatory Label\\Medium Mandatory Level    S-1-16-8192')
    await expect(detectElevation()).resolves.toBe('standard')
    mockWhoami('')
    await expect(detectElevation()).resolves.toBe('unknown')
    mockWhoami(new Error('whoami failed'))
    await expect(detectElevation()).resolves.toBe('unknown')
    expect(execFileMock).toHaveBeenCalledTimes(4)
  })

  it('does not spawn whoami on a non-Windows platform', async () => {
    platformSpy.mockReturnValue('linux')
    await expect(detectElevation()).resolves.toBe('unknown')
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('caches one detection for the process lifetime', async () => {
    let calls = 0
    const current = createStatusCache(async () => {
      calls += 1
      return 'standard'
    })
    await expect(current()).resolves.toBe('standard')
    await expect(current()).resolves.toBe('standard')
    expect(calls).toBe(1)
  })

  it('recognizes only the Desktop executable on Windows', () => {
    expect(isDesktopExecutable(APP, 'win32')).toBe(true)
    expect(isDesktopExecutable(NODE, 'win32')).toBe(false)
    expect(isDesktopExecutable('/opt/DeepSeek Harness.exe', 'linux')).toBe(false)
  })

  it('recognizes the Electron-owned Desktop Host, not the bundled CLI', () => {
    expect(isDesktopHost([DESKTOP_HOST])).toBe(true)
    expect(isDesktopHost([CLI])).toBe(false)
    expect(isDesktopHost([])).toBe(false)
  })

  it('exports the package identity and required service', async () => {
    const { plugin } = await loadRoutes()
    expect(plugin.name).toBe('@dsh-setup/plugin-admin-indicator')
    expect(plugin.inject).toEqual(['webServer', 'commands', 'connection'])
  })

  it('serves the detected administrator state as JSON', async () => {
    mockWhoami('Mandatory Label\\High Mandatory Level    S-1-16-12288')
    const { routes } = await loadRoutes()
    const route = routes.find((entry) => entry.path.endsWith('/status'))
    expect(route?.kind).toBe('exact')

    const { res, state } = createResponse()
    await route?.handler({ method: 'GET', headers: { origin: 'http://127.0.0.1:1234' } }, res)
    expect(state.status).toBe(200)
    expect(state.headers['cache-control']).toBe('no-store')
    const body = JSON.parse(state.body) as {
      platform: string
      elevated: string
      desktop: boolean
    }
    expect(body.platform).toBe('win32')
    expect(body.elevated).toBe('administrator')
    expect(body.desktop).toBe(false)
  })

  it('serves unknown when detection fails', async () => {
    mockWhoami(new Error('whoami failed'))
    const { routes } = await loadRoutes()
    const route = routes.find((entry) => entry.path.endsWith('/status'))
    const { res, state } = createResponse()
    await route?.handler({ method: 'GET', headers: { origin: 'http://127.0.0.1:1234' } }, res)
    expect(JSON.parse(state.body).elevated).toBe('unknown')
  })

  it('authenticates the status route like the actions', async () => {
    mockWhoami('Mandatory Label\\High Mandatory Level    S-1-16-12288')
    const { routes } = await loadRoutes()
    const route = routes.find((entry) => entry.path.endsWith('/status'))

    const foreign = createResponse()
    await route?.handler(
      { method: 'GET', headers: { origin: 'http://127.0.0.1:9999' } },
      foreign.res,
    )
    expect(foreign.state.status).toBe(403)

    const anonymous = createResponse()
    await route?.handler({ method: 'GET', headers: {} }, anonymous.res)
    expect(anonymous.state.status).toBe(403)

    const desktop = createResponse()
    await route?.handler({ method: 'GET', headers: { cookie: 'dsh-auth=test' } }, desktop.res)
    expect(desktop.state.status).toBe(200)
  })

  it('rejects non-GET requests without running the detection', async () => {
    const { routes } = await loadRoutes()
    const route = routes.find((entry) => entry.path.endsWith('/status'))
    const { res, state } = createResponse()
    await route?.handler({ method: 'POST', headers: {} }, res)
    expect(state.status).toBe(405)
    expect(state.headers.allow).toBe('GET')
    expect(execFileMock).not.toHaveBeenCalled()
  })
})
