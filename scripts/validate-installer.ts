import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { readDshVersions, readJson, rootDir } from './lib/workspace.ts'

/**
 * Exercise `install.ps1` against a throwaway Harness home.
 *
 * The Desktop profile is owned by the Electron shell and is never touched here:
 * a fresh `web`-template profile named `ci` receives the same installer run a
 * new machine would, and the composed tree proves every documented bundle and
 * the setup rows mount. A second run must change nothing and leave the profile
 * patch byte-identical.
 *
 * DSH_CLI overrides the CLI command line exactly as written (a value with
 * arguments is wrapped in a temporary .cmd so the installer can execute it).
 * DSH_KEEP=1 keeps the temporary Harness home for inspection.
 */

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

function shell(command: string, args: string[], env: NodeJS.ProcessEnv, timeout = 600_000) {
  // A shell resolves the Windows .cmd shims (pnpm, pwsh), matching how the
  // composition check runs the CLI.
  const line = [command, ...args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`)].join(' ')
  const result = spawnSync(line, { shell: true, cwd: rootDir, env, encoding: 'utf8', timeout })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    command: line,
  }
}

function fail(result: { status: number | null; stdout: string; stderr: string; command?: string }) {
  const tail = `${result.stdout}\n${result.stderr}`.trim().split('\n').slice(-8).join('\n')
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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_HOME: home,
    DSH_TELEMETRY_DISABLED: '1',
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

  let cli: string | undefined
  const cliOverride = process.env.DSH_CLI
  if (cliOverride !== undefined && cliOverride.trim() !== '') {
    const wrapper = join(home, 'dsh-cli.cmd')
    writeFileSync(wrapper, `@echo off\r\n${cliOverride} %*\r\n`)
    cli = wrapper
  }

  const profileDir = join(home, 'profiles', 'ci')
  const manifestPath = join(profileDir, 'package.json')
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const failures: string[] = []

  const step = (name: string, body: () => void): void => {
    try {
      body()
      console.log(`  ok   ${name}`)
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`  FAIL ${name}`)
    }
  }

  try {
    // Compose a fresh profile with the published CLI exactly like a new machine.
    const cliResult = shell(
      'pnpm',
      [
        'dlx',
        `@deepseek-ai/dsh@${dshVersion}`,
        '--profile',
        'ci',
        '--from-default-profile',
        'web',
        '--dump-config',
      ],
      env,
      600_000,
    )
    step('initialize a throwaway ci profile', () => {
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
    ]
    if (cli !== undefined) installerArgs.push('-DshCli', cli)

    const first = shell(pwsh, installerArgs, env)
    step('run install.ps1', () => {
      if (first.status !== 0) throw fail(first)
    })

    stageManifestChecks(manifestPath, versions, failures)
    step('the installer leaves the profile patch untouched', () => {
      if (hashFile(patchPath) !== patchBefore) throw new Error('cordis.patch.yml changed')
    })

    // Compose the installed profile directly: every shipped bundle header and the
    // setup row/defaults must appear in the dumped tree.
    const composed = shell(
      'pnpm',
      ['dlx', `@deepseek-ai/dsh@${dshVersion}`, '--profile', 'ci', '--dump-config'],
      env,
      600_000,
    )
    step('the composed profile contains every installer bundle and the setup rows', () => {
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
    const second = shell(pwsh, installerArgs, env)
    step('a second installer run is a no-op', () => {
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
    if (process.env.DSH_KEEP === '1') {
      console.log(`validate-installer: kept ${relative(rootDir, home)}`)
    } else {
      rmSync(home, { recursive: true, force: true })
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
