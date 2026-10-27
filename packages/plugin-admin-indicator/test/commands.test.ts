import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  execFile: vi.fn((...args: unknown[]) => {
    const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void
    callback(new Error('not configured'), '', '')
  }),
  spawn: vi.fn(),
}))

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const STATUS_PATH = '/plugins/dsh-setup-admin-indicator/status'
const SHORTCUT_PATH = '/plugins/dsh-setup-admin-indicator/shortcut'

interface FakeCommand {
  definitionId?: unknown
  name: string
  description: string
  handler: (invocation: { rawInput: string }) => Promise<{ kind: string; text?: string }>
}

interface FakeRequest {
  method?: string
  headers: { origin?: string; cookie?: string }
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
  webServer: {
    register: (route: FakeRoute) => () => void
    getOrigin: () => string
  }
  commands: { register: (definition: FakeCommand) => () => void }
  connection: {
    requestRejection: (request: { headers: FakeRequest['headers'] }) => 401 | 403 | undefined
  }
}

interface PluginModule {
  name: string
  inject: string[]
  apply: (ctx: FakeContext, config?: unknown) => void
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

async function loadPlugin(rawConfig?: unknown): Promise<{
  plugin: PluginModule
  routes: FakeRoute[]
  commands: FakeCommand[]
}> {
  const file = join(packageDir, 'lib', 'index.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  const plugin = (await import(pathToFileURL(file).href)) as unknown as PluginModule
  const routes: FakeRoute[] = []
  const commands: FakeCommand[] = []
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
      register(definition) {
        commands.push(definition)
        return () => {}
      },
    },
    connection: {
      requestRejection(request) {
        if (request.headers.origin === 'http://127.0.0.1:9999') return 403
        if (request.headers.cookie === 'forged') return 401
        return undefined
      },
    },
  }
  plugin.apply(ctx, rawConfig)
  return { plugin, routes, commands }
}

describe('admin indicator authenticated commands', () => {
  it('registers only the shortcut by default', async () => {
    const { plugin, commands } = await loadPlugin()
    expect(plugin.inject).toEqual(['webServer', 'commands', 'connection'])
    expect(commands.map((entry) => entry.name)).toEqual(['admin-shortcut'])
  })

  it('registers the restart command only when the feature flag is on', async () => {
    const { plugin, commands } = await loadPlugin({ restart: true })
    expect(plugin.inject).toEqual(['webServer', 'commands', 'connection'])
    expect(commands.map((entry) => entry.name)).toEqual(['admin-shortcut', 'admin-restart'])
    expect(commands[0]?.description).toContain('desktop shortcut')
    expect(commands[1]?.description).toContain('administrator')
  })

  it('rejects a mistyped restart feature flag', async () => {
    await expect(loadPlugin({ restart: 'yes' })).rejects.toThrow(/restart/u)
  })

  it('requires the confirm argument for the destructive restart', async () => {
    const { commands } = await loadPlugin({ restart: true })
    const restart = commands.find((entry) => entry.name === 'admin-restart')
    const unconfirmed = await restart?.handler({ rawInput: '' })
    expect(unconfirmed?.kind).toBe('error')
    expect(unconfirmed?.text).toContain('/admin-restart confirm')
  })

  it('refuses to run the commands outside the Desktop app', async () => {
    const { commands } = await loadPlugin({ restart: true })
    const shortcut = commands.find((entry) => entry.name === 'admin-shortcut')
    const restart = commands.find((entry) => entry.name === 'admin-restart')
    const shortcutResult = await shortcut?.handler({ rawInput: '' })
    const restartResult = await restart?.handler({ rawInput: 'confirm' })
    expect(shortcutResult?.kind).toBe('error')
    expect(restartResult?.kind).toBe('error')
    expect(shortcutResult?.text).toContain('Desktop app')
  })

  it('rejects the restart when the session is already elevated', async () => {
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void
      callback(null, 'Mandatory Label\\High Mandatory Level S-1-16-12288', '')
    }) as never)
    const { commands } = await loadPlugin({ restart: true })
    const restart = commands.find((entry) => entry.name === 'admin-restart')
    const result = await restart?.handler({ rawInput: 'confirm' })
    expect(result?.kind).toBe('error')
    expect(result?.text).toContain('already')
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
  })

  it('rejects the restart when the elevation is unknown', async () => {
    vi.mocked(execFile).mockImplementation(((...args: unknown[]) => {
      const callback = args[3] as (error: Error | null, stdout: string, stderr: string) => void
      callback(new Error('whoami failed'), '', '')
    }) as never)
    const { commands } = await loadPlugin({ restart: true })
    const restart = commands.find((entry) => entry.name === 'admin-restart')
    const result = await restart?.handler({ rawInput: 'confirm' })
    expect(result?.kind).toBe('error')
    expect(result?.text).toContain('unknown')
    expect(vi.mocked(spawn)).not.toHaveBeenCalled()
  })

  it('exposes the status and authenticated shortcut routes', async () => {
    const { routes } = await loadPlugin()
    expect(routes.map((entry) => entry.path)).toEqual([STATUS_PATH, SHORTCUT_PATH])
  })

  it('authenticates the shortcut route and rejects forged credentials', async () => {
    const { routes } = await loadPlugin()
    const route = routes.find((entry) => entry.path === SHORTCUT_PATH)
    expect(route?.kind).toBe('exact')

    const foreign = createResponse()
    await route?.handler(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:9999' } },
      foreign.res,
    )
    expect(foreign.state.status).toBe(403)

    const forged = createResponse()
    await route?.handler(
      { method: 'POST', headers: { origin: 'http://127.0.0.1:1234', cookie: 'forged' } },
      forged.res,
    )
    expect(forged.state.status).toBe(401)

    const ok = createResponse()
    await route?.handler({ method: 'POST', headers: { origin: 'http://127.0.0.1:1234' } }, ok.res)
    expect(ok.state.status).toBe(200)
    const body = JSON.parse(ok.state.body) as { ok: boolean; text: string }
    expect(body.ok).toBe(false)
    expect(body.text).toContain('Desktop app')
  })

  it('serves the read-only status without a secret and rejects a foreign origin', async () => {
    const { routes } = await loadPlugin()
    const route = routes.find((entry) => entry.path === STATUS_PATH)
    expect(route?.kind).toBe('exact')

    const foreign = createResponse()
    await route?.handler(
      { method: 'GET', headers: { origin: 'http://127.0.0.1:9999' } },
      foreign.res,
    )
    expect(foreign.state.status).toBe(403)

    const ok = createResponse()
    await route?.handler({ method: 'GET', headers: { origin: 'http://127.0.0.1:1234' } }, ok.res)
    expect(ok.state.status).toBe(200)
    const body = JSON.parse(ok.state.body) as {
      token?: string
      elevated: string
      restart: boolean
    }
    expect(body.token).toBeUndefined()
    expect(['administrator', 'standard', 'unknown']).toContain(body.elevated)
    expect(body.restart).toBe(false)
  })
})
