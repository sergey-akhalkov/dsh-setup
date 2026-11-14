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
/**
 * The worktree content digest: tracked diffs plus untracked files, ignoring the
 * engine's own `.dsh` and `.tmp` state. Undefined when git cannot read the tree.
 */
export async function worktreeDigest(cwd, runGit, signal) {
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
    try {
        parts.push(await runGit(['diff', '--binary', 'HEAD'], cwd, signal));
    }
    catch {
        return undefined;
    }
    return hashParts(parts);
}
