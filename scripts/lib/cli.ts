import { chmodSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One resolved Harness invoke.
 *
 * `commandLine` is what the operator sees; `executable` is what a shell
 * invokes. A command line that carries its own arguments needs a generated
 * shim, because the launcher forwards every argument after its own flags
 * verbatim to the booted app.
 */
export interface CliResolution {
  commandLine: string
  executable: string
  source: 'override' | 'installed' | 'dlx'
}

/** Inputs the resolution reads, injected so tests need no real installation. */
export interface CliLookup {
  env?: NodeJS.ProcessEnv
  /** Directory that receives the generated shim when the command line has arguments. */
  home: string
  exists?: (file: string) => boolean
  writeFile?: (file: string, content: string) => void
  chmod?: (file: string) => void
}

/** The installed Desktop CLI path under a Windows `%LOCALAPPDATA%`. */
export function installedCliPath(localAppData: string): string {
  return join(
    localAppData,
    'Programs',
    'DeepSeek Harness',
    'resources',
    'runtime',
    'cli',
    'bin',
    process.platform === 'win32' ? 'dsh.cmd' : 'dsh',
  )
}

/** The shim a command line with arguments is wrapped into. */
export function cliShimPath(home: string): string {
  return join(home, process.platform === 'win32' ? 'dsh-cli.cmd' : 'dsh-cli.sh')
}

/** Shim text that forwards every argument to the wrapped command line. */
export function cliShimContent(commandLine: string): string {
  return process.platform === 'win32'
    ? `@echo off\r\n${commandLine} %*\r\n`
    : `#!/bin/sh\nexec ${commandLine} "$@"\n`
}

function wrap(
  home: string,
  commandLine: string,
  writeFile: (file: string, content: string) => void,
  chmod: (file: string) => void,
): string {
  const shim = cliShimPath(home)
  writeFile(shim, cliShimContent(commandLine))
  // A POSIX shim is spawned as a file, so it needs its executable bit; a
  // Windows .cmd is invoked through the shell and has no permission bits.
  if (process.platform !== 'win32') chmod(shim)
  return shim
}

/**
 * Resolve the Harness CLI in the documented order: a non-empty `DSH_CLI` (an
 * existing executable, or a command line wrapped into a shim), the installed
 * Desktop CLI when present, then the repository's runtime through pnpm. An
 * empty or whitespace value counts as unset.
 */
export function resolveDshCli(runtimeVersion: string, lookup: CliLookup): CliResolution {
  const env = lookup.env ?? process.env
  const exists = lookup.exists ?? existsSync
  const writeFile =
    lookup.writeFile ?? ((file: string, content: string) => writeFileSync(file, content, 'utf8'))
  const chmod = lookup.chmod ?? ((file: string) => chmodSync(file, 0o755))

  const override = env.DSH_CLI?.trim()
  if (override !== undefined && override !== '') {
    return exists(override)
      ? { commandLine: override, executable: override, source: 'override' }
      : {
          commandLine: override,
          executable: wrap(lookup.home, override, writeFile, chmod),
          source: 'override',
        }
  }

  const localAppData = env.LOCALAPPDATA
  if (localAppData !== undefined && localAppData !== '') {
    const installed = installedCliPath(localAppData)
    if (exists(installed)) {
      return { commandLine: installed, executable: installed, source: 'installed' }
    }
  }

  const commandLine = `pnpm dlx @deepseek-ai/dsh@${runtimeVersion}`
  return {
    commandLine,
    executable: wrap(lookup.home, commandLine, writeFile, chmod),
    source: 'dlx',
  }
}

/** Quote one path or argument for the shell that runs the command line. */
export function quoteShellArgument(value: string): string {
  return process.platform === 'win32'
    ? `"${value.replaceAll('"', '""')}"`
    : `'${value.replaceAll("'", "'\\''")}'`
}

/** The full line to spawn for one Harness invocation. */
export function cliSpawnLine(resolution: CliResolution, args: readonly string[]): string {
  return [resolution.executable, ...args].map(quoteShellArgument).join(' ')
}

/** One attempted run of the resolved command, as a shell reports it. */
export interface CliRunOutcome {
  status: number | null
  stdout?: string
  stderr?: string
}

/** The outcome of probing the resolved CLI before the profile is touched. */
export type CliCheck = { ok: true; version: string } | { ok: false; message: string }

/**
 * Probe the resolved command with `--version` before anything else runs, so an
 * unusable CLI fails with both remedies and the operator learns which Harness
 * the loop runs.
 */
export function checkCli(
  resolution: CliResolution,
  run: (line: string) => CliRunOutcome,
): CliCheck {
  const outcome = run(cliSpawnLine(resolution, ['--version']))
  if (outcome.status === 0) {
    const version = (outcome.stdout ?? '').split('\n').find((line) => line.trim() !== '') ?? ''
    return { ok: true, version: version.trim() }
  }
  const detail =
    (outcome.stderr ?? '').trim() ||
    (outcome.stdout ?? '').trim() ||
    `exit ${String(outcome.status)}`
  return { ok: false, message: cliFailureMessage(resolution, detail) }
}

/**
 * The failure text for a resolved command that cannot run. It names both
 * remedies so the operator can fix the environment without guessing.
 */
export function cliFailureMessage(resolution: CliResolution, detail: string): string {
  return [
    `the Harness CLI could not be started (${resolution.commandLine}): ${detail.trim()}`,
    'Set DSH_CLI to a working Harness command line, or install DeepSeek Harness so its command line is available.',
  ].join('\n')
}
