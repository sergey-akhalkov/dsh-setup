import { type GitRunner } from './git.js';
/**
 * The frozen task-review snapshot: a disposable worktree built from the exact
 * review input set, its lease, and the stale-snapshot sweep. Ported from the
 * delegation runtime; the copy is dropped with that plugin in Release B.
 */
export declare const SNAPSHOT_DIR = ".dsh/workflows/snapshots";
export declare const SCRATCH_DIR = ".dsh/workflows/scratch";
/** One immutable review checkout; the digest binds to `tree`. */
export interface ReviewSnapshot {
    /** Content tree the task digest binds to. */
    readonly tree: string;
    /** Snapshot commit checked out in the disposable worktree. */
    readonly commit: string;
    /** Disposable worktree the reviewer runs in. */
    readonly worktree: string;
    /** Frozen change directory inside the worktree. */
    readonly changeDir: string;
    /** Change-artifact digest computed from the frozen copy. */
    readonly specDigest: string;
}
export declare function startSnapshotLease(cwd: string, runId: string, refreshMs?: number): Promise<void>;
export declare function stopSnapshotLease(cwd: string, runId: string): Promise<void>;
/** Remove snapshots no live run owns; ownership is the lease, never age. */
export declare function sweepReviewSnapshots(cwd: string, runGit: GitRunner, now?: number): Promise<void>;
/** Remove one snapshot checkout, its lease, and its scratch index; best effort. */
export declare function discardReviewSnapshot(cwd: string, runId: string, runGit: GitRunner, remove?: (path: string) => Promise<void>): Promise<void>;
/**
 * Build the disposable task-review snapshot from the exact review input set.
 * Returns undefined when it cannot be built safely; the caller reviews the live
 * worktree with the mutation guard instead and gets the cause through
 * `onUnavailable`.
 */
export declare function createReviewSnapshot(cwd: string, change: {
    readonly dir: string;
}, runId: string, runGit: GitRunner, signal: AbortSignal, afterCopy?: () => Promise<void> | void, onUnavailable?: (reason: string) => void): Promise<ReviewSnapshot | undefined>;
