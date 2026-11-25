import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const skillAsset = readFileSync(join(packageDir, 'assets', 'issue-triage', 'SKILL.md'), 'utf8')
const bundlePatch = readFileSync(join(packageDir, 'cordis.patch.yml'), 'utf8')

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

/** The adapter note the provider appends after the asset body; pinned on purpose. */
const ADAPTER_NOTE = [
  '',
  '',
  '---',
  '',
  'DeepSeek Harness adapter: this skill ships inside @dsh-setup/plugin-issue-triage as first-party guidance for this Harness; it is not pinned upstream text. It runs `gh` and the `openspec` CLI from PATH.',
].join('\n')

interface BundleRow {
  id: string
  name: string
  disabled?: boolean
}

/** The generated bundle row a profile mounts and can disable. */
const bundleRows = (parse(bundlePatch) as Array<{ insert?: BundleRow[] }>).flatMap(
  (patch) => patch.insert ?? [],
)

/**
 * Mounts one row the way the Harness loader does: a `disabled: true` row is
 * skipped and its plugin never applies, so the provider cannot observe the flag.
 */
function mountRow(plugin: PluginModule, row: BundleRow) {
  const { ctx, providers } = createContext()
  if (row.disabled !== true) plugin.apply(ctx)
  return providers
}

describe('issue-triage plugin', () => {
  it('exports the package identity and injects only the skills service', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-issue-triage')
    expect(plugin.inject).toEqual(['skills'])
  })

  it('lists one candidate at the bundled rank with its own asset directory', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    const provider = providers[0]
    expect(provider?.name).toBe('dsh-setup-issue-triage')
    const candidates = await provider?.list()
    expect(candidates).toHaveLength(1)
    expect(candidates?.[0]).toMatchObject({
      name: 'issue-triage',
      provider: 'dsh-setup-issue-triage',
      source: 'bundled',
      rank: 600,
      invocation: { modelInvocable: true, userInvocable: true },
      resourceBase: { kind: 'directory' },
    })
    expect(candidates?.[0]?.resourceBase?.path.replaceAll('\\', '/')).toMatch(
      /assets\/issue-triage$/,
    )
    expect(String(candidates?.[0]?.locator).replaceAll('\\', '/')).toMatch(
      /assets\/issue-triage\/SKILL\.md$/,
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
    expect(definition?.name).toBe('issue-triage')
    expect(definition).toMatchObject({ invocation: { modelInvocable: true, userInvocable: true } })
    expect(definition?.content.startsWith(skillAsset)).toBe(true)
    // Exactly the body plus the adapter note: dropping or appending anything fails here.
    expect(definition?.content.slice(skillAsset.length)).toBe(ADAPTER_NOTE)
  })

  it('returns nothing for a name it does not ship', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    if (provider === undefined) return
    const definition = await provider.get(
      { name: 'other', description: '', provider: 'x', source: 'bundled', rank: 600 },
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

  it('mounts the generated row enabled and lists no candidate when the row is disabled', async () => {
    const plugin = await loadPlugin()
    const row = bundleRows.find((entry) => entry.id === 'dsh-setup-issue-triage')
    expect(row).toBeDefined()
    if (row === undefined) return
    expect(row.disabled).toBeUndefined()

    const enabled = mountRow(plugin, row)
    expect(enabled).toHaveLength(1)
    const candidates = await enabled[0]?.list()
    expect(candidates?.map((candidate) => candidate.name)).toEqual(['issue-triage'])

    const disabled = mountRow(plugin, { ...row, disabled: true })
    expect(disabled).toHaveLength(0)
  })
})
