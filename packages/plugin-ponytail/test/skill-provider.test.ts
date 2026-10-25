import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const assetsDir = join(packageDir, 'assets', 'ponytail')
const skillAsset = readFileSync(join(assetsDir, 'SKILL.md'), 'utf8')
const rulesAsset = readFileSync(join(assetsDir, 'AGENTS.md'), 'utf8')

interface LockFile {
  upstream: { version: string; tag: string; repository: string }
  skill: { description: string }
}

const lock = JSON.parse(readFileSync(join(packageDir, 'ponytail.lock.json'), 'utf8')) as LockFile

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
  invocation: SkillInvocationShape
  provider: string
  source: string
  resourceBase?: { kind: string; path: string }
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

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ponytail plugin', () => {
  it('exports the package identity and both injected services', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-ponytail')
    expect(plugin.inject).toEqual(['skills', 'systemPrompt'])
  })

  it('lists one catalog candidate with the vendored description and bundled rank', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    const provider = providers[0]
    expect(provider?.name).toBe('dsh-setup-ponytail')
    const candidates = await provider?.list()
    expect(candidates).toHaveLength(1)
    const candidate = candidates?.[0]
    expect(candidate).toMatchObject({
      name: 'ponytail',
      description: lock.skill.description,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-setup-ponytail',
      source: 'bundled',
      rank: 600,
      resourceBase: { kind: 'directory' },
    })
    expect(candidate?.resourceBase?.path.replaceAll('\\', '/')).toMatch(/assets\/ponytail$/)
    expect(String(candidate?.locator).replaceAll('\\', '/')).toMatch(/assets\/ponytail\/SKILL\.md$/)
  })

  it('registers the always-on ruleset by default with the pinned adapter footer', async () => {
    const plugin = await loadPlugin()
    const { ctx, sections } = createContext()
    plugin.apply(ctx)

    expect(sections).toHaveLength(1)
    const section = sections[0]
    expect(section?.name).toBe('dsh-setup:ponytail')
    expect(section?.order).toBe(100)
    expect(section?.interpolate).toBe(false)
    expect(section?.text.startsWith(rulesAsset)).toBe(true)
    const footer = section?.text.slice(rulesAsset.length) ?? ''
    expect(footer).toContain(lock.upstream.version)
    expect(footer).toContain(lock.upstream.repository)
    expect(footer).toContain('MIT')
    expect(footer).toContain('stop ponytail')
    expect(footer).toContain('normal mode')
    expect(footer).toContain('lite, full, ultra')
    expect(footer).toContain('no /ponytail command')
  })

  it('skips only the always-on section when asked to via configuration', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers, sections } = createContext()
    plugin.apply(ctx, { alwaysOn: false })

    expect(sections).toHaveLength(0)
    expect(providers).toHaveLength(1)
  })

  it('loads the vendored skill body and appends the adapter note', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    const candidate = (await provider?.list())?.[0]
    expect(candidate).toBeDefined()
    if (provider === undefined || candidate === undefined) return

    const definition = await provider.get(candidate, {})
    expect(definition?.name).toBe('ponytail')
    expect(definition?.content.startsWith(skillAsset)).toBe(true)
    const note = definition?.content.slice(skillAsset.length) ?? ''
    expect(note).toContain(lock.upstream.tag)
    expect(note).toContain('no /ponytail command')
    expect(note).toContain('lite')
  })

  it('never touches the network while listing or loading the skill', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network disabled for this test')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    const candidate = (await provider?.list())?.[0]
    if (provider !== undefined && candidate !== undefined) await provider.get(candidate, {})
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
