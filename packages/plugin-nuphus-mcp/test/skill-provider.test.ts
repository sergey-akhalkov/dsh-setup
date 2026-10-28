import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const skillAsset = readFileSync(join(packageDir, 'assets', 'nuphus-discipline', 'SKILL.md'), 'utf8')

interface SkillCandidateShape {
  name: string
  description: string
  provider: string
  source: string
  rank: number
  resourceBase?: { kind: string; path: string }
}

interface SkillProviderShape {
  name: string
  list: () => Promise<SkillCandidateShape[]>
  get: (
    candidate: SkillCandidateShape,
    options: { signal?: AbortSignal },
  ) => Promise<{ name: string; content: string } | undefined>
}

interface FakeContext {
  skills: { registerProvider: (create: () => SkillProviderShape) => void }
}

interface PluginModule {
  name: string
  inject: string[]
  apply: (ctx: FakeContext) => void
}

async function loadPlugin(): Promise<PluginModule> {
  const file = join(packageDir, 'lib', 'index.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  return (await import(pathToFileURL(file).href)) as unknown as PluginModule
}

function createContext(): { ctx: FakeContext; providers: SkillProviderShape[] } {
  const providers: SkillProviderShape[] = []
  const ctx: FakeContext = {
    skills: {
      registerProvider(create: () => SkillProviderShape): void {
        providers.push(create())
      },
    },
  }
  return { ctx, providers }
}

function frontmatterDescription(asset: string): string {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(asset)?.[1] ?? ''
  const raw = /^description:\s*>\s*\n([\s\S]*)$/m.exec(block)?.[1] ?? ''
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
}

const collapse = (text: string): string => text.split(/\s+/).filter(Boolean).join(' ')

describe('nuphus guidance half', () => {
  it('exports the package identity and the injected service', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-nuphus-mcp')
    expect(plugin.inject).toEqual(['skills'])
  })

  it('lists the nuphus-discipline skill from its own asset directory', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    const provider = providers[0]
    expect(provider?.name).toBe('dsh-setup-nuphus')
    const candidate = (await provider?.list())?.[0]
    expect(candidate).toMatchObject({
      name: 'nuphus-discipline',
      provider: 'dsh-setup-nuphus',
      source: 'bundled',
      rank: 600,
      resourceBase: { kind: 'directory' },
    })
    expect(candidate?.resourceBase?.path.replaceAll('\\', '/')).toMatch(
      /assets\/nuphus-discipline$/,
    )
  })

  it('keeps the catalog description identical to the asset frontmatter', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const candidate = (await providers[0]?.list())?.[0]
    expect(collapse(candidate?.description ?? '')).toBe(
      collapse(frontmatterDescription(skillAsset)),
    )
  })

  it('describes only the lazy access path', () => {
    expect(skillAsset).not.toContain('mcp__nuphus-mcp__')
    expect(skillAsset).toContain('mcp_tools')
    expect(skillAsset).toContain('mcp_call')
    expect(skillAsset).toContain('--confirm-write')
    expect(skillAsset).toContain('120000')
    expect(skillAsset).toContain('read_image')
  })

  it('loads the body followed by a note that the adapter row works without it', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    const candidate = (await provider?.list())?.[0]
    expect(provider).toBeDefined()
    expect(candidate).toBeDefined()
    if (provider === undefined || candidate === undefined) return

    const definition = await provider.get(candidate, {})
    expect(definition?.name).toBe('nuphus-discipline')
    expect(definition?.content.startsWith(skillAsset)).toBe(true)
    expect(definition?.content).toContain('keeps working when this guidance row is disabled')
  })
})
