import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
export class GitError extends Error {
    constructor(message) {
        super(message);
        this.name = 'GitError';
    }
}
/** The production runner: spawn git with the fixed argument list. */
export function defaultGit(args, cwd, signal, env, stdin) {
    return new Promise((done, failed) => {
        const child = spawn('git', [...args], {
            cwd,
            signal,
            windowsHide: true,
            ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
        });
        const chunks = [];
        let stderr = '';
        let stdinFailure;
        child.stdout.on('data', (chunk) => chunks.push(chunk));
        child.stderr.on('data', (chunk) => {
            if (stderr.length < 2_000)
                stderr += chunk.toString('utf8');
        });
        child.on('error', (error) => {
            failed(new GitError(`git ${args[0] ?? 'command'} failed: ${error.message}`));
        });
        child.on('close', (code) => {
            if (code === 0) {
                if (stdinFailure === undefined) {
                    done(Buffer.concat(chunks));
                    return;
                }
                failed(new GitError(`git ${args[0] ?? 'command'} could not receive stdin: ${stdinFailure.message}`));
                return;
            }
            const detail = stderr.trim().replace(/\s+/g, ' ').slice(0, 300);
            failed(new GitError(`git ${args[0] ?? 'command'} failed (exit ${code ?? 'unknown'})${detail ? `: ${detail}` : ''}`));
        });
        child.stdin.on('error', (error) => {
            stdinFailure = error;
        });
        child.stdin.end(stdin);
    });
}
/** Path entries and diff bytes, ignoring the engine's own state and scratch. */
export function ignoredForDigest(path) {
    return path === '.dsh' || path.startsWith('.dsh/') || path === '.tmp' || path.startsWith('.tmp/');
}
function parseStatus(raw) {
    const entries = [];
    const tokens = raw.toString('utf8').split('\0');
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.length < 4)
            continue;
        const code = token.slice(0, 2);
        const path = token.slice(3);
        entries.push({ code, path });
        if (code.startsWith('R') || code.startsWith('C'))
            index += 1;
    }
    return entries;
}
function hashParts(parts) {
    const hash = createHash('sha256');
    for (const part of parts) {
        hash.update(part);
        hash.update('\0');
    }
    return hash.digest('hex');
}
export async function repositoryRoot(cwd, runGit, signal) {
    try {
        const raw = (await runGit(['rev-parse', '--show-toplevel'], cwd, signal))
            .toString('utf8')
            .trim();
        return raw === '' ? cwd : resolve(raw);
    }
    catch {
        return cwd;
    }
}
/** Files that count as implementation work rather than documentation/plan state. */
function isImplementationPath(path) {
    if (ignoredForDigest(path))
        return false;
    if (path === 'docs' || path.startsWith('docs/'))
        return false;
    if (path === 'openspec' || path.startsWith('openspec/'))
        return false;
    if (path === 'market' || path.startsWith('market/'))
        return false;
    return !/\.(?:md|mdx)$/iu.test(path);
}
/**
 * The committed implementation state: every tracked implementation file's tree
 * entry at HEAD. A clean status cannot see an edit that was committed before the
 * close, while a documentation-only commit leaves this identity unchanged.
 * Undefined when HEAD has no tree (unborn) or git cannot read it.
 */
async function committedImplementationState(root, runGit, signal) {
    let raw;
    try {
        raw = await runGit(['ls-tree', '-r', '-z', '--full-tree', 'HEAD'], root, signal);
    }
    catch {
        return undefined;
    }
    const entries = [];
    for (const record of raw.toString('utf8').split('\0')) {
        const tab = record.indexOf('\t');
        if (tab === -1)
            continue;
        const path = record.slice(tab + 1);
        if (isImplementationPath(path))
            entries.push(record);
    }
    entries.sort();
    return hashParts(entries);
}
/**
 * The implementation-state fingerprint: every dirty implementation file's
 * status code and content plus HEAD's committed implementation tree. Unlike a
 * write observation it sees a shell edit, so a turn-start/close comparison
 * cannot miss one, whether the edit is dirty or already committed. Undefined
 * when git cannot read the tree; the caller then falls back to the write
 * observations.
 */
export async function implementationFingerprint(cwd, runGit, signal) {
    const root = await repositoryRoot(cwd, runGit, signal);
    let status;
    try {
        status = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, signal);
    }
    catch {
        return undefined;
    }
    const entries = parseStatus(status).filter((entry) => isImplementationPath(entry.path));
    const parts = ['implementation-v1'];
    for (const entry of entries.sort((left, right) => left.path.localeCompare(right.path))) {
        parts.push(`${entry.code} ${entry.path}`);
        try {
            parts.push(await readFile(resolve(root, entry.path)));
        }
        catch {
            parts.push('[deleted]');
        }
    }
    // The marker keeps an unborn HEAD distinct from a committed history whose
    // implementation identity is only discovered at the close.
    parts.push((await committedImplementationState(root, runGit, signal)) ?? '[no-head]');
    return hashParts(parts);
}
async function worktreeDigestOf(cwd, runGit, bindHead, signal) {
    const root = await repositoryRoot(cwd, runGit, signal);
    let status;
    try {
        status = await runGit(['status', '--porcelain=v1', '-z', '--untracked-files=all'], cwd, signal);
    }
    catch {
        return undefined;
    }
    const entries = parseStatus(status);
    const visible = entries.filter((entry) => !ignoredForDigest(entry.path));
    const parts = ['worktree-v1'];
    for (const entry of visible.sort((left, right) => left.path.localeCompare(right.path))) {
        parts.push(`${entry.code} ${entry.path}`);
        if (entry.code === '??') {
            try {
                parts.push(await readFile(resolve(root, entry.path)));
            }
            catch {
                parts.push('[unreadable]');
            }
        }
    }
    if (bindHead) {
        try {
            // Include the committed tree identity: a clean checkout's status is empty,
            // so two different revisions would otherwise hash identically.
            parts.push(await runGit(['rev-parse', 'HEAD'], cwd, signal));
        }
        catch {
            // An unborn HEAD has no committed tree; the working status still identifies it.
        }
    }
    try {
        parts.push(await runGit(['diff', '--binary', 'HEAD'], cwd, signal));
    }
    catch {
        return undefined;
    }
    return hashParts(parts);
}
/**
 * The worktree content digest: tracked diffs plus untracked files, ignoring the
 * engine's own `.dsh` and `.tmp` state. Undefined when git cannot read the tree.
 */
export async function worktreeDigest(cwd, runGit, signal) {
    return await worktreeDigestOf(cwd, runGit, true, signal);
}
/**
 * The digest the retained legacy progress writer records: the same worktree
 * state without the HEAD identity, so a note routed to that store by either
 * writer is current under the legacy gate's own algorithm. The workflow digest
 * keeps its HEAD binding; the two formats are deliberately different.
 */
export async function legacyWorktreeDigest(cwd, runGit, signal) {
    return await worktreeDigestOf(cwd, runGit, false, signal);
}
