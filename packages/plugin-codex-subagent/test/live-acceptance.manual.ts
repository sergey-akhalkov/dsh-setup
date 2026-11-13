import { spawn as spawnProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

/**
 * Manual live acceptance for the Codex provider (not part of `pnpm test`).
 *
 * Run with: `pnpm exec vitest run --config scripts/manual/vitest.config.ts`
 *
 * It drives the shipped `lib/index.js` against the real bundled `@openai/codex`
 * binary with real subprocesses and the owner's existing `~/.codex` login. The
 * host seams (`@deepseek-ai/dsh-subagent`, `@deepseek-ai/dsh-tools`) are mocked
 * exactly as the package unit tests mock them; the provider, wire protocol,
 * binary, and status resolution are real. The signed-out case isolates
 * `CODEX_HOME` through a `.cmd` wrapper selected via `codexPath`, so the
 * owner's real login is never touched.
 */

vi.mock('@deepseek-ai/dsh-subagent', () => ({
  NO_START_CAPABILITIES: Object.freeze({
    agentOptions: false,
    agentPreset: false,
    outputSchema: false,
    depthLimit: false,
  }),
  assertPositiveFinite(_prefix: string, name: string, value: number) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive`)
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
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

interface SpawnSpec {
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
}

function realSpawn(spec: SpawnSpec) {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  for (const [key, value] of Object.entries(spec.env)) {
    if (value === undefined) delete env[key]
    else env[key] = value
  }
  const child = spawnProcess(spec.argv[0] ?? '', spec.argv.slice(1), {
    cwd: spec.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
  })
  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    done,
    terminate: () => {
      child.kill('SIGTERM')
    },
    waitForExit: async () => {
      await done
    },
  }
}

async function loadPlugin() {
  return import(pathToFileURL(join(packageDir, 'lib', 'index.js')).href)
}

function createContext() {
  const providers = new Map<
    string,
    { name: string; start: (request: unknown) => Promise<unknown> }
  >()
  const ctx = {
    subagents: {
      registerProvider(provider: { name: string }) {
        providers.set(provider.name, provider as never)
      },
    },
    subprocess: { spawn: realSpawn },
    tools: {
      register() {
        return () => {}
      },
    },
    logger: { warn: () => {} },
  }
  return { ctx, providers }
}

function startRequest(cwd: string, text: string, signal: AbortSignal) {
  return {
    prompt: [{ type: 'text', text }],
    cwd,
    signal,
    agentOptions: { model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
  }
}

describe('live provider acceptance (manual)', () => {
  it('reports status and completes an authenticated run', async () => {
    const plugin = await loadPlugin()
    const report = await plugin.codexSubagentStatus({
      cwd: repoRoot,
      env: process.env as Record<string, string>,
      signal: new AbortController().signal,
      spawn: realSpawn,
    })
    console.log('STATUS', JSON.stringify(report, null, 2))
    expect(report.found).toBe(true)
    expect(report.version).toBe('0.169.0')
    expect(report.source).toBe('bundled')
    expect(report.bundledVersion).toBe('0.169.0')
    expect(report.loginCommand).toContain('login')

    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers.get('codex-subagent')
    if (provider === undefined) throw new Error('provider missing')
    const run = (await provider.start(
      startRequest(
        repoRoot,
        'Reply with exactly the token PROVIDER-0.169.0 and nothing else.',
        new AbortController().signal,
      ),
    )) as {
      result: Promise<{ output: unknown[]; stopReason: string }>
      dispose: () => Promise<void>
    }
    const result = await run.result
    console.log('AUTHENTICATED', JSON.stringify(result, null, 2))
    expect(result.stopReason).toBe('completed')
    await run.dispose()
  }, 180_000)

  it('reports the login next action for an isolated signed-out home', async () => {
    const root = mkdtempSync(join(tmpdir(), 'codex-live-signed-out-'))
    const home = join(root, 'home')
    mkdirSync(home, { recursive: true })
    const requireFromHere = createRequire(pathToFileURL(join(packageDir, 'lib', 'index.js')).href)
    const manifestPath = requireFromHere.resolve('@openai/codex/package.json')
    const vendorRoot = join(
      dirname(createRequire(manifestPath).resolve('@openai/codex-win32-x64/package.json')),
      'vendor',
    )
    const real = join(vendorRoot, 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
    const shim = join(root, 'codex-signed-out.cmd')
    writeFileSync(shim, `@echo off\r\nset "CODEX_HOME=${home}"\r\n"${real}" %*\r\n`, 'utf8')
    try {
      const plugin = await loadPlugin()
      const { ctx, providers } = createContext()
      plugin.apply(ctx, { codexPath: shim })
      const provider = providers.get('codex-subagent')
      if (provider === undefined) throw new Error('provider missing')
      const run = (await provider.start(
        startRequest(repoRoot, 'Signed out check.', new AbortController().signal),
      )) as {
        result: Promise<{ output: unknown[]; stopReason: string; diagnostic?: string }>
        dispose: () => Promise<void>
      }
      const result = await run.result
      console.log('SIGNED-OUT', JSON.stringify(result, null, 2))
      expect(result.stopReason).toBe('error')
      expect(result.diagnostic).toMatch(/HTTP status: 401/u)
      expect(result.diagnostic).toMatch(/login/u)
      await run.dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }, 180_000)
})
