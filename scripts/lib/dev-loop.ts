import { homedir } from 'node:os'
import { join } from 'node:path'
import { type Document, isMap, isSeq, parseDocument, type YAMLMap } from 'yaml'
import type { CliResolution } from './cli.ts'
import { SETUP_PACKAGE_NAME, type WorkspacePackage } from './workspace.ts'

/**
 * Pure decisions for the development command.
 *
 * The runner owns processes and files; every choice it makes before touching
 * either is computed here, so the modes, the profile reconciliation, the patch
 * text and the command lines are unit-testable without a Harness install.
 */

/** The profile the development command owns. Never `desktop`. */
export const DEV_PROFILE = 'dev'

/** The shipped profile template a missing development profile is created from. */
export const DEV_TEMPLATE = 'web'

/** Flags the command accepts, named in every usage error. */
export const ACCEPTED_FLAGS = '--plugin <name>, --refresh'

/** The loader patch entry the command owns in the development profile. */
export const HMR_PATCH_ID = 'hmr'

/** The package that supplies the module-watch row. */
export const HMR_PACKAGE = '@deepseek-ai/dsh-hmr'

/** One workspace plugin a contributor can develop. */
export interface DevPlugin {
  /** Package name from its manifest. */
  name: string
  /** Absolute package directory. */
  dir: string
  /** Directory name under `packages/`, accepted as the short form. */
  shortName: string
}

/** The parsed command line. */
export interface DevOptions {
  mode: 'setup' | 'plugin'
  plugin?: string
  refresh: boolean
}

/** Dependencies the command manages when it reconciles a reused profile. */
export function managedNames(plugins: readonly DevPlugin[]): string[] {
  return [SETUP_PACKAGE_NAME, ...plugins.map((plugin) => plugin.name)]
}

/** Map workspace packages to the plugins the command can link. */
export function workspaceDevPlugins(packages: readonly WorkspacePackage[]): DevPlugin[] {
  return packages.map((pkg) => ({
    name: pkg.manifest.name,
    dir: pkg.dir,
    shortName: pkg.relativeDir.replace(/^packages[\\/]/u, ''),
  }))
}

/** Parse the command's own flags; anything else is a usage error. */
export function parseDevArgs(argv: readonly string[]): DevOptions {
  let plugin: string | undefined
  let refresh = false
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? ''
    if (token === '--refresh') {
      refresh = true
      continue
    }
    if (token === '--plugin') {
      const value = argv[index + 1]
      if (value === undefined || value === '' || value.startsWith('-')) {
        throw new Error(`--plugin needs a plugin name; accepted flags: ${ACCEPTED_FLAGS}`)
      }
      plugin = value
      index += 1
      continue
    }
    if (token.startsWith('--plugin=')) {
      const value = token.slice('--plugin='.length)
      if (value === '') {
        throw new Error(`--plugin needs a plugin name; accepted flags: ${ACCEPTED_FLAGS}`)
      }
      plugin = value
      continue
    }
    throw new Error(`unsupported argument "${token}"; accepted flags: ${ACCEPTED_FLAGS}`)
  }
  return plugin === undefined ? { mode: 'setup', refresh } : { mode: 'plugin', plugin, refresh }
}

/** Find one workspace plugin by package name or directory name. */
export function findPlugin(plugins: readonly DevPlugin[], requested: string): DevPlugin {
  const found = plugins.find(
    (plugin) => plugin.name === requested || plugin.shortName === requested,
  )
  if (found === undefined) {
    const accepted = plugins
      .map((plugin) => plugin.shortName)
      .sort()
      .join(', ')
    throw new Error(`unknown plugin "${requested}"; workspace plugins: ${accepted}`)
  }
  return found
}

/** The pnpm spec that links a checkout instead of copying it. */
export function linkSpec(dir: string): string {
  return `link:${dir.replaceAll('\\', '/')}`
}

/** The Harness home the environment selects. */
export function resolveHome(
  env: NodeJS.ProcessEnv,
  fallback: string = join(homedir(), '.dsh'),
): string {
  const configured = env.DSH_HOME?.trim()
  return configured === undefined || configured === '' ? fallback : configured
}

/** Paths of the development profile; `desktop` is refused by name. */
export function devProfilePaths(
  home: string,
  profile: string = DEV_PROFILE,
): { profileDir: string; manifestPath: string; patchPath: string } {
  if (profile.toLowerCase() === 'desktop') {
    throw new Error('profile "desktop" is managed exclusively by the Desktop application')
  }
  const profileDir = join(home, 'profiles', profile)
  return {
    profileDir,
    manifestPath: join(profileDir, 'package.json'),
    patchPath: join(profileDir, 'cordis.patch.yml'),
  }
}

/** The reconciliation a reused profile needs before the requested link is added. */
export interface ReconcilePlan {
  /** Managed dependencies to remove first (each drops its bundle selection too). */
  removals: string[]
  /** The package the requested mode adds. */
  addition: string
}

/** A profile manifest as the mirror reads it. */
export interface MirrorManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/** The selection and dependencies copied from the desktop profile. */
export interface MirrorPlan {
  /** Bundle names to record in the development profile, the requested one last. */
  bundles: string[]
  /** Desktop dependencies the development profile must install too. */
  installs: Array<{ name: string; spec: string }>
}

/**
 * Mirror the desktop profile's selection so the web host mounts the same
 * bundles: keep every desktop bundle except the setup and the plugin names the
 * command manages itself, record the requested package last, and carry the
 * desktop's external dependencies over. Reading is read-only; the desktop
 * profile is never written. `undefined` means the machine has no desktop
 * profile to mirror.
 */
export function mirrorPlan(
  desktop: MirrorManifest | undefined,
  requested: string,
  managed: readonly string[],
): MirrorPlan | undefined {
  if (desktop === undefined) return undefined
  const bundles = (desktop.dsh?.profile?.bundles ?? []).filter(
    (name) => name !== SETUP_PACKAGE_NAME && name !== requested && !managed.includes(name),
  )
  bundles.push(requested)
  const installs = Object.entries(desktop.dependencies ?? {})
    .filter(([name]) => name !== SETUP_PACKAGE_NAME && !managed.includes(name))
    .map(([name, spec]) => ({ name, spec }))
  return { bundles, installs }
}

/** Remove every managed selection the requested mode does not want. */
export function reconcilePlan(
  dependencies: Readonly<Record<string, string>> | undefined,
  bundles: readonly string[] | undefined,
  requested: string,
  managed: readonly string[],
): ReconcilePlan {
  const recorded = new Set([...Object.keys(dependencies ?? {}), ...(bundles ?? [])])
  const removals = managed.filter((name) => name !== requested && recorded.has(name))
  return { removals, addition: requested }
}

function entryText(libDir: string, indent = ''): string {
  const normalized = libDir.replaceAll('\\', '/')
  return [
    `${indent}- id: hmr`,
    `${indent}  name: "@deepseek-ai/dsh-hmr"`,
    `${indent}  config:`,
    `${indent}    root: [${JSON.stringify(normalized)}]`,
  ].join('\n')
}

function flowEntry(libDir: string): string {
  const normalized = libDir.replaceAll('\\', '/')
  return `{ id: hmr, name: "@deepseek-ai/dsh-hmr", config: { root: [${JSON.stringify(normalized)}] } }`
}

function withFinalNewline(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function parsePatch(text: string): Document {
  const document = parseDocument(text)
  if (document.errors.length > 0) {
    throw new Error(
      `the development profile patch is not valid YAML: ${document.errors[0]?.message ?? 'unknown error'}`,
    )
  }
  if (document.contents !== null && !isSeq(document.contents)) {
    throw new Error('the development profile patch is not a YAML array')
  }
  return document
}

/** The source span one top-level entry occupies, including its indicator line. */
interface ItemBounds {
  start: number
  end: number
  indent: string
}

function itemBounds(text: string, item: YAMLMap): ItemBounds {
  const range = item.range
  if (range === undefined || range === null) {
    throw new Error('the development profile patch entry has no source range')
  }
  const lineStart = text.lastIndexOf('\n', range[0] - 1) + 1
  const indicator = /^(\s*)-[ \t]*(?:[&!]\S*[ \t]*)?(?:#.*)?$/u
  const sameLine = indicator.exec(text.slice(lineStart, range[0]))
  if (sameLine !== null) {
    return { start: lineStart, end: range[2], indent: sameLine[1] ?? '' }
  }
  const previousStart = lineStart === 0 ? 0 : text.lastIndexOf('\n', lineStart - 2) + 1
  const previous = lineStart === 0 ? '' : text.slice(previousStart, lineStart - 1)
  const ownLine = indicator.exec(previous)
  if (ownLine !== null) {
    return { start: previousStart, end: range[2], indent: ownLine[1] ?? '' }
  }
  return { start: range[0], end: range[2], indent: '' }
}

/** Remove one item from a flow sequence together with its separator comma. */
function flowRemoval(text: string, item: YAMLMap): string {
  const range = item.range
  if (range === undefined || range === null) {
    throw new Error('the development profile patch entry has no source range')
  }
  const [start, , end] = range
  let next = end
  while (next < text.length && /[ \t\n]/u.test(text[next] ?? '')) next += 1
  if (text[next] === ',') {
    let cut = next + 1
    while (cut < text.length && /[ \t]/u.test(text[cut] ?? '')) cut += 1
    return `${text.slice(0, start)}${text.slice(cut)}`
  }
  let previous = start - 1
  while (previous >= 0 && /[ \t\n]/u.test(text[previous] ?? '')) previous -= 1
  if (text[previous] === ',') return `${text.slice(0, previous)}${text.slice(end)}`
  return `${text.slice(0, start)}${text.slice(end)}`
}

function removeBlock(text: string, item: YAMLMap): string {
  const bounds = itemBounds(text, item)
  return `${text.slice(0, bounds.start)}${text.slice(bounds.end)}`
}

function replaceBlock(text: string, item: YAMLMap, entry: string): string {
  const bounds = itemBounds(text, item)
  const after = text.slice(bounds.end)
  const glue = after === '' || after.startsWith('\n') ? '' : '\n'
  return withFinalNewline(`${text.slice(0, bounds.start)}${entry}${glue}${after}`)
}

/**
 * Rewrite the development profile patch by touching only the entry the
 * command owns, `id: hmr` naming the module-watch package.
 *
 * The edit is source-preserving on purpose: a YAML parse/stringify round trip
 * would turn Harness `!!js` expressions in unrelated entries into plain
 * strings. The source ranges come from the parsed document, so block and flow
 * sequences, inline comments, and an indicator on its own line are handled
 * without reserializing anything the command does not own.
 */
export function patchText(
  existing: string | undefined,
  mode: 'setup' | 'plugin',
  plugin?: { libDir: string },
): string {
  const text = (existing ?? '').replaceAll('\r\n', '\n')
  const document = parsePatch(text)
  const sequence = isSeq(document.contents) ? document.contents : undefined
  const flow = sequence?.flow === true
  const owned = sequence?.items.find(
    (item) => isMap(item) && item.get('id') === HMR_PATCH_ID && item.get('name') === HMR_PACKAGE,
  )

  if (mode === 'setup') {
    if (owned === undefined || !isMap(owned)) return text.trim() === '' ? '[]\n' : text
    const result = flow ? flowRemoval(text, owned) : removeBlock(text, owned)
    // An empty file is not a patch list: the boot rejects a null document.
    return result.trim() === '' ? '[]\n' : withFinalNewline(result)
  }

  const libDir = plugin?.libDir
  if (libDir === undefined) throw new Error('plugin mode needs the linked package build directory')

  if (owned !== undefined && isMap(owned)) {
    if (flow) {
      const range = owned.range
      if (range === undefined || range === null) {
        throw new Error('the development profile patch entry has no source range')
      }
      return withFinalNewline(
        `${text.slice(0, range[0])}${flowEntry(libDir)}${text.slice(range[2])}`,
      )
    }
    return replaceBlock(text, owned, entryText(libDir, itemBounds(text, owned).indent))
  }

  if (sequence !== undefined && flow && sequence.items.length > 0) {
    const close = (sequence.range?.[1] ?? text.length) - 1
    if (close < 0) throw new Error('the development profile patch has no source range')
    const last = sequence.items[sequence.items.length - 1]
    const lastRange = (last as { range?: [number, number, number] | null } | undefined)?.range
    const lastEnd = lastRange?.[2] ?? close
    // A comma inside a trailing comment is not a YAML separator.
    let separator = ', '
    let comment = false
    for (let index = lastEnd; index < close; index += 1) {
      const character = text[index] ?? ''
      if (comment) {
        if (character === '\n') comment = false
        continue
      }
      if (character === '#') {
        comment = true
        continue
      }
      if (character === ',') {
        separator = ' '
        break
      }
    }
    return withFinalNewline(
      `${text.slice(0, close)}${separator}${flowEntry(libDir)}${text.slice(close)}`,
    )
  }

  if (sequence !== undefined && sequence.items.length > 0) {
    const first = sequence.items[0]
    const indent = first !== undefined && isMap(first) ? itemBounds(text, first).indent : ''
    const end = sequence.range?.[2] ?? text.length
    const before = text.slice(0, end)
    const after = text.slice(end)
    const separator = before.endsWith('\n') ? '' : '\n'
    return `${before}${separator}${entryText(libDir, indent)}\n${after}`
  }

  if (sequence !== undefined) {
    const range = sequence.range
    if (range === undefined || range === null) {
      throw new Error('the development profile patch has no source range')
    }
    const [start, end] = range
    const after = text.slice(end)
    const entry = entryText(libDir)
    const insertion = after.startsWith('\n') ? entry : `${entry}\n`
    return withFinalNewline(`${text.slice(0, start)}${insertion}${after}`)
  }

  const separator = text === '' || text.endsWith('\n') ? '' : '\n'
  return `${text}${separator}${entryText(libDir)}\n`
}

/** Launcher arguments that boot the development host without opening a browser. */
export function hostArgs(profile: string = DEV_PROFILE): string[] {
  return ['--profile', profile, '--no-open']
}

/** Launcher arguments that create the profile from the shipped template and exit. */
export function initArgs(profile: string = DEV_PROFILE): string[] {
  return ['--profile', profile, '--from-default-profile', DEV_TEMPLATE, '--dump-config']
}

/** Arguments that link the requested package into the profile. */
export function installArgs(profile: string, spec: string): string[] {
  return ['plugin', '--profile', profile, 'add', spec]
}

/** Arguments that remove a managed dependency and its selection. */
export function removeArgs(profile: string, name: string): string[] {
  return ['plugin', '--profile', profile, 'remove', name]
}

/** The operator-facing line that names the resolved Harness and its version. */
export function cliDisplay(resolution: CliResolution, version?: string): string {
  const suffix =
    version === undefined || version.trim() === '' ? '' : ` (version ${version.trim()})`
  return `Harness CLI (${resolution.source}): ${resolution.commandLine}${suffix}`
}

/**
 * The text a Host rebuild appends so HMR recomposes. It is a standalone comment
 * line: a patch whose last line carries no final newline keeps its value.
 */
export function recompositionTrigger(existing: string, counter: number): string {
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  return `${separator}# dev rebuild ${String(counter)}\n`
}

/** What a set of rebuilt artifacts requires. */
export type ArtifactClass = 'client' | 'host' | 'both' | 'none'

/** Classify changed build outputs; type declarations and maps need nothing. */
export function classifyArtifacts(paths: readonly string[]): ArtifactClass {
  let client = false
  let host = false
  for (const path of paths) {
    const normalized = path.replaceAll('\\', '/')
    if (!normalized.includes('/lib/')) continue
    // The browser bundle is exactly the package's lib/client.js; a nested
    // module that happens to share the name is Host code.
    if (/(?:^|\/)lib\/client\.js$/u.test(normalized)) client = true
    else if (normalized.endsWith('.js')) host = true
  }
  if (client && host) return 'both'
  if (client) return 'client'
  if (host) return 'host'
  return 'none'
}
