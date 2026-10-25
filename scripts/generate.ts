import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type CompositionFragment, parseCompositionFragment } from './lib/fragments.ts'
import {
  computeGenerated,
  diffGenerated,
  displayPath,
  parseDefaults,
  SETUP_VENDOR_DIR,
  writeGenerated,
} from './lib/generate.ts'
import {
  listPluginPackages,
  type PackageManifest,
  readDshVersions,
  readJson,
  setupDir,
} from './lib/workspace.ts'

const CHECK = process.argv.includes('--check')

function setupVersion(): string {
  const manifestPath = join(setupDir, 'package.json')
  if (!existsSync(manifestPath)) return '0.1.0'
  return readJson<PackageManifest>(manifestPath).version
}

function main(): number {
  const versions = readDshVersions()
  const pluginPackages = listPluginPackages()
  if (pluginPackages.length === 0)
    throw new Error('no plugin packages found under packages/plugin-*')

  const pluginRows = pluginPackages.map((pkg) => {
    const fragmentPath = join(pkg.dir, 'cordis.fragment.yml')
    if (!existsSync(fragmentPath)) {
      throw new Error(`${pkg.relativeDir}: missing cordis.fragment.yml`)
    }
    const fragment: CompositionFragment = parseCompositionFragment(
      readFileSync(fragmentPath, 'utf8'),
      pkg.manifest.name,
    )
    return { pkg, rows: fragment.rows }
  })

  const defaults = parseDefaults(readFileSync(join(setupDir, 'defaults.yml'), 'utf8'))
  const expected = computeGenerated(pluginRows, defaults, setupVersion(), versions)

  if (CHECK) {
    const report = diffGenerated(expected, [SETUP_VENDOR_DIR])
    const drift = [...report.missing, ...report.changed, ...report.unexpected]
    if (drift.length > 0) {
      console.error('generated files are out of date; run `pnpm gen`:')
      for (const path of report.missing) console.error(`  missing:    ${displayPath(path)}`)
      for (const path of report.changed) console.error(`  changed:    ${displayPath(path)}`)
      for (const path of report.unexpected) console.error(`  unexpected: ${displayPath(path)}`)
      return 1
    }
    console.log(
      `gen:check: ${expected.size} generated files match (${pluginPackages.length} plugin(s))`,
    )
    return 0
  }

  const count = writeGenerated(expected)
  const vendored = [...expected.keys()].filter((path) => path.startsWith(SETUP_VENDOR_DIR)).length
  console.log(
    `gen: wrote ${count} files for ${pluginPackages.length} plugin(s), ${defaults.length} default(s), ${vendored} vendored file(s)`,
  )
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`generate: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
