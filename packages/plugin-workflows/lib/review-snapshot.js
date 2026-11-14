import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile, } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { specDigest } from './evidence.js';
import { repositoryRoot } from './git.js';
/**
 * The frozen task-review snapshot: a disposable worktree built from the exact
 * review input set, its lease, and the stale-snapshot sweep. Ported from the
 * delegation runtime; the copy is dropped with that plugin in Release B.
 */
export const SNAPSHOT_DIR = '.dsh/workflows/snapshots';
export const SCRATCH_DIR = '.dsh/workflows/scratch';
const SNAPSHOT_LEASE_MS = 5 * 60_000;
const SNAPSHOT_REFRESH_MS = 30_000;
const SNAPSHOT_SWEEP_MS = 10 * 60_000;
const SNAPSHOT_NO_LEASE_GRACE_MS = 10 * 60_000;
const ignoredForDigest = (path) => path === '.dsh' || path.startsWith('.dsh/') || path === '.tmp' || path.startsWith('.tmp/');
async function writeJsonAtomic(path, value) {
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
        await rename(temporary, path);
    }
    finally {
        await unlink(temporary).catch(() => undefined);
    }
}
const snapshotLeases = new Map();
const snapshotSweeps = new Map();
function snapshotKey(cwd, runId) {
    return `${resolve(cwd, SNAPSHOT_DIR)}\u0000${runId}`;
}
function snapshotLeasePath(cwd, runId) {
    return `${resolve(cwd, SNAPSHOT_DIR, runId)}.lease`;
}
async function readSnapshotLease(path) {
    try {
        const value = JSON.parse(await readFile(path, 'utf8'));
        return typeof value.expiresAt === 'number' ? value.expiresAt : undefined;
    }
    catch {
        return undefined;
    }
}
async function writeSnapshotLease(cwd, runId) {
    await writeJsonAtomic(snapshotLeasePath(cwd, runId), {
        runId,
        expiresAt: Date.now() + SNAPSHOT_LEASE_MS,
    });
}
export async function startSnapshotLease(cwd, runId, refreshMs = SNAPSHOT_REFRESH_MS) {
    const state = { stopped: false, writes: writeSnapshotLease(cwd, runId) };
    const timer = setInterval(() => {
        if (state.stopped)
            return;
        state.writes = state.writes.then(() => writeSnapshotLease(cwd, runId)).catch(() => undefined);
    }, refreshMs);
    timer.unref();
    state.timer = timer;
    snapshotLeases.set(snapshotKey(cwd, runId), state);
    await state.writes;
}
export async function stopSnapshotLease(cwd, runId) {
    const key = snapshotKey(cwd, runId);
    const state = snapshotLeases.get(key);
    if (state === undefined)
        return;
    state.stopped = true;
    if (state.timer !== undefined)
        clearInterval(state.timer);
    snapshotLeases.delete(key);
    await state.writes.catch(() => undefined);
}
/** Remove snapshots no live run owns; ownership is the lease, never age. */
export async function sweepReviewSnapshots(cwd, runGit, now = Date.now()) {
    const dir = resolve(cwd, SNAPSHOT_DIR);
    if (now - (snapshotSweeps.get(dir) ?? 0) < SNAPSHOT_SWEEP_MS)
        return;
    snapshotSweeps.set(dir, now);
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        entries = [];
    }
    for (const entry of entries) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) {
            const runId = entry.name;
            const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId));
            if (expiresAt !== undefined && expiresAt > now)
                continue;
            if (expiresAt === undefined) {
                try {
                    if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS)
                        continue;
                }
                catch {
                    continue;
                }
            }
            await discardReviewSnapshot(cwd, runId, runGit);
            continue;
        }
        if (entry.name.endsWith('.tmp') && entry.name.includes('.lease.')) {
            const runId = entry.name.slice(0, entry.name.indexOf('.lease.'));
            const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId));
            if (expiresAt !== undefined && expiresAt > now)
                continue;
            try {
                if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS)
                    continue;
            }
            catch {
                continue;
            }
            await unlink(path).catch(() => undefined);
            continue;
        }
        if (entry.name.endsWith('.lease')) {
            const runId = entry.name.slice(0, -'.lease'.length);
            if (existsSync(resolve(dir, runId)))
                continue;
            const expiresAt = await readSnapshotLease(path);
            if (expiresAt !== undefined && expiresAt > now)
                continue;
            await unlink(path).catch(() => undefined);
        }
    }
    let scratchEntries = [];
    try {
        scratchEntries = await readdir(resolve(cwd, SCRATCH_DIR), { withFileTypes: true });
    }
    catch {
        scratchEntries = [];
    }
    for (const entry of scratchEntries) {
        if (!entry.isFile() || !entry.name.endsWith('.index'))
            continue;
        const runId = entry.name.slice(0, -'.index'.length);
        const expiresAt = await readSnapshotLease(snapshotLeasePath(cwd, runId));
        if (expiresAt !== undefined && expiresAt > now)
            continue;
        const path = resolve(cwd, SCRATCH_DIR, entry.name);
        try {
            if (now - (await stat(path)).mtimeMs <= SNAPSHOT_NO_LEASE_GRACE_MS)
                continue;
        }
        catch {
            continue;
        }
        await unlink(path).catch(() => undefined);
    }
    try {
        await runGit(['worktree', 'prune'], cwd);
    }
    catch {
        // Pruning is best effort.
    }
}
/** Remove one snapshot checkout, its lease, and its scratch index; best effort. */
export async function discardReviewSnapshot(cwd, runId, runGit, remove = (path) => rm(path, { recursive: true, force: true })) {
    await stopSnapshotLease(cwd, runId);
    const worktree = resolve(cwd, SNAPSHOT_DIR, runId);
    try {
        await runGit(['worktree', 'remove', '--force', worktree], cwd);
    }
    catch {
        // Not a registered worktree, already gone, or not a Git checkout.
    }
    for (const path of [worktree, resolve(cwd, SCRATCH_DIR, `${runId}.index`), `${worktree}.lease`]) {
        await remove(path).catch(() => undefined);
    }
}
/**
 * Build the disposable task-review snapshot from the exact review input set.
 * Returns undefined when it cannot be built safely; the caller reviews the live
 * worktree with the mutation guard instead and gets the cause through
 * `onUnavailable`.
 */
export async function createReviewSnapshot(cwd, change, runId, runGit, signal, afterCopy, onUnavailable) {
    await sweepReviewSnapshots(cwd, runGit);
    const root = await repositoryRoot(cwd, runGit, signal);
    let relChange;
    try {
        relChange = relative(await realpath(root), await realpath(change.dir))
            .split(sep)
            .join('/');
    }
    catch {
        onUnavailable?.('the repository or change directory path could not be resolved');
        return undefined;
    }
    if (relChange === '' ||
        relChange === '.' ||
        relChange === '..' ||
        relChange.startsWith('../') ||
        isAbsolute(relChange)) {
        onUnavailable?.('the change directory is outside the repository');
        return undefined;
    }
    try {
        await mkdir(resolve(cwd, '.dsh'), { recursive: true });
        await runGit(['check-ignore', '-q', '--no-index', '.dsh'], cwd, signal);
    }
    catch {
        onUnavailable?.('the .dsh scratch directory is not Git-ignored; add .dsh/ to .gitignore or .git/info/exclude');
        return undefined;
    }
    try {
        if ((await runGit(['ls-files', '-u'], root, signal)).toString('utf8').trim() !== '') {
            onUnavailable?.('the repository index has unmerged entries');
            return undefined;
        }
    }
    catch {
        onUnavailable?.('the repository index could not be read for unmerged entries');
        return undefined;
    }
    const worktree = resolve(cwd, SNAPSHOT_DIR, runId);
    const scratch = resolve(cwd, SCRATCH_DIR, `${runId}.index`);
    const env = { GIT_INDEX_FILE: scratch };
    try {
        const listed = (await runGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root, signal)).toString('utf8');
        const paths = [];
        for (const path of listed.split('\0')) {
            if (path === '' || ignoredForDigest(path))
                continue;
            if (path === relChange || path.startsWith(`${relChange}/`))
                continue;
            try {
                await lstat(resolve(root, path));
            }
            catch {
                // A tracked path deleted from the worktree is what a live review sees.
                continue;
            }
            paths.push(path);
        }
        await mkdir(dirname(scratch), { recursive: true });
        await mkdir(dirname(worktree), { recursive: true });
        if (paths.length > 0) {
            await runGit(['update-index', '--add', '-z', '--stdin'], root, signal, env, `${paths.join('\0')}\0`);
        }
        const tree = (await runGit(['write-tree'], root, signal, env)).toString('utf8').trim();
        let parent;
        try {
            parent = (await runGit(['rev-parse', '--verify', 'HEAD'], root, signal))
                .toString('utf8')
                .trim();
        }
        catch {
            parent = undefined;
        }
        const commit = (await runGit([
            '-c',
            'user.name=dsh-workflows',
            '-c',
            'user.email=workflows@localhost',
            'commit-tree',
            tree,
            ...(parent === undefined ? [] : ['-p', parent]),
            '-m',
            'workflows: reviewed snapshot',
        ], root, signal))
            .toString('utf8')
            .trim();
        await startSnapshotLease(cwd, runId);
        await runGit(['worktree', 'add', '--detach', worktree, commit], root, signal);
        const frozenChange = resolve(worktree, relChange);
        await mkdir(dirname(frozenChange), { recursive: true });
        await cp(change.dir, frozenChange, { recursive: true, force: true, dereference: true });
        if (afterCopy !== undefined)
            await afterCopy();
        const frozenSpec = await specDigest(frozenChange);
        return { tree, commit, worktree, changeDir: frozenChange, specDigest: frozenSpec };
    }
    catch {
        await discardReviewSnapshot(cwd, runId, runGit);
        onUnavailable?.('the snapshot worktree could not be built (git error during snapshot creation)');
        return undefined;
    }
}
