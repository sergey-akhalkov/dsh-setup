import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const rulesAsset = readFileSync(join(packageDir, 'assets', 'serena-discipline', 'rules.md'), 'utf8')

interface PromptSectionShape {
  name: string
  order: number
  text: string
  interpolate?: boolean
}

interface SkillProviderShape {
  name: string
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

describe('serena plugin always-on rule', () => {
  it('exports the package identity and both injected services', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-serena')
    expect(plugin.inject).toEqual(['skills', 'systemPrompt'])
  })

  it('registers the code-surface rule as an always-on section at order 130', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers, sections } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    expect(sections).toHaveLength(1)
    const section = sections[0]
    expect(section?.name).toBe('dsh-setup:serena')
    expect(section?.order).toBe(130)
    expect(section?.interpolate).toBe(false)
    expect(section?.text).toBe(rulesAsset)
    expect(section?.text).toContain('mcp_tools')
    expect(section?.text).toContain('mcp_call')
    expect(section?.text).toContain('activate_project')
    expect(section?.text).toContain('serena-discipline')
    expect(section?.text).toContain('large-file')
    expect(section?.text).toContain('grep')
    expect(section?.text).toContain('search_for_pattern')
    expect(section?.text).toContain('stop serena guidance')
    expect(section?.text).not.toMatch(/mcp__serena__/)
    expect(section?.text).not.toContain('get_symbols_overview')
  })

  it('skips only the always-on section when asked to via configuration', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers, sections } = createContext()
    plugin.apply(ctx, { alwaysOn: false })

    expect(sections).toHaveLength(0)
    expect(providers).toHaveLength(1)
  })
})
