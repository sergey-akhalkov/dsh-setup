import { type GitRunner } from './git.js';
/**
 * The frozen task-review snapshot: a disposable worktree built from the exact
 * review input set, its lease, and the stale-snapshot sweep.
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
/**
 * The stable snapshot directory name for one review unit key: a readable
 * prefix plus a short hash, so two units never share a checkout and the name
 * carries no separator or traversal. An unchanged key keeps the same path
 * across rounds, which is what lets the provider resume its review thread. A
 * key that is already one safe path segment (a run id) keeps its old name, so
 * a snapshot an interrupted upgrade left behind stays discardable.
 */
export declare function reviewSnapshotName(key: string): string;
export declare function startSnapshotLease(cwd: string, key: string, refreshMs?: number, owner?: string): Promise<void>;
export declare function stopSnapshotLease(cwd: string, key: string): Promise<void>;
/** Remove snapshots no live run owns; ownership is the lease, never age. */
export declare function sweepReviewSnapshots(cwd: string, runGit: GitRunner, now?: number): Promise<void>;
/** Remove one unit's snapshot checkout, its lease, and its scratch index; best effort. */
export declare function discardReviewSnapshot(cwd: string, key: string, runGit: GitRunner, remove?: (path: string) => Promise<void>, owner?: string): Promise<void>;
/**
 * The current content tree of the reviewed input set. A whole-worktree review
 * record binds this, and the evidence check recomputes it for the live tree, so
 * a record always describes the contents the reviewer read.
 */
export declare function reviewInputTree(cwd: string, change: {
    readonly dir: string;
}, runGit: GitRunner, signal: AbortSignal): Promise<string>;
/** The change-artifact signature; a whole-spec fallback tracks only its reviewed scope. */
export declare function specInputs(changeDir: string): Promise<InputSignature>; /**
 * Build the disposable review snapshot from the exact review input set. The
 * checkout lives at the stable path of `key` (the unit key; a run id also
 * works) and replaces any leftover checkout at that path. Returns undefined
 * when it cannot be built safely; the caller reviews the live worktree with the
 * mutation guard instead and gets the cause through `onUnavailable`.
 */
export declare function createReviewSnapshot(cwd: string, change: {
    readonly dir: string;
}, key: string, runGit: GitRunner, signal: AbortSignal, afterCopy?: () => Promise<void> | void, onUnavailable?: (reason: string) => void, owner?: string): Promise<ReviewSnapshot | undefined>;
/**
 * The reviewed input set of a review: every file the reviewer can read, with a
 * stat signature that survives an edit-read-restore (content digests do not).
 * Whole scope covers the git-visible worktree and the change; a task review
 * covers the same set plus the change artifacts its digest also binds.
 */
export interface InputSignature {
    /** Walk root, used to render changed paths as evidence. */
    readonly root: string;
    /** Absolute path -> stat signature. */
    readonly entries: ReadonlyMap<string, string>;
}
/** Every file the reviewer can read for one review, before it is prepared. */
export declare function reviewedInputs(cwd: string, changeDir: string, runGit: GitRunner, signal?: AbortSignal): Promise<InputSignature>;
/** Paths whose reviewed input changed (added, removed, or stat mutation). */
export declare function changedInputPaths(signature: InputSignature, current: InputSignature): string[];
/** Stable hash of the source input set a queued review re-checks before start. */
export declare function signatureHash(signature: InputSignature): string;
