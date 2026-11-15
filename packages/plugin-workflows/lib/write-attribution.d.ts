import type { ToolCallObservation } from './evidence.js';
/**
 * Attribute this turn's successful OpenSpec writes before the debounced filesystem
 * watcher delivers its event. Paths are resolved against the workspace and
 * normalized so an absolute or `./` form cannot bypass the change attribution.
 */
/** A workspace-relative slash path for one observed write path, or undefined. */
export declare function normalizedWorkspacePath(workspace: string, raw: string): string | undefined;
/**
 * The latest successful change-artifact write this turn, as a normalized
 * workspace-relative path. A failed, review, or out-of-workspace write is not
 * an attribution.
 */
export declare function attributedSpecWrite(workspace: string, calls: readonly ToolCallObservation[], turn: number | undefined): string | undefined;
/** Whether a directory is the workspace root or one of its descendants. */
export declare function isWorkspaceDirectory(workspace: string, directory: string): boolean;
/**
 * Every change this turn made, from successful write/edit observations and the
 * documented creation and shell-write commands. A turn may touch more than one.
 */
export declare function attributedChangeNames(workspace: string, calls: readonly ToolCallObservation[], turn: number | undefined): string[];
/** The latest change this turn made, for callers that need one. */
export declare function attributedChangeName(workspace: string, calls: readonly ToolCallObservation[], turn: number | undefined): string | undefined;
