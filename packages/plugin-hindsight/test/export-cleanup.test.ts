import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type ExportCycleResult, type ResolvedExportConfig, runExportCycle } from '../lib/index.js'
import { type FakeHindsight, type FakeOperation, startFakeHindsight } from './fake-hindsight.js'

/**
 * The server-side transfer archive is a transient copy: one cycle must delete it
 * as soon as it has the bytes, and later cycles must sweep what earlier versions
 * or a crash left behind. These tests drive the real cycle against the fake
 * server, the real snapshot writer, and a real Git repository.
 */

const tempDirs: string[] = []
const servers: FakeHindsight[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-export-cleanup-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close()
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
  execFileSync('git', ['init', '--bare', '--initial-branch=main', bare], { stdio: 'ignore' })
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

function run(
  config: ResolvedExportConfig,
  server: FakeHindsight,
  options: { now?: () => Date; reported?: string[] } = {},
): Promise<ExportCycleResult> {
  return runExportCycle({
    config,
    apiUrl: server.url,
    client: FAST_CLIENT,
    now: options.now,
    log: (line) => options.reported?.push(line),
  })
}

/**
 * An existing repository whose `pre-commit` hook appends `commit` to the fake
 * server's request log, so one file holds the HTTP calls and the Git commit in
 * the order they actually happened.
 */
function repositoryWithCommitMarker(dir: string, remote: string, log: string): void {
  execFileSync('git', ['init', '--initial-branch=main', dir], { stdio: 'ignore' })
  git(dir, ['remote', 'add', 'origin', remote])
  const hooks = join(dir, '.git', 'hooks')
  mkdirSync(hooks, { recursive: true })
  const marker = log.replaceAll('\\', '/')
  writeFileSync(
    join(hooks, 'pre-commit'),
    ['#!/bin/sh', `printf 'commit\\n' >> "${marker}"`, 'exit 0', ''].join('\n'),
  )
  chmodSync(join(hooks, 'pre-commit'), 0o755)
}

/** The HTTP phases and the commit, in the order the server and Git saw them. */
function phases(log: string): string[] {
  return readFileSync(log, 'utf8')
    .split(/\r?\n/u)
    .filter((line) => line !== '')
    .map((line) => {
      if (line === 'commit') return 'commit'
      const [method, path = ''] = line.split(' ')
      if (path.endsWith('/transfer/export')) return 'export'
      if (path.includes('/files/download/')) return 'download'
      if (path.endsWith('/delete')) return 'delete'
      if (method === 'GET' && /\/operations\/[^/]+$/u.test(path)) return 'poll'
      return 'other'
    })
    .filter((phase) => phase !== 'other')
}

function deletes(server: FakeHindsight): string[] {
  return server.requests
    .filter((request) => request.method === 'DELETE')
    .map((request) => request.path)
}

/** A completed whole-bank export the test seeds into the fake server's backlog. */
function operation(id: string, overrides: Partial<FakeOperation> = {}): FakeOperation {
  return {
    id,
    task_type: 'export_bank',
    status: 'completed',
    created_at: '2026-01-01T10:00:00.000Z',
    ...overrides,
  }
}

/** Two hours after the seeded stale operations completed. */
const CLOCK = new Date('2026-01-01T12:00:00.000Z')

describe('archive cleanup after download', () => {
  it('deletes every bank archive between its download and the snapshot commit', async () => {
    const root = tempDir()
    const log = join(root, 'order.log')
    const server = await fake({ banks: ['a', 'b'], requestLog: log })
    const remote = bareRemote(root)
    const config = exportConfig({ dir: join(root, 'repo'), remote })
    repositoryWithCommitMarker(config.dir, remote, log)

    const result = await run(config, server)

    expect(result).toMatchObject({
      outcome: 'committed',
      changed: true,
      committed: true,
      pushed: true,
    })
    expect(phases(log)).toEqual([
      'export',
      'poll',
      'download',
      'delete',
      'export',
      'poll',
      'download',
      'delete',
      'commit',
    ])
    expect(server.storedArchives()).toEqual([])
  })

  it('deletes every archive when the push fails and keeps the commit for the retry', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['a', 'b'] })
    const missing = join(root, 'missing.git')
    const config = exportConfig({ dir: join(root, 'repo'), remote: missing })
    execFileSync('git', ['init', '--initial-branch=main', config.dir], { stdio: 'ignore' })
    git(config.dir, ['remote', 'add', 'origin', missing])

    const failed = await run(config, server)

    expect(failed).toMatchObject({ outcome: 'committed', committed: true, pushed: false })
    expect(failed.reason).toBeTruthy()
    expect(git(config.dir, ['rev-list', '--count', 'HEAD'])).toBe('1')
    expect(server.storedArchives()).toEqual([])
    expect(deletes(server)).toHaveLength(2)

    // The next cycle retries the kept commit once the remote is reachable.
    const remote = bareRemote(root)
    const retried = await run({ ...config, remote }, server)
    expect(retried).toMatchObject({ outcome: 'unchanged', pushed: true })
    expect(git(remote, ['rev-parse', 'HEAD'])).toBe(git(config.dir, ['rev-parse', 'HEAD']))
    expect(deletes(server)).toHaveLength(4)
  })

  it('keeps the cycle outcome when a delete fails and leaves the operation for the sweep', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['b'], deleteStatus: 500 })
    const config = exportConfig({ dir: join(root, 'repo'), remote: bareRemote(root) })
    const reported: string[] = []

    const result = await run(config, server, { reported })

    expect(result).toMatchObject({ outcome: 'committed', committed: true, pushed: true })
    expect(server.operations.size).toBe(1)
    expect(reported.some((line) => line.includes('bank "b"') && line.includes('500'))).toBe(true)
    expect(git(config.dir, ['status', '--porcelain'])).toBe('')
  })

  it('treats an acknowledged delete with a retained archive as done', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['b'], retainArchiveOnDelete: true })
    const config = exportConfig({ dir: join(root, 'repo') })
    const reported: string[] = []

    const result = await run(config, server, { reported })

    expect(result.outcome).toBe('committed')
    expect(reported).toEqual([])
    expect(server.operations.size).toBe(0)
    expect(deletes(server)).toHaveLength(1)
    // The server's storage step failed, so the blob stays behind with no handle.
    expect(server.storedArchives()).toHaveLength(1)

    // The operation row is gone, so no later cycle retries it.
    const later = await run(config, server, {
      now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
    })
    expect(later.outcome).toBe('unchanged')
    expect(server.operations.size).toBe(0)
  })
})

describe('stale export archive sweep', () => {
  it('deletes only completed export operations older than the grace period', async () => {
    const root = tempDir()
    const server = await fake({
      banks: ['b'],
      operations: [
        operation('stale-export', { created_at: '2026-01-01T09:00:00.000Z' }),
        operation('stale-created-only', { created_at: '2026-01-01T10:00:00.000Z' }),
        operation('recent', { created_at: '2026-01-01T11:30:00.000Z' }),
        operation('pending', { status: 'pending', created_at: '2026-01-01T09:00:00.000Z' }),
        operation('failed', { status: 'failed', created_at: '2026-01-01T09:00:00.000Z' }),
        operation('other-type', { task_type: 'retain', created_at: '2026-01-01T09:00:00.000Z' }),
        operation('unknown-time', { created_at: 'not-a-date' }),
      ],
    })
    const config = exportConfig({ dir: join(root, 'repo') })

    const result = await run(config, server, { now: () => CLOCK })

    expect(result.outcome).toBe('committed')
    expect([...server.operations.keys()].sort()).toEqual([
      'failed',
      'other-type',
      'pending',
      'recent',
      'unknown-time',
    ])
    expect(deletes(server)).toEqual([
      '/v1/default/banks/b/operations/stale-created-only/delete',
      '/v1/default/banks/b/operations/stale-export/delete',
      '/v1/default/banks/b/operations/op-1/delete',
    ])
    // The sweep runs before this cycle submits its own export.
    const submit = server.requests.findIndex((request) => request.path.endsWith('/transfer/export'))
    const lastSwept = server.requests.findIndex((request) =>
      request.path.endsWith('/stale-export/delete'),
    )
    expect(lastSwept).toBeLessThan(submit)
  })

  it('drains a backlog one page of deletions per cycle', async () => {
    const root = tempDir()
    const server = await fake({
      banks: ['b'],
      operations: [
        operation('recent', { created_at: '2026-01-01T11:30:00.000Z' }),
        ...Array.from({ length: 150 }, (_, index) =>
          operation(`stale-${String(index).padStart(3, '0')}`, {
            created_at: '2026-01-01T09:00:00.000Z',
          }),
        ),
      ],
    })
    const config = exportConfig({ dir: join(root, 'repo') })
    const staleDeletes = (): number =>
      deletes(server).filter((path) => path.includes('/operations/stale-')).length

    const first = await run(config, server, { now: () => CLOCK })
    expect(first.outcome).toBe('committed')
    expect(staleDeletes()).toBe(100)
    expect(server.operations.size).toBe(51)

    const second = await run(config, server, { now: () => CLOCK })
    expect(second.outcome).toBe('unchanged')
    expect(staleDeletes()).toBe(150)
    expect([...server.operations.keys()]).toEqual(['recent'])
  })

  it('walks past a full page of recent operations to reach the stale backlog', async () => {
    const root = tempDir()
    const server = await fake({
      banks: ['b'],
      operations: [
        ...Array.from({ length: 100 }, (_, index) =>
          operation(`recent-${String(index).padStart(3, '0')}`, {
            created_at: '2026-01-01T11:30:00.000Z',
          }),
        ),
        ...Array.from({ length: 150 }, (_, index) =>
          operation(`stale-${String(index).padStart(3, '0')}`, {
            created_at: '2026-01-01T09:00:00.000Z',
          }),
        ),
      ],
    })
    const config = exportConfig({ dir: join(root, 'repo') })
    const staleDeletes = (): number =>
      deletes(server).filter((path) => path.includes('/operations/stale-')).length

    const first = await run(config, server, { now: () => CLOCK })
    expect(first.outcome).toBe('committed')
    expect(staleDeletes()).toBe(100)

    const second = await run(config, server, { now: () => CLOCK })
    expect(second.outcome).toBe('unchanged')
    expect(staleDeletes()).toBe(150)
    expect([...server.operations.keys()].filter((id) => id.startsWith('recent-'))).toHaveLength(100)
  })

  it('reports a sweep failure and keeps exporting', async () => {
    const root = tempDir()
    const server = await fake({
      banks: ['b'],
      operations: [operation('stale', { created_at: '2026-01-01T09:00:00.000Z' })],
      deleteStatus: 500,
    })
    const config = exportConfig({ dir: join(root, 'repo') })
    const reported: string[] = []

    const result = await run(config, server, { now: () => CLOCK, reported })

    expect(result).toMatchObject({ outcome: 'committed', committed: true })
    expect(reported.some((line) => line.includes('archive sweep') && line.includes('500'))).toBe(
      true,
    )
    expect(server.operations.has('stale')).toBe(true)
  })

  it('reports cleanup unavailable once and keeps exporting', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['a', 'b'], listStatus: 404 })
    const config = exportConfig({ dir: join(root, 'repo') })
    const reported: string[] = []

    const result = await run(config, server, { reported })

    expect(result).toMatchObject({ outcome: 'committed', committed: true })
    expect(reported.filter((line) => line.includes('cleanup unavailable'))).toHaveLength(1)
    expect(deletes(server)).toEqual([])
  })

  it('stops deleting after the first unsupported delete response', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['a', 'b'], deleteStatus: 405 })
    const config = exportConfig({ dir: join(root, 'repo') })
    const reported: string[] = []

    const result = await run(config, server, { reported })

    expect(result).toMatchObject({ outcome: 'committed', committed: true })
    expect(reported.filter((line) => line.includes('cleanup unavailable'))).toHaveLength(1)
    expect(deletes(server)).toHaveLength(1)
  })

  it('reports a missing delete route as unavailable, not as a deleted operation', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['a', 'b'], missingDeleteRoute: 'json' })
    const config = exportConfig({ dir: join(root, 'repo') })
    const reported: string[] = []

    const result = await run(config, server, { reported })

    expect(result).toMatchObject({ outcome: 'committed', committed: true })
    expect(reported.filter((line) => line.includes('cleanup unavailable'))).toHaveLength(1)
    expect(deletes(server)).toHaveLength(1)
  })

  it('sweeps the archive of an export whose download failed', async () => {
    const root = tempDir()
    const server = await fake({ banks: ['b'], downloadStatus: 500 })
    const config = exportConfig({ dir: join(root, 'repo') })

    const failed = await run(config, server)
    expect(failed.outcome).toBe('failed')
    expect(server.operations.size).toBe(1)
    const stale = [...server.operations.keys()][0] ?? ''

    server.setDownloadStatus(undefined)
    const later = await run(config, server, {
      now: () => new Date(Date.now() + 2 * 60 * 60 * 1000),
    })

    expect(later.outcome).toBe('committed')
    expect(server.operations.has(stale)).toBe(false)
    expect(deletes(server).some((path) => path.includes(stale))).toBe(true)
  })
})
