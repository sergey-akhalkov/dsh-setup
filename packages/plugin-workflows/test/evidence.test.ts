import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Evidence } from '../src/host/definitions.ts'
import { verifyEvidence } from '../src/host/evidence.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-evidence-'))
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

async function writeArtifact(workspace: string, path: string, text = 'evidence\n'): Promise<void> {
  const file = join(workspace, path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, text, 'utf8')
}

function file(path: string, extra: Record<string, unknown> = {}): Evidence {
  return { kind: 'file', path, ...extra } as unknown as Evidence
}

const values = { name: 'auth' }

describe('file evidence', () => {
  it('accepts a present non-empty file and reports its size', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, '.dsh/workflows/drafts/auth/requirements.md', 'x'.repeat(200))
    const result = await verifyEvidence(file('.dsh/workflows/drafts/{name}/requirements.md'), {
      workspace,
      values,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.evidence).toMatchObject({ kind: 'file', bytes: 200 })
  })

  it('refuses a missing, empty, or too-small file and names the path', async () => {
    const workspace = await tempWorkspace()
    const missing = await verifyEvidence(file('missing.md'), { workspace, values })
    expect(missing).toMatchObject({
      ok: false,
      failure: { reason: 'missing-file', path: 'missing.md' },
    })
    await writeArtifact(workspace, 'empty.md', '')
    const empty = await verifyEvidence(file('empty.md'), { workspace, values })
    expect(empty).toMatchObject({ ok: false, failure: { reason: 'empty-file' } })
    await writeArtifact(workspace, 'small.md', 'tiny')
    const small = await verifyEvidence(file('small.md', { minBytes: 200 } as Partial<Evidence>), {
      workspace,
      values,
    })
    expect(small).toMatchObject({ ok: false, failure: { reason: 'too-small' } })
  })

  it('refuses a parent escape, an absolute path, and a symlink escape', async () => {
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    await writeArtifact(outside, 'secret.md')
    await writeArtifact(workspace, 'inside.md')
    expect(await verifyEvidence(file('../outside.txt'), { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'path-escape' },
    })
    expect(
      await verifyEvidence(file(join(outside, 'secret.md')), { workspace, values }),
    ).toMatchObject({
      ok: false,
      failure: { reason: 'path-escape' },
    })
    await symlink(
      outside,
      join(workspace, 'link'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(await verifyEvidence(file('link/secret.md'), { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'path-escape' },
    })
  })

  it('refuses an invalid or missing interpolation value', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'auth/requirements.md')
    expect(
      await verifyEvidence(file('{name}/requirements.md'), {
        workspace,
        values: { name: '../auth' },
      }),
    ).toMatchObject({ ok: false, failure: { reason: 'invalid-context' } })
    expect(
      await verifyEvidence(file('{name}/requirements.md'), { workspace, values: {} }),
    ).toMatchObject({ ok: false, failure: { reason: 'invalid-context' } })
  })
})

describe('all and glob evidence', () => {
  it('requires every item and reports the first failure with its item path', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'a.md')
    const partial: Evidence = {
      kind: 'all',
      items: [file('a.md'), file('b.md')],
    }
    expect(await verifyEvidence(partial, { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'missing-file', path: 'b.md', item: 'items[1]' },
    })
  })

  it('reports a nested all failure with the complete item path', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, 'a.md')
    const nested: Evidence = {
      kind: 'all',
      items: [{ kind: 'all', items: [file('a.md'), file('missing.md')] }, file('c.md')],
    }
    expect(await verifyEvidence(nested, { workspace, values })).toMatchObject({
      ok: false,
      failure: { reason: 'missing-file', item: 'items[0].items[1]' },
    })
  })

  it('expands a glob, requires a match, and refuses an empty match', async () => {
    const workspace = await tempWorkspace()
    const pattern = 'openspec/changes/{name}/specs/**/spec.md'
    await writeArtifact(workspace, 'openspec/changes/auth/specs/a/spec.md', 'one\n')
    await writeArtifact(workspace, 'openspec/changes/auth/specs/b/spec.md', 'two\n')
    const glob = file(pattern, { glob: true } as Partial<Evidence>)
    const matched = await verifyEvidence(glob, { workspace, values })
    expect(matched.ok).toBe(true)
    const noMatch = await verifyEvidence(
      file('openspec/changes/{name}/specs/**/nope.md', { glob: true } as Partial<Evidence>),
      {
        workspace,
        values,
      },
    )
    expect(noMatch).toMatchObject({ ok: false, failure: { reason: 'no-match' } })
    await writeArtifact(workspace, 'openspec/changes/auth/specs/c/spec.md', '')
    const empty = await verifyEvidence(glob, { workspace, values })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.failure.reason).toBe('empty-file')
  })
})
