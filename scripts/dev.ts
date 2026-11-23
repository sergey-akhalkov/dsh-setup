import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import type { Dirent } from 'node:fs'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { checkCli, cliSpawnLine, resolveDshCli } from './lib/cli.ts'
import {
  classifyArtifacts,
  cliDisplay,
  DEV_PROFILE,
  devProfilePaths,
  findPlugin,
  hostArgs,
  initArgs,
  installArgs,
  linkSpec,
  managedNames,
  mirrorPlan,
  parseDevArgs,
  patchText,
  recompositionTrigger,
  reconcilePlan,
  removeArgs,
  resolveHome,
  workspaceDevPlugins,
} from './lib/dev-loop.ts'
import {
  listPluginPackages,
  readDshVersions,
  readJson,
  rootDir,
  SETUP_PACKAGE_NAME,
  setupDir,
  type WorkspacePackage,
} from './lib/workspace.ts'

/**
 * Development host runner.
 *
 * See `dev-loop.ts` for every pure decision. This module owns the processes and
 * the profile files: one CLI launcher, one build watcher, one host child, the
 * vendored refresh in setup mode, and cleanup by verified ownership only.
 */

const POLL_INTERVAL_MS = 500
const GEN_DEBOUNCE_MS = 300

/** One child the runner started, with its observed exit state. */
interface OwnedChild {
  child: ChildProcess
  label: string
  pid: number | undefined
  exited: boolean
  exitCode: number | null
  /** Set when the runner asked this child to stop; its exit is then expected. */
  requested: boolean
}

/** Options the runner needs; every path is injectable for the tests. */
export interface DevRunOptions {
  argv: readonly string[]
  env: NodeJS.ProcessEnv
  cwd: string
  home?: string
  packages?: WorkspacePackage[]
  runtimeVersion?: string
  setupPackageDir?: string
  genCommand?: string
  watcherCommand?: string
  log?: (line: string) => void
  signal?: AbortSignal
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCommand(line: string, cwd: string, env: NodeJS.ProcessEnv): CommandResult {
  const result = spawnSync(line, {
    shell: true,
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

function detail(result: CommandResult): string {
  const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
  const line = text
    .split('\n')
    .filter((entry) => entry.trim() !== '')
    .slice(-1)[0]
  return line === undefined ? `exit ${String(result.status)}` : line
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Timestamps of every build artifact under one package's `lib`, at any depth. */
export function artifactSnapshot(packages: readonly WorkspacePackage[]): Map<string, number> {
  const snapshot = new Map<string, number>()
  const collect = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) {
        collect(file)
        continue
      }
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.d.ts')) continue
      try {
        snapshot.set(file, statSync(file).mtimeMs)
      } catch {
        // A file that disappeared between the listing and the stat is simply absent.
      }
    }
  }
  for (const pkg of packages) collect(join(pkg.dir, 'lib'))
  return snapshot
}

/** Files whose timestamp or presence changed between two snapshots. */
export function changedArtifacts(
  before: ReadonlyMap<string, number>,
  after: ReadonlyMap<string, number>,
): string[] {
  const changed: string[] = []
  for (const [file, mtime] of after) {
    if (before.get(file) !== mtime) changed.push(file)
  }
  return changed
}

function killTree(owned: OwnedChild): boolean {
  const pid = owned.pid
  if (owned.exited || pid === undefined) return false
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    return result.status === 0
  }
  try {
    process.kill(-pid, 'SIGKILL')
    return true
  } catch {
    return false
  }
}

/** Run the development loop until the host exits or the caller aborts. */
export async function runDev(options: DevRunOptions): Promise<number> {
  const log = options.log ?? ((line: string) => console.log(line))
  const env = options.env
  const cwd = options.cwd
  const parsed = parseDevArgs(options.argv)
  const home = options.home ?? resolveHome(env)
  const paths = devProfilePaths(home)
  const packages = options.packages ?? listPluginPackages()
  const plugins = workspaceDevPlugins(packages)
  const runtimeVersion = options.runtimeVersion ?? readDshVersions().runtime
  const setupPackageDir = options.setupPackageDir ?? setupDir
  const genCommand = options.genCommand ?? 'pnpm gen'
  const watcherCommand = options.watcherCommand ?? 'pnpm build:watch'

  const target =
    parsed.mode === 'plugin'
      ? (() => {
          const plugin = findPlugin(plugins, parsed.plugin ?? '')
          return { name: plugin.name, spec: linkSpec(plugin.dir), libDir: join(plugin.dir, 'lib') }
        })()
      : { name: SETUP_PACKAGE_NAME, spec: linkSpec(setupPackageDir), libDir: undefined }

  // A wrapping CLI writes its shim below the Harness home, which may not exist yet.
  mkdirSync(home, { recursive: true })
  const cli = resolveDshCli(runtimeVersion, { home, env })
  const probe = checkCli(cli, (line) => {
    const result = runCommand(line, cwd, env)
    return { status: result.status, stdout: result.stdout, stderr: result.stderr }
  })
  if (!probe.ok) {
    log(probe.message)
    return 1
  }
  log(cliDisplay(cli, probe.version))

  const manifestExists = existsSync(paths.manifestPath)
  if (!manifestExists || parsed.refresh) {
    if (manifestExists) log(`replacing the ${DEV_PROFILE} profile from the shipped template`)
    const init = runCommand(cliSpawnLine(cli, initArgs()), cwd, env)
    if (init.status !== 0) {
      log(`cannot create the ${DEV_PROFILE} profile: ${detail(init)}`)
      return 1
    }
  }

  const manifest = readJson<{
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }>(paths.manifestPath)
  const plan = reconcilePlan(
    manifest.dependencies,
    manifest.dsh?.profile?.bundles,
    target.name,
    managedNames(plugins),
  )
  for (const name of plan.removals) {
    log(`removing ${name} from the ${DEV_PROFILE} profile`)
    const removal = runCommand(cliSpawnLine(cli, removeArgs(DEV_PROFILE, name)), cwd, env)
    if (removal.status !== 0) {
      log(`cannot remove ${name}: ${detail(removal)}`)
      return 1
    }
  }

  log(`linking ${target.name} from the checkout`)
  const install = runCommand(cliSpawnLine(cli, installArgs(DEV_PROFILE, target.spec)), cwd, env)
  if (install.status !== 0) {
    log(`cannot link ${target.name}: ${detail(install)}`)
    return 1
  }

  // Mirror the desktop profile's selection so the web host mounts the same
  // bundles. The desktop profile is read only; it is never written here.
  const desktopDir = join(home, 'profiles', 'desktop')
  const desktopManifestPath = join(desktopDir, 'package.json')
  const desktopPatchPath = join(desktopDir, 'cordis.patch.yml')
  const desktop = existsSync(desktopManifestPath)
    ? readJson<{
        dependencies?: Record<string, string>
        dsh?: { profile?: { bundles?: string[] } }
      }>(desktopManifestPath)
    : undefined
  const mirror = mirrorPlan(desktop, target.name, managedNames(plugins))
  if (mirror !== undefined) {
    log(`mirroring the desktop profile selection (${String(mirror.bundles.length)} bundles)`)
    const current = readJson<{
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }>(paths.manifestPath)
    current.dsh = current.dsh ?? {}
    current.dsh.profile = current.dsh.profile ?? {}
    current.dsh.profile.bundles = mirror.bundles
    writeFileSync(paths.manifestPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8')
    for (const entry of mirror.installs) {
      if (current.dependencies?.[entry.name] === entry.spec) continue
      const added = runCommand(cliSpawnLine(cli, installArgs(DEV_PROFILE, entry.spec)), cwd, env)
      if (added.status !== 0) {
        log(`cannot install ${entry.name}: ${detail(added)}`)
        return 1
      }
    }
  }

  const existingPatch = existsSync(paths.patchPath)
    ? readFileSync(paths.patchPath, 'utf8')
    : undefined
  const desktopPatch = existsSync(desktopPatchPath)
    ? readFileSync(desktopPatchPath, 'utf8')
    : undefined
  const patchBase = desktopPatch ?? existingPatch
  const patch =
    parsed.mode === 'plugin'
      ? patchText(patchBase, 'plugin', { libDir: target.libDir ?? join(home, 'lib') })
      : patchText(patchBase, 'setup')
  if (patch !== existingPatch) writeFileSync(paths.patchPath, patch, 'utf8')

  if (parsed.mode === 'setup') {
    // The linked setup loads the vendored tree, so refresh it before the host boots.
    const gen = runCommand(genCommand, cwd, env)
    if (gen.status !== 0) {
      log(`pnpm gen failed: ${detail(gen)}`)
      return 1
    }
  }

  const children: OwnedChild[] = []
  let host: OwnedChild | undefined
  let hostExit: number | null | undefined
  let stopped = false
  let interrupted = false
  let restarting = false
  let genTimer: ReturnType<typeof setTimeout> | undefined
  let resolveDone: () => void = () => {}
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })

  const start = (line: string, label: string): OwnedChild => {
    const child = spawn(line, {
      shell: true,
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    const owned: OwnedChild = {
      child,
      label,
      pid: child.pid,
      exited: false,
      exitCode: null,
      requested: false,
    }
    let stdoutBuffer = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line_ of lines) {
        if (line_.trim() === '') continue
        log(`${label}: ${line_}`)
        const url = /dsh web: (http\S+)/u.exec(line_)
        if (url !== null) log(`development page: ${url[1] ?? ''}`)
      }
    })
    child.stdout?.on('end', () => {
      if (stdoutBuffer.trim() !== '') log(`${label}: ${stdoutBuffer}`)
      stdoutBuffer = ''
    })
    let stderrBuffer = ''
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderrBuffer += chunk
      const lines = stderrBuffer.split('\n')
      stderrBuffer = lines.pop() ?? ''
      for (const line_ of lines) {
        if (line_.trim() !== '') log(`${label}: ${line_}`)
      }
    })
    child.on('exit', (code) => {
      owned.exited = true
      owned.exitCode = code
      if (owned === host && !restarting && hostExit === undefined) {
        stopped = true
        hostExit = code
        resolveDone()
      }
    })
    children.push(owned)
    return owned
  }

  const startHost = (): void => {
    host = start(cliSpawnLine(cli, hostArgs()), 'host')
  }

  const restartHost = (): void => {
    if (stopped) return
    const previous = host
    if (previous !== undefined && !previous.exited) {
      restarting = true
      previous.requested = true
      const killed = killTree(previous)
      restarting = false
      if (!killed) {
        previous.requested = false
        log(
          `cannot terminate the previous host (pid ${String(previous.pid)}); keeping it and not starting a replacement`,
        )
        return
      }
    }
    startHost()
  }

  startHost()
  start(watcherCommand, 'build')

  const onAbort = (): void => {
    if (stopped) return
    interrupted = true
    stopped = true
    resolveDone()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  let snapshot = artifactSnapshot(packages)
  let rebuildCounter = 0
  const poll = async (): Promise<void> => {
    while (!stopped) {
      await delay(POLL_INTERVAL_MS)
      if (stopped) break
      const next = artifactSnapshot(packages)
      const changed = changedArtifacts(snapshot, next)
      if (changed.length === 0) continue
      snapshot = next
      if (genTimer !== undefined) clearTimeout(genTimer)
      genTimer = setTimeout(() => {
        genTimer = undefined
        if (stopped) return
        void (async () => {
          const kind = classifyArtifacts(changed)
          if (kind === 'none' || stopped) return
          if (parsed.mode === 'setup') {
            const gen = runCommand(genCommand, cwd, env)
            if (gen.status !== 0) {
              log(`pnpm gen failed: ${detail(gen)}`)
              return
            }
          }
          if (kind === 'client') {
            log('client bundle refreshed; the open page swaps without a restart')
            return
          }
          // The module watch is configured for carriers that deliver it; a real
          // profile-patch write applies the change in place on every carrier.
          rebuildCounter += 1
          try {
            const current = readFileSync(paths.patchPath, 'utf8')
            appendFileSync(paths.patchPath, recompositionTrigger(current, rebuildCounter), 'utf8')
            log('host rebuild detected; the profile recomposition applies it in place')
          } catch (error) {
            log(
              `cannot trigger the profile recomposition (${error instanceof Error ? error.message : String(error)}); restarting the development host`,
            )
            restartHost()
          }
        })()
      }, GEN_DEBOUNCE_MS)
    }
  }
  void poll()

  await done
  stopped = true
  if (genTimer !== undefined) {
    clearTimeout(genTimer)
    genTimer = undefined
  }

  let unconfirmed = false
  for (const owned of children) {
    const pid = String(owned.pid)
    if (owned.exited) {
      if (!owned.requested) {
        unconfirmed = true
        log(
          `${owned.label} (pid ${pid}) had already exited; its process tree could not be confirmed terminated`,
        )
      }
      continue
    }
    owned.requested = true
    if (!killTree(owned)) {
      unconfirmed = true
      log(`could not terminate ${owned.label} (pid ${pid})`)
    }
  }

  for (const owned of children) {
    owned.child.stdout?.destroy()
    owned.child.stderr?.destroy()
    owned.child.unref()
  }

  if (interrupted) {
    log(
      unconfirmed
        ? 'development host stopped with unconfirmed cleanup'
        : 'development host stopped',
    )
    return 130
  }

  log(`the host exited with code ${String(hostExit)}`)
  return 1
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  const controller = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => controller.abort())
  }
  try {
    process.exitCode = await runDev({
      argv: process.argv.slice(2),
      env: process.env,
      cwd: rootDir,
      signal: controller.signal,
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
  }
}
