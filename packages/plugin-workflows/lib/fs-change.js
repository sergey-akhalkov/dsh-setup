import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
/**
 * Workspace file source for `openspec/changes/**`. The filesystem service owns
 * the watch itself (directory watches see direct entries only), so this module
 * watches the tree's directories and re-scans the files it cares about after a
 * debounce; a watcher error triggers a rescan so a dropped event stays visible.
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
async function listDirectory(path) {
    try {
        return (await readdir(path, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
    }
    catch {
        return [];
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
async function snapshot(workspace) {
    const files = new Map();
    const dirs = new Set([CHANGES_ROOT]);
    const addFile = async (file) => {
        const entry = await fileEntry(file);
        if (entry !== undefined)
            files.set(relativePath(workspace, file), entry);
    };
    const addChange = async (directory) => {
        dirs.add(relativePath(workspace, directory));
        for (const name of CHANGE_FILES)
            await addFile(join(directory, name));
        const reviews = join(directory, 'reviews');
        const names = await listDirectory(reviews);
        if (names.length > 0)
            dirs.add(relativePath(workspace, reviews));
        for (const name of names) {
            if (!name.endsWith('.json'))
                continue;
            await addFile(join(reviews, name));
        }
    };
    const root = join(workspace, CHANGES_ROOT);
    for (const name of await listDirectory(root)) {
        if (name === 'archive') {
            const archive = join(root, name);
            dirs.add(relativePath(workspace, archive));
            for (const archived of await listDirectory(archive)) {
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
 * baseline; later scans emit ordered create/modify/delete events after the
 * debounce window.
 */
export async function startFsChangeWatcher(options) {
    const debounceMs = options.debounceMs ?? FS_CHANGE_DEBOUNCE_MS;
    const controller = new AbortController();
    const handles = new Map();
    let current = await snapshot(options.workspace);
    let timer;
    let disposed = false;
    let reconciling = Promise.resolve();
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
                    schedule(0);
                    return;
                }
                schedule(debounceMs);
            }, controller.signal);
            handles.set(target, close);
        }
        catch (error) {
            options.onError(errorOf(error));
        }
    };
    const reconcile = async () => {
        if (disposed)
            return;
        const next = await snapshot(options.workspace);
        for (const event of diff(current, next))
            options.onChange(event);
        current = next;
        for (const target of next.dirs) {
            if (handles.has(target))
                continue;
            await attach(target);
        }
        for (const [target, close] of handles) {
            if (next.dirs.has(target))
                continue;
            handles.delete(target);
            await close().catch(() => undefined);
        }
    };
    const run = () => {
        reconciling = reconciling
            .then(() => reconcile())
            .catch((error) => {
            options.onError(errorOf(error));
        });
    };
    const schedule = (delay) => {
        if (disposed)
            return;
        if (timer !== undefined)
            clearTimeout(timer);
        timer = setTimeout(() => {
            timer = undefined;
            run();
        }, delay);
    };
    for (const target of current.dirs)
        await attach(target);
    return {
        async start() {
            // The constructor already established the baseline and attached watches;
            // a caller that prefers an explicit start still gets a fresh scan.
            run();
            await reconciling;
        },
        async dispose() {
            disposed = true;
            controller.abort();
            if (timer !== undefined)
                clearTimeout(timer);
            timer = undefined;
            await reconciling.catch(() => undefined);
            for (const close of handles.values())
                await close().catch(() => undefined);
            handles.clear();
        },
    };
}
