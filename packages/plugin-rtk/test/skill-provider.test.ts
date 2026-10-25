import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const skillAsset = readFileSync(join(packageDir, 'assets', 'rtk', 'SKILL.md'), 'utf8')

interface SkillInvocationShape {
  modelInvocable: boolean
  userInvocable: boolean
}

interface SkillCandidateShape {
  name: string
  description: string
  invocation: SkillInvocationShape
  provider: string
  source: string
  rank: number
  resourceBase?: { kind: string; path: string }
  locator?: unknown
}

interface SkillDefinitionShape {
  name: string
  description: string
  content: string
}

interface SkillProviderShape {
  name: string
  list: () => Promise<SkillCandidateShape[]>
  get: (
    candidate: SkillCandidateShape,
    options: { signal?: AbortSignal },
  ) => Promise<SkillDefinitionShape | undefined>
}

interface PromptSectionShape {
  name: string
  order: number
  text: string
  interpolate?: boolean
}

interface FakeContext {
  skills: { registerProvider: (create: () => SkillProviderShape) => void }
  systemPrompt: { section: (section: PromptSectionShape) => void }
}

interface PluginModule {
  name: string
  inject: string[]
  apply: (ctx: FakeContext, config?: { alwaysOn?: boolean }) => void
}

async function loadPlugin(): Promise<PluginModule> {
  const file = join(packageDir, 'lib', 'index.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  return (await import(pathToFileURL(file).href)) as unknown as PluginModule
}

interface ContextHarness {
  ctx: FakeContext
  providers: SkillProviderShape[]
  sections: PromptSectionShape[]
}

function createContext(): ContextHarness {
  const providers: SkillProviderShape[] = []
  const sections: PromptSectionShape[] = []
  const ctx: FakeContext = {
    skills: {
      registerProvider(create: () => SkillProviderShape): void {
        providers.push(create())
      },
    },
    systemPrompt: {
      section(section: PromptSectionShape): void {
        sections.push(section)
      },
    },
  }
  return { ctx, providers, sections }
}

/** Read `name` and the folded `description` from an asset's frontmatter. */
function frontmatter(asset: string): { name: string; description: string } {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(asset)?.[1] ?? ''
  const name = /^name:\s*(.+)$/m.exec(block)?.[1]?.trim() ?? ''
  const raw = /^description:\s*>\s*\n([\s\S]*)$/m.exec(block)?.[1] ?? ''
  const description = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ')
  return { name, description }
}

const collapse = (text: string): string => text.split(/\s+/).filter(Boolean).join(' ')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rtk skill provider', () => {
  it('lists one bundled candidate and reads the body only on get', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    const provider = providers[0]
    expect(provider?.name).toBe('dsh-setup-rtk')
    const candidates = (await provider?.list()) ?? []
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]
    expect(candidate).toMatchObject({
      name: 'rtk',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-setup-rtk',
      source: 'bundled',
      rank: 600,
      resourceBase: { kind: 'directory' },
    })
    expect(String(candidate?.locator).replaceAll('\\', '/')).toMatch(/SKILL\.md$/)
    expect(candidate).not.toHaveProperty('content')

    if (provider === undefined || candidate === undefined) return
    const definition = await provider.get(candidate, {})
    expect(definition?.name).toBe('rtk')
    expect(definition?.content).toBe(skillAsset)
    expect(collapse(definition?.description ?? '')).toBe(
      collapse(frontmatter(skillAsset).description),
    )
  })

  it('keeps every catalog description identical to the asset frontmatter', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const candidate = (await providers[0]?.list())?.[0]
    expect(candidate).toBeDefined()
    if (candidate === undefined) return
    expect(frontmatter(skillAsset).name).toBe(candidate.name)
    expect(collapse(candidate.description)).toBe(collapse(frontmatter(skillAsset).description))
  })

  it('returns nothing for a name it does not ship', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    if (provider === undefined) return
    const definition = await provider.get(
      {
        name: 'other',
        description: '',
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'x',
        source: 'bundled',
        rank: 600,
      },
      {},
    )
    expect(definition).toBeUndefined()
  })

  it('keeps the skill available when the always-on rule is disabled', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers, sections } = createContext()
    plugin.apply(ctx, { alwaysOn: false })

    expect(sections).toHaveLength(0)
    expect(providers).toHaveLength(1)
    const provider = providers[0]
    const candidate = (await provider?.list())?.[0]
    expect(candidate?.name).toBe('rtk')
  })

  it('does not assert a current rtk version', async () => {
    expect(skillAsset).toContain('rtk --version')
    expect(skillAsset).toContain('2026-10-26')
    expect(skillAsset).not.toMatch(/\brtk\s+v?\d+\.\d+/i)
    expect(skillAsset).not.toMatch(/current version is\s+v?\d+\.\d+/i)
  })

  it('never touches the network while listing or loading', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network disabled for this test')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    for (const candidate of (await provider?.list()) ?? []) await provider?.get(candidate, {})
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
