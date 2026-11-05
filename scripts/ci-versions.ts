import { execSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { compare, maxSatisfying, minVersion, satisfies } from 'semver'
import { readDshVersions } from './lib/workspace.ts'

/**
 * The DSH matrix: the engines-range floor, the runtime, and the newest
 * published version inside the range. DSH publishes prereleases, which default
 * semver range matching excludes.
 */
export function selectCiVersions(
  range: string,
  runtime: string,
  published: readonly string[],
): string[] {
  let floor: ReturnType<typeof minVersion>
  try {
    floor = minVersion(range)
  } catch {
    floor = null
  }
  if (floor === null) throw new Error(`invalid DSH engines range: ${range}`)
  const options = { includePrerelease: true }
  const selected = new Set<string>([floor.version])
  if (satisfies(runtime, range, options)) selected.add(runtime)
  const newest = maxSatisfying(published, range, options)
  if (newest !== null) selected.add(newest)
  return [...selected].sort((left, right) => compare(left, right))
}

/** The CI matrix and whether the published-version lookup degraded. */
export interface CiVersionResolution {
  readonly versions: string[]
  readonly degraded: boolean
}

/**
 * Resolve the matrix from one published-version lookup. A lookup failure keeps
 * the floor + runtime matrix and reports the degradation on stderr; an invalid
 * range still fails.
 */
export function resolveCiVersions(
  range: string,
  runtime: string,
  lookup: () => readonly string[],
): CiVersionResolution {
  let published: readonly string[]
  try {
    published = lookup()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(
      `ci-versions: could not read published @deepseek-ai/dsh versions (${detail}); falling back to the range floor and runtime`,
    )
    return { versions: selectCiVersions(range, runtime, []), degraded: true }
  }
  return { versions: selectCiVersions(range, runtime, published), degraded: false }
}

/** Query the registry; any failure is reported by the caller. */
function readPublishedVersions(): string[] {
  const output = execSync('npm view @deepseek-ai/dsh versions --json', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20_000,
  })
  const parsed: unknown = JSON.parse(output)
  if (Array.isArray(parsed) && parsed.every((version) => typeof version === 'string')) {
    return parsed
  }
  throw new Error('the registry response is not a JSON array of versions')
}

function main(): void {
  const versions = readDshVersions()
  const resolution = resolveCiVersions(versions.enginesDsh, versions.runtime, readPublishedVersions)
  console.log(JSON.stringify(resolution.versions))
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
