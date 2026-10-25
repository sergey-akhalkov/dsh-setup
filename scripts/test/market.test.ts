import { describe, expect, it } from 'vitest'
import {
  assertImmutableCommit,
  buildMarketIndex,
  buildMarketPlugin,
  eligibleEnginesRange,
  githubPagesIndexUrl,
  isPublishablePackage,
  type MarketSource,
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
    expect(packageSourcePath('packages/plugin-a')).toBe('plugin-a')
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
      repository: { url: SOURCE.repository, directory: 'plugin-a' },
    })
    expect(entry?.versions[0]).toEqual({
      version: '0.2.0',
      publishTimestamp: SOURCE.publishTimestamp,
      source: {
        type: 'git',
        url: SOURCE.repository,
        commit: COMMIT,
        path: 'plugin-a',
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
})
