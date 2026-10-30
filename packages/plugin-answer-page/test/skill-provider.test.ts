import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const assetsDir = join(packageDir, 'assets', 'answer-me-with-html')
const skillAsset = readFileSync(join(assetsDir, 'SKILL.md'), 'utf8')

interface LockFile {
  upstream: { version: string; tag: string; repository: string; commit: string }
}

const lock = JSON.parse(readFileSync(join(packageDir, 'answer-page.lock.json'), 'utf8')) as LockFile

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
  content?: unknown
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

interface FakeContext {
  skills: { registerProvider: (create: () => SkillProviderShape) => void }
  systemPrompt?: { section: (section: unknown) => void }
}

interface PluginModule {
  name: string
  inject: string[]
  apply: (ctx: FakeContext) => void
  registerAnswerPage: (ctx: FakeContext, directory: string) => void
  assertVendoredBytes: (record: unknown, content: Uint8Array) => void
}

async function loadPlugin(): Promise<PluginModule> {
  const file = join(packageDir, 'lib', 'index.js')
  if (!existsSync(file)) throw new Error('run `pnpm build` before this test')
  return (await import(pathToFileURL(file).href)) as unknown as PluginModule
}

interface ContextHarness {
  ctx: FakeContext
  providers: SkillProviderShape[]
  sections: unknown[]
}

function createContext(): ContextHarness {
  const providers: SkillProviderShape[] = []
  const sections: unknown[] = []
  const ctx: FakeContext = {
    skills: {
      registerProvider(create: () => SkillProviderShape): void {
        providers.push(create())
      },
    },
    systemPrompt: {
      section(section: unknown): void {
        sections.push(section)
      },
    },
  }
  return { ctx, providers, sections }
}

const FIXTURE_SKILL = [
  '---',
  'name: answer-me-with-html',
  'description: fixture skill',
  '---',
  '',
  '# Fixture skill',
  '',
].join('\n')
const FIXTURE_RENDERER = '#!/usr/bin/env node\n// AM_HOME AM_NO_UPDATE_CHECK no-open fixture\n'
const FIXTURE_COMMIT = 'f82dd6dce3ca95b0e565f8cffaf5eba23f4c995f'

const fixtures: string[] = []

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(() => {
  for (const fixture of fixtures) rmSync(fixture, { recursive: true, force: true })
})

interface FixtureOptions {
  tamperRenderer?: boolean
  omitRendererRecord?: boolean
  omitRendererFile?: boolean
  commit?: string
}

function fileRecord(
  path: string,
  content: string,
): {
  path: string
  bytes: number
  sha256: string
} {
  return {
    path,
    bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'),
  }
}

function writeFixtureFile(directory: string, relative: string, content: string): void {
  const file = join(directory, relative)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

interface Fixture {
  dir: string
  skillFile: string
}

/** Build a throwaway package directory whose lock drives the runtime checks. */
function createFixture(options: FixtureOptions = {}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'answer-page-fixture-'))
  fixtures.push(dir)
  const skillFile = join(dir, 'assets', 'answer-me-with-html', 'SKILL.md')
  writeFixtureFile(dir, 'assets/answer-me-with-html/SKILL.md', FIXTURE_SKILL)
  if (options.omitRendererFile !== true) {
    writeFixtureFile(
      dir,
      'assets/answer-me-with-html/scripts/am.mjs',
      options.tamperRenderer === true ? `${FIXTURE_RENDERER}// tampered\n` : FIXTURE_RENDERER,
    )
  }
  const files = [fileRecord('assets/answer-me-with-html/SKILL.md', FIXTURE_SKILL)]
  if (options.omitRendererRecord !== true) {
    files.push(fileRecord('assets/answer-me-with-html/scripts/am.mjs', FIXTURE_RENDERER))
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  const fixtureLock = {
    upstream: {
      repository: 'https://github.com/QingYunA/answer-me-with-html',
      version: '0.5.10',
      tag: 'v0.5.10',
      commit: options.commit ?? FIXTURE_COMMIT,
    },
    skill: { name: 'answer-me-with-html' },
    files,
  }
  writeFileSync(join(dir, 'answer-page.lock.json'), `${JSON.stringify(fixtureLock, null, 2)}\n`)
  return { dir, skillFile }
}

describe('answer-page plugin', () => {
  it('exports the package identity and the only injected service', async () => {
    const plugin = await loadPlugin()
    expect(plugin.name).toBe('@dsh-setup/plugin-answer-page')
    expect(plugin.inject).toEqual(['skills'])
  })

  it('lists one catalog candidate with our narrow description and bundled rank', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)

    expect(providers).toHaveLength(1)
    const provider = providers[0]
    expect(provider?.name).toBe('dsh-setup-answer-page')
    const candidates = await provider?.list()
    expect(candidates).toHaveLength(1)
    const candidate = candidates?.[0]
    expect(candidate).toMatchObject({
      name: 'answer-me-with-html',
      invocation: { modelInvocable: true, userInvocable: true },
      provider: 'dsh-setup-answer-page',
      source: 'bundled',
      rank: 600,
      resourceBase: { kind: 'directory' },
    })
    expect(candidate?.description).toContain('never for a code answer')
    expect(candidate?.description).toContain('No always-on use')
    expect(candidate?.description).not.toContain('Use it proactively and liberally')
    expect(candidate?.resourceBase?.path.replaceAll('\\', '/')).toMatch(
      /assets\/answer-me-with-html$/,
    )
    expect(String(candidate?.locator).replaceAll('\\', '/')).toMatch(
      /assets\/answer-me-with-html\/SKILL\.md$/,
    )
  })

  it('registers no system-prompt section and no always-on contribution', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers, sections } = createContext()
    plugin.apply(ctx)

    expect(sections).toHaveLength(0)
    expect(providers).toHaveLength(1)
  })

  it('loads the vendored skill body only on get, followed by the adapter note', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    const candidate = (await provider?.list())?.[0]
    expect(candidate).toBeDefined()
    if (provider === undefined || candidate === undefined) return

    expect(candidate.content).toBeUndefined()
    const definition = await provider.get(candidate, {})
    expect(definition?.name).toBe('answer-me-with-html')
    const content = definition?.content ?? ''
    expect(content.startsWith(skillAsset)).toBe(true)
    const suffix = content.slice(skillAsset.length)
    expect(suffix.startsWith('\n\n---\n\n')).toBe(true)
    expect(suffix).toContain(lock.upstream.version)
    expect(suffix).toContain(lock.upstream.repository)
    expect(suffix).toContain(lock.upstream.tag)
    expect(suffix).toContain(lock.upstream.commit)
    expect(suffix).toContain('MIT')
    expect(suffix).toContain('<workspace>/.tmp/answers/<slug>.md')
    expect(suffix).toContain('render that file path')
    expect(suffix).toContain('Never pass the draft through stdin')
    expect(suffix).toContain('<workspace>/.tmp/answers/<slug>.html')
    expect(suffix).toContain('-o <workspace>/.tmp/answers/<slug>.html')
    expect(suffix).toContain('AM_HOME=<workspace>/.tmp/answers/.am')
    expect(suffix).toContain('AM_NO_UPDATE_CHECK=1')
    expect(suffix).toContain('--no-open')
    expect(suffix).toContain('neither asked for one nor meets the diagram-shaped bar above')
    expect(suffix).not.toContain('never attach a page to an answer that did not ask for one')
    expect(suffix).toContain('requires Node.js 20 or newer')
    expect(suffix).toContain('cap the fixes at two')
    expect(suffix).toContain('no page was produced')
    expect(suffix).toContain('Never render a video unless the user asks for one')
    expect(suffix).toContain('call `present` with the absolute page path')
    expect(suffix).toContain('end the reply with a Markdown link to that same path')
  })

  it('returns undefined for a skill it does not serve', async () => {
    const plugin = await loadPlugin()
    const { ctx, providers } = createContext()
    plugin.apply(ctx)
    const provider = providers[0]
    if (provider === undefined) return
    const other = { name: 'other-skill' } as SkillCandidateShape
    expect(await provider.get(other, {})).toBeUndefined()
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

  it('rejects a tampered renderer while registering', async () => {
    const plugin = await loadPlugin()
    const fixture = createFixture({ tamperRenderer: true })
    const { ctx, providers } = createContext()
    expect(() => plugin.registerAnswerPage(ctx, fixture.dir)).toThrow(
      /does not match its provenance record/u,
    )
    expect(providers).toHaveLength(0)
  })

  it('rejects malformed pin metadata', async () => {
    const plugin = await loadPlugin()
    const fixture = createFixture({ commit: 'not-a-commit' })
    const { ctx } = createContext()
    expect(() => plugin.registerAnswerPage(ctx, fixture.dir)).toThrow(/40-hex-digit commit/u)
  })

  it('rejects a lock that does not list the renderer', async () => {
    const plugin = await loadPlugin()
    const fixture = createFixture({ omitRendererRecord: true })
    const { ctx } = createContext()
    expect(() => plugin.registerAnswerPage(ctx, fixture.dir)).toThrow(/missing the vendored file/u)
  })

  it('rejects a lock-listed file that is missing', async () => {
    const plugin = await loadPlugin()
    const fixture = createFixture({ omitRendererFile: true })
    const { ctx } = createContext()
    expect(() => plugin.registerAnswerPage(ctx, fixture.dir)).toThrow(/missing vendored file/u)
  })

  it('rejects a skill body that changed after registration', async () => {
    const plugin = await loadPlugin()
    const fixture = createFixture()
    const { ctx, providers } = createContext()
    plugin.registerAnswerPage(ctx, fixture.dir)
    const provider = providers[0]
    const candidate = (await provider?.list())?.[0]
    expect(candidate).toBeDefined()
    if (provider === undefined || candidate === undefined) return
    writeFileSync(fixture.skillFile, `${FIXTURE_SKILL}tampered\n`)
    await expect(provider.get(candidate, {})).rejects.toThrow(
      /does not match its provenance record/u,
    )
  })
})
