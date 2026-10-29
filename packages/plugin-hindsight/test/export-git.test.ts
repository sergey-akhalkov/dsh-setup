import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bootstrapRepository,
  commitSnapshot,
  currentBranch,
  EXPORT_GIT_IDENTITY,
  ExportError,
  hasCommits,
} from '../lib/index.js'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-export-git-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
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

function commitCount(dir: string): number {
  try {
    return Number(git(dir, ['rev-list', '--count', 'HEAD']))
  } catch {
    return 0
  }
}

function seedRemote(bare: string, seed: string): void {
  git(tmpdir(), ['clone', bare, seed])
  writeFileSync(join(seed, 'seed.txt'), 'seeded\n')
  git(seed, ['add', '--all'])
  git(seed, [
    '-c',
    'user.name=Seed',
    '-c',
    'user.email=seed@localhost',
    'commit',
    '--message',
    'seed',
  ])
  git(seed, ['push', 'origin', 'HEAD'])
}

describe('export repository bootstrap', () => {
  it('initializes a local repository and commits only when content changed', async () => {
    const root = tempDir()
    const dir = join(root, 'repo')
    const bootstrapped = await bootstrapRepository({ dir })
    expect(bootstrapped.created).toBe('init')
    expect(existsSync(join(dir, '.git'))).toBe(true)
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.export.lock')
    expect(await currentBranch(dir)).toBe('main')
    expect(await hasCommits(dir)).toBe(false)

    writeFileSync(join(dir, 'index.json'), '{"banks":[]}\n')
    // Scratch state must never enter the commit.
    mkdirSync(join(dir, '.export-staging'), { recursive: true })
    writeFileSync(join(dir, '.export-staging', 'scratch'), 'x')
    writeFileSync(join(dir, '.export.lock'), '{}')

    expect((await commitSnapshot(dir, { message: 'first export' })).committed).toBe(true)
    expect(commitCount(dir)).toBe(1)
    expect(git(dir, ['log', '-1', '--format=%an <%ae>'])).toBe(
      `${EXPORT_GIT_IDENTITY.name} <${EXPORT_GIT_IDENTITY.email}>`,
    )
    const tracked = git(dir, ['ls-files'])
    expect(tracked).toContain('index.json')
    expect(tracked).not.toContain('.export.lock')
    expect(tracked).not.toContain('.export-staging')

    expect((await commitSnapshot(dir, { message: 'no-op' })).committed).toBe(false)
    expect(commitCount(dir)).toBe(1)

    writeFileSync(join(dir, 'index.json'), '{"banks":[{"bank_id":"a"}]}\n')
    expect((await commitSnapshot(dir, { message: 'changed' })).committed).toBe(true)
    expect(commitCount(dir)).toBe(2)
  })

  it('clones the configured remote when the directory is missing', async () => {
    const root = tempDir()
    const bare = join(root, 'remote.git')
    mkdirSync(bare)
    git(bare, ['init', '--bare', '--initial-branch=main'])
    seedRemote(bare, join(root, 'seed'))

    const dir = join(root, 'missing', 'repo')
    const bootstrapped = await bootstrapRepository({ dir, remote: bare })
    expect(bootstrapped.created).toBe('clone')
    expect(readFileSync(join(dir, 'seed.txt'), 'utf8').trim()).toBe('seeded')
    expect(git(dir, ['remote', 'get-url', 'origin'])).toBe(bare)
    expect(await hasCommits(dir)).toBe(true)

    // A second bootstrap leaves the repository alone and keeps the remote.
    expect((await bootstrapRepository({ dir, remote: bare })).created).toBe('existing')
  })

  it('refuses a non-empty directory that is not a repository', async () => {
    const root = tempDir()
    const dir = join(root, 'busy')
    mkdirSync(dir)
    writeFileSync(join(dir, 'keep.txt'), 'user data')
    await expect(
      bootstrapRepository({ dir, remote: join(root, 'remote.git') }),
    ).rejects.toBeInstanceOf(ExportError)
    expect(existsSync(join(dir, 'keep.txt'))).toBe(true)
  })

  it('keeps the fixed identity even when the environment names another author', async () => {
    const dir = join(tempDir(), 'repo')
    await bootstrapRepository({ dir })
    writeFileSync(join(dir, 'index.json'), '{}\n')
    const inherited = {
      GIT_AUTHOR_NAME: 'Someone Else',
      GIT_AUTHOR_EMAIL: 'else@example.invalid',
      GIT_COMMITTER_NAME: 'Someone Else',
      GIT_COMMITTER_EMAIL: 'else@example.invalid',
    }
    expect((await commitSnapshot(dir, { message: 'first', env: inherited })).committed).toBe(true)
    const expected = `${EXPORT_GIT_IDENTITY.name} <${EXPORT_GIT_IDENTITY.email}>`
    expect(git(dir, ['log', '-1', '--format=%an <%ae>'])).toBe(expected)
    expect(git(dir, ['log', '-1', '--format=%cn <%ce>'])).toBe(expected)
  })
})
