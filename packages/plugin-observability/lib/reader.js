import { rangeWindow } from './aggregate.js';
import { extractRecords } from './records.js';
/** How many sessions the reader opens at once. */
export const READ_CONCURRENCY = 4;
async function mapLimit(items, limit, run) {
    const results = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const index = next;
            next += 1;
            const item = items[index];
            if (item === undefined)
                return;
            results[index] = await run(item);
        }
    };
    const width = Math.max(1, Math.min(limit, items.length));
    await Promise.all(Array.from({ length: width }, worker));
    return results;
}
/** Modification stamp: event count plus newest event time. */
function modificationStamp(events) {
    let newest = 0;
    for (const event of events) {
        if (event.time > newest)
            newest = event.time;
    }
    return `${String(events.length)}:${String(newest)}`;
}
function overlaps(events, from, to) {
    return events.some((event) => event.time >= from && event.time < to);
}
/** Extract one session's own records, serving an unchanged session from memory. */
async function readOne(query, id, stamp, cache) {
    const cached = cache?.get(String(id), stamp);
    if (cached !== undefined)
        return [...cached];
    const snapshot = await query.readSession(id);
    const records = extractRecords(id, snapshot.events, Number(snapshot.inheritedEventCount));
    cache?.set(String(id), stamp, records);
    return records;
}
/** Add every descendant of the seed sessions through the parent links. */
function addDescendants(records, ids) {
    for (let changed = true; changed;) {
        changed = false;
        for (const record of records) {
            const parent = record.header.parentSession;
            if (parent !== undefined && ids.has(parent) && !ids.has(record.header.id)) {
                ids.add(record.header.id);
                changed = true;
            }
        }
    }
}
/** Nearest cwd on the ancestor chain, if any ancestor records one. */
function ancestorCwd(byId, start) {
    const seen = new Set();
    let cursor = byId.get(start);
    while (cursor !== undefined && !seen.has(cursor.header.id)) {
        seen.add(cursor.header.id);
        if (cursor.header.cwd !== undefined)
            return cursor.header.cwd;
        const parent = cursor.header.parentSession;
        cursor = parent === undefined ? undefined : byId.get(parent);
    }
    return undefined;
}
/** Current session, its ancestors, and every descendant: the fallback scope without a cwd. */
function lineageIds(records, byId, start) {
    const ids = new Set([start]);
    let cursor = byId.get(start);
    while (cursor?.header.parentSession !== undefined) {
        const parent = cursor.header.parentSession;
        if (ids.has(parent))
            break;
        ids.add(parent);
        cursor = byId.get(parent);
    }
    addDescendants(records, ids);
    return ids;
}
/**
 * Read every session a range covers and return the neutral records it owns.
 *
 * A `session` range reads only the open session, because its buckets are that
 * session's turns. Wider ranges read every session in the same workspace whose
 * events fall in the window, subagent children included. A fork seed's copied
 * prefix is skipped at `inheritedEventCount`, so a parent's events count once.
 */
export async function readSessions(options) {
    const { query, range, now, sessionId, cache } = options;
    const limit = options.concurrency ?? READ_CONCURRENCY;
    const window = rangeWindow(range, now, 0);
    if (range === 'session') {
        if (sessionId === undefined)
            return [];
        const events = await query.listEvents(sessionId);
        return readOne(query, sessionId, modificationStamp(events), cache);
    }
    const records = await query.listSessions();
    const byId = new Map(records.map((record) => [record.header.id, record]));
    const current = sessionId === undefined ? undefined : byId.get(sessionId);
    let workspaceIds;
    if (sessionId !== undefined && current === undefined) {
        // The open session is not in the corpus: do not guess a wider scope.
        return [];
    }
    if (current === undefined) {
        workspaceIds = new Set(records.map((record) => record.header.id));
    }
    else if (current.header.cwd === undefined) {
        // Resolve a missing cwd through the ancestor chain; without one, fall back
        // to the lineage so unrelated workspaces are not pulled in.
        const cwd = ancestorCwd(byId, current.header.id);
        if (cwd === undefined) {
            workspaceIds = lineageIds(records, byId, current.header.id);
        }
        else {
            workspaceIds = new Set(records.filter((record) => record.header.cwd === cwd).map((record) => record.header.id));
            addDescendants(records, workspaceIds);
            for (const id of lineageIds(records, byId, current.header.id))
                workspaceIds.add(id);
        }
    }
    else {
        workspaceIds = new Set(records
            .filter((record) => record.header.cwd === current.header.cwd)
            .map((record) => record.header.id));
        addDescendants(records, workspaceIds);
    }
    const workspace = records.filter((record) => workspaceIds.has(record.header.id));
    const listed = await mapLimit(workspace, limit, async (record) => {
        const events = await query.listEvents(record.header.id);
        return { record, events, stamp: modificationStamp(events) };
    });
    const selected = listed.filter((entry) => overlaps(entry.events, window.from, window.to));
    const read = await mapLimit(selected, limit, async (entry) => readOne(query, entry.record.header.id, entry.stamp, cache));
    return read.flat();
}
