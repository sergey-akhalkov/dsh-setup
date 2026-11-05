/**
 * Select the checked-in `.githooks` directory as this repository's hooks path.
 *
 * A local git config is an owner action, so this is an explicit command and
 * never runs at install time. The tracked directory holds both the pre-commit
 * staged audit and the pre-push range audit; selecting the directory selects
 * both, and `core.hooksPath` is written to this repository's local config.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rootDir } from './lib/workspace.ts'

/** Tracked hooks the selection activates, in commit order. */
const HOOKS = ['pre-commit', 'pre-push'] as const

/** Set and read back `core.hooksPath` in one repository. */
export function installHooks(repoDir: string): string {
  execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
    cwd: repoDir,
    stdio: 'pipe',
  })
  return execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
    cwd: repoDir,
    encoding: 'utf8',
  }).trim()
}

/** Tracked hook files missing from this repository's `.githooks` directory. */
export function missingHooks(repoDir: string): string[] {
  return HOOKS.filter((hook) => !existsSync(join(repoDir, '.githooks', hook)))
}

function main(): number {
  const missing = missingHooks(rootDir)
  if (missing.length > 0) {
    console.error(
      `hooks: the tracked hook(s) ${missing.join(', ')} are missing from ${join(rootDir, '.githooks')}; restore them before installing`,
    )
    return 1
  }
  try {
    const hooksPath = installHooks(rootDir)
    console.log(`hooks: core.hooksPath = ${hooksPath} (repository-local config)`)
    console.log(
      'The pre-commit hook runs `pnpm reviews:check --staged`; the pre-push hook runs `pnpm reviews:check --push`. Run `pnpm reviews:check --all` manually if pnpm is unavailable.',
    )
    return 0
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error(`hooks: could not set core.hooksPath in this repository: ${detail}`)
    return 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
