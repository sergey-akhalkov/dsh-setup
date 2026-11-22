import { spawnSync } from 'node:child_process'

/**
 * Shipped optional bundles are enabled by adding their names to the profile
 * selection, and the profile resolves them from the installed DSH runtime. A
 * DSH release can drop one (0.2.2-rc.2 moved the agent team into the runtime and
 * stopped publishing `@deepseek-ai/dsh-experimental-agent-team-profile`), so the
 * installer and its validation must expect only what the resolved DSH version
 * actually ships. A bundle no version in the range provides leaves the lists.
 */

export type BundleAvailability = 'available' | 'missing'

/** Whether a failed `npm view` means "this version does not ship the package". */
export function classifyBundleLookup(detail: string): 'missing' | 'error' {
  return /\bE404\b|404 Not Found/u.test(detail) ? 'missing' : 'error'
}

/**
 * Query the registry for one `<bundle>@<dshVersion>` spec. Only a 404 is a
 * "not shipped" answer; any other failure is a real error and must stop the
 * validation instead of silently narrowing the expected list.
 */
export function probeNpmBundle(spec: string): BundleAvailability {
  const result = spawnSync(`npm view "${spec}" version`, {
    shell: true,
    encoding: 'utf8',
    timeout: 30_000,
  })
  if (result.status === 0) return 'available'
  const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  if (classifyBundleLookup(detail) === 'missing') return 'missing'
  throw new Error(
    `could not resolve the shipped bundle ${spec}: ${detail.trim().split('\n').slice(-3).join(' ')}`,
  )
}

/** Keep the shipped bundles the resolved DSH version provides. */
export function availableBundles(
  packages: readonly string[],
  version: string,
  probe: (spec: string) => BundleAvailability,
): string[] {
  return packages.filter((name) => probe(`${name}@${version}`) === 'available')
}

/**
 * The package name a profile recorded for one exact pnpm spec. A git spec names
 * a repository, not a package — the repository and package names may differ, and
 * a scoped package cannot be read off the spec at all — so the installed
 * dependency is the only authority, exactly as the installer treats it.
 */
export function dependencyNameBySpec(
  dependencies: Readonly<Record<string, string>> | undefined,
  spec: string,
): string | undefined {
  for (const [name, recorded] of Object.entries(dependencies ?? {})) {
    if (recorded === spec) return name
  }
  return undefined
}

/** Resolve each declared git spec to its recorded package name, and report the rest. */
export function gitBundleSelection(
  specs: readonly string[],
  dependencies: Readonly<Record<string, string>> | undefined,
): { names: string[]; missing: string[] } {
  const names: string[] = []
  const missing: string[] = []
  for (const spec of specs) {
    const name = dependencyNameBySpec(dependencies, spec)
    if (name === undefined) missing.push(spec)
    else names.push(name)
  }
  return { names, missing }
}
