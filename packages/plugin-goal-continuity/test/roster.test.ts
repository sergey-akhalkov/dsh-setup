import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply } from '../lib/index.js'

/**
 * The Web client builds its mode picker from `agentPresets/list`. The reviewer
 * preset must stay out of that roster while the registry keeps it for the gate.
 */

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

interface RosterRow {
  id: string
}

function roster(presets: RosterRow[]) {
  return {
    list: async () => presets,
    remoteExportList: async () => ({
      presets: presets.map((preset) => ({
        ...preset,
        isDefault: preset.id === 'standard',
      })),
    }),
  }
}

async function readRoster(ctx: Context): Promise<{ presets: Array<Record<string, unknown>> }> {
  const service = ctx.get('agentPresets') as {
    remoteExportList: () => Promise<{ presets: Array<Record<string, unknown>> }>
  }
  const method = Reflect.get(service, 'remoteExportList') as () => Promise<{
    presets: Array<Record<string, unknown>>
  }>
  return Reflect.apply(method, service, [])
}

function createContext(service: ReturnType<typeof roster>): Context {
  const ctx = new Context()
  ctx.provide('agents', { list: () => [] } as never)
  ctx.provide('goals', { get: () => undefined } as never)
  ctx.provide('agentPresets', service as never)
  apply(ctx)
  return ctx
}

describe('reviewer preset visibility', () => {
  it('hides the reviewer from the client roster and keeps it for the host', async () => {
    const service = roster([{ id: 'standard' }, { id: 'goal-reviewer' }])
    const ctx = createContext(service)
    await flush()

    await expect(readRoster(ctx)).resolves.toEqual({
      presets: [{ id: 'standard', isDefault: true }],
    })
    await expect(service.list()).resolves.toEqual([{ id: 'standard' }, { id: 'goal-reviewer' }])
  })

  it('leaves a roster without the reviewer unchanged', async () => {
    const service = roster([{ id: 'standard' }, { id: 'custom' }])
    const ctx = createContext(service)
    await flush()

    await expect(readRoster(ctx)).resolves.toEqual({
      presets: [
        { id: 'standard', isDefault: true },
        { id: 'custom', isDefault: false },
      ],
    })
  })
})
