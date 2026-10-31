import { matchesOwnedTool } from './builtins.js';
/** Every accepted range, in selector order. */
export const RANGES = ['session', 'day', 'week', 'month'];
/** Whether a value is one of the accepted ranges. */
export function isRange(value) {
    return typeof value === 'string' && RANGES.includes(value);
}
const HOUR_MS = 3_600_000;
/** Local midnight at or before a timestamp. */
export function startOfLocalDay(time) {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}
/** Local hour start at or before a timestamp. */
export function startOfLocalHour(time) {
    const date = new Date(time);
    date.setMinutes(0, 0, 0);
    return date.getTime();
}
function twoDigits(value) {
    return String(value).padStart(2, '0');
}
function monthDayLabel(time) {
    const date = new Date(time);
    return `${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}`;
}
/**
 * The fixed window for a range. Session buckets come from the session's own
 * turns plus one trailing outside-turn bucket; the other ranges are trailing
 * local-hour and local-day windows ending now.
 */
export function rangeWindow(range, now, turns) {
    if (range === 'session') {
        const buckets = [];
        for (let turn = 1; turn <= turns; turn += 1) {
            buckets.push({ label: `Turn ${turn}`, from: 0, to: 0 });
        }
        buckets.push({ label: 'Outside turn', from: 0, to: 0 });
        return { range, from: 0, to: 0, buckets };
    }
    if (range === 'day') {
        const from = startOfLocalHour(now) - 23 * HOUR_MS;
        const buckets = Array.from({ length: 24 }, (_unused, index) => {
            const start = from + index * HOUR_MS;
            return {
                label: `${twoDigits(new Date(start).getHours())}:00`,
                from: start,
                to: index === 23 ? now + 1 : start + HOUR_MS,
            };
        });
        return { range, from, to: now + 1, buckets };
    }
    const days = range === 'week' ? 7 : 30;
    const anchor = new Date(startOfLocalDay(now));
    const first = new Date(anchor);
    first.setDate(first.getDate() - (days - 1));
    const buckets = [];
    for (let index = 0; index < days; index += 1) {
        const start = new Date(first);
        start.setDate(first.getDate() + index);
        const next = new Date(first);
        next.setDate(first.getDate() + index + 1);
        buckets.push({
            label: monthDayLabel(start.getTime()),
            from: start.getTime(),
            to: index === days - 1 ? now + 1 : next.getTime(),
        });
    }
    return { range, from: buckets[0]?.from ?? now, to: now + 1, buckets };
}
function bucketIndex(window, record) {
    if (window.range === 'session') {
        const outside = window.buckets.length - 1;
        if (record.turn === undefined)
            return outside;
        return record.turn >= 1 && record.turn <= outside ? record.turn - 1 : outside;
    }
    for (let index = 0; index < window.buckets.length; index += 1) {
        const bucket = window.buckets[index];
        if (bucket !== undefined && record.time >= bucket.from && record.time < bucket.to)
            return index;
    }
    return -1;
}
/** Whether a row's predicates own the tool a failed result belongs to. */
function namesTool(row, record) {
    const match = row.row.match;
    return match !== undefined && matchesOwnedTool(record, match);
}
/**
 * Compute per-row counts and errors for one range. Pure: the caller supplies
 * the records, the rows, and `now`, so no clock or Host is touched.
 */
export function aggregate(records, rows, range, now) {
    const turns = range === 'session'
        ? records.reduce((highest, record) => Math.max(highest, record.turn ?? 0), 0)
        : 0;
    const window = rangeWindow(range, now, turns);
    const inWindow = [];
    for (const record of records) {
        const index = bucketIndex(window, record);
        if (index !== -1)
            inWindow.push({ record, index });
    }
    const activity = new Array(window.buckets.length).fill(0);
    const errorSeries = new Array(window.buckets.length).fill(0);
    const totals = { turns: 0, steps: 0, toolCalls: 0, errors: 0, records: 0, sessions: 0 };
    const sessions = new Set();
    for (const { record, index } of inWindow) {
        activity[index] = (activity[index] ?? 0) + 1;
        sessions.add(record.sessionId);
        totals.records += 1;
        if (record.eventType === 'turn/start')
            totals.turns += 1;
        if (record.eventType === 'step/start')
            totals.steps += 1;
        if (record.eventType === 'tool/call')
            totals.toolCalls += 1;
        if (record.failed === true) {
            errorSeries[index] = (errorSeries[index] ?? 0) + 1;
            totals.errors += 1;
        }
    }
    totals.sessions = sessions.size;
    const aggregated = new Map();
    for (const row of rows) {
        const counts = new Array(window.buckets.length).fill(0);
        let errors = 0;
        for (const entry of inWindow) {
            if (row.test(entry.record)) {
                counts[entry.index] = (counts[entry.index] ?? 0) + 1;
            }
            if (entry.record.failed === true) {
                const failedMatch = row.test(entry.record) ||
                    (entry.record.eventType === 'tool/result' && namesTool(row, entry.record));
                if (failedMatch)
                    errors += 1;
            }
        }
        aggregated.set(row.row.id, { rowId: row.row.id, counts, errors });
    }
    return {
        range,
        from: window.from,
        to: window.to,
        buckets: window.buckets,
        rows: aggregated,
        totals,
        activity,
        errorSeries,
    };
}
