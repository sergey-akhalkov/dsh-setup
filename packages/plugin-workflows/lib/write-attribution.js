import { isAbsolute, relative, resolve } from 'node:path';
/**
 * Attribute this turn's successful OpenSpec writes before the debounced filesystem
 * watcher delivers its event. Paths are resolved against the workspace and
 * normalized so an absolute or `./` form cannot bypass the change attribution.
 */
/** A workspace-relative slash path for one observed write path, or undefined. */
export function normalizedWorkspacePath(workspace, raw) {
    const root = resolve(workspace);
    const absolute = isAbsolute(raw) || /^[A-Za-z]:[\\/]/u.test(raw);
    const candidate = absolute ? resolve(raw) : resolve(root, raw);
    const rel = relative(root, candidate).replaceAll('\\', '/');
    if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
        return undefined;
    return rel;
}
/**
 * The latest successful change-artifact write this turn, as a normalized
 * workspace-relative path. A failed, review, or out-of-workspace write is not
 * an attribution.
 */
export function attributedSpecWrite(workspace, calls, turn) {
    for (const call of [...calls].reverse()) {
        if (turn !== undefined && call.turn !== undefined && call.turn !== turn)
            continue;
        if (call.name !== 'write' && call.name !== 'edit')
            continue;
        if (call.ok === false)
            continue;
        const raw = call.arguments.file_path ?? call.arguments.path;
        if (typeof raw !== 'string')
            continue;
        const rel = normalizedWorkspacePath(workspace, raw);
        if (rel === undefined)
            continue;
        if (!/^openspec\/changes\/[^/]+\//u.test(rel))
            continue;
        if (/\/reviews\//u.test(rel))
            continue;
        return rel;
    }
    return undefined;
}
const CHANGE_CREATION = /(?:^|[;&|]\s*)openspec(?:\.cmd|\.exe)?\s+new\s+change\s+([a-z0-9][a-z0-9-]*)/u;
const SHELL_REDIRECT = /(?:^|[\s;&|])>{1,2}\s*(['"]?)([^'"\s;&|]*openspec[\\/]changes[\\/][a-z0-9-]+[\\/][^'"\s;&|]*)\1/iu;
/**
 * The destination a write command acts on, never a value argument or a printed
 * example. `-Path`/`-LiteralPath` wins; otherwise the first positional token
 * that is not an option or a `-Value` argument.
 */
function shellDestination(command) {
    const redirect = SHELL_REDIRECT.exec(command);
    if (redirect !== null)
        return redirect[2];
    const write = /(?:Set-Content|Add-Content|Out-File|New-Item|tee)\b([\s\S]*)/iu.exec(command);
    if (write === null)
        return undefined;
    const rest = write[1] ?? '';
    const named = /-(?:Path|LiteralPath)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/iu.exec(rest);
    if (named !== null)
        return named[1] ?? named[2] ?? named[3];
    const tokens = rest.match(/"[^"]*"|'[^']*'|\S+/gu) ?? [];
    let skipValue = false;
    for (const token of tokens) {
        if (skipValue) {
            skipValue = false;
            continue;
        }
        if (/^-(?:Value|Credential|Encoding|Force|NoNewline|Stream|AsByteStream|ItemType)\b/iu.test(token)) {
            skipValue = /^-(?:Value|Credential)\b/iu.test(token);
            continue;
        }
        if (token.startsWith('-'))
            continue;
        return token.replace(/^["']|["']$/gu, '');
    }
    return undefined;
}
/** Drop quotes and unquoted comments so only executed text is inspected. */
function executedText(text) {
    let output = '';
    let quote;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index] ?? '';
        if (quote !== undefined) {
            if (char === quote)
                quote = undefined;
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }
        if (char === '#' && (index === 0 || /[\s;&|]/u.test(text[index - 1] ?? ''))) {
            break;
        }
        output += char;
    }
    return output;
}
const WRITE_COMMAND = /(?:^|[;&|]|\|)\s*(?:Set-Content|Add-Content|Out-File|New-Item|tee)\b/iu;
const REDIRECT = /(?:^|[\s;&|])>{1,2}/u;
/** Whether a directory is the workspace root or one of its descendants. */
export function isWorkspaceDirectory(workspace, directory) {
    const root = resolve(workspace);
    const rel = relative(root, resolve(directory)).replaceAll('\\', '/');
    return rel === '' || (rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel));
}
/**
 * The change this turn made, from a successful write/edit of its artifacts or
 * the documented successful `openspec new change <name>` creation command. A
 * session that creates a change through the shell is involved too.
 */
export function attributedChangeName(workspace, calls, turn) {
    const written = attributedSpecWrite(workspace, calls, turn);
    if (written !== undefined) {
        return /^openspec\/changes\/([^/]+)\//u.exec(written)?.[1];
    }
    for (const call of [...calls].reverse()) {
        if (turn !== undefined && call.turn !== undefined && call.turn !== turn)
            continue;
        if (call.ok === false)
            continue;
        const command = call.arguments.command;
        if (typeof command !== 'string')
            continue;
        const normalized = command.replace(/\b(?:rtk|pnpm exec)\s+/gu, '').trim();
        const workdir = typeof call.arguments.workdir === 'string'
            ? call.arguments.workdir
            : typeof call.arguments.cwd === 'string'
                ? call.arguments.cwd
                : undefined;
        if (workdir !== undefined && !isWorkspaceDirectory(workspace, workdir)) {
            continue;
        }
        const executed = executedText(normalized).trim();
        if (executed === '')
            continue;
        const creation = CHANGE_CREATION.exec(executed);
        if (creation !== null)
            return creation[1];
        const startsWrite = WRITE_COMMAND.test(executed);
        const hasRedirect = REDIRECT.test(executed);
        if (!startsWrite && !hasRedirect)
            continue;
        // The destination is parsed from the original text so a quoted path is kept.
        const raw = shellDestination(normalized);
        if (raw !== undefined) {
            const candidate = isAbsolute(raw) || /^[A-Za-z]:[\\/]/u.test(raw)
                ? raw
                : workdir === undefined
                    ? raw
                    : resolve(workdir, raw);
            const rel = normalizedWorkspacePath(workspace, candidate);
            if (rel !== undefined &&
                /^openspec\/changes\/[^/]+\//u.test(rel) &&
                !/\/reviews\//u.test(rel)) {
                return /^openspec\/changes\/([^/]+)\//u.exec(rel)?.[1];
            }
        }
    }
    return undefined;
}
