import type { Evidence } from './definitions.js';
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
}
/** One completed foreground shell result the verifier may match against. */
export interface ShellResultObservation {
    readonly callId: string;
    readonly command: string;
    readonly at: number;
    readonly exitCode: number;
    readonly foreground: boolean;
    readonly signal?: string;
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
    /** The run context; only validated identifiers are interpolated. */
    readonly values: Readonly<Record<string, unknown>>;
    /** The session's observed tool calls; absent means none is available. */
    readonly toolCalls?: readonly ToolCallObservation[];
    /** Completed foreground shell results observed in this session. */
    readonly shellResults?: readonly ShellResultObservation[];
    /** The step's request time; a check must run after it. */
    readonly stepStartedAt?: number;
    /** Recorded user answers for the step's question. */
    readonly answers?: readonly HumanAnswerObservation[];
    /** Whether the step is marked nonCritical, the only declaration consumer. */
    readonly nonCriticalStep?: boolean;
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
 * The change artifact digest, replicated from the delegation-rules reader: it
 * hashes every file under the change directory (except `.openspec.yaml` and the
 * portable `reviews/` directory), normalizing `tasks.md` checkbox state.
 */
export declare function specDigest(changeDir: string): Promise<string>;
/** The current digest of one change, or undefined when it does not exist. */
export declare function currentSpecDigest(workspace: string, change: string): Promise<string | undefined>;
/** The logical `shell` tool maps to the host's registered foreground shell. */
export declare function hostToolName(name: string): string;
/** Whether an observed tool is the declared tool; `shell` matches the host shell. */
export declare function toolNameMatches(declared: string, observed: string): boolean;
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
