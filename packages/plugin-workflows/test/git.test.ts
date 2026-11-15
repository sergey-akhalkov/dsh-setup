import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultGit, worktreeDigest } from '../src/host/git.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('worktreeDigest', () => {
  it('distinguishes two clean committed revisions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflows-git-'))
    roots.push(root)
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    await writeFile(join(root, 'a.txt'), 'one\n', 'utf8')
    git('add', '.')
    git('commit', '-m', 'one')
    const first = await worktreeDigest(root, defaultGit)
    await writeFile(join(root, 'a.txt'), 'two\n', 'utf8')
    git('add', '.')
    git('commit', '-m', 'two')
    const second = await worktreeDigest(root, defaultGit)
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toBe(second)
  })
})
