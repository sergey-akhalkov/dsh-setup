import { execFile, spawn } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
/** Time one `openspec list` call may take before its process tree is killed. */
export const LIST_TIMEOUT_MS = 10_000;
/** No OpenSpec root exists in the session workspace itself. */
export const NO_LOCAL_ROOT_MESSAGE = 'No workspace-local OpenSpec root was found. Run `openspec init --tools none` in the workspace root first.';
/** The documented CLI prerequisite is missing from PATH. */
export const MISSING_CLI_MESSAGE = 'The OpenSpec CLI (`openspec`) was not found on PATH. Install it with `npm install -g @fission-ai/openspec`.';
/** The CLI call exceeded its bound. */
export const TIMEOUT_MESSAGE = `\`openspec list\` did not finish within ${String(LIST_TIMEOUT_MS / 1000)} seconds.`;
/** The CLI output is not the documented JSON shape. */
export const MALFORMED_MESSAGE = '`openspec list --json` returned output that could not be read.';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** Whether the CLI name resolves through PATH (PATHEXT aware on Windows). */
export function cliOnPath() {
    const path = process.env.PATH;
    if (path === undefined)
        return false;
    const extensions = process.platform === 'win32'
        ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter((entry) => entry !== '')
        : [''];
    for (const directory of path.split(delimiter)) {
        if (directory === '')
            continue;
        for (const extension of extensions) {
            try {
                if (statSync(join(directory, `openspec${extension}`)).isFile())
                    return true;
            }
            catch {
                // Try the next candidate.
            }
        }
    }
    return false;
}
/** Compare the CLI's reported root with the workspace, canonicalizing both. */
function sameRoot(reported, workspace) {
    try {
        const left = realpathSync.native(reported);
        const right = realpathSync.native(workspace);
        return process.platform === 'win32'
            ? left.toLowerCase() === right.toLowerCase()
            : left === right;
    }
    catch {
        return false;
    }
}
function requireRoot(parsed, workspace) {
    if (!isRecord(parsed.root) || typeof parsed.root.path !== 'string') {
        throw new Error(NO_LOCAL_ROOT_MESSAGE);
    }
    if (!sameRoot(parsed.root.path, workspace))
        throw new Error(NO_LOCAL_ROOT_MESSAGE);
}
function isStatus(value) {
    return value === 'no-tasks' || value === 'complete' || value === 'in-progress';
}
function parseChanges(value) {
    if (!Array.isArray(value.changes))
        throw new Error(MALFORMED_MESSAGE);
    return value.changes.map((entry) => {
        if (!isRecord(entry) ||
            typeof entry.name !== 'string' ||
            entry.name.trim() === '' ||
            typeof entry.completedTasks !== 'number' ||
            !Number.isInteger(entry.completedTasks) ||
            typeof entry.totalTasks !== 'number' ||
            !Number.isInteger(entry.totalTasks) ||
            !isStatus(entry.status)) {
            throw new Error(MALFORMED_MESSAGE);
        }
        return {
            name: entry.name,
            completedTasks: entry.completedTasks,
            totalTasks: entry.totalTasks,
            status: entry.status,
        };
    });
}
/** Bound on waiting for the Windows tree cleanup before the timeout settles anyway. */
const TREE_KILL_TIMEOUT_MS = 2_000;
/** Wait for `taskkill` to finish; resolves whether the tree termination completed. */
function taskkillTree(pid) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), TREE_KILL_TIMEOUT_MS);
        try {
            execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
                clearTimeout(timer);
                resolve(error === null);
            });
        }
        catch {
            clearTimeout(timer);
            resolve(false);
        }
    });
}
/** Terminate the whole spawned tree; the Windows shim's Node child outlives a plain kill. */
function killTree(pid) {
    if (pid === undefined)
        return Promise.resolve(false);
    if (process.platform === 'win32')
        return taskkillTree(pid);
    try {
        process.kill(-pid, 'SIGKILL');
        return Promise.resolve(true);
    }
    catch {
        // The process group already exited.
        return Promise.resolve(false);
    }
}
/** Whether a non-zero exit still carried the CLI's own "no root" JSON response. */
function nullRootOutput(stdout) {
    try {
        const parsed = JSON.parse(stdout);
        return isRecord(parsed) && parsed.root === null;
    }
    catch {
        return false;
    }
}
/** Run one bounded `openspec` CLI call and return its stdout. */
function runCli(workspace, args, label) {
    const file = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'openspec';
    const command = process.platform === 'win32' ? ['/d', '/s', '/c', 'openspec', ...args] : [...args];
    return new Promise((resolve, reject) => {
        const child = spawn(file, command, {
            cwd: workspace,
            stdio: ['ignore', 'pipe', 'pipe'],
            ...(process.platform === 'win32' ? { windowsHide: true } : { detached: true }),
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        let childExited = false;
        const finish = (settle) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            settle();
        };
        // shortcut: on Windows taskkill /T needs the cmd.exe shim alive, so a
        // detached descendant that outlives the shim is reported as unconfirmed
        // rather than killed; move to a job object or supervisor if the CLI ever
        // detaches.
        const timer = setTimeout(() => {
            timedOut = true;
            const tree = process.platform !== 'win32' || !childExited;
            void (tree ? killTree(child.pid) : Promise.resolve(false)).then((killed) => {
                finish(() => reject(new Error(killed
                    ? TIMEOUT_MESSAGE
                    : `${TIMEOUT_MESSAGE} Its process tree could not be confirmed terminated.`)));
            });
        }, LIST_TIMEOUT_MS);
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk) => {
            stdout += chunk;
        });
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk) => {
            stderr += chunk;
        });
        // A stale Windows PID may be reused; never taskkill one after its process exited.
        child.on('exit', () => {
            childExited = true;
        });
        child.on('error', (error) => {
            if (timedOut)
                return;
            finish(() => reject(new Error(error.code === 'ENOENT'
                ? MISSING_CLI_MESSAGE
                : `\`openspec ${label}\` could not run: ${error.message}`)));
        });
        child.on('close', (code) => {
            // A surviving descendant keeps the inherited pipes open, so the timeout
            // path owns settlement once it has started the tree kill.
            if (timedOut)
                return;
            finish(() => {
                if (code === 0)
                    resolve(stdout);
                else if (nullRootOutput(stdout))
                    reject(new Error(NO_LOCAL_ROOT_MESSAGE));
                else {
                    reject(new Error(`\`openspec ${label}\` failed: ${stderr.trim() === '' ? `exit code ${String(code)}` : stderr.trim()}`));
                }
            });
        });
    });
}
/**
 * Run one bounded `openspec list`-family call against the workspace's own root
 * and return its parsed JSON.
 *
 * The workspace must carry a local `openspec/` root and the CLI must resolve
 * through PATH; both are refused before spawning. The reported root is checked
 * against the workspace, so an ancestor or declared store root is refused too.
 * @param workspace - absolute session working directory.
 * @param args - CLI arguments after `openspec`.
 * @param label - the command as it appears in readable failures, e.g. `list`.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export async function runOpenSpecJson(workspace, args, label) {
    let isDirectory = false;
    try {
        isDirectory = statSync(join(workspace, 'openspec')).isDirectory();
    }
    catch {
        isDirectory = false;
    }
    if (!isDirectory)
        throw new Error(NO_LOCAL_ROOT_MESSAGE);
    if (!cliOnPath())
        throw new Error(MISSING_CLI_MESSAGE);
    const output = await runCli(workspace, args, label);
    let parsed;
    try {
        parsed = JSON.parse(output);
    }
    catch {
        throw new Error(MALFORMED_MESSAGE);
    }
    if (!isRecord(parsed))
        throw new Error(MALFORMED_MESSAGE);
    requireRoot(parsed, workspace);
    return parsed;
}
/**
 * List the changes of the workspace's own OpenSpec root.
 * @param workspace - absolute session working directory.
 * @returns the changes `openspec list --json` reports there.
 * @throws a readable error for a missing CLI, no local root, a timeout, or malformed output.
 */
export async function listWorkspaceChanges(workspace) {
    return parseChanges(await runOpenSpecJson(workspace, ['list', '--json'], 'list'));
}
