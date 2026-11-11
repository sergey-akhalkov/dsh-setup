import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  approvalsPath,
  InstallConflictError,
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
import { evaluateIntakeGate } from '../src/host/gates.ts'
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
  it('installs a draft, approves it, and lets the approved local id override the installed one', async () => {
    const workspace = await tempWorkspace()
    const draft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'mine.json',
      definitionFor('retro', 'Local retro'),
    )
    const installed = await installDefinition(workspace, draft, auth())
    expect(installed.definition.id).toBe('retro')
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
    const retro = loaded.definitions.find((definition) => definition.id === 'retro')
    expect(retro?.name).toBe('Local retro')
    // The shipped asset is read-only: the override lives only in the workspace.
    expect(loadShippedDefinitions().find((entry) => entry.id === 'retro')?.name).toBe(
      'Work checkpoint',
    )
    expect(loaded.definitions.map((entry) => entry.id)).toEqual(['retro', 'task-review', 'verify'])
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
  // An own definition loads beside a not-installed legacy source; the linked
  // directory drops the local overrides and the intake's deferred spec-review
  // step loses its source.
  expect(empty.definitions.map((entry) => entry.id)).toEqual(
    expect.arrayContaining(['retro', 'task-review', 'verify']),
  )
  expect(empty.definitions.map((entry) => entry.id)).not.toContain('change-intake')
  expect(empty.errors.join('\n')).toMatch(/directory is a link|ancestor is a link/u)
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
  it('keeps the previous definition readable while replacing it', async () => {
    const workspace = await tempWorkspace()
    const first = join(workspace, 'readable-first.json')
    await writeFile(
      first,
      `${JSON.stringify(definitionFor('readable-demo', 'Original'), null, 2)}\n`,
    )
    await installDefinition(workspace, first, auth())
    const second = join(workspace, 'readable-second.json')
    await writeFile(
      second,
      `${JSON.stringify(definitionFor('readable-demo', 'Changed'), null, 2)}\n`,
    )
    let observed = ''
    await installDefinition(workspace, second, auth(), {
      link: async (from, to) => {
        // The atomic replacement must not remove the target first: a read at
        // this point still sees the previous definition.
        observed = await readFile(from, 'utf8')
        await link(from, to)
      },
    })
    expect(observed).toContain('Original')
    const loaded = await loadApprovedDefinitions(workspace, { auth: auth() })
    expect(loaded.definitions.find((entry) => entry.id === 'readable-demo')?.name).toBe('Changed')
  })

  it('refuses to overwrite a definition created at publication time', async () => {
    const workspace = await tempWorkspace()
    const source = join(workspace, 'race.json')
    await writeFile(source, `${JSON.stringify(definitionFor('race-demo'), null, 2)}\n`)
    const competitor = Buffer.from(
      `${JSON.stringify(definitionFor('race-demo', 'Competitor'), null, 2)}\n`,
      'utf8',
    )
    let injected = false
    await expect(
      installDefinition(workspace, source, auth(), {
        expectedHash: null,
        link: async (from, to) => {
          // A different writer publishes the same id between the absence check
          // and our exclusive publication.
          if (!injected) {
            injected = true
            await writeFile(to, competitor)
          }
          await link(from, to)
        },
      }),
    ).rejects.toBeInstanceOf(InstallConflictError)
    expect(
      await readFile(join(workspaceDefinitionsDirectory(workspace), 'race-demo.json')),
    ).toEqual(competitor)
    const approvals = await readApprovals(workspace)
    expect(approvals.approvals.has('race-demo')).toBe(false)
  })

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
      if (renames === 1) {
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

describe('gate-preserving intake override', () => {
  function contributedIntake(): Record<string, unknown> {
    return JSON.parse(
      readFileSync(
        join(
          fileURLToPath(new URL('..', import.meta.url)),
          '..',
          'plugin-openspec',
          'assets',
          'workflows',
          'change-intake.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>
  }

  it('refuses the old approved override, keeps the installed gate, and loads a reapproved copy', async () => {
    const workspace = await tempWorkspace()
    const old = contributedIntake()
    // The retired shape: no gate declaration and the <name> token.
    old.name = 'Old local intake'
    const oldSettings = old.settings as Record<string, unknown>
    delete oldSettings.gate
    ;(old.trigger as { match: Record<string, unknown> }).match.command =
      'openspec new change <name>'
    const oldDraft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'old-intake.json',
      old,
    )
    await installDefinition(workspace, oldDraft, auth())
    const intake = validateDefinition(contributedIntake())

    const loaded = await loadApprovedDefinitions(workspace, {
      auth: auth(),
      shipped: [...loadShippedDefinitions(), intake],
    })
    expect(loaded.errors.join('\n')).toMatch(
      /drops or weakens the installed definition's declared "intake" gate.*retired <name> token/u,
    )
    const installed = loaded.definitions.find((definition) => definition.id === 'change-intake')
    expect(installed?.name).toBe('OpenSpec change intake')
    expect(installed?.settings.gate).toBe('intake')
    expect(installed?.trigger.match.command).toBe('openspec new change {name}')

    // Keeping the gate field is not enough: a shadow trigger or the retired
    // token would silently disable enforcement and is refused too.
    const shadowed = contributedIntake()
    shadowed.name = 'Shadow gate copy'
    ;(shadowed.trigger as { mode: string }).mode = 'shadow'
    const shadowDraft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'shadow-intake.json',
      shadowed,
    )
    await installDefinition(workspace, shadowDraft, auth())
    const weakened = await loadApprovedDefinitions(workspace, {
      auth: auth(),
      shipped: [...loadShippedDefinitions(), intake],
    })
    expect(weakened.errors.join('\n')).toMatch(/drops or weakens.*"intake" gate/u)
    expect(weakened.definitions.find((definition) => definition.id === 'change-intake')?.name).toBe(
      'OpenSpec change intake',
    )

    const retired = contributedIntake()
    retired.name = 'Retired token copy'
    ;(retired.trigger as { match: Record<string, unknown> }).match.command =
      'openspec new change <name>'
    const retiredDraft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'retired-intake.json',
      retired,
    )
    await installDefinition(workspace, retiredDraft, auth())
    const retiredLoad = await loadApprovedDefinitions(workspace, {
      auth: auth(),
      shipped: [...loadShippedDefinitions(), intake],
    })
    expect(retiredLoad.errors.join('\n')).toMatch(/drops or weakens.*"intake" gate/u)
    expect(
      retiredLoad.definitions.find((definition) => definition.id === 'change-intake')?.name,
    ).toBe('OpenSpec change intake')

    for (const applicability of ['code-write', 'checkpoint-required'] as const) {
      const gated = contributedIntake()
      gated.name = `Applicability ${applicability}`
      ;(gated.trigger as { applicability?: string }).applicability = applicability
      const applicabilityDraft = await writeDefinitionFile(
        workspace,
        workspaceDraftsDirectory(workspace),
        `applicability-${applicability}.json`,
        gated,
      )
      await installDefinition(workspace, applicabilityDraft, auth())
      const applicabilityLoad = await loadApprovedDefinitions(workspace, {
        auth: auth(),
        shipped: [...loadShippedDefinitions(), intake],
      })
      expect(applicabilityLoad.errors.join('\n')).toMatch(/drops or weakens.*"intake" gate/u)
      expect(
        applicabilityLoad.definitions.find((definition) => definition.id === 'change-intake')?.name,
      ).toBe('OpenSpec change intake')
    }

    // The installed gate still refuses the create command with no completed run.
    const decision = await evaluateIntakeGate({
      name: 'auth',
      session: 'session-1',
      workspace,
      definition: installed as NonNullable<typeof installed>,
      runs: [],
      receipts: [],
      ownedCallIds: new Set<string>(),
      changeExists: false,
      startRun: async () => ({ runId: 'run-intake' }),
      resumeRun: async () => ({ stepId: 'requirements' }),
    })
    expect(decision.kind).toBe('deny')

    // A copy saved from the installed template keeps the gate and loads.
    const reapproved = contributedIntake()
    reapproved.name = 'Reapproved local intake'
    const draft = await writeDefinitionFile(
      workspace,
      workspaceDraftsDirectory(workspace),
      'new-intake.json',
      reapproved,
    )
    await installDefinition(workspace, draft, auth())
    const reloaded = await loadApprovedDefinitions(workspace, {
      auth: auth(),
      shipped: [...loadShippedDefinitions(), intake],
    })
    expect(reloaded.errors).toEqual([])
    const local = reloaded.definitions.find((definition) => definition.id === 'change-intake')
    expect(local?.name).toBe('Reapproved local intake')
    expect(local?.settings.gate).toBe('intake')
  })
})
