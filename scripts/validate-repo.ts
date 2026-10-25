import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { parseCompositionFragment } from './lib/fragments.ts'
import { parseDefaults, validateSetupManifest } from './lib/generate.ts'
import { validatePackageManifest } from './lib/manifest.ts'
import { readRepositoryFiles, scanMachinePaths, scanSecrets } from './lib/scan.ts'
import {
  listPluginPackages,
  type PackageManifest,
  readDshVersions,
  readJson,
  setupDir,
} from './lib/workspace.ts'

function checkManifests(problems: string[]): void {
  const versions = readDshVersions()
  const plugins = listPluginPackages()
  if (plugins.length === 0) problems.push('no plugin packages found under packages/plugin-*')

  for (const pkg of plugins) {
    for (const problem of validatePackageManifest(pkg.manifest, versions.enginesDsh)) {
      problems.push(`${pkg.relativeDir}: ${problem}`)
    }
  }

  const setupManifestPath = join(setupDir, 'package.json')
  if (!existsSync(setupManifestPath)) {
    problems.push('packages/setup/package.json is missing; run `pnpm gen`')
    return
  }
  const setupManifest = readJson<PackageManifest>(setupManifestPath)
  for (const problem of validateSetupManifest(
    setupManifest,
    plugins.map((pkg) => pkg.manifest),
  )) {
    problems.push(`packages/setup/package.json: ${problem}`)
  }
}

function checkComposition(problems: string[]): void {
  const plugins = listPluginPackages()
  const rowIds = new Set<string>()

  for (const pkg of plugins) {
    const fragmentPath = join(pkg.dir, 'cordis.fragment.yml')
    if (!existsSync(fragmentPath)) {
      problems.push(`${pkg.relativeDir}: missing cordis.fragment.yml`)
      continue
    }
    try {
      const fragment = parseCompositionFragment(
        readFileSync(fragmentPath, 'utf8'),
        pkg.manifest.name,
      )
      for (const row of fragment.rows) {
        if (rowIds.has(row.id)) problems.push(`duplicate row id "${row.id}"`)
        rowIds.add(row.id)
      }
    } catch (error) {
      problems.push(`${pkg.relativeDir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const defaultsPath = join(setupDir, 'defaults.yml')
  try {
    const defaults = parseDefaults(readFileSync(defaultsPath, 'utf8'))
    for (const entry of defaults) {
      if (rowIds.has(entry.id)) {
        problems.push(`defaults.yml: "${entry.id}" collides with a plugin row id`)
      }
    }
  } catch (error) {
    problems.push(`defaults.yml: ${error instanceof Error ? error.message : String(error)}`)
  }

  const patchPath = join(setupDir, 'cordis.patch.yml')
  if (!existsSync(patchPath)) {
    problems.push('packages/setup/cordis.patch.yml is missing; run `pnpm gen`')
  } else {
    try {
      const document = parse(readFileSync(patchPath, 'utf8'))
      if (!Array.isArray(document) || document.length === 0) {
        problems.push('packages/setup/cordis.patch.yml must be a non-empty patch list')
      }
    } catch (error) {
      problems.push(
        `packages/setup/cordis.patch.yml: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

function main(): number {
  const problems: string[] = []
  checkManifests(problems)
  checkComposition(problems)

  const files = readRepositoryFiles()
  for (const problem of scanMachinePaths(files)) {
    problems.push(`${problem.path}: ${problem.message}`)
  }
  for (const problem of scanSecrets(files)) {
    problems.push(`${problem.path}: ${problem.message}`)
  }

  if (problems.length > 0) {
    console.error(`validate-repo: ${problems.length} problem(s)`)
    for (const problem of problems) console.error(`  ${problem}`)
    return 1
  }
  console.log(
    `validate-repo: ${files.length} file(s) scanned, ${listPluginPackages().length} plugin package(s), no problems`,
  )
  return 0
}

process.exitCode = main()
