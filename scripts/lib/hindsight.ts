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

/** Export settings that belong to the machine-local file, never to tracked config. */
export const MACHINE_LOCAL_EXPORT_KEYS = ['dir', 'remote'] as const

/**
 * Reject a tracked export directory or remote. A row's `export` block is
 * repository configuration; the target directory and its private remote are
 * machine-local inputs (`~/.dsh/hindsight-export.json`) and never tracked.
 */
export function validateExportConfig(config: unknown, origin: string): string[] {
  if (typeof config !== 'object' || config === null) return []
  const block = (config as Record<string, unknown>).export
  if (typeof block !== 'object' || block === null) return []
  const exportBlock = block as Record<string, unknown>
  return MACHINE_LOCAL_EXPORT_KEYS.filter((key) => key in exportBlock).map(
    (key) => `${origin}: export.${key} is machine-local and must not be tracked`,
  )
}
