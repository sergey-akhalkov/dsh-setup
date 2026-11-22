import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'

/**
 * The adapter shadows the upstream Chinese catalog entry with an English one.
 * The upstream body is read from the installed package, so the positive path
 * runs against a throwaway directory shaped like that package and a throwaway
 * profile that carries it under `node_modules`.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const CJK = /[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/u

const fixture = mkdtempSync(join(tmpdir(), 'huashu-design-adapter-'))
writeFileSync(
  join(fixture, 'package.json'),
  JSON.stringify({ name: 'huashu-design', version: '0.0.0-fixture' }),
)
const upstreamBody =
  '---\r\nname: huashu-design\r\ndescription: 花叔Design——用HTML做高保真原型\r\n---\r\n\r\n# 花叔Design\r\n\r\n正文。\r\n'
writeFileSync(join(fixture, 'SKILL.md'), upstreamBody)

const homeFixture = mkdtempSync(join(tmpdir(), 'huashu-design-home-'))
const profileFixture = join(homeFixture, 'profiles', 'probe')
const installed = join(profileFixture, 'node_modules', 'huashu-design')
mkdirSync(installed, { recursive: true })
writeFileSync(
  join(installed, 'package.json'),
  JSON.stringify({ name: 'huashu-design', version: '0.0.0-fixture' }),
)
writeFileSync(join(installed, 'SKILL.md'), upstreamBody)

afterAll(() => {
  rmSync(fixture, { recursive: true, force: true })
  rmSync(homeFixture, { recursive: true, force: true })
})

interface Invocation {
  modelInvocable: boolean
  userInvocable: boolean
}

interface Candidate {
  name: string
  description: string
  invocation: Invocation
  provider: string
  source: string
  rank: number
  resourceBase?: { kind: string; path: string }
  locator?: unknown
}

interface Definition {
  name: string
  description: string
  content: string
  resourceBase?: { kind: string; path: string }
}

interface Provider {
  name: string
  list: () => Promise<Candidate[]>
  get: (candidate: Candidate, options: { signal?: AbortSignal }) => Promise<Definition | undefined>
}

interface PluginModule {
  name: string
  inject: string[]
  DESCRIPTION: string
  ADAPTER_NOTE: string
  stripFrontmatter: (text: string) => string
  createSkillProvider: (directory: string) => Provider
  resolveUpstreamDirectory: (env?: NodeJS.ProcessEnv) => string | undefined
  apply: (ctx: { skills: { registerProvider: (create: () => Provider) => void } }) => void
}

async function loadPlugin(): Promise<PluginModule> {
  const file = join(packageDir, 'lib', 'index.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  return (await import(pathToFileURL(file).href)) as unknown as PluginModule
}

/** The checkout has no upstream package and no profile anchor of its own. */
function withoutProfileEnv(): NodeJS.ProcessEnv {
  return { ...process.env, DSH_PROFILE_DIR: '', DSH_HOME: '', DSH_PROFILE: '' }
}

describe('huashu-design English catalog adapter', () => {
  it('exports the package identity and the single injected service', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-huashu-design')
    expect(plugin.inject).toEqual(['skills'])
  })

  it('describes the skill in English, not in the upstream Chinese copy', async () => {
    const plugin = await loadPlugin()
    expect(CJK.test(plugin.DESCRIPTION)).toBe(false)
    expect(plugin.DESCRIPTION).toContain('three directions')
    expect(plugin.DESCRIPTION).toContain('UI mockup')
    expect(plugin.DESCRIPTION).toContain('App Store')
  })

  it('lists nothing while the profile has no upstream package', async () => {
    const plugin = await loadPlugin()
    vi.stubEnv('DSH_PROFILE_DIR', '')
    vi.stubEnv('DSH_HOME', '')
    vi.stubEnv('DSH_PROFILE', '')
    try {
      expect(plugin.resolveUpstreamDirectory()).toBeUndefined()
      const providers: Provider[] = []
      plugin.apply({ skills: { registerProvider: (create) => void providers.push(create()) } })
      expect(providers).toHaveLength(1)
      expect(await providers[0]?.list()).toEqual([])
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('finds the package from the profile directory when the setup was linked', async () => {
    const plugin = await loadPlugin()
    expect(plugin.resolveUpstreamDirectory(withoutProfileEnv())).toBeUndefined()
    expect(plugin.resolveUpstreamDirectory({ DSH_PROFILE_DIR: profileFixture })).toBe(installed)
    expect(plugin.resolveUpstreamDirectory({ DSH_HOME: homeFixture, DSH_PROFILE: 'probe' })).toBe(
      installed,
    )
  })

  it('shadows the bundled catalog entry without outranking a user skill', async () => {
    const plugin = await loadPlugin()
    const provider = plugin.createSkillProvider(fixture)
    const candidates = await provider.list()
    expect(candidates).toHaveLength(1)
    const candidate = candidates[0]
    expect(candidate).toMatchObject({
      name: 'huashu-design',
      description: plugin.DESCRIPTION,
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-setup-huashu-design',
      source: 'bundled',
    })
    // A user skill ranks 500, the upstream bundled root ranks 600.
    expect(candidate?.rank).toBeGreaterThan(500)
    expect(candidate?.rank).toBeLessThan(600)
    expect(candidate?.resourceBase?.path.replaceAll('\\', '/')).toBe(fixture.replaceAll('\\', '/'))
    expect(String(candidate?.locator).replaceAll('\\', '/')).toMatch(/SKILL\.md$/u)
  })

  it('loads the upstream body without its frontmatter and ends with the English directive', async () => {
    const plugin = await loadPlugin()
    const provider = plugin.createSkillProvider(fixture)
    const candidate = (await provider.list())[0]
    if (candidate === undefined) throw new Error('no candidate')
    const definition = await provider.get(candidate, {})
    // Spelled out rather than read from the module, so removing the directive
    // or emptying it fails here instead of agreeing with itself.
    const expectedDirective = [
      '',
      '',
      '---',
      '',
      "DeepSeek Harness adapter: the upstream instruction in this skill is written in Chinese and remains the authority for the work. Talk to the user in the user's own language, and write the deliverable's own copy in English unless the user asks for another language. Relative paths in the instruction resolve against this skill's base directory, which holds the upstream `references/`, `assets/`, and `scripts/`.",
    ].join('\n')
    expect(plugin.ADAPTER_NOTE).toBe(expectedDirective)
    expect(definition?.content.startsWith('\r\n# 花叔Design')).toBe(true)
    expect(definition?.content).not.toContain('花叔Design——用HTML做高保真原型')
    expect(definition?.content.endsWith(expectedDirective)).toBe(true)
    expect(definition?.content).toContain('正文。')
    expect(expectedDirective).toContain('written in Chinese')
    expect(expectedDirective).toContain("user's own language")
    expect(expectedDirective).toContain('copy in English')
  })

  it('resolves the base directory to the installed package so relative paths work', async () => {
    const plugin = await loadPlugin()
    const provider = plugin.createSkillProvider(fixture)
    const definition = await provider.get((await provider.list())[0] as Candidate, {})
    expect(definition?.resourceBase).toEqual({
      kind: 'directory',
      path: fixture.replaceAll('\\', '/'),
    })
  })

  it('leaves a body that carries no frontmatter untouched', async () => {
    const plugin = await loadPlugin()
    expect(plugin.stripFrontmatter('# body\n')).toBe('# body\n')
    expect(plugin.stripFrontmatter(upstreamBody)).toBe('\r\n# 花叔Design\r\n\r\n正文。\r\n')
  })

  it('reads no network while listing or loading', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network disabled for this test')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const plugin = await loadPlugin()
    const provider = plugin.createSkillProvider(fixture)
    const candidate = (await provider.list())[0]
    if (candidate !== undefined) await provider.get(candidate, {})
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
