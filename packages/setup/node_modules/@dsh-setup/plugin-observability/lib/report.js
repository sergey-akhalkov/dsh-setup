import { aggregate } from './aggregate.js';
import { builtinRows, testableRow } from './builtins.js';
import { GUIDANCE_NOTE, rowState } from './status.js';
/** What the view must state it cannot observe, not hide. */
export const BLIND_SPOTS = [
    'Prompt-only guidance plugins are named in the list, but whether their prompt text changed a turn cannot be seen in the log.',
    'A plugin that fails while loading appends no session event, so its failure is invisible here.',
    'UI rendering effects are not recorded in the session log.',
    'Whether the model complied with a prompted rule cannot be judged from event counts.',
];
/** How many drill-down entries one row keeps; the dashboard shows five. */
export const DETAIL_LIMIT = 25;
function inWindow(record, range, window) {
    if (range === 'session')
        return true;
    return record.time >= window.from && record.time < window.to;
}
function totalTraces(entry) {
    return entry.counts.reduce((sum, count) => sum + count, 0);
}
function detail(record, signalId) {
    return {
        time: record.time,
        ...(record.turn === undefined ? {} : { turn: record.turn }),
        signalId,
        ...(record.tool === undefined ? {} : { tool: record.tool }),
        ...(record.failed === true ? { failed: true } : {}),
    };
}
/**
 * Assemble the report for one range from the sessions' neutral records.
 * Built-in rows come first, configured rows after; nothing is persisted.
 */
export function buildReport(options) {
    const rows = [
        ...builtinRows(options.records),
        ...options.configured.map(testableRow),
    ];
    const window = aggregate(options.records, rows, options.range, options.now);
    const report = rows.map((entry) => {
        const rowAggregate = window.rows.get(entry.row.id);
        const traces = rowAggregate === undefined ? 0 : totalTraces(rowAggregate);
        const state = rowState(entry.row, rowAggregate, options.registry);
        const details = entry.row.kind === 'guidance'
            ? []
            : options.records
                .filter((record) => inWindow(record, options.range, window) && entry.test(record))
                .sort((left, right) => right.time - left.time)
                .slice(0, DETAIL_LIMIT)
                .map((record) => detail(record, entry.row.id));
        return {
            id: entry.row.id,
            label: entry.row.label,
            kind: entry.row.kind,
            group: entry.group,
            ...(state === undefined ? {} : { status: state.status }),
            note: state?.note ?? GUIDANCE_NOTE,
            traces,
            errors: rowAggregate?.errors ?? 0,
            counts: rowAggregate?.counts ?? [],
            tools: [...new Set((entry.row.match ?? []).flatMap((predicate) => predicate.tool ?? []))],
            ...(details[0] === undefined ? {} : { lastActivity: details[0].time }),
            details,
        };
    });
    return {
        range: options.range,
        from: window.from,
        to: window.to,
        bucketLabels: window.buckets.map((bucket) => bucket.label),
        totals: window.totals,
        activity: window.activity,
        errorSeries: window.errorSeries,
        rows: report,
        blindSpots: BLIND_SPOTS,
    };
}
