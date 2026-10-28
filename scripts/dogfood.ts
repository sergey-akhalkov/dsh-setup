import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parse } from 'yaml'
import {
  checkBundleSelection,
  checkOwnerRowsPreserved,
  checkSetupDefaults,
  checkSetupRows,
  DOGFOOD_PROFILE,
  type DogfoodProfileManifest,
  PROFILE_COPY_FILES,
  patchExplicitDisabled,
  patchRowIds,
  readBundles,
  SETUP_BUNDLE,
} from './lib/dogfood.ts'
import { parseDefaults } from './lib/generate.ts'
import {
  type PackageManifest,
  readDshVersions,
  readJson,
  rootDir,
  setupDir,
} from './lib/workspace.ts'

/**
 * Dogfood `install.ps1` on this machine without disturbing the running Harness.
 *
 * Installing into the live `desktop` profile closes and restarts DeepSeek
 * Harness: a shell hosted by that app (an agent turn, an in-app terminal) would
 * lose the session it runs in. This command therefore copies the owner's
 * profile into a throwaway Harness home, runs the committed installer there
 * with `-NoStopApp -NoRestart`, and proves from the composed `--dump-config`
 * output that the setup rows mount, the setup defaults apply, and every row the
 * owner patched keeps its effective config. The live profile is only read: its
 * files are snapshotted under `.tmp/`, hashed before and after, and never
 * written. The app is never stopped and no process outside the throwaway home
 * is started.
 *
 * The throwaway profile is named `owner-copy`, not `desktop`, so the installer
 * cannot take its desktop-only stop/restart path even by mistake.
 *
 * DSH_HOME / DSH_PROFILE select the owner profile to copy (defaults: the
 * running home and `desktop`). DSH_CLI overrides the CLI command line; DSH_KEEP=1
 * keeps the throwaway home for inspection. The live snapshot is always kept.
 */

interface InstalledProfileManifest extends DogfoodProfileManifest {
  dependencies?: Record<string, string>
}

const DUMP_TIMEOUT_MS = 600_000
const INSTALLER_TIMEOUT_MS = 900_000
const SNAPSHOT_PREFIX = 'dogfood-snapshot-'

function quote(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

function tail(text: string, lines = 120): string {
  return text.trim().split('\n').slice(-lines).join('\n')
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
  commandLine: string
}

function shellCommand(commandLine: string, env: NodeJS.ProcessEnv, timeout: number): CommandResult {
  const result = spawnSync(commandLine, {
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
    commandLine,
  }
}

function runPwsh(
  pwsh: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout: number,
): CommandResult {
  const result = spawnSync(pwsh, args, {
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
    commandLine: `${pwsh} ${args.map(quote).join(' ')}`,
  }
}

function requireOk(result: CommandResult, label: string): void {
  if (result.status === 0) return
  throw new Error(
    `${label} exited ${String(result.status)}\n${tail(result.stdout)}\n${tail(result.stderr)}`,
  )
}

function hashFile(path: string): string | undefined {
  return existsSync(path)
    ? createHash('sha256').update(readFileSync(path)).digest('hex')
    : undefined
}

function resolveDshCli(home: string, runtimeVersion: string): string {
  const override = process.env.DSH_CLI?.trim()
  if (override !== undefined && override !== '') {
    if (existsSync(override)) return override
    return wrapCli(home, override)
  }
  const localAppData = process.env.LOCALAPPDATA
  if (localAppData !== undefined && localAppData !== '') {
    const installed = join(
      localAppData,
      'Programs',
      'DeepSeek Harness',
      'resources',
      'runtime',
      'cli',
      'bin',
      'dsh.cmd',
    )
    if (existsSync(installed)) return installed
  }
  return wrapCli(home, `pnpm dlx @deepseek-ai/dsh@${runtimeVersion}`)
}

/** The installer accepts one executable path; wrap a command line with arguments in a .cmd. */
function wrapCli(home: string, commandLine: string): string {
  const wrapper = join(home, 'dsh-cli.cmd')
  writeFileSync(wrapper, `@echo off\r\n${commandLine} %*\r\n`, 'utf8')
  return wrapper
}

function isInside(parent: string, candidate: string): boolean {
  const path = relative(resolve(parent), resolve(candidate))
  if (path === '') return true
  // On Windows a relative path across drives is absolute, never a child path.
  return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`) && !path.startsWith(sep)
}

function setupRowIds(): string[] {
  const document: unknown = parse(readFileSync(join(setupDir, 'cordis.patch.yml'), 'utf8'))
  if (!Array.isArray(document))
    throw new Error('packages/setup/cordis.patch.yml must be a YAML array')
  const ids: string[] = []
  for (const entry of document) {
    if (typeof entry !== 'object' || entry === null) continue
    const insert = (entry as { insert?: unknown }).insert
    if (!Array.isArray(insert)) continue
    for (const row of insert) {
      if (typeof row !== 'object' || row === null) continue
      const id = (row as { id?: unknown }).id
      if (typeof id === 'string') ids.push(id)
    }
  }
  return ids
}

function main(): number {
  if (process.platform !== 'win32') {
    console.log('dogfood: install.ps1 targets Windows; skipped on this platform')
    return 0
  }

  const versions = readDshVersions()
  const setupManifest = readJson<PackageManifest>(join(setupDir, 'package.json'))
  const setupDefaults = parseDefaults(readFileSync(join(setupDir, 'defaults.yml'), 'utf8'))
  const setupRows = setupRowIds()

  const ownerHome = resolve(process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
  const ownerProfile = process.env.DSH_PROFILE?.trim() || 'desktop'
  const ownerDir = join(ownerHome, 'profiles', ownerProfile)
  const ownerManifestPath = join(ownerDir, 'package.json')
  const ownerPatchPath = join(ownerDir, 'cordis.patch.yml')
  const ownerCordisPath = join(ownerDir, 'cordis.yml')
  if (!existsSync(ownerManifestPath)) {
    throw new Error(
      `the '${ownerProfile}' profile was not found at ${ownerManifestPath}; start DeepSeek Harness once so the profile exists, then rerun`,
    )
  }

  const pwsh = process.env.PWSH ?? 'pwsh'
  const tmpRoot = join(rootDir, '.tmp')
  if (isInside(ownerHome, tmpRoot)) {
    throw new Error(`refusing to dogfood inside the live Harness home: ${tmpRoot}`)
  }
  mkdirSync(tmpRoot, { recursive: true })
  const home = mkdtempSync(join(tmpRoot, 'dogfood-home-'))
  const profileDir = join(home, 'profiles', DOGFOOD_PROFILE)
  mkdirSync(profileDir, { recursive: true })

  const snapshotDir = mkdtempSync(join(tmpRoot, SNAPSHOT_PREFIX))
  for (const name of ['package.json', 'cordis.patch.yml', 'cordis.yml', 'pnpm-workspace.yaml']) {
    const source = join(ownerDir, name)
    if (existsSync(source)) copyFileSync(source, join(snapshotDir, name))
  }

  const liveHashes = {
    manifest: hashFile(ownerManifestPath),
    patch: hashFile(ownerPatchPath),
    cordis: hashFile(ownerCordisPath),
  }
  const ownerManifest = readJson<DogfoodProfileManifest>(ownerManifestPath)
  const ownerBundles = readBundles(ownerManifest)
  const ownerPatchText = existsSync(ownerPatchPath) ? readFileSync(ownerPatchPath, 'utf8') : ''
  const ownerIds = patchRowIds(ownerPatchText)
  const ownerExplicitDisabled = patchExplicitDisabled(ownerPatchText)

  for (const name of PROFILE_COPY_FILES) {
    const source = join(ownerDir, name)
    if (existsSync(source)) copyFileSync(source, join(profileDir, name))
  }
  const workspaceFile = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspaceFile)) {
    writeFileSync(
      workspaceFile,
      'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n',
      'utf8',
    )
  }
  if (!existsSync(join(profileDir, 'cordis.patch.yml'))) {
    console.warn(
      `dogfood: the owner profile has no cordis.patch.yml; the copy starts with an empty patch`,
    )
  }

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
  // A package manager installed for a CI action points PNPM_HOME at its own
  // bin directory; project operations must not inherit that arrangement.
  delete env.PNPM_HOME

  const cli = resolveDshCli(home, versions.runtime)
  const dump = (): string => {
    const result = shellCommand(
      `${quote(cli)} ${['--profile', DOGFOOD_PROFILE, '--dump-config'].map(quote).join(' ')}`,
      env,
      DUMP_TIMEOUT_MS,
    )
    requireOk(result, 'dsh --dump-config')
    return result.stdout
  }

  const failures: string[] = []
  const step = (name: string, body: () => void): void => {
    const startedAt = Date.now()
    try {
      body()
      console.log(`  ok   ${name} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`)
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      console.error(`  FAIL ${name}`)
    }
  }

  let baselineDump: string | undefined
  let installedDump: string | undefined

  try {
    step('compose the copied owner profile before installation', () => {
      baselineDump = dump()
    })
    if (failures.length > 0) throw new Error(failures.join('; '))

    const installerArgs = [
      '-NoProfile',
      '-File',
      join(rootDir, 'install.ps1'),
      '-Profile',
      DOGFOOD_PROFILE,
      '-DshHome',
      home,
      '-NoStopApp',
      '-NoRestart',
      '-NoDesktopShortcut',
      '-SetupSpec',
      setupDir,
      '-DshCli',
      cli,
    ]
    console.log(`dogfood: installing into ${relative(rootDir, home)} with ${cli}`)
    step('run install.ps1 against the profile copy', () => {
      const result = runPwsh(pwsh, installerArgs, env, INSTALLER_TIMEOUT_MS)
      if (result.status !== 0)
        throw new Error(result.commandLine + '\n' + tail(result.stdout + '\n' + result.stderr))
    })
    if (failures.length > 0) throw new Error(failures.join('; '))

    step('the installer backed up the profile files before changing them', () => {
      const backupDir = join(home, '.dsh-setup-backups')
      if (!existsSync(backupDir)) throw new Error('the backup directory is missing')
      const backups = readdirSync(backupDir)
      const sources = [
        { name: 'package.json', source: ownerManifestPath },
        { name: 'cordis.patch.yml', source: ownerPatchPath },
        { name: 'cordis.yml', source: ownerCordisPath },
      ].filter((entry) => existsSync(entry.source))
      for (const entry of sources) {
        const backup = backups.find((name) => name.startsWith(`${entry.name}.`))
        if (backup === undefined) throw new Error(`missing ${entry.name} backup`)
        if (!readFileSync(join(backupDir, backup)).equals(readFileSync(entry.source))) {
          throw new Error(`the ${entry.name} backup does not match the live file`)
        }
      }
    })

    const manifestPath = join(profileDir, 'package.json')
    const patchPath = join(profileDir, 'cordis.patch.yml')
    const installedManifest = readJson<InstalledProfileManifest>(manifestPath)
    const selectedBundles = readBundles(installedManifest)

    step('the installer appends only the setup bundle and keeps it last', () => {
      const problems = checkBundleSelection(ownerBundles, selectedBundles, [
        ...versions.installBundles.shipped,
        ...versions.installBundles.registry,
      ])
      if (installedManifest.dependencies?.[SETUP_BUNDLE] === undefined) {
        problems.push(`${SETUP_BUNDLE} is missing from the profile dependencies`)
      }
      if (problems.length > 0) throw new Error(problems.join('; '))
    })
    step('the profile copy patch is byte-identical', () => {
      if (liveHashes.patch !== hashFile(patchPath)) throw new Error('cordis.patch.yml changed')
    })
    step('the installed setup version matches this checkout', () => {
      const installedPath = join(profileDir, 'node_modules', '@dsh-setup', 'setup', 'package.json')
      if (!existsSync(installedPath)) throw new Error('the installed setup package was not found')
      const installed = readJson<PackageManifest>(installedPath)
      if (installed.version !== setupManifest.version) {
        throw new Error(`installed ${installed.version}, checkout ${setupManifest.version}`)
      }
    })

    step('the composed copy contains the setup rows and defaults', () => {
      installedDump = dump()
      const problems = [
        ...checkSetupRows(setupRows, installedDump),
        ...checkSetupDefaults(setupDefaults, ownerIds, installedDump),
      ]
      if (problems.length > 0) throw new Error(problems.join('; '))
    })
    step('every owner-patched row keeps its effective config', () => {
      if (baselineDump === undefined || installedDump === undefined) {
        throw new Error('the baseline or installed dump is unavailable')
      }
      const problems = checkOwnerRowsPreserved(
        ownerIds,
        baselineDump,
        installedDump,
        ownerExplicitDisabled,
      )
      if (problems.length > 0) throw new Error(problems.join('; '))
    })
    step('the live profile was not modified', () => {
      const problems: string[] = []
      if (hashFile(ownerManifestPath) !== liveHashes.manifest) problems.push('package.json changed')
      if (hashFile(ownerPatchPath) !== liveHashes.patch) problems.push('cordis.patch.yml changed')
      if (hashFile(ownerCordisPath) !== liveHashes.cordis) problems.push('cordis.yml changed')
      if (problems.length > 0) throw new Error(problems.join('; '))
    })
  } catch (error) {
    console.error(`dogfood: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    try {
      if (process.env.DSH_KEEP === '1') {
        console.log(`dogfood: kept throwaway home ${relative(rootDir, home)}`)
      } else {
        rmSync(home, { recursive: true, force: true })
      }
    } catch (error) {
      console.warn(
        `dogfood: could not remove ${relative(rootDir, home)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (failures.length > 0) {
    console.error(`dogfood: ${failures.length} failing check(s)`)
    for (const failure of failures) console.error(`  ${failure}`)
    return 1
  }
  console.log(`dogfood: install.ps1 round-trip passed against a copy of '${ownerProfile}'`)
  console.log(`dogfood: owner profile snapshot ${relative(rootDir, snapshotDir)}`)
  console.log(
    'dogfood: the live profile and the running Harness were not touched. For a real install, run install.ps1 from an external PowerShell window (it closes and restarts DeepSeek Harness); do not run it from a terminal hosted inside the app.',
  )
  return 0
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(`dogfood: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
