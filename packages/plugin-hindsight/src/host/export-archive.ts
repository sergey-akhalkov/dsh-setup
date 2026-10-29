import { createHash } from 'node:crypto'
import { ExportError, messageOf } from './export-errors.js'
import type { ArchiveEntries } from './export-zip.js'

/** Version of the exporter's own metadata files, not of the Hindsight archive. */
export const METADATA_SCHEMA_VERSION = 1

/** The transfer archive schema version this exporter understands. */
export const TRANSFER_SCHEMA_VERSION = 1

/** Managed tree layout inside the export repository. */
export const BANKS_DIR = 'banks'
/** Per-bank metadata: original bank id, counts, scope, and per-file checksums. */
export const BANK_METADATA_FILE = 'export.json'
/** Repository index: every bank snapshot and the hash of the snapshot content. */
export const INDEX_FILE = 'index.json'

/** Which optional archive sections the row enabled. */
export interface ArchiveScopeOptions {
  readonly includeHistory: boolean
  readonly includeAttachments: boolean
}

/** Counts the transfer manifest records; every one is validated before it is trusted. */
export interface ArchiveCounts {
  documents: number
  facts: number
  observations: number
  mentalModels: number
  knowledgePages: number
  directives: number
  webhooks: number
  attachments: number
}

/** `export.json`: what a bank folder holds and how to prove it is intact. */
export interface BankExportMetadata {
  schema_version: number
  bank_id: string
  exported_at: string
  operation_id: string
  /** The Hindsight archive schema version from `manifest.json`. */
  archive_schema_version: number
  archive_type: string
  counts: ArchiveCounts
  includes_history: boolean
  includes_attachments: boolean
  /** SHA-256 of every stored archive entry, keyed by its archive path. */
  checksums: Record<string, string>
}

/** One bank in `index.json`; `folder` is derived, `bank_id` is authoritative. */
export interface RepositoryIndexEntry {
  bank_id: string
  folder: string
  exported_at: string
  operation_id: string
  documents: number
  facts: number
  metadata_sha256: string
}

/** `index.json`: the snapshot list and the content hash the Git layer compares. */
export interface RepositoryIndex {
  schema_version: number
  updated_at: string
  content_hash: string
  banks: RepositoryIndexEntry[]
}

/** Hex SHA-256 of a byte sequence. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Reversible encoding of a bank id into one Windows-safe path segment.
 * Colons, slashes, spaces, and dots are percent-encoded, so the result has no
 * separator, no trailing dot or space, and no reserved device name.
 */
export function sanitizeBankId(bankId: string): string {
  let encoded = ''
  for (const byte of Buffer.from(bankId, 'utf8')) {
    const character = String.fromCharCode(byte)
    encoded += /[A-Za-z0-9_-]/.test(character)
      ? character
      : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return encoded
}

/** Inverse of {@link sanitizeBankId}; restore reads the id from metadata instead. */
export function unsanitizeBankId(encoded: string): string {
  const bytes: number[] = []
  for (let index = 0; index < encoded.length; index += 1) {
    const character = encoded[index] ?? ''
    if (character !== '%') {
      bytes.push(character.charCodeAt(0))
      continue
    }
    const hex = encoded.slice(index + 1, index + 3)
    if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
      throw new ExportError('archive', `"${encoded}" is not a sanitized bank id`)
    }
    bytes.push(Number.parseInt(hex, 16))
    index += 2
  }
  return Buffer.from(bytes).toString('utf8')
}

/**
 * The one folder a bank occupies. The id hash breaks the collisions a
 * case-insensitive filesystem would otherwise create between distinct bank ids.
 */
export function bankFolderName(bankId: string): string {
  return `${sanitizeBankId(bankId)}-${sha256Text(bankId).slice(0, 8)}`
}

function scopedPath(path: string, scope: ArchiveScopeOptions): boolean {
  if (!scope.includeHistory && (path === 'history' || path.startsWith('history/'))) return false
  if (
    !scope.includeAttachments &&
    (path === 'attachments.json' || path === 'blobs' || path.startsWith('blobs/'))
  ) {
    return false
  }
  return true
}

/**
 * Drop the archive sections the row did not enable. Attachments ride with the
 * data section on the wire, so this filter is what keeps the default export
 * free of attachment bytes.
 */
export function applyArchiveScope(
  entries: ArchiveEntries,
  scope: ArchiveScopeOptions,
): ArchiveEntries {
  const scoped = new Map<string, Uint8Array>()
  for (const [path, bytes] of entries) {
    if (scopedPath(path, scope)) scoped.set(path, bytes)
  }
  return scoped
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonFile(entries: ArchiveEntries, path: string): unknown {
  const bytes = entries.get(path)
  if (bytes === undefined) throw new ExportError('archive', `archive is missing ${path}`)
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ExportError('archive', `${path} is not valid JSON: ${messageOf(error)}`, {
      cause: error,
    })
  }
}

function count(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function hasSection(entries: ArchiveEntries, prefix: string): boolean {
  for (const path of entries.keys()) {
    if (path.startsWith(prefix)) return true
  }
  return false
}

/** Build one bank folder: the scoped verbatim entries plus `export.json`. */
export function buildBankFiles(options: {
  bankId: string
  operationId: string
  exportedAt: string
  entries: ArchiveEntries
  scope: ArchiveScopeOptions
}): { files: Map<string, Uint8Array>; metadata: BankExportMetadata } {
  const files = applyArchiveScope(options.entries, options.scope)
  const manifest = parseJsonFile(files, 'manifest.json')
  if (!isRecord(manifest)) throw new ExportError('archive', 'manifest.json is not an object')
  if (manifest.schema_version !== TRANSFER_SCHEMA_VERSION) {
    throw new ExportError(
      'archive',
      `unsupported transfer schema version ${String(manifest.schema_version)}`,
    )
  }
  if (manifest.archive_type !== 'bank') {
    throw new ExportError('archive', `manifest.json is not a whole-bank archive`)
  }
  if (manifest.source_bank_id !== options.bankId) {
    throw new ExportError(
      'archive',
      `archive names bank "${String(manifest.source_bank_id)}", expected "${options.bankId}"`,
    )
  }

  const checksums: Record<string, string> = {}
  for (const path of [...files.keys()].sort()) {
    const bytes = files.get(path)
    if (bytes !== undefined) checksums[path] = sha256Hex(bytes)
  }

  const metadata: BankExportMetadata = {
    schema_version: METADATA_SCHEMA_VERSION,
    bank_id: options.bankId,
    exported_at: options.exportedAt,
    operation_id: options.operationId,
    archive_schema_version: TRANSFER_SCHEMA_VERSION,
    archive_type: 'bank',
    counts: {
      documents: count(manifest, 'document_count'),
      facts: count(manifest, 'fact_count'),
      observations: count(manifest, 'observation_count'),
      mentalModels: count(manifest, 'mental_model_count'),
      knowledgePages: count(manifest, 'knowledge_page_count'),
      directives: count(manifest, 'directive_count'),
      webhooks: count(manifest, 'webhook_count'),
      attachments: count(manifest, 'attachment_count'),
    },
    includes_history: hasSection(files, 'history/'),
    includes_attachments: files.has('attachments.json'),
    checksums,
  }

  const withMetadata = new Map(files)
  withMetadata.set(BANK_METADATA_FILE, new TextEncoder().encode(JSON.stringify(metadata, null, 2)))
  return { files: withMetadata, metadata }
}

/** Serialize `index.json` in a stable order: banks sorted by id. */
export function buildRepositoryIndex(
  updatedAt: string,
  contentHash: string,
  entries: RepositoryIndexEntry[],
): Uint8Array {
  const index: RepositoryIndex = {
    schema_version: METADATA_SCHEMA_VERSION,
    updated_at: updatedAt,
    content_hash: contentHash,
    banks: [...entries].sort((left, right) => left.bank_id.localeCompare(right.bank_id)),
  }
  return new TextEncoder().encode(JSON.stringify(index, null, 2))
}

/** Read `index.json`; missing or invalid content means no usable previous snapshot. */
export function parseRepositoryIndex(bytes: Uint8Array): RepositoryIndex | undefined {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!isRecord(parsed) || parsed.schema_version !== METADATA_SCHEMA_VERSION) return undefined
    if (typeof parsed.content_hash !== 'string' || !Array.isArray(parsed.banks)) return undefined
    return parsed as unknown as RepositoryIndex
  } catch {
    return undefined
  }
}

/** Read a stored bank's metadata; a missing or foreign file is an archive error. */
export function parseBankMetadata(bytes: Uint8Array): BankExportMetadata {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new ExportError(
      'archive',
      `${BANK_METADATA_FILE} is not valid JSON: ${messageOf(error)}`,
      {
        cause: error,
      },
    )
  }
  if (!isRecord(parsed) || typeof parsed.bank_id !== 'string') {
    throw new ExportError('archive', `${BANK_METADATA_FILE} has no bank id`)
  }
  if (parsed.schema_version !== METADATA_SCHEMA_VERSION) {
    throw new ExportError('archive', `${BANK_METADATA_FILE} has an unsupported schema version`)
  }
  if (!isRecord(parsed.checksums)) {
    throw new ExportError('archive', `${BANK_METADATA_FILE} has no checksums`)
  }
  return parsed as unknown as BankExportMetadata
}
