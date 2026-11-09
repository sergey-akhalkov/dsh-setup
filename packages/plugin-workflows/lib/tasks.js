import { createHash } from 'node:crypto';
/**
 * Task identity for the deferred task-review workflow. The delegation engine
 * derives a stable id from the whitespace-normalized task text; these helpers
 * compute the same id locally so the engine can name the task a `tasks.md`
 * change just checked without a new event field.
 */
/** Stable 16-hex id of one numbered task's text. */
export function taskIdOf(text) {
    return createHash('sha256').update(text.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16);
}
/** The checked `- [x] N.N text` task ids, in file order. */
export function checkedTaskIds(markdown) {
    const ids = [];
    for (const match of markdown.matchAll(/^\s*-\s*\[[xX]\]\s+(\d+(?:\.\d+)*)\s+(\S.*?)\s*$/gmu)) {
        ids.push(taskIdOf(match[2] ?? ''));
    }
    return ids;
}
