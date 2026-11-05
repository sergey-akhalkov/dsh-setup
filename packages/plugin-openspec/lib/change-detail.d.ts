import { type WorkspaceChange } from './change-list.js';
/**
 * Read one change's planning artifacts and the workspace's capability specs.
 *
 * Lists and counts come from the documented CLI; artifact bodies come from
 * files, because no CLI command returns them. Every path is built by joining
 * under the session workspace's own `openspec/` root and checked after
 * resolution, and the item name must first appear in the CLI's list, so a
 * request never contributes a filesystem path. Reads then canonicalize the
 * real path and refuse anything outside the workspace's own OpenSpec root, so a
 * symlink or junction cannot serve a file from elsewhere.
 */
/** Artifact kinds one change already carries; `specs` counts delta spec files. */
export interface ChangePresence {
    readonly proposal: boolean;
    readonly design: boolean;
    readonly tasks: boolean;
    readonly specs: number;
}
/** One delta spec of a change, with that file's ISO last-modified time. */
export interface DeltaSpec {
    readonly capability: string;
    readonly body: string;
    readonly modified: string;
}
/** Everything the change view renders for one CLI-reported change. */
export interface WorkspaceChangeDetail {
    readonly name: string;
    readonly status: WorkspaceChange['status'];
    readonly completedTasks: number;
    readonly totalTasks: number;
    readonly presence: ChangePresence;
    readonly modified: string | null;
    readonly artifacts: {
        readonly proposal: string | null;
        readonly design: string | null;
        readonly tasks: string | null;
    };
    readonly specs: DeltaSpec[];
}
/** One row of the workspace's capability inventory. */
export interface CapabilitySummary {
    readonly id: string;
    readonly requirementCount: number;
}
/** One capability's accepted spec body and file last-modified time. */
export interface CapabilityDetail extends CapabilitySummary {
    readonly body: string;
    readonly modified: string;
}
/** The requested change or capability is not in the CLI's list for the workspace. */
export declare class UnreportedItemError extends Error {
}
/** The requested change is not in the CLI's list for this workspace. */
export declare function unreportedChangeMessage(name: string): string;
/** The requested capability is not in the CLI's inventory for this workspace. */
export declare function unreportedCapabilityMessage(id: string): string;
/** A request-named item resolves outside the workspace's own OpenSpec root. */
export declare const OUTSIDE_ROOT_MESSAGE = "The requested OpenSpec item resolves outside the workspace OpenSpec root.";
/** A change artifact could not be read. */
export declare function artifactReadMessage(path: string, cause: string): string;
/** A capability spec file could not be read. */
export declare function capabilityReadMessage(path: string, cause: string): string;
/** The CLI's `list --specs --json` output is not the documented shape. */
export declare const CAPABILITIES_MALFORMED_MESSAGE = "`openspec list --specs --json` returned output that could not be read.";
/**
 * The artifacts one CLI-reported change already carries.
 * @param workspace - absolute session working directory.
 * @param name - a change name; the changes route passes CLI rows only.
 */
export declare function changePresence(workspace: string, name: string): ChangePresence;
/**
 * Read one change's artifact bodies and progress.
 * @param workspace - absolute session working directory.
 * @param name - a change name the CLI reports for this workspace.
 * @throws a readable error when the change is unreported, escapes the root, or an artifact is unreadable.
 */
export declare function readWorkspaceChange(workspace: string, name: string): Promise<WorkspaceChangeDetail>;
/**
 * List the capability specs of the workspace's own OpenSpec root.
 * @param workspace - absolute session working directory.
 * @returns the `{id, requirementCount}` rows `openspec list --specs --json` reports.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export declare function listWorkspaceCapabilities(workspace: string): Promise<CapabilitySummary[]>;
/**
 * Read one capability's accepted spec body.
 * @param workspace - absolute session working directory.
 * @param id - a capability id the CLI reports for this workspace.
 * @throws a readable error when the capability is unreported, escapes the root, or its spec is unreadable.
 */
export declare function readWorkspaceCapability(workspace: string, id: string): Promise<CapabilityDetail>;
