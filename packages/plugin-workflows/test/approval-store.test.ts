import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  approvalsPath,
  installDefinition,
  loadApprovedDefinitions,
  readApprovals,
} from '../src/host/approval-store.ts'
import {
  loadShippedDefinitions,
  validateDefinition,
  workspaceDefinitionsDirectory,
  workspaceDraftsDirectory,
} from '../src/host/definitions.ts'
import { HostAuth } from '../src/host/host-auth.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-definitions-'))
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

function auth(): HostAuth {
  return HostAuth.fromKey('test-workflows-host-key-0123456789')
}

/** A valid one-step definition with the given id. */
function definitionFor(id: string, name = id): Record<string, unknown> {
  return {
    v: 1,
    id,
    name,
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: {
      allowModelStart: false,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'only',
        title: 'Only step',
        executor: 'main',
        prompt: 'Do the work.',
        evidence: { kind: 'file', path: 'out.md' },
        next: 'end',
      },
    ],
  }
}

async function writeDefinitionFile(
  _workspace: string,
  directory: string,
  name: string,
  value: unknown,
): Promise<string> {
  const path = join(directory, name)
  await mkdir(directory, { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path
}

async function hashFile(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex')
}

/** A definition whose trigger is the optional active intent trigger. */
function intentFor(id: string): Record<string, unknown> {
  const definition = definitionFor(id)
  definition.trigger = {
    kind: 'intent',
    match: { intent: 'new-change' },
    mode: 'active',
    dedupe: 'none',
  }
  ;(definition.settings as Record<string, unknown>).allowIntent = true
  return definition
}

describe('local definitions and the host approval store', () => {
  it('installs a draft, approves it, and lets the approved local id override the shipped one', async () => {
    const workspace = await tempWorkspace()
    const draft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'mine.json',
      definitionFor('change-intake', 'Local intake'),
    )
    const installed = await installDefinition(workspace, draft, auth())
    expect(installed.definition.id).toBe('change-intake')
    expect(installed.hash).toMatch(/^[a-f0-9]{64}$/u)
    // The approval signs the validated source bytes, never a re-read of the
    // writable destination.
    expect(installed.hash).toBe(await hashFile(draft))
    expect(await readFile(approvalsPath(workspace), 'utf8')).toContain(installed.hash)

    const loaded = await loadApprovedDefinitions(workspace, {
      auth: auth(),
      shipped: loadShippedDefinitions(),
    })
    expect(loaded.errors).toEqual([])
    const intake = loaded.definitions.find((definition) => definition.id === 'change-intake')
    expect(intake?.name).toBe('Local intake')
    // The shipped asset is read-only: the override lives only in the workspace.
    expect(loadShippedDefinitions().find((entry) => entry.id === 'change-intake')?.name).toBe(
      'OpenSpec change intake',
    )
    expect(loaded.definitions.map((entry) => entry.id)).toEqual([
      'change-intake',
      'retro',
      'task-review',
    ])
  })

  it('refuses an unapproved local definition and never loads a draft', async () => {
    const workspace = await tempWorkspace()
    await writeDefinitionFile(
      workspace,
      workspaceDefinitionsDirectory(workspace),
      'unapproved.json',
      definitionFor('unapproved'),
    )
    await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'draft.json',
      definitionFor('draft-only'),
    )
    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    expect(loaded.definitions.map((definition) => definition.id)).not.toContain('unapproved')
    expect(loaded.definitions.map((definition) => definition.id)).not.toContain('draft-only')
    expect(loaded.errors.join('\n')).toMatch(
      /definition "unapproved" is not approved by the host.*workflows install/u,
    )
  })

  it('refuses a matching definition and approval pair without a valid host signature', async () => {
    const workspace = await tempWorkspace()
    const file = await writeDefinitionFile(
      workspace,
      workspaceDefinitionsDirectory(workspace),
      'forged.json',
      definitionFor('forged'),
    )
    const hash = await hashFile(file)
    await writeFile(
      approvalsPath(workspace),
      `${JSON.stringify({ v: 1, approvals: { forged: { hash, signature: '0'.repeat(64) } } }, null, 2)}\n`,
      'utf8',
    )
    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    expect(loaded.definitions.map((definition) => definition.id)).not.toContain('forged')
    expect(loaded.errors.join('\n')).toMatch(/definition "forged" is not approved by the host/u)
  })

  it('refuses a definition modified after approval until it is re-approved', async () => {
    const workspace = await tempWorkspace()
    const draft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'demo.json',
      definitionFor('local-demo'),
    )
    await installDefinition(workspace, draft, auth())
    const installedFile = join(workspaceDefinitionsDirectory(workspace), 'local-demo.json')
    const modified = definitionFor('local-demo', 'Modified after approval')
    await writeFile(installedFile, `${JSON.stringify(modified, null, 2)}\n`, 'utf8')

    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    expect(loaded.definitions.map((definition) => definition.id)).not.toContain('local-demo')
    expect(loaded.errors.join('\n')).toMatch(
      /definition "local-demo" is not approved by the host \(local-demo\.json\)/u,
    )
  })

  it('validates before installing and writes nothing for an invalid definition', async () => {
    const workspace = await tempWorkspace()
    const invalid = definitionFor('invalid') as Record<string, unknown>
    invalid.extra = true
    const draft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'invalid.json',
      invalid,
    )
    await expect(installDefinition(workspace, draft, auth())).rejects.toThrow(
      /field "extra" is not a known field/u,
    )
    await expect(readFile(approvalsPath(workspace), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses a definition file outside the workspace', async () => {
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    const file = await writeDefinitionFile(
      outside,
      workspaceDraftsDirectory(outside),
      'outside.json',
      definitionFor('outside'),
    )
    await expect(installDefinition(workspace, file, auth())).rejects.toThrow(
      /is outside the workspace/u,
    )
  })

  it('refuses a definition id that could escape the installation directory', async () => {
    const workspace = await tempWorkspace()
    for (const id of ['../../outside', '../escape', '/absolute']) {
      const draft = await writeDefinitionFile(
        workspace,
        workspaceDraftsDirectory(workspace),
        'evil.json',
        definitionFor(id),
      )
      await expect(installDefinition(workspace, draft, auth()), id).rejects.toThrow(
        /field "id" must match/u,
      )
    }
    await expect(readFile(approvalsPath(workspace), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('refuses a link that aliases the definitions directory to the drafts or assets', async () => {
    const workspace = await tempWorkspace()
    const drafts = workspaceDraftsDirectory(workspace)
    await mkdir(drafts, { recursive: true })
    const definitions = workspaceDefinitionsDirectory(workspace)
    await mkdir(dirname(definitions), { recursive: true })
    await symlink(drafts, definitions, process.platform === 'win32' ? 'junction' : 'dir')
    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    expect(loaded.errors.join('\n')).toMatch(/ancestor is a link/u)
    const draft = await writeDefinitionFile(
      workspace,
      drafts,
      'aliased.json',
      definitionFor('aliased'),
    )
    await expect(installDefinition(workspace, draft, auth())).rejects.toThrow(
      /ancestor is a link|definitions directory is a link/u,
    )
  })

  it('requires a user-confirmed definition for an active intent trigger', async () => {
    const workspace = await tempWorkspace()
    const shipped = [validateDefinition(intentFor('shipped-intent'))]
    const refused = await loadApprovedDefinitions(workspace, { auth: auth(), shipped })
    expect(refused.definitions).toEqual([])
    expect(refused.errors.join('\n')).toMatch(
      /active intent trigger requires a user-confirmed definition/u,
    )
    const draft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'intent.json',
      intentFor('local-intent'),
    )
    await installDefinition(workspace, draft, auth())
    const installed = await loadApprovedDefinitions(workspace, { auth: auth(), shipped: [] })
    expect(installed.definitions.map((definition) => definition.id)).toEqual(['local-intent'])
    expect(installed.errors).toEqual([])
  })
})

it('refuses a linked ancestor before the install can overwrite shipped assets', async () => {
  const workspace = await tempWorkspace()
  const shipped = join(workspace, 'shipped-assets')
  await mkdir(join(shipped, 'definitions'), { recursive: true })
  const shippedPath = join(shipped, 'definitions', 'change-intake.json')
  const original = `${JSON.stringify(definitionFor('change-intake', 'Shipped intake'), null, 2)}\n`
  await writeFile(shippedPath, original, 'utf8')
  await mkdir(join(workspace, '.dsh'), { recursive: true })
  await symlink(
    shipped,
    join(workspace, '.dsh', 'workflows'),
    process.platform === 'win32' ? 'junction' : 'dir',
  )
  const draft = await writeDefinitionFile(
    workspace,
    workspace,
    'mine.json',
    definitionFor('change-intake', 'Local intake'),
  )
  await expect(installDefinition(workspace, draft, auth())).rejects.toThrow(
    /ancestor is a link|definitions directory is a link/u,
  )
  expect(await readFile(shippedPath, 'utf8')).toBe(original)
  const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
  expect(loaded.errors.join('\n')).toMatch(/ancestor is a link|definitions directory is a link/u)
})

it('applies ownership filtering on a linked-directory fallback too', async () => {
  const workspace = await tempWorkspace()
  const drafts = workspaceDraftsDirectory(workspace)
  await mkdir(drafts, { recursive: true })
  const definitions = workspaceDefinitionsDirectory(workspace)
  await mkdir(dirname(definitions), { recursive: true })
  await symlink(drafts, definitions, process.platform === 'win32' ? 'junction' : 'dir')
  const empty = await loadApprovedDefinitions(workspace, {
    auth: auth(),
    installedLegacy: new Set(),
  })
  expect(empty.definitions).toEqual([])
  expect(empty.errors.join('\n')).toMatch(/retire-legacy-gates/u)
})

it('restores the installed file when the approval write fails', async () => {
  const workspace = await tempWorkspace()
  const baselineDraft = await writeDefinitionFile(
    workspace,
    workspaceDraftsDirectory(workspace),
    'baseline.json',
    definitionFor('atomic-demo', 'Baseline'),
  )
  const baseline = await installDefinition(workspace, baselineDraft, auth())
  const baselineBytes = await readFile(
    join(workspaceDefinitionsDirectory(workspace), 'atomic-demo.json'),
  )
  const replacementDraft = await writeDefinitionFile(
    workspace,
    workspaceDraftsDirectory(workspace),
    'replacement.json',
    definitionFor('atomic-demo', 'Replacement'),
  )
  await expect(
    installDefinition(workspace, replacementDraft, auth(), {
      writeApprovals: async () => {
        throw new Error('the approval store is unavailable')
      },
    }),
  ).rejects.toThrow(/definition was not installed/u)
  expect(
    await readFile(join(workspaceDefinitionsDirectory(workspace), 'atomic-demo.json')),
  ).toEqual(baselineBytes)
  const approvals = await readApprovals(workspace)
  expect(approvals.approvals.get('atomic-demo')?.hash).toBe(baseline.hash)

  const freshDraft = await writeDefinitionFile(
    workspace,
    workspaceDraftsDirectory(workspace),
    'fresh.json',
    definitionFor('fresh-demo'),
  )
  await expect(
    installDefinition(workspace, freshDraft, auth(), {
      writeApprovals: async () => {
        throw new Error('the approval store is unavailable')
      },
    }),
  ).rejects.toThrow(/definition was not installed/u)
  await expect(
    readFile(join(workspaceDefinitionsDirectory(workspace), 'fresh-demo.json'), 'utf8'),
  ).rejects.toMatchObject({ code: 'ENOENT' })
})

describe('install transaction isolation', () => {
  it('keeps both approvals when two definitions install concurrently', async () => {
    const workspace = await tempWorkspace()
    const first = join(workspace, 'concurrent-a.json')
    const second = join(workspace, 'concurrent-b.json')
    await writeFile(first, `${JSON.stringify(definitionFor('concurrent-a'), null, 2)}\n`)
    await writeFile(second, `${JSON.stringify(definitionFor('concurrent-b'), null, 2)}\n`)
    await Promise.all([
      installDefinition(workspace, first, auth()),
      installDefinition(workspace, second, auth()),
    ])
    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    const ids = loaded.definitions.map((definition) => definition.id)
    expect(ids).toContain('concurrent-a')
    expect(ids).toContain('concurrent-b')
  })

  it('preserves the previous definition as a named backup when restore fails', async () => {
    const workspace = await tempWorkspace()
    const first = join(workspace, 'first.json')
    await writeFile(
      first,
      `${JSON.stringify(definitionFor('restore-demo', 'Original'), null, 2)}\n`,
    )
    await installDefinition(workspace, first, auth())
    const second = join(workspace, 'second.json')
    await writeFile(
      second,
      `${JSON.stringify(definitionFor('restore-demo', 'Changed'), null, 2)}\n`,
    )
    let renames = 0
    const failingRename = async (from: string, to: string): Promise<void> => {
      renames += 1
      if (renames === 2) {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      }
      await rename(from, to)
    }
    await expect(
      installDefinition(workspace, second, auth(), {
        writeApprovals: async () => {
          throw new Error('the approval store is full')
        },
        rename: failingRename as typeof rename,
      }),
    ).rejects.toThrow(/could not be restored/u)
    const directory = workspaceDefinitionsDirectory(workspace)
    const backups = (await readdir(directory)).filter((name) => name.endsWith('.bak'))
    expect(backups).toHaveLength(1)
    expect(await readFile(join(directory, backups[0] as string), 'utf8')).toContain('Original')
  })
})
