import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The published DSH packages have peer dependencies the repository installs
// explicitly, not via autoInstallPeers. Mock the two host seams the fork calls
// so these tests exercise the fork's code against the documented contracts.
vi.mock('@deepseek-ai/dsh-subagent', () => ({
  NO_START_CAPABILITIES: Object.freeze({
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
  }),
  assertPositiveFinite(_prefix: string, name: string, value: number) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive finite number`)
    }
  },
  assertUsableCwd(_prefix: string, _label: string, cwd: string) {
    return cwd
  },
  async settleRunResult(parts: {
    attempt: () => Promise<unknown>
    collectOutput: () => unknown[]
    collectDiagnostic?: () => string | undefined
    cancelled: () => boolean
    onError?: (error: Error, stopReason: string) => void
    signal: AbortSignal
    onAbort: () => void
  }) {
    try {
      const result = (await parts.attempt()) as { output: unknown[]; stopReason: string }
      return parts.cancelled() ? { output: parts.collectOutput(), stopReason: 'aborted' } : result
    } catch (error) {
      if (parts.cancelled()) return { output: parts.collectOutput(), stopReason: 'aborted' }
      try {
        parts.onError?.(error instanceof Error ? error : new Error(String(error)), 'error')
      } catch {}
      const diagnostic = parts.collectDiagnostic?.()
      return {
        output: parts.collectOutput(),
        ...(diagnostic === undefined ? {} : { diagnostic }),
        stopReason: 'error',
      }
    } finally {
      parts.signal.removeEventListener('abort', parts.onAbort)
    }
  },
  subprocessRunHandle(parts: {
    id: string
    result: Promise<unknown>
    signal: AbortSignal
    onAbort: () => void
    requestCancel: () => void
    teardown: () => Promise<void>
  }) {
    let disposal: Promise<void> | undefined
    return {
      id: parts.id,
      result: parts.result,
      dispose() {
        if (disposal !== undefined) return disposal
        parts.signal.removeEventListener('abort', parts.onAbort)
        parts.requestCancel()
        disposal = parts.teardown()
        return disposal
      },
    }
  },
}))

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (options: unknown) => options,
}))

const packageDir = fileURLToPath(new URL('..', import.meta.url))

interface PluginModule {
  name: string
  inject: string[]
  apply: (ctx: unknown, config?: Record<string, unknown>) => void
  discoverCodexPath: (
    codexPath: string | undefined,
    env: Record<string, string | undefined>,
    platform?: string,
  ) => { path?: string; source: 'config' | 'PATH' }
  parseCodexVersion: (output: string) => string | undefined
  codexSpawnArgv: (
    executable: string,
    args: readonly string[],
    platform?: string,
    env?: Record<string, string | undefined>,
  ) => string[]
  resolveCodexCli: (options: FakeResolveOptions) => Promise<{
    path: string
    version: string
    source: 'config' | 'PATH'
  }>
  codexSubagentStatus: (options: FakeResolveOptions) => Promise<StatusReport>
}

interface StatusReport {
  found: boolean
  path?: string
  version?: string
  source?: 'config' | 'PATH'
  snippet: string
  error?: string
}

interface FakeResolveOptions {
  codexPath?: string
  env?: Record<string, string>
  cwd: string
  graceMs?: number
  signal?: AbortSignal
  spawn: (spec: SpawnSpec) => FakeHandle
}

interface SpawnSpec {
  argv: string[]
  cwd: string
  graceMs: number
  env: Record<string, string>
  signal?: AbortSignal
  stdio: unknown
}

interface FakeHandle {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  done: Promise<{ exitCode: number | null; signal: string | null }>
  terminate: () => void
  waitForExit: () => Promise<void>
}

let modulePromise: Promise<PluginModule> | undefined

async function loadPlugin(): Promise<PluginModule> {
  modulePromise ??= import(pathToFileURL(join(packageDir, 'lib', 'index.js')).href).then(
    (module) => module as unknown as PluginModule,
  )
  return modulePromise
}

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = join(
    tmpdir(),
    `dsh-codex-subagent-test-${String(Math.random()).slice(2)}${String(Date.now())}`,
  )
  mkdirSync(directory, { recursive: true })
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  vi.restoreAllMocks()
})

function versionHandle(text: string, exitCode = 0, stderrText = ''): FakeHandle {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  queueMicrotask(() => {
    stdout.end(text)
    stderr.end(stderrText)
  })
  return {
    stdin,
    stdout,
    stderr,
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: () => {},
    waitForExit: () => Promise.resolve(),
  }
}

interface RecordedRequest {
  id?: number
  method?: string
  params?: Record<string, unknown>
}

type AppServerMode = 'success' | 'mismatch' | 'stall' | 'noncompleted' | 'crash'

interface FakeAppServer {
  handle: FakeHandle
  requests: RecordedRequest[]
  spawnArgv: string[][]
  terminated: () => boolean
}

function createAppServer(mode: AppServerMode): FakeAppServer {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const requests: RecordedRequest[] = []
  const spawnArgv: string[][] = []
  let terminated = false
  let resolveDone: (value: { exitCode: number | null; signal: string | null }) => void = () => {}
  let rejectDone: (error: Error) => void = () => {}
  const done = new Promise<{ exitCode: number | null; signal: string | null }>(
    (resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    },
  )
  const send = (message: Record<string, unknown>): void => {
    if (!stdout.writableEnded) stdout.write(`${JSON.stringify(message)}\n`)
  }
  const terminate = (): void => {
    if (terminated) return
    terminated = true
    stdout.end()
    stderr.end()
    resolveDone({ exitCode: null, signal: 'SIGTERM' })
  }
  let buffer = ''
  const handle = (request: RecordedRequest): void => {
    if (request.method === 'initialize' && request.id !== undefined) {
      if (mode !== 'stall') send({ jsonrpc: '2.0', id: request.id, result: {} })
      return
    }
    if (request.method === 'thread/start' && request.id !== undefined) {
      if (mode === 'mismatch') {
        send({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32601, message: 'Method not found' },
        })
        return
      }
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: { thread: { id: 'thread-1', ephemeral: true } },
      })
      if (mode === 'crash') {
        setTimeout(() => rejectDone(new Error('app-server crashed')), 0)
      }
      return
    }
    if (request.method === 'turn/start' && request.id !== undefined) {
      send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-1' } } })
      setTimeout(() => {
        if (mode === 'success') {
          send({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: { threadId: 'thread-1', turn: { id: 'turn-1' } },
          })
          send({
            jsonrpc: '2.0',
            method: 'item/completed',
            params: {
              threadId: 'thread-1',
              turnId: 'turn-1',
              item: { type: 'agentMessage', phase: 'final_answer', text: 'review passed' },
            },
          })
          send({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
          })
        } else if (mode === 'noncompleted') {
          send({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: {
              threadId: 'thread-1',
              turn: {
                id: 'turn-1',
                status: 'failed',
                error: {
                  codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 401 } },
                },
              },
            },
          })
        }
      }, 0)
      return
    }
  }
  stdin.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf('\n')
      if (line.trim().length === 0) continue
      const request = JSON.parse(line) as RecordedRequest
      requests.push(request)
      handle(request)
    }
  })
  if (mode === 'stall') {
    // Never answer initialize: the caller's signal must terminate the range.
  }
  return {
    handle: {
      stdin,
      stdout,
      stderr,
      done,
      terminate,
      waitForExit: async () => {
        await done.catch(() => {})
      },
    },
    requests,
    spawnArgv,
    terminated: () => terminated,
  }
}

/** A spawn that serves `--version` and one recorded app-server child. */
function createSpawn(options: {
  versionText?: string
  versionExit?: number
  versionStderr?: string
  appServerMode?: AppServerMode
}): {
  spawn: (spec: SpawnSpec) => FakeHandle
  appServer: FakeAppServer | undefined
  argv: string[][]
} {
  const appServer =
    options.appServerMode === undefined ? undefined : createAppServer(options.appServerMode)
  const argv: string[][] = []
  return {
    argv,
    appServer,
    spawn(spec) {
      argv.push(spec.argv)
      if (spec.argv.includes('--version')) {
        return versionHandle(
          options.versionText ?? 'codex-cli 0.164.0\n',
          options.versionExit ?? 0,
          options.versionStderr ?? '',
        )
      }
      if (appServer === undefined) throw new Error('unexpected app-server spawn')
      appServer.spawnArgv.push(spec.argv)
      return appServer.handle
    },
  }
}

interface FakeProvider {
  name: string
  sandbox?: string
  capabilities?: unknown
  start?: (request: unknown) => unknown
}

interface FakeTool {
  name: string
  description?: string
  execute: (args: unknown, exec: { signal?: AbortSignal }) => Promise<StatusReport>
}

interface FakeContext {
  providers: Map<string, FakeProvider>
  tools: FakeTool[]
  ctx: {
    subagents: {
      registerProvider: (provider: FakeProvider) => () => void
    }
    subprocess: { spawn: (spec: SpawnSpec) => FakeHandle }
    tools: { register: (tool: FakeTool) => () => void }
    logger: { warn: () => void }
  }
}

function createContext(spawn: (spec: SpawnSpec) => FakeHandle): FakeContext {
  const providers = new Map<string, FakeProvider>()
  const tools: FakeTool[] = []
  const ctx = {
    subagents: {
      registerProvider(provider: FakeProvider): () => void {
        if (providers.has(provider.name)) {
          throw new Error(`a subagent provider named "${provider.name}" is already registered`)
        }
        providers.set(provider.name, provider)
        return () => providers.delete(provider.name)
      },
    },
    subprocess: { spawn },
    tools: {
      register(tool: FakeTool): () => void {
        tools.push(tool)
        return () => {}
      },
    },
    logger: { warn: () => {} },
  }
  return { providers, tools, ctx }
}

function writeExecutable(directory: string, name: string): string {
  const file = join(directory, name)
  writeFileSync(file, '#!/bin/sh\n', 'utf8')
  return file
}

function createStartRequest(
  cwd: string,
  text: string,
  signal: AbortSignal,
): {
  prompt: { type: string; text: string }[]
  cwd: string
  signal: AbortSignal
} {
  return { prompt: [{ type: 'text', text }], cwd, signal }
}

describe('installed-CLI discovery', () => {
  it('prefers an explicit codexPath over PATH', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({})
    const resolved = await plugin.resolveCodexCli({
      codexPath: executable,
      env: { PATH: '' },
      cwd: directory,
      spawn: spawn.spawn,
    })

    expect(resolved).toMatchObject({
      path: executable,
      version: '0.164.0',
      source: 'config',
    })
    expect(spawn.argv[0]?.at(-1)).toBe('--version')
  })

  it('resolves a bare command name from the configured codexPath', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    writeExecutable(directory, process.platform === 'win32' ? 'codex.exe' : 'codex')
    const spawn = createSpawn({})
    const resolved = await plugin.resolveCodexCli({
      codexPath: 'codex',
      env: { PATH: directory },
      cwd: directory,
      spawn: spawn.spawn,
    })

    expect(resolved.source).toBe('config')
    expect(resolved.path.startsWith(directory)).toBe(true)
  })

  it('finds codex on PATH when codexPath is omitted', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    writeExecutable(directory, process.platform === 'win32' ? 'codex.cmd' : 'codex')
    const spawn = createSpawn({})
    const resolved = await plugin.resolveCodexCli({
      env: { PATH: directory },
      cwd: directory,
      spawn: spawn.spawn,
    })

    expect(resolved.source).toBe('PATH')
    expect(resolved.version).toBe('0.164.0')
  })

  it('reports a missing CLI with the config key and the status tool', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const spawn = createSpawn({})

    await expect(
      plugin.resolveCodexCli({
        env: { PATH: '' },
        cwd: directory,
        spawn: spawn.spawn,
      }),
    ).rejects.toThrow(/codexPath[\s\S]*codex_subagent_status/u)
  })

  it('rejects a configured path that is not an executable file', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const missing = join(directory, 'missing-codex.exe')
    const spawn = createSpawn({})

    await expect(
      plugin.resolveCodexCli({
        codexPath: missing,
        cwd: directory,
        spawn: spawn.spawn,
      }),
    ).rejects.toThrow(/codexPath[\s\S]*not an executable file[\s\S]*codex_subagent_status/u)
  })

  it('rejects a CLI whose --version command fails', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ versionExit: 1, versionStderr: 'shim exploded' })

    await expect(
      plugin.resolveCodexCli({
        codexPath: executable,
        cwd: directory,
        spawn: spawn.spawn,
      }),
    ).rejects.toThrow(/failed `--version`[\s\S]*shim exploded[\s\S]*codex_subagent_status/u)
  })

  it('rejects version output without a version token', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ versionText: 'no version here\n' })

    await expect(
      plugin.resolveCodexCli({
        codexPath: executable,
        cwd: directory,
        spawn: spawn.spawn,
      }),
    ).rejects.toThrow(/did not report a version/u)
  })
})

describe('Windows command handling', () => {
  it('spawns a .cmd shim through ComSpec with fixed argv entries', async () => {
    const plugin = await loadPlugin()
    expect(
      plugin.codexSpawnArgv('tools/codex.cmd', ['app-server', '--stdio'], 'win32', {
        ComSpec: 'cmd.exe',
      }),
    ).toEqual(['cmd.exe', '/d', '/c', 'tools/codex.cmd', 'app-server', '--stdio'])
  })

  it('spawns a .bat shim through ComSpec too', async () => {
    const plugin = await loadPlugin()
    expect(
      plugin.codexSpawnArgv('tools/codex.bat', ['app-server', '--stdio'], 'win32', {
        ComSpec: 'cmd.exe',
      }),
    ).toEqual(['cmd.exe', '/d', '/c', 'tools/codex.bat', 'app-server', '--stdio'])
  })

  it('spawns a .exe directly with no shell wrapper', async () => {
    const plugin = await loadPlugin()
    expect(plugin.codexSpawnArgv('tools/codex.exe', ['app-server', '--stdio'], 'win32')).toEqual([
      'tools/codex.exe',
      'app-server',
      '--stdio',
    ])
  })
})

describe('provider registration', () => {
  it('registers both provider names and the status tool', async () => {
    const plugin = await loadPlugin()
    const spawn = createSpawn({})
    const { providers, tools, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx)

    expect([...providers.keys()].sort()).toEqual(['codex-subagent', 'codex-subagent-write'])
    expect(providers.get('codex-subagent')?.sandbox).toBe('read-only')
    expect(providers.get('codex-subagent-write')?.sandbox).toBe('workspace-write')
    expect(tools.map((tool) => tool.name)).toEqual(['codex_subagent_status'])
  })

  it('composes beside the official codex provider', async () => {
    const plugin = await loadPlugin()
    const spawn = createSpawn({})
    const { providers, ctx } = createContext(spawn.spawn)
    providers.set('codex', { name: 'codex' })
    expect(() => plugin.apply(ctx)).not.toThrow()
    expect([...providers.keys()].sort()).toEqual([
      'codex',
      'codex-subagent',
      'codex-subagent-write',
    ])
  })

  it('rejects a non-positive disposeGraceMs and does not register', async () => {
    const plugin = await loadPlugin()
    const spawn = createSpawn({})
    const { providers, ctx } = createContext(spawn.spawn)
    expect(() => plugin.apply(ctx, { disposeGraceMs: 0 })).toThrow(/disposeGraceMs/u)
    expect(providers.size).toBe(0)
  })
})

describe('app-server execution', () => {
  it('runs the installed CLI, sends the prompt over stdin, and returns the answer', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const prompt = 'Review this specification and report P0/P1 findings.'
    const spawn = createSpawn({ appServerMode: 'success' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const controller = new AbortController()
    const run = (await provider.start(
      createStartRequest(directory, prompt, controller.signal),
    )) as {
      result: Promise<{ output: { type: string; text: string }[]; stopReason: string }>
      dispose: () => Promise<void>
    }
    const result = await run.result

    expect(result.stopReason).toBe('completed')
    expect(result.output).toEqual([{ type: 'text', text: 'review passed' }])
    const appServerArgv = spawn.argv.find((argv) => argv.includes('app-server'))
    expect(appServerArgv).not.toContain(prompt)
    expect(appServerArgv).toEqual([executable, 'app-server', '--stdio'])
    const threadStart = spawn.appServer?.requests.find(
      (request) => request.method === 'thread/start',
    )
    expect(threadStart?.params).toMatchObject({ cwd: directory, sandbox: 'read-only' })
    const turnStart = spawn.appServer?.requests.find((request) => request.method === 'turn/start')
    expect(turnStart?.params).toMatchObject({
      threadId: 'thread-1',
      input: [{ type: 'text', text: prompt, text_elements: [] }],
    })
    await run.dispose()
  })

  it('runs the write provider with the workspace-write sandbox', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'success' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent-write')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(directory, 'Fix the failing test.', new AbortController().signal),
    )) as { result: Promise<{ stopReason: string }>; dispose: () => Promise<void> }
    await run.result
    const threadStart = spawn.appServer?.requests.find(
      (request) => request.method === 'thread/start',
    )
    expect(threadStart?.params).toMatchObject({ sandbox: 'workspace-write' })
    await run.dispose()
  })

  it('reports a protocol mismatch with the Codex version', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'mismatch' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    await expect(
      provider.start(
        createStartRequest(directory, 'Review the task.', new AbortController().signal),
      ),
    ).rejects.toThrow(/codex: 0\.164\.0[\s\S]*thread-start/u)
  })

  it('reports a non-completed turn with the HTTP status and version', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'noncompleted' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(directory, 'Review the task.', new AbortController().signal),
    )) as {
      result: Promise<{ stopReason: string; diagnostic?: string }>
      dispose: () => Promise<void>
    }
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('HTTP status: 401')
    expect(result.diagnostic).toContain('codex: 0.164.0')
    await run.dispose()
  })

  it('stops the app-server and reports aborted on cancellation', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'stall' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const controller = new AbortController()
    const started = provider.start(createStartRequest(directory, 'Review.', controller.signal))
    setTimeout(() => controller.abort(), 20)
    await expect(started).rejects.toThrow(/aborted/u)
    expect(spawn.appServer?.terminated()).toBe(true)
  })

  it('treats a timeout signal as cancellation and stops the app-server', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'stall' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    await expect(
      provider.start(createStartRequest(directory, 'Review.', AbortSignal.timeout(25))),
    ).rejects.toThrow(/aborted/u)
    expect(spawn.appServer?.terminated()).toBe(true)
  })

  it('reports a crashed app-server as a non-completed run', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'crash' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(directory, 'Review.', new AbortController().signal),
    )) as {
      result: Promise<{ stopReason: string; diagnostic?: string }>
      dispose: () => Promise<void>
    }
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('codex: 0.164.0')
    await run.dispose()
  })
})

describe('codex_subagent_status', () => {
  async function statusTool(
    spawn: (spec: SpawnSpec) => FakeHandle,
    config: Record<string, unknown> = {},
  ): Promise<FakeTool> {
    const plugin = await loadPlugin()
    const { tools, ctx } = createContext(spawn)
    plugin.apply(ctx, config)
    const tool = tools.find((entry) => entry.name === 'codex_subagent_status')
    if (tool === undefined) throw new Error('status tool missing')
    return tool
  }

  it('reports a config-sourced CLI and a paste-ready snippet', async () => {
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ versionText: 'codex-cli 0.164.0\n' })
    const tool = await statusTool(spawn.spawn, { codexPath: executable })

    const report = await tool.execute({}, { signal: new AbortController().signal })
    expect(report).toMatchObject({
      found: true,
      path: executable,
      version: '0.164.0',
      source: 'config',
    })
    expect(report.snippet).toContain('- id: dsh-setup-codex-subagent')
    const snippetValue = /codexPath: (.*)$/mu.exec(report.snippet)?.[1]
    expect(snippetValue).toBeDefined()
    if (snippetValue !== undefined) expect(JSON.parse(snippetValue)).toBe(executable)
  })

  it('reports a PATH-sourced CLI', async () => {
    const directory = temporaryDirectory()
    writeExecutable(directory, process.platform === 'win32' ? 'codex.exe' : 'codex')
    const spawn = createSpawn({})
    const tool = await statusTool(spawn.spawn, { env: { PATH: directory } })

    const report = await tool.execute({}, { signal: new AbortController().signal })
    expect(report).toMatchObject({ found: true, source: 'PATH' })
    expect(report.path?.startsWith(directory)).toBe(true)
  })

  it('reports a missing CLI with the next actions', async () => {
    const spawn = createSpawn({})
    const tool = await statusTool(spawn.spawn, { env: { PATH: '' } })

    const report = await tool.execute({}, { signal: new AbortController().signal })
    expect(report.found).toBe(false)
    expect(report.error).toMatch(/codexPath/u)
    expect(report.error).toMatch(/codex_subagent_status/u)
    expect(report.snippet).toContain('- id: dsh-setup-codex-subagent')
  })

  it('never writes the profile patch', async () => {
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const profile = join(directory, 'cordis.patch.yml')
    writeFileSync(profile, '- id: an-owner-row\n', 'utf8')
    const before = readFileSync(profile)
    const spawn = createSpawn({})
    const tool = await statusTool(spawn.spawn, { codexPath: executable })

    await tool.execute({}, { signal: new AbortController().signal })
    expect(readFileSync(profile).equals(before)).toBe(true)
    expect(statSync(profile).isFile()).toBe(true)
  })
})

describe('package provenance and no bundled Codex', () => {
  it('declares the upstream MIT base, local patch, and rebase notes', () => {
    const notice = readFileSync(join(packageDir, 'NOTICE'), 'utf8')
    const readme = readFileSync(join(packageDir, 'README.md'), 'utf8')
    const license = readFileSync(join(packageDir, 'LICENSE'), 'utf8')
    expect(notice).toContain('@deepseek-ai/dsh-subagent-codex')
    expect(notice).toContain('0.2.1-rc.3')
    expect(license).toContain('MIT License')
    expect(readme).toContain('Rebase procedure')
    expect(readme).toContain('codex_subagent_status')
    expect(readme).toContain('installed on the machine')
  })

  it('does not depend on the official provider or a bundled Codex binary', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    const dependencies = manifest.dependencies as Record<string, string>
    expect(dependencies['@openai/codex']).toBeUndefined()
    expect(
      (manifest.peerDependencies as Record<string, string>)['@deepseek-ai/dsh-subagent-codex'],
    ).toBeUndefined()
    expect(dependencies['@deepseek-ai/dsh-tool-subagent']).toBeUndefined()

    const source = readFileSync(join(packageDir, 'lib', 'index.js'), 'utf8')
    expect(source).not.toMatch(/from\s+["']@openai\/codex["']/u)
    expect(source).not.toContain('createRequire')
    expect(source).not.toContain('process.execPath')
    expect(source).not.toContain('CODEX_PACKAGE_BIN')
    expect(source).toContain('codex_subagent_status')
    expect(source).toContain('codex-subagent-write')

    const files = readdirSync(packageDir, { recursive: true }) as string[]
    expect(files.filter((file) => /\.(exe|node|dll|tar|gz|zip)$/u.test(file))).toEqual([])
  })

  it('ships no install-time script and metadata assets', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    const scripts = (manifest.scripts ?? {}) as Record<string, string>
    for (const name of ['preinstall', 'install', 'postinstall', 'prepare']) {
      expect(scripts[name]).toBeUndefined()
    }
    const locale = JSON.parse(readFileSync(join(packageDir, 'locale', 'en.json'), 'utf8')) as {
      meta?: { title?: string; description?: string }
    }
    expect(locale.meta?.title).toBeTruthy()
    expect(locale.meta?.description).toMatch(/codex/iu)
    expect(statSync(join(packageDir, 'icon.svg')).size).toBeGreaterThan(100)
  })
})
