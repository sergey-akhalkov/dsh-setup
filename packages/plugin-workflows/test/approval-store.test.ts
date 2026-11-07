import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  approvalsPath,
  installDefinition,
  loadApprovedDefinitions,
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
    expect(loaded.definitions.map((entry) => entry.id)).toEqual(['change-intake'])
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
