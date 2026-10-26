import { spawn as spawnProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Must match the runtime constants; a CMD shim carries its wrapper here. */
const SHIM_WRAPPER_ENV = 'CODEX_SHIM_WRAPPER'
const SHIM_EXECUTABLE_ENV = 'CODEX_SHIM_EXECUTABLE'
const SHIM_ARG_ENV_PREFIX = 'CODEX_SHIM_ARG_'

/** True when every character is in the ASCII range (batch wrapper must be). */
function isAscii(text: string): boolean {
  return [...text].every((character) => character.charCodeAt(0) <= 0x7f)
}

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
    bundled?: BundledInfo,
  ) => { path?: string; source: DiscoverySource }
  parseCodexVersion: (output: string) => string | undefined
  codexSpawnPlan: (
    executable: string,
    args: readonly string[],
    options?: {
      platform?: string
      env?: Record<string, string | undefined>
    },
  ) => { argv: string[]; env: Record<string, string>; cleanup: () => void }
  codexAppServerArgs: (cwd: string, serenaHome: string) => string[]
  codexLoginCommand: (executable?: string) => string
  bundledCodexInfo: () => BundledInfo
  serenaCommandLine: () => string
  SERENA_MCP_COMMAND: string
  SERENA_MCP_ARGS: readonly string[]
  SERENA_CONFIG_OVERRIDES: readonly string[]
  SERENA_DISABLED_TOOLS: readonly string[]
  SERENA_CONFIG_FILENAME: string
  resolveCodexCli: (options: FakeResolveOptions) => Promise<{
    path: string
    version: string
    source: DiscoverySource
    bundledVersion?: string
  }>
  codexSubagentStatus: (options: FakeResolveOptions) => Promise<StatusReport>
}

type DiscoverySource = 'config' | 'bundled' | 'PATH'

interface BundledInfo {
  path?: string
  version?: string
}

interface StatusReport {
  found: boolean
  path?: string
  version?: string
  source?: DiscoverySource
  bundledVersion?: string
  serena: string
  loginCommand: string
  codexHome: string
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
  bundled?: BundledInfo
}

interface SpawnSpec {
  argv: string[]
  cwd: string
  graceMs: number
  env: Record<string, string | undefined>
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

type AppServerMode =
  | 'success'
  | 'mismatch'
  | 'serena-missing'
  | 'serena-inherited-disabled'
  | 'serena-write-attempt'
  | 'serena-project-read'
  | 'stall'
  | 'noncompleted'
  | 'crash'

interface FakeAppServer {
  handle: FakeHandle
  requests: RecordedRequest[]
  spawnArgv: string[][]
  spawnSpecs: SpawnSpec[]
  terminated: () => boolean
}

interface FakeAppServerOptions {
  serenaTool?: string
  serenaWriteFile?: string
  threadId?: string
  resumeError?: string
}

function createAppServer(mode: AppServerMode, options: FakeAppServerOptions = {}): FakeAppServer {
  let activeThreadId = options.threadId ?? 'thread-1'
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const requests: RecordedRequest[] = []
  const spawnArgv: string[][] = []
  const spawnSpecs: SpawnSpec[] = []
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
  const serenaDisabledTools = (): string[] => {
    for (const argv of spawnArgv) {
      for (const arg of argv) {
        if (!arg.startsWith('mcp_servers.serena.disabled_tools=')) continue
        try {
          return JSON.parse(arg.slice(arg.indexOf('=') + 1)) as string[]
        } catch {
          return []
        }
      }
    }
    return []
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
    if (request.method === 'thread/resume' && request.id !== undefined) {
      if (options.resumeError !== undefined) {
        send({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32603, message: options.resumeError },
        })
      } else {
        activeThreadId = String(request.params?.threadId ?? activeThreadId)
        send({
          jsonrpc: '2.0',
          id: request.id,
          result: { thread: { id: activeThreadId, ephemeral: false } },
        })
      }
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
      if (mode === 'serena-missing') {
        send({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32603,
            message:
              'error creating thread: Fatal error: Failed to initialize session: required MCP servers failed to initialize: serena: program not found',
          },
        })
        return
      }
      // Models an inherited `mcp_servers.serena.enabled=false`: only the fixed
      // child override can enable the required server.
      if (
        mode === 'serena-inherited-disabled' &&
        !spawnArgv.some((argv) => argv.includes('mcp_servers.serena.enabled=true'))
      ) {
        send({
          jsonrpc: '2.0',
          id: request.id,
          error: {
            code: -32603,
            message:
              'error creating thread: Fatal error: Failed to initialize session: required MCP server serena is disabled',
          },
        })
        return
      }
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          thread: {
            id: activeThreadId,
            ephemeral: request.params?.ephemeral !== false,
          },
        },
      })
      if (mode === 'crash') {
        setTimeout(() => rejectDone(new Error('app-server crashed')), 0)
      }
      return
    }
    if (request.method === 'turn/start' && request.id !== undefined) {
      send({ jsonrpc: '2.0', id: request.id, result: { turn: { id: 'turn-1' } } })
      setTimeout(() => {
        if (mode === 'serena-project-read') {
          const spec = spawnSpecs[spawnSpecs.length - 1]
          const home = spec?.env.SERENA_HOME
          const cwd = spec?.cwd ?? process.cwd()
          const configPath = typeof home === 'string' ? join(home, 'serena_config.yml') : undefined
          const configText =
            configPath !== undefined && existsSync(configPath)
              ? readFileSync(configPath, 'utf8')
              : ''
          const dataDir =
            typeof home === 'string' ? join(home, 'projects', basename(cwd)) : undefined
          const argv = spawnArgv[spawnArgv.length - 1] ?? []
          const argsArg = argv.find((arg) => arg.startsWith('mcp_servers.serena.args='))
          let serenaArgs: string[] = []
          try {
            serenaArgs =
              argsArg === undefined
                ? []
                : (JSON.parse(argsArg.slice(argsArg.indexOf('=') + 1)) as string[])
          } catch {
            serenaArgs = []
          }
          const projectIndex = serenaArgs.indexOf('--project')
          const exactProject = projectIndex >= 0 && serenaArgs[projectIndex + 1] === cwd
          const isolated =
            configText.includes('trusted_project_path_patterns: []') &&
            configText.includes('project_serena_folder_location:') &&
            dataDir !== undefined &&
            existsSync(dataDir) &&
            exactProject &&
            !serenaArgs.includes('--project-from-cwd') &&
            argv.some((arg) => arg.startsWith('mcp_servers.serena.cwd=')) &&
            argv.some((arg) => arg.startsWith('mcp_servers.serena.env.SERENA_HOME='))
          if (isolated) {
            send({
              jsonrpc: '2.0',
              method: 'item/completed',
              params: {
                threadId: activeThreadId,
                turnId: 'turn-1',
                item: { type: 'agentMessage', phase: 'final_answer', text: 'symbol found' },
              },
            })
            send({
              jsonrpc: '2.0',
              method: 'turn/completed',
              params: { threadId: activeThreadId, turn: { id: 'turn-1', status: 'completed' } },
            })
          } else {
            // Models Serena resolving an ancestor project and falling back to
            // rewriting that checkout `.serena` folder.
            if (options.serenaWriteFile !== undefined) {
              writeFileSync(options.serenaWriteFile, 'activation hook ran', 'utf8')
            }
            let ancestor = cwd
            let fallback: string | undefined
            for (;;) {
              const candidate = join(ancestor, '.serena', 'project.yml')
              if (existsSync(candidate)) {
                fallback = candidate
                break
              }
              const parent = dirname(ancestor)
              if (parent === ancestor) break
              ancestor = parent
            }
            if (fallback !== undefined) {
              writeFileSync(fallback, 'fallback rewrite', 'utf8')
            } else {
              mkdirSync(join(cwd, '.serena'), { recursive: true })
              writeFileSync(join(cwd, '.serena', 'project.yml'), 'fallback rewrite', 'utf8')
            }
            send({
              jsonrpc: '2.0',
              method: 'item/completed',
              params: {
                threadId: activeThreadId,
                turnId: 'turn-1',
                item: {
                  type: 'agentMessage',
                  phase: 'final_answer',
                  text: 'fallback used',
                },
              },
            })
            send({
              jsonrpc: '2.0',
              method: 'turn/completed',
              params: { threadId: activeThreadId, turn: { id: 'turn-1', status: 'completed' } },
            })
          }
        } else if (mode === 'serena-write-attempt') {
          const tool = options.serenaTool ?? 'replace_symbol_body'
          if (serenaDisabledTools().includes(tool)) {
            send({
              jsonrpc: '2.0',
              method: 'turn/completed',
              params: {
                threadId: activeThreadId,
                turn: {
                  id: 'turn-1',
                  status: 'failed',
                  error: {
                    message: `tool ${tool} is disabled in this configuration`,
                    codexErrorInfo: 'other',
                  },
                },
              },
            })
          } else {
            // Models an inherited approval_mode="approve" or trusted activation
            // hook reaching the filesystem outside the Codex sandbox.
            if (options.serenaWriteFile !== undefined) {
              writeFileSync(options.serenaWriteFile, 'mutated', 'utf8')
            }
            send({
              jsonrpc: '2.0',
              method: 'item/completed',
              params: {
                threadId: activeThreadId,
                turnId: 'turn-1',
                item: { type: 'agentMessage', phase: 'final_answer', text: 'mutated file' },
              },
            })
            send({
              jsonrpc: '2.0',
              method: 'turn/completed',
              params: { threadId: activeThreadId, turn: { id: 'turn-1', status: 'completed' } },
            })
          }
        } else if (mode === 'success' || mode === 'serena-inherited-disabled') {
          send({
            jsonrpc: '2.0',
            method: 'turn/started',
            params: { threadId: activeThreadId, turn: { id: 'turn-1' } },
          })
          send({
            jsonrpc: '2.0',
            method: 'item/completed',
            params: {
              threadId: activeThreadId,
              turnId: 'turn-1',
              item: { type: 'agentMessage', phase: 'final_answer', text: 'review passed' },
            },
          })
          send({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: { threadId: activeThreadId, turn: { id: 'turn-1', status: 'completed' } },
          })
        } else if (mode === 'noncompleted') {
          send({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: {
              threadId: activeThreadId,
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
    spawnSpecs,
    terminated: () => terminated,
  }
}

/** A spawn that serves `--version` and one recorded app-server child. */
function createSpawn(options: {
  versionText?: string
  versionExit?: number
  versionStderr?: string
  versionFor?: (argv: string[]) => { text?: string; exitCode?: number; stderr?: string } | undefined
  appServerMode?: AppServerMode
  serenaTool?: string
  serenaWriteFile?: string
  threadId?: string
  resumeError?: string
}): {
  spawn: (spec: SpawnSpec) => FakeHandle
  appServer: FakeAppServer | undefined
  argv: string[][]
  specs: SpawnSpec[]
} {
  const appServer =
    options.appServerMode === undefined
      ? undefined
      : createAppServer(options.appServerMode, {
          serenaTool: options.serenaTool,
          serenaWriteFile: options.serenaWriteFile,
          threadId: options.threadId,
          resumeError: options.resumeError,
        })
  const argv: string[][] = []
  const specs: SpawnSpec[] = []
  return {
    argv,
    specs,
    appServer,
    spawn(spec) {
      argv.push(spec.argv)
      specs.push(spec)
      const shimArgs = Object.keys(spec.env)
        .filter((key) => key.startsWith(SHIM_ARG_ENV_PREFIX))
        .map((key) => spec.env[key])
      const isVersionProbe = spec.argv.includes('--version') || shimArgs.includes('--version')
      if (isVersionProbe) {
        const custom = options.versionFor?.(spec.argv)
        return versionHandle(
          custom?.text ?? options.versionText ?? 'codex-cli 0.164.0\n',
          custom?.exitCode ?? options.versionExit ?? 0,
          custom?.stderr ?? options.versionStderr ?? '',
        )
      }
      if (appServer === undefined) throw new Error('unexpected app-server spawn')
      appServer.spawnArgv.push(spec.argv)
      appServer.spawnSpecs.push(spec)
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
  agentOptions?: Record<string, unknown>,
): {
  prompt: { type: string; text: string }[]
  cwd: string
  signal: AbortSignal
  agentOptions?: Record<string, unknown>
} {
  return {
    prompt: [{ type: 'text', text }],
    cwd,
    signal,
    ...(agentOptions === undefined ? {} : { agentOptions }),
  }
}

describe('Codex discovery', () => {
  it('prefers an explicit codexPath over the bundled binary and PATH', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const bundledExecutable = writeExecutable(temporaryDirectory(), 'bundled-codex.exe')
    const spawn = createSpawn({})
    const resolved = await plugin.resolveCodexCli({
      codexPath: executable,
      env: { PATH: '' },
      cwd: directory,
      spawn: spawn.spawn,
      bundled: { path: bundledExecutable, version: '0.164.0' },
    })

    expect(resolved).toMatchObject({
      path: executable,
      version: '0.164.0',
      source: 'config',
      bundledVersion: '0.164.0',
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
      bundled: {},
    })

    expect(resolved.source).toBe('config')
    expect(resolved.path.startsWith(directory)).toBe(true)
  })

  it('uses the bundled platform binary when codexPath is omitted', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const bundledExecutable = writeExecutable(temporaryDirectory(), 'bundled-codex.exe')
    const pathDirectory = temporaryDirectory()
    writeExecutable(pathDirectory, process.platform === 'win32' ? 'codex.exe' : 'codex')
    const spawn = createSpawn({})
    const resolved = await plugin.resolveCodexCli({
      env: { PATH: pathDirectory },
      cwd: directory,
      spawn: spawn.spawn,
      bundled: { path: bundledExecutable, version: '0.164.0' },
    })

    expect(resolved).toMatchObject({
      path: bundledExecutable,
      version: '0.164.0',
      source: 'bundled',
      bundledVersion: '0.164.0',
    })
    expect(spawn.argv[0]).toContain(bundledExecutable)
  })

  it('falls back to codex on PATH when the bundled package is unavailable', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    writeExecutable(directory, process.platform === 'win32' ? 'codex.cmd' : 'codex')
    const spawn = createSpawn({})
    const resolved = await plugin.resolveCodexCli({
      env: { PATH: directory },
      cwd: directory,
      spawn: spawn.spawn,
      bundled: {},
    })

    expect(resolved.source).toBe('PATH')
    expect(resolved.version).toBe('0.164.0')
    if (process.platform === 'win32') {
      const wrapper = spawn.specs[0]?.env[SHIM_WRAPPER_ENV]?.replace(/^"|"$/gu, '')
      if (wrapper !== undefined) expect(existsSync(wrapper)).toBe(false)
    }
  })

  it('reports a missing CLI with the config key, bundled dependency, and status tool', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const spawn = createSpawn({})

    await expect(
      plugin.resolveCodexCli({
        env: { PATH: '' },
        cwd: directory,
        spawn: spawn.spawn,
        bundled: {},
      }),
    ).rejects.toThrow(/codexPath[\s\S]*@openai\/codex[\s\S]*codex_subagent_status/u)
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
        bundled: {},
      }),
    ).rejects.toThrow(/not an executable file[\s\S]*codexPath[\s\S]*codex_subagent_status/u)
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
        bundled: {},
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
        bundled: {},
      }),
    ).rejects.toThrow(/did not report a version/u)
  })

  it('treats an invalid configured executable as terminal and never falls back to PATH', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const configured = writeExecutable(directory, 'configured-codex.exe')
    const pathDirectory = temporaryDirectory()
    const pathCodex = writeExecutable(
      pathDirectory,
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    )
    const spawn = createSpawn({
      versionFor: (argv) =>
        argv.includes(configured)
          ? { exitCode: 1, stderr: 'configured shim exploded' }
          : { text: 'codex-cli 0.164.0\n' },
    })

    await expect(
      plugin.resolveCodexCli({
        codexPath: configured,
        env: { PATH: pathDirectory },
        cwd: directory,
        spawn: spawn.spawn,
        bundled: {},
      }),
    ).rejects.toThrow(/failed `--version`[\s\S]*configured shim exploded/u)
    expect(spawn.argv).toHaveLength(1)
    expect(spawn.argv[0]).toContain(configured)
    expect(spawn.argv[0]?.join(' ')).not.toContain(pathCodex)
  })

  it('treats an invalid bundled executable as terminal and never falls back to PATH', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const bundled = writeExecutable(temporaryDirectory(), 'bundled-codex.exe')
    const pathDirectory = temporaryDirectory()
    const pathCodex = writeExecutable(
      pathDirectory,
      process.platform === 'win32' ? 'codex.exe' : 'codex',
    )
    const spawn = createSpawn({
      versionFor: (argv) =>
        argv.includes(bundled)
          ? { exitCode: 1, stderr: 'bundled binary failed' }
          : { text: 'codex-cli 0.164.0\n' },
    })

    await expect(
      plugin.resolveCodexCli({
        env: { PATH: pathDirectory },
        cwd: directory,
        spawn: spawn.spawn,
        bundled: { path: bundled, version: '0.164.0' },
      }),
    ).rejects.toThrow(/failed `--version`[\s\S]*bundled binary failed/u)
    expect(spawn.argv).toHaveLength(1)
    expect(spawn.argv[0]).toContain(bundled)
    expect(spawn.argv[0]?.join(' ')).not.toContain(pathCodex)
  })

  it('resolves the installed bundled @openai/codex platform binary', async () => {
    const plugin = await loadPlugin()
    const info = plugin.bundledCodexInfo()
    expect(info.version).toBe('0.164.0')
    expect(info.path).toBeDefined()
    if (info.path !== undefined) expect(statSync(info.path).isFile()).toBe(true)
  })
})

describe('Windows command handling', () => {
  it('spawns a .cmd shim through a generated wrapper and cleans it up', async () => {
    const plugin = await loadPlugin()
    const plan = plugin.codexSpawnPlan('tools/codex.cmd', ['app-server', '--stdio'], {
      platform: 'win32',
      env: { ComSpec: 'cmd.exe' },
    })
    expect(plan.argv).toEqual(['cmd.exe', '/d', '/v:off', '/c', '%CODEX_SHIM_WRAPPER%'])
    const wrapper = plan.env[SHIM_WRAPPER_ENV]?.replace(/^"|"$/gu, '')
    expect(wrapper).toBeDefined()
    expect(plan.env[SHIM_EXECUTABLE_ENV]).toBe('tools/codex.cmd')
    expect(plan.env[`${SHIM_ARG_ENV_PREFIX}0`]).toBe('app-server')
    expect(plan.env[`${SHIM_ARG_ENV_PREFIX}1`]).toBe('--stdio')
    if (wrapper !== undefined) {
      expect(existsSync(wrapper)).toBe(true)
      const script = readFileSync(wrapper, 'utf8')
      expect(isAscii(script)).toBe(true)
      expect(script).toContain('"%CODEX_SHIM_EXECUTABLE%"')
      expect(script).toContain('"%CODEX_SHIM_ARG_0%"')
      expect(script).toContain('"%CODEX_SHIM_ARG_1%"')
      expect(script).not.toContain('app-server')
    }
    plan.cleanup()
    if (wrapper !== undefined) expect(existsSync(wrapper)).toBe(false)
  })

  it('spawns a .bat shim through a generated wrapper too', async () => {
    const plugin = await loadPlugin()
    const plan = plugin.codexSpawnPlan('tools/codex.bat', ['--version'], {
      platform: 'win32',
      env: { ComSpec: 'cmd.exe' },
    })
    expect(plan.argv.slice(0, 4)).toEqual(['cmd.exe', '/d', '/v:off', '/c'])
    expect(plan.env[`${SHIM_ARG_ENV_PREFIX}0`]).toBe('--version')
    const wrapper = plan.env[SHIM_WRAPPER_ENV]?.replace(/^"|"$/gu, '')
    if (wrapper !== undefined) {
      expect(readFileSync(wrapper, 'utf8')).toContain('"%CODEX_SHIM_ARG_0%"')
    }
    plan.cleanup()
  })

  it('spawns a .exe directly with no shell wrapper or shim env', async () => {
    const plugin = await loadPlugin()
    const plan = plugin.codexSpawnPlan('tools/codex.exe', ['app-server', '--stdio'], {
      platform: 'win32',
    })
    expect(plan.argv).toEqual(['tools/codex.exe', 'app-server', '--stdio'])
    expect(plan.env).toEqual({})
    plan.cleanup()
  })

  it('rejects a CMD shim argument containing a line break', async () => {
    const plugin = await loadPlugin()
    expect(() => plugin.codexSpawnPlan('tools/codex.cmd', ['a\nb'], { platform: 'win32' })).toThrow(
      /line break/u,
    )
  })

  it.runIf(process.platform === 'win32')(
    'launches a .cmd shim from a space-containing path with quoted app-server args intact',
    async () => {
      const plugin = await loadPlugin()
      const root = join(temporaryDirectory(), 'cmd space test')
      mkdirSync(root, { recursive: true })
      const dumper = join(root, 'argdump.js')
      writeFileSync(dumper, 'console.log(JSON.stringify(process.argv.slice(2)))\n', 'utf8')
      const probe = join(root, 'probe.cmd')
      writeFileSync(probe, `@echo off\r\n"${process.execPath}" "${dumper}" %*\r\n`, 'utf8')
      const cwd = join(root, 'work dir')
      mkdirSync(cwd, { recursive: true })
      const serenaHome = join(root, 'serena home')
      const appServerArgs = plugin.codexAppServerArgs(cwd, serenaHome)

      const runPlan = async (args: string[]): Promise<string[]> => {
        const plan = plugin.codexSpawnPlan(probe, args, {
          platform: 'win32',
          env: { ComSpec: process.env.ComSpec },
        })
        try {
          return await new Promise((resolve, reject) => {
            const child = spawnProcess(plan.argv[0] ?? '', plan.argv.slice(1), {
              cwd,
              env: { ...process.env, ...plan.env },
              stdio: ['ignore', 'pipe', 'pipe'],
            })
            let stdout = ''
            let stderr = ''
            child.stdout.on('data', (chunk: Buffer) => {
              stdout += chunk.toString()
            })
            child.stderr.on('data', (chunk: Buffer) => {
              stderr += chunk.toString()
            })
            child.on('error', reject)
            child.on('exit', (code) => {
              if (code !== 0) {
                reject(new Error(`shim exited ${code}: ${stderr}`))
                return
              }
              const last = stdout.trim().split('\n').at(-1) ?? '[]'
              resolve(JSON.parse(last) as string[])
            })
          })
        } finally {
          plan.cleanup()
        }
      }

      expect(await runPlan(appServerArgs)).toEqual(appServerArgs)
      expect(await runPlan(['--version'])).toEqual(['--version'])
    },
  )

  it.runIf(process.platform === 'win32')(
    'preserves Unicode shim paths and workspace args through an ASCII wrapper',
    async () => {
      const plugin = await loadPlugin()
      const asciiRoot = temporaryDirectory()
      const dumper = join(asciiRoot, 'argdump.js')
      writeFileSync(dumper, 'console.log(JSON.stringify(process.argv.slice(2)))\n', 'utf8')
      const unicodeRoot = join(temporaryDirectory(), 'Кодекс тест')
      mkdirSync(unicodeRoot, { recursive: true })
      const probe = join(unicodeRoot, 'кодекс shim.cmd')
      writeFileSync(probe, `@echo off\r\n"${process.execPath}" "${dumper}" %*\r\n`, 'utf8')
      const cwd = join(unicodeRoot, 'путь')
      mkdirSync(cwd, { recursive: true })
      const serenaHome = join(unicodeRoot, 'serena дом')
      const appServerArgs = plugin.codexAppServerArgs(cwd, serenaHome)

      const runPlan = async (args: string[], codePage?: number): Promise<string[]> => {
        const plan = plugin.codexSpawnPlan(probe, args, {
          platform: 'win32',
          env: { ComSpec: process.env.ComSpec },
        })
        const wrapper = plan.env[SHIM_WRAPPER_ENV]?.replace(/^"|"$/gu, '')
        try {
          if (wrapper !== undefined) {
            expect(isAscii(readFileSync(wrapper, 'utf8'))).toBe(true)
          }
          expect(plan.env[SHIM_EXECUTABLE_ENV]).toContain('кодекс shim.cmd')
          const argv =
            codePage === undefined
              ? plan.argv
              : [
                  process.env.ComSpec ?? 'cmd.exe',
                  '/d',
                  '/v:off',
                  '/c',
                  `chcp ${String(codePage)} >nul & call %CODEX_SHIM_WRAPPER%`,
                ]
          return await new Promise((resolve, reject) => {
            const child = spawnProcess(argv[0] ?? '', argv.slice(1), {
              cwd,
              env: { ...process.env, ...plan.env },
              stdio: ['ignore', 'pipe', 'pipe'],
            })
            let stdout = ''
            let stderr = ''
            child.stdout.on('data', (chunk: Buffer) => {
              stdout += chunk.toString()
            })
            child.stderr.on('data', (chunk: Buffer) => {
              stderr += chunk.toString()
            })
            child.on('error', reject)
            child.on('exit', (code) => {
              if (code !== 0) {
                reject(new Error(`shim exited ${code}: ${stderr}`))
                return
              }
              resolve(JSON.parse(stdout.trim().split('\n').at(-1) ?? '[]') as string[])
            })
          })
        } finally {
          plan.cleanup()
        }
      }

      expect(await runPlan(appServerArgs)).toEqual(appServerArgs)
      expect(await runPlan(['--version'])).toEqual(['--version'])
      expect(await runPlan(appServerArgs, 866)).toEqual(appServerArgs)
    },
  )

  it.runIf(process.platform === 'win32')(
    'keeps CMD metacharacters in the workspace path inert and exact',
    async () => {
      const plugin = await loadPlugin()
      const root = join(temporaryDirectory(), 'cmd & 100% injection test')
      mkdirSync(root, { recursive: true })
      const dumper = join(root, 'argdump.js')
      writeFileSync(dumper, 'console.log(JSON.stringify(process.argv.slice(2)))\n', 'utf8')
      const probe = join(root, 'probe.cmd')
      const batchSafe = (value: string): string => value.replaceAll('%', '%%')
      writeFileSync(
        probe,
        `@echo off\r\n"${batchSafe(process.execPath)}" "${batchSafe(dumper)}" %*\r\n`,
        'utf8',
      )
      const cwd = join(root, 'work & md DSH_INJECTED & rem x 100%')
      mkdirSync(cwd, { recursive: true })
      const appServerArgs = plugin.codexAppServerArgs(cwd, join(root, 'serena home'))
      const plan = plugin.codexSpawnPlan(probe, appServerArgs, {
        platform: 'win32',
        env: { ComSpec: process.env.ComSpec },
      })
      try {
        const received = await new Promise<string[]>((resolve, reject) => {
          const child = spawnProcess(plan.argv[0] ?? '', plan.argv.slice(1), {
            cwd,
            env: { ...process.env, ...plan.env },
            stdio: ['ignore', 'pipe', 'pipe'],
          })
          let stdout = ''
          let stderr = ''
          child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString()
          })
          child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString()
          })
          child.on('error', reject)
          child.on('exit', (code) => {
            if (code !== 0) {
              reject(new Error(`shim exited ${code}: ${stderr}`))
              return
            }
            resolve(JSON.parse(stdout.trim().split('\n').at(-1) ?? '[]') as string[])
          })
        })
        expect(received).toEqual(appServerArgs)
        expect(existsSync(join(cwd, 'DSH_INJECTED'))).toBe(false)
      } finally {
        plan.cleanup()
      }
    },
  )
})

describe('Serena app-server configuration', () => {
  it('pins the Serena MCP command and arguments from the Serena row', async () => {
    const plugin = await loadPlugin()
    expect(plugin.SERENA_MCP_COMMAND).toBe('uvx')
    expect(plugin.SERENA_MCP_ARGS).toEqual([
      '--from',
      'serena-agent==1.7.0',
      'serena',
      'start-mcp-server',
      '--context=vscode',
      '--enable-web-dashboard=false',
      '--enable-gui-log-window=false',
    ])
    expect(plugin.SERENA_DISABLED_TOOLS).toEqual([
      'replace_content',
      'replace_in_files',
      'replace_symbol_body',
      'insert_after_symbol',
      'insert_before_symbol',
      'rename_symbol',
      'safe_delete_symbol',
      'write_memory',
      'edit_memory',
      'delete_memory',
      'rename_memory',
      'activate_project',
    ])
    const args = plugin.codexAppServerArgs('work', 'serena-home')
    const plan = plugin.codexSpawnPlan('tools/codex.exe', args)
    expect(plan.argv).toEqual(['tools/codex.exe', ...args])
    expect(plan.env).toEqual({})
    plan.cleanup()
  })

  it('wraps a Windows .cmd shim around the same fixed app-server args', async () => {
    const plugin = await loadPlugin()
    const args = plugin.codexAppServerArgs('work', 'serena-home')
    const plan = plugin.codexSpawnPlan('tools/codex.cmd', args, {
      platform: 'win32',
      env: { ComSpec: 'cmd.exe' },
    })
    expect(plan.argv).toEqual(['cmd.exe', '/d', '/v:off', '/c', '%CODEX_SHIM_WRAPPER%'])
    const wrapper = plan.env[SHIM_WRAPPER_ENV]?.replace(/^"|"$/gu, '')
    expect(wrapper).toBeDefined()
    expect(Object.values(plan.env).some((value) => value.includes('serena-home'))).toBe(true)
    if (wrapper !== undefined) {
      const script = readFileSync(wrapper, 'utf8')
      expect(script.startsWith('@echo off')).toBe(true)
      expect(isAscii(script)).toBe(true)
      expect(script).toContain('"%CODEX_SHIM_ARG_0%"')
      expect(script).toContain(`"%CODEX_SHIM_ARG_${args.length - 1}%"`)
      expect(script).not.toContain('mcp_servers.serena.cwd=')
    }
    plan.cleanup()
    if (wrapper !== undefined) expect(existsSync(wrapper)).toBe(false)
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
    expect(providers.get('codex-subagent')?.capabilities).toMatchObject({ agentOptions: true })
    expect(providers.get('codex-subagent-write')?.capabilities).toMatchObject({
      agentOptions: true,
    })
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
    expect(appServerArgv?.slice(0, 3)).toEqual([executable, 'app-server', '--stdio'])
    expect(appServerArgv).toContain('mcp_servers.serena.command=uvx')
    const appServerSpec = spawn.specs.find((spec) => spec.argv.includes('app-server'))
    expect(Object.hasOwn(appServerSpec?.env ?? {}, 'CODEX_HOME')).toBe(true)
    expect(appServerSpec?.env.CODEX_HOME).toBeUndefined()
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

  it('maps target model and reasoning effort to thread/start', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'success' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(directory, 'Review the change.', new AbortController().signal, {
        model: 'astra',
        reasoningEffort: 'xhigh',
      }),
    )) as { result: Promise<{ stopReason: string }>; dispose: () => Promise<void> }
    await run.result
    const threadStart = spawn.appServer?.requests.find(
      (request) => request.method === 'thread/start',
    )
    expect(threadStart?.params).toMatchObject({
      model: 'astra',
      config: { model_reasoning_effort: 'xhigh' },
    })
    await run.dispose()
  })

  it('applies provider-default model and effort when a target sets none', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'success' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, {
      codexPath: executable,
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(directory, 'Review the change.', new AbortController().signal),
    )) as { result: Promise<{ stopReason: string }>; dispose: () => Promise<void> }
    await run.result
    const threadStart = spawn.appServer?.requests.find(
      (request) => request.method === 'thread/start',
    )
    expect(threadStart?.params).toMatchObject({
      model: 'gpt-6-astra',
      config: { model_reasoning_effort: 'xhigh' },
    })
    await run.dispose()
  })

  it('reuses the persisted review thread for the same key', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const firstSpawn = createSpawn({ appServerMode: 'success', threadId: 'thread-review-1' })
    const first = createContext(firstSpawn.spawn)
    plugin.apply(first.ctx, { codexPath: executable })
    const firstProvider = first.providers.get('codex-subagent')
    if (firstProvider?.start === undefined) throw new Error('provider missing')

    const firstRun = (await firstProvider.start(
      createStartRequest(directory, 'Review.', new AbortController().signal, {
        reviewKey: 'change-a:task-1',
      }),
    )) as {
      result: Promise<{ stopReason: string; threadId?: string; threadReuse?: string }>
      dispose: () => Promise<void>
    }
    const firstResult = await firstRun.result
    expect(firstResult.stopReason).toBe('completed')
    expect(firstResult.threadReuse).toBe('created')
    expect(firstResult.threadId).toBe('thread-review-1')
    expect(
      firstSpawn.appServer?.requests.find((request) => request.method === 'thread/start')?.params
        ?.ephemeral,
    ).toBe(false)
    const statePath = join(directory, '.dsh', 'delegation', 'codex-review-threads.json')
    expect(readFileSync(statePath, 'utf8')).toContain('thread-review-1')
    await firstRun.dispose()

    const secondSpawn = createSpawn({ appServerMode: 'success' })
    const second = createContext(secondSpawn.spawn)
    plugin.apply(second.ctx, { codexPath: executable })
    const secondProvider = second.providers.get('codex-subagent')
    if (secondProvider?.start === undefined) throw new Error('provider missing')
    const secondRun = (await secondProvider.start(
      createStartRequest(directory, 'Review again.', new AbortController().signal, {
        reviewKey: 'change-a:task-1',
      }),
    )) as {
      result: Promise<{ stopReason: string; threadId?: string; threadReuse?: string }>
      dispose: () => Promise<void>
    }
    const secondResult = await secondRun.result
    expect(secondResult.stopReason).toBe('completed')
    expect(secondResult.threadReuse).toBe('resumed')
    expect(secondResult.threadId).toBe('thread-review-1')
    expect(
      secondSpawn.appServer?.requests.some(
        (request) =>
          request.method === 'thread/resume' && request.params?.threadId === 'thread-review-1',
      ),
    ).toBe(true)
    expect(
      secondSpawn.appServer?.requests.some((request) => request.method === 'thread/start'),
    ).toBe(false)
    await secondRun.dispose()
  })

  it('parses the review key from the stable prompt line', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const key = 'review:fix-delegation-async:task:0123456789abcdef'
    const prompt = `Review the task.\n- Review key: ${key}`
    const firstSpawn = createSpawn({ appServerMode: 'success', threadId: 'thread-prompt-line' })
    const first = createContext(firstSpawn.spawn)
    plugin.apply(first.ctx, { codexPath: executable })
    const firstProvider = first.providers.get('codex-subagent')
    if (firstProvider?.start === undefined) throw new Error('provider missing')
    const firstRun = (await firstProvider.start(
      createStartRequest(directory, prompt, new AbortController().signal),
    )) as {
      result: Promise<{ stopReason: string; threadId?: string; threadReuse?: string }>
      dispose: () => Promise<void>
    }
    const firstResult = await firstRun.result
    expect(firstResult.threadReuse).toBe('created')
    expect(firstResult.threadId).toBe('thread-prompt-line')
    expect(
      readFileSync(join(directory, '.dsh', 'delegation', 'codex-review-threads.json'), 'utf8'),
    ).toContain(key)
    await firstRun.dispose()

    const secondSpawn = createSpawn({ appServerMode: 'success' })
    const second = createContext(secondSpawn.spawn)
    plugin.apply(second.ctx, { codexPath: executable })
    const secondProvider = second.providers.get('codex-subagent')
    if (secondProvider?.start === undefined) throw new Error('provider missing')
    const secondRun = (await secondProvider.start(
      createStartRequest(directory, prompt, new AbortController().signal),
    )) as {
      result: Promise<{ stopReason: string; threadId?: string; threadReuse?: string }>
      dispose: () => Promise<void>
    }
    const secondResult = await secondRun.result
    expect(secondResult.threadReuse).toBe('resumed')
    expect(secondResult.threadId).toBe('thread-prompt-line')
    expect(
      secondSpawn.appServer?.requests.some(
        (request) =>
          request.method === 'thread/resume' && request.params?.threadId === 'thread-prompt-line',
      ),
    ).toBe(true)
    await secondRun.dispose()
  })

  it('starts a new review thread for a different key', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const firstSpawn = createSpawn({ appServerMode: 'success', threadId: 'thread-key-a' })
    const first = createContext(firstSpawn.spawn)
    plugin.apply(first.ctx, { codexPath: executable })
    const firstProvider = first.providers.get('codex-subagent')
    if (firstProvider?.start === undefined) throw new Error('provider missing')
    const firstRun = (await firstProvider.start(
      createStartRequest(directory, 'Review A.', new AbortController().signal, {
        reviewKey: 'change-a:task-1',
      }),
    )) as {
      result: Promise<{ stopReason: string; threadReuse?: string }>
      dispose: () => Promise<void>
    }
    expect((await firstRun.result).threadReuse).toBe('created')
    await firstRun.dispose()

    const secondSpawn = createSpawn({ appServerMode: 'success', threadId: 'thread-key-b' })
    const second = createContext(secondSpawn.spawn)
    plugin.apply(second.ctx, { codexPath: executable })
    const secondProvider = second.providers.get('codex-subagent')
    if (secondProvider?.start === undefined) throw new Error('provider missing')
    const secondRun = (await secondProvider.start(
      createStartRequest(directory, 'Review B.', new AbortController().signal, {
        reviewKey: 'change-a:task-2',
      }),
    )) as {
      result: Promise<{ stopReason: string; threadId?: string; threadReuse?: string }>
      dispose: () => Promise<void>
    }
    const secondResult = await secondRun.result
    expect(secondResult.threadReuse).toBe('created')
    expect(secondResult.threadId).toBe('thread-key-b')
    expect(
      secondSpawn.appServer?.requests.some((request) => request.method === 'thread/resume'),
    ).toBe(false)
    expect(
      secondSpawn.appServer?.requests.some((request) => request.method === 'thread/start'),
    ).toBe(true)
    const state = JSON.parse(
      readFileSync(join(directory, '.dsh', 'delegation', 'codex-review-threads.json'), 'utf8'),
    ) as { threads: { key: string; threadId: string }[] }
    expect(state.threads.map((entry) => entry.key).sort()).toEqual([
      'change-a:task-1',
      'change-a:task-2',
    ])
    await secondRun.dispose()
  })

  it('starts fresh after the persisted state is gone without touching the Codex home', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const userCodexHome = temporaryDirectory()
    const firstSpawn = createSpawn({ appServerMode: 'success', threadId: 'thread-before-restart' })
    const first = createContext(firstSpawn.spawn)
    plugin.apply(first.ctx, { codexPath: executable, env: { CODEX_HOME: userCodexHome } })
    const firstProvider = first.providers.get('codex-subagent')
    if (firstProvider?.start === undefined) throw new Error('provider missing')
    const firstRun = (await firstProvider.start(
      createStartRequest(directory, 'Review.', new AbortController().signal, {
        reviewKey: 'change-a:task-1',
      }),
    )) as { result: Promise<{ stopReason: string }>; dispose: () => Promise<void> }
    await firstRun.result
    await firstRun.dispose()
    rmSync(join(directory, '.dsh'), { recursive: true, force: true })

    const secondSpawn = createSpawn({ appServerMode: 'success', threadId: 'thread-after-restart' })
    const second = createContext(secondSpawn.spawn)
    plugin.apply(second.ctx, { codexPath: executable, env: { CODEX_HOME: userCodexHome } })
    const secondProvider = second.providers.get('codex-subagent')
    if (secondProvider?.start === undefined) throw new Error('provider missing')
    const secondRun = (await secondProvider.start(
      createStartRequest(directory, 'Review after restart.', new AbortController().signal, {
        reviewKey: 'change-a:task-1',
      }),
    )) as {
      result: Promise<{ stopReason: string; threadId?: string; threadReuse?: string }>
      dispose: () => Promise<void>
    }
    const secondResult = await secondRun.result
    expect(secondResult.threadReuse).toBe('created')
    expect(secondResult.threadId).toBe('thread-after-restart')
    expect(
      secondSpawn.appServer?.requests.some((request) => request.method === 'thread/resume'),
    ).toBe(false)
    expect(readdirSync(userCodexHome)).toEqual([])
    await secondRun.dispose()
  })

  it('falls back to a fresh thread when the persisted thread is gone', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const firstSpawn = createSpawn({ appServerMode: 'success', threadId: 'thread-gone' })
    const first = createContext(firstSpawn.spawn)
    plugin.apply(first.ctx, { codexPath: executable })
    const firstProvider = first.providers.get('codex-subagent')
    if (firstProvider?.start === undefined) throw new Error('provider missing')
    const firstRun = (await firstProvider.start(
      createStartRequest(directory, 'Review.', new AbortController().signal, {
        reviewKey: 'change-a:task-1',
      }),
    )) as { result: Promise<{ stopReason: string }>; dispose: () => Promise<void> }
    await firstRun.result
    await firstRun.dispose()

    const secondSpawn = createSpawn({
      appServerMode: 'success',
      threadId: 'thread-fresh',
      resumeError: 'no rollout found for thread id thread-gone',
    })
    const second = createContext(secondSpawn.spawn)
    plugin.apply(second.ctx, { codexPath: executable })
    const secondProvider = second.providers.get('codex-subagent')
    if (secondProvider?.start === undefined) throw new Error('provider missing')
    const secondRun = (await secondProvider.start(
      createStartRequest(directory, 'Review again.', new AbortController().signal, {
        reviewKey: 'change-a:task-1',
      }),
    )) as {
      result: Promise<{ stopReason: string; threadId?: string; threadReuse?: string }>
      dispose: () => Promise<void>
    }
    const secondResult = await secondRun.result
    expect(secondResult.stopReason).toBe('completed')
    expect(secondResult.threadReuse).toBe('created')
    expect(secondResult.threadId).toBe('thread-fresh')
    expect(
      readFileSync(join(directory, '.dsh', 'delegation', 'codex-review-threads.json'), 'utf8'),
    ).toContain('thread-fresh')
    await secondRun.dispose()
  })

  it('passes an effort-only target and keeps the provider default model', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'success' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable, model: 'gpt-6-astra' })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(directory, 'Review the change.', new AbortController().signal, {
        reasoningEffort: 'high',
      }),
    )) as { result: Promise<{ stopReason: string }>; dispose: () => Promise<void> }
    await run.result
    const threadStart = spawn.appServer?.requests.find(
      (request) => request.method === 'thread/start',
    )
    expect(threadStart?.params).toMatchObject({
      model: 'gpt-6-astra',
      config: { model_reasoning_effort: 'high' },
    })
    await run.dispose()
  })

  it('rejects an unsupported target option before starting Codex', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'success' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    await expect(
      provider.start(
        createStartRequest(directory, 'Review.', new AbortController().signal, {
          maxTokens: 4096,
        }),
      ),
    ).rejects.toThrow(/unsupported Codex target option "maxTokens"/u)
    await expect(
      provider.start(
        createStartRequest(directory, 'Review.', new AbortController().signal, {
          reviewKey: '',
        }),
      ),
    ).rejects.toThrow(/target reviewKey must be a non-empty string/u)
    expect(spawn.argv).toEqual([])
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

  it('fails the run with a Serena next action when the required MCP server is missing', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'serena-missing' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    await expect(
      provider.start(
        createStartRequest(directory, 'Review the task.', new AbortController().signal),
      ),
    ).rejects.toThrow(
      /thread-start[\s\S]*serena: required MCP server unavailable[\s\S]*serena-agent==1\.7\.0[\s\S]*retry/u,
    )
  })

  it('enables Serena over an inherited enabled=false for the run', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const spawn = createSpawn({ appServerMode: 'serena-inherited-disabled' })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(directory, 'Review the task.', new AbortController().signal),
    )) as {
      result: Promise<{ output: { text: string }[]; stopReason: string }>
      dispose: () => Promise<void>
    }
    const result = await run.result
    expect(result.stopReason).toBe('completed')
    expect(result.output[0]?.text).toBe('review passed')
    const appServerArgv = spawn.argv.find((argv) => argv.includes('app-server'))
    expect(appServerArgv).toContain('mcp_servers.serena.enabled=true')
    expect(appServerArgv).toContain('mcp_servers.serena.required=true')
    await run.dispose()
  })

  it('disables mutating Serena tools for the read-only provider over inherited approvals', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const mutatedFile = join(temporaryDirectory(), 'mutated-outside-sandbox.txt')
    const spawn = createSpawn({
      appServerMode: 'serena-write-attempt',
      serenaWriteFile: mutatedFile,
    })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(directory, 'Review the task.', new AbortController().signal),
    )) as {
      result: Promise<{ output: unknown[]; stopReason: string; diagnostic?: string }>
      dispose: () => Promise<void>
    }
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(result.diagnostic).toContain('category: product-error')
    expect(existsSync(mutatedFile)).toBe(false)
    const appServerArgv = spawn.argv.find((argv) => argv.includes('app-server'))
    const disabled = appServerArgv?.find((arg) =>
      arg.startsWith('mcp_servers.serena.disabled_tools='),
    )
    expect(disabled).toBeDefined()
    if (disabled !== undefined) {
      expect(JSON.parse(disabled.slice(disabled.indexOf('=') + 1))).toEqual(
        plugin.SERENA_DISABLED_TOOLS,
      )
    }
    await run.dispose()
  })

  it('cannot touch a file outside the patch worktree through Serena from the write provider', async () => {
    const plugin = await loadPlugin()
    const worktree = temporaryDirectory()
    const executable = writeExecutable(worktree, 'codex.exe')
    const outsideFile = join(temporaryDirectory(), 'outside-worktree.txt')
    const spawn = createSpawn({
      appServerMode: 'serena-write-attempt',
      serenaWriteFile: outsideFile,
    })
    const { providers, ctx } = createContext(spawn.spawn)
    plugin.apply(ctx, { codexPath: executable })
    const provider = providers.get('codex-subagent-write')
    if (provider?.start === undefined) throw new Error('provider missing')

    const run = (await provider.start(
      createStartRequest(worktree, 'Fix the bug.', new AbortController().signal),
    )) as {
      result: Promise<{ stopReason: string; diagnostic?: string }>
      dispose: () => Promise<void>
    }
    const result = await run.result
    expect(result.stopReason).toBe('error')
    expect(existsSync(outsideFile)).toBe(false)
    const appServerArgv = spawn.argv.find((argv) => argv.includes('app-server'))
    const disabled = appServerArgv?.find((arg) =>
      arg.startsWith('mcp_servers.serena.disabled_tools='),
    )
    expect(disabled).toBeDefined()
    if (disabled !== undefined) {
      expect(JSON.parse(disabled.slice(disabled.indexOf('=') + 1))).toContain('replace_symbol_body')
    }
    await run.dispose()
  })

  it('cannot run a trusted Serena activation hook from either provider', async () => {
    const plugin = await loadPlugin()
    for (const providerName of ['codex-subagent', 'codex-subagent-write']) {
      const directory = temporaryDirectory()
      const executable = writeExecutable(directory, 'codex.exe')
      const hookFile = join(temporaryDirectory(), 'activation-hook-ran.txt')
      const spawn = createSpawn({
        appServerMode: 'serena-write-attempt',
        serenaTool: 'activate_project',
        serenaWriteFile: hookFile,
      })
      const { providers, ctx } = createContext(spawn.spawn)
      plugin.apply(ctx, { codexPath: executable })
      const provider = providers.get(providerName)
      if (provider?.start === undefined) throw new Error('provider missing')

      const run = (await provider.start(
        createStartRequest(directory, 'Review.', new AbortController().signal),
      )) as {
        result: Promise<{ stopReason: string }>
        dispose: () => Promise<void>
      }
      expect((await run.result).stopReason).toBe('error')
      expect(existsSync(hookFile)).toBe(false)
      const appServerArgv = spawn.argv.find((argv) => argv.includes('app-server'))
      const disabled = appServerArgv?.find((arg) =>
        arg.startsWith('mcp_servers.serena.disabled_tools='),
      )
      expect(disabled).toBeDefined()
      if (disabled !== undefined) {
        expect(JSON.parse(disabled.slice(disabled.indexOf('=') + 1))).toContain('activate_project')
      }
      await run.dispose()
    }
  })

  it('keeps a nested run cwd out of the ancestor checkout and symbol reads working for both instances', async () => {
    const plugin = await loadPlugin()
    for (const providerName of ['codex-subagent', 'codex-subagent-write']) {
      const ancestor = temporaryDirectory()
      const nested = join(ancestor, 'packages', 'plugin')
      mkdirSync(nested, { recursive: true })
      const executable = writeExecutable(nested, 'codex.exe')
      const ancestorProjectYml = join(ancestor, '.serena', 'project.yml')
      mkdirSync(join(ancestor, '.serena'), { recursive: true })
      writeFileSync(ancestorProjectYml, 'project_name: incomplete\n', 'utf8')
      const ancestorBefore = readFileSync(ancestorProjectYml)
      const userSerenaHome = temporaryDirectory()
      writeFileSync(
        join(userSerenaHome, plugin.SERENA_CONFIG_FILENAME),
        'projects: []\ntrusted_project_path_patterns: ["**"]\n',
        'utf8',
      )
      const hookFile = join(temporaryDirectory(), 'activation-hook-ran.txt')
      const spawn = createSpawn({
        appServerMode: 'serena-project-read',
        serenaWriteFile: hookFile,
      })
      const { providers, ctx } = createContext(spawn.spawn)
      plugin.apply(ctx, {
        codexPath: executable,
        env: { SERENA_HOME: userSerenaHome },
      })
      const provider = providers.get(providerName)
      if (provider?.start === undefined) throw new Error('provider missing')

      const run = (await provider.start(
        createStartRequest(nested, 'Find the symbol.', new AbortController().signal),
      )) as {
        result: Promise<{ output: { text: string }[]; stopReason: string }>
        dispose: () => Promise<void>
      }
      const result = await run.result
      expect(result.stopReason).toBe('completed')
      expect(result.output[0]?.text).toBe('symbol found')
      expect(existsSync(hookFile)).toBe(false)
      expect(readFileSync(ancestorProjectYml).equals(ancestorBefore)).toBe(true)

      const appServerSpec = spawn.specs.find((spec) => spec.argv.includes('app-server'))
      const serenaHome = appServerSpec?.env.SERENA_HOME
      expect(serenaHome).toBeDefined()
      expect(serenaHome).not.toBe(userSerenaHome)
      expect(
        appServerSpec?.argv.some(
          (arg) => arg === `mcp_servers.serena.cwd=${JSON.stringify(nested)}`,
        ),
      ).toBe(true)
      const argsArg = appServerSpec?.argv.find((arg) => arg.startsWith('mcp_servers.serena.args='))
      expect(argsArg).toBeDefined()
      if (argsArg !== undefined) {
        const serenaArgs = JSON.parse(argsArg.slice(argsArg.indexOf('=') + 1)) as string[]
        expect(serenaArgs).toContain('--project')
        expect(serenaArgs[serenaArgs.indexOf('--project') + 1]).toBe(nested)
        expect(serenaArgs).not.toContain('--project-from-cwd')
        expect(serenaArgs).not.toContain(ancestor)
      }
      if (typeof serenaHome === 'string') {
        const config = readFileSync(join(serenaHome, plugin.SERENA_CONFIG_FILENAME), 'utf8')
        expect(config).toContain('trusted_project_path_patterns: []')
        expect(config).toContain('project_serena_folder_location:')
        expect(existsSync(join(serenaHome, 'projects', basename(nested)))).toBe(true)
        expect(
          appServerSpec?.argv.some(
            (arg) =>
              arg ===
              `mcp_servers.serena.env.SERENA_HOME=${JSON.stringify(serenaHome.replaceAll('\\', '/'))}`,
          ),
        ).toBe(true)
      }
      await run.dispose()
      if (typeof serenaHome === 'string') expect(existsSync(serenaHome)).toBe(false)
    }
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
    expect(result.diagnostic).toMatch(/not authenticated[\s\S]*login[\s\S]*~\/\.codex/u)
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

  it('reports a config-sourced CLI, bundled version, Serena config, and login command', async () => {
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
      bundledVersion: '0.164.0',
      codexHome: '~/.codex',
    })
    expect(report.loginCommand).toContain('login')
    expect(report.loginCommand).toContain(executable)
    expect(report.serena).toBe(
      'uvx --from serena-agent==1.7.0 serena start-mcp-server --context=vscode --enable-web-dashboard=false --enable-gui-log-window=false --project <run working directory>',
    )
    expect(report.snippet).toContain('- id: dsh-setup-codex-subagent')
    const snippetValue = /codexPath: (.*)$/mu.exec(report.snippet)?.[1]
    expect(snippetValue).toBeDefined()
    if (snippetValue !== undefined) expect(JSON.parse(snippetValue)).toBe(executable)
  })

  it('reports the bundled platform binary when codexPath is omitted', async () => {
    const plugin = await loadPlugin()
    const info = plugin.bundledCodexInfo()
    expect(info.path).toBeDefined()
    const spawn = createSpawn({})
    const tool = await statusTool(spawn.spawn, { env: { PATH: '' } })

    const report = await tool.execute({}, { signal: new AbortController().signal })
    expect(report).toMatchObject({
      found: true,
      path: info.path,
      version: '0.164.0',
      source: 'bundled',
      bundledVersion: '0.164.0',
    })
  })

  it('reports a PATH-sourced CLI when the bundled package is unavailable', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    writeExecutable(directory, process.platform === 'win32' ? 'codex.exe' : 'codex')
    const spawn = createSpawn({})

    const report = await plugin.codexSubagentStatus({
      env: { PATH: directory },
      cwd: directory,
      spawn: spawn.spawn,
      bundled: {},
    })
    expect(report).toMatchObject({ found: true, source: 'PATH' })
    expect(report.path?.startsWith(directory)).toBe(true)
  })

  it('reports a missing CLI with the next actions and a login command', async () => {
    const plugin = await loadPlugin()
    const directory = temporaryDirectory()
    const spawn = createSpawn({})

    const report = await plugin.codexSubagentStatus({
      env: { PATH: '' },
      cwd: directory,
      spawn: spawn.spawn,
      bundled: {},
    })
    expect(report.found).toBe(false)
    expect(report.error).toMatch(/codexPath/u)
    expect(report.error).toMatch(/@openai\/codex/u)
    expect(report.error).toMatch(/codex_subagent_status/u)
    expect(report.loginCommand).toContain('login')
    expect(report.bundledVersion).toBeUndefined()
    expect(report.snippet).toContain('- id: dsh-setup-codex-subagent')
  })

  it('never writes the profile patch or the Codex home', async () => {
    const directory = temporaryDirectory()
    const executable = writeExecutable(directory, 'codex.exe')
    const profile = join(directory, 'cordis.patch.yml')
    writeFileSync(profile, '- id: an-owner-row\n', 'utf8')
    const codexHome = temporaryDirectory()
    const configToml = join(codexHome, 'config.toml')
    const authJson = join(codexHome, 'auth.json')
    writeFileSync(configToml, 'model = "gpt-6-astra"\n', 'utf8')
    writeFileSync(authJson, '{"token":"not-a-real-token"}\n', 'utf8')
    const before = {
      profile: readFileSync(profile),
      config: readFileSync(configToml),
      auth: readFileSync(authJson),
    }
    const spawn = createSpawn({})
    const tool = await statusTool(spawn.spawn, { codexPath: executable })

    await tool.execute({}, { signal: new AbortController().signal })
    expect(readFileSync(profile).equals(before.profile)).toBe(true)
    expect(readFileSync(configToml).equals(before.config)).toBe(true)
    expect(readFileSync(authJson).equals(before.auth)).toBe(true)
  })
})

describe('package provenance and bundled Codex', () => {
  it('declares the upstream MIT base, the bundled Apache-2.0 dependency, and rebase notes', () => {
    const notice = readFileSync(join(packageDir, 'NOTICE'), 'utf8')
    const readme = readFileSync(join(packageDir, 'README.md'), 'utf8')
    const license = readFileSync(join(packageDir, 'LICENSE'), 'utf8')
    expect(notice).toContain('@deepseek-ai/dsh-subagent-codex')
    expect(notice).toContain('0.2.1-rc.3')
    expect(notice).toContain('@openai/codex')
    expect(notice).toContain('Apache-2.0')
    expect(license).toContain('MIT License')
    expect(readme).toContain('Rebase procedure')
    expect(readme).toContain('codex_subagent_status')
    expect(readme).toContain('codexPath')
    expect(readme).toContain('bundled')
  })

  it('pins the bundled package and commits no binary or sign-in automation', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
    const dependencies = manifest.dependencies as Record<string, string>
    expect(dependencies['@openai/codex']).toBe('0.164.0')
    expect(
      (manifest.peerDependencies as Record<string, string>)['@deepseek-ai/dsh-subagent-codex'],
    ).toBeUndefined()
    expect(dependencies['@deepseek-ai/dsh-tool-subagent']).toBeUndefined()

    const source = readFileSync(join(packageDir, 'lib', 'index.js'), 'utf8')
    expect(source).toContain('BUNDLED_CODEX_PACKAGE')
    expect(source).toContain('@openai/codex')
    expect(source).toContain('bundledCodexInfo')
    expect(source).toContain('mcp_servers.serena.command')
    expect(source).toContain('codex_subagent_status')
    expect(source).toContain('codex-subagent-write')
    expect(source).not.toContain('process.execPath')
    expect(source).not.toContain('CODEX_PACKAGE_BIN')
    expect(source).not.toContain('" login"')

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
