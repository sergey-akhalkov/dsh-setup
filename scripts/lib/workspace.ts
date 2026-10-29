import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, resolved from this file's location. */
export const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * Documented cap for the workspace instruction file (`AGENTS.md`): 16,000
 * bytes, about 4,000 estimated tokens at the repository's bytes / 4 metric.
 * The file is injected on every request, so detail belongs in `docs/`.
 */
export const INSTRUCTION_FILE_BUDGET_BYTES = 16_000

/** One workspace instruction file measured against its documented budget. */
export interface InstructionBudget {
  file: string
  bytes: number
  budget: number
  /** Set only when the file exceeds the budget. */
  problem?: string
}

/**
 * Measure a workspace instruction file against the documented cap. Counts
 * UTF-8 bytes, not characters, so a non-ASCII file is held to the same size.
 */
export function checkInstructionBudget(text: string, file = 'AGENTS.md'): InstructionBudget {
  const bytes = Buffer.byteLength(text, 'utf8')
  const budget = INSTRUCTION_FILE_BUDGET_BYTES
  if (bytes <= budget) return { file, bytes, budget }
  return {
    file,
    bytes,
    budget,
    problem: `${file} is ${bytes} bytes, over the ${budget}-byte workspace instruction budget; move detail into docs/`,
  }
}

export interface ClientManifest {
  platform?: string
  immediately?: boolean
  inject?: string[]
  external?: string[]
}

export interface BundleManifest {
  patch?: string | string[]
}

export interface DshManifest {
  manifestVersion?: number
  bundle?: BundleManifest
  client?: ClientManifest
}

export interface PackageManifest {
  name: string
  version: string
  license?: string
  description?: string
  icon?: string
  type?: string
  main?: string
  types?: string
  bin?: Record<string, string>
  exports?: Record<string, unknown>
  files?: string[]
  scripts?: Record<string, string>
  engines?: Record<string, string>
  dependencies?: Record<string, string>
  bundleDependencies?: string[]
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dsh?: DshManifest
}

export interface WorkspacePackage {
  dir: string
  relativeDir: string
  manifest: PackageManifest
}

/** Bundles the one-command installer enables besides the setup bundle itself. */
export interface InstallBundles {
  /** Shipped optional bundles: enabled by adding their names to the profile selection. */
  shipped: string[]
  /** Bundles published to the registry: installed as a dependency, then selected. */
  registry: string[]
}

export interface DshVersions {
  runtime: string
  enginesDsh: string
  supportedVersions: string[]
  repository: string
  installBundles: InstallBundles
}

/** Read and parse one JSON file with a helpful error message. */
export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

/** The DSH versions this repository supports. */
export function readDshVersions(): DshVersions {
  return readJson<DshVersions>(join(rootDir, 'dsh.json'))
}

/** List workspace packages in a stable order. Missing package.json files are ignored. */
export function listPackages(): WorkspacePackage[] {
  const packagesDir = join(rootDir, 'packages')
  if (!existsSync(packagesDir)) return []
  const packages: WorkspacePackage[] = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    const manifestPath = join(dir, 'package.json')
    if (!existsSync(manifestPath)) continue
    packages.push({
      dir,
      relativeDir: `packages/${entry.name}`,
      manifest: readJson<PackageManifest>(manifestPath),
    })
  }
  return packages.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir))
}

/** Absolute path of a workspace package's package.json. */
export function packageJsonFile(pkg: WorkspacePackage): string {
  return join(pkg.dir, 'package.json')
}

/** Name of the generated setup bundle package. */
export const SETUP_PACKAGE_NAME = '@dsh-setup/setup'

/** Directory of the setup bundle package. */
export const setupDir = join(rootDir, 'packages', 'setup')

/** Plugin packages: every package except the setup bundle itself. */
export function listPluginPackages(): WorkspacePackage[] {
  return listPackages().filter(
    (pkg) => pkg.dir !== setupDir && pkg.manifest.dsh?.bundle !== undefined,
  )
}
