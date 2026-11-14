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
