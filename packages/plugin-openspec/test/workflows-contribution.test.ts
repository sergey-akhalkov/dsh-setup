import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { DefinitionsRegistry } from '../../plugin-workflows/src/host/registry.ts'
import {
  readWorkflowContribution,
  registerWorkflowsContribution,
  type WorkflowsContribution,
} from '../src/host/workflows.ts'

interface AssetDefinition {
  id: string
  trigger: { match: { tool?: string; command?: string } }
  settings?: { gate?: string }
  steps: Array<{ id: string; ownership?: string }>
}

interface FakeRegistry {
  register(contribution: WorkflowsContribution): () => void
}

interface FakeRegistryState {
  registry: FakeRegistry
  registered: WorkflowsContribution[]
  disposals: () => number
}

function fakeRegistry(options: { failure?: Error } = {}): FakeRegistryState {
  const registered: WorkflowsContribution[] = []
  let disposals = 0
  return {
    registry: {
      register(contribution) {
        if (options.failure !== undefined) throw options.failure
        registered.push(contribution)
        return () => {
          disposals += 1
        }
      },
    },
    registered,
    disposals: () => disposals,
  }
}

interface FakeContextState {
  ctx: Context
  injections: string[][]
  effectDisposers: Array<() => void>
}

function pluginContext(registry: FakeRegistry | undefined, effectEnabled = true): FakeContextState {
  const injections: string[][] = []
  const effectDisposers: Array<() => void> = []
  const serviceCtx: Record<string, unknown> = {
    get(name: string): unknown {
      return name === 'workflowsDefinitions' ? registry : undefined
    },
  }
  if (effectEnabled) {
    serviceCtx.effect = (callback: () => () => void): (() => void) => {
      const dispose = callback()
      effectDisposers.push(dispose)
      return dispose
    }
  }
  const ctx = {
    inject(deps: readonly string[], callback: (serviceCtx: unknown) => void): () => void {
      injections.push([...deps])
      callback(serviceCtx)
      return () => {}
    },
  }
  return { ctx: ctx as unknown as Context, injections, effectDisposers }
}

describe('OpenSpec workflow contribution', () => {
  it('parses the read-only definition and the four OpenSpec shadow triggers', () => {
    const contribution = readWorkflowContribution()
    expect(contribution.source).toBe('@dsh-setup/plugin-openspec')
    expect(contribution.definitions).toHaveLength(1)

    const definition = contribution.definitions[0] as AssetDefinition
    expect(definition.id).toBe('change-intake')
    expect(definition.steps).toHaveLength(7)
    expect(definition.steps.map((step) => step.id)).toEqual([
      'requirements',
      'architecture',
      'interface',
      'create-change',
      'spec',
      'spec-review',
      'approval',
    ])
    expect(definition.steps.find((step) => step.id === 'spec-review')?.ownership).toBe('defer')
    expect(definition.trigger.match).toEqual({
      tool: 'shell',
      command: 'openspec new change {name}',
    })
    expect(definition.settings?.gate).toBe('intake')

    expect(contribution.triggers.map((trigger) => (trigger as { id: string }).id)).toEqual([
      'openspec-tasks-checked',
      'openspec-review-recorded',
      'openspec-change-created',
      'openspec-change-archived',
    ])
  })

  it('registers through inject and disposes through the context effect', () => {
    const fake = fakeRegistry()
    const { ctx, injections, effectDisposers } = pluginContext(fake.registry)

    registerWorkflowsContribution(ctx)

    expect(injections).toEqual([['workflowsDefinitions']])
    expect(fake.registered[0]?.source).toBe('@dsh-setup/plugin-openspec')
    expect(fake.registered).toEqual([readWorkflowContribution()])
    expect(effectDisposers).toHaveLength(1)
    expect(fake.disposals()).toBe(0)
    effectDisposers[0]?.()
    expect(fake.disposals()).toBe(1)
  })

  it('registers nothing when the registry service is absent', () => {
    const { ctx, effectDisposers } = pluginContext(undefined)
    expect(() => registerWorkflowsContribution(ctx)).not.toThrow()
    expect(effectDisposers).toHaveLength(0)
  })

  it('registers nothing on a host without inject', () => {
    const ctx = {} as unknown as Context
    expect(() => registerWorkflowsContribution(ctx)).not.toThrow()
  })

  it('surfaces a refusal from the engine registry', () => {
    const failure = new Error('workflow definition "change-intake" is refused: duplicate id')
    const fake = fakeRegistry({ failure })
    const { ctx } = pluginContext(fake.registry, false)
    expect(() => registerWorkflowsContribution(ctx)).toThrow(failure)
  })

  it('validates the assets through the engine closed schema', () => {
    const registry = new DefinitionsRegistry()
    const dispose = registry.register(readWorkflowContribution())
    try {
      const installed = registry.installed('change-intake')
      expect(installed?.source).toBe('plugin')
      expect(installed?.plugin).toBe('@dsh-setup/plugin-openspec')
      expect(installed?.definition.settings.gate).toBe('intake')
      expect(installed?.definition.trigger.match.command).toBe('openspec new change {name}')
      expect(registry.installedTrigger('openspec-tasks-checked')?.plugin).toBe(
        '@dsh-setup/plugin-openspec',
      )
    } finally {
      dispose()
    }

    // A malformed trigger refuses the whole contribution, naming the field.
    const refused = new DefinitionsRegistry()
    expect(() =>
      refused.register({
        source: '@acme/plugin',
        definitions: [],
        triggers: [{ id: 'bad-trigger', event: 'intent.change', mode: 'shadow', dedupe: 'none' }],
      }),
    ).toThrow(/workflow trigger "bad-trigger".*field "event"/u)
    expect(refused.installedTrigger('bad-trigger')).toBeUndefined()

    // A malformed definition registers no part of the contribution either.
    const malformed = {
      ...(readWorkflowContribution().definitions[0] as Record<string, unknown>),
      id: 'bad-def',
      unknown: true,
    }
    expect(() =>
      refused.register({ source: '@acme/plugin', definitions: [malformed], triggers: [] }),
    ).toThrow(/not a known field/u)
    expect(refused.installed('bad-def')).toBeUndefined()
  })
})
