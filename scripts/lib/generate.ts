import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parse, stringify } from 'yaml'
import { ADAPTER_ROW_NAMES, type FragmentRow } from './fragments.ts'
import type { DshVersions, PackageManifest, WorkspacePackage } from './workspace.ts'
import { SETUP_PACKAGE_NAME, setupDir } from './workspace.ts'

/** One owner-defaults entry: a shipped row id plus its complete configuration. */
export interface DefaultsEntry {
  id: string
  config: Record<string, unknown>
}

/** Generated files are addressed absolutely so drift checks compare one namespace. */
export type GeneratedFiles = Map<string, Buffer>

/** Relative path of the generated setup bundle patch. */
export const SETUP_PATCH_FILE = join(setupDir, 'cordis.patch.yml')

/** Relative path of the generated setup manifest. */
export const SETUP_MANIFEST_FILE = join(setupDir, 'package.json')

/** Relative path of the vendored plugin copies inside the setup bundle. */
export const SETUP_VENDOR_DIR = join(setupDir, 'node_modules')

const ROW_PREFIX = 'dsh-setup-'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function header(lines: string[]): string {
  return `${lines.map((line) => (line === '' ? '#' : `# ${line}`)).join('\n')}\n`
}

/** Render one YAML patch list. `yaml.stringify` owns quoting and indentation. */
function renderPatchBody(entries: unknown[]): string {
  return stringify(entries, { indent: 2, lineWidth: 0, minContentWidth: 0 })
}

/** Render a package's own bundle patch from its fragment rows. */
export function renderBundlePatch(rows: FragmentRow[]): string {
  return (
    header([
      `Generated from cordis.fragment.yml by scripts/generate.ts; do not edit.`,
      `Bundle layer for ${rows[0]?.name ?? 'this package'}.`,
    ]) + renderPatchBody([{ insert: rows }])
  )
}

/** Render the aggregated setup bundle patch: every plugin row, then owner defaults. */
export function renderSetupPatch(rows: FragmentRow[], defaults: DefaultsEntry[]): string {
  return (
    header([
      'Generated from every package cordis.fragment.yml and defaults.yml by',
      'scripts/generate.ts; do not edit. Run `pnpm gen` after changing a fragment',
      'or a default.',
      '',
      'Layer order: all plugin rows mount first, then owner defaults override the',
      'shipped rows they name. A profile cordis.patch.yml still outranks this layer.',
    ]) + renderPatchBody([{ insert: rows }, ...defaults])
  )
}

/** Read and validate the owner-defaults document. */
export function parseDefaults(text: string): DefaultsEntry[] {
  const document: unknown = parse(text)
  if (!Array.isArray(document)) throw new Error('defaults.yml must be a YAML array')
  const seen = new Set<string>()
  return document.map((entry: unknown, index: number) => {
    const at = `defaults[${index}]`
    if (!isRecord(entry)) throw new Error(`${at} must be a mapping`)
    for (const key of Object.keys(entry)) {
      if (key !== 'id' && key !== 'config') throw new Error(`${at}: unknown field "${key}"`)
    }
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw new Error(`${at}.id must be a non-empty string`)
    }
    if (entry.id.startsWith(ROW_PREFIX)) {
      throw new Error(`${at}.id "${entry.id}" uses the reserved plugin row prefix`)
    }
    if (seen.has(entry.id)) throw new Error(`${at}.id "${entry.id}" is not unique`)
    seen.add(entry.id)
    if (!isRecord(entry.config)) throw new Error(`${at}.config must be a mapping`)
    return { id: entry.id, config: entry.config }
  })
}

/** Build the setup bundle manifest from the plugin packages it vendors. */
export function buildSetupManifest(
  plugins: PackageManifest[],
  version: string,
  versions: DshVersions,
): PackageManifest {
  const dependencies: Record<string, string> = {}
  // pnpm does not install dependencies of bundled packages, so each plugin's
  // runtime dependencies must be hoisted into the setup's own dependency set.
  const runtime = new Map<string, string>()
  for (const plugin of plugins) {
    for (const [name, range] of Object.entries(plugin.dependencies ?? {})) {
      if (name === plugin.name) continue
      const existing = runtime.get(name)
      if (existing !== undefined && existing !== range) {
        throw new Error(`conflicting runtime dependency ${name}: "${existing}" vs "${range}"`)
      }
      runtime.set(name, range)
    }
  }
  const bundled: string[] = []
  for (const plugin of [...plugins].sort((left, right) => left.name.localeCompare(right.name))) {
    dependencies[plugin.name] = plugin.version
    bundled.push(plugin.name)
  }
  for (const [name, range] of [...runtime].sort(([left], [right]) => left.localeCompare(right))) {
    dependencies[name] = range
  }
  return {
    name: SETUP_PACKAGE_NAME,
    version,
    license: 'MIT',
    description:
      'The full portable DeepSeek Harness setup: every plugin bundle plus owner defaults, installed as one bundle',
    icon: './icon.svg',
    files: ['cordis.patch.yml', 'defaults.yml', 'icon.svg', 'locale/*.json'],
    engines: { dsh: versions.enginesDsh },
    dependencies,
    bundleDependencies: bundled,
    dsh: {
      manifestVersion: 1,
      bundle: { patch: './cordis.patch.yml' },
    },
  }
}

/**
 * Check a setup manifest against the plugin packages the workspace contains.
 * The generator regenerates the manifest wholesale, so drift is normally caught
 * by comparing bytes; this check reports the semantic cause first.
 */
export function validateSetupManifest(
  manifest: PackageManifest,
  plugins: PackageManifest[],
): string[] {
  const problems: string[] = []
  const expected = new Map(plugins.map((plugin) => [plugin.name, plugin.version]))
  const runtime = new Map<string, string>()
  for (const plugin of plugins) {
    for (const [name, range] of Object.entries(plugin.dependencies ?? {})) {
      if (expected.has(name) || name === plugin.name) continue
      const existing = runtime.get(name)
      if (existing !== undefined && existing !== range) {
        problems.push(`conflicting runtime dependency ${name}: "${existing}" vs "${range}"`)
        continue
      }
      runtime.set(name, range)
    }
  }

  if (manifest.name !== SETUP_PACKAGE_NAME) {
    problems.push(`name must be ${SETUP_PACKAGE_NAME}`)
  }
  for (const [name, version] of expected) {
    const declared = manifest.dependencies?.[name]
    if (declared === undefined) problems.push(`missing dependency ${name}`)
    else if (declared !== version) {
      problems.push(`dependency ${name} is "${declared}", expected exact "${version}"`)
    }
  }
  for (const [name, range] of runtime) {
    const declared = manifest.dependencies?.[name]
    if (declared === undefined) problems.push(`missing runtime dependency ${name}`)
    else if (declared !== range) {
      problems.push(`runtime dependency ${name} is "${declared}", expected "${range}"`)
    }
  }
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    if (!expected.has(name) && !runtime.has(name)) problems.push(`unexpected dependency ${name}`)
  }
  const bundled = new Set(manifest.bundleDependencies ?? [])
  for (const name of expected.keys()) {
    if (!bundled.has(name)) problems.push(`missing bundleDependency ${name}`)
  }
  for (const name of bundled) {
    if (!expected.has(name)) problems.push(`unexpected bundleDependency ${name}`)
  }
  return problems
}

/** Check a vendorable file against the package's declared `files` list. */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`)
}

/** Read the vendorable files of one plugin package, expanding its simple `files` globs. */
export function readPluginFiles(
  pkg: WorkspacePackage,
  skip: ReadonlySet<string> = new Set(),
): Array<{ path: string; content: Buffer }> {
  const collected: Array<{ path: string; content: Buffer }> = []
  const add = (relativePath: string): void => {
    if (skip.has(relativePath)) return
    const absolute = join(pkg.dir, relativePath)
    if (!statSync(absolute, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`${pkg.relativeDir}: declared file "${relativePath}" does not exist`)
    }
    collected.push({ path: relativePath, content: readFileSync(absolute) })
  }

  for (const pattern of pkg.manifest.files ?? []) {
    if (pattern.includes('node_modules')) continue
    if (!pattern.includes('*')) {
      add(pattern)
      continue
    }
    const slash = pattern.lastIndexOf('/')
    const directory = slash === -1 ? '.' : pattern.slice(0, slash)
    const namePattern = pattern.slice(slash + 1)
    const matcher = globToRegExp(namePattern)
    const matches = readdirSync(join(pkg.dir, directory)).filter((name) => matcher.test(name))
    if (matches.length === 0) {
      throw new Error(`${pkg.relativeDir}: files pattern "${pattern}" matched nothing`)
    }
    for (const name of matches) add(join(directory, name))
  }
  return collected
}

/** Read every file of a runtime dependency package, skipping nested node_modules. */
function readPackageFiles(directory: string): Array<{ path: string; content: Buffer }> {
  const collected: Array<{ path: string; content: Buffer }> = []
  const walk = (relativeDir: string): void => {
    for (const entry of readdirSync(join(directory, relativeDir), { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue
      const path = relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile())
        collected.push({ path, content: readFileSync(join(directory, path)) })
    }
  }
  walk('')
  return collected
}

/** Compose every generated artifact: plugin patches, the setup patch, manifest, and vendored copies. */
export function computeGenerated(
  pluginRows: Array<{ pkg: WorkspacePackage; rows: FragmentRow[] }>,
  defaults: DefaultsEntry[],
  setupVersion: string,
  versions: DshVersions,
): GeneratedFiles {
  const files: GeneratedFiles = new Map()
  const allRows: FragmentRow[] = []
  const rowIds = new Set<string>()

  for (const { pkg, rows } of pluginRows) {
    for (const row of rows) {
      if (row.name !== pkg.manifest.name && !ADAPTER_ROW_NAMES.has(row.name)) {
        throw new Error(
          `${pkg.relativeDir}: adapter row "${row.id}" names "${row.name}", which is not an approved adapter target`,
        )
      }
    }
    files.set(join(pkg.dir, 'cordis.patch.yml'), Buffer.from(renderBundlePatch(rows), 'utf8'))
    for (const row of rows) {
      if (rowIds.has(row.id)) throw new Error(`duplicate row id "${row.id}" in ${pkg.relativeDir}`)
      rowIds.add(row.id)
      allRows.push(row)
    }
    const vendored: Array<{ path: string; content: Buffer }> = [
      { path: 'package.json', content: Buffer.from(JSON.stringify(pkg.manifest, null, 2) + '\n') },
      ...readPluginFiles(pkg, new Set(['cordis.patch.yml'])),
      { path: 'cordis.patch.yml', content: Buffer.from(renderBundlePatch(rows), 'utf8') },
    ]
    for (const file of vendored) {
      files.set(join(SETUP_VENDOR_DIR, pkg.manifest.name, file.path), file.content)
    }
  }

  // The vendored plugin copies cannot resolve their own dependencies from the
  // setup's node_modules, so small runtime dependency trees are vendored beside
  // them. @openai/codex is installed by the profile instead: its platform binary
  // is not committed and must come from the registry.
  const runtimeDependencies = new Map<string, string>()
  const storeCandidates = (name: string): string[] => {
    const store = join('node_modules', '.pnpm')
    if (!statSync(store, { throwIfNoEntry: false })?.isDirectory()) return []
    const prefix = `${name.replace('/', '+')}@`
    return readdirSync(store)
      .filter((entry) => entry.startsWith(prefix))
      .map((entry) => join(store, entry, 'node_modules', name))
  }
  const addRuntimeDependency = (name: string, candidates: string[], origin: string): void => {
    if (runtimeDependencies.has(name)) return
    const directory = [...candidates, ...storeCandidates(name)].find((candidate) =>
      statSync(candidate, { throwIfNoEntry: false })?.isDirectory(),
    )
    if (directory === undefined) {
      throw new Error(`${origin}: runtime dependency ${name} is not installed; run pnpm install`)
    }
    const resolved = realpathSync(directory)
    runtimeDependencies.set(name, resolved)
    const manifest = JSON.parse(
      readFileSync(join(resolved, 'package.json'), 'utf8'),
    ) as PackageManifest
    for (const child of Object.keys(manifest.dependencies ?? {})) {
      if (child.startsWith('@openai/')) continue
      addRuntimeDependency(
        child,
        [
          join(dirname(resolved), child),
          join(resolved, 'node_modules', child),
          join('node_modules', child),
        ],
        `${origin} -> ${name}`,
      )
    }
  }
  for (const { pkg } of pluginRows) {
    for (const name of Object.keys(pkg.manifest.dependencies ?? {})) {
      if (name.startsWith('@openai/')) continue
      addRuntimeDependency(
        name,
        [join(pkg.dir, 'node_modules', name), join('node_modules', name)],
        pkg.relativeDir,
      )
    }
  }
  for (const [name, directory] of [...runtimeDependencies].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    for (const file of readPackageFiles(directory)) {
      files.set(join(SETUP_VENDOR_DIR, name, file.path), file.content)
    }
  }

  files.set(SETUP_PATCH_FILE, Buffer.from(renderSetupPatch(allRows, defaults), 'utf8'))
  files.set(
    SETUP_MANIFEST_FILE,
    Buffer.from(
      JSON.stringify(
        buildSetupManifest(
          pluginRows.map(({ pkg }) => pkg.manifest),
          setupVersion,
          versions,
        ),
        null,
        2,
      ) + '\n',
      'utf8',
    ),
  )

  return files
}

export interface DriftReport {
  missing: string[]
  changed: string[]
  unexpected: string[]
}

function walkFiles(directory: string): string[] {
  if (!statSync(directory, { throwIfNoEntry: false })?.isDirectory()) return []
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...walkFiles(absolute))
    else if (entry.isFile()) found.push(absolute)
  }
  return found
}

/**
 * Compare generated content with the working tree.
 * Every file under `scanRoots` that is not expected counts as unexpected, so a
 * removed plugin cannot leave a stale vendored package behind.
 */
export function diffGenerated(expected: GeneratedFiles, scanRoots: string[]): DriftReport {
  const report: DriftReport = { missing: [], changed: [], unexpected: [] }
  for (const [path, content] of expected) {
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
      report.missing.push(path)
      continue
    }
    if (!readFileSync(path).equals(content)) report.changed.push(path)
  }
  const unexpected = new Set<string>()
  for (const root of scanRoots) {
    for (const file of walkFiles(root)) if (!expected.has(file)) unexpected.add(file)
  }
  report.unexpected = [...unexpected].sort()
  report.missing.sort()
  report.changed.sort()
  return report
}

/** Write every generated file, then remove vendored files the generation no longer lists. */
export function writeGenerated(expected: GeneratedFiles): number {
  for (const [path, content] of expected) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  for (const file of walkFiles(SETUP_VENDOR_DIR)) {
    if (!expected.has(file)) rmSync(file)
  }
  return expected.size
}

/** Path reported relative to the repository root. */
export function displayPath(path: string): string {
  return relative(resolve(setupDir, '..', '..'), path).replaceAll('\\', '/')
}
