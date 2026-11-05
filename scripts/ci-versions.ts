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
  const floor = minVersion(range)
  if (floor === null) throw new Error(`invalid DSH engines range: ${range}`)
  const options = { includePrerelease: true }
  const selected = new Set<string>([floor.version])
  if (satisfies(runtime, range, options)) selected.add(runtime)
  const newest = maxSatisfying(published, range, options)
  if (newest !== null) selected.add(newest)
  return [...selected].sort((left, right) => compare(left, right))
}

/** Query the registry; an unreachable registry keeps the floor + runtime matrix. */
function readPublishedVersions(): string[] {
  try {
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
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(
      `ci-versions: could not read published @deepseek-ai/dsh versions (${detail}); falling back to the range floor and runtime`,
    )
    return []
  }
}

function main(): void {
  const versions = readDshVersions()
  console.log(
    JSON.stringify(
      selectCiVersions(versions.enginesDsh, versions.runtime, readPublishedVersions()),
    ),
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
