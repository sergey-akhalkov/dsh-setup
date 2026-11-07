import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
/**
 * Workspace file source for `openspec/changes/**`. The filesystem service owns
 * the watch itself (directory watches see direct entries only), so this module
 * watches the tree's directories and re-scans the files it cares about after a
 * per-path debounce; a watcher error triggers a rescan so a dropped event stays
 * visible. Every read is canonically checked against the workspace root, so a
 * link cannot pull another workspace's files into this one.
 */
/** Debounce window applied to coalesced watcher notifications. */
export const FS_CHANGE_DEBOUNCE_MS = 250;
/** The workspace-relative root this source observes. */
export const CHANGES_ROOT = 'openspec/changes';
/** The files a workflow cares about inside one change directory. */
const CHANGE_FILES = ['tasks.md', 'proposal.md', 'design.md'];
/** Content larger than this is identified by size and mtime instead of bytes. */
const MAX_HASH_BYTES = 256 * 1024;
function toPosix(path) {
    return path.replaceAll('\\', '/');
}
function relativePath(workspace, path) {
    return toPosix(relative(workspace, path));
}
function errorOf(error) {
    return error instanceof Error ? error : new Error(String(error));
}
/** Whether a canonical target stays inside a canonical root. */
export function isInside(root, target) {
    const rel = relative(root, target);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
async function canonicalInside(root, target) {
    try {
        const real = await realpath(target);
        return isInside(root, real) ? real : undefined;
    }
    catch {
        return undefined;
    }
}
async function listEntries(path) {
    try {
        const entries = await readdir(path, { withFileTypes: true });
        return {
            exists: true,
            directories: entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
            files: entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
        };
    }
    catch {
        return { exists: false, directories: [], files: [] };
    }
}
/** Read one file's identity; oversized files use size and mtime instead of bytes. */
async function fileEntry(file) {
    try {
        const info = await stat(file);
        if (!info.isFile())
            return undefined;
        if (info.size > MAX_HASH_BYTES) {
            return { sig: `${String(info.size)}:${String(info.mtimeMs)}`, hash: '' };
        }
        const content = await readFile(file);
        const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);
        return { sig: `${String(info.size)}:${String(info.mtimeMs)}:${hash}`, hash };
    }
    catch {
        return undefined;
    }
}
/** The files and watched directories of one workspace's change tree. */
async function snapshot(workspace, onError) {
    const files = new Map();
    const dirs = new Set([CHANGES_ROOT]);
    // Resolve the workspace itself independently: a workspace opened through a
    // junction must still scan its real tree, not fail containment against itself.
    let workspaceReal;
    try {
        workspaceReal = await realpath(workspace);
    }
    catch {
        return { files, dirs };
    }
    const addFile = async (file) => {
        try {
            await lstat(file);
        }
        catch {
            return;
        }
        if ((await canonicalInside(workspaceReal, file)) === undefined) {
            onError(new Error(`skipped a change file outside the workspace: ${relativePath(workspace, file)}`));
            return;
        }
        const entry = await fileEntry(file);
        if (entry !== undefined)
            files.set(relativePath(workspace, file), entry);
    };
    const addChange = async (directory) => {
        if ((await canonicalInside(workspaceReal, directory)) === undefined) {
            onError(new Error(`skipped a change directory outside the workspace: ${relativePath(workspace, directory)}`));
            return;
        }
        dirs.add(relativePath(workspace, directory));
        for (const name of CHANGE_FILES)
            await addFile(join(directory, name));
        const reviews = join(directory, 'reviews');
        const entries = await listEntries(reviews);
        if (!entries.exists)
            return;
        if ((await canonicalInside(workspaceReal, reviews)) === undefined) {
            onError(new Error(`skipped a reviews directory outside the workspace: ${relativePath(workspace, reviews)}`));
            return;
        }
        dirs.add(relativePath(workspace, reviews));
        for (const name of entries.files) {
            if (!name.endsWith('.json'))
                continue;
            await addFile(join(reviews, name));
        }
    };
    const root = join(workspace, CHANGES_ROOT);
    const rootEntries = await listEntries(root);
    if (!rootEntries.exists)
        return { files, dirs };
    if ((await canonicalInside(workspaceReal, root)) === undefined) {
        onError(new Error(`skipped a change root outside the workspace: ${relativePath(workspace, root)}`));
        return { files, dirs };
    }
    for (const name of rootEntries.directories) {
        if (name === 'archive') {
            const archive = join(root, name);
            if ((await canonicalInside(workspaceReal, archive)) === undefined)
                continue;
            dirs.add(relativePath(workspace, archive));
            for (const archived of (await listEntries(archive)).directories) {
                await addChange(join(archive, archived));
            }
        }
        else {
            await addChange(join(root, name));
        }
    }
    return { files, dirs };
}
function diff(previous, next) {
    const events = [];
    for (const [path, entry] of next.files) {
        const before = previous.files.get(path);
        if (before === undefined) {
            events.push({ path, change: 'created', hash: entry.hash });
        }
        else if (before.sig !== entry.sig) {
            events.push({ path, change: 'modified', hash: entry.hash });
        }
    }
    for (const path of previous.files.keys()) {
        if (!next.files.has(path))
            events.push({ path, change: 'deleted' });
    }
    return events;
}
/**
 * Start one workspace's change-tree watcher. The initial scan is a silent
 * baseline; watches attach, then one rescan catches an edit made while they were
 * initializing. Later scans emit ordered create/modify/delete events after a
 * per-directory debounce window.
 */
export async function startFsChangeWatcher(options) {
    const debounceMs = options.debounceMs ?? FS_CHANGE_DEBOUNCE_MS;
    const controller = new AbortController();
    const handles = new Map();
    const timers = new Map();
    /** Watched directories whose debounce window is still open. */
    const pending = new Set();
    /** Paths whose event must wait for their own directory's window. */
    const deferred = new Map();
    let current = await snapshot(options.workspace, options.onError);
    let disposed = false;
    let reconciling = Promise.resolve();
    /** The longest watched directory containing a path, or CHANGES_ROOT. */
    const directoryOf = (dirs, path) => {
        let owner = CHANGES_ROOT;
        let length = CHANGES_ROOT.length;
        for (const target of dirs) {
            if (target.length <= length)
                continue;
            if (path === target || path.startsWith(`${target}/`)) {
                owner = target;
                length = target.length;
            }
        }
        return owner;
    };
    const attach = async (target) => {
        try {
            const resolved = await options.fs.resolve(join(options.workspace, target), {
                cwd: options.workspace,
            });
            const close = await options.fs.watch(resolved, (error) => {
                if (disposed)
                    return;
                if (error !== undefined) {
                    options.onError(error);
                    options.onRescan?.(`watcher error: ${error.message}`);
                    schedule(target, 0);
                    return;
                }
                schedule(target, debounceMs);
            }, controller.signal);
            handles.set(target, close);
        }
        catch (error) {
            options.onError(errorOf(error));
        }
    };
    const reconcile = async (recheck = false) => {
        if (disposed)
            return;
        const next = await snapshot(options.workspace, options.onError);
        for (const event of diff(current, next)) {
            // Only the file's own watched directory defers it: a newly discovered
            // owner waits for the window this scan schedules, and an already watched
            // owner defers only while that directory's own window is open. Parent or
            // sibling activity can never postpone a settled child event.
            const owner = directoryOf(next.dirs, event.path);
            if (owner !== CHANGES_ROOT && (!handles.has(owner) || pending.has(owner))) {
                deferred.set(event.path, owner);
                continue;
            }
            deferred.delete(event.path);
            options.onChange(event);
        }
        // Keep a deferred path at its last emitted value so its own directory's
        // window can coalesce every write into one event.
        const files = new Map(next.files);
        for (const [path, owner] of deferred) {
            // Keep a deferred path at its last emitted value so its own window can
            // coalesce every write into one event; the entry is cleared when emitted.
            void owner;
            const before = current.files.get(path);
            if (before === undefined)
                files.delete(path);
            else
                files.set(path, before);
        }
        current = { files, dirs: next.dirs };
        const discovered = [];
        for (const target of next.dirs) {
            if (handles.has(target))
                continue;
            await attach(target);
            discovered.push(target);
        }
        for (const [target, close] of handles) {
            if (next.dirs.has(target))
                continue;
            handles.delete(target);
            await close().catch(() => undefined);
        }
        // A discovered directory gets its own debounce window before its first
        // changes are emitted, then one post-attachment scan closes the gap where
        // a write landed while its watch was attaching.
        if (discovered.length > 0) {
            for (const target of discovered)
                schedule(target, debounceMs);
            if (!recheck)
                await reconcile(true);
        }
    };
    const run = () => {
        reconciling = reconciling
            .then(() => reconcile())
            .catch((error) => {
            options.onError(errorOf(error));
        });
    };
    /** One timer per watched directory; a later notification never extends it. */
    const schedule = (target, delay) => {
        if (disposed)
            return;
        if (timers.has(target))
            return;
        pending.add(target);
        timers.set(target, setTimeout(() => {
            timers.delete(target);
            pending.delete(target);
            run();
        }, delay));
    };
    for (const target of current.dirs)
        await attach(target);
    // An edit made while the watches were initializing must not wait for the
    // next notification.
    run();
    await reconciling;
    return {
        async start() {
            run();
            await reconciling;
        },
        async dispose() {
            disposed = true;
            controller.abort();
            for (const timer of timers.values())
                clearTimeout(timer);
            timers.clear();
            await reconciling.catch(() => undefined);
            for (const close of handles.values())
                await close().catch(() => undefined);
            handles.clear();
        },
    };
}
