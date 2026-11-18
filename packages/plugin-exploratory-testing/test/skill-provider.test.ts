import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const skillAsset = readFileSync(
  join(packageDir, 'assets', 'exploratory-testing', 'SKILL.md'),
  'utf8',
)

interface SkillCandidateShape {
  name: string
  description: string
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

interface FakeContext {
  skills: { registerProvider: (create: () => SkillProviderShape) => void }
  readonly systemPromptReads: number
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
  let systemPromptReads = 0
  const ctx = {
    skills: {
      registerProvider(create: () => SkillProviderShape): void {
        providers.push(create())
      },
    },
    // Any always-on contribution would read this service; the method is opt-in.
    get systemPrompt(): undefined {
      systemPromptReads += 1
      return undefined
    },
    get systemPromptReads(): number {
      return systemPromptReads
    },
  }
  return { ctx, providers }
}

/** Read `description` from the asset frontmatter as one collapsed line. */
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

describe('exploratory testing plugin', () => {
  it('exports the package identity and injects only the skills service', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-exploratory-testing')
    expect(plugin.inject).toEqual(['skills'])
  })

  it('lists the skill with the bundled rank and its own asset directory', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    const provider = providers[0]
    expect(provider?.name).toBe('dsh-setup-exploratory-testing')
    const candidate = (await provider?.list())?.[0]
    expect(candidate).toMatchObject({
      name: 'exploratory-testing',
      provider: 'dsh-setup-exploratory-testing',
      source: 'bundled',
      rank: 600,
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: 'directory' },
    })
    expect(candidate?.resourceBase?.path.replaceAll('\\', '/')).toMatch(
      /assets\/exploratory-testing$/,
    )
    expect(String(candidate?.locator).replaceAll('\\', '/')).toMatch(
      /assets\/exploratory-testing\/SKILL\.md$/,
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

  it('loads the body followed exactly by the adapter note', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    const candidate = (await provider?.list())?.[0]
    expect(provider).toBeDefined()
    expect(candidate).toBeDefined()
    if (provider === undefined || candidate === undefined) return

    const definition = await provider.get(candidate, {})
    expect(definition?.name).toBe('exploratory-testing')
    expect(definition).toMatchObject({
      invocation: { modelInvocable: true, userInvocable: true },
    })
    expect(definition?.content.startsWith(skillAsset)).toBe(true)
    expect(definition?.content).toContain('templates.md')
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
        provider: 'x',
        source: 'bundled',
        rank: 600,
      },
      {},
    )
    expect(definition).toBeUndefined()
  })

  it('registers no always-on system-prompt contribution', async () => {
    const plugin = await loadPlugin()
    const { ctx } = createContext()
    plugin.apply(ctx)
    expect(ctx.systemPromptReads).toBe(0)
  })
})
