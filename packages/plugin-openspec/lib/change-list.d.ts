/**
 * Read the workspace's OpenSpec changes through the documented CLI, then join
 * the file facts the panel renders onto each CLI row.
 *
 * The CLI is a machine prerequisite: this module never installs, downloads,
 * or fetches it. The call is bounded and the whole process tree is killed on
 * timeout, because the npm-installed `openspec` on Windows is a `cmd.exe` shim
 * that spawns a Node grandchild.
 */
/** The task-derived status `openspec list` reports. */
export type CliChangeStatus = 'no-tasks' | 'complete' | 'in-progress';
/** Status a reader acts on; derived from the CLI counts and the archive flag. */
export type ChangePhase = 'planning' | 'ready-to-apply' | 'applying' | 'complete' | 'archived';
/** Artifact kinds one change already carries; `specs` counts delta spec files. */
export interface ChangePresence {
    readonly proposal: boolean;
    readonly design: boolean;
    readonly tasks: boolean;
    readonly specs: number;
}
/** The last commit that touched a workspace path. */
export interface CommitFact {
    readonly short: string;
    readonly at: string;
    readonly subject: string;
}
/** One CLI row, before the file facts are joined. */
export interface WorkspaceChangeRow {
    readonly name: string;
    readonly completedTasks: number;
    readonly totalTasks: number;
    readonly status: CliChangeStatus;
    readonly modified: string | null;
    readonly archived: boolean;
}
/** One change row with the facts the panel renders. */
export interface WorkspaceChange extends WorkspaceChangeRow {
    readonly phase: ChangePhase;
    readonly archivedAt: string | null;
    readonly summary: string | null;
    readonly commit: CommitFact | null;
    readonly presence: ChangePresence;
}
/** Totals the root header renders before any segment body loads. */
export interface ChangeListCounts {
    readonly active: number;
    readonly archived: number;
    readonly capabilities: number;
}
/** The change-list route response; `changes` stays the active-only legacy list. */
export interface WorkspaceChangeList {
    readonly changes: WorkspaceChange[];
    readonly archived: WorkspaceChange[];
    readonly counts: ChangeListCounts;
}
/** One row of the capability inventory. */
export interface CapabilitySummary {
    readonly id: string;
    readonly requirementCount: number;
}
/** One commit section of a `git log --name-only` read. */
export interface GitLogEntry {
    readonly commit: CommitFact;
    readonly paths: readonly string[];
}
/** The injected `git` executor; tests replace it and it never sees a shell. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<string>;
/** Time one `openspec list` call may take before its process tree is killed. */
export declare const LIST_TIMEOUT_MS = 10000;
/** Time one `git log` call may take before it is killed. */
export declare const GIT_TIMEOUT_MS = 5000;
/** Largest `git log` output a read accepts. */
export declare const GIT_MAX_OUTPUT_BYTES: number;
/** Newest commits a list or detail read inspects. */
export declare const GIT_LOG_LIMIT = 300;
/** Longest change summary a row carries; the client clamps it to three lines. */
export declare const SUMMARY_MAX_LENGTH = 360;
/** No OpenSpec root exists in the session workspace itself. */
export declare const NO_LOCAL_ROOT_MESSAGE = "No workspace-local OpenSpec root was found. Run `openspec init --tools none` in the workspace root first.";
/** The documented CLI prerequisite is missing from PATH. */
export declare const MISSING_CLI_MESSAGE = "The OpenSpec CLI (`openspec`) was not found on PATH. Install it with `npm install -g @fission-ai/openspec`.";
/** The CLI call exceeded its bound. */
export declare const TIMEOUT_MESSAGE: string;
/** The CLI output is not the documented JSON shape. */
export declare const MALFORMED_MESSAGE = "`openspec list --json` returned output that could not be read.";
/** The CLI's `list --specs --json` output is not the documented shape. */
export declare const CAPABILITIES_MALFORMED_MESSAGE = "`openspec list --specs --json` returned output that could not be read.";
/** A request-named item resolves outside the workspace's own OpenSpec root. */
export declare const OUTSIDE_ROOT_MESSAGE = "The requested OpenSpec item resolves outside the workspace OpenSpec root.";
/** A change artifact could not be read. */
export declare function artifactReadMessage(path: string, cause: string): string;
/** A capability spec file could not be read. */
export declare function capabilityReadMessage(path: string, cause: string): string;
/** Whether the CLI name resolves through PATH (PATHEXT aware on Windows). */
export declare function cliOnPath(): boolean;
/** The root path of an `openspec list`/`show` response. */
export declare function reportedRoot(parsed: Record<string, unknown>): string | null;
/** The root path of an `openspec status --change` response. */
export declare function planningRoot(parsed: Record<string, unknown>): string | null;
/**
 * Run one bounded `openspec` JSON call against the workspace's own root and
 * return its parsed body.
 *
 * The workspace must carry a local `openspec/` root and the CLI must resolve
 * through PATH; both are refused before spawning. The reported root is checked
 * against the workspace, so an ancestor or declared store root is refused too.
 * @param workspace - absolute session working directory.
 * @param args - CLI arguments after `openspec`.
 * @param label - the command as it appears in readable failures, e.g. `list`.
 * @param rootOf - extracts the reported root from the response shape.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export declare function runOpenSpecJson(workspace: string, args: readonly string[], label: string, rootOf?: (body: Record<string, unknown>) => string | null): Promise<Record<string, unknown>>;
/** The workspace's accepted-capability root, resolved once per read. */
export declare function specsRoot(workspace: string): string;
/** Whether a resolved path is strictly under a directory; case-insensitive on Windows. */
export declare function insidePath(base: string, target: string): boolean;
/** Resolve one request-named item under an OpenSpec root, refusing a lexical escape. */
export declare function containedItem(root: string, item: string): string;
/** Canonical real path of the workspace's own `openspec/` root. */
export declare function canonicalRoot(workspace: string): string;
/** Refuse a canonical path that escaped the canonical OpenSpec root. */
export declare function requireInsideRoot(root: string, actual: string): void;
/** Builds one readable artifact failure message. */
type ArtifactMessage = (path: string, cause: string) => string;
/** Realpath one artifact path; null when absent, a readable error otherwise. */
export declare function realArtifactPath(path: string, message: ArtifactMessage): string | null;
/** Contain one existing artifact path under the canonical root; null stays absent. */
export declare function containedArtifact(root: string, path: string, message: ArtifactMessage): string | null;
/** Whether one artifact path canonically exists under the OpenSpec root. */
export declare function artifactPresent(root: string, path: string): boolean;
/** ISO mtime of a contained artifact; null when it disappeared, readable error otherwise. */
export declare function isoMtime(actual: string, path: string, message: ArtifactMessage): string | null;
/** The newest ISO timestamp among the given ones, or null when there are none. */
export declare function newestModified(times: readonly string[]): string | null;
/** One `specs/<capability>/spec.md` file of a change. */
export interface DeltaSpecFile {
    readonly capability: string;
    readonly file: string;
}
/** The delta spec files under one change directory, sorted by capability. */
export declare function deltaSpecFiles(root: string, changeDirectory: string): DeltaSpecFile[];
/** The artifacts one change directory already carries. */
export declare function presenceAt(workspace: string, directory: string): ChangePresence;
/**
 * List the active and archived change rows `openspec list --all --json` reports.
 * @param workspace - absolute session working directory.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export declare function readWorkspaceChangeRows(workspace: string): Promise<{
    readonly changes: WorkspaceChangeRow[];
    readonly archived: WorkspaceChangeRow[];
}>;
/**
 * List the capability specs of the workspace's own OpenSpec root.
 * @param workspace - absolute session working directory.
 * @returns the `{id, requirementCount}` rows `openspec list --specs --json` reports.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export declare function listWorkspaceCapabilities(workspace: string): Promise<CapabilitySummary[]>;
/** The ISO date prefix of an archived change directory name, or null. */
export declare function archivedDate(name: string): string | null;
/** The status a reader acts on. Archived wins over every task-derived state. */
export declare function changePhase(change: {
    readonly archived: boolean;
    readonly completedTasks: number;
    readonly totalTasks: number;
}): ChangePhase;
/**
 * The one-line change summary: the first paragraph of the proposal's `Why`,
 * falling back to the document's first paragraph. Capped by the header budget.
 * @param proposal - the proposal Markdown, or null when the change carries none.
 */
export declare function proposalSummary(proposal: string | null): string | null;
/** The first paragraph of a spec's `## Purpose` section, if it has one. */
export declare function purposeSection(body: string): string | null;
/** One archived change that carried a delta spec for a capability. */
export interface ArchiveProducer {
    readonly name: string;
    readonly date: string | null;
}
/**
 * Scan `openspec/changes/archive/*` for the capabilities each archived change
 * touched, newest producer first. Existence only; bodies stay with the detail read.
 * @param workspace - absolute session working directory.
 */
export declare function scanArchiveProducers(workspace: string): Map<string, ArchiveProducer[]>;
/**
 * Run one bounded `git log` over workspace-relative paths and return its commit
 * sections newest first, or null on every failure (no git, no repository, a
 * timeout, malformed output, or an unsafe path).
 *
 * `execFile` means no shell; the limit, timeout, and output cap are fixed; the
 * paths follow `--` so a request name can never become an option.
 * @param workspace - absolute session working directory.
 * @param paths - workspace-relative paths to inspect; none may leave the workspace.
 * @param runner - the executor; tests inject one.
 */
export declare function readGitLog(workspace: string, paths: readonly string[], runner?: GitRunner): Promise<GitLogEntry[] | null>;
/** The newest commit that touched a file or any path under a directory. */
export declare function commitFor(entries: readonly GitLogEntry[] | null, target: string): CommitFact | null;
/**
 * Refuse a CLI-reported item name that a Windows `cmd.exe` could re-parse as a
 * command. Quoting alone does not stop `%VAR%` expansion, so a name carrying
 * `%`, a quote, or any other punctuation outside OpenSpec's slug grammar is
 * refused before it reaches the CLI. Nested capability ids keep their `/`.
 * @throws the readable refusal for the name.
 */
export declare function requireSafeCliName(name: string, kind: string): void;
/**
 * List the workspace's changes with the file facts the panel renders.
 *
 * `changes` stays the active-only legacy list the apply picker reads; archived
 * rows travel only in `archived`, and `counts` makes the root header complete
 * before the Specs segment has ever loaded.
 * @param workspace - absolute session working directory.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export declare function listWorkspaceChanges(workspace: string): Promise<WorkspaceChangeList>;
export {};
