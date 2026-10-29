import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ExportError, messageOf } from './export-errors.js';
/** Fixed identity: the export repository must not borrow the user's Git identity. */
export const EXPORT_GIT_IDENTITY = Object.freeze({
    name: 'Hindsight Export',
    email: 'hindsight-export@localhost',
});
/** Ignored scratch and journal paths, written only when the file is absent. */
export const EXPORT_GITIGNORE = [
    '# Written by the Hindsight exporter; never commit its scratch state.',
    '.export.lock',
    '.export.lock.*',
    '.export-staging/',
    '.export-pending.json',
    'banks.old-*',
    '.export-askpass.*',
    '',
].join('\n');
/** No prompt may ever block an export cycle. */
const HEADLESS_GIT_ENV = {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    SSH_ASKPASS_REQUIRE: 'never',
};
/** A non-interactive askpass program that always fails; credentials come from helpers. */
const ASKPASS_SCRIPT = process.platform === 'win32' ? '@exit /b 1\r\n' : '#!/bin/sh\nexit 1\n';
/** Write (or reuse) the failing askpass helper inside the repository. */
export function prepareAskpass(dir) {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, process.platform === 'win32' ? '.export-askpass.cmd' : '.export-askpass.sh');
    if (!existsSync(file)) {
        writeFileSync(file, ASKPASS_SCRIPT);
        if (process.platform !== 'win32')
            chmodSync(file, 0o755);
    }
    return file;
}
/** A helper outside the repository, for the clone that creates the repository. */
function prepareAskpassBeside(dir) {
    mkdirSync(dirname(dir), { recursive: true });
    const file = join(dirname(dir), `.export-askpass-${process.pid}.${process.platform === 'win32' ? 'cmd' : 'sh'}`);
    writeFileSync(file, ASKPASS_SCRIPT);
    if (process.platform !== 'win32')
        chmodSync(file, 0o755);
    return file;
}
function runGit(args, options) {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const env = { ...process.env, ...HEADLESS_GIT_ENV, ...options.env };
    if (options.askpass !== undefined) {
        // GIT_ASKPASS wins over the terminal, and core.askpass is restated through
        // the config environment so an inherited value cannot open a dialog either.
        Object.assign(env, {
            GIT_ASKPASS: options.askpass,
            SSH_ASKPASS: options.askpass,
            GIT_CONFIG_COUNT: '1',
            GIT_CONFIG_KEY_0: 'core.askpass',
            GIT_CONFIG_VALUE_0: options.askpass,
        });
    }
    return new Promise((resolve, reject) => {
        const child = spawn('git', args, { cwd: options.cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new ExportError('git', `git ${args[0] ?? ''} timed out after ${timeoutMs} ms`));
        }, timeoutMs);
        child.stdout?.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr?.on('data', (chunk) => {
            stderr += String(chunk);
        });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(new ExportError('git', `cannot run git: ${messageOf(error)}`, { cause: error }));
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            const result = { code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() };
            if (result.code !== 0 && options.allowFailure !== true) {
                const detail = result.stderr === '' ? result.stdout : result.stderr;
                reject(new ExportError('git', `git ${args.join(' ')} failed: ${detail}`));
                return;
            }
            resolve(result);
        });
    });
}
/** Diagnostics for one command, for callers that expect a failure. */
export async function gitOutput(args, options) {
    return runGit(args, options);
}
async function originUrl(options) {
    const result = await runGit(['remote', 'get-url', 'origin'], { ...options, allowFailure: true });
    return result.code === 0 && result.stdout !== '' ? result.stdout : undefined;
}
/**
 * Prepare the export repository: clone the private remote when it is missing,
 * otherwise initialize a local one, and keep `origin` in sync with the
 * machine-local configuration.
 */
export async function bootstrapRepository(options) {
    const { dir, remote } = options;
    const run = { cwd: dir, timeoutMs: options.timeoutMs, env: options.env };
    let created = 'existing';
    if (!existsSync(join(dir, '.git'))) {
        if (remote !== undefined) {
            if (existsSync(dir) && readdirSync(dir).length > 0) {
                throw new ExportError('git', `export directory ${dir} exists without a repository; move it aside or configure another directory`);
            }
            mkdirSync(dir, { recursive: true });
            // The clone destination must be empty, so the helper lives beside it and
            // the repository keeps its own copy afterwards.
            const temporaryAskpass = prepareAskpassBeside(dir);
            try {
                await runGit(['clone', remote, dir], {
                    cwd: dirname(dir),
                    timeoutMs: options.timeoutMs,
                    env: options.env,
                    askpass: temporaryAskpass,
                });
            }
            finally {
                rmSync(temporaryAskpass, { force: true });
            }
            created = 'clone';
        }
        else {
            mkdirSync(dir, { recursive: true });
            await runGit(['init', '-b', 'main'], run);
            created = 'init';
        }
    }
    prepareAskpass(dir);
    const ignoreFile = join(dir, '.gitignore');
    if (!existsSync(ignoreFile))
        writeFileSync(ignoreFile, EXPORT_GITIGNORE);
    const current = await originUrl(run);
    if (remote !== undefined && current !== remote) {
        if (current === undefined)
            await runGit(['remote', 'add', 'origin', remote], run);
        else
            await runGit(['remote', 'set-url', 'origin', remote], run);
    }
    return { created };
}
/** Commit everything the snapshot wrote; a clean tree creates no commit. */
export async function commitSnapshot(dir, options) {
    // GIT_AUTHOR_*/GIT_COMMITTER_* outrank both `-c user.*` and the inherited
    // environment, so the fixed identity is applied here as the last word.
    const run = {
        cwd: dir,
        timeoutMs: options.timeoutMs,
        env: {
            ...options.env,
            GIT_AUTHOR_NAME: EXPORT_GIT_IDENTITY.name,
            GIT_AUTHOR_EMAIL: EXPORT_GIT_IDENTITY.email,
            GIT_COMMITTER_NAME: EXPORT_GIT_IDENTITY.name,
            GIT_COMMITTER_EMAIL: EXPORT_GIT_IDENTITY.email,
        },
    };
    await runGit(['add', '--all'], run);
    const status = await runGit(['status', '--porcelain'], run);
    if (status.stdout === '')
        return { committed: false };
    await runGit(['-c', 'commit.gpgsign=false', 'commit', '--no-gpg-sign', '--message', options.message], run);
    return { committed: true };
}
/** The branch the repository is on; a detached or unborn HEAD reports `main`. */
export async function currentBranch(dir) {
    const result = await runGit(['symbolic-ref', '--short', 'HEAD'], {
        cwd: dir,
        allowFailure: true,
    });
    return result.code === 0 && result.stdout !== '' ? result.stdout : 'main';
}
/** Whether the repository already has a commit to push. */
export async function hasCommits(dir) {
    const result = await runGit(['rev-parse', '--verify', 'HEAD'], { cwd: dir, allowFailure: true });
    return result.code === 0;
}
/**
 * Whether the branch has local commits the remote-tracking ref does not, i.e.
 * whether a push would do anything. A never-pushed repository counts as ahead.
 */
export async function hasUnpushedCommits(dir) {
    if (!(await hasCommits(dir)))
        return false;
    const branch = await currentBranch(dir);
    const tracking = await runGit(['rev-parse', '--verify', `origin/${branch}`], {
        cwd: dir,
        allowFailure: true,
    });
    if (tracking.code !== 0)
        return true;
    const ahead = await runGit(['rev-list', '--count', `origin/${branch}..HEAD`], {
        cwd: dir,
        allowFailure: true,
    });
    return ahead.code === 0 && Number(ahead.stdout) > 0;
}
function firstLine(text) {
    return (text
        .split(/\r?\n/u)
        .find((line) => line.trim() !== '')
        ?.trim() ?? 'unknown error');
}
/**
 * Push the current branch without force. A diverged remote is reconciled with a
 * fetch and rebase (this runs under the single-writer lock); anything else keeps
 * the local commit and reports, and the next cycle tries again.
 */
export async function pushSnapshot(dir, options = {}) {
    const run = {
        cwd: dir,
        timeoutMs: options.timeoutMs,
        env: options.env,
        askpass: prepareAskpass(dir),
    };
    if ((await originUrl(run)) === undefined)
        return { pushed: false, reason: 'no remote configured' };
    if (!(await hasCommits(dir)))
        return { pushed: false, reason: 'nothing committed yet' };
    const branch = await currentBranch(dir);
    const push = await runGit(['push', '--porcelain', 'origin', 'HEAD'], {
        ...run,
        allowFailure: true,
    });
    if (push.code === 0)
        return { pushed: true };
    const rejected = /non-fast-forward|fetch first|\[rejected\]/u.test(`${push.stdout}\n${push.stderr}`);
    if (rejected) {
        const fetched = await runGit(['fetch', '--quiet', 'origin', branch], {
            ...run,
            allowFailure: true,
        });
        if (fetched.code === 0) {
            const rebase = await runGit(['rebase', `origin/${branch}`], { ...run, allowFailure: true });
            if (rebase.code !== 0) {
                await runGit(['rebase', '--abort'], { ...run, allowFailure: true });
                return { pushed: false, reason: `remote diverged: ${firstLine(rebase.stderr)}` };
            }
            const retry = await runGit(['push', '--porcelain', 'origin', 'HEAD'], {
                ...run,
                allowFailure: true,
            });
            if (retry.code === 0)
                return { pushed: true };
            return { pushed: false, reason: firstLine(retry.stderr || retry.stdout) };
        }
    }
    return { pushed: false, reason: firstLine(push.stderr || push.stdout) };
}
