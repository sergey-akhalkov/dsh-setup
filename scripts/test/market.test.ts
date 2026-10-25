import { marketInstallTarget, parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import { describe, expect, it } from 'vitest'
import {
  assertImmutableCommit,
  buildMarketIndex,
  buildMarketPlugin,
  eligibleEnginesRange,
  githubPagesIndexUrl,
  isPublishablePackage,
  type MarketPlugin,
  type MarketSource,
  mergeMarketVersions,
  packageSourcePath,
} from '../lib/market.ts'
import type { PackageManifest } from '../lib/workspace.ts'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const SOURCE: MarketSource = {
  repository: 'https://github.com/example/dsh-setup',
  commit: COMMIT,
  publishTimestamp: 1_790_476_800,
}

function plugin(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: '@dsh-setup/plugin-a',
    version: '0.2.0',
    engines: { dsh: '>=0.2.1-rc.3 <0.3.0' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    ...overrides,
  }
}

const META = { title: 'Plugin A', description: 'Does A' }

describe('market eligibility', () => {
  it('rejects a package without a bundle declaration', () => {
    expect(isPublishablePackage({ name: 'x', version: '1.0.0' })).toBe(false)
  })

  it('rejects missing, blank, and invalid engine ranges', () => {
    expect(eligibleEnginesRange(plugin({ engines: {} }))).toBeUndefined()
    expect(eligibleEnginesRange(plugin({ engines: { dsh: '  ' } }))).toBeUndefined()
    expect(eligibleEnginesRange(plugin({ engines: { dsh: 'not a range' } }))).toBeUndefined()
  })

  it('accepts a valid pinned range and the wildcard', () => {
    expect(eligibleEnginesRange(plugin())).toBe('>=0.2.1-rc.3 <0.3.0')
    expect(eligibleEnginesRange(plugin({ engines: { dsh: '*' } }))).toBe('*')
  })
})

describe('immutable source', () => {
  it('accepts a full commit and rejects a branch-like or short value', () => {
    expect(() => assertImmutableCommit(COMMIT)).not.toThrow()
    expect(() => assertImmutableCommit('main')).toThrow(/40-hex-digit/)
    expect(() => assertImmutableCommit('0123456')).toThrow(/40-hex-digit/)
  })

  it('maps a workspace directory to the repository-relative package path', () => {
    expect(packageSourcePath('packages/plugin-a')).toBe('packages/plugin-a')
    expect(packageSourcePath('packages/nested/plugin-a')).toBe('packages/nested/plugin-a')
    expect(() => packageSourcePath('plugin-a')).toThrow(/under packages/)
    expect(() => packageSourcePath('packages/../escape')).toThrow(/valid git directory path/)
  })

  it('derives the Pages index URL from a GitHub repository', () => {
    expect(githubPagesIndexUrl('https://github.com/example/dsh-setup')).toBe(
      'https://example.github.io/dsh-setup/index.json',
    )
    expect(() => githubPagesIndexUrl('https://gitlab.com/example/dsh-setup')).toThrow(/Pages/)
  })
})

describe('buildMarketPlugin', () => {
  it('builds a commit-pinned entry with copied engine range', () => {
    const entry = buildMarketPlugin(
      {
        manifest: plugin(),
        relativeDir: 'packages/plugin-a',
        meta: META,
        icon: 'icons/plugin-a.svg',
      },
      SOURCE,
    )
    expect(entry).toMatchObject({
      name: '@dsh-setup/plugin-a',
      title: { en: 'Plugin A' },
      description: { en: 'Does A' },
      icon: 'icons/plugin-a.svg',
      repository: { url: SOURCE.repository, directory: 'packages/plugin-a' },
    })
    expect(entry?.versions[0]).toEqual({
      version: '0.2.0',
      publishTimestamp: SOURCE.publishTimestamp,
      source: {
        type: 'git',
        url: SOURCE.repository,
        commit: COMMIT,
        path: 'packages/plugin-a',
      },
      engines: { dsh: '>=0.2.1-rc.3 <0.3.0' },
    })
  })

  it('omits a package whose version has no valid engine range', () => {
    expect(
      buildMarketPlugin(
        { manifest: plugin({ engines: {} }), relativeDir: 'packages/plugin-a', meta: META },
        SOURCE,
      ),
    ).toBeUndefined()
  })

  it('fails instead of listing a mutable source', () => {
    expect(() =>
      buildMarketPlugin(
        { manifest: plugin(), relativeDir: 'packages/plugin-a', meta: META },
        { ...SOURCE, commit: 'main' },
      ),
    ).toThrow(/40-hex-digit/)
  })
})

describe('buildMarketIndex', () => {
  it('assembles a format-1 document with an English title', () => {
    const index = buildMarketIndex([], 'dsh-setup', 'Portable setup')
    expect(index).toEqual({
      format: 1,
      title: { en: 'dsh-setup' },
      description: { en: 'Portable setup' },
      plugins: [],
    })
  })

  it('keeps a relative icon and validates it against the index URL', () => {
    const entry = buildMarketPlugin(
      {
        manifest: plugin(),
        relativeDir: 'packages/plugin-a',
        meta: META,
        icon: 'icons/plugin-a.svg',
      },
      SOURCE,
    )
    const index = buildMarketIndex([entry as MarketPlugin], 'dsh-setup')
    const parsed = parseMarketIndex(index, 'https://example.github.io/dsh-setup/index.json')
    expect(parsed.plugins[0]?.icon).toBe('https://example.github.io/dsh-setup/icons/plugin-a.svg')
    expect(index.plugins[0]?.icon).toBe('icons/plugin-a.svg')
  })

  it('maps each version to a commit-pinned git install spec', () => {
    const entry = buildMarketPlugin(
      { manifest: plugin(), relativeDir: 'packages/plugin-a', meta: META },
      SOURCE,
    )
    const version = entry?.versions[0]
    expect(version).toBeDefined()
    if (entry === undefined || version === undefined) throw new Error('entry missing')
    expect(marketInstallTarget(entry.name, version).spec).toBe(
      `git+${SOURCE.repository}.git#${COMMIT}&path:/packages/plugin-a`,
    )
  })
})

describe('mergeMarketVersions', () => {
  function entry(version: string, manifest: Partial<PackageManifest> = {}): MarketPlugin {
    const pluginEntry = buildMarketPlugin(
      { manifest: plugin({ version, ...manifest }), relativeDir: 'packages/plugin-a', meta: META },
      SOURCE,
    )
    if (pluginEntry === undefined) throw new Error(`failed to build ${version}`)
    return pluginEntry
  }

  it('keeps previously listed versions, newest first', () => {
    const merged = mergeMarketVersions([entry('0.2.0')], [entry('0.1.0')])
    expect(merged[0]?.versions.map((version) => version.version)).toEqual(['0.2.0', '0.1.0'])
  })

  it('replaces a re-listed version instead of duplicating it', () => {
    const merged = mergeMarketVersions([entry('0.2.0')], [entry('0.2.0'), entry('0.1.0')])
    expect(merged[0]?.versions.map((version) => version.version)).toEqual(['0.2.0', '0.1.0'])
  })

  it('drops a previous version whose engine range is not installable', () => {
    const valid = entry('0.1.0')
    const source = valid.versions[0]
    if (source === undefined) throw new Error('version missing')
    const broken: MarketPlugin = { ...valid, versions: [{ ...source, engines: {} }] }
    const merged = mergeMarketVersions([entry('0.2.0')], [broken])
    expect(merged[0]?.versions.map((version) => version.version)).toEqual(['0.2.0'])
  })

  it('drops packages the release no longer publishes', () => {
    const merged = mergeMarketVersions([], [entry('0.1.0')])
    expect(merged).toEqual([])
  })
})
