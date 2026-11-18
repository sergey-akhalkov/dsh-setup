import type { Evidence } from './definitions.js';
import type { GitRunner } from './git.js';
import type { RunEvidence } from './runs.js';
/**
 * The evidence verifier. It is a pure-ish function over the workspace and the
 * DSH observations: it never calls a model, and a step completes only when the
 * declared contract actually passes. A file path is resolved by path components
 * and refused when it leaves the workspace through `..` or a link.
 */
export type EvidenceFailureReason = 'missing-file' | 'empty-file' | 'too-small' | 'path-escape' | 'invalid-context' | 'no-match' | 'invalid-evidence' | 'record-mismatch' | 'no-call' | 'check-failed' | 'limit-exceeded' | 'unreadable' | 'no-answer' | 'rejected-answer' | 'unsupported';
export interface EvidenceFailure {
    readonly reason: EvidenceFailureReason;
    readonly path?: string;
    /** The failing contract's position inside a nested `all`, e.g. items[1].items[0]. */
    readonly item?: string;
    readonly detail: string;
}
export type EvidenceCheck = {
    readonly ok: true;
    readonly evidence: RunEvidence;
} | {
    readonly ok: false;
    readonly failure: EvidenceFailure;
};
/** One completed tool call the verifier may match against. */
export interface ToolCallObservation {
    readonly callId: string;
    readonly name: string;
    readonly arguments: Readonly<Record<string, unknown>>;
    readonly ok: boolean;
    readonly at?: number;
    /** The turn the call was observed in; absent on older in-memory entries. */
    readonly turn?: number;
    /** The pre-step index the call was observed at, for checkpoint freshness. */
    readonly step?: number;
    /** A bounded result text, for classifying worker starts/answers. */
    readonly detail?: string;
    /** The observation order, for remedy/call ordering. */
    readonly seq?: number;
    /** A write/edit result's canonical prior content; null means the file was new. */
    readonly before?: string | null;
    /** A write/edit result's canonical written content. */
    readonly after?: string;
}
/** One completed foreground shell result the verifier may match against. */
export interface ShellResultObservation {
    readonly callId: string;
    readonly command: string;
    readonly at: number;
    readonly exitCode: number;
    readonly foreground: boolean;
    readonly signal?: string;
    /** The shell tool reported the model cancelled the call. */
    readonly aborted?: boolean;
    readonly timedOut?: boolean;
    readonly sandboxDenied?: boolean;
    /** The run's resolved working directory; when present it must be the workspace. */
    readonly cwd?: string;
    /** The host-decoded foreground status; false marks a failed attempt. */
    readonly ok?: boolean;
}
/** One recorded user answer, from the user-questions service. */
export interface HumanAnswerObservation {
    readonly answer: string;
    readonly at?: number;
}
export interface EvidenceContext {
    /** The session workspace root. */
    readonly workspace: string;
    /** The run whose step is being evaluated, when one exists. */
    readonly runId?: string;
    /** The run context; only validated identifiers are interpolated. */
    readonly values: Readonly<Record<string, unknown>>;
    /** The session's observed tool calls; absent means none is available. */
    readonly toolCalls?: readonly ToolCallObservation[];
    /** Completed foreground shell results observed in this session. */
    readonly shellResults?: readonly ShellResultObservation[];
    /** The step's request time; a check must run after it. */
    readonly stepStartedAt?: number;
    /** The validated erify.commands profile setting; empty keeps verify inert. */
    readonly checkCommands?: readonly string[];
    /** When the turn last wrote a non-documentation file; absent means no code write. */
    readonly lastWriteAt?: number;
    /** The latest written path, for the bounded refusal text. */
    readonly lastWritePath?: string;
    /** The latest successful configured check, retained across buffer eviction. */
    readonly lastCheckAt?: number;
    /** Recorded user answers for the step's question. */
    readonly answers?: readonly HumanAnswerObservation[];
    /** Whether the step is marked nonCritical, the only declaration consumer. */
    readonly nonCriticalStep?: boolean;
    /** The host git runner a worktree-bound record digest is recomputed with. */
    readonly runGit?: GitRunner;
}
/** Interpolate every placeholder in a free-form string with a validated value. */
export declare function resolveEvidenceText(value: string, context: EvidenceContext, item?: string): {
    readonly ok: true;
    readonly text: string;
} | {
    readonly ok: false;
    readonly failure: EvidenceFailure;
};
export interface GlobFailure {
    readonly reason: EvidenceFailureReason;
    readonly detail: string;
    readonly path?: string;
}
export interface GlobExpansion {
    readonly matches: readonly string[];
    readonly failure?: GlobFailure;
}
/**
 * Expand a segment glob under the workspace. A traversal that hits the depth or
 * entry limit, or meets an escaping symlink, fails instead of approving the
 * partial result it happened to see.
 */
export declare function expandGlob(root: string, pattern: string): Promise<GlobExpansion>;
/**
 * Whether the metadata text declares the boolean `skip_specs: true`. The YAML
 * document is parsed and resolved the way OpenSpec parses it: duplicate keys
 * (including a quoted or escaped spelling of the same key) are invalid metadata
 * and fail closed, quoted keys and aliases decode to the same field, and a
 * string `"true"` is not the boolean.
 */
export declare function declaresSkipSpecsText(text: string): boolean;
/**
 * Whether the change's `.openspec.yaml` declares `skip_specs: true`. The marker
 * only counts while the file resolves inside the change directory; a link out of
 * the workspace is not a declaration.
 */
export declare function declaresSkipSpecs(changeDir: string): Promise<boolean>;
/**
 * The change artifact digest: it hashes every file under the change directory
 * (except the portable `reviews/` directory), normalizing `tasks.md` checkbox
 * state and binding the effective `skip_specs` declaration, so adding, changing,
 * or removing the marker invalidates a review record.
 */
export declare function specDigest(changeDir: string): Promise<string>;
/** The current digest of one change, or undefined when it does not exist. */
export declare function currentSpecDigest(workspace: string, change: string): Promise<string | undefined>;
/**
 * The per-scope review digest. A task review binds the frozen snapshot; a whole
 * review binds the worktree when its evidence declares the worktree digest, so
 * a code-only edit invalidates a previous whole-worktree PASS.
 */
export declare function reviewDigest(input: {
    readonly scope: 'whole' | 'task';
    readonly specDigest: string;
    readonly tree?: string;
    /** The frozen change-artifact digest a task review also binds to. */
    readonly artifactDigest?: string;
}): string;
/** The logical `shell` tool maps to the host's registered foreground shell. */
export declare function hostToolName(name: string): string;
/** Whether an observed tool is the declared tool; `shell` matches the host shell. */
export declare function toolNameMatches(declared: string, observed: string): boolean;
/** Whether a recorded working directory names the workspace root. */
export declare function sameCheckDirectory(left: string, right: string): boolean;
/** True when a write target is planning scratch or documentation, not code. */
export declare function ignoredWrite(path: string): boolean;
/** When the turn last wrote a non-documentation file, from its tool calls. */
export declare function lastCodeWriteAt(calls: readonly ToolCallObservation[], workspace?: string): number | undefined;
/** The legacy command matcher: the invocation matches a configured command
 * directly, or after removing one leading rtk wrapper from the invocation. */
export declare function commandMatches(configured: string, invocation: string): boolean;
/** Resolve every workspace-relative path an evidence contract will check. */
export declare function collectEvidencePaths(value: Evidence, context: EvidenceContext, item?: string): string[];
export declare function describeEvidence(value: Evidence, context: EvidenceContext): string;
/** Verify one evidence contract; an `all` returns the first failing item. */
export declare function verifyEvidence(value: Evidence, context: EvidenceContext, item?: string): Promise<EvidenceCheck>;
/** Read a file only when it stays inside the workspace; undefined otherwise. */
export declare function readWorkspaceFile(workspace: string, path: string): Promise<{
    text: string;
    bytes: number;
} | undefined>;
/** The workspace-relative display path; never an absolute machine path. */
export declare function workspaceRelative(workspace: string, path: string): string;
