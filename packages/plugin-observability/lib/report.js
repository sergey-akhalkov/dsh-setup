import { aggregate } from './aggregate.js';
import { builtinRows, matchesOwnedTool, testableRow } from './builtins.js';
import { GUIDANCE_NOTE, guidanceReadiness, rowState, } from './status.js';
/** What the view must state it cannot observe, not hide. */
export const BLIND_SPOTS = [
    'A plugin that fails while loading appends no session event and registers no tool, prompt section, or skill, so a declaration is the only handle it offers here.',
    'UI rendering effects are not recorded in the session log.',
    'Whether the model complied with a prompted rule cannot be judged from event counts; only the contribution’s presence is checked.',
];
/** How many drill-down entries one row keeps; the dashboard shows five. */
export const DETAIL_LIMIT = 25;
/** How many failure entries the report carries; the counts are uncapped. */
export const FAILURE_LIMIT = 200;
const CUT_KINDS = new Set(['max-tokens', 'interrupted']);
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
/** The severity a record earns by the log's own reason, if it is a failure at all. */
function failureSeverity(record) {
    if (record.eventType === 'turn/end') {
        if (record.turnEnd === 'error')
            return 'turn failure';
        return record.turnEnd !== undefined && CUT_KINDS.has(record.turnEnd) ? 'turn cut' : undefined;
    }
    if (record.eventType === 'tool/result' && record.failed === true)
        return 'tool failure';
    return undefined;
}
/** The last closer per session and turn, over the full record set. */
function turnClosers(records) {
    const closers = new Map();
    for (const record of records) {
        if (record.eventType !== 'turn/end' || record.turn === undefined)
            continue;
        let byTurn = closers.get(record.sessionId);
        if (byTurn === undefined) {
            byTurn = new Map();
            closers.set(record.sessionId, byTurn);
        }
        if (record.turnEnd !== undefined)
            byTurn.set(record.turn, record.turnEnd);
    }
    return closers;
}
/** A tool failure is recovered when its turn completed; nothing else can be. */
function isRecovered(record, severity, closers) {
    if (severity !== 'tool failure' || record.turn === undefined)
        return false;
    return closers.get(record.sessionId)?.get(record.turn) === 'completed';
}
function failureEntry(record, severity, recovered) {
    return {
        seq: record.seq,
        time: record.time,
        sessionId: record.sessionId,
        severity,
        recovered,
        ...(record.turn === undefined ? {} : { turn: record.turn }),
        ...(record.step === undefined ? {} : { step: record.step }),
        ...(record.tool === undefined ? {} : { tool: record.tool }),
        ...(record.callId === undefined ? {} : { callId: record.callId }),
        ...(record.errorName === undefined ? {} : { errorName: record.errorName }),
        ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
    };
}
function countFailures(failures) {
    let turnFailures = 0;
    let turnCuts = 0;
    let toolFailures = 0;
    let recovered = 0;
    for (const failure of failures) {
        if (failure.severity === 'turn failure')
            turnFailures += 1;
        else if (failure.severity === 'turn cut')
            turnCuts += 1;
        else
            toolFailures += 1;
        if (failure.recovered)
            recovered += 1;
    }
    return {
        total: failures.length,
        turnFailures,
        turnCuts,
        toolFailures,
        recovered,
    };
}
/**
 * The calls each tool made inside the window, joined to their own result by
 * session and call identity whatever the result's time, so a failing share is
 * always a subset of its call count.
 */
function callOutcomes(records, range, window) {
    const failedCalls = new Set();
    for (const record of records) {
        if (record.eventType !== 'tool/result' || record.failed !== true)
            continue;
        if (record.callId === undefined)
            continue;
        failedCalls.add(`${record.sessionId}\u0000${record.callId}`);
    }
    const calls = new Map();
    const failed = new Map();
    for (const record of records) {
        if (record.eventType !== 'tool/call' || record.tool === undefined)
            continue;
        if (!inWindow(record, range, window))
            continue;
        calls.set(record.tool, (calls.get(record.tool) ?? 0) + 1);
        if (record.callId !== undefined &&
            failedCalls.has(`${record.sessionId}\u0000${record.callId}`)) {
            failed.set(record.tool, (failed.get(record.tool) ?? 0) + 1);
        }
    }
    return [...calls.entries()]
        .map(([tool, count]) => ({ tool, calls: count, failed: failed.get(tool) ?? 0 }))
        .sort((left, right) => right.calls - left.calls || left.tool.localeCompare(right.tool));
}
/**
 * Assemble the report for one range from the sessions' neutral records.
 * Built-in rows come first, configured rows after; nothing is persisted.
 */ export function buildReport(options) {
    const rows = [
        ...builtinRows(options.records),
        ...options.configured.map(testableRow),
    ];
    const window = aggregate(options.records, rows, options.range, options.now);
    const closers = turnClosers(options.records);
    const failures = [];
    for (const record of options.records) {
        if (!inWindow(record, options.range, window))
            continue;
        const severity = failureSeverity(record);
        if (severity === undefined)
            continue;
        failures.push(failureEntry(record, severity, isRecovered(record, severity, closers)));
    }
    failures.sort((left, right) => right.time - left.time || right.seq - left.seq);
    const failureTotals = countFailures(failures);
    const failureByRecord = new Map(failures.map((failure) => [`${failure.sessionId}:${String(failure.seq)}`, failure]));
    const readinessSources = options.readiness ?? { skillsComplete: false };
    const report = rows.map((entry) => {
        const rowAggregate = window.rows.get(entry.row.id);
        const traces = rowAggregate === undefined ? 0 : totalTraces(rowAggregate);
        const state = rowState(entry.row, rowAggregate, options.registry);
        const readiness = entry.row.kind === 'guidance' ? guidanceReadiness(entry.row, readinessSources) : undefined;
        const details = entry.row.kind === 'guidance'
            ? []
            : options.records
                .filter((record) => inWindow(record, options.range, window) && entry.test(record))
                .sort((left, right) => right.time - left.time)
                .slice(0, DETAIL_LIMIT)
                .map((record) => detail(record, entry.row.id));
        const errors = rowAggregate?.errors ?? 0;
        const rowFailures = errors === 0
            ? []
            : options.records
                .filter((record) => {
                if (record.failed !== true)
                    return false;
                if (!inWindow(record, options.range, window))
                    return false;
                return entry.test(record) || matchesOwnedTool(record, entry.row.match ?? []);
            })
                .sort((left, right) => right.time - left.time)
                .flatMap((record) => {
                const failure = failureByRecord.get(`${record.sessionId}:${String(record.seq)}`);
                return failure === undefined ? [] : [failure];
            });
        const lastFailure = rowFailures[0];
        // A row whose failures were all recovered needs no attention of its own.
        const unrecoveredErrors = rowFailures.filter((failure) => !failure.recovered).length;
        return {
            id: entry.row.id,
            label: entry.row.label,
            kind: entry.row.kind,
            group: entry.group,
            ...(state === undefined ? {} : { status: state.status }),
            ...(readiness === undefined ? {} : { readiness }),
            note: state?.note ?? GUIDANCE_NOTE,
            ...(entry.row.trigger === undefined ? {} : { trigger: entry.row.trigger }),
            traces,
            errors,
            unrecoveredErrors,
            counts: rowAggregate?.counts ?? [],
            tools: [...new Set((entry.row.match ?? []).flatMap((predicate) => predicate.tool ?? []))],
            ...(details[0] === undefined ? {} : { lastActivity: details[0].time }),
            ...(lastFailure === undefined
                ? {}
                : {
                    lastFailure: {
                        time: lastFailure.time,
                        ...(lastFailure.tool === undefined ? {} : { tool: lastFailure.tool }),
                        ...(lastFailure.errorName === undefined ? {} : { errorName: lastFailure.errorName }),
                        ...(lastFailure.errorCode === undefined ? {} : { errorCode: lastFailure.errorCode }),
                    },
                }),
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
        failures: failures.slice(0, FAILURE_LIMIT),
        failureTotals,
        toolOutcomes: callOutcomes(options.records, options.range, window),
        rows: report,
        blindSpots: BLIND_SPOTS,
    };
}
/** Name the failure sessions; an absent title falls back to the short id in the view. */
export function attachSessionTitles(report, titles) {
    if (titles.size === 0)
        return report;
    return {
        ...report,
        failures: report.failures.map((failure) => {
            const title = titles.get(failure.sessionId);
            return title === undefined ? failure : { ...failure, sessionTitle: title };
        }),
    };
}
