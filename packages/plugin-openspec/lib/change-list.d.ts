/**
 * Read the workspace's OpenSpec changes through the documented CLI.
 *
 * The CLI is a machine prerequisite: this module never installs, downloads,
 * or fetches it. The call is bounded and the whole process tree is killed on
 * timeout, because the npm-installed `openspec` on Windows is a `cmd.exe` shim
 * that spawns a Node grandchild.
 */
/** One row of `openspec list --json`, as the picker needs it. */
export interface WorkspaceChange {
    readonly name: string;
    readonly completedTasks: number;
    readonly totalTasks: number;
    readonly status: 'no-tasks' | 'complete' | 'in-progress';
}
/** Time one `openspec list` call may take before its process tree is killed. */
export declare const LIST_TIMEOUT_MS = 10000;
/** No OpenSpec root exists in the session workspace itself. */
export declare const NO_LOCAL_ROOT_MESSAGE = "No workspace-local OpenSpec root was found. Run `openspec init --tools none` in the workspace root first.";
/** The documented CLI prerequisite is missing from PATH. */
export declare const MISSING_CLI_MESSAGE = "The OpenSpec CLI (`openspec`) was not found on PATH. Install it with `npm install -g @fission-ai/openspec`.";
/** The CLI call exceeded its bound. */
export declare const TIMEOUT_MESSAGE: string;
/** The CLI output is not the documented JSON shape. */
export declare const MALFORMED_MESSAGE = "`openspec list --json` returned output that could not be read.";
/** Whether the CLI name resolves through PATH (PATHEXT aware on Windows). */
export declare function cliOnPath(): boolean;
/**
 * List the changes of the workspace's own OpenSpec root.
 * @param workspace - absolute session working directory.
 * @returns the changes `openspec list --json` reports there.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export declare function listWorkspaceChanges(workspace: string): Promise<WorkspaceChange[]>;
