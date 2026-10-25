import { createHash } from 'node:crypto'
import { parse } from 'yaml'

/**
 * Pure metadata and validation helpers for the vendored Ponytail prompt.
 *
 * The update script, the provenance test, and the plugin package all agree on
 * these names and rules, so an upstream change that no longer matches the
 * expected shape fails loudly instead of producing a broken package.
 */

/** Upstream repository the vendored prompt is pinned from. */
export const PONYTAIL_REPOSITORY = 'https://github.com/DietrichGebert/ponytail'

/** Skill name the plugin registers; the vendored frontmatter must declare it. */
export const PONYTAIL_SKILL_NAME = 'ponytail'

/** Package-relative directory holding the vendored upstream files. */
export const PONYTAIL_ASSETS_DIRECTORY = 'assets/ponytail'

/** Package-relative provenance document written by the update script. */
export const PONYTAIL_LOCK_FILE = 'ponytail.lock.json'

/** Vendored upstream file names inside {@link PONYTAIL_ASSETS_DIRECTORY}. */
export const PONYTAIL_SKILL_FILE = 'SKILL.md'
export const PONYTAIL_RULES_FILE = 'AGENTS.md'
export const PONYTAIL_LICENSE_FILE = 'LICENSE'

/** Size ceilings keep a runaway upstream file from silently bloating the prompt. */
export const PONYTAIL_MAX_SKILL_BYTES = 32 * 1024
export const PONYTAIL_MAX_RULES_BYTES = 32 * 1024
export const PONYTAIL_MAX_LICENSE_BYTES = 8 * 1024

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/
const REPOSITORY_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const RULES_HEADING = '# Ponytail'
const LICENSE_MARKER = 'MIT License'
const LICENSE_COPYRIGHT_PATTERN = /Copyright \(c\) \d{4} DietrichGebert/

/** Error raised when an upstream file or a lock does not match the expected shape. */
export class PonytailError extends Error {
  constructor(message: string) {
    super(`ponytail: ${message}`)
    this.name = 'PonytailError'
  }
}

/** Parsed skill frontmatter relevant to the plugin. */
export interface PonytailSkillMetadata {
  name: string
  description: string
  argumentHint?: string
}

/** Immutable upstream identity recorded in the provenance document. */
export interface PonytailUpstream {
  repository: string
  version: string
  tag: string
  commit: string
}

/** One vendored file's provenance entry. */
export interface PonytailFileRecord {
  path: string
  bytes: number
  sha256: string
}

/** Committed provenance document describing the pinned upstream state. */
export interface PonytailLock {
  upstream: PonytailUpstream
  skill: PonytailSkillMetadata
  files: PonytailFileRecord[]
}

/** One vendored file to record or verify. */
export interface PonytailAsset {
  path: string
  content: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertLf(text: string, label: string): void {
  if (text.includes('\r')) {
    throw new PonytailError(`${label} must use LF line endings; found a carriage return`)
  }
}

function assertSize(text: string, label: string, maxBytes: number): void {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > maxBytes) {
    throw new PonytailError(`${label} is ${bytes} bytes, above the ${maxBytes}-byte ceiling`)
  }
}

/** Return the lowercase hex SHA-256 of a vendored file's bytes. */
export function sha256Hex(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Validate the upstream identity recorded in (or about to be recorded in) a lock. */
export function assertUpstream(upstream: PonytailUpstream): void {
  if (!REPOSITORY_PATTERN.test(upstream.repository)) {
    throw new PonytailError(
      `upstream repository must look like ${PONYTAIL_REPOSITORY}, got "${upstream.repository}"`,
    )
  }
  if (!VERSION_PATTERN.test(upstream.version)) {
    throw new PonytailError(`upstream version must be x.y.z, got "${upstream.version}"`)
  }
  if (upstream.tag !== `v${upstream.version}`) {
    throw new PonytailError(`upstream tag must be v${upstream.version}, got "${upstream.tag}"`)
  }
  if (!COMMIT_PATTERN.test(upstream.commit)) {
    throw new PonytailError(
      `upstream commit must be a 40-hex-digit commit, got "${upstream.commit}"`,
    )
  }
}

/**
 * Fold a YAML description value into one line.
 *
 * Upstream uses a folded block scalar, so YAML already joins the lines; this
 * normalization guarantees the catalog description stays a single line even if
 * the source switches to a literal block or wraps in an unexpected way.
 */
export function normalizeDescription(value: unknown, source: string): string {
  if (typeof value !== 'string') {
    throw new PonytailError(`${source}: skill description must be a string`)
  }
  const description = value.replaceAll(/\s+/gu, ' ').trim()
  if (description === '') {
    throw new PonytailError(`${source}: skill description must not be empty`)
  }
  return description
}

/**
 * Parse the YAML frontmatter of a SKILL.md body and validate the fields the
 * plugin depends on: a kebab-case name, a non-empty one-line description, and
 * an optional argument hint.
 */
export function parseSkillFrontmatter(text: string, source = 'SKILL.md'): PonytailSkillMetadata {
  assertLf(text, source)
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(text)
  if (match?.[1] === undefined) {
    throw new PonytailError(`${source}: missing YAML frontmatter`)
  }
  const document: unknown = parse(match[1])
  if (!isRecord(document)) {
    throw new PonytailError(`${source}: frontmatter must be a YAML mapping`)
  }
  const rawName = document.name
  if (typeof rawName !== 'string' || !SKILL_NAME_PATTERN.test(rawName)) {
    throw new PonytailError(
      `${source}: frontmatter name must match ${SKILL_NAME_PATTERN.source}, got ${JSON.stringify(rawName)}`,
    )
  }
  const description = normalizeDescription(document.description, source)
  const rawHint = document['argument-hint']
  if (rawHint !== undefined && typeof rawHint !== 'string') {
    throw new PonytailError(`${source}: frontmatter argument-hint must be a string`)
  }
  return {
    name: rawName,
    description,
    ...(rawHint === undefined ? {} : { argumentHint: rawHint }),
  }
}

/** Validate a complete SKILL.md body (line endings, size ceiling, frontmatter). */
export function assertSkillText(text: string, source = 'SKILL.md'): PonytailSkillMetadata {
  assertLf(text, source)
  assertSize(text, source, PONYTAIL_MAX_SKILL_BYTES)
  return parseSkillFrontmatter(text, source)
}

/** Validate the compact always-on rules file (line endings, size, heading). */
export function assertRulesText(text: string, source = 'AGENTS.md'): void {
  assertLf(text, source)
  assertSize(text, source, PONYTAIL_MAX_RULES_BYTES)
  if (text.trim() === '') {
    throw new PonytailError(`${source}: rules file must not be empty`)
  }
  if (!text.startsWith(RULES_HEADING)) {
    throw new PonytailError(`${source}: rules file must start with "${RULES_HEADING}"`)
  }
}

/** Validate the vendored MIT license text. */
export function assertLicenseText(text: string, source = 'LICENSE'): void {
  assertLf(text, source)
  assertSize(text, source, PONYTAIL_MAX_LICENSE_BYTES)
  if (!text.includes(LICENSE_MARKER)) {
    throw new PonytailError(`${source}: license text must contain "${LICENSE_MARKER}"`)
  }
  if (!LICENSE_COPYRIGHT_PATTERN.test(text)) {
    throw new PonytailError(`${source}: license text must carry the upstream copyright line`)
  }
}

/**
 * Build the deterministic provenance document from vendored bytes.
 *
 * Files are sorted by path and the document carries no timestamp, so running
 * the update step again for the same pin produces byte-identical output.
 */
export function buildPonytailLock(
  upstream: PonytailUpstream,
  skill: PonytailSkillMetadata,
  assets: readonly PonytailAsset[],
): PonytailLock {
  assertUpstream(upstream)
  const names = new Set<string>()
  const files = assets
    .map((asset) => {
      if (asset.path.trim() === '') throw new PonytailError('vendored file path must not be empty')
      if (names.has(asset.path)) {
        throw new PonytailError(`vendored file "${asset.path}" is listed twice`)
      }
      names.add(asset.path)
      return {
        path: asset.path,
        bytes: Buffer.byteLength(asset.content, 'utf8'),
        sha256: sha256Hex(asset.content),
      }
    })
    .sort((left, right) => left.path.localeCompare(right.path))
  return { upstream, skill, files }
}

/** Render the provenance document exactly as it is committed. */
export function serializePonytailLock(lock: PonytailLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`
}

/** Validate one vendored body against its provenance record. */
export function assertAssetBytes(record: PonytailFileRecord, content: string | Uint8Array): void {
  const bytes = Buffer.byteLength(content)
  const actual = sha256Hex(content)
  if (bytes !== record.bytes || actual !== record.sha256) {
    throw new PonytailError(
      `"${record.path}" does not match its provenance record (expected ${record.bytes} bytes ${record.sha256}, got ${bytes} bytes ${actual})`,
    )
  }
}
