import { checkpointEvidence, EPISODE_OUTCOMES, finalTerminalOf, goalsOf, isHumanMessage, KNOWN_TERMINALS, NO_USAGE, outcomeOf, } from './episodes.js';
/** The whole corpus, used by the session range which has no cutoff. */
export const FULL_WINDOW = { from: Number.NEGATIVE_INFINITY, to: Number.POSITIVE_INFINITY };
/** The cutoff the session range reports. */
export const NO_CUTOFF = Number.POSITIVE_INFINITY;
/** The nearest-rank percentile of a value list; empty list reads zero. */
export function percentile(values, fraction) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const rank = Math.ceil(fraction * sorted.length) - 1;
    return sorted[Math.min(sorted.length - 1, Math.max(0, rank))] ?? 0;
}
/** A p50/p90 distribution of a value list. */
export function distribution(values) {
    return { p50: percentile(values, 0.5), p90: percentile(values, 0.9), n: values.length };
}
/** Whether a record's time falls inside a window. */
function inWindow(record, window) {
    return record.time >= window.from && record.time < window.to;
}
/** Whether a record's time is before the cutoff, the session range included. */
function before(record, cutoff) {
    return record.time < cutoff;
}
/** Sum the usage of a record list, ignoring time. */
function sumUsage(records) {
    let total = NO_USAGE;
    for (const record of records) {
        if (record.usage === undefined)
            continue;
        total = {
            input: total.input + record.usage.input,
            output: total.output + record.usage.output,
            cacheRead: total.cacheRead + record.usage.cacheRead,
            cacheWrite: total.cacheWrite + record.usage.cacheWrite,
            total: total.total + record.usage.total,
        };
    }
    return total;
}
/** Sum the usage of the records inside a window. */
export function windowUsage(records, window) {
    return sumUsage(records.filter((record) => inWindow(record, window)));
}
/** Count the steps and messages that recorded usage. */
export function usageCoverage(records, window) {
    const steps = new Set();
    const stepsWithUsage = new Set();
    let messages = 0;
    let messagesWithUsage = 0;
    const stepKey = (record) => record.turn === undefined || record.step === undefined
        ? undefined
        : `${record.sessionId}:${String(record.turn)}:${String(record.step)}`;
    for (const record of records) {
        if (!inWindow(record, window))
            continue;
        if (record.eventType === 'step/start') {
            const key = stepKey(record);
            if (key !== undefined)
                steps.add(key);
            continue;
        }
        if (record.eventType !== 'assistant/message')
            continue;
        messages += 1;
        if (record.usage === undefined)
            continue;
        messagesWithUsage += 1;
        const key = stepKey(record);
        if (key !== undefined)
            stepsWithUsage.add(key);
    }
    // A message's usage covers the step only when that step started in the window;
    // usage recorded for a step that started earlier cannot mask a missing step.
    const coveredSteps = [...stepsWithUsage].filter((key) => steps.has(key)).length;
    const stepCoverage = steps.size === 0 ? (messages === 0 ? 0 : 1) : coveredSteps / steps.size;
    const messageCoverage = messages === 0 ? (steps.size === 0 ? 0 : 1) : messagesWithUsage / messages;
    return {
        steps: steps.size,
        stepsWithUsage: coveredSteps,
        messages,
        messagesWithUsage,
        stepCoverage,
        messageCoverage,
        // Both halves must be complete before coverage reads complete.
        coverage: Math.min(stepCoverage, messageCoverage),
    };
}
/** The successful calls of one window, joined to their own results. */
function hasSuccessfulWrite(records) {
    const failed = new Set();
    for (const record of records) {
        if (record.eventType === 'tool/result' &&
            record.failed === true &&
            record.callId !== undefined) {
            failed.add(record.callId);
        }
    }
    return records.some((record) => record.eventType === 'tool/call' &&
        (record.tool === 'edit' || record.tool === 'write') &&
        (record.callId === undefined || !failed.has(record.callId)));
}
/** The overlap of an active interval with a window. */
function intervalInWindow(intervals, window) {
    let total = 0;
    for (const interval of intervals) {
        const from = Math.max(interval.from, window.from);
        const to = Math.min(interval.to, window.to);
        if (to > from)
            total += to - from;
    }
    return total;
}
/** Clip one episode to the observed window. */
export function episodeWork(episode, window) {
    const ownRecords = episode.records.filter((record) => inWindow(record, window));
    const childRecords = episode.children.flatMap((child) => child.records.filter((record) => inWindow(record, window)));
    const beforeCutoff = (records) => records.filter((record) => before(record, window.to));
    const outcome = outcomeOf(beforeCutoff(episode.records));
    const checkpoints = checkpointEvidence(beforeCutoff(episode.records));
    const terminal = finalTerminalOf(beforeCutoff(episode.records));
    const children = episode.children.flatMap((child) => {
        // A child whose work spans the whole window has no in-window timestamp but
        // is still active in it, so the span decides membership and the records
        // decide usage. A genuine instant counts at the window start too.
        const instant = child.start === child.end;
        const overlaps = instant
            ? child.start >= window.from && child.start < window.to
            : child.start < window.to && child.end > window.from;
        if (!overlaps)
            return [];
        const records = child.records.filter((record) => inWindow(record, window));
        const clipped = child.records.filter((record) => before(record, window.to));
        const childOutcome = outcomeOf(clipped);
        return [
            {
                sessionId: child.sessionId,
                start: Math.max(child.start, window.from),
                end: Math.min(child.end, window.to),
                outcome: childOutcome.outcome,
                verified: checkpointEvidence(clipped).verified > 0,
                usage: sumUsage(records),
                toolCalls: records.filter((record) => record.eventType === 'tool/call').length,
            },
        ];
    });
    const work = [...ownRecords, ...childRecords];
    return {
        episode,
        usage: sumUsage(work),
        fullUsage: episode.usage,
        ownRecords,
        childRecords,
        childUsage: sumUsage(childRecords),
        children,
        steps: work.filter((record) => record.eventType === 'step/start').length,
        toolCalls: work.filter((record) => record.eventType === 'tool/call').length,
        activeMs: intervalInWindow(episode.intervals, window),
        outcome: outcome.outcome,
        verified: checkpoints.verified > 0,
        failures: outcome.failures,
        checkpoints,
        goals: goalsOf(beforeCutoff(episode.records)),
        ...(terminal === undefined ? {} : { terminal }),
        cutoff: window.to,
        substantive: work.filter((record) => record.eventType === 'tool/call').length >= 4 &&
            hasSuccessfulWrite(work),
        costBasis: 'through cutoff',
    };
}
/** Whether an episode started inside a window; cohorts select by start. */
export function startsIn(episode, window) {
    return episode.start >= window.from && episode.start < window.to;
}
/** Whether an episode has any work or span inside a window. */
export function overlapsWindow(episode, window) {
    return episode.start < window.to && episode.end >= window.from;
}
/** Cost and usage of one window's event-time totals and its cohort episodes. */
export function costSummary(work, usage, coverage, cutoff) {
    const contextLoad = usage.input + usage.cacheRead;
    const denominator = usage.input + usage.cacheRead;
    return {
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        total: usage.total,
        contextLoad,
        // The spec's mean is across assistant messages, not steps.
        contextPerStep: coverage.messages === 0 ? 0 : contextLoad / coverage.messages,
        ...(denominator === 0 ? {} : { cacheHitRatio: usage.cacheRead / denominator }),
        steps: coverage.steps,
        stepsWithUsage: coverage.stepsWithUsage,
        usageCoverage: coverage.coverage,
        messages: coverage.messages,
        messagesWithUsage: coverage.messagesWithUsage,
        cutoff: cutoff === NO_CUTOFF ? null : cutoff,
        cutoffLabel: cutoff === NO_CUTOFF ? 'full episode' : 'through cutoff',
        tokensPerEpisode: distribution(work.map((entry) => entry.usage.total)),
        fullTokensPerEpisode: distribution(work.map((entry) => entry.fullUsage.total)),
    };
}
/** Classify a cohort's outcomes. */
export function qualitySummary(work) {
    const counts = {
        completed: 0,
        failed: 0,
        cut: 0,
        blocked: 0,
        other: 0,
        open: 0,
    };
    for (const entry of work)
        counts[entry.outcome] += 1;
    const verified = work.filter((entry) => entry.outcome === 'completed' && entry.verified).length;
    const substantiveWork = work.filter((entry) => entry.substantive);
    const substantiveWithClose = substantiveWork.filter((entry) => entry.checkpoints.closes > 0).length;
    return {
        episodes: work.length,
        completed: counts.completed,
        verified,
        failed: counts.failed,
        cut: counts.cut,
        blocked: counts.blocked,
        other: counts.other,
        open: counts.open,
        ...(counts.completed === 0 ? {} : { verifiedShare: verified / counts.completed }),
        ...(work.length === 0 ? {} : { failureRate: counts.failed / work.length }),
        substantive: substantiveWork.length,
        ...(substantiveWork.length === 0
            ? {}
            : { checkpointCoverage: substantiveWithClose / substantiveWork.length }),
        unverified: Math.max(0, counts.completed - verified),
        stepsToCompletion: distribution(work.filter((entry) => entry.outcome === 'completed').map((entry) => entry.steps)),
    };
}
/** Active minutes per cohort episode, and per completed episode. */
export function speedSummary(work) {
    const minutes = work.map((entry) => entry.activeMs / 60_000);
    const completed = work
        .filter((entry) => entry.outcome === 'completed')
        .map((entry) => entry.activeMs / 60_000);
    return {
        n: work.length,
        activeMinutes: distribution(minutes),
        ...(completed.length === 0 ? {} : { completedActiveMinutes: distribution(completed) }),
    };
}
/**
 * Autonomy over the window. `work` supplies the window's messages and goal
 * lifecycles (including an episode spanning the boundary); `counted` is the
 * start-selected cohort the episode and session counts come from; `goalStreams`
 * replays the session's complete goal stream, including events in an idle gap.
 */
export function autonomySummary(work, counted = work, goalStreams, window) {
    let humanMessages = 0;
    let machineMessages = 0;
    const stepsPerHumanMessage = [];
    const machinePerHumanMessage = [];
    const bySession = new Map();
    for (const entry of work) {
        // Only the window's own messages count: a message or injection after the
        // cutoff, or a human message before a spanning episode begins, stays out.
        const humans = entry.ownRecords.filter(isHumanMessage).length;
        const machines = entry.ownRecords.filter((record) => record.eventType === 'user/message' && !isHumanMessage(record)).length;
        humanMessages += humans;
        machineMessages += machines;
        const list = bySession.get(entry.episode.sessionId) ?? [];
        list.push(entry);
        bySession.set(entry.episode.sessionId, list);
    }
    for (const entry of counted) {
        const humans = entry.ownRecords.filter(isHumanMessage).length;
        const machines = entry.ownRecords.filter((record) => record.eventType === 'user/message' && !isHumanMessage(record)).length;
        if (humans > 0) {
            stepsPerHumanMessage.push(entry.steps / humans);
            machinePerHumanMessage.push(machines / humans);
        }
    }
    const goals = new Map();
    const goalOf = (sessionId, id) => {
        const key = id ?? `${sessionId}:unidentified`;
        let state = goals.get(key);
        if (state === undefined) {
            state = { messages: 0, rounds: 0, completed: false };
            goals.set(key, state);
        }
        return state;
    };
    const keyOf = (sessionId, record) => record.goalId ?? `${sessionId}:unidentified`;
    const streamOf = (sessionId, entries) => {
        const provided = goalStreams?.get(sessionId);
        if (provided !== undefined)
            return [...provided];
        return entries
            .flatMap((entry) => entry.episode.records)
            .filter((record) => record.eventType === 'goal/change')
            .sort((left, right) => left.time - right.time || left.seq - right.seq);
    };
    const reported = new Set();
    for (const [sessionId, entries] of bySession) {
        entries.sort((left, right) => left.episode.start - right.episode.start);
        const stream = streamOf(sessionId, entries);
        const active = new Set();
        const applyLifecycle = (record) => {
            const id = keyOf(sessionId, record);
            const state = goalOf(sessionId, record.goalId);
            if (record.goalOperation !== 'complete') {
                if (!state.completed)
                    active.add(id);
            }
            else {
                state.completed = true;
                active.delete(id);
            }
            if (record.goalRounds !== undefined) {
                state.rounds = Math.max(state.rounds, record.goalRounds);
            }
            // A lifecycle event inside the window is reported even when it lands in an
            // idle gap between episodes; a message there is still not attributed.
            if (window !== undefined && record.time >= window.from && record.time < window.to) {
                reported.add(id);
            }
        };
        let cursor = 0;
        for (const entry of entries) {
            // A historical episode has no in-window records; leaving its lifecycle
            // events in the stream lets the next observed episode consume them.
            if (entry.ownRecords.length === 0)
                continue;
            const cutoff = entry.cutoff;
            const firstOwn = entry.ownRecords[0];
            const lastOwn = entry.ownRecords[entry.ownRecords.length - 1];
            const observed = entry.ownRecords.length > 0;
            // Compare by time and sequence, so adjacent episodes that share a
            // timestamp still assign every record to exactly one of them.
            const beforeBoundary = (record) => firstOwn === undefined ||
                record.time < firstOwn.time ||
                (record.time === firstOwn.time && record.seq < firstOwn.seq);
            const throughEpisode = (record) => lastOwn === undefined ||
                record.time < lastOwn.time ||
                (record.time === lastOwn.time && record.seq <= lastOwn.seq);
            // Everything before this episode's in-window part only seeds the state.
            while (cursor < stream.length) {
                const record = stream[cursor];
                if (record === undefined || !beforeBoundary(record))
                    break;
                if (record.time < cutoff)
                    applyLifecycle(record);
                cursor += 1;
            }
            const touched = new Set();
            while (cursor < stream.length) {
                const record = stream[cursor];
                if (record === undefined || !throughEpisode(record))
                    break;
                if (record.time < cutoff) {
                    applyLifecycle(record);
                    touched.add(keyOf(sessionId, record));
                }
                cursor += 1;
            }
            if (!observed)
                continue;
            const attributed = new Set([...active, ...touched]);
            const humans = entry.ownRecords.filter(isHumanMessage).length;
            for (const id of attributed) {
                const state = goals.get(id);
                if (state !== undefined)
                    state.messages += humans;
                reported.add(id);
            }
        }
        // Events after the last episode (an idle-gap completion) still close a goal
        // that was observed, up to the window cutoff.
        const lastCutoff = entries[entries.length - 1]?.cutoff ?? Number.POSITIVE_INFINITY;
        while (cursor < stream.length) {
            const record = stream[cursor];
            if (record === undefined || record.time >= lastCutoff)
                break;
            applyLifecycle(record);
            cursor += 1;
        }
    }
    // A goal observed only before the window is history, not a reported goal.
    for (const id of goals.keys()) {
        if (!reported.has(id))
            goals.delete(id);
    }
    let rounds = 0;
    let completedGoals = 0;
    let completedMessages = 0;
    for (const state of goals.values()) {
        rounds += state.rounds;
        if (state.completed) {
            completedGoals += 1;
            completedMessages += state.messages;
        }
    }
    const goalCount = goals.size;
    const sessions = new Set(counted.map((entry) => entry.episode.sessionId)).size;
    return {
        episodes: counted.length,
        sessions,
        ...(sessions === 0 ? {} : { episodesPerSession: counted.length / sessions }),
        humanMessages,
        machineMessages,
        stepsPerHumanMessage: distribution(stepsPerHumanMessage),
        machineMessagesPerHumanMessage: distribution(machinePerHumanMessage),
        goals: goalCount,
        completedGoals,
        ...(goalCount === 0 ? {} : { goalCompletionRate: completedGoals / goalCount }),
        rounds,
        ...(completedGoals === 0
            ? {}
            : { humanMessagesPerCompletedGoal: completedMessages / completedGoals }),
    };
}
/** The widest number of spans active at one instant; a zero-length span is one instant. */
export function parallelWidth(spans) {
    const points = spans.flatMap((span) => {
        // Half-open spans: touching spans do not overlap, and an instant still counts.
        const end = span.end > span.start ? span.end : span.start + 1;
        return [
            { time: span.start, delta: 1 },
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
/** Join delegate calls and child outcomes to their episodes. */
export function subagentSummary(work, unlinkedChildren) {
    let delegateCalls = 0;
    let episodesWithChild = 0;
    let childTokens = 0;
    let childFailures = 0;
    let linkedChildren = 0;
    let widest = 0;
    const waits = [];
    for (const entry of work) {
        const children = entry.children;
        if (children.length > 0)
            episodesWithChild += 1;
        linkedChildren += children.length;
        widest = Math.max(widest, parallelWidth(children));
        childTokens += entry.childUsage.total;
        childFailures += children.filter((child) => child.outcome === 'failed' || child.outcome === 'cut').length;
        const callTimes = new Map();
        const intervals = [];
        for (const record of entry.ownRecords) {
            if (record.eventType === 'tool/call' && record.tool === 'delegate') {
                delegateCalls += 1;
                if (record.callId !== undefined)
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
        // The parent waits on the union of delegate intervals, not their sum.
        intervals.sort((left, right) => left.from - right.from);
        let waited = 0;
        let open;
        for (const interval of intervals) {
            if (open === undefined) {
                open = interval;
                continue;
            }
            if (interval.from <= open.to) {
                if (interval.to > open.to)
                    open.to = interval.to;
                continue;
            }
            waited += open.to - open.from;
            open = interval;
        }
        if (open !== undefined)
            waited += open.to - open.from;
        if (waited > 0)
            waits.push(waited);
    }
    return {
        episodes: work.length,
        episodesWithChild,
        ...(work.length === 0 ? {} : { delegateRate: episodesWithChild / work.length }),
        delegateCalls,
        parallelWidth: widest,
        parentWaitMs: distribution(waits),
        childTokens,
        childFailures,
        linkedChildren,
        unlinkedChildren,
    };
}
/** The data-quality line for a window. */
export function dataQuality(work, coverage, unlinkedChildren, comparisonSample = 0) {
    let goalEvents = 0;
    let checkpoints = 0;
    for (const entry of work) {
        goalEvents +=
            entry.goals.created + entry.goals.paused + entry.goals.resumed + entry.goals.completed;
        checkpoints += entry.checkpoints.total;
    }
    return {
        steps: coverage.steps,
        stepsWithUsage: coverage.stepsWithUsage,
        messages: coverage.messages,
        messagesWithUsage: coverage.messagesWithUsage,
        usageCoverage: coverage.coverage,
        stepCoverage: coverage.stepCoverage,
        messageCoverage: coverage.messageCoverage,
        episodes: work.length,
        linkedChildren: work.reduce((sum, entry) => sum + entry.children.length, 0),
        unlinkedChildren,
        goalEvents,
        checkpoints,
        unmappedClosers: work.filter((entry) => entry.terminal !== undefined && !KNOWN_TERMINALS.has(entry.terminal)).length,
        comparisonSample,
    };
}
/** One outcome word per accepted outcome, in report order. */
export const OUTCOME_ORDER = EPISODE_OUTCOMES;
/** Whether a range observes a cutoff or the whole session. */
export function cutoffOf(range, window) {
    return range === 'session' ? NO_CUTOFF : window.to;
}
