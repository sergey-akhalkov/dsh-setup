import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const assetsDir = join(packageDir, 'assets')
const contractAsset = readFileSync(join(assetsDir, 'working-principles', 'contract.md'), 'utf8')
const principleAsset = readFileSync(join(assetsDir, 'working-principles', 'SKILL.md'), 'utf8')
const verifyAsset = readFileSync(join(assetsDir, 'verify-change', 'SKILL.md'), 'utf8')
const budgetAsset = readFileSync(join(assetsDir, 'instruction-budget', 'SKILL.md'), 'utf8')

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

describe('working-principles plugin', () => {
  it('exports the package identity and both injected services', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-working-principles')
    expect(plugin.inject).toEqual(['skills', 'systemPrompt'])
  })

  it('lists every candidate under one bundled provider', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    const provider = providers[0]
    expect(provider?.name).toBe('dsh-setup-working-principles')
    const candidates = (await provider?.list()) ?? []
    expect(candidates.map((candidate) => candidate.name)).toEqual([
      'working-principles',
      'verify-change',
      'instruction-budget',
    ])
    for (const candidate of candidates) {
      expect(candidate).toMatchObject({
        invocation: { modelInvocable: true, userInvocable: true },
        provider: 'dsh-setup-working-principles',
        source: 'bundled',
        rank: 600,
        resourceBase: { kind: 'directory' },
      })
      expect(String(candidate.locator).replaceAll('\\', '/')).toMatch(/SKILL\.md$/)
    }
  })

  it('keeps every catalog description identical to its asset frontmatter', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const candidates = (await providers[0]?.list()) ?? []
    const assets = new Map([
      ['working-principles', principleAsset],
      ['verify-change', verifyAsset],
      ['instruction-budget', budgetAsset],
    ])
    for (const candidate of candidates) {
      const asset = assets.get(candidate.name)
      expect(asset, `missing asset for ${candidate.name}`).toBeDefined()
      if (asset === undefined) continue
      expect(collapse(candidate.description)).toBe(collapse(frontmatter(asset).description))
      expect(frontmatter(asset).name).toBe(candidate.name)
    }
  })

  it('registers the contract as an always-on section after the packaged ruleset', async () => {
    const plugin = await loadPlugin()
    const { ctx, sections } = createContext()
    plugin.apply(ctx)

    expect(sections).toHaveLength(1)
    const section = sections[0]
    expect(section?.name).toBe('dsh-setup:working-principles')
    expect(section?.order).toBe(110)
    expect(section?.interpolate).toBe(false)
    expect(section?.text.startsWith(contractAsset)).toBe(true)
    const footer = section?.text.slice(contractAsset.length) ?? ''
    expect(footer).toContain('stop working principles')
    expect(footer).toContain('normal mode')
    expect(footer).toContain('alwaysOn: false')
    expect(footer).not.toContain('/working-principles')
  })

  it('includes the goal-round policy in the assembled always-on section', async () => {
    const plugin = await loadPlugin()
    const { ctx, sections } = createContext()
    plugin.apply(ctx)
    const text = sections[0]?.text ?? ''
    expect(text).toContain('`job_output(wait: true)`')
    expect(text).toContain('max_goal_rounds')
    expect(text).toContain('three consecutive rounds')
  })

  it('skips only the always-on section when asked to via configuration', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers, sections } = createContext()
    plugin.apply(ctx, { alwaysOn: false })

    expect(sections).toHaveLength(0)
    expect(providers).toHaveLength(1)
  })

  it('loads a body followed exactly by the adapter note', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    const candidate = (await provider?.list())?.find((entry) => entry.name === 'verify-change')
    expect(provider).toBeDefined()
    expect(candidate).toBeDefined()
    if (provider === undefined || candidate === undefined) return

    const definition = await provider.get(candidate, {})
    expect(definition?.name).toBe('verify-change')
    expect(definition?.content.startsWith(verifyAsset)).toBe(true)
    expect(definition?.content).toContain('first-party guidance adapted for this Harness')
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
    vi.unstubAllGlobals()
  })
})
