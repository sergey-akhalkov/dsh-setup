import type { PackageManifest } from './workspace.ts'

/** Scripts that would run code during installation and are never allowed in a published package. */
const INSTALL_TIME_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare']

const CLIENT_EXPORT = './client'

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function bundlePatchValid(patch: unknown): boolean {
  if (isNonEmptyString(patch)) return true
  return Array.isArray(patch) && patch.length > 0 && patch.every(isNonEmptyString)
}

/**
 * Check one package manifest against the publishability rules of this
 * repository. Returns human-readable problems; an empty array means the
 * manifest is acceptable.
 *
 * Rules enforce the contracts the specs rely on: a DSH compatibility range, a
 * bundle patch declaration, a declared Client export when a Client half exists,
 * and no install-time build scripts (git installs must not need one).
 */
export function validatePackageManifest(
  manifest: PackageManifest,
  expectedDshRange?: string,
): string[] {
  const problems: string[] = []

  const range = manifest.engines?.dsh
  if (!isNonEmptyString(range)) {
    problems.push('missing engines.dsh range')
  } else if (expectedDshRange !== undefined && range !== expectedDshRange) {
    problems.push(`engines.dsh "${range}" does not match dsh.json "${expectedDshRange}"`)
  }

  if (manifest.dsh?.bundle?.patch === undefined) {
    problems.push('missing dsh.bundle.patch')
  } else if (!bundlePatchValid(manifest.dsh.bundle.patch)) {
    problems.push('dsh.bundle.patch must be a non-empty string or a non-empty string list')
  }

  if (manifest.dsh?.client !== undefined && manifest.exports?.[CLIENT_EXPORT] === undefined) {
    problems.push(`dsh.client is declared but exports["${CLIENT_EXPORT}"] is missing`)
  }

  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    if (INSTALL_TIME_SCRIPTS.includes(name) && isNonEmptyString(command)) {
      problems.push(`install-time script "${name}" is not allowed`)
    }
  }

  return problems
}
