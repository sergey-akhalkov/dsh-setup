import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { parseMarketIndex } from '@deepseek-ai/dsh-plugin-market-index'
import {
  buildMarketIndex,
  buildMarketPlugin,
  eligibleEnginesRange,
  githubPagesIndexUrl,
  type MarketPackage,
  type MarketPlugin,
  type PackageMeta,
} from './lib/market.ts'
import {
  listPackages,
  type PackageManifest,
  readDshVersions,
  readJson,
  rootDir,
  setupDir,
} from './lib/workspace.ts'

/** Market title shown in the Discover tab. */
const MARKET_TITLE = 'dsh-setup'

interface LocaleMetaFile {
  meta?: { title?: string; description?: string }
}

function readMeta(packageDir: string): PackageMeta {
  const file = join(packageDir, 'locale', 'en.json')
  if (!existsSync(file)) return {}
  const locale = readJson<LocaleMetaFile>(file)
  return { title: locale.meta?.title, description: locale.meta?.description }
}

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' }).trim()
}

function slugFor(name: string): string {
  return name
    .replace(/^@/, '')
    .replaceAll('/', '-')
    .replaceAll(/[^A-Za-z0-9-]/g, '-')
    .toLowerCase()
}

function iconFor(pkg: MarketPackage, outputDir: string): string | undefined {
  const declared = pkg.manifest.icon
  if (declared === undefined) return undefined
  const source = join(rootDir, pkg.relativeDir, declared)
  if (!existsSync(source)) {
    throw new Error(`${pkg.relativeDir}: icon "${declared}" does not exist`)
  }
  const extension = extname(declared) || '.svg'
  const name = `${slugFor(pkg.manifest.name)}${extension}`
  const targetDir = join(outputDir, 'icons')
  mkdirSync(targetDir, { recursive: true })
  copyFileSync(source, join(targetDir, name))
  return `icons/${name}`
}

function parseOutputDir(): string {
  const index = process.argv.indexOf('--output')
  if (index === -1) return join(rootDir, 'market')
  const value = process.argv[index + 1]
  if (value === undefined) throw new Error('--output needs a directory')
  return resolve(rootDir, value)
}

function assertSafeOutput(outputDir: string): void {
  const allowed = [join(rootDir, 'market'), join(rootDir, '.tmp')]
  if (
    !allowed.some(
      (prefix) =>
        outputDir === prefix ||
        outputDir.startsWith(`${prefix}\\`) ||
        outputDir.startsWith(`${prefix}/`),
    )
  ) {
    throw new Error(`refusing to clean output outside market/ or .tmp/: ${outputDir}`)
  }
}

function main(): number {
  const versions = readDshVersions()
  const outputDir = parseOutputDir()
  assertSafeOutput(outputDir)

  const commitIndex = process.argv.indexOf('--commit')
  const commit =
    commitIndex === -1 ? git(['rev-parse', 'HEAD']) : (process.argv[commitIndex + 1] ?? '')
  const timestampIndex = process.argv.indexOf('--timestamp')
  const publishTimestamp =
    timestampIndex === -1
      ? Number(git(['show', '-s', '--format=%ct', 'HEAD']))
      : Number(process.argv[timestampIndex + 1] ?? '')

  const packages = listPackages()
  const setupPackage = packages.find((pkg) => pkg.dir === setupDir)
  if (setupPackage === undefined) throw new Error('packages/setup is missing; run `pnpm gen`')

  const source = { repository: versions.repository, commit, publishTimestamp }
  const setupMeta = readMeta(setupDir)
  const marketPackages: MarketPackage[] = [
    {
      manifest: readJson<PackageManifest>(join(setupDir, 'package.json')),
      relativeDir: relative(rootDir, setupDir).replaceAll('\\', '/'),
      meta: setupMeta,
    },
    ...packages
      .filter((pkg) => pkg.dir !== setupDir && pkg.manifest.dsh?.bundle !== undefined)
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name))
      .map((pkg) => ({
        manifest: pkg.manifest,
        relativeDir: pkg.relativeDir,
        meta: readMeta(pkg.dir),
      })),
  ]

  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })

  const plugins: MarketPlugin[] = []
  for (const pkg of marketPackages) {
    const icon = iconFor(pkg, outputDir)
    const withIcon: MarketPackage = icon === undefined ? pkg : { ...pkg, icon }
    const entry = buildMarketPlugin(withIcon, source)
    if (entry === undefined) {
      if (pkg.manifest.name === setupPackage.manifest.name) {
        throw new Error(
          `setup bundle is not market-eligible: ${String(eligibleEnginesRange(pkg.manifest) ?? 'no valid engines.dsh')}`,
        )
      }
      console.warn(
        `generate-market: omitting ${pkg.manifest.name} (not a bundle or no valid engines.dsh)`,
      )
      continue
    }
    plugins.push(entry)
  }

  const index = buildMarketIndex(plugins, MARKET_TITLE, setupMeta.description)
  const indexUrl = githubPagesIndexUrl(versions.repository)
  const validated = parseMarketIndex(index, indexUrl)
  writeFileSync(join(outputDir, 'index.json'), JSON.stringify(validated, null, 2) + '\n')

  // The publication artifact is exactly the index and its icons directory; the
  // Pages workflow uploads this directory as-is.
  const rootEntries = readdirSync(outputDir).sort()
  if (JSON.stringify(rootEntries) !== JSON.stringify(['icons', 'index.json'])) {
    throw new Error(`market artifact has unexpected entries: ${rootEntries.join(', ')}`)
  }
  for (const entry of readdirSync(join(outputDir, 'icons'))) {
    if (!entry.endsWith('.svg')) throw new Error(`unexpected market icon file: ${entry}`)
  }

  console.log(
    `generate-market: ${validated.plugins.length} plugin(s), commit ${commit.slice(0, 12)}, index ${indexUrl}`,
  )
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`generate-market: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
