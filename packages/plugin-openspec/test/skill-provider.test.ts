import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const lock = JSON.parse(readFileSync(join(packageDir, 'openspec.lock.json'), 'utf8')) as {
  upstream: { version: string }
  skills: Array<{ name: string; description: string; path: string }>
}

const guidancePath = join(packageDir, 'assets', 'guidance', 'task-lanes.md')
const guidance = readFileSync(guidancePath, 'utf8')
const guidanceSkills = new Set([
  'openspec-apply-change',
  'openspec-propose',
  'openspec-update-change',
])

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
}

interface PluginModule {
  name: string
  inject: string[]
  apply: (ctx: FakeContext) => void
  assertGuidanceTargets: (skills: ReadonlyArray<{ name: string }>) => void
}

async function loadPlugin(): Promise<PluginModule> {
  const file = join(packageDir, 'lib', 'index.js')
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

function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/^\n+/, '')
}

describe('openspec plugin', () => {
  it('exports the package identity and the injected service', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-openspec')
    expect(plugin.inject).toEqual(['skills'])
  })

  it('lists the six pinned skills with the bundled rank and description', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    const provider = providers[0]
    expect(provider?.name).toBe('dsh-setup-openspec')
    const candidates = (await provider?.list()) ?? []
    expect(candidates.map((candidate) => candidate.name)).toEqual(
      lock.skills.map((skill) => skill.name),
    )
    for (const candidate of candidates) {
      expect(candidate).toMatchObject({
        provider: 'dsh-setup-openspec',
        source: 'bundled',
        rank: 600,
        resourceBase: { kind: 'directory' },
      })
      expect(candidate.resourceBase?.path.replaceAll('\\', '/')).toMatch(
        /assets\/openspec\/openspec-[a-z-]+$/,
      )
      expect(String(candidate.locator).replaceAll('\\', '/')).toMatch(
        /assets\/openspec\/openspec-[a-z-]+\/SKILL\.md$/,
      )
    }
    expect(candidates.map((candidate) => candidate.description)).toEqual(
      lock.skills.map((skill) => skill.description),
    )
  })

  it('loads each body without frontmatter and appends the adapter note', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    if (provider === undefined) throw new Error('provider was not registered')
    const candidates = await provider.list()

    for (const candidate of candidates) {
      const record = lock.skills.find((skill) => skill.name === candidate.name)
      if (record === undefined) throw new Error(`missing lock record for ${candidate.name}`)
      const asset = readFileSync(join(packageDir, record.path), 'utf8')
      const definition = await provider.get(candidate, {})
      expect(definition?.name).toBe(candidate.name)
      expect(definition?.content.startsWith(stripFrontmatter(asset))).toBe(true)
      expect(definition?.content.startsWith('---')).toBe(false)
      expect(definition?.content).toContain(`OpenSpec ${lock.upstream.version}`)
      expect(definition?.content).toContain(
        `npm install -g @fission-ai/openspec@${lock.upstream.version}`,
      )
      expect(definition?.content).toContain('--tools none')
      expect(definition?.content).toContain('.dsh/skills/openspec-')
      const content = definition?.content ?? ''
      if (guidanceSkills.has(candidate.name)) {
        expect(content).toContain('## Task lanes (dsh-setup guidance)')
        expect(content).toContain(guidance.trim())
        expect(content.indexOf('## Task lanes (dsh-setup guidance)')).toBeLessThan(
          content.indexOf('DeepSeek Harness adapter:'),
        )
      } else {
        expect(content).not.toContain('## Task lanes (dsh-setup guidance)')
      }
      expect(content.trimEnd().endsWith('does not install runtime prerequisites.')).toBe(true)
    }
  })

  it('requires a work-only single-lane reason and one apply-start lane check', () => {
    const text = guidance.replace(/\s+/gu, ' ')
    expect(text).toContain("Name each lane's owned paths in its heading")
    expect(text).toContain(
      'one work constraint, meaning a shared hot file, generated output, or a serial gate',
    )
    expect(text).toContain(
      'A task-review or archive process is not a work constraint and is never a single-lane reason',
    )
    expect(text).toContain(
      'When applying, before the first implementation task, read the level-2 headings once and assign each independent lane to a worker or record its serial decision',
    )
    expect(text).toContain('no new tool or state')
  })

  it('ships the task-lane guidance outside the pinned asset directory', () => {
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      files: string[]
    }
    expect(manifest.files).toContain('assets/guidance/task-lanes.md')
    expect(guidancePath.replaceAll('\\', '/')).not.toContain('/assets/openspec/')
    expect(Buffer.byteLength(guidance, 'utf8')).toBeLessThan(4096)
    expect(guidance).not.toContain('\r')
  })

  it('refuses a lock missing a task-lane guidance target', async () => {
    const plugin = await loadPlugin()
    const realSkills = lock.skills.map((skill) => ({ name: skill.name }))
    expect(() => plugin.assertGuidanceTargets(realSkills)).not.toThrow()
    for (const skillName of guidanceSkills) {
      const missing = realSkills.filter((skill) => skill.name !== skillName)
      expect(() => plugin.assertGuidanceTargets(missing)).toThrow(skillName)
    }
  })

  it('returns nothing for a name it does not ship', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    if (provider === undefined) throw new Error('provider was not registered')
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
})
