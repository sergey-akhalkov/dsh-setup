import { rcompare, validRange } from 'semver'
import type { PackageManifest } from './workspace.ts'

/** Git directory path rules from the format-1 market index specification. */
const PACKAGE_PATH_PATTERN = /^[A-Za-z0-9._@+-]+(?:\/[A-Za-z0-9._@+-]+)*$/

const COMMIT_PATTERN = /^[0-9a-f]{40}$/

/** Localized display text; the market format requires English. */
export type LocalizedText = string | { en: string; [language: string]: string }

export interface MarketVersion {
  version: string
  publishTimestamp: number
  source: { type: 'git'; url: string; commit: string; path?: string }
  engines: { dsh?: string }
}

export interface MarketPlugin {
  name: string
  title?: LocalizedText
  description?: LocalizedText
  icon?: string
  repository?: { url: string; directory?: string }
  versions: MarketVersion[]
}

export interface MarketIndex {
  format: 1
  title: LocalizedText
  description?: LocalizedText
  plugins: MarketPlugin[]
}

export interface PackageMeta {
  title?: string
  description?: string
}

export interface MarketPackage {
  manifest: PackageManifest
  relativeDir: string
  meta: PackageMeta
  icon?: string
}

export interface MarketSource {
  repository: string
  commit: string
  publishTimestamp: number
}

/** Fail when a version would not be pinned to an immutable git commit. */
export function assertImmutableCommit(commit: string): void {
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error(`market version needs a 40-hex-digit commit, got "${commit}"`)
  }
}

/** Convert a workspace package directory to the market's repository-relative path. */
export function packageSourcePath(relativeDir: string): string {
  const path = relativeDir.replaceAll('\\', '/').replace(/\/+$/u, '')
  if (!path.startsWith('packages/')) {
    throw new Error(`market source path must live under packages/, got "${relativeDir}"`)
  }
  const segments = path.split('/')
  if (
    !PACKAGE_PATH_PATTERN.test(path) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`market source path "${path}" is not a valid git directory path`)
  }
  return path
}

/** Only packages that declare a bundle are installable market plugins. */
export function isPublishablePackage(manifest: PackageManifest): boolean {
  return manifest.dsh?.bundle !== undefined
}

/**
 * Copy the declared DSH range when it is a valid range. A missing, blank, or
 * invalid range makes the version ineligible: the format requires the field and
 * DSH refuses an unavailable declaration at install time.
 */
export function eligibleEnginesRange(manifest: PackageManifest): string | undefined {
  const range = manifest.engines?.dsh
  if (typeof range !== 'string' || range.trim() === '') return undefined
  return validRange(range, { includePrerelease: true }) === null ? undefined : range
}

/** Derive the GitHub Pages index URL for a GitHub repository URL. */
export function githubPagesIndexUrl(repository: string): string {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/.exec(repository.replace(/\.git$/, ''))
  if (match === null) throw new Error(`cannot derive a Pages index URL from "${repository}"`)
  const [, owner, name] = match
  return `https://${owner}.github.io/${name}/index.json`
}

/**
 * Build one market entry from a package. Returns `undefined` when the package is
 * not a bundle or has no eligible engine range, which is the documented way to
 * omit a package from the market rather than listing an uninstallable version.
 */
export function buildMarketPlugin(
  pkg: MarketPackage,
  source: MarketSource,
): MarketPlugin | undefined {
  if (!isPublishablePackage(pkg.manifest)) return undefined
  const engines = eligibleEnginesRange(pkg.manifest)
  if (engines === undefined) return undefined
  assertImmutableCommit(source.commit)
  const path = packageSourcePath(pkg.relativeDir)

  const plugin: MarketPlugin = {
    name: pkg.manifest.name,
    versions: [
      {
        version: pkg.manifest.version,
        publishTimestamp: source.publishTimestamp,
        source: { type: 'git', url: source.repository, commit: source.commit, path },
        engines: { dsh: engines },
      },
    ],
    repository: { url: source.repository, directory: path },
  }
  if (pkg.meta.title !== undefined && pkg.meta.title.trim() !== '')
    plugin.title = { en: pkg.meta.title }
  if (pkg.meta.description !== undefined && pkg.meta.description.trim() !== '') {
    plugin.description = { en: pkg.meta.description }
  }
  if (pkg.icon !== undefined) plugin.icon = pkg.icon
  return plugin
}

/** Assemble the market document; `plugins` order is the market's default order. */
export function buildMarketIndex(
  plugins: MarketPlugin[],
  title: string,
  description?: string,
): MarketIndex {
  const index: MarketIndex = { format: 1, title: { en: title }, plugins }
  if (description !== undefined && description.trim() !== '') {
    index.description = { en: description }
  }
  return index
}

/** A listed version is installable only while its DSH range stays declared and valid. */
function hasEligibleEngines(version: MarketVersion): boolean {
  const range = version.engines?.dsh
  return typeof range === 'string' && validRange(range, { includePrerelease: true }) !== null
}

/**
 * Keep every version this index already listed for a package, then add the
 * version being released. The index is regenerated from one tagged commit, so
 * the previously published document is the only record of older releases;
 * without this merge a newer tag would silently delist every older version,
 * breaking the pinned-install contract. Versions with a missing or invalid
 * `engines.dsh` are dropped rather than published as uninstallable.
 */
export function mergeMarketVersions(
  current: MarketPlugin[],
  previous?: readonly MarketPlugin[],
): MarketPlugin[] {
  const prior = new Map((previous ?? []).map((plugin) => [plugin.name, plugin]))
  return current.map((plugin) => {
    const currentVersions = new Set(plugin.versions.map((version) => version.version))
    const kept = (prior.get(plugin.name)?.versions ?? []).filter(
      (version) => !currentVersions.has(version.version) && hasEligibleEngines(version),
    )
    if (kept.length === 0) return plugin
    return {
      ...plugin,
      versions: [...plugin.versions, ...kept].sort((left, right) =>
        rcompare(left.version, right.version),
      ),
    }
  })
}
