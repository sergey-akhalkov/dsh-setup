/**
 * The bounded git seam shared by the trigger condition's worktree digest and
 * the review snapshot. The shell is never used: arguments are fixed and no
 * user text is interpolated. Ported from the delegation runtime; the copy is
 * dropped with that plugin in Release B.
 */
/** One fixed-argument git invocation; output is raw bytes so diffs stay lossless. */
export type GitRunner = (args: readonly string[], cwd: string, signal?: AbortSignal, 
/** Extra environment, merged over `process.env`; used for `GIT_INDEX_FILE`. */
env?: Record<string, string>, 
/** Bytes written to the child's stdin and closed; used for `--stdin` path lists. */
stdin?: string | Buffer) => Promise<Buffer>;
export declare class GitError extends Error {
    constructor(message: string);
}
/** The production runner: spawn git with the fixed argument list. */
export declare function defaultGit(args: readonly string[], cwd: string, signal?: AbortSignal, env?: Record<string, string>, stdin?: string | Buffer): Promise<Buffer>;
/** Path entries and diff bytes, ignoring the engine's own state and scratch. */
export declare function ignoredForDigest(path: string): boolean;
export declare function repositoryRoot(cwd: string, runGit: GitRunner, signal?: AbortSignal): Promise<string>;
/**
 * The implementation-state fingerprint: every dirty implementation file's
 * status code and content. Unlike a write observation it sees a shell edit, so
 * a turn-start/close comparison cannot miss one. Undefined when git cannot read
 * the tree; the caller then falls back to the write observations.
 */
export declare function implementationFingerprint(cwd: string, runGit: GitRunner, signal?: AbortSignal): Promise<string | undefined>;
/**
 * The worktree content digest: tracked diffs plus untracked files, ignoring the
 * engine's own `.dsh` and `.tmp` state. Undefined when git cannot read the tree.
 */
export declare function worktreeDigest(cwd: string, runGit: GitRunner, signal?: AbortSignal): Promise<string | undefined>;
