import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { valid } from 'semver'
import { listPackages, type PackageManifest, rootDir, setupDir } from './lib/workspace.ts'

/**
 * Move every package to one release version.
 *
 * The repository releases a single coherent set: plugin packages and the setup
 * bundle share one version, and one git tag identifies the set. The setup
 * manifest is generated, so its version is written before regeneration.
 */

function setVersion(file: string, version: string): void {
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as PackageManifest
  manifest.version = version
  writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n')
}

function main(): number {
  const index = process.argv.indexOf('--version')
  const version = index === -1 ? undefined : process.argv[index + 1]
  if (version === undefined || valid(version) === null) {
    console.error('release-prepare: usage: pnpm release:prepare --version <semver>')
    return 1
  }

  setVersion(join(rootDir, 'package.json'), version)
  for (const pkg of listPackages()) {
    if (pkg.dir === setupDir) continue
    setVersion(join(pkg.dir, 'package.json'), version)
  }
  const setupManifest = join(setupDir, 'package.json')
  if (existsSync(setupManifest)) setVersion(setupManifest, version)

  execFileSync(process.execPath, [join(rootDir, 'scripts', 'generate.ts')], {
    cwd: rootDir,
    stdio: 'inherit',
  })

  console.log(`release-prepare: all packages now at ${version}`)
  console.log('next: pnpm build && pnpm validate, then commit and tag v' + version)
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`release-prepare: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
