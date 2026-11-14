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
        const match = CHANGE_CREATION.exec(normalized);
        if (match !== null)
            return match[1];
    }
    return undefined;
}
