import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { specDigest } from '../src/host/evidence.ts'
import { defaultGit, type GitRunner } from '../src/host/git.ts'
import {
  changedInputPaths,
  createReviewSnapshot,
  discardReviewSnapshot,
  reviewedInputs,
  reviewSnapshotName,
  signatureHash,
  startSnapshotLease,
  stopSnapshotLease,
  sweepReviewSnapshots,
} from '../src/host/review-snapshot.ts'

const cleanups: Array<() => Promise<void>> = []
const SNAPSHOTS = join('.dsh', 'workflows', 'snapshots')
const SCRATCH = join('.dsh', 'workflows', 'scratch')

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function repository(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'workflows-snapshot-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'snapshot-test'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'snapshot@example.test'], { cwd: dir })
  return dir
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' })
}

function change(name: string, dir: string): { name: string; dir: string } {
  return { name, dir }
}

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

  it('rejects when stdin delivery fails even if the child exits zero', async () => {
    const dir = await repository()
    const payload = 'x'.repeat(8 * 1024 * 1024)
    await expect(defaultGit(['version'], dir, undefined, undefined, payload)).rejects.toThrow(
      /stdin/,
    )
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
    await writeFile(
      join(dir, '.gitignore'),
      'ignored.txt\ntracked-ignored.txt\nnew-ignored.txt\n.dsh/\n.tmp/\nbuild/\n',
    )
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
    // Both fixtures really match an ignore rule, and the working tree is newer
    // than the index so the assertions prove the snapshot used the worktree.
    git(dir, ['check-ignore', '-q', '--no-index', 'tracked-ignored.txt'])
    git(dir, ['check-ignore', '-q', '--no-index', 'new-ignored.txt'])
    await writeFile(join(dir, 'tracked-ignored.txt'), 'tracked working\n')
    await writeFile(join(dir, 'new-ignored.txt'), 'staged working\n')

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
    expect(await readFile(join(snapshot.worktree, 'tracked-ignored.txt'), 'utf8')).toBe(
      'tracked working\n',
    )
    expect(await readFile(join(snapshot.worktree, 'new-ignored.txt'), 'utf8')).toBe(
      'staged working\n',
    )
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
    let reason: string | undefined
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-c',
      defaultGit,
      new AbortController().signal,
      undefined,
      (value) => {
        reason = value
      },
    )
    expect(snapshot).toBeUndefined()
    expect(reason).toContain('not Git-ignored')
  })

  it('falls back when the change directory is outside the repository', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const outside = await mkdtemp(join(tmpdir(), 'workflows-outside-'))
    cleanups.push(() => rm(outside, { recursive: true, force: true }))
    await writeFile(join(outside, 'tasks.md'), '- [x] 1.1 Task\n')
    let reason: string | undefined
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', outside),
      'run-d',
      defaultGit,
      new AbortController().signal,
      undefined,
      (value) => {
        reason = value
      },
    )
    expect(snapshot).toBeUndefined()
    expect(reason).toContain('outside the repository')
  })

  it('reports a snapshot build failure once', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    let reason: string | undefined
    let calls = 0
    const failingGit: typeof defaultGit = async (args, cwd, signal, env, stdin) => {
      if (args[0] === 'write-tree') throw new Error('injected write-tree failure')
      return defaultGit(args, cwd, signal, env, stdin)
    }
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-e',
      failingGit,
      new AbortController().signal,
      undefined,
      (value) => {
        calls += 1
        reason = value
      },
    )
    expect(snapshot).toBeUndefined()
    expect(calls).toBe(1)
    expect(reason).toContain('could not be built')
  })

  it('resolves the repository through a linked checkout path', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    await writeFile(join(dir, 'a.txt'), 'a\n')
    const parent = await mkdtemp(join(tmpdir(), 'workflows-linked-'))
    cleanups.push(() => rm(parent, { recursive: true, force: true }))
    const linked = join(parent, 'repo')
    await symlink(dir, linked, process.platform === 'win32' ? 'junction' : 'dir')
    const snapshot = await createReviewSnapshot(
      linked,
      change('change-a', join(linked, 'openspec', 'changes', 'change-a')),
      'run-linked-path',
      defaultGit,
      new AbortController().signal,
    )
    if (snapshot === undefined) {
      throw new Error('expected a review snapshot through a linked path')
    }
    expect(await readFile(join(snapshot.worktree, 'a.txt'), 'utf8')).toBe('a\n')
    await discardReviewSnapshot(linked, 'run-linked-path', defaultGit)
  })

  it('falls back when the change directory links outside the repository', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const outside = await mkdtemp(join(tmpdir(), 'workflows-outside-link-'))
    cleanups.push(() => rm(outside, { recursive: true, force: true }))
    const outsideChange = join(outside, 'change-a')
    await mkdir(outsideChange, { recursive: true })
    await writeFile(join(outsideChange, 'tasks.md'), '- [x] 1.1 Task\n')
    await mkdir(join(dir, 'openspec', 'changes'), { recursive: true })
    const link = join(dir, 'openspec', 'changes', 'change-a')
    await symlink(outsideChange, link, process.platform === 'win32' ? 'junction' : 'dir')
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', link),
      'run-link',
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

describe('snapshot lifecycle', () => {
  it('freezes the change-artifact digest with the copy', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    await writeFile(join(changeDir, 'proposal.md'), '# proposal\n')
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-spec',
      defaultGit,
      new AbortController().signal,
      async () => {
        // The edit lands after the live directory was copied and before the
        // digest is computed; the digest must describe the frozen copy.
        await writeFile(join(changeDir, 'proposal.md'), '# edited between copy and hash\n')
      },
    )
    if (snapshot === undefined) throw new Error('expected a review snapshot')
    expect(snapshot.specDigest).toBe(await specDigest(snapshot.changeDir))
    expect(await specDigest(changeDir)).not.toBe(snapshot.specDigest)
    await discardReviewSnapshot(dir, 'run-spec', defaultGit)
  })

  it('writes a lease and removes it with the checkout', async () => {
    const { dir, snapshot } = await lifecycleFixture('run-lease')
    const name = reviewSnapshotName('run-lease')
    expect(snapshot.worktree).toBe(join(dir, SNAPSHOTS, name))
    const lease = `${snapshot.worktree}.lease`
    const scratch = join(dir, SCRATCH, `${name}.index`)
    const value = JSON.parse(await readFile(lease, 'utf8')) as { expiresAt: number }
    expect(value.expiresAt).toBeGreaterThan(Date.now())
    await expect(readFile(scratch)).resolves.toBeDefined()
    await discardReviewSnapshot(dir, 'run-lease', defaultGit)
    await expect(readFile(lease)).rejects.toThrow()
    await expect(readFile(scratch)).rejects.toThrow()
    await expect(readFile(join(snapshot.worktree, 'a.txt'))).rejects.toThrow()
  })

  it('keeps one stable path per unit key and rebuilds a leftover checkout', async () => {
    // A unit key contains separators and spaces; the path must stay one safe
    // segment and the same across rounds so the provider can resume its thread.
    const key = 'review:change-a:section:1 Engine setup'
    const name = reviewSnapshotName(key)
    expect(name).toMatch(/^[a-z0-9-]+$/u)
    expect(name).not.toContain('..')
    expect(name.length).toBeLessThanOrEqual(64)
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    await writeFile(join(dir, 'a.txt'), 'a\n')
    const first = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      key,
      defaultGit,
      new AbortController().signal,
    )
    if (first === undefined) throw new Error('expected a review snapshot')
    expect(first.worktree).toBe(join(dir, SNAPSHOTS, name))
    // The next round rebuilds the same path over the leftover, not a new one.
    const second = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      key,
      defaultGit,
      new AbortController().signal,
    )
    if (second === undefined) throw new Error('expected the rebuilt snapshot')
    expect(second.worktree).toBe(first.worktree)
    expect(await readFile(join(second.worktree, 'a.txt'), 'utf8')).toBe('a\n')
    await discardReviewSnapshot(dir, key, defaultGit)
    await expect(readFile(join(second.worktree, 'a.txt'))).rejects.toThrow()
    expect(reviewSnapshotName('review:change-a:section:2')).not.toBe(name)
  })

  it('never deletes a checkout a newer owner prepared', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    await writeFile(join(dir, 'a.txt'), 'a\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    const signal = new AbortController().signal
    const key = 'review:change-a:task:t1'
    const first = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      key,
      defaultGit,
      signal,
      undefined,
      undefined,
      'run-owner-1',
    )
    if (first === undefined) throw new Error('expected a snapshot')
    // A successor rebuilds the same stable path and owns the fresh lease.
    const second = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      key,
      defaultGit,
      signal,
      undefined,
      undefined,
      'run-owner-2',
    )
    if (second === undefined) throw new Error('expected the rebuilt snapshot')
    // The predecessor's delayed cleanup must not delete the successor's
    // checkout: its lease names a different owner.
    await discardReviewSnapshot(dir, key, defaultGit, undefined, 'run-owner-1')
    expect(await readFile(join(second.worktree, 'a.txt'), 'utf8')).toBe('a\n')
    await discardReviewSnapshot(dir, key, defaultGit, undefined, 'run-owner-2')
    await expect(readFile(join(second.worktree, 'a.txt'))).rejects.toThrow()
  })

  it('serializes a delayed cleanup and a successor rebuild of one stable unit path', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    await writeFile(join(dir, 'a.txt'), 'a\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    const signal = new AbortController().signal
    const key = 'review:change-a:task:t1'
    const first = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      key,
      defaultGit,
      signal,
      undefined,
      undefined,
      'run-owner-1',
    )
    if (first === undefined) throw new Error('expected a snapshot')
    // The predecessor's cleanup passes its lease guard and then stalls inside
    // the removal. Its deletions run after a concurrent rebuild of the same
    // path would have finished, which is exactly what must not delete it.
    let paused = (): void => undefined
    const pausedGate = new Promise<void>((resolve) => {
      paused = resolve
    })
    let release = (): void => undefined
    const releaseGate = new Promise<void>((resolve) => {
      release = resolve
    })
    let pausedOnce = false
    const removeHook = async (path: string): Promise<void> => {
      if (!pausedOnce) {
        pausedOnce = true
        paused()
        await releaseGate
        await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
      await rm(path, { recursive: true, force: true })
    }
    const discarding = discardReviewSnapshot(dir, key, defaultGit, removeHook, 'run-owner-1')
    await pausedGate
    const rebuilding = createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      key,
      defaultGit,
      signal,
      undefined,
      undefined,
      'run-owner-2',
    )
    release()
    const rebuilt = await rebuilding
    await discarding
    const name = reviewSnapshotName(key)
    if (rebuilt === undefined) throw new Error('expected the rebuilt snapshot')
    expect(rebuilt.worktree).toBe(first.worktree)
    expect(await readFile(join(rebuilt.worktree, 'a.txt'), 'utf8')).toBe('a\n')
    const lease = JSON.parse(await readFile(join(dir, SNAPSHOTS, `${name}.lease`), 'utf8')) as {
      owner?: string
    }
    expect(lease.owner).toBe('run-owner-2')
    await discardReviewSnapshot(dir, key, defaultGit)
  })

  it('sweeps a lease-less checkout without overwriting another lane thread', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    await writeFile(join(dir, 'a.txt'), 'a\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    const keyA = 'review:change-a:section:1'
    const keyB = 'review:change-a:section:2'
    const first = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      keyA,
      defaultGit,
      new AbortController().signal,
    )
    if (first === undefined) throw new Error('expected a snapshot')
    // The stale leftover carries an obsolete copy of another lane's thread.
    const delegation = join(first.worktree, '.dsh', 'delegation')
    await mkdir(delegation, { recursive: true })
    await writeFile(
      join(delegation, 'codex-review-threads.json'),
      JSON.stringify({
        version: 1,
        threads: [
          { key: keyB, threadId: 'thread-b-stale', cwd: first.worktree, sandbox: 'read-only' },
        ],
      }),
    )
    // The durable map already holds a newer thread for that lane.
    const durable = join(dir, '.dsh', 'workflows', 'review-threads.json')
    await mkdir(join(dir, '.dsh', 'workflows'), { recursive: true })
    await writeFile(
      durable,
      JSON.stringify({ version: 1, threads: [{ key: keyB, threadId: 'thread-b-new' }] }),
    )
    // A lease-less leftover has no known owner, so the sweep must not merge any
    // thread entry into the durable map.
    await stopSnapshotLease(dir, keyA)
    await rm(`${first.worktree}.lease`, { force: true })
    await sweepReviewSnapshots(dir, defaultGit, Date.now() + 24 * 60 * 60_000)
    const map = JSON.parse(await readFile(durable, 'utf8')) as {
      threads: Array<{ key: string; threadId: string }>
    }
    expect(new Map(map.threads.map((entry) => [entry.key, entry.threadId])).get(keyB)).toBe(
      'thread-b-new',
    )
    await expect(readFile(join(first.worktree, 'a.txt'))).rejects.toThrow()
  })

  it('keeps both lanes when two unit cleanups settle at once and never overwrites a newer thread', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    await writeFile(join(dir, 'a.txt'), 'a\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    const signal = new AbortController().signal
    const keyA = 'review:change-a:section:1'
    const keyB = 'review:change-a:section:2'
    const first = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      keyA,
      defaultGit,
      signal,
    )
    const second = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      keyB,
      defaultGit,
      signal,
    )
    if (first === undefined || second === undefined) throw new Error('expected two snapshots')
    const threads = (worktree: string, entries: Array<{ key: string; threadId: string }>) => {
      const delegation = join(worktree, '.dsh', 'delegation')
      return mkdir(delegation, { recursive: true }).then(() =>
        writeFile(
          join(delegation, 'codex-review-threads.json'),
          JSON.stringify({
            version: 1,
            threads: entries.map((entry) => ({ ...entry, cwd: worktree, sandbox: 'read-only' })),
          }),
        ),
      )
    }
    // A's checkout still carries B's older entry; B has already been replaced
    // in the durable map. A's cleanup must not bring the stale B thread back.
    await threads(first.worktree, [
      { key: keyA, threadId: 'thread-a-1' },
      { key: keyB, threadId: 'thread-b-stale' },
    ])
    await threads(second.worktree, [{ key: keyB, threadId: 'thread-b-1' }])
    const durable = join(dir, '.dsh', 'workflows', 'review-threads.json')
    await mkdir(join(dir, '.dsh', 'workflows'), { recursive: true })
    await writeFile(
      durable,
      JSON.stringify({ version: 1, threads: [{ key: keyB, threadId: 'thread-b-new' }] }),
    )
    await Promise.all([
      discardReviewSnapshot(dir, keyA, defaultGit),
      discardReviewSnapshot(dir, keyB, defaultGit),
    ])
    const map = JSON.parse(await readFile(durable, 'utf8')) as {
      threads: Array<{ key: string; threadId: string }>
    }
    const byKey = new Map(map.threads.map((entry) => [entry.key, entry.threadId]))
    expect(byKey.get(keyA)).toBe('thread-a-1')
    expect(byKey.get(keyB)).toBe('thread-b-1')
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
    const snapshots = join(dir, SNAPSHOTS)
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
    const snapshots = join(dir, SNAPSHOTS)
    const leftover = join(snapshots, 'run-stale')
    await mkdir(leftover, { recursive: true })
    await writeFile(
      `${leftover}.lease`,
      JSON.stringify({ runId: 'run-stale', expiresAt: Date.now() - 1_000 }),
    )
    await sweepReviewSnapshots(dir, defaultGit, Date.now())
    expect(await readdir(snapshots)).not.toContain('run-stale')
  })

  it('renews a lease and stops without recreating it', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const name = reviewSnapshotName('run-renew')
    const lease = join(dir, SNAPSHOTS, `${name}.lease`)
    await startSnapshotLease(dir, 'run-renew', 10)
    await rm(lease, { force: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(JSON.parse(await readFile(lease, 'utf8'))).toMatchObject({ runId: name })
    await stopSnapshotLease(dir, 'run-renew')
    await rm(lease, { force: true })
    await new Promise((resolve) => setTimeout(resolve, 40))
    await expect(readFile(lease)).rejects.toThrow()
  })

  it('keeps a valid lease whose checkout does not exist yet', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, SNAPSHOTS)
    await mkdir(snapshots, { recursive: true })
    const now = Date.now()
    await writeFile(
      join(snapshots, 'run-live.lease'),
      JSON.stringify({ runId: 'run-live', expiresAt: now + 60_000 }),
    )
    await writeFile(
      join(snapshots, 'run-dead.lease'),
      JSON.stringify({ runId: 'run-dead', expiresAt: now - 1_000 }),
    )
    await sweepReviewSnapshots(dir, defaultGit, now)
    expect(await readdir(snapshots)).toContain('run-live.lease')
    expect(await readdir(snapshots)).not.toContain('run-dead.lease')
  })

  it('sweeps an orphaned scratch index and keeps one whose lease is valid', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, SNAPSHOTS)
    const scratch = join(dir, SCRATCH)
    await mkdir(snapshots, { recursive: true })
    await mkdir(scratch, { recursive: true })
    const now = Date.now()
    const orphan = join(scratch, 'run-orphan.index')
    const live = join(scratch, 'run-live.index')
    await writeFile(orphan, 'x')
    await writeFile(live, 'x')
    const old = new Date(now - 60 * 60_000)
    await utimes(orphan, old, old)
    await utimes(live, old, old)
    await writeFile(
      join(snapshots, 'run-live.lease'),
      JSON.stringify({ runId: 'run-live', expiresAt: now + 60_000 }),
    )
    await sweepReviewSnapshots(dir, defaultGit, now)
    expect(await readdir(scratch)).toContain('run-live.index')
    expect(await readdir(scratch)).not.toContain('run-orphan.index')
  })

  it('keeps working when the sweep itself fails', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, SNAPSHOTS)
    await mkdir(join(snapshots, 'run-broken'), { recursive: true })
    await writeFile(
      join(snapshots, 'run-broken.lease'),
      JSON.stringify({ runId: 'run-broken', expiresAt: Date.now() - 1_000 }),
    )
    const failing: GitRunner = async () => {
      throw new Error('git is unavailable')
    }
    await expect(sweepReviewSnapshots(dir, failing, Date.now())).resolves.toBeUndefined()
    expect(await readdir(snapshots)).not.toContain('run-broken')
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

  it('sweeps an abandoned lease temporary file', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, SNAPSHOTS)
    await mkdir(snapshots, { recursive: true })
    const now = Date.now()
    const temp = join(snapshots, 'run-temp.lease.abcdef12.tmp')
    await writeFile(temp, '{}')
    const old = new Date(now - 60 * 60_000)
    await utimes(temp, old, old)
    await sweepReviewSnapshots(dir, defaultGit, now)
    expect(await readdir(snapshots)).not.toContain('run-temp.lease.abcdef12.tmp')
  })

  it('retries a failed snapshot removal on a later sweep', async () => {
    const { dir, snapshot } = await lifecycleFixture('run-locked')
    const name = reviewSnapshotName('run-locked')
    const failingGit: GitRunner = async (args, cwd, signal) => {
      if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('git removal failed')
      return defaultGit(args, cwd, signal)
    }
    let injected = false
    const failingRemove = async (path: string): Promise<void> => {
      if (!injected && path === snapshot.worktree) {
        injected = true
        throw new Error('locked')
      }
      await rm(path, { recursive: true, force: true })
    }
    await discardReviewSnapshot(dir, 'run-locked', failingGit, failingRemove)
    expect(injected).toBe(true)
    expect(await readdir(join(dir, SNAPSHOTS))).toContain(name)
    await sweepReviewSnapshots(dir, defaultGit, Date.now() + 11 * 60_000)
    await expect(readFile(join(snapshot.worktree, 'a.txt'))).rejects.toThrow()
  })
})

describe('reviewed input signature', () => {
  async function signatureFixture(): Promise<{ dir: string; changeDir: string }> {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    await mkdir(join(dir, 'src'), { recursive: true })
    await writeFile(join(dir, 'src', 'engine.ts'), 'export const value = 1\n')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-qm', 'base'])
    return { dir, changeDir }
  }

  it('tracks the complete reviewed input set and excludes engine output', async () => {
    const { dir, changeDir } = await signatureFixture()
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'reviews', '0123456789abcdef.json'), '{}\n')
    await mkdir(join(dir, '.dsh', 'workflows'), { recursive: true })
    await writeFile(join(dir, '.dsh', 'workflows', 'scratch.json'), '{}\n')
    const signature = await reviewedInputs(dir, changeDir, defaultGit)
    const paths = [...signature.entries.keys()].map((path) => path.replaceAll('\\', '/'))
    expect(paths.some((path) => path.endsWith('/src/engine.ts'))).toBe(true)
    expect(paths.some((path) => path.endsWith('/openspec/changes/change-a/tasks.md'))).toBe(true)
    expect(paths.some((path) => path.includes('/reviews/'))).toBe(false)
    expect(paths.some((path) => path.includes('/.dsh/'))).toBe(false)
  })

  it('rejects an edit-read-restore that a content digest hides', async () => {
    const { dir, changeDir } = await signatureFixture()
    const before = await reviewedInputs(dir, changeDir, defaultGit)
    const beforeHash = signatureHash(before)
    const engine = join(dir, 'src', 'engine.ts')
    await writeFile(engine, 'export const value = 2\n')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(engine, 'export const value = 1\n')
    const after = await reviewedInputs(dir, changeDir, defaultGit)
    expect(changedInputPaths(before, after)).toContain('src/engine.ts')
    expect(signatureHash(after)).not.toBe(beforeHash)
    // A later unchanged re-check compares equal to its own capture.
    expect(signatureHash(await reviewedInputs(dir, changeDir, defaultGit))).toBe(
      signatureHash(after),
    )
  })
})
