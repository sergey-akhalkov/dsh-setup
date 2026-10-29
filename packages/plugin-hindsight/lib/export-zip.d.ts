/** One archive member: the entry path Hindsight wrote, and its exact bytes. */
export type ArchiveEntries = ReadonlyMap<string, Uint8Array>;
/**
 * Unpack a bank transfer archive, keeping every entry verbatim (same path, same
 * bytes) so a repack feeds the importer exactly what Hindsight produced.
 */
export declare function unpackArchive(zip: Uint8Array): ArchiveEntries;
/** Rebuild a transfer archive from verbatim entries. */
export declare function packArchive(entries: ArchiveEntries): Uint8Array;
