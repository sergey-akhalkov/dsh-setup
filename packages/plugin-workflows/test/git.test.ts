import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { defaultGit, implementationFingerprint, worktreeDigest } from '../src/host/git.ts'

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

describe('implementationFingerprint', () => {
  it('sees a shell edit and ignores documentation and plan state', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflows-fingerprint-'))
    roots.push(root)
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    await writeFile(join(root, 'app.ts'), 'one\n', 'utf8')
    await writeFile(join(root, 'README.md'), '# Readme\n', 'utf8')
    git('add', '.')
    git('commit', '-m', 'one')
    const before = await implementationFingerprint(root, defaultGit)
    // A shell-owned edit changes the implementation state with no write observation.
    await writeFile(join(root, 'app.ts'), 'two\n', 'utf8')
    const after = await implementationFingerprint(root, defaultGit)
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
    // Documentation and plan state are not implementation work.
    await writeFile(join(root, 'README.md'), '# Changed\n', 'utf8')
    await mkdir(join(root, 'openspec', 'changes', 'auth'), { recursive: true })
    await writeFile(join(root, 'openspec', 'changes', 'auth', 'tasks.md'), '- [x] 1.1 x\n', 'utf8')
    expect(await implementationFingerprint(root, defaultGit)).toBe(after)
  })

  it('sees a committed implementation change and ignores a committed documentation change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'workflows-fingerprint-'))
    roots.push(root)
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    await writeFile(join(root, 'app.ts'), 'one\n', 'utf8')
    await writeFile(join(root, 'README.md'), '# Readme\n', 'utf8')
    git('add', '.')
    git('commit', '-m', 'one')
    const before = await implementationFingerprint(root, defaultGit)
    // A documentation-only commit leaves the implementation state unchanged.
    await writeFile(join(root, 'README.md'), '# Changed\n', 'utf8')
    await mkdir(join(root, 'openspec', 'changes', 'auth'), { recursive: true })
    await writeFile(join(root, 'openspec', 'changes', 'auth', 'tasks.md'), '- [x] 1.1 x\n', 'utf8')
    git('add', '.')
    git('commit', '-m', 'docs')
    expect(await implementationFingerprint(root, defaultGit)).toBe(before)
    // A shell edit that is already committed cleans the status; the committed
    // state must still move the fingerprint.
    await writeFile(join(root, 'app.ts'), 'two\n', 'utf8')
    git('add', '.')
    git('commit', '-m', 'code')
    const after = await implementationFingerprint(root, defaultGit)
    expect(before).toBeDefined()
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
  })
})
