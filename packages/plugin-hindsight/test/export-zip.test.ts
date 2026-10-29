import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { ExportError, packArchive, unpackArchive } from '../lib/index.js'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** A minimal transfer archive: manifest, one document, one knowledge page. */
const FIXTURE = {
  'manifest.json': encoder.encode(
    JSON.stringify({ schema_version: 1, source_bank_id: 'coding-agent::repo', document_count: 1 }),
  ),
  'documents/000000.json': encoder.encode(
    JSON.stringify({ id: 'doc-1', chunks: [{ chunk_index: 0, chunk_text: 'hello' }], facts: [] }),
  ),
  'knowledge_pages.json': encoder.encode(
    JSON.stringify([{ id: 'page-1', kind: 'page', name: 'Repo' }]),
  ),
  'blobs/000001.bin': new Uint8Array([0, 1, 2, 253, 254, 255]),
}

describe('transfer archive zip helpers', () => {
  it('round-trips every entry byte for byte', () => {
    const entries = new Map(Object.entries(FIXTURE))
    const unpacked = unpackArchive(packArchive(entries))
    expect([...unpacked.keys()].sort()).toEqual([...entries.keys()].sort())
    for (const [path, bytes] of entries) {
      expect(decoder.decode(unpacked.get(path))).toBe(decoder.decode(bytes))
    }
    // A repack of the unpacked entries feeds the importer the same payload.
    const repacked = unpackArchive(packArchive(unpacked))
    for (const [path, bytes] of entries) {
      expect(Buffer.from(repacked.get(path) ?? new Uint8Array()).equals(Buffer.from(bytes))).toBe(
        true,
      )
    }
  })

  it('reports a corrupt archive as a typed zip error', () => {
    expect(() => unpackArchive(new Uint8Array([1, 2, 3, 4]))).toThrowError(ExportError)
    try {
      unpackArchive(new Uint8Array([1, 2, 3, 4]))
    } catch (error) {
      expect((error as ExportError).code).toBe('zip')
    }
  })

  it('rejects an archive entry that escapes the export tree', () => {
    const zip = zipSync({ '../escape.json': encoder.encode('{}') })
    expect(() => unpackArchive(zip)).toThrowError(/unsafe archive entry/)
    try {
      unpackArchive(zip)
    } catch (error) {
      expect((error as ExportError).code).toBe('zip')
    }
  })

  it('rejects a Windows-style traversal entry', () => {
    const probe = (name: string): string => {
      try {
        unpackArchive(zipSync({ [name]: encoder.encode('{}') }))
        return 'accepted'
      } catch (error) {
        return (error as ExportError).code
      }
    }
    expect(probe('..\\escape.json')).toBe('zip')
    expect(probe('C:/escape.json')).toBe('zip')
    expect(probe('documents/000000.json')).toBe('accepted')
  })
})
