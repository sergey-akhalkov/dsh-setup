import { aggregate } from './aggregate.js';
import { builtinRows, matchesOwnedTool, testableRow } from './builtins.js';
import { addUsage, buildEpisodes, clipIntervals, intervalLength, laneIntervals, NO_USAGE, } from './episodes.js';
import { serialRunFindings } from './findings.js';
import { evaluateHypotheses } from './hypotheses.js';
import { autonomySummary, costSummary, cutoffOf, dataQuality, episodeWork, FULL_WINDOW, overlapsWindow, qualitySummary, speedSummary, startsIn, subagentSummary, usageCoverage, } from './metrics.js';
import { buildProcessTimeline, processSummary } from './process.js';
import { scorecards as buildScorecards } from './scorecards.js';
import { GUIDANCE_NOTE, guidanceReadiness, rowState, } from './status.js';
/** What the view must state it cannot observe, not hide. */
export const BLIND_SPOTS = [
    'A plugin that fails while loading appends no session event and registers no tool, prompt section, or skill, so a declaration is the only handle it offers here.',
    'UI rendering effects are not recorded in the session log.',
    'Whether the model complied with a prompted rule cannot be judged from event counts; only the contribution’s presence is checked.',
    'Whether a human accepted a completed result is not recorded; a completed turn is not proof of acceptance.',
    'The configuration and version active in a past session are not recorded, so two sessions may have run different setups.',
    'Every plugin comparison here is an association, not causal proof.',
];
/** How many drill-down entries one row keeps; the dashboard shows five. */
export const DETAIL_LIMIT = 25;
/** How many failure entries the report carries; the counts are uncapped. */
export const FAILURE_LIMIT = 200;
/** How many episodes the report carries; the counts remain uncapped. */
export const EPISODE_LIMIT = 200;
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
/** The episode inputs a record corpus forms, with its listed header metadata. */
function episodesOf(records, sessions) {
    const bySession = new Map();
    for (const record of records) {
        const list = bySession.get(record.sessionId) ?? [];
        list.push(record);
        bySession.set(record.sessionId, list);
    }
    const metaById = new Map((sessions ?? []).map((meta) => [meta.id, meta]));
    const inputs = [...bySession.entries()].map(([id, list]) => ({
        id,
        records: list,
        meta: metaById.get(id) ?? { id },
    }));
    for (const meta of sessions ?? []) {
        if (!bySession.has(meta.id))
            inputs.push({ id: meta.id, records: [], meta });
    }
    return inputs;
}
/** Usage from the episode's start through the cutoff, including pre-window work. */
function usageUntil(episode, cutoff) {
    const records = [...episode.records, ...episode.children.flatMap((child) => child.records)];
    return records.reduce((total, record) => record.usage === undefined || record.time >= cutoff ? total : addUsage(total, record.usage), NO_USAGE);
}
/** Milliseconds the parent waited on delegate calls inside the window, unioned. */
function parentWait(work) {
    const callTimes = new Map();
    const intervals = [];
    for (const record of work.ownRecords) {
        if (record.eventType === 'tool/call' &&
            record.tool === 'delegate' &&
            record.callId !== undefined) {
            callTimes.set(record.callId, record.time);
            continue;
        }
        if (record.eventType !== 'tool/result' || record.callId === undefined)
            continue;
        const from = callTimes.get(record.callId);
        if (from === undefined)
            continue;
        intervals.push({ from, to: record.time });
        callTimes.delete(record.callId);
    }
    // Overlapping delegate waits count once, matching the summary's union.
    return intervalLength(clipIntervals(intervals, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY));
}
/** The widest number of children active at once in one episode. */
function episodeParallel(work) {
    const points = work.children.flatMap((child) => {
        const end = child.end > child.start ? child.end : child.start + 1;
        return [
            { time: child.start, delta: 1 },
            { time: end, delta: -1 },
        ];
    });
    points.sort((left, right) => left.time - right.time || left.delta - right.delta);
    let current = 0;
    let widest = 0;
    for (const point of points) {
        current += point.delta;
        if (current > widest)
            widest = current;
    }
    return widest;
}
function episodeReport(work, titles, rows) {
    const episode = work.episode;
    const lanes = laneIntervals(episode.records);
    const start = episode.start;
    const end = episode.end;
    return {
        id: episode.id,
        sessionId: episode.sessionId,
        ...(titles.get(episode.sessionId) === undefined
            ? {}
            : { sessionTitle: titles.get(episode.sessionId) }),
        start: episode.start,
        end: episode.end,
        durationMs: episode.end - episode.start,
        steps: work.steps,
        toolCalls: work.toolCalls,
        turns: episode.turns,
        commands: episode.commands,
        humanMessages: episode.humanMessages,
        machineMessages: episode.machineMessages,
        outcome: work.outcome,
        verified: work.verified,
        failures: work.failures,
        substantive: work.substantive,
        activeMs: work.activeMs,
        activeMsFull: episode.activeMs,
        usage: work.usage,
        fullUsage: work.fullUsage,
        throughCutoffUsage: usageUntil(episode, work.cutoff),
        costBasis: work.costBasis,
        goals: work.goals,
        checkpoints: work.checkpoints,
        delegateCalls: work.ownRecords.filter((record) => record.eventType === 'tool/call' && record.tool === 'delegate').length,
        parallelWidth: episodeParallel(work),
        parentWaitMs: parentWait(work),
        children: work.children.map((child) => {
            const detail = episode.children.find((entry) => entry.sessionId === child.sessionId);
            return {
                sessionId: child.sessionId,
                ...(titles.get(child.sessionId) === undefined
                    ? {}
                    : { sessionTitle: titles.get(child.sessionId) }),
                ...(detail?.origin === undefined ? {} : { origin: detail.origin }),
                ...(detail?.delegationDepth === undefined
                    ? {}
                    : { delegationDepth: detail.delegationDepth }),
                outcome: child.outcome,
                verified: child.verified,
                usage: child.usage,
                toolCalls: child.toolCalls,
            };
        }),
        firedRows: rows
            .filter((entry) => entry.row.kind === 'signal' &&
            [...work.ownRecords, ...work.childRecords].some((record) => entry.test(record)))
            .map((entry) => entry.row.id),
        timeline: {
            from: start,
            to: end,
            steps: clipIntervals(lanes.steps, Math.max(start, work.episode.start), end),
            tools: clipIntervals(lanes.tools, Math.max(start, work.episode.start), end),
            human: episode.records
                .filter((record) => record.eventType === 'user/message' && record.sourceKind === 'user')
                .map((record) => record.time),
            errors: episode.records
                .filter((record) => record.failed === true)
                .map((record) => record.time),
            // Recorded counters, so an unfinished step or pending call still shows.
            stepsCount: episode.records.filter((record) => record.eventType === 'step/start').length,
            callsCount: episode.records.filter((record) => record.eventType === 'tool/call').length,
        },
    };
}
/** The session range's time-based timeline, one lane per turn. */
function sessionTimeline(records) {
    if (records.length === 0)
        return { from: 0, to: 0, turns: [] };
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const record of records) {
        if (record.time < from)
            from = record.time;
        if (record.time > to)
            to = record.time;
    }
    if (to <= from)
        to = from + 1;
    const turns = new Map();
    const accumulator = (turn) => {
        let entry = turns.get(turn);
        if (entry === undefined) {
            entry = {
                start: Number.POSITIVE_INFINITY,
                end: Number.NEGATIVE_INFINITY,
                steps: [],
                tools: [],
                human: [],
                errors: [],
                stepsCount: 0,
                callsCount: 0,
                errorCount: 0,
                stepStarts: new Map(),
                callStarts: new Map(),
            };
            turns.set(turn, entry);
        }
        return entry;
    };
    for (const record of records) {
        // A record outside any turn stays on the timeline under turn 0.
        const entry = accumulator(record.turn ?? 0);
        if (record.time < entry.start)
            entry.start = record.time;
        if (record.time > entry.end)
            entry.end = record.time;
        if (record.failed === true) {
            entry.errors.push(record.time);
            entry.errorCount += 1;
        }
        if (record.eventType === 'user/message' && record.sourceKind === 'user') {
            entry.human.push(record.time);
            continue;
        }
        if (record.eventType === 'step/start') {
            entry.stepsCount += 1;
            if (record.step !== undefined) {
                entry.stepStarts.set(`${String(record.turn)}:${String(record.step)}`, record.time);
            }
            continue;
        }
        if (record.eventType === 'step/end' && record.step !== undefined) {
            const start = entry.stepStarts.get(`${String(record.turn)}:${String(record.step)}`);
            if (start !== undefined)
                entry.steps.push({ from: start, to: record.time });
            continue;
        }
        if (record.eventType === 'tool/call') {
            entry.callsCount += 1;
            if (record.callId !== undefined)
                entry.callStarts.set(record.callId, record.time);
            continue;
        }
        if (record.eventType === 'tool/result' && record.callId !== undefined) {
            const start = entry.callStarts.get(record.callId);
            if (start !== undefined)
                entry.tools.push({ from: start, to: record.time });
        }
    }
    return {
        from,
        to,
        turns: [...turns.entries()]
            .sort(([left], [right]) => left - right)
            .map(([turn, entry]) => ({
            turn,
            start: entry.start,
            end: entry.end,
            durationMs: Math.max(0, entry.end - entry.start),
            steps: entry.steps,
            tools: entry.tools,
            human: entry.human,
            errors: entry.errors,
            stepsCount: entry.stepsCount,
            callsCount: entry.callsCount,
            errorCount: entry.errorCount,
        })),
    };
}
/** The window's tokens from attributed episode work, each child counted once. */
function attributedUsage(work) {
    return work.reduce((total, entry) => addUsage(total, entry.usage), NO_USAGE);
}
/** The complete goal stream per session, including events outside an episode. */
function goalStreams(records) {
    const streams = new Map();
    for (const record of records) {
        if (record.eventType !== 'goal/change')
            continue;
        const list = streams.get(record.sessionId) ?? [];
        list.push(record);
        streams.set(record.sessionId, list);
    }
    for (const list of streams.values()) {
        list.sort((left, right) => left.time - right.time || left.seq - right.seq);
    }
    return streams;
}
/** The records behind the attributed usage: own and joined-child records once. */
function attributedRecords(work) {
    return work.flatMap((entry) => [...entry.ownRecords, ...entry.childRecords]);
}
/** The metric values a hypothesis is evaluated against. */
function metricValues(work, quality, cost, autonomy, subagents) {
    const tokensPerEpisode = work.length === 0
        ? undefined
        : work.reduce((sum, entry) => sum + entry.usage.total, 0) / work.length;
    const activePerEpisode = work.length === 0
        ? undefined
        : work.reduce((sum, entry) => sum + entry.activeMs, 0) / work.length / 60_000;
    const stepsPerHuman = autonomy.humanMessages === 0
        ? undefined
        : work.reduce((sum, entry) => sum + entry.steps, 0) / autonomy.humanMessages;
    return {
        samples: work.length,
        ...(quality.verifiedShare === undefined
            ? {}
            : { verifiedCompletionRate: quality.verifiedShare }),
        ...(tokensPerEpisode === undefined ? {} : { tokensPerEpisode }),
        ...(cost.contextPerStep === undefined ? {} : { contextTokensPerStep: cost.contextPerStep }),
        ...(activePerEpisode === undefined ? {} : { activeMinutesPerEpisode: activePerEpisode }),
        ...(stepsPerHuman === undefined ? {} : { stepsPerHumanMessage: stepsPerHuman }),
        ...(autonomy.humanMessagesPerCompletedGoal === undefined
            ? {}
            : { humanMessagesPerCompletedGoal: autonomy.humanMessagesPerCompletedGoal }),
        ...(subagents.delegateRate === undefined ? {} : { delegateRate: subagents.delegateRate }),
        ...(quality.checkpointCoverage === undefined
            ? {}
            : { checkpointCoverage: quality.checkpointCoverage }),
        ...(quality.failureRate === undefined ? {} : { failureRate: quality.failureRate }),
    };
}
/** The summaries a baseline comparison carries. */
function baselineComparison(options) {
    const window = { from: options.from, to: options.to };
    const index = buildEpisodes(episodesOf(options.records, options.sessions), options.idleGapMs);
    const work = index.episodes.map((episode) => episodeWork(episode, window));
    const cohort = work.filter((entry) => startsIn(entry.episode, window));
    // Window totals come from attributed episode work, so an unlinked child or a
    // preamble record is never added outside its episode.
    const usage = attributedUsage(work);
    const coverage = usageCoverage(attributedRecords(work), FULL_WINDOW);
    const quality = qualitySummary(cohort);
    const cost = costSummary(cohort, usage, coverage, options.to);
    const speed = speedSummary(cohort);
    const autonomy = autonomySummary(work, cohort, goalStreams(options.records), window);
    const subagents = subagentSummary(cohort, index.unlinked.length);
    return {
        kind: options.kind,
        from: options.from,
        to: options.to,
        episodes: cohort.length,
        quality,
        cost,
        speed,
        autonomy,
        subagents,
        metrics: metricValues(cohort, quality, cost, autonomy, subagents),
        process: processSummary(work.filter((entry) => overlapsWindow(entry.episode, window)), window),
    };
}
/** The step starts per calendar bucket, carrying the aggregate bucket bounds. */
function bucketSteps(records, buckets) {
    const counts = new Array(buckets.length).fill(0);
    for (const record of records) {
        if (record.eventType !== 'step/start')
            continue;
        for (let index = 0; index < buckets.length; index += 1) {
            const bucket = buckets[index];
            if (bucket !== undefined && record.time >= bucket.from && record.time < bucket.to) {
                counts[index] = (counts[index] ?? 0) + 1;
                break;
            }
        }
    }
    return buckets.map((bucket, index) => ({
        from: bucket.from,
        to: bucket.to,
        steps: counts[index] ?? 0,
    }));
}
/** The bucket series; the session range uses time buckets, never turns. */
function timeSeries(records, range, window) {
    if (range !== 'session') {
        return {
            labels: window.buckets.map((bucket) => bucket.label),
            activity: [...window.activity],
            errorSeries: [...window.errorSeries],
            steps: bucketSteps(records, window.buckets),
        };
    }
    const buckets = 24;
    if (records.length === 0) {
        return {
            labels: Array.from({ length: buckets }, (_unused, index) => `b${String(index + 1)}`),
            activity: new Array(buckets).fill(0),
            errorSeries: new Array(buckets).fill(0),
            steps: Array.from({ length: buckets }, () => ({ from: 0, to: 0, steps: 0 })),
        };
    }
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const record of records) {
        if (record.time < from)
            from = record.time;
        if (record.time > to)
            to = record.time;
    }
    const span = Math.max(1, to + 1 - from);
    const width = span / buckets;
    const activity = new Array(buckets).fill(0);
    const errorSeries = new Array(buckets).fill(0);
    const steps = new Array(buckets).fill(0);
    const labels = Array.from({ length: buckets }, (_unused, index) => {
        const time = from + index * width;
        const date = new Date(time);
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    });
    for (const record of records) {
        const index = Math.min(buckets - 1, Math.max(0, Math.floor((record.time - from) / width)));
        activity[index] = (activity[index] ?? 0) + 1;
        if (record.eventType === 'step/start')
            steps[index] = (steps[index] ?? 0) + 1;
        if (record.failed === true)
            errorSeries[index] = (errorSeries[index] ?? 0) + 1;
    }
    // The session range's slices have no calendar bounds; the panel keeps index layout.
    return {
        labels,
        activity,
        errorSeries,
        steps: steps.map((count) => ({ from: 0, to: 0, steps: count })),
    };
}
/** The concrete bounds the process timeline draws; the session range has no fixed window. */
function processWindowOf(range, window, records) {
    if (range !== 'session')
        return { from: window.from, to: window.to };
    if (records.length === 0)
        return { from: 0, to: 0 };
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const record of records) {
        if (record.time < from)
            from = record.time;
        if (record.time > to)
            to = record.time;
    }
    return { from, to: to + 1 };
}
/** The metric values a window's records produce; used for a hypothesis's own window. */
export function metricValuesFor(options) {
    const index = buildEpisodes(episodesOf(options.records, options.sessions), options.idleGapMinutes * 60_000);
    const work = index.episodes.map((episode) => episodeWork(episode, options.window));
    const cohort = work.filter((entry) => startsIn(entry.episode, options.window));
    const usage = attributedUsage(work);
    const coverage = usageCoverage(attributedRecords(work), FULL_WINDOW);
    const quality = qualitySummary(cohort);
    const cost = costSummary(cohort, usage, coverage, options.window.to);
    const autonomy = autonomySummary(work, cohort, goalStreams(options.records), options.window);
    const subagents = subagentSummary(cohort, index.unlinked.length);
    return metricValues(cohort, quality, cost, autonomy, subagents);
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
    const configuredRows = options.configured.map(testableRow);
    const window = aggregate(options.records, rows, options.range, options.now);
    const idleGapMs = (options.config?.idleGapMinutes ?? 30) * 60_000;
    const minEpisodes = options.config?.minEpisodes ?? 10;
    const index = buildEpisodes(episodesOf(options.records, options.sessions), idleGapMs);
    const observed = options.range === 'session' ? FULL_WINDOW : { from: window.from, to: window.to };
    const work = index.episodes.map((episode) => episodeWork(episode, observed));
    const cohort = work.filter((entry) => startsIn(entry.episode, observed));
    const usage = attributedUsage(work);
    const coverage = usageCoverage(attributedRecords(work), FULL_WINDOW);
    const cutoff = cutoffOf(options.range, observed);
    const titles = options.titles ?? new Map();
    const quality = qualitySummary(cohort);
    const cost = costSummary(cohort, usage, coverage, cutoff);
    const speed = speedSummary(cohort);
    const autonomy = autonomySummary(work, cohort, goalStreams(options.records), observed);
    const subagents = subagentSummary(cohort, index.unlinked.length);
    // Scorecards evaluate window records and count the start-selected cohort.
    const cards = buildScorecards(configuredRows, cohort, minEpisodes);
    const compared = cards.reduce((sum, card) => sum + card.treated.n + card.control.n, 0);
    const data = dataQuality(cohort, coverage, index.unlinked.length, compared);
    const current = metricValues(cohort, quality, cost, autonomy, subagents);
    const comparison = options.baseline === undefined
        ? undefined
        : baselineComparison({
            kind: options.baseline.kind,
            records: options.baseline.records,
            sessions: options.baseline.sessions,
            from: options.baseline.from,
            to: options.baseline.to,
            idleGapMs,
        });
    const baselineValues = comparison?.metrics;
    // A hypothesis is evaluated over the window it declares, not over whichever
    // range the view happens to request.
    const valuesFor = (range) => {
        const provided = options.hypothesisValues?.get(range);
        if (provided !== undefined)
            return provided;
        return {
            current,
            ...(baselineValues === undefined ? {} : { baseline: baselineValues }),
        };
    };
    const hypotheses = (options.config?.hypotheses ?? []).flatMap((hypothesis, hypothesisIndex) => evaluateHypotheses([hypothesis], valuesFor(hypothesis.window).current, valuesFor(hypothesis.window).baseline).map((result) => ({ ...result, index: hypothesisIndex })));
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
            ...(entry.row.goal === undefined ? {} : { goal: entry.row.goal }),
            eligibilityDeclared: entry.row.eligible !== undefined,
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
    const bounded = work
        .filter((entry) => overlapsWindow(entry.episode, observed))
        .sort((left, right) => right.episode.start - left.episode.start);
    const series = timeSeries(options.records, options.range, window);
    const timeline = options.range === 'session' ? sessionTimeline(options.records) : undefined;
    const process = buildProcessTimeline({
        work: bounded,
        window: processWindowOf(options.range, window, options.records),
        stepRate: series.steps,
        minEpisodes,
        ...(options.config?.interventionAt === undefined
            ? {}
            : { interventionAt: options.config.interventionAt }),
        ...(comparison === undefined
            ? {}
            : { baseline: { kind: comparison.kind, summary: comparison.process } }),
    });
    return {
        range: options.range,
        from: window.from,
        to: window.to,
        bucketLabels: series.labels,
        totals: window.totals,
        windowCost: usage,
        activity: series.activity,
        errorSeries: series.errorSeries,
        failures: failures.slice(0, FAILURE_LIMIT),
        failureTotals,
        toolOutcomes: callOutcomes(options.records, options.range, window),
        rows: report,
        episodes: bounded
            .slice(0, EPISODE_LIMIT)
            .map((entry) => episodeReport(entry, titles, configuredRows)),
        episodeCount: bounded.length,
        cohortCount: cohort.length,
        quality,
        cost,
        speed,
        autonomy,
        subagents,
        dataQuality: data,
        scorecards: cards,
        hypotheses,
        findings: serialRunFindings(cohort),
        windowActiveMs: work.reduce((sum, entry) => sum + entry.activeMs, 0),
        ...(comparison === undefined ? {} : { baseline: comparison }),
        process,
        ...(timeline === undefined ? {} : { timeline }),
        blindSpots: BLIND_SPOTS,
        cutoffLabel: cost.cutoffLabel,
        minEpisodes,
    };
}
/** Name the sessions of failures, episodes, and children; an absent title falls back to the id. */
export function attachSessionTitles(report, titles) {
    if (titles.size === 0)
        return report;
    return {
        ...report,
        failures: report.failures.map((failure) => {
            const title = titles.get(failure.sessionId);
            return title === undefined ? failure : { ...failure, sessionTitle: title };
        }),
        episodes: report.episodes.map((episode) => {
            const title = titles.get(episode.sessionId);
            const children = episode.children.map((child) => {
                const childTitle = titles.get(child.sessionId);
                return childTitle === undefined ? child : { ...child, sessionTitle: childTitle };
            });
            return {
                ...(title === undefined ? episode : { ...episode, sessionTitle: title }),
                children,
            };
        }),
    };
}
