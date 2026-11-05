import { type CapabilitySummary, type ChangePhase, type ChangePresence, type CommitFact, type WorkspaceChangeRow } from './change-list.js';
/**
 * Read one change's planning artifacts and the workspace's capability specs.
 *
 * Lists and counts come from the documented CLI; artifact bodies come from
 * files, because no CLI command returns them. Every path is built by joining
 * under the session workspace's own `openspec/` root and checked after
 * resolution, and the item name must first appear in the CLI's list for the
 * matching family, so a request never contributes a filesystem path. Reads then
 * canonicalize the real path and refuse anything outside the workspace's own
 * OpenSpec root, so a symlink or junction cannot serve a file from elsewhere.
 */
/** One delta spec of a change, with that file's ISO last-modified time. */
export interface DeltaSpec {
    readonly capability: string;
    readonly body: string;
    readonly modified: string;
}
/** The operation a delta section declares. */
export type DeltaOperation = 'ADDED' | 'MODIFIED' | 'REMOVED' | 'RENAMED';
/** One requirement with its scenarios, as the CLI reports it. */
export interface Requirement {
    readonly name: string;
    readonly text: string;
    readonly scenarios: ReadonlyArray<{
        readonly name: string;
        readonly rawText: string;
    }>;
}
/** One parsed delta section; `RENAMED` carries a pair and no requirements. */
export interface Delta {
    readonly capability: string;
    readonly operation: DeltaOperation;
    readonly requirements: readonly Requirement[];
    readonly rename?: {
        readonly from: string;
        readonly to: string;
    };
}
/** One task file the checklist parses, addressed workspace-relative. */
export interface TaskFile {
    readonly path: string;
    readonly body: string;
}
/** Everything the change view renders for one CLI-reported change. */
export interface WorkspaceChangeDetail {
    readonly name: string;
    readonly status: WorkspaceChangeRow['status'];
    readonly phase: ChangePhase;
    readonly completedTasks: number;
    readonly totalTasks: number;
    readonly archived: boolean;
    readonly archivedAt: string | null;
    readonly summary: string | null;
    readonly modified: string | null;
    readonly commit: CommitFact | null;
    readonly presence: ChangePresence;
    readonly artifacts: {
        readonly proposal: string | null;
        readonly design: string | null;
        readonly tasks: string | null;
    };
    readonly specs: DeltaSpec[];
    readonly deltas: Delta[];
    readonly taskFiles: TaskFile[];
}
/** One archived change that produced a capability, with its commit facts. */
export interface CapabilityHistoryEntry {
    readonly name: string;
    readonly date: string;
    readonly completedTasks: number;
    readonly totalTasks: number;
    readonly commit: CommitFact | null;
}
/** One row of the capability inventory the panel renders. */
export interface CapabilityRow extends CapabilitySummary {
    readonly purpose: string;
    readonly modified: string | null;
    readonly lastChange: CapabilityHistoryEntry | null;
    readonly commit: CommitFact | null;
}
/** One capability's accepted spec, its structured requirements and its history. */
export interface CapabilityDetail extends CapabilityRow {
    readonly body: string;
    readonly requirements: readonly Requirement[];
    readonly history: readonly CapabilityHistoryEntry[];
}
/** The requested change or capability is not in the CLI's list for the workspace. */
export declare class UnreportedItemError extends Error {
}
/** The requested change is not in the CLI's list for this workspace. */
export declare function unreportedChangeMessage(name: string): string;
/** The requested archived change is not in the CLI's archived list for this workspace. */
export declare function unreportedArchivedChangeMessage(name: string): string;
/** The requested capability is not in the CLI's inventory for this workspace. */
export declare function unreportedCapabilityMessage(id: string): string;
/** The CLI's structured requirement output is not the documented shape. */
export declare const REQUIREMENTS_MALFORMED_MESSAGE = "`openspec show --json` returned requirement data that could not be read.";
/**
 * Parse one archived delta spec file, line by line.
 *
 * The sections and headers are the delta grammar the CLI itself accepts; text
 * is preserved verbatim. A file with no delta section yields nothing, so the
 * view falls back to the raw Markdown body it already carries.
 * @param capability - the capability the delta file belongs to.
 * @param body - the delta spec Markdown.
 */
export declare function parseArchivedDeltas(capability: string, body: string): Delta[];
/**
 * Read one change's artifact bodies, deltas, task files and progress.
 * @param workspace - absolute session working directory.
 * @param name - a change name the CLI reports for the matching family.
 * @param archived - resolve the name against the archived list only.
 * @throws a readable error when the change is unreported, escapes the root, or an artifact is unreadable.
 */
export declare function readWorkspaceChange(workspace: string, name: string, archived?: boolean): Promise<WorkspaceChangeDetail>;
/**
 * List the capability inventory with purpose, last modification and provenance.
 * @param workspace - absolute session working directory.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export declare function listWorkspaceCapabilityRows(workspace: string): Promise<CapabilityRow[]>;
/**
 * Read one capability's accepted spec, structured requirements and history.
 * @param workspace - absolute session working directory.
 * @param id - a capability id the CLI reports for this workspace.
 * @throws a readable error when the capability is unreported, escapes the root, or an artifact is unreadable.
 */
export declare function readWorkspaceCapability(workspace: string, id: string): Promise<CapabilityDetail>;
