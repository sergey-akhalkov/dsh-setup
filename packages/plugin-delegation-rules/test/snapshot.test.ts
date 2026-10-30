import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createReviewSnapshot,
  defaultGit,
  discardReviewSnapshot,
  type GitRunner,
  sweepReviewSnapshots,
} from '../src/host/index.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function repository(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-snapshot-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'snapshot-test'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'snapshot@example.test'], { cwd: dir })
  return dir
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function change(name: string, dir: string): { name: string; dir: string; reviewReady: boolean } {
  return { name, dir, reviewReady: true }
}

describe('git runner environment and stdin', () => {
  it('writes the payload to the child and closes stdin', async () => {
    const dir = await repository()
    const hash = (
      await defaultGit(['hash-object', '-w', '--stdin'], dir, undefined, undefined, 'payload\n')
    )
      .toString('utf8')
      .trim()
    expect(execFileSync('git', ['cat-file', '-p', hash], { cwd: dir }).toString('utf8')).toBe(
      'payload\n',
    )
  })

  it('closes stdin for an empty payload instead of waiting', async () => {
    const dir = await repository()
    const hash = (
      await defaultGit(['hash-object', '-w', '--stdin'], dir, undefined, undefined, Buffer.alloc(0))
    )
      .toString('utf8')
      .trim()
    expect(execFileSync('git', ['cat-file', '-p', hash], { cwd: dir }).toString('utf8')).toBe('')
  })

  it('merges the extra environment over the inherited one', async () => {
    const dir = await repository()
    const ident = (
      await defaultGit(['var', 'GIT_COMMITTER_IDENT'], dir, undefined, {
        GIT_COMMITTER_NAME: 'snapshot-env',
        GIT_COMMITTER_EMAIL: 'snapshot@example.test',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      })
    ).toString('utf8')
    expect(ident).toContain('snapshot-env')
    expect(ident).toContain('snapshot@example.test')
  })

  it('runs a command that ignores stdin', async () => {
    const dir = await repository()
    const inside = (await defaultGit(['rev-parse', '--is-inside-work-tree'], dir))
      .toString('utf8')
      .trim()
    expect(inside).toBe('true')
  })
})

describe('review snapshot', () => {
  it('captures the exact review input set and the frozen change directory', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), 'ignored.txt\n.dsh/\n.tmp/\nbuild/\n')
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'kept.txt'), 'v1\n')
    await writeFile(join(dir, 'flags.txt'), 'v1\n')
    await writeFile(join(dir, 'tracked-ignored.txt'), 'tracked\n')
    await writeFile(join(dir, 'new-ignored.txt'), 'staged\n')
    await writeFile(join(dir, 'ignored.txt'), 'ignored\n')
    git(dir, ['add', '.gitignore', 'src/kept.txt', 'flags.txt'])
    git(dir, ['add', '-f', 'tracked-ignored.txt'])
    git(dir, ['commit', '-qm', 'base'])

    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    await writeFile(join(changeDir, 'spec.md'), '# spec\n')
    git(dir, ['add', 'openspec'])
    git(dir, ['commit', '-qm', 'change'])
    await rm(join(changeDir, 'spec.md'))
    await writeFile(join(changeDir, 'design.md'), '# design\n')

    await mkdir(join(dir, '.dsh'), { recursive: true })
    await writeFile(join(dir, '.dsh', 'tracked.txt'), 'scratch\n')
    await mkdir(join(dir, '.tmp'), { recursive: true })
    await writeFile(join(dir, '.tmp', 'tracked.txt'), 'temp\n')
    git(dir, ['add', '-f', '.dsh/tracked.txt', '.tmp/tracked.txt'])
    git(dir, ['commit', '-qm', 'scratch'])

    // Staged after every commit, so it is in the index and absent from HEAD.
    git(dir, ['add', '-f', 'new-ignored.txt'])

    git(dir, ['update-index', '--assume-unchanged', 'flags.txt'])
    await writeFile(join(dir, 'flags.txt'), 'working\n')
    await writeFile(join(dir, 'src', 'kept.txt'), 'v2\n')
    await writeFile(join(dir, 'src', 'new.txt'), 'new\n')
    await writeFile(join(dir, 'ignored.txt'), 'changed\n')
    const statusBefore = git(dir, ['status', '--porcelain', '-z'])

    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-a',
      defaultGit,
      new AbortController().signal,
    )
    if (snapshot === undefined) throw new Error('expected a review snapshot')

    expect(await readFile(join(snapshot.worktree, 'src', 'kept.txt'), 'utf8')).toBe('v2\n')
    expect(await readFile(join(snapshot.worktree, 'src', 'new.txt'), 'utf8')).toBe('new\n')
    expect(await readFile(join(snapshot.worktree, 'flags.txt'), 'utf8')).toBe('working\n')
    expect(await readFile(join(snapshot.worktree, 'tracked-ignored.txt'), 'utf8')).toBe('tracked\n')
    expect(await readFile(join(snapshot.worktree, 'new-ignored.txt'), 'utf8')).toBe('staged\n')
    await expect(readFile(join(snapshot.worktree, 'ignored.txt'))).rejects.toThrow()
    await expect(readFile(join(snapshot.worktree, '.dsh', 'tracked.txt'))).rejects.toThrow()
    await expect(readFile(join(snapshot.worktree, '.tmp', 'tracked.txt'))).rejects.toThrow()
    expect(await readFile(join(snapshot.changeDir, 'design.md'), 'utf8')).toBe('# design\n')
    expect(await readFile(join(snapshot.changeDir, 'tasks.md'), 'utf8')).toContain('1.1')
    await expect(readFile(join(snapshot.changeDir, 'spec.md'))).rejects.toThrow()
    expect(git(dir, ['status', '--porcelain', '-z'])).toBe(statusBefore)
    expect(git(dir, ['ls-files', '-v', 'flags.txt']).startsWith('h')).toBe(true)

    await discardReviewSnapshot(dir, 'run-a', defaultGit)
    await expect(readFile(join(snapshot.worktree, 'src', 'kept.txt'))).rejects.toThrow()
  })

  it('snapshots an unborn repository without an index', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    await writeFile(join(dir, 'a.txt'), 'a\n')

    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-b',
      defaultGit,
      new AbortController().signal,
    )
    if (snapshot === undefined) throw new Error('expected a review snapshot')
    expect(await readFile(join(snapshot.worktree, 'a.txt'), 'utf8')).toBe('a\n')
    expect(await readFile(join(snapshot.changeDir, 'tasks.md'), 'utf8')).toContain('1.1')
    await discardReviewSnapshot(dir, 'run-b', defaultGit)
  })

  it('falls back when .dsh is not ignored', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), 'ignored.txt\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-c',
      defaultGit,
      new AbortController().signal,
    )
    expect(snapshot).toBeUndefined()
  })

  it('falls back when the change directory is outside the repository', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-'))
    cleanups.push(() => rm(outside, { recursive: true, force: true }))
    await writeFile(join(outside, 'tasks.md'), '- [x] 1.1 Task\n')
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', outside),
      'run-d',
      defaultGit,
      new AbortController().signal,
    )
    expect(snapshot).toBeUndefined()
  })

  it('falls back while the index has unmerged entries', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    await writeFile(join(dir, 'conflict.txt'), 'base\n')
    git(dir, ['add', '.gitignore', 'conflict.txt'])
    git(dir, ['commit', '-qm', 'base'])
    const base = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']).trim()
    git(dir, ['checkout', '-qb', 'side'])
    await writeFile(join(dir, 'conflict.txt'), 'side\n')
    git(dir, ['commit', '-qam', 'side'])
    git(dir, ['checkout', '-q', base])
    await writeFile(join(dir, 'conflict.txt'), 'main\n')
    git(dir, ['commit', '-qam', 'main'])
    try {
      git(dir, ['merge', 'side'])
    } catch {
      // Expected: the merge leaves unmerged index entries.
    }
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-e',
      defaultGit,
      new AbortController().signal,
    )
    expect(snapshot).toBeUndefined()
  })
})

async function lifecycleFixture(runId: string): Promise<{
  dir: string
  snapshot: NonNullable<Awaited<ReturnType<typeof createReviewSnapshot>>>
}> {
  const dir = await repository()
  await writeFile(join(dir, '.gitignore'), '.dsh/\n')
  const changeDir = join(dir, 'openspec', 'changes', 'change-a')
  await mkdir(changeDir, { recursive: true })
  await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
  await writeFile(join(dir, 'a.txt'), 'a\n')
  const snapshot = await createReviewSnapshot(
    dir,
    change('change-a', changeDir),
    runId,
    defaultGit,
    new AbortController().signal,
  )
  if (snapshot === undefined) throw new Error('expected a review snapshot')
  return { dir, snapshot }
}

describe('snapshot lifecycle', () => {
  it('writes a lease and removes it with the checkout', async () => {
    const { dir, snapshot } = await lifecycleFixture('run-lease')
    const lease = `${snapshot.worktree}.lease`
    const value = JSON.parse(await readFile(lease, 'utf8')) as { expiresAt: number }
    expect(value.expiresAt).toBeGreaterThan(Date.now())
    await discardReviewSnapshot(dir, 'run-lease', defaultGit)
    await expect(readFile(lease)).rejects.toThrow()
    await expect(readFile(join(snapshot.worktree, 'a.txt'))).rejects.toThrow()
  })

  it('keeps a valid lease past the review timeout and sweeps it once expired', async () => {
    const { dir, snapshot } = await lifecycleFixture('run-long')
    const base = Date.now()
    await writeFile(
      `${snapshot.worktree}.lease`,
      JSON.stringify({ runId: 'run-long', expiresAt: base + 2 * 60 * 60_000 }),
    )
    await utimes(
      snapshot.worktree,
      new Date(base - 2 * 60 * 60_000),
      new Date(base - 2 * 60 * 60_000),
    )
    await sweepReviewSnapshots(dir, defaultGit, base + 60 * 60_000)
    expect(await readFile(join(snapshot.worktree, 'a.txt'), 'utf8')).toBe('a\n')
    await sweepReviewSnapshots(dir, defaultGit, base + 3 * 60 * 60_000)
    await expect(readFile(join(snapshot.worktree, 'a.txt'))).rejects.toThrow()
  })

  it('sweeps a lease-less leftover only after the grace period', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    await mkdir(join(snapshots, 'run-leftover'), { recursive: true })
    const now = Date.now()
    await sweepReviewSnapshots(dir, defaultGit, now + 60_000)
    expect(await readdir(snapshots)).toContain('run-leftover')
    await sweepReviewSnapshots(dir, defaultGit, now + 11 * 60_000)
    expect(await readdir(snapshots)).not.toContain('run-leftover')
  })

  it('sweeps a leftover whose lease expired after a failed settle removal', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    const leftover = join(snapshots, 'run-stale')
    await mkdir(leftover, { recursive: true })
    await writeFile(
      `${leftover}.lease`,
      JSON.stringify({ runId: 'run-stale', expiresAt: Date.now() - 1_000 }),
    )
    await sweepReviewSnapshots(dir, defaultGit, Date.now())
    expect(await readdir(snapshots)).not.toContain('run-stale')
  })

  it('keeps working when the sweep itself fails', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    await mkdir(join(snapshots, 'run-broken'), { recursive: true })
    const failing: GitRunner = async () => {
      throw new Error('git is unavailable')
    }
    await expect(sweepReviewSnapshots(dir, failing, Date.now())).resolves.toBeUndefined()
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-after-failure',
      defaultGit,
      new AbortController().signal,
    )
    expect(snapshot).toBeDefined()
    await discardReviewSnapshot(dir, 'run-after-failure', defaultGit)
  })
})
