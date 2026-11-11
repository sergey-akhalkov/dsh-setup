import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostAuth } from '../src/host/host-auth.ts'
import { mayPublishDefinitionLoad } from '../src/host/index.ts'
import { definitionsRegistry } from '../src/host/registry.ts'
import { createRun, readAuthenticatedRun, writeRun } from '../src/host/runs.ts'

const auth = HostAuth.fromKey('0123456789abcdef0123456789abcdef')

/** One minimal valid contributed definition. */
function definition(id: string, command: string): unknown {
  return {
    v: 1,
    id,
    name: id,
    version: 1,
    trigger: {
      kind: 'tool.pre-execute',
      match: { tool: 'shell', command },
      mode: 'active',
      dedupe: 'name',
    },
    settings: {
      allowModelStart: false,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'done',
        title: 'Done',
        executor: 'main',
        prompt: 'Confirm the work.',
        evidence: { kind: 'file', path: 'out.md' },
        next: 'end',
      },
    ],
  }
}

const trigger = {
  id: 'acme-deploy-trigger',
  event: 'tool.result',
  filter: { tool: 'shell' },
  mode: 'shadow',
  dedupe: 'none',
}

const disposers: Array<() => void> = []
function register(source: string, definitions: unknown[], triggers: unknown[]): () => void {
  const dispose = definitionsRegistry.register({ source, definitions, triggers })
  disposers.push(dispose)
  return dispose
}

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
})

describe('workflow definitions registry', () => {
  it('registers a definition and trigger with the plugin source', () => {
    register('@acme/plugin', [definition('acme-deploy', 'acme deploy {name}')], [trigger])
    const installed = definitionsRegistry.installed('acme-deploy')
    expect(installed?.source).toBe('plugin')
    expect(installed?.plugin).toBe('@acme/plugin')
    expect(installed?.definition.trigger.match.command).toBe('acme deploy {name}')
    const installedTrigger = definitionsRegistry.installedTrigger('acme-deploy-trigger')
    expect(installedTrigger?.trigger.id).toBe('acme-deploy-trigger')
    expect(installedTrigger?.plugin).toBe('@acme/plugin')
    expect(definitionsRegistry.definitions().some((entry) => entry.source === 'shipped')).toBe(true)
  })

  it('refuses a duplicate definition id naming both sources', () => {
    register('@acme/plugin', [definition('acme-deploy', 'acme deploy {name}')], [])
    expect(() =>
      register('@other/plugin', [definition('acme-deploy', 'other deploy {name}')], []),
    ).toThrow(/already installed by @acme\/plugin/u)
    expect(definitionsRegistry.installed('acme-deploy')?.plugin).toBe('@acme/plugin')
  })

  it('refuses a duplicate id inside one contribution', () => {
    expect(() =>
      register(
        '@acme/plugin',
        [
          definition('acme-duplicate', 'acme deploy {name}'),
          definition('acme-duplicate', 'acme deploy {name}'),
        ],
        [],
      ),
    ).toThrow(/declared twice/u)
    expect(definitionsRegistry.installed('acme-duplicate')).toBeUndefined()
  })

  it('refuses an unknown trigger property and registers no part of it', () => {
    expect(() => register('@acme/plugin', [], [{ ...trigger, unknown: true }])).toThrow(
      /field "unknown" is not a known field/u,
    )
    expect(definitionsRegistry.installedTrigger(trigger.id)).toBeUndefined()
  })

  it('refuses a malformed contribution without registering any part of it', () => {
    const invalid = definition('acme-bad', 'acme deploy {name}')
    ;(invalid as { unknown?: boolean }).unknown = true
    expect(() => register('@acme/plugin', [invalid], [trigger])).toThrow(/"acme-bad"/u)
    expect(definitionsRegistry.installed('acme-bad')).toBeUndefined()
    expect(definitionsRegistry.installedTrigger(trigger.id)).toBeUndefined()
  })

  it('refuses an invalid trigger with its id and field', () => {
    expect(() =>
      register('@acme/plugin', [], [{ ...trigger, id: 'bad', dedupe: 'sometimes' }]),
    ).toThrow(/"bad".*dedupe/u)
  })

  it('removes a disposed contribution while its recorded runs stay readable', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'workflows-registry-'))
    const dispose = register(
      '@acme/plugin',
      [definition('acme-deploy', 'acme deploy {name}')],
      [trigger],
    )
    const run = createRun({
      definition: { id: 'acme-deploy', name: 'acme-deploy', version: 1 },
      trigger: 'tool.pre-execute',
      session: 's1',
      workspace,
      context: { name: 'auth' },
      steps: ['done'],
      now: 1000,
    })
    await writeRun(workspace, run, auth)
    const revision = definitionsRegistry.revision
    dispose()
    expect(definitionsRegistry.revision).toBeGreaterThan(revision)
    expect(definitionsRegistry.installed('acme-deploy')).toBeUndefined()
    expect(definitionsRegistry.installedTrigger(trigger.id)).toBeUndefined()
    const stored = await readAuthenticatedRun(workspace, run.id, auth)
    expect(stored?.context.name).toBe('auth')
    await rm(workspace, { recursive: true, force: true })
  })

  it('registers the OpenSpec plugin assets and keeps the engine free of them', () => {
    const directory = new URL('../../plugin-openspec/assets/workflows/', import.meta.url)
    const definition = JSON.parse(
      readFileSync(new URL('change-intake.json', directory), 'utf8'),
    ) as { id: string; settings: { gate?: string } }
    const catalog = JSON.parse(readFileSync(new URL('triggers.json', directory), 'utf8')) as {
      triggers: Array<{ id: string }>
    }
    expect(definitionsRegistry.installed('change-intake')).toBeUndefined()
    expect(definitionsRegistry.installedTrigger('openspec-tasks-checked')).toBeUndefined()
    register('@dsh-setup/plugin-openspec', [definition], catalog.triggers)
    const installed = definitionsRegistry.installed('change-intake')
    expect(installed?.source).toBe('plugin')
    expect(installed?.plugin).toBe('@dsh-setup/plugin-openspec')
    expect(installed?.definition.settings.gate).toBe('intake')
    for (const id of [
      'openspec-tasks-checked',
      'openspec-review-recorded',
      'openspec-change-created',
      'openspec-change-archived',
    ]) {
      expect(definitionsRegistry.installedTrigger(id)?.plugin).toBe('@dsh-setup/plugin-openspec')
    }
  })

  it('fences a load that finishes after a newer registry revision', () => {
    // The newer load (id 2, revision 2) published first; the older load (id 1)
    // must not overwrite the cache even if it resolves later.
    expect(mayPublishDefinitionLoad(1, 1, 2, 2)).toBe(false)
    expect(mayPublishDefinitionLoad(2, 2, 2, 1)).toBe(true)
    expect(mayPublishDefinitionLoad(1, 1, 2, undefined)).toBe(false)
    expect(mayPublishDefinitionLoad(1, 1, 1, undefined)).toBe(true)
    expect(mayPublishDefinitionLoad(1, 1, 1, 1)).toBe(true)
  })

  it('seeds the engine shipped definitions and the generic trigger catalog', () => {
    expect(definitionsRegistry.installed('task-review')?.source).toBe('shipped')
    expect(definitionsRegistry.installedTrigger('agent-turn-start')?.source).toBe('shipped')
    expect(definitionsRegistry.installed('change-intake')).toBeUndefined()
  })

  it('keeps a shipped definition unchanged when the engine asset still ships it', () => {
    const asset = JSON.parse(
      readFileSync(new URL('../assets/definitions/task-review.json', import.meta.url), 'utf8'),
    ) as { id: string }
    expect(definitionsRegistry.installed(asset.id)?.source).toBe('shipped')
  })
})
