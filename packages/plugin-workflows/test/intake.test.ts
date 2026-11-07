import { lstat, mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DRAFTS_ROOT,
  draftDirectory,
  draftPath,
  readDraft,
  writeDraft,
} from '../src/host/drafts.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-drafts-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

describe('intake drafts', () => {
  it('writes an atomic draft path and never creates the change directory', async () => {
    const workspace = await tempWorkspace()
    expect(draftDirectory('auth')).toBe('.dsh/workflows/drafts/auth')
    expect(draftPath('auth', 'requirements.md')).toBe('.dsh/workflows/drafts/auth/requirements.md')
    const written = await writeDraft(workspace, 'auth', 'requirements.md', 'users and outcomes\n')
    expect(written.path).toBe('.dsh/workflows/drafts/auth/requirements.md')
    expect(await readDraft(workspace, 'auth', 'requirements.md')).toBe('users and outcomes\n')
    const names = await readdir(join(workspace, DRAFTS_ROOT, 'auth'))
    expect(names).toEqual(['requirements.md'])
    expect(await readdir(join(workspace, 'openspec')).catch(() => undefined)).toBeUndefined()
    const info = await lstat(
      join(workspace, '.dsh', 'workflows', 'drafts', 'auth', 'requirements.md'),
    )
    expect(info.isFile()).toBe(true)
  })

  it('refuses an invalid draft name and an escaping artifact path', async () => {
    const workspace = await tempWorkspace()
    for (const name of ['../auth', 'Auth', 'auth/v2', '', '..']) {
      expect(() => draftDirectory(name), name).toThrow(/not a validated change name/u)
      await expect(writeDraft(workspace, name, 'requirements.md', 'x'), name).rejects.toThrow()
    }
    for (const artifact of [
      '../requirements.md',
      '/etc/passwd',
      'a/../../b.md',
      'nested/../x.md',
      '',
    ]) {
      expect(() => draftPath('auth', artifact), artifact).toThrow()
      await expect(writeDraft(workspace, 'auth', artifact, 'x'), artifact).rejects.toThrow()
    }
  })

  it('refuses a draft directory that is a link outside the workspace', async () => {
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    await mkdir(join(workspace, '.dsh', 'workflows'), { recursive: true })
    await symlink(
      outside,
      join(workspace, DRAFTS_ROOT),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    await expect(writeDraft(workspace, 'auth', 'requirements.md', 'x')).rejects.toThrow(
      /drafts directory is a link/u,
    )
  })
})
