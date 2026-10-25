import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { readDshVersions, readJson, rootDir, setupDir } from './lib/workspace.ts'

/**
 * Exercise `install.ps1` against a throwaway Harness home.
 *
 * The Desktop profile is owned by the Electron shell and is never touched here:
 * a fresh `web`-template profile named `ci` receives the same installer run a
 * new machine would, and the composed tree proves every documented bundle and
 * the setup rows mount. A second run must change nothing and leave the profile
 * patch byte-identical.
 *
 * The setup package is installed from a copy outside the repository workspace:
 * the throwaway home lives below `rootDir`, so a checkout path there would make
 * pnpm resolve the profile against the repository's workspace instead of
 * treating it as the standalone directory a user installs.
 *
 * DSH_CLI overrides the CLI command line exactly as written (a value with
 * arguments is wrapped in a temporary .cmd so the installer can execute it).
 * DSH_KEEP=1 keeps the temporary Harness home for inspection.
 */

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

function shell(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 720_000) {
  // A shell resolves the Windows .cmd shims (pnpm, pwsh), matching how the
  // composition check runs the CLI. The child's stdin is the null device: a
  // CI runner has no interactive terminal, so a package-manager or plugin
  // prompt must fail fast there instead of waiting on an open pipe.
  const line = [command, ...args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`)].join(' ')
  const result = spawnSync(line, {
    shell: true,
    cwd: rootDir,
    env,
    encoding: 'utf8',
    timeout,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    command: line,
  }
}

function fail(result: { status: number | null; stdout: string; stderr: string; command?: string }) {
  const tail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-120).join('\n')
  return new Error(`${result.command ?? ''} exited ${String(result.status)}\n${tail}`.trim())
}

function hashFile(path: string): string | undefined {
  return existsSync(path)
    ? createHash('sha256').update(readFileSync(path)).digest('hex')
    : undefined
}

function main(): number {
  if (process.platform !== 'win32') {
    console.log('validate-installer: install.ps1 targets Windows; skipped on this platform')
    return 0
  }
  const pwsh = process.env.PWSH ?? 'pwsh'
  const versions = readDshVersions()
  const dshVersion = process.env.DSH_VERSION ?? versions.runtime
  const tmpRoot = join(rootDir, '.tmp')
  mkdirSync(tmpRoot, { recursive: true })
  const home = mkdtempSync(join(tmpRoot, 'installer-home-'))
  // Outside the repository workspace: pnpm must treat the profile as a
  // standalone directory, not as a member of this checkout's workspace.
  const setupSource = mkdtempSync(join(tmpdir(), 'dsh-setup-package-'))
  cpSync(setupDir, join(setupSource, 'setup'), { recursive: true })
  const setupSpec = join(setupSource, 'setup')
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
    // The package-manager child inherits this. CI stalls silently at one
    // install step, so its debug transcript is the only way to see the wait.
    npm_config_loglevel: 'debug',
  }
  for (const key of [
    'DSH_PROFILE',
    'DSH_PROFILE_DIR',
    'DSH_SESSION_ID',
    'DSH_SHELL',
    'DSH_WEB_URL',
  ]) {
    delete env[key]
  }
  // The action-installed pnpm points PNPM_HOME into its own bin directory;
  // plain project operations must not inherit that arrangement.
  delete env.PNPM_HOME

  const cliOverride = process.env.DSH_CLI?.trim()
  const cliBase =
    cliOverride === undefined || cliOverride === ''
      ? `pnpm dlx @deepseek-ai/dsh@${dshVersion}`
      : cliOverride
  let cli: string | undefined
  if (cliOverride !== undefined && cliOverride !== '') {
    const wrapper = join(home, 'dsh-cli.cmd')
    writeFileSync(wrapper, `@echo off\r\n${cliOverride} %*\r\n`)
    cli = wrapper
  }
  console.log(`validate-installer: DSH ${dshVersion}, CLI ${cliBase}`)

  const profileDir = join(home, 'profiles', 'ci')
  const manifestPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const failures: string[] = []

  const step = (name: string, body: () => void): void => {
    const startedAt = Date.now()
    try {
      body()
      console.log(`  ok   ${name} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`  FAIL ${name} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)
    }
  }

  try {
    // Compose a fresh profile with the published CLI exactly like a new machine.
    step('initialize a throwaway ci profile', () => {
      const cliResult = shell(
        cliBase,
        ['--profile', 'ci', '--from-default-profile', 'web', '--dump-config'],
        env,
        600_000,
      )
      if (cliResult.status !== 0) throw fail(cliResult)
      if (!existsSync(manifestPath)) throw new Error('profile package.json was not created')
    })
    if (failures.length > 0) throw new Error(failures.join('; '))

    const patchBefore = hashFile(patchPath)
    const installerArgs = [
      '-NoProfile',
      '-File',
      join(rootDir, 'install.ps1'),
      '-Profile',
      'ci',
      '-DshHome',
      home,
      '-NoStopApp',
      '-NoRestart',
      '-SetupSpec',
      setupSpec,
    ]
    if (cli !== undefined) installerArgs.push('-DshCli', cli)

    let first: ReturnType<typeof shell> | undefined
    step('run install.ps1', () => {
      first = shell(pwsh, installerArgs, env, 240_000)
      if (first.status !== 0) throw fail(first)
    })
    if (first?.status === null) {
      // A timed-out installer leaves its process tree behind; the command lines
      // show which operation is stuck, which the captured output cannot.
      const snapshot = shell(
        pwsh,
        [
          '-NoProfile',
          '-Command',
          "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'dsh|pnpm' } | Select-Object ProcessId,ParentProcessId,Name,CommandLine | Format-List",
        ],
        env,
        60_000,
      )
      console.error('validate-installer: processes alive after the installer timed out:')
      console.error(snapshot.stdout.trim() || '(none)')
      const managerDir = join(profileDir, '.plugin-manager')
      try {
        const lockPath = join(profileDir, 'package.json.lock')
        if (existsSync(lockPath)) {
          console.error(
            `validate-installer: lock file holds ${readFileSync(lockPath, 'utf8').trim()}`,
          )
        }
        const runPath = join(managerDir, 'run.json')
        if (existsSync(runPath)) {
          console.error(`validate-installer: run record: ${readFileSync(runPath, 'utf8').trim()}`)
        }
        const logsDir = join(managerDir, 'logs')
        if (existsSync(logsDir)) {
          for (const operation of readdirSync(logsDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .slice(-2)) {
            const logPath = join(logsDir, operation.name, 'pnpm.log')
            if (!existsSync(logPath)) continue
            const tail = readFileSync(logPath, 'utf8').trim().split('\n').slice(-30).join('\n')
            console.error(`validate-installer: ${operation.name}/pnpm.log tail:\n${tail}`)
          }
        }
      } catch (error) {
        console.error(
          `validate-installer: could not read the profile diagnostics: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    stageManifestChecks(manifestPath, versions, failures)
    step('the installer leaves the profile patch untouched', () => {
      if (hashFile(patchPath) !== patchBefore) throw new Error('cordis.patch.yml changed')
    })

    // Compose the installed profile directly: every shipped bundle header and the
    // setup row/defaults must appear in the dumped tree.
    step('the composed profile contains every installer bundle and the setup rows', () => {
      const composed = shell(cliBase, ['--profile', 'ci', '--dump-config'], env, 600_000)
      if (composed.status !== 0) throw fail(composed)
      const markers = [
        ...versions.installBundles.shipped,
        ...versions.installBundles.registry,
        'dsh-setup-composer-clock',
        'reasoningEffort: high',
        'preference: dark',
        'selectedDefault: cordis',
      ]
      for (const marker of markers) {
        if (!composed.stdout.includes(marker)) throw new Error(`composed dump lacks "${marker}"`)
      }
    })

    const bundlesBefore = readBundles(manifestPath)
    step('a second installer run is a no-op', () => {
      const second = shell(pwsh, installerArgs, env)
      if (second.status !== 0) throw fail(second)
      const bundlesAfter = readBundles(manifestPath)
      if (JSON.stringify(bundlesAfter) !== JSON.stringify(bundlesBefore)) {
        throw new Error('the bundle selection changed on the second run')
      }
      if (hashFile(patchPath) !== patchBefore) throw new Error('cordis.patch.yml changed')
    })
  } catch (error) {
    console.error(`validate-installer: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    try {
      if (process.env.DSH_KEEP === '1') {
        console.log(`validate-installer: kept ${relative(rootDir, home)}`)
      } else {
        rmSync(home, { recursive: true, force: true })
      }
    } catch (error) {
      // A leftover process from a timed-out installer run can still hold the
      // throwaway home; the run's verdict must not be replaced by that EPERM.
      console.warn(
        `validate-installer: could not remove ${relative(rootDir, home)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    try {
      rmSync(setupSource, { recursive: true, force: true })
    } catch (error) {
      console.warn(
        `validate-installer: could not remove ${setupSource}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (failures.length > 0) {
    console.error(`validate-installer: ${failures.length} failing check(s)`)
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }
  console.log(`validate-installer: install.ps1 enables the setup on DSH ${dshVersion}`)
  return 0
}

function readBundles(path: string): string[] {
  return readJson<ProfileManifest>(path).dsh?.profile?.bundles ?? []
}

function stageManifestChecks(
  manifestPath: string,
  versions: ReturnType<typeof readDshVersions>,
  problems: string[],
): void {
  const check = (name: string, body: () => void): void => {
    try {
      body()
      console.log(`  ok   ${name}`)
    } catch (error) {
      problems.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`  FAIL ${name}`)
    }
  }
  check('the profile selects every documented bundle and the setup bundle last', () => {
    const manifest = readJson<ProfileManifest>(manifestPath)
    const bundles = manifest.dsh?.profile?.bundles ?? []
    const expected = [
      ...versions.installBundles.shipped,
      ...versions.installBundles.registry,
      '@dsh-setup/setup',
    ]
    for (const name of expected) {
      if (!bundles.includes(name)) throw new Error(`"${name}" is not selected`)
    }
    const last = bundles[bundles.length - 1]
    if (last !== '@dsh-setup/setup')
      throw new Error(`the setup bundle is not last: ${String(last)}`)
  })
  check('the setup bundle is an exact profile dependency', () => {
    const manifest = readJson<ProfileManifest>(manifestPath)
    if (manifest.dependencies?.['@dsh-setup/setup'] === undefined) {
      throw new Error('@dsh-setup/setup is missing from dependencies')
    }
  })
}

process.exitCode = main()
