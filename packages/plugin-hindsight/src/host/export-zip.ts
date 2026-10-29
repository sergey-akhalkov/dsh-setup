import { unzipSync, zipSync } from 'fflate'
import { ExportError, messageOf } from './export-errors.js'

/** One archive member: the entry path Hindsight wrote, and its exact bytes. */
export type ArchiveEntries = ReadonlyMap<string, Uint8Array>

/**
 * Unpack a bank transfer archive, keeping every entry verbatim (same path, same
 * bytes) so a repack feeds the importer exactly what Hindsight produced.
 */
export function unpackArchive(zip: Uint8Array): ArchiveEntries {
  let raw: Record<string, Uint8Array>
  try {
    raw = unzipSync(zip)
  } catch (error) {
    throw new ExportError('zip', `not a readable transfer archive: ${messageOf(error)}`, {
      cause: error,
    })
  }
  const entries = new Map<string, Uint8Array>()
  for (const [path, bytes] of Object.entries(raw)) {
    // Directory markers carry no content, and an entry escaping the tree is a
    // path-traversal hazard regardless of where the archive came from. ZIP
    // names use forward slashes only; a backslash or drive prefix is a Windows
    // path in disguise.
    if (path.endsWith('/')) continue
    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      /^[A-Za-z]:/.test(path) ||
      path.split('/').includes('..')
    ) {
      throw new ExportError('zip', `unsafe archive entry "${path}"`)
    }
    entries.set(path, bytes)
  }
  return entries
}

/** Rebuild a transfer archive from verbatim entries. */
export function packArchive(entries: ArchiveEntries): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  for (const [path, bytes] of entries) files[path] = bytes
  return zipSync(files, { level: 6 })
}
