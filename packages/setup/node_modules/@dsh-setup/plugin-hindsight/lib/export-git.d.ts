/** Fixed identity: the export repository must not borrow the user's Git identity. */
export declare const EXPORT_GIT_IDENTITY: Readonly<{
    name: "Hindsight Export";
    email: "hindsight-export@localhost";
}>;
/** Ignored scratch and journal paths, written only when the file is absent. */
export declare const EXPORT_GITIGNORE: string;
/** Write (or reuse) the failing askpass helper inside the repository. */
export declare function prepareAskpass(dir: string): string;
export interface GitRunOptions {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
    allowFailure?: boolean;
    /** Failing askpass program; set for every command that may authenticate. */
    askpass?: string;
}
export interface GitRunResult {
    code: number;
    stdout: string;
    stderr: string;
}
/** Diagnostics for one command, for callers that expect a failure. */
export declare function gitOutput(args: string[], options: GitRunOptions): Promise<GitRunResult>;
export interface GitBootstrapOptions {
    dir: string;
    /** Private remote; its absence keeps the repository local. */
    remote?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}
export interface GitBootstrapResult {
    /** `clone`, `init`, or `existing`. */
    created: 'clone' | 'init' | 'existing';
}
/**
 * Prepare the export repository: clone the private remote when it is missing,
 * otherwise initialize a local one, and keep `origin` in sync with the
 * machine-local configuration.
 */
export declare function bootstrapRepository(options: GitBootstrapOptions): Promise<GitBootstrapResult>;
export interface CommitOptions {
    message: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}
/** Commit everything the snapshot wrote; a clean tree creates no commit. */
export declare function commitSnapshot(dir: string, options: CommitOptions): Promise<{
    committed: boolean;
}>;
/** The branch the repository is on; a detached or unborn HEAD reports `main`. */
export declare function currentBranch(dir: string): Promise<string>;
/** Whether the repository already has a commit to push. */
export declare function hasCommits(dir: string): Promise<boolean>;
export interface PushOptions {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}
export interface PushResult {
    pushed: boolean;
    /** Why the push did not happen; the local commits stay for the next cycle. */
    reason?: string;
}
/**
 * Push the current branch without force. A diverged remote is reconciled with a
 * fetch and rebase (this runs under the single-writer lock); anything else keeps
 * the local commit and reports, and the next cycle tries again.
 */
export declare function pushSnapshot(dir: string, options?: PushOptions): Promise<PushResult>;
