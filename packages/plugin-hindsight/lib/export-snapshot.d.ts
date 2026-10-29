import type { ArchiveEntries } from './export-zip.js';
/** Single-writer lock file, relative to the export repository. */
export declare const LOCK_FILE = ".export.lock";
/** Staging directory for a snapshot under construction. */
export declare const STAGING_DIR = ".export-staging";
/** Journal of an in-flight snapshot swap; a crash leaves it for the next cycle. */
export declare const PENDING_FILE = ".export-pending.json";
/** A lock older than this is considered abandoned by a crashed Host. */
export declare const DEFAULT_LOCK_STALE_MS: number;
export interface SnapshotLock {
    readonly owner: string;
    /** Remove the lock, but only while this owner still holds it. */
    release(): void;
}
export interface LockOptions {
    owner?: string;
    staleAfterMs?: number;
    now?: () => number;
}
/**
 * Take the single-writer lock for one export cycle. A live holder means this
 * cycle skips; an abandoned holder is replaced through an elected takeover, so
 * two recovering processors can never displace each other's fresh lock.
 */
export declare function acquireSnapshotLock(repoDir: string, options?: LockOptions): SnapshotLock;
/** One bank archive on its way into a snapshot. */
export interface BankSnapshotInput {
    bankId: string;
    operationId: string;
    exportedAt: string;
    entries: ArchiveEntries;
}
export interface SnapshotOptions {
    includeHistory: boolean;
    includeAttachments: boolean;
    now?: () => Date;
}
export interface SnapshotResult {
    changed: boolean;
    contentHash: string;
    /** Bank id to its folder inside `banks/`, for the log line and the index. */
    bankFolders: Record<string, string>;
}
/**
 * The normalized content hash a cycle compares before writing anything.
 * Volatile fields (`exported_at`) and our own `export.json` are excluded, so
 * re-running an unchanged export produces the same hash.
 */
export declare function normalizedContentHash(snapshot: ReadonlyMap<string, ArchiveEntries>): string;
/**
 * Finish or undo a snapshot swap interrupted by a crash. A `swap` journal pairs
 * a bank tree already moved into place with the staged index; a `rollback`
 * journal never publishes that index, because the old tree is authoritative.
 */
export declare function recoverPendingSnapshot(repoDir: string): void;
/**
 * Write a complete snapshot into the repository, replacing the previous one
 * only when the normalized content changed. The tree is staged, journaled, and
 * swapped in, so a crash leaves either the old tree or the new one recoverable.
 */
export declare function writeSnapshot(repoDir: string, banks: BankSnapshotInput[], options: SnapshotOptions): SnapshotResult;
