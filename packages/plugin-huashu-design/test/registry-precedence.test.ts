import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { SkillCandidate, SkillProvider } from '@deepseek-ai/dsh-skill'
import SkillRegistry, { BUNDLED_SKILL_RANK } from '@deepseek-ai/dsh-skill'
import { afterAll, describe, expect, it } from 'vitest'

/**
 * The shipped skill registry decides the duplicate `huashu-design` name, so the
 * precedence is exercised against the real registry with the shipped constants,
 * not against a stub: the adapter must win over the bundled root and lose to a
 * user skill.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))
/** `USER_AGENTS_RANK` in `@deepseek-ai/dsh-skill-filesystem`, not exported there. */
const USER_SKILL_RANK = 500
/** The body the adapter must load, after the upstream frontmatter is replaced. */
const UPSTREAM_BODY = '\r\n# 花叔Design\r\n\r\n正文。\r\n'

const installed = mkdtempSync(join(tmpdir(), 'huashu-design-registry-'))
writeFileSync(
  join(installed, 'package.json'),
  JSON.stringify({ name: 'huashu-design', version: '0.0.0-fixture' }),
)
writeFileSync(
  join(installed, 'SKILL.md'),
  `---\r\nname: huashu-design\r\ndescription: 花叔Design——中文目录行\r\n---\r\n${UPSTREAM_BODY}`,
)

afterAll(() => {
  rmSync(installed, { recursive: true, force: true })
})

interface PluginModule {
  DESCRIPTION: string
  ADAPTER_NOTE: string
  createSkillProvider: (directory: string) => SkillProvider
}

async function loadPlugin(): Promise<PluginModule> {
  const file = join(packageDir, 'lib', 'index.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  return (await import(pathToFileURL(file).href)) as unknown as PluginModule
}

/** One duplicate candidate for the `huashu-design` name, with the given body. */
function competingProvider(
  provider: string,
  rank: number,
  description: string,
  content: string,
): SkillProvider {
  const candidate: SkillCandidate = {
    name: 'huashu-design',
    description,
    invocation: { modelInvocable: true, userInvocable: true },
    provider,
    source: 'bundled',
    rank,
    locator: content,
  }
  return {
    name: provider,
    list: () => Promise.resolve([candidate]),
    get: (loaded) =>
      Promise.resolve({
        name: loaded.name,
        description: loaded.description,
        invocation: loaded.invocation,
        provider: loaded.provider,
        source: loaded.source,
        content,
      }),
  }
}

describe('huashu-design catalog precedence in the shipped registry', () => {
  it('shadows the Chinese bundled candidate and keeps its body', async () => {
    const plugin = await loadPlugin()
    const registry = new SkillRegistry(new Context())
    registry.registerProvider(() =>
      competingProvider('filesystem', BUNDLED_SKILL_RANK, '花叔Design——中文目录行', '中文正文'),
    )
    registry.registerProvider(() => plugin.createSkillProvider(installed))

    const entries = await registry.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.name).toBe('huashu-design')
    expect(entries[0]?.description).toBe(plugin.DESCRIPTION)
    expect(entries[0]?.provider).toBe('dsh-setup-huashu-design')

    const loaded = await registry.get('huashu-design')
    expect(loaded?.provider).toBe('dsh-setup-huashu-design')
    expect(loaded?.content.startsWith(UPSTREAM_BODY)).toBe(true)
    expect(loaded?.content.endsWith(plugin.ADAPTER_NOTE)).toBe(true)
  })

  it('loses the name to a user skill, so a local copy still overrides it', async () => {
    const plugin = await loadPlugin()
    const registry = new SkillRegistry(new Context())
    registry.registerProvider(() => plugin.createSkillProvider(installed))
    registry.registerProvider(() =>
      competingProvider('filesystem', USER_SKILL_RANK, 'Local copy', '# local body\n'),
    )

    const entries = await registry.list()
    expect(entries).toHaveLength(1)
    expect(entries[0]?.description).toBe('Local copy')
    expect(entries[0]?.provider).toBe('filesystem')
    expect((await registry.get('huashu-design'))?.content).toBe('# local body\n')
  })
})
