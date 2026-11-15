import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CHANGE_NAME } from './command-parse.js';
/**
 * Durable session involvement: the changes a session edited or created, kept
 * outside the run store so a restarted host can still evaluate an involvement
 * condition for the same session. A session may touch more than one change
 * before a turn closes, so the record is a set.
 */
const SESSION_ID = /^[A-Za-z0-9._-]{1,128}$/u;
export function involvementPath(workspace, session) {
    return join(workspace, '.dsh', 'workflows', 'involvement', `${session}.json`);
}
export async function readInvolvement(workspace, session) {
    if (!SESSION_ID.test(session))
        return [];
    try {
        const value = JSON.parse(await readFile(involvementPath(workspace, session), 'utf8'));
        if (!Array.isArray(value.changes))
            return [];
        return [
            ...new Set(value.changes.filter((entry) => typeof entry === 'string' && CHANGE_NAME.test(entry))),
        ];
    }
    catch {
        return [];
    }
}
export async function writeInvolvement(workspace, session, changes) {
    if (!SESSION_ID.test(session))
        return;
    const valid = [...new Set(changes.filter((entry) => CHANGE_NAME.test(entry)))];
    if (valid.length === 0)
        return;
    const path = involvementPath(workspace, session);
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
    try {
        await writeFile(temporary, `${JSON.stringify({ changes: valid, at: Date.now() }, null, 2)}\n`, 'utf8');
        await rename(temporary, path);
    }
    finally {
        await unlink(temporary).catch(() => undefined);
    }
}
