import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bankFolderName, createExportScheduler, type ResolvedExportConfig } from '../lib/index.js'
import { type FakeHindsight, fakeArchive, startFakeHindsight } from './fake-hindsight.js'

/**
 * End to end over the real snapshot writer, Git repository, and a fake
 * Hindsight REST server: one export, a content change, and an unchanged repeat.
 */

const tempDirs: string[] = []
const servers: FakeHindsight[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-export-e2e-'))
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

const BANK = 'coding-agent::repo'
const FAST_CLIENT = { pollIntervalMs: 5, operationTimeoutMs: 2_000, requestTimeoutMs: 2_000 }

async function fake(): Promise<FakeHindsight> {
  const server = await startFakeHindsight({ banks: [BANK] })
  servers.push(server)
  return server
}

function storedChunkText(dir: string): string {
  const file = join(dir, 'banks', bankFolderName(BANK), 'documents', '000000.json')
  const document = JSON.parse(readFileSync(file, 'utf8')) as {
    chunks: Array<{ chunk_text: string }>
  }
  return document.chunks[0]?.chunk_text ?? ''
}

/**
 * An existing repository whose `pre-push` hook records every Git push
 * invocation, so the test counts real pushes instead of inferring them from the
 * remote's HEAD.
 */
function repositoryWithPushCounter(
  dir: string,
  remote: string,
  log: string,
): { pushes: () => number } {
  execFileSync('git', ['init', '--initial-branch=main', dir], { stdio: ['ignore', 'pipe', 'pipe'] })
  git(dir, ['remote', 'add', 'origin', remote])
  mkdirSync(join(dir, '.git', 'hooks'), { recursive: true })
  const hook = join(dir, '.git', 'hooks', 'pre-push')
  const script = ['#!/bin/sh', `printf 'push\\n' >> "${log.replaceAll('\\', '/')}"`, 'exit 0', '']
  writeFileSync(hook, script.join('\n'))
  chmodSync(hook, 0o755)
  return {
    pushes: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split(/\r?\n/u)
            .filter((line) => line !== '').length
        : 0,
  }
}

describe('export end to end', () => {
  it('exports, commits, and pushes once per changed snapshot and not at all after that', async () => {
    const root = tempDir()
    const server = await fake()
    const remote = bareRemote(root)
    const config = exportConfig({ dir: join(root, 'repo'), remote })
    const counter = repositoryWithPushCounter(config.dir, remote, join(root, 'pushes.log'))
    const scheduler = createExportScheduler({
      config,
      apiUrl: server.url,
      client: FAST_CLIENT,
    })
    try {
      const first = await scheduler.run('interval')
      expect(first).toMatchObject({
        outcome: 'committed',
        changed: true,
        committed: true,
        pushed: true,
      })
      const firstHead = git(config.dir, ['rev-parse', 'HEAD'])
      expect(git(config.dir, ['rev-list', '--count', 'HEAD'])).toBe('1')
      expect(git(remote, ['rev-parse', 'HEAD'])).toBe(firstHead)
      expect(storedChunkText(config.dir)).toBe('first')
      expect(counter.pushes()).toBe(1)
      const requestsAfterFirst = server.requests.length
      expect(requestsAfterFirst).toBeGreaterThan(0)

      // New bank content: exactly one more commit and one more push.
      server.setArchive(BANK, fakeArchive(BANK, 'second'))
      const second = await scheduler.run('interval')
      expect(second).toMatchObject({
        outcome: 'committed',
        changed: true,
        committed: true,
        pushed: true,
      })
      const secondHead = git(config.dir, ['rev-parse', 'HEAD'])
      expect(secondHead).not.toBe(firstHead)
      expect(git(config.dir, ['rev-list', '--count', 'HEAD'])).toBe('2')
      expect(git(remote, ['rev-parse', 'HEAD'])).toBe(secondHead)
      expect(storedChunkText(config.dir)).toBe('second')
      expect(server.requests.length).toBeGreaterThan(requestsAfterFirst)
      // Exactly one push for the changed cycle, recorded by the pre-push hook.
      expect(counter.pushes()).toBe(2)

      // Identical content again: no commit, no push, and a clean tree.
      const third = await scheduler.run('interval')
      expect(third).toMatchObject({
        outcome: 'unchanged',
        changed: false,
        committed: false,
        pushed: false,
      })
      expect(git(config.dir, ['rev-parse', 'HEAD'])).toBe(secondHead)
      expect(git(config.dir, ['rev-list', '--count', 'HEAD'])).toBe('2')
      expect(git(config.dir, ['status', '--porcelain'])).toBe('')
      // No push for an unchanged cycle.
      expect(counter.pushes()).toBe(2)
    } finally {
      await scheduler.dispose()
    }
  })

  it('does no HTTP and no Git work when the disabled flag is set', async () => {
    const root = tempDir()
    const server = await fake()
    const dir = join(root, 'never-created')
    const config = exportConfig({ enabled: false, dir, remote: bareRemote(root) })
    const scheduler = createExportScheduler({ config, apiUrl: server.url, client: FAST_CLIENT })
    try {
      const result = await scheduler.run('interval')
      expect(result).toMatchObject({ outcome: 'disabled', banks: 0, pushed: false })
      expect(server.requests).toHaveLength(0)
      expect(existsSync(dir)).toBe(false)
    } finally {
      await scheduler.dispose()
    }
  })
})
