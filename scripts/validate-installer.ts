import { spawn, spawnSync } from 'node:child_process'
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
import { availableBundles, gitBundleSelection, probeNpmBundle } from './lib/install-bundles.ts'
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
  // An absolute executable path with a space (the running Node binary under
  // `Program Files`) needs quoting; a command line such as `pnpm dlx ...` does
  // not, and quoting it would turn it into one missing path.
  const executable = command.includes(' ') && existsSync(command) ? `"${command}"` : command
  const line = [executable, ...args.map((arg) => `"${arg.replaceAll('"', '\\"')}"`)].join(' ')
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

/**
 * The installer runs through spawnSync, which blocks this event loop, so the
 * loopback index server lives in a child process and its port arrives on disk.
 */
function serveIndex(home: string, document: unknown): { url: string; stop: () => void } {
  const portFile = join(home, 'index-port.txt')
  const script = [
    "const http = require('node:http')",
    "const fs = require('node:fs')",
    'const document = JSON.parse(process.env.INDEX_DOCUMENT)',
    'const server = http.createServer((request, response) => {',
    "  response.writeHead(200, { 'content-type': 'application/json' })",
    '  response.end(JSON.stringify(document))',
    '})',
    "server.listen(0, '127.0.0.1', () => {",
    '  fs.writeFileSync(process.env.PORT_FILE, String(server.address().port))',
    '})',
  ].join('\n')
  const child = spawn(process.execPath, ['-e', script], {
    env: { ...process.env, INDEX_DOCUMENT: JSON.stringify(document), PORT_FILE: portFile },
    stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
  }
  if (!existsSync(portFile)) {
    child.kill()
    throw new Error('the loopback index server did not start')
  }
  const port = readFileSync(portFile, 'utf8').trim()
  return {
    url: `http://127.0.0.1:${port}/index.json`,
    stop: () => child.kill(),
  }
}

/**
 * A stand-in plugin manager for the version comparison and the pinned git
 * bundle's failure paths: it answers the version query and the dump, and on
 * install records a chosen installed version. `STUB_GIT_MODE` selects what an
 * add of `STUB_GIT_SPEC` does — `fail` the fetch, record the dependency under
 * `STUB_GIT_PACKAGE` without selecting the bundle (`dependency`), or record it
 * and drop the whole selection (`drop`), which is how a recompose can lose a
 * selection the installer itself appended.
 */
function writeStubCli(home: string): string {
  const stub = join(home, 'stub-dsh.ps1')
  writeFileSync(
    stub,
    [
      '$ErrorActionPreference = "Stop"',
      '$arguments = @($args)',
      'if ($arguments -contains "--version") { Write-Output $env:STUB_DSH_VERSION; exit 0 }',
      '$profile = $null',
      'for ($index = 0; $index -lt $arguments.Count; $index++) {',
      '  if ($arguments[$index] -eq "--profile") { $profile = $arguments[$index + 1] }',
      '}',
      'if ($arguments -contains "--dump-config") { Write-Output "- id: dsh-setup-ponytail"; exit 0 }',
      'if ($arguments -contains "plugin") {',
      '  $profileDir = Join-Path (Join-Path $env:DSH_HOME "profiles") $profile',
      '  $manifestPath = Join-Path $profileDir "package.json"',
      '  $addIndex = [Array]::IndexOf($arguments, "add")',
      '  $spec = if ($addIndex -ge 0 -and $addIndex + 1 -lt $arguments.Count) { [string]$arguments[$addIndex + 1] } else { "" }',
      '  if ($env:STUB_GIT_SPEC -and $spec -eq $env:STUB_GIT_SPEC) {',
      '    if ($env:STUB_GIT_MODE -eq "fail") { [Console]::Error.WriteLine("stub: the pinned spec cannot be fetched"); exit 1 }',
      '    $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json',
      '    if (-not $manifest.PSObject.Properties["dependencies"]) { $manifest | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{}) }',
      '    $manifest.dependencies | Add-Member -NotePropertyName $env:STUB_GIT_PACKAGE -NotePropertyValue $spec -Force',
      '    if ($env:STUB_GIT_MODE -eq "drop") { $manifest.dsh.profile.bundles = @() }',
      '    $manifest | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $manifestPath',
      '    exit 0',
      '  }',
      '  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json',
      '  $manifest.dependencies | Add-Member -NotePropertyName "@dsh-setup/setup" -NotePropertyValue "stub" -Force',
      '  if ($env:STUB_GIT_MODE -eq "drop") { $manifest.dsh.profile.bundles = @() }',
      '  $manifest | ConvertTo-Json -Depth 32 | Set-Content -LiteralPath $manifestPath',
      '  $packageDir = Join-Path (Join-Path $profileDir "node_modules") "@dsh-setup/setup"',
      '  New-Item -ItemType Directory -Force -Path $packageDir | Out-Null',
      '  [pscustomobject]@{ name = "@dsh-setup/setup"; version = $env:STUB_INSTALLED_VERSION } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $packageDir "package.json")',
      '  exit 0',
      '}',
      'exit 1',
    ].join('\n'),
  )
  return stub
}

function main(): number {
  if (process.platform !== 'win32') {
    console.log('validate-installer: install.ps1 targets Windows; skipped on this platform')
    return 0
  }
  const pwsh = process.env.PWSH ?? 'pwsh'
  const versions = readDshVersions()
  const dshVersion = process.env.DSH_VERSION ?? versions.runtime
  // A DSH release inside the supported range can drop a shipped optional
  // bundle; expect only what this DSH version actually provides.
  const shippedBundles = availableBundles(
    versions.installBundles.shipped,
    dshVersion,
    probeNpmBundle,
  )
  if (shippedBundles.length !== versions.installBundles.shipped.length) {
    console.log(
      `validate-installer: DSH ${dshVersion} ships ${String(shippedBundles.length)} of ${String(versions.installBundles.shipped.length)} selected bundle(s)`,
    )
  }
  // Git-sourced bundles are resolved from the installed manifest, because the
  // installer takes the package name the profile recorded: see the install step.
  const tmpRoot = join(rootDir, '.tmp')
  mkdirSync(tmpRoot, { recursive: true })
  const home = mkdtempSync(join(tmpRoot, 'installer-home-'))
  // The setup spec is a commit-pinned git spec when CI supplies one — that is
  // the release path users take and it keeps the install out of this checkout.
  // Otherwise install a copy outside the repository workspace: the throwaway
  // home lives below `rootDir`, so a checkout path there would make pnpm resolve
  // the profile against the repository's workspace instead of treating it as the
  // standalone directory a user installs.
  const gitSpec = process.env.DSH_SETUP_SPEC?.trim()
  const setupSource = mkdtempSync(join(tmpdir(), 'dsh-setup-package-'))
  let setupSpec: string
  if (gitSpec !== undefined && gitSpec !== '') {
    setupSpec = gitSpec
  } else {
    cpSync(setupDir, join(setupSource, 'setup'), { recursive: true })
    setupSpec = join(setupSource, 'setup')
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
  const basePath = env.PATH ?? env.Path ?? ''

  const cleanup = (dir: string): void => {
    if (process.env.DSH_KEEP === '1') return
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch (error) {
      console.warn(
        `validate-installer: could not remove ${relative(rootDir, dir)}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const makeUvStub = (): string => {
    const dir = mkdtempSync(join(tmpRoot, 'installer-stub-uv-'))
    writeFileSync(join(dir, 'uv.cmd'), '@exit /b 0\r\n')
    return dir
  }

  const makeInvalidExport = (): string => {
    const dir = mkdtempSync(join(tmpRoot, 'installer-export-'))
    writeFileSync(join(dir, 'keep.txt'), 'keep')
    return dir
  }

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

    // A shell run by the running Harness must never let the installer close the
    // app that hosts it; the refusal has to happen before the profile is read or
    // changed. The fake desktop profile makes the guard the only possible reason
    // for the non-zero exit.
    step('the installer refuses to restart the Harness hosting it', () => {
      const desktopDir = join(home, 'profiles', 'desktop')
      mkdirSync(desktopDir, { recursive: true })
      cpSync(manifestPath, join(desktopDir, 'package.json'))
      if (existsSync(patchPath)) cpSync(patchPath, join(desktopDir, 'cordis.patch.yml'))
      const desktopManifest = join(desktopDir, 'package.json')
      const manifestBefore = hashFile(desktopManifest)
      const guardArgs = [
        '-NoProfile',
        '-File',
        join(rootDir, 'install.ps1'),
        '-Profile',
        'desktop',
        '-DshHome',
        home,
        '-NoStopApp',
        '-NoRestart',
        '-SetupSpec',
        setupSpec,
      ]
      if (cli !== undefined) guardArgs.push('-DshCli', cli)
      const guardEnv: NodeJS.ProcessEnv = {
        ...env,
        DSH_SESSION_ID: 'session-installer-guard-check',
      }
      const guarded = shell(pwsh, guardArgs, guardEnv, 120_000)
      if (guarded.status === 0) {
        throw new Error('the installer accepted a desktop install from a shell hosted by the app')
      }
      const output = `${guarded.stdout}\n${guarded.stderr}`
      if (!output.includes('would terminate this session')) {
        throw new Error(
          `the refusal lacks the hosted-shell explanation\n${output.trim().split('\n').slice(-20).join('\n')}`,
        )
      }
      if (hashFile(desktopManifest) !== manifestBefore) {
        throw new Error('the guard changed the profile before refusing')
      }
    })

    const patchBefore = hashFile(patchPath)

    // A downloaded copy has no checkout beside it, so it must resolve the
    // release from the index or the tag fallback. Use the documented URL and
    // prove the plan carries a full git spec; the real run below keeps its pin.
    step('a downloaded installer resolves a git release spec', () => {
      const copy = join(home, 'install.ps1')
      cpSync(join(rootDir, 'install.ps1'), copy)
      const args = ['-NoProfile', '-File', copy, '-Profile', 'ci', '-DshHome', home, '-DryRun']
      if (cli !== undefined) args.push('-DshCli', cli)
      const result = shell(pwsh, args, env, 120_000)
      if (result.status !== 0) throw fail(result)
      for (const fragment of [
        'git+https://github.com/sergey-akhalkov/dsh-setup.git#',
        '&path:/packages/setup',
        'hindsight:',
        'Dry run: no changes were made',
      ]) {
        if (!result.stdout.includes(fragment)) {
          throw new Error(`the plan lacks "${fragment}"\n${result.stdout.trim()}`)
        }
      }
      const planIndex = result.stdout.indexOf('==> Plan')
      const hindsightIndex = result.stdout.indexOf('hindsight:')
      if (planIndex < 0 || hindsightIndex <= planIndex) {
        throw new Error(
          `the plan does not report the profile phase before Hindsight\n${result.stdout.trim()}`,
        )
      }
      const disabled = shell(pwsh, [...args, '-NoHindsight'], env, 120_000)
      if (disabled.status !== 0) throw fail(disabled)
      if (!disabled.stdout.includes('hindsight: skip (-NoHindsight)')) {
        throw new Error(`the -NoHindsight plan lacks its skip line\n${disabled.stdout.trim()}`)
      }
    })

    // The Hindsight phase is machine-level and CI has no key or daemon, so the
    // Hindsight-only mode must plan without a DSH profile, a CLI, or a prompt.
    step('the Hindsight-only mode plans without a profile or CLI', () => {
      const hindsightHome = mkdtempSync(join(tmpRoot, 'installer-hindsight-'))
      try {
        const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR ?? ''
        const powershell51 = join(
          windowsRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        )
        const restrictedEnv: NodeJS.ProcessEnv = {
          ...env,
          PATH: `${join(windowsRoot, 'System32')};${windowsRoot}`,
        }
        const plans = [
          { runner: pwsh, runEnv: env, label: 'the normal PATH', prefix: [] as string[] },
          {
            runner: powershell51,
            runEnv: restrictedEnv,
            label: 'a PATH without uv',
            prefix: ['-ExecutionPolicy', 'Bypass'],
          },
        ]
        for (const plan of plans) {
          const result = shell(
            plan.runner,
            [
              '-NoProfile',
              ...plan.prefix,
              '-File',
              join(rootDir, 'install.ps1'),
              '-HindsightOnly',
              '-DryRun',
              '-DshHome',
              hindsightHome,
            ],
            plan.runEnv,
            120_000,
          )
          if (result.status !== 0) throw fail(result)
          for (const fragment of [
            'Hindsight dry run: no changes will be made',
            'hindsight:',
            'http://127.0.0.1:',
          ]) {
            if (!result.stdout.includes(fragment)) {
              throw new Error(
                `the Hindsight-only plan on ${plan.label} lacks "${fragment}"\n${result.stdout.trim()}`,
              )
            }
          }
          if (result.stdout.includes('Reading the DeepSeek Harness installation')) {
            throw new Error(
              `the Hindsight-only plan on ${plan.label} read a DSH profile\n${result.stdout.trim()}`,
            )
          }
        }
      } finally {
        if (process.env.DSH_KEEP !== '1') {
          try {
            rmSync(hindsightHome, { recursive: true, force: true })
          } catch (error) {
            console.warn(
              `validate-installer: could not remove ${relative(rootDir, hindsightHome)}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
      }
    })

    // The contradictory switches must fail before the installer reads a profile
    // or writes the isolated home; a guard removal has to fail this step.
    step('contradictory Hindsight options are rejected before any change', () => {
      const conflictHome = mkdtempSync(join(tmpRoot, 'installer-conflict-'))
      try {
        for (const [args, message] of [
          [
            ['-HindsightOnly', '-NoHindsight'],
            '-HindsightOnly and -NoHindsight cannot be combined.',
          ],
          [
            ['-NoHindsight', '-RepairHindsight'],
            '-NoHindsight and -RepairHindsight cannot be combined.',
          ],
        ] as const) {
          const result = shell(
            pwsh,
            [
              '-NoProfile',
              '-File',
              join(rootDir, 'install.ps1'),
              ...args,
              '-DshHome',
              conflictHome,
            ],
            env,
            120_000,
          )
          const output = `${result.stdout}\n${result.stderr}`
          if (result.status === 0) {
            throw new Error(`the installer accepted ${args.join(' ')}\n${output.trim()}`)
          }
          if (!output.includes(message)) {
            throw new Error(
              `the refusal for ${args.join(' ')} lacks "${message}"\n${output.trim()}`,
            )
          }
        }
        if (readdirSync(conflictHome).length > 0) {
          throw new Error('contradictory options changed the isolated Harness home')
        }
      } finally {
        if (process.env.DSH_KEEP !== '1') {
          try {
            rmSync(conflictHome, { recursive: true, force: true })
          } catch (error) {
            console.warn(
              `validate-installer: could not remove ${relative(rootDir, conflictHome)}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
      }
    })

    // Neither existing run can prove the resolved-version check: the install
    // passes -SetupSpec, which returns before market resolution, and the dry run
    // stops before verification. This step supplies both sides of the comparison:
    // a loopback index with a chosen version and a stub plugin manager reporting
    // a chosen installed version. A stale installed version must fail the run.
    step('the installed version is verified against the resolved index version', () => {
      const commit = '0123456789abcdef0123456789abcdef01234567'
      const document = (version: string) => ({
        plugins: [
          {
            name: '@dsh-setup/setup',
            versions: [
              {
                version,
                source: {
                  type: 'git',
                  url: 'https://example.invalid/dsh-setup',
                  commit,
                  path: 'packages/setup',
                },
              },
            ],
          },
        ],
      })
      const run = (resolvedVersion: string, installedVersion: string) => {
        const runHome = mkdtempSync(join(tmpRoot, 'installer-market-'))
        // A downloaded copy, like the documented one-liner: it has no checkout
        // beside it, so the index is the source instead of the local repository.
        const installerCopy = join(runHome, 'install.ps1')
        cpSync(join(rootDir, 'install.ps1'), installerCopy)
        const profileDir = join(runHome, 'profiles', 'market')
        mkdirSync(profileDir, { recursive: true })
        writeFileSync(
          join(profileDir, 'package.json'),
          JSON.stringify({ name: 'market', dependencies: {}, dsh: { profile: { bundles: [] } } }),
        )
        const stub = writeStubCli(runHome)
        const index = serveIndex(runHome, document(resolvedVersion))
        try {
          return shell(
            pwsh,
            [
              '-NoProfile',
              '-File',
              installerCopy,
              '-Profile',
              'market',
              '-DshHome',
              runHome,
              '-DshCli',
              stub,
              '-IndexUrl',
              index.url,
              '-NoStopApp',
              '-NoRestart',
              '-NoDesktopShortcut',
              '-NoHindsight',
            ],
            {
              ...env,
              DSH_HOME: runHome,
              STUB_DSH_VERSION: dshVersion,
              STUB_INSTALLED_VERSION: installedVersion,
            },
            240_000,
          )
        } finally {
          index.stop()
          if (process.env.DSH_KEEP !== '1') {
            try {
              rmSync(runHome, { recursive: true, force: true })
            } catch (error) {
              console.warn(
                `validate-installer: could not remove ${relative(rootDir, runHome)}: ${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }
      }

      const mismatch = run('1.2.4', '1.2.3')
      const mismatchOutput = `${mismatch.stdout}\n${mismatch.stderr}`
      if (mismatch.status === 0) {
        throw new Error(
          `a stale installed version passed the verification\n${mismatchOutput.trim()}`,
        )
      }
      for (const fragment of ['1.2.3', '1.2.4']) {
        if (!mismatchOutput.includes(fragment)) {
          throw new Error(`the version failure does not name ${fragment}\n${mismatchOutput.trim()}`)
        }
      }

      const matching = run('1.2.3', '1.2.3')
      if (matching.status !== 0) throw fail(matching)
      if (!matching.stdout.includes('setup version 1.2.3')) {
        throw new Error(`the run does not report the installed version\n${matching.stdout.trim()}`)
      }
    })

    // The pinned git bundle's paths — a failed fetch, a stale pin, and a dropped
    // selection — are only reachable with a plugin manager that answers the
    // install, so they run against the stub CLI. The stub records the package
    // under a scoped name that neither the repository name nor the spec carries,
    // so a run passes only when the installer takes the name from the profile.
    step(
      'the pinned git bundle survives a failed fetch, replaces a stale pin, and rejects a dropped selection',
      () => {
        const spec = versions.installBundles.git[0]
        if (spec === undefined) {
          console.log('       no git bundle is declared; skipped')
          return
        }
        const recordedPackage = '@probe/scoped-design-package'
        const staleSpec = spec.replace(/#[0-9a-f]{40}$/u, `#${'1'.repeat(40)}`)
        if (staleSpec === spec) throw new Error(`cannot build a stale pin from ${spec}`)
        const runGitCase = (
          mode: 'fail' | 'dependency' | 'drop',
          seed?: (manifest: ProfileManifest) => void,
        ) => {
          const caseHome = mkdtempSync(join(tmpRoot, 'installer-git-'))
          const caseProfile = join(caseHome, 'profiles', 'ci')
          cpSync(join(home, 'profiles', 'ci'), caseProfile, { recursive: true })
          const caseManifest: ProfileManifest = {
            dependencies: {},
            dsh: { profile: { bundles: [] } },
          }
          seed?.(caseManifest)
          writeFileSync(
            join(caseProfile, 'package.json'),
            JSON.stringify({ name: 'dsh-profile-ci', ...caseManifest }),
          )
          const result = shell(
            pwsh,
            [
              '-NoProfile',
              '-File',
              join(rootDir, 'install.ps1'),
              '-Profile',
              'ci',
              '-DshHome',
              caseHome,
              '-DshCli',
              writeStubCli(caseHome),
              '-SetupSpec',
              setupSpec,
              '-NoStopApp',
              '-NoRestart',
              '-NoDesktopShortcut',
              '-NoHindsight',
            ],
            {
              ...env,
              DSH_HOME: caseHome,
              STUB_DSH_VERSION: dshVersion,
              STUB_INSTALLED_VERSION: '0.0.0-stub',
              STUB_GIT_MODE: mode,
              STUB_GIT_SPEC: spec,
              STUB_GIT_PACKAGE: recordedPackage,
            },
            240_000,
          )
          const manifest = readJson<ProfileManifest>(join(caseProfile, 'package.json'))
          const bundles = manifest.dsh?.profile?.bundles ?? []
          cleanup(caseHome)
          return { result, output: `${result.stdout}\n${result.stderr}`, manifest, bundles }
        }

        const failed = runGitCase('fail')
        if (failed.result.status !== 0) throw fail(failed.result)
        if (!failed.output.includes('could not be installed')) {
          throw new Error(`the failed fetch is not reported\n${failed.output.trim()}`)
        }
        if (failed.manifest.dependencies?.[recordedPackage] !== undefined) {
          throw new Error('the failed fetch still recorded a dependency')
        }
        if (!failed.output.includes('setup version')) {
          throw new Error('the failed fetch did not leave the setup bundle installed')
        }

        const installed = runGitCase('dependency')
        if (installed.result.status !== 0) throw fail(installed.result)
        if (installed.manifest.dependencies?.[recordedPackage] !== spec) {
          throw new Error(
            `the installed dependency is ${String(installed.manifest.dependencies?.[recordedPackage])}, not the declared spec`,
          )
        }
        if (!installed.bundles.includes(recordedPackage)) {
          throw new Error('the dependency was installed without selecting its bundle')
        }
        if (installed.bundles[installed.bundles.length - 1] !== '@dsh-setup/setup') {
          throw new Error('the setup bundle is not last after a git bundle was selected')
        }

        const stale = runGitCase('dependency', (manifest) => {
          manifest.dependencies = { [recordedPackage]: staleSpec }
          manifest.dsh = { profile: { bundles: [recordedPackage] } }
        })
        if (stale.result.status !== 0) throw fail(stale.result)
        if (stale.manifest.dependencies?.[recordedPackage] !== spec) {
          throw new Error('a stale pin was not reinstalled at the declared spec')
        }

        const current = runGitCase('fail', (manifest) => {
          manifest.dependencies = { [recordedPackage]: spec }
          manifest.dsh = { profile: { bundles: [recordedPackage] } }
        })
        if (current.result.status !== 0) throw fail(current.result)
        if (!current.output.includes(`already installed: ${recordedPackage}`)) {
          throw new Error(`a current pin was not skipped\n${current.output.trim()}`)
        }
        if (current.output.includes('could not be installed')) {
          throw new Error('a current pin was fetched again instead of being skipped')
        }

        const dropped = runGitCase('drop')
        if (dropped.result.status === 0) {
          throw new Error('an installed but unselected bundle passed the verification')
        }
        if (!dropped.output.includes(`bundle ${recordedPackage} is not selected`)) {
          throw new Error(`the dropped selection is not named\n${dropped.output.trim()}`)
        }
      },
    )

    // The installer's allowlist is the enginesDsh range itself: a prerelease
    // newer than any version list is admitted, and versions outside the range
    // are refused before the profile is read. The stub CLI supplies the
    // reported version, so neither run needs a real package install.
    step('the version gate admits an in-range prerelease that was never listed', () => {
      const gateDir = mkdtempSync(join(tmpRoot, 'installer-gate-'))
      try {
        const stub = writeStubCli(gateDir)
        const result = shell(
          pwsh,
          [
            '-NoProfile',
            '-File',
            join(rootDir, 'install.ps1'),
            '-Profile',
            'ci',
            '-DshHome',
            home,
            '-DshCli',
            stub,
            '-SetupSpec',
            setupSpec,
            '-DryRun',
            '-NoHindsight',
          ],
          { ...env, STUB_DSH_VERSION: '0.2.2-rc.2' },
          120_000,
        )
        if (result.status !== 0) throw fail(result)
        for (const fragment of ['DSH 0.2.2-rc.2', 'Dry run: no changes were made']) {
          if (!result.stdout.includes(fragment)) {
            throw new Error(`the in-range run lacks "${fragment}"\n${result.stdout.trim()}`)
          }
        }
      } finally {
        cleanup(gateDir)
      }
    })

    step('the version gate refuses versions outside the engine range before any change', () => {
      const gateDir = mkdtempSync(join(tmpRoot, 'installer-gate-'))
      try {
        const stub = writeStubCli(gateDir)
        const cases = [
          { version: '0.2.1-rc.2', problems: [versions.enginesDsh, 'Update DeepSeek Harness'] },
          { version: '0.3.0', problems: [versions.enginesDsh, 'Update DeepSeek Harness'] },
          { version: 'not-a-version', problems: ['Cannot read DSH version'] },
        ]
        for (const gateCase of cases) {
          const refusedHome = mkdtempSync(join(tmpRoot, 'installer-gate-refused-'))
          try {
            const result = shell(
              pwsh,
              [
                '-NoProfile',
                '-File',
                join(rootDir, 'install.ps1'),
                '-Profile',
                'ci',
                '-DshHome',
                refusedHome,
                '-DshCli',
                stub,
                '-DryRun',
                '-NoHindsight',
              ],
              { ...env, DSH_HOME: refusedHome, STUB_DSH_VERSION: gateCase.version },
              120_000,
            )
            const output = `${result.stdout}\n${result.stderr}`
            if (result.status === 0) {
              throw new Error(`the installer accepted DSH ${gateCase.version}\n${output.trim()}`)
            }
            for (const fragment of [gateCase.version, ...gateCase.problems]) {
              if (!output.includes(fragment)) {
                throw new Error(
                  `the refusal for DSH ${gateCase.version} lacks "${fragment}"\n${output.trim()}`,
                )
              }
            }
            if (output.includes('==> Plan')) {
              throw new Error(
                `the refusal for DSH ${gateCase.version} reached the plan\n${output.trim()}`,
              )
            }
            if (readdirSync(refusedHome).length > 0) {
              throw new Error(`the refusal for DSH ${gateCase.version} changed the isolated home`)
            }
          } finally {
            cleanup(refusedHome)
          }
        }
      } finally {
        cleanup(gateDir)
      }
    })

    // The documented one-line form executes the installer through
    // Invoke-Expression, so a failure must not terminate the calling process:
    // the wrapper prints a marker from its catch and a sentinel after the call,
    // then ends with its own non-zero exit. A run that never failed is a miss.
    step('the one-line form keeps the calling session alive', () => {
      const iexHome = mkdtempSync(join(tmpRoot, 'installer-iex-'))
      const probe = join(iexHome, 'probe.ps1')
      writeFileSync(
        probe,
        [
          `$env:DSH_HOME = '${iexHome}'`,
          '$caught = $null',
          `try { iex (Get-Content -Raw -LiteralPath '${join(rootDir, 'install.ps1')}') } catch { $caught = $_; Write-Host 'PROBE-CAUGHT' }`,
          "Write-Host 'PROBE-SENTINEL'",
          "if ($null -eq $caught) { Write-Host 'PROBE-NO-FAILURE'; exit 2 }",
          'exit 1',
        ].join('\n'),
      )
      try {
        const result = shell(pwsh, ['-NoProfile', '-File', probe], env, 120_000)
        const output = `${result.stdout}\n${result.stderr}`
        if (result.status !== 1) {
          throw new Error(
            `the probe exited ${String(result.status)} instead of 1\n${output.trim()}`,
          )
        }
        for (const marker of ['FAILED:', 'PROBE-CAUGHT', 'PROBE-SENTINEL']) {
          if (!output.includes(marker)) {
            throw new Error(`the probe output lacks "${marker}"\n${output.trim()}`)
          }
        }
      } finally {
        if (process.env.DSH_KEEP !== '1') {
          try {
            rmSync(iexHome, { recursive: true, force: true })
          } catch (error) {
            console.warn(
              `validate-installer: could not remove ${relative(rootDir, iexHome)}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
      }
    })

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
      '-NoDesktopShortcut',
      '-NoHindsight',
      '-SetupSpec',
      setupSpec,
    ]
    if (cli !== undefined) installerArgs.push('-DshCli', cli)

    let first: ReturnType<typeof shell> | undefined
    step('run install.ps1', () => {
      first = shell(pwsh, installerArgs, env, 240_000)
      if (first.status !== 0) throw fail(first)
      const verificationIndex = first.stdout.indexOf('Verifying the installed profile')
      const phaseIndex = first.stdout.indexOf('==> Hindsight')
      const summaryIndex = first.stdout.indexOf('Hindsight: skipped (-NoHindsight)')
      if (verificationIndex < 0 || phaseIndex <= verificationIndex) {
        throw new Error('the Hindsight phase did not run after the profile verification')
      }
      if (summaryIndex <= phaseIndex) {
        throw new Error('the run summary does not report the skipped Hindsight phase')
      }
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

    // The installer selects the package name the profile recorded, so the
    // expectation is read from the installed manifest; a declared spec that is
    // absent is a real failure, not a silently narrowed check.
    const installedDependencies = readJson<ProfileManifest>(manifestPath).dependencies
    const gitSelection = gitBundleSelection(versions.installBundles.git, installedDependencies)
    step('the installer installed every declared git bundle from its pin', () => {
      if (gitSelection.missing.length > 0) {
        throw new Error(`not installed from the pinned spec: ${gitSelection.missing.join(', ')}`)
      }
    })
    const gitBundles = gitSelection.names

    stageManifestChecks(manifestPath, versions, shippedBundles, gitBundles, failures)
    step('the installer leaves the profile patch untouched', () => {
      if (hashFile(patchPath) !== patchBefore) throw new Error('cordis.patch.yml changed')
    })

    // Compose the installed profile directly: every shipped bundle header and the
    // setup row/defaults must appear in the dumped tree.
    step('the composed profile contains every installer bundle and the setup rows', () => {
      const composed = shell(cliBase, ['--profile', 'ci', '--dump-config'], env, 600_000)
      if (composed.status !== 0) throw fail(composed)
      const markers = [
        ...shippedBundles,
        ...versions.installBundles.registry,
        ...gitBundles,
        'dsh-setup-ponytail',
        'reasoningEffort: xhigh',
        'preference: dark',
        'selectedDefault: cordis',
      ]
      for (const marker of markers) {
        if (!composed.stdout.includes(marker)) throw new Error(`composed dump lacks "${marker}"`)
      }
      // A bundle's header only proves its layer was applied; every row its own
      // patch declares must be mounted too, or the skill never reaches a session.
      const rowLines = new Set(composed.stdout.split('\n').map((line) => line.trim()))
      for (const name of gitBundles) {
        const bundlePatch = join(profileDir, 'node_modules', name, 'cordis.patch.yml')
        if (!existsSync(bundlePatch)) throw new Error(`${name} ships no bundle patch to check`)
        const rowIds = [
          ...readFileSync(bundlePatch, 'utf8').matchAll(/^\s*-\s+id:\s*([A-Za-z0-9@/._-]+)\s*$/gmu),
        ].map((match) => match[1] ?? '')
        if (rowIds.length === 0) throw new Error(`${name}'s patch names no row`)
        for (const id of rowIds) {
          if (!rowLines.has(`- id: ${id}`)) {
            throw new Error(`composed dump lacks the row "${id}" from ${name}`)
          }
        }
      }
    })

    // The English catalog adapter must resolve from the installed profile, not
    // only from a synthetic directory: load the vendored plugin copy and read the
    // entry the skills list would show, then read the same code copied away from
    // the profile, where no upstream package exists.
    step(
      'the installed English catalog adapter resolves, and disappears without the upstream',
      () => {
        const spec = versions.installBundles.git.find((candidate) =>
          candidate.includes('huashu-design'),
        )
        if (spec === undefined) {
          console.log('       no huashu-design git bundle is declared; skipped')
          return
        }
        const adapter = join(
          profileDir,
          'node_modules',
          '@dsh-setup',
          'setup',
          'node_modules',
          '@dsh-setup',
          'plugin-huashu-design',
          'lib',
          'index.js',
        )
        if (!existsSync(adapter)) {
          throw new Error('the installed setup does not vendor the catalog adapter')
        }
        interface Entry {
          count: number
          name?: string
          rank?: number
          english?: boolean
          base?: string
          directive?: boolean
        }
        const probeDir = mkdtempSync(join(tmpRoot, 'installer-adapter-'))
        const probe = join(probeDir, 'probe.mjs')
        writeFileSync(
          probe,
          [
            "import { pathToFileURL } from 'node:url'",
            'const plugin = await import(pathToFileURL(process.argv[2]).href)',
            'const providers = []',
            'plugin.apply({ skills: { registerProvider: (create) => providers.push(create()) } })',
            'const candidates = await providers[0].list()',
            'const candidate = candidates[0]',
            'const definition = candidate === undefined ? undefined : await providers[0].get(candidate, {})',
            'console.log(JSON.stringify({',
            '  count: candidates.length,',
            '  name: candidate?.name,',
            '  rank: candidate?.rank,',
            '  english: candidate === undefined ? false : !/[\\u3400-\\u9fff]/u.test(candidate.description),',
            '  base: candidate?.resourceBase?.path,',
            '  directive: definition === undefined ? false : definition.content.includes("the upstream instruction in this skill is written in Chinese"),',
            '}))',
          ].join('\n'),
        )
        const readEntry = (target: string, profile: string): Entry => {
          const result = shell(process.execPath, [probe, target], {
            ...env,
            DSH_PROFILE_DIR: profile,
            DSH_HOME: '',
            DSH_PROFILE: '',
          })
          if (result.status !== 0) throw fail(result)
          return JSON.parse(result.stdout.trim()) as Entry
        }
        try {
          const installed = readEntry(adapter, profileDir)
          if (installed.count !== 1) {
            throw new Error(`the installed adapter lists ${String(installed.count)} candidate(s)`)
          }
          if (installed.name !== 'huashu-design') {
            throw new Error(`the installed adapter lists ${String(installed.name)}`)
          }
          if (installed.english !== true) {
            throw new Error('the installed catalog description is not English')
          }
          // Lower wins: above a user skill (500), below the bundled root (600).
          if ((installed.rank ?? 0) <= 500 || (installed.rank ?? 0) >= 600) {
            throw new Error(`unexpected catalog rank ${String(installed.rank)}`)
          }
          if (installed.directive !== true) {
            throw new Error('the loaded body lacks the English directive')
          }
          if (installed.base === undefined || !existsSync(installed.base)) {
            throw new Error('the catalog base directory does not exist')
          }

          // Remove the upstream from the same profile while the installed
          // adapter stays in place: the entry must disappear. The install is
          // restored afterwards so the next step still exercises a full profile.
          const upstream = join(profileDir, 'node_modules', 'huashu-design')
          if (!existsSync(upstream)) throw new Error('the upstream package is not installed')
          rmSync(upstream, { recursive: true, force: true })
          const absent = readEntry(adapter, profileDir)
          if (absent.count !== 0) {
            throw new Error('the adapter lists an entry without the upstream package')
          }
          const restored = shell(cliBase, ['plugin', '--profile', 'ci', 'add', spec], env, 600_000)
          if (restored.status !== 0) throw fail(restored)
        } finally {
          cleanup(probeDir)
        }
      },
    )

    const bundlesBefore = readBundles(manifestPath)
    step('a second installer run is a no-op', () => {
      const second = shell(pwsh, installerArgs, env)
      if (second.status !== 0) throw fail(second)
      const bundlesAfter = readBundles(manifestPath)
      if (JSON.stringify(bundlesAfter) !== JSON.stringify(bundlesBefore)) {
        console.error(`  before: ${JSON.stringify(bundlesBefore)}`)
        console.error(`  after:  ${JSON.stringify(bundlesAfter)}`)
        throw new Error('the bundle selection changed on the second run')
      }
      if (hashFile(patchPath) !== patchBefore) throw new Error('cordis.patch.yml changed')
    })

    // A missing key must skip, not fail, even when the host cannot prompt.
    step('a non-interactive run without a key skips the Hindsight phase', () => {
      const noKeyHome = mkdtempSync(join(tmpRoot, 'installer-no-key-'))
      const hindsightHome = mkdtempSync(join(tmpRoot, 'installer-no-key-hindsight-'))
      const uvStub = makeUvStub()
      try {
        const noKeyEnv: NodeJS.ProcessEnv = {
          ...env,
          PATH: `${uvStub};${basePath}`,
          DSH_SETUP_HINDSIGHT_HOME: hindsightHome,
        }
        delete noKeyEnv.DEEPSEEK_API_KEY
        const result = shell(
          pwsh,
          [
            '-NoProfile',
            '-NonInteractive',
            '-File',
            join(rootDir, 'install.ps1'),
            '-HindsightOnly',
            '-DshHome',
            noKeyHome,
          ],
          noKeyEnv,
          120_000,
        )
        const output = `${result.stdout}\n${result.stderr}`
        if (result.status !== 0) throw fail(result)
        if (!output.includes('no DeepSeek key is available')) {
          throw new Error(`the no-key run does not report the skip\n${output.trim()}`)
        }
        if (readdirSync(noKeyHome).length > 0 || readdirSync(hindsightHome).length > 0) {
          throw new Error('the no-key run changed the isolated or Hindsight home')
        }
      } finally {
        cleanup(noKeyHome)
        cleanup(hindsightHome)
        cleanup(uvStub)
      }
    })

    // An attempted phase that fails must exit non-zero without touching the runtime.
    step('a failed Hindsight phase exits non-zero without changing the runtime', () => {
      const failureHome = mkdtempSync(join(tmpRoot, 'installer-hindsight-fail-'))
      const hindsightHome = mkdtempSync(join(tmpRoot, 'installer-hindsight-fail-home-'))
      const uvStub = makeUvStub()
      const exportDir = makeInvalidExport()
      try {
        const failureEnv: NodeJS.ProcessEnv = {
          ...env,
          PATH: `${uvStub};${basePath}`,
          DSH_SETUP_HINDSIGHT_HOME: hindsightHome,
        }
        const result = shell(
          pwsh,
          [
            '-NoProfile',
            '-File',
            join(rootDir, 'install.ps1'),
            '-HindsightOnly',
            '-RepairHindsight',
            '-SkipVerify',
            '-DeepSeekApiKey',
            'deliberately-invalid',
            '-ExportDir',
            exportDir,
            '-DshHome',
            failureHome,
          ],
          failureEnv,
          120_000,
        )
        const output = `${result.stdout}\n${result.stderr}`
        if (result.status === 0) throw new Error(`the failed phase passed\n${output.trim()}`)
        for (const fragment of [
          'The Hindsight phase failed',
          'not empty and is not a Git repository',
        ]) {
          if (!output.includes(fragment)) {
            throw new Error(`the failed phase lacks "${fragment}"\n${output.trim()}`)
          }
        }
        if (readdirSync(hindsightHome).length > 0) {
          throw new Error('the failed phase changed the Hindsight home')
        }
      } finally {
        cleanup(failureHome)
        cleanup(hindsightHome)
        cleanup(uvStub)
        cleanup(exportDir)
      }
    })

    // The real phase must skip with a warning when uv is unavailable.
    step('a run without uv skips the Hindsight phase', () => {
      const noUvHome = mkdtempSync(join(tmpRoot, 'installer-no-uv-'))
      const hindsightHome = mkdtempSync(join(tmpRoot, 'installer-no-uv-hindsight-'))
      try {
        const windowsRoot = process.env.SystemRoot ?? process.env.WINDIR ?? ''
        const powershell51 = join(
          windowsRoot,
          'System32',
          'WindowsPowerShell',
          'v1.0',
          'powershell.exe',
        )
        const restrictedEnv: NodeJS.ProcessEnv = {
          ...env,
          PATH: `${join(windowsRoot, 'System32')};${windowsRoot}`,
          DSH_SETUP_HINDSIGHT_HOME: hindsightHome,
        }
        const result = shell(
          powershell51,
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(rootDir, 'install.ps1'),
            '-HindsightOnly',
            '-DshHome',
            noUvHome,
          ],
          restrictedEnv,
          120_000,
        )
        const output = `${result.stdout}\n${result.stderr}`
        if (result.status !== 0) throw fail(result)
        if (!output.includes('uv is not installed')) {
          throw new Error(`the no-uv run does not report the skip\n${output.trim()}`)
        }
        if (readdirSync(noUvHome).length > 0 || readdirSync(hindsightHome).length > 0) {
          throw new Error('the no-uv run changed the isolated or Hindsight home')
        }
      } finally {
        cleanup(noUvHome)
        cleanup(hindsightHome)
      }
    })

    // A rejected key must fail the attempted phase before any runtime change.
    step('a rejected key fails the phase without changing the runtime', () => {
      const failureHome = mkdtempSync(join(tmpRoot, 'installer-rejected-key-'))
      const hindsightHome = mkdtempSync(join(tmpRoot, 'installer-rejected-key-home-'))
      const uvStub = makeUvStub()
      try {
        const failureEnv: NodeJS.ProcessEnv = {
          ...env,
          PATH: `${uvStub};${basePath}`,
          DSH_SETUP_HINDSIGHT_HOME: hindsightHome,
        }
        const result = shell(
          pwsh,
          [
            '-NoProfile',
            '-File',
            join(rootDir, 'install.ps1'),
            '-HindsightOnly',
            '-RepairHindsight',
            '-DeepSeekApiKey',
            'deliberately-invalid',
            '-DshHome',
            failureHome,
          ],
          failureEnv,
          120_000,
        )
        const output = `${result.stdout}\n${result.stderr}`
        if (result.status === 0) throw new Error(`the rejected key passed\n${output.trim()}`)
        if (!output.includes('DeepSeek API key was rejected')) {
          throw new Error(`the rejected key is not reported\n${output.trim()}`)
        }
        if (readdirSync(hindsightHome).length > 0) {
          throw new Error('the rejected key changed the Hindsight home')
        }
      } finally {
        cleanup(failureHome)
        cleanup(hindsightHome)
        cleanup(uvStub)
      }
    })

    // The default mode must report the installed profile when the phase fails.
    step('a default-mode Hindsight failure reports the installed profile', () => {
      const hindsightHome = mkdtempSync(join(tmpRoot, 'installer-hindsight-default-'))
      const uvStub = makeUvStub()
      const exportDir = makeInvalidExport()
      try {
        const failureEnv: NodeJS.ProcessEnv = {
          ...env,
          PATH: `${uvStub};${basePath}`,
          DSH_SETUP_HINDSIGHT_HOME: hindsightHome,
        }
        const args = [
          '-NoProfile',
          '-File',
          join(rootDir, 'install.ps1'),
          '-Profile',
          'ci',
          '-DshHome',
          home,
          '-NoStopApp',
          '-NoRestart',
          '-NoDesktopShortcut',
          '-SetupSpec',
          setupSpec,
          '-SkipVerify',
          '-DeepSeekApiKey',
          'deliberately-invalid',
          '-ExportDir',
          exportDir,
        ]
        if (cli !== undefined) args.push('-DshCli', cli)
        const result = shell(pwsh, args, failureEnv, 240_000)
        const output = `${result.stdout}\n${result.stderr}`
        if (result.status === 0) throw new Error(`the default failure passed\n${output.trim()}`)
        for (const fragment of [
          'The setup profile was installed, but the Hindsight phase failed',
          'not empty and is not a Git repository',
        ]) {
          if (!output.includes(fragment)) {
            throw new Error(`the default failure lacks "${fragment}"\n${output.trim()}`)
          }
        }
        const manifest = readJson<ProfileManifest>(manifestPath)
        if (manifest.dependencies?.['@dsh-setup/setup'] === undefined) {
          throw new Error('the failed run removed the installed setup dependency')
        }
      } finally {
        cleanup(hindsightHome)
        cleanup(uvStub)
        cleanup(exportDir)
      }
    })

    // The phase failure must leave the app restart in the unchanged finally path;
    // a desktop-app fixture is unsafe on a machine that runs the app.
    step('the failed phase keeps the app restart in finally', () => {
      const text = readFileSync(join(rootDir, 'install.ps1'), 'utf8')
      const phaseIndex = text.indexOf('$hindsightStatus = Invoke-HindsightPhase')
      const finallyIndex = text.indexOf('} finally {')
      const restartIndex = text.indexOf('Start-Process -FilePath $launch')
      if (phaseIndex < 0 || finallyIndex <= phaseIndex) {
        throw new Error('the Hindsight phase call is not inside the main try before finally')
      }
      if (restartIndex <= finallyIndex) {
        throw new Error('the app restart is not in the finally block')
      }
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
  shippedBundles: readonly string[],
  gitBundles: readonly string[],
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
      ...shippedBundles,
      ...versions.installBundles.registry,
      ...gitBundles,
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
