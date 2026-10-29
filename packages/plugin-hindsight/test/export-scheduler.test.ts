import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bankFolderName,
  createExportScheduler,
  type ResolvedExportConfig,
  runExportCycle,
} from '../lib/index.js'
import { type FakeHindsight, startFakeHindsight } from './fake-hindsight.js'

const tempDirs: string[] = []
const servers: FakeHindsight[] = []
const hanging: ReturnType<typeof createServer>[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-export-cycle-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
  for (const server of hanging.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
  for (const dir of tempDirs.splice(0)) {
    if (!dir.startsWith(tmpdir())) throw new Error(`refusing to remove ${dir}`)
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
    } catch {
      // Windows keeps read-only Git object files briefly; %TEMP% may clean up.
    }
  }
})

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function bareRemote(root: string): string {
  const bare = join(root, 'remote.git')
  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return bare
}

function exportConfig(overrides: Partial<ResolvedExportConfig> = {}): ResolvedExportConfig {
  return {
    enabled: true,
    dir: tempDir(),
    intervalMinutes: 5,
    autoCommit: true,
    autoPush: true,
    includeHistory: false,
    includeAttachments: false,
    importOnEmpty: false,
    ...overrides,
  }
}

const FAST_CLIENT = { pollIntervalMs: 5, operationTimeoutMs: 2_000, requestTimeoutMs: 2_000 }

async function fake(
  options: Parameters<typeof startFakeHindsight>[0] = {},
): Promise<FakeHindsight> {
  const server = await startFakeHindsight(options)
  servers.push(server)
  return server
}

/** A port nothing listens on: bind, read, and close immediately. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe('export cycle', () => {
  it('does nothing at all when export is disabled', async () => {
    const server = await fake({ banks: ['b'] })
    const dir = join(tempDir(), 'never-created')
    const result = await runExportCycle({
      config: exportConfig({ enabled: false, dir }),
      apiUrl: server.url,
      client: FAST_CLIENT,
    })
    expect(result.outcome).toBe('disabled')
    expect(server.requests).toHaveLength(0)
    expect(existsSync(dir)).toBe(false)
  })

  it('exports every bank, commits one snapshot, and pushes it', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['coding-agent::repo', 'dsh-hindsight-other'] })
    const remote = bareRemote(root)
    const config = exportConfig({ dir: join(root, 'repo'), remote })
    const result = await runExportCycle({
      config,
      apiUrl: server.url,
      client: FAST_CLIENT,
    })
    expect(result).toMatchObject({
      outcome: 'committed',
      banks: 2,
      changed: true,
      committed: true,
      pushed: true,
    })
    const folder = join(config.dir, 'banks', bankFolderName('coding-agent::repo'))
    expect(existsSync(join(folder, 'export.json'))).toBe(true)
    expect(existsSync(join(folder, 'manifest.json'))).toBe(true)
    expect(existsSync(join(folder, 'history'))).toBe(false)
    expect(existsSync(join(config.dir, 'index.json'))).toBe(true)
    const localHead = git(config.dir, ['rev-parse', 'HEAD'])
    expect(git(remote, ['rev-parse', 'HEAD'])).toBe(localHead)
    expect(git(config.dir, ['log', '--format=%s'])).toContain('snapshot: 2 bank(s)')
    const index = JSON.parse(readFileSync(join(config.dir, 'index.json'), 'utf8')) as {
      banks: Array<{ bank_id: string }>
    }
    expect(index.banks.map((bank) => bank.bank_id).sort()).toEqual([
      'coding-agent::repo',
      'dsh-hindsight-other',
    ])
  })

  it('fails open and reports when the daemon is down', async () => {
    const port = await closedPort()
    const logs: string[] = []
    const config = exportConfig({ dir: join(tempDir(), 'repo') })
    const result = await runExportCycle({
      config,
      apiUrl: `http://127.0.0.1:${port}`,
      client: FAST_CLIENT,
      log: (line) => logs.push(line),
    })
    expect(result.outcome).toBe('failed')
    expect(result.reason).toContain('unreachable')
    expect(logs.join('\n')).toContain('cycle failed')
    expect(logs.join('\n')).toContain('Hindsight is unreachable')
  })

  it('retries a failed push on a later cycle with identical content and no new commit', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['b'] })
    const remote = bareRemote(root)
    const port = await closedPort()
    const unreachable = `http://127.0.0.1:${port}/private.git`
    const dir = join(root, 'repo')

    // First export: local commit only, because no remote is configured yet.
    const first = await runExportCycle({
      config: exportConfig({ dir }),
      apiUrl: server.url,
      client: FAST_CLIENT,
    })
    expect(first).toMatchObject({ outcome: 'committed', committed: true, pushed: false })
    expect(Number(git(dir, ['rev-list', '--count', 'HEAD']))).toBe(1)

    // Same content, now with an unreachable remote: the push fails, the commit stays.
    const failed = await runExportCycle({
      config: exportConfig({ dir, remote: unreachable }),
      apiUrl: server.url,
      client: FAST_CLIENT,
    })
    expect(failed).toMatchObject({ changed: false, committed: false, pushed: false })
    expect(failed.reason).toBeTruthy()
    expect(Number(git(dir, ['rev-list', '--count', 'HEAD']))).toBe(1)

    // Next cycle still exports identical content and publishes the retained commit.
    const retried = await runExportCycle({
      config: exportConfig({ dir, remote }),
      apiUrl: server.url,
      client: FAST_CLIENT,
    })
    expect(retried).toMatchObject({ changed: false, committed: false, pushed: true })
    expect(Number(git(dir, ['rev-list', '--count', 'HEAD']))).toBe(1)
    expect(git(remote, ['rev-parse', 'HEAD'])).toBe(git(dir, ['rev-parse', 'HEAD']))

    // Nothing left to publish: a further identical cycle does not push again.
    const settled = await runExportCycle({
      config: exportConfig({ dir, remote }),
      apiUrl: server.url,
      client: FAST_CLIENT,
    })
    expect(settled).toMatchObject({ changed: false, committed: false, pushed: false })
  })
})

describe('export scheduler', () => {
  it('runs one cycle at a time and debounces an idle trigger', async () => {
    const server = await fake({ banks: ['b'], pendingPolls: 2 })
    const scheduler = createExportScheduler({
      config: exportConfig({ dir: join(tempDir(), 'repo') }),
      apiUrl: server.url,
      client: FAST_CLIENT,
      idleDebounceMs: 60_000,
    })
    const [first, second] = await Promise.all([
      scheduler.run('interval'),
      scheduler.run('interval'),
    ])
    expect([first, second].filter((result) => result !== undefined)).toHaveLength(1)
    // The idle trigger is inside the debounce window, even now that the cycle ended.
    expect(await scheduler.run('idle')).toBeUndefined()
    await scheduler.dispose()
    expect(await scheduler.run('interval')).toBeUndefined()
  })

  it('resolves dispose quickly while a cycle hangs, without an unhandled rejection', async () => {
    const server = createServer(() => {
      // Accept the request and never answer: the in-flight cycle stays pending.
    })
    hanging.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
    const port = (server.address() as AddressInfo).port
    const scheduler = createExportScheduler({
      config: exportConfig({ dir: join(tempDir(), 'repo') }),
      apiUrl: `http://127.0.0.1:${port}`,
      client: { requestTimeoutMs: 30_000, operationTimeoutMs: 30_000 },
      disposeTimeoutMs: 100,
    })
    void scheduler.run('interval')
    await new Promise((resolve) => setTimeout(resolve, 25))
    const started = Date.now()
    await scheduler.dispose()
    expect(Date.now() - started).toBeLessThan(2_000)
  })
})
