import { createHash } from 'node:crypto'
import { parse } from 'yaml'

/**
 * Pure metadata and validation helpers for the vendored OpenSpec core skills.
 *
 * The update script, the provenance test, and the plugin package all agree on
 * these names and rules, so an upstream generation that no longer matches the
 * expected shape fails loudly instead of producing a broken catalog.
 */

/** Upstream repository the generated skills are pinned from. */
export const OPENSPEC_REPOSITORY = 'https://github.com/Fission-AI/OpenSpec'

/** npm package that generates the skills. */
export const OPENSPEC_PACKAGE = '@fission-ai/openspec'

/** Package-relative directory holding the generated skills and the license. */
export const OPENSPEC_ASSETS_DIRECTORY = 'assets/openspec'

/** Package-relative provenance document written by the update script. */
export const OPENSPEC_LOCK_FILE = 'openspec.lock.json'

/** Vendored upstream license file name inside {@link OPENSPEC_ASSETS_DIRECTORY}. */
export const OPENSPEC_LICENSE_FILE = 'LICENSE'

/** Generator invocation recorded in the lock; the update script runs exactly this. */
export const OPENSPEC_GENERATOR_COMMAND = 'openspec init --tools dsh --profile core'

/** Generator profile recorded in the lock. */
export const OPENSPEC_GENERATOR_PROFILE = 'core'

/** Workflows the core profile installs, in upstream order. */
export const OPENSPEC_CORE_WORKFLOWS = [
  'propose',
  'explore',
  'apply',
  'update',
  'sync',
  'archive',
] as const

export type OpenSpecWorkflow = (typeof OPENSPEC_CORE_WORKFLOWS)[number]

/** One packaged skill and the core workflow that renders it. */
export interface OpenSpecSkillDefinition {
  name: string
  workflow: OpenSpecWorkflow
}

/** The six core skills, sorted by catalog name. */
export const OPENSPEC_SKILLS: readonly OpenSpecSkillDefinition[] = [
  { name: 'openspec-apply-change', workflow: 'apply' },
  { name: 'openspec-archive-change', workflow: 'archive' },
  { name: 'openspec-explore', workflow: 'explore' },
  { name: 'openspec-propose', workflow: 'propose' },
  { name: 'openspec-sync-specs', workflow: 'sync' },
  { name: 'openspec-update-change', workflow: 'update' },
]

/** Catalog names in the order the lock records them. */
export const OPENSPEC_SKILL_NAMES: readonly string[] = OPENSPEC_SKILLS.map((skill) => skill.name)

/** Size ceilings keep a runaway generated file from silently bloating the bundle. */
export const OPENSPEC_MAX_SKILL_BYTES = 64 * 1024
export const OPENSPEC_MAX_LICENSE_BYTES = 16 * 1024

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** Error raised when a generated file or a lock does not match the expected shape. */
export class OpenSpecError extends Error {
  constructor(message: string) {
    super(`openspec: ${message}`)
    this.name = 'OpenSpecError'
  }
}

/** Immutable upstream identity recorded in the provenance document. */
export interface OpenSpecUpstream {
  repository: string
  version: string
  tag: string
  commit: string
  tarballIntegrity: string
}

/** Generator identity recorded beside the upstream pin. */
export interface OpenSpecGenerator {
  command: string
  profile: string
  workflows: string[]
}

/** One vendored file's provenance entry. */
export interface OpenSpecFileRecord {
  path: string
  bytes: number
  sha256: string
}

/** One packaged skill: catalog metadata plus its file record. */
export interface OpenSpecSkillRecord extends OpenSpecFileRecord {
  name: string
  description: string
}

/** Committed provenance document describing the pinned OpenSpec release. */
export interface OpenSpecLock {
  upstream: OpenSpecUpstream
  generator: OpenSpecGenerator
  skills: OpenSpecSkillRecord[]
  license: OpenSpecFileRecord
}

/** Parsed frontmatter fields the repository validates and the lock records. */
export interface OpenSpecSkillFrontmatter {
  name: string
  description: string
  license: string
  compatibility: string
  generatedBy: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OpenSpecError(`${field} must be a non-empty string`)
  }
  return value
}

function requireCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new OpenSpecError(`${field} must be a non-negative integer`)
  }
  return value
}

function assertLf(text: string, label: string): void {
  if (text.includes('\r')) {
    throw new OpenSpecError(`${label} must use LF line endings; found a carriage return`)
  }
}

function assertSize(text: string, label: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxBytes) {
    throw new OpenSpecError(`${label} is ${bytes} bytes, above the ${maxBytes}-byte ceiling`)
  }
}

/** Return the lowercase hex SHA-256 of a file's bytes. */
export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Package-relative path of one skill's vendored file. */
export function skillAssetPath(name: string): string {
  return `${OPENSPEC_ASSETS_DIRECTORY}/${name}/SKILL.md`
}

/** Package-relative path of the vendored license. */
export function licenseAssetPath(): string {
  return `${OPENSPEC_ASSETS_DIRECTORY}/${OPENSPEC_LICENSE_FILE}`
}

/** Validate the upstream identity recorded in (or about to be recorded in) a lock. */
export function assertUpstream(upstream: OpenSpecUpstream): void {
  if (upstream.repository !== OPENSPEC_REPOSITORY) {
    throw new OpenSpecError(
      `upstream repository must be ${OPENSPEC_REPOSITORY}, got "${upstream.repository}"`,
    )
  }
  if (!VERSION_PATTERN.test(upstream.version)) {
    throw new OpenSpecError(`upstream version must be x.y.z, got "${upstream.version}"`)
  }
  if (upstream.tag !== `v${upstream.version}`) {
    throw new OpenSpecError(`upstream tag must be v${upstream.version}, got "${upstream.tag}"`)
  }
  if (!COMMIT_PATTERN.test(upstream.commit)) {
    throw new OpenSpecError(`upstream commit must be a 40-hex-digit SHA, got "${upstream.commit}"`)
  }
  if (!INTEGRITY_PATTERN.test(upstream.tarballIntegrity)) {
    throw new OpenSpecError(
      `upstream tarball integrity must be a sha512 SRI string, got "${upstream.tarballIntegrity}"`,
    )
  }
}

/** Validate the generator record; a different profile or workflow set is a different package. */
export function assertGenerator(generator: OpenSpecGenerator): void {
  if (generator.command !== OPENSPEC_GENERATOR_COMMAND) {
    throw new OpenSpecError(
      `generator command must be "${OPENSPEC_GENERATOR_COMMAND}", got "${generator.command}"`,
    )
  }
  if (generator.profile !== OPENSPEC_GENERATOR_PROFILE) {
    throw new OpenSpecError(
      `generator profile must be "${OPENSPEC_GENERATOR_PROFILE}", got "${generator.profile}"`,
    )
  }
  if (JSON.stringify(generator.workflows) !== JSON.stringify(OPENSPEC_CORE_WORKFLOWS)) {
    throw new OpenSpecError(
      `generator workflows must be ${JSON.stringify(OPENSPEC_CORE_WORKFLOWS)}, got ${JSON.stringify(generator.workflows)}`,
    )
  }
}

/** Parse and validate the YAML frontmatter of one generated skill file. */
export function parseSkillFrontmatter(text: string): OpenSpecSkillFrontmatter {
  const block = /^---\n([\s\S]*?)\n---\n?/.exec(text)
  if (block === null) throw new OpenSpecError('skill file is missing its YAML frontmatter')
  const parsed: unknown = parse(block[1] ?? '')
  if (!isRecord(parsed)) throw new OpenSpecError('skill frontmatter must be a mapping')
  const metadata = isRecord(parsed.metadata) ? parsed.metadata : {}
  return {
    name: requireString(parsed.name, 'frontmatter.name'),
    description: requireString(parsed.description, 'frontmatter.description'),
    license: requireString(parsed.license, 'frontmatter.license'),
    compatibility: requireString(parsed.compatibility, 'frontmatter.compatibility'),
    generatedBy: requireString(metadata.generatedBy, 'frontmatter.metadata.generatedBy'),
  }
}

/**
 * Validate one generated skill file and return the metadata recorded in the lock.
 * The file must be LF-only, within the size ceiling, and generated by the pinned version.
 */
export function inspectSkillText(
  name: string,
  text: string,
  version: string,
): OpenSpecSkillFrontmatter {
  const label = `${skillAssetPath(name)}`
  assertLf(text, label)
  assertSize(text, label, OPENSPEC_MAX_SKILL_BYTES)
  const frontmatter = parseSkillFrontmatter(text)
  if (frontmatter.name !== name) {
    throw new OpenSpecError(`${label} declares name "${frontmatter.name}", expected "${name}"`)
  }
  if (!SKILL_NAME_PATTERN.test(frontmatter.name)) {
    throw new OpenSpecError(`${label} has an invalid skill name "${frontmatter.name}"`)
  }
  if (frontmatter.license !== 'MIT') {
    throw new OpenSpecError(`${label} must declare the MIT license`)
  }
  if (!frontmatter.compatibility.includes('openspec CLI')) {
    throw new OpenSpecError(`${label} must declare the openspec CLI compatibility requirement`)
  }
  if (frontmatter.generatedBy !== version) {
    throw new OpenSpecError(
      `${label} was generated by "${frontmatter.generatedBy}", expected "${version}"`,
    )
  }
  return frontmatter
}

/** Validate the vendored MIT license text. */
export function assertLicenseText(text: string): void {
  assertLf(text, licenseAssetPath())
  assertSize(text, licenseAssetPath(), OPENSPEC_MAX_LICENSE_BYTES)
  if (!text.includes('MIT License')) {
    throw new OpenSpecError(`${licenseAssetPath()} is not the MIT license text`)
  }
  if (!text.includes('OpenSpec Contributors')) {
    throw new OpenSpecError(`${licenseAssetPath()} does not credit the OpenSpec contributors`)
  }
}

/** Build the provenance record for one file. */
export function recordFile(path: string, content: string | Uint8Array): OpenSpecFileRecord {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  return { path, bytes: bytes.byteLength, sha256: sha256Hex(bytes) }
}

/** Compare a file against its record and throw a descriptive mismatch. */
export function assertFileBytes(record: OpenSpecFileRecord, content: string | Uint8Array): void {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  if (bytes.byteLength !== record.bytes) {
    throw new OpenSpecError(
      `${record.path} is ${bytes.byteLength} bytes but its provenance record says ${record.bytes}`,
    )
  }
  const digest = sha256Hex(bytes)
  if (digest !== record.sha256) {
    throw new OpenSpecError(
      `${record.path} SHA-256 does not match its provenance record (${digest} != ${record.sha256})`,
    )
  }
}

/** Validate the complete committed lock. */
export function assertLock(lock: OpenSpecLock): void {
  assertUpstream(lock.upstream)
  assertGenerator(lock.generator)
  if (lock.skills.length !== OPENSPEC_SKILL_NAMES.length) {
    throw new OpenSpecError(
      `lock must record ${OPENSPEC_SKILL_NAMES.length} skills, found ${lock.skills.length}`,
    )
  }
  const seen = new Set<string>()
  lock.skills.forEach((record, index) => {
    const expectedName = OPENSPEC_SKILL_NAMES[index]
    if (expectedName === undefined) throw new OpenSpecError(`unexpected skill at index ${index}`)
    if (record.name !== expectedName) {
      throw new OpenSpecError(`lock skill ${index} must be "${expectedName}", got "${record.name}"`)
    }
    if (record.path !== skillAssetPath(record.name)) {
      throw new OpenSpecError(
        `lock skill "${record.name}" path must be "${skillAssetPath(record.name)}", got "${record.path}"`,
      )
    }
    if (seen.has(record.name)) throw new OpenSpecError(`duplicate lock skill "${record.name}"`)
    seen.add(record.name)
    requireCount(record.bytes, `lock skill "${record.name}" bytes`)
    if (!SHA256_PATTERN.test(record.sha256)) {
      throw new OpenSpecError(`lock skill "${record.name}" has an invalid SHA-256`)
    }
    requireString(record.description, `lock skill "${record.name}" description`)
  })
  if (lock.license.path !== licenseAssetPath()) {
    throw new OpenSpecError(
      `lock license path must be "${licenseAssetPath()}", got "${lock.license.path}"`,
    )
  }
  requireCount(lock.license.bytes, 'lock license bytes')
  if (!SHA256_PATTERN.test(lock.license.sha256)) {
    throw new OpenSpecError('lock license has an invalid SHA-256')
  }
}

/** Parse and validate a lock document read from disk. */
export function parseLock(value: unknown): OpenSpecLock {
  if (!isRecord(value)) throw new OpenSpecError(`${OPENSPEC_LOCK_FILE} must be a JSON object`)
  if (!isRecord(value.upstream))
    throw new OpenSpecError(`${OPENSPEC_LOCK_FILE} is missing upstream`)
  if (!isRecord(value.generator)) {
    throw new OpenSpecError(`${OPENSPEC_LOCK_FILE} is missing generator`)
  }
  if (!Array.isArray(value.skills))
    throw new OpenSpecError(`${OPENSPEC_LOCK_FILE} is missing skills`)
  if (!isRecord(value.license)) throw new OpenSpecError(`${OPENSPEC_LOCK_FILE} is missing license`)

  const upstream = value.upstream
  const generator = value.generator
  const license = value.license
  const workflows = generator.workflows
  if (!Array.isArray(workflows)) {
    throw new OpenSpecError('generator.workflows must be an array')
  }
  const lock: OpenSpecLock = {
    upstream: {
      repository: requireString(upstream.repository, 'upstream.repository'),
      version: requireString(upstream.version, 'upstream.version'),
      tag: requireString(upstream.tag, 'upstream.tag'),
      commit: requireString(upstream.commit, 'upstream.commit'),
      tarballIntegrity: requireString(upstream.tarballIntegrity, 'upstream.tarballIntegrity'),
    },
    generator: {
      command: requireString(generator.command, 'generator.command'),
      profile: requireString(generator.profile, 'generator.profile'),
      workflows: workflows.map((workflow: unknown, index: number) =>
        requireString(workflow, `generator.workflows[${index}]`),
      ),
    },
    skills: value.skills.map((entry: unknown, index: number) => {
      if (!isRecord(entry)) throw new OpenSpecError(`skills[${index}] must be a mapping`)
      return {
        name: requireString(entry.name, `skills[${index}].name`),
        description: requireString(entry.description, `skills[${index}].description`),
        path: requireString(entry.path, `skills[${index}].path`),
        bytes: requireCount(entry.bytes, `skills[${index}].bytes`),
        sha256: requireString(entry.sha256, `skills[${index}].sha256`),
      }
    }),
    license: {
      path: requireString(license.path, 'license.path'),
      bytes: requireCount(license.bytes, 'license.bytes'),
      sha256: requireString(license.sha256, 'license.sha256'),
    },
  }
  assertLock(lock)
  return lock
}

/** Build the lock from the generated files. */
export function buildLock(
  upstream: OpenSpecUpstream,
  generator: OpenSpecGenerator,
  skills: ReadonlyArray<{ name: string; description: string; content: string }>,
  licenseText: string,
): OpenSpecLock {
  assertUpstream(upstream)
  assertGenerator(generator)
  if (skills.length !== OPENSPEC_SKILL_NAMES.length) {
    throw new OpenSpecError(
      `expected ${OPENSPEC_SKILL_NAMES.length} generated skills, found ${skills.length}`,
    )
  }
  const byName = new Map(skills.map((skill) => [skill.name, skill]))
  const records: OpenSpecSkillRecord[] = OPENSPEC_SKILL_NAMES.map((name) => {
    const skill = byName.get(name)
    if (skill === undefined) throw new OpenSpecError(`generated output is missing "${name}"`)
    return {
      name,
      description: skill.description,
      ...recordFile(skillAssetPath(name), skill.content),
    }
  })
  const license = recordFile(licenseAssetPath(), licenseText)
  const lock: OpenSpecLock = { upstream, generator, skills: records, license }
  assertLock(lock)
  return lock
}

/** Serialize a lock deterministically; the update script and the provenance test agree on bytes. */
export function serializeLock(lock: OpenSpecLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`
}
