import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapRepository, commitSnapshot, pushSnapshot } from '../lib/index.js'

const tempDirs: string[] = []
const servers: Server[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-export-push-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
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

function identity(name: string, email: string): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  }
}

function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function gitTry(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args)
  } catch {
    return undefined
  }
}

function commitIn(dir: string, message: string): void {
  git(dir, ['add', '--all'])
  git(dir, ['commit', '--message', message], identity('Writer', 'writer@localhost'))
}

function seedBare(root: string): { bare: string; seed: string } {
  const bare = join(root, 'remote.git')
  mkdirSync(bare)
  git(bare, ['init', '--bare', '--initial-branch=main'])
  const seed = join(root, 'seed')
  git(root, ['clone', bare, seed])
  writeFileSync(join(seed, 'README.md'), 'seed\n')
  commitIn(seed, 'seed')
  git(seed, ['push', 'origin', 'HEAD'])
  return { bare, seed }
}

function writeSnapshotFile(dir: string, content: string): void {
  writeFileSync(join(dir, 'index.json'), `${JSON.stringify({ content })}\n`)
}

async function unauthorizedServer(): Promise<{ url: string; requests: string[] }> {
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`)
    response.writeHead(401, { 'www-authenticate': 'Basic realm="private"' })
    response.end('authentication required')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  servers.push(server)
  const address = server.address() as AddressInfo
  return { url: `http://127.0.0.1:${address.port}/private.git`, requests }
}

/** An askpass program that records every invocation, to prove it is never run. */
function recordingAskpass(dir: string): { program: string; log: string } {
  const log = join(dir, 'askpass-invocations.txt')
  const program = join(
    dir,
    process.platform === 'win32' ? 'recording-askpass.cmd' : 'recording-askpass.sh',
  )
  const script =
    process.platform === 'win32'
      ? `@echo %* >> "${log}"\r\n@exit /b 1\r\n`
      : `#!/bin/sh\necho "$@" >> "${log}"\nexit 1\n`
  writeFileSync(program, script)
  if (process.platform !== 'win32') chmodSync(program, 0o755)
  return { program, log }
}

describe('automatic push', () => {
  it('keeps the local commit after an authentication failure and pushes it later', async () => {
    const root = tempDir()
    const { bare } = seedBare(root)
    const dir = join(root, 'repo')
    await bootstrapRepository({ dir, remote: bare })
    writeSnapshotFile(dir, 'first')
    expect((await commitSnapshot(dir, { message: 'first export' })).committed).toBe(true)
    const localHead = git(dir, ['rev-parse', 'HEAD'])

    const recorder = recordingAskpass(root)
    const inherited = {
      GIT_ASKPASS: recorder.program,
      SSH_ASKPASS: recorder.program,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'core.askpass',
      GIT_CONFIG_VALUE_0: recorder.program,
    }

    const auth = await unauthorizedServer()
    git(dir, ['remote', 'set-url', 'origin', auth.url])
    const failed = await pushSnapshot(dir, { timeoutMs: 20_000, env: inherited })
    expect(failed.pushed).toBe(false)
    expect(failed.reason).toBeTruthy()
    // The 401 exchange ends the attempt instead of opening a credential dialog.
    expect(auth.requests.length).toBeGreaterThan(0)
    expect(git(dir, ['rev-parse', 'HEAD'])).toBe(localHead)
    expect(git(dir, ['status', '--porcelain'])).toBe('')

    git(dir, ['remote', 'set-url', 'origin', bare])
    const retried = await pushSnapshot(dir, { timeoutMs: 20_000, env: inherited })
    expect(retried.pushed).toBe(true)
    expect(git(bare, ['rev-parse', 'HEAD'])).toBe(localHead)
    // The inherited askpass program never ran: no prompt was ever attempted.
    expect(existsSync(recorder.log)).toBe(false)
  })

  it('does nothing when no remote is configured', async () => {
    const dir = join(tempDir(), 'repo')
    await bootstrapRepository({ dir })
    writeSnapshotFile(dir, 'content')
    await commitSnapshot(dir, { message: 'local only' })
    const result = await pushSnapshot(dir)
    expect(result.pushed).toBe(false)
    expect(result.reason).toContain('no remote')
  })

  it('reconciles a diverged remote with fetch and rebase, never a force push', async () => {
    const root = tempDir()
    const { bare } = seedBare(root)
    const dir = join(root, 'repo')
    await bootstrapRepository({ dir, remote: bare })

    // Another writer advances the remote first.
    const other = join(root, 'other')
    git(root, ['clone', bare, other])
    writeFileSync(join(other, 'other.txt'), 'other\n')
    commitIn(other, 'remote change')
    git(other, ['push', 'origin', 'HEAD'])
    const remoteHead = git(bare, ['rev-parse', 'HEAD'])

    writeSnapshotFile(dir, 'content')
    expect((await commitSnapshot(dir, { message: 'local export' })).committed).toBe(true)
    // A runner without a Git user must still rebase with the exporter's fixed identity.
    const emptyGlobal = join(root, 'empty-gitconfig')
    writeFileSync(emptyGlobal, '')
    const result = await pushSnapshot(dir, {
      timeoutMs: 20_000,
      env: { GIT_CONFIG_GLOBAL: emptyGlobal, GIT_CONFIG_NOSYSTEM: '1' },
    })
    expect(result.pushed).toBe(true)
    // Linear history above the other writer's commit: nothing was overwritten.
    expect(gitTry(bare, ['merge-base', '--is-ancestor', remoteHead, 'HEAD'])).not.toBeUndefined()
    expect(git(bare, ['show', 'HEAD:other.txt']).trim()).toBe('other')
    expect(gitTry(bare, ['cat-file', '-e', 'HEAD:index.json'])).not.toBeUndefined()
    expect(Number(git(bare, ['rev-list', '--count', 'HEAD']))).toBe(3)
  })
})
