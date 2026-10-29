/**
 * Select the checked-in `.githooks` directory as this repository's hooks path.
 *
 * A local git config is an owner action, so this is an explicit command and
 * never runs at install time.
 */

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { rootDir } from './lib/workspace.ts'

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

function main(): number {
  try {
    const hooksPath = installHooks(rootDir)
    console.log(`hooks: core.hooksPath = ${hooksPath}`)
    console.log(
      'The pre-push hook runs `pnpm reviews:check --push`; run `pnpm reviews:check --all` manually if pnpm is unavailable.',
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
