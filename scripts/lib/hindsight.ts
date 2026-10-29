import { valid } from 'semver'

/** The official Hindsight DSH package and the setup wrapper that mounts it. */
export const HINDSIGHT_PACKAGE = '@vectorize-io/hindsight-coding-agents'
export const HINDSIGHT_PLUGIN_PACKAGE = '@dsh-setup/plugin-hindsight'

/**
 * Check the three declarations of the pinned Hindsight runtime dependency.
 * The plugin manifest is the canonical pin; the root dev dependency and the
 * generated setup dependency must carry the same exact version.
 */
export function validateHindsightPin(
  pluginVersion: string | undefined,
  rootVersion: string | undefined,
  setupVersion: string | undefined,
): string[] {
  const problems: string[] = []
  const declarations: Array<[string, unknown]> = [
    ['plugin', pluginVersion],
    ['root', rootVersion],
    ['setup', setupVersion],
  ]
  for (const [label, version] of declarations) {
    if (typeof version !== 'string') problems.push(`${label} is missing ${HINDSIGHT_PACKAGE}`)
    else if (valid(version) !== version) {
      problems.push(`${label} version "${version}" is not an exact version`)
    }
  }
  const present = declarations.filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  )
  const versions = new Set(present.map(([, version]) => version))
  if (versions.size > 1) {
    const detail = present.map(([label, version]) => `${label}=${version}`).join(', ')
    problems.push(`plugin, root, and setup versions differ (${detail})`)
  }
  return problems
}
