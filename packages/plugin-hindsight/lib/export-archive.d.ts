import type { ArchiveEntries } from './export-zip.js';
/** Version of the exporter's own metadata files, not of the Hindsight archive. */
export declare const METADATA_SCHEMA_VERSION = 1;
/** The transfer archive schema version this exporter understands. */
export declare const TRANSFER_SCHEMA_VERSION = 1;
/** Managed tree layout inside the export repository. */
export declare const BANKS_DIR = "banks";
/** Per-bank metadata: original bank id, counts, scope, and per-file checksums. */
export declare const BANK_METADATA_FILE = "export.json";
/** Repository index: every bank snapshot and the hash of the snapshot content. */
export declare const INDEX_FILE = "index.json";
/** Which optional archive sections the row enabled. */
export interface ArchiveScopeOptions {
    readonly includeHistory: boolean;
    readonly includeAttachments: boolean;
}
/** Counts the transfer manifest records; every one is validated before it is trusted. */
export interface ArchiveCounts {
    documents: number;
    facts: number;
    observations: number;
    mentalModels: number;
    knowledgePages: number;
    directives: number;
    webhooks: number;
    attachments: number;
}
/** `export.json`: what a bank folder holds and how to prove it is intact. */
export interface BankExportMetadata {
    schema_version: number;
    bank_id: string;
    exported_at: string;
    operation_id: string;
    /** The Hindsight archive schema version from `manifest.json`. */
    archive_schema_version: number;
    archive_type: string;
    counts: ArchiveCounts;
    includes_history: boolean;
    includes_attachments: boolean;
    /** SHA-256 of every stored archive entry, keyed by its archive path. */
    checksums: Record<string, string>;
}
/** One bank in `index.json`; `folder` is derived, `bank_id` is authoritative. */
export interface RepositoryIndexEntry {
    bank_id: string;
    folder: string;
    exported_at: string;
    operation_id: string;
    documents: number;
    facts: number;
    metadata_sha256: string;
}
/** `index.json`: the snapshot list and the content hash the Git layer compares. */
export interface RepositoryIndex {
    schema_version: number;
    updated_at: string;
    content_hash: string;
    banks: RepositoryIndexEntry[];
}
/** Hex SHA-256 of a byte sequence. */
export declare function sha256Hex(bytes: Uint8Array): string;
/**
 * Reversible encoding of a bank id into one Windows-safe path segment.
 * Colons, slashes, spaces, and dots are percent-encoded, so the result has no
 * separator, no trailing dot or space, and no reserved device name.
 */
export declare function sanitizeBankId(bankId: string): string;
/** Inverse of {@link sanitizeBankId}; restore reads the id from metadata instead. */
export declare function unsanitizeBankId(encoded: string): string;
/**
 * The one folder a bank occupies. The id hash breaks the collisions a
 * case-insensitive filesystem would otherwise create between distinct bank ids.
 */
export declare function bankFolderName(bankId: string): string;
/**
 * Drop the archive sections the row did not enable. Attachments ride with the
 * data section on the wire, so this filter is what keeps the default export
 * free of attachment bytes.
 */
export declare function applyArchiveScope(entries: ArchiveEntries, scope: ArchiveScopeOptions): ArchiveEntries;
/** Build one bank folder: the scoped verbatim entries plus `export.json`. */
export declare function buildBankFiles(options: {
    bankId: string;
    operationId: string;
    exportedAt: string;
    entries: ArchiveEntries;
    scope: ArchiveScopeOptions;
}): {
    files: Map<string, Uint8Array>;
    metadata: BankExportMetadata;
};
/** Serialize `index.json` in a stable order: banks sorted by id. */
export declare function buildRepositoryIndex(updatedAt: string, contentHash: string, entries: RepositoryIndexEntry[]): Uint8Array;
/** Read `index.json`; missing or invalid content means no usable previous snapshot. */
export declare function parseRepositoryIndex(bytes: Uint8Array): RepositoryIndex | undefined;
/** Read a stored bank's metadata; a missing or foreign file is an archive error. */
export declare function parseBankMetadata(bytes: Uint8Array): BankExportMetadata;
