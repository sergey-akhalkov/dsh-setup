import { startOfLocalDay } from './aggregate.js';
import { matchesPredicate } from './builtins.js';
import { distribution } from './metrics.js';
/**
 * Plugin scorecards: a declared goal, the eligible population, activation, and
 * an outcome comparison between the treated cohort (fired and eligible) and the
 * control (eligible and not fired), matched by tool-call size and week.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The tool-call size bins every comparison matches on. */
const BIN_EDGES = [10, 50, 200];
/** The bin index of an episode's tool-call count. */
export function toolBin(calls) {
    let bin = 0;
    for (const edge of BIN_EDGES) {
        if (calls >= edge)
            bin += 1;
    }
    return bin;
}
/** The local Monday-start key of a time, so a week cell is stable. */
export function weekStart(time) {
    const day = startOfLocalDay(time);
    const weekday = (new Date(day).getDay() + 6) % 7;
    return day - weekday * DAY;
}
/** The window's records of an episode, its children included. */
function episodeRecords(work) {
    return [...work.ownRecords, ...work.childRecords];
}
/** Whether a row fired anywhere inside the episode. */
function firedIn(work, row) {
    return episodeRecords(work).some((record) => row.test(record));
}
/** Whether an episode is eligible; an undeclared predicate makes every episode eligible. */
function eligibleIn(work, row) {
    const eligible = row.eligible;
    if (eligible === undefined)
        return true;
    return episodeRecords(work).some((record) => eligible.some((predicate) => matchesPredicate(record, predicate)));
}
function cohortMetrics(entries) {
    const completed = entries.filter((entry) => entry.outcome === 'completed');
    const verified = completed.filter((entry) => entry.verified).length;
    return {
        n: entries.length,
        ...(completed.length === 0 ? {} : { verifiedShare: verified / completed.length }),
        tokens: distribution(entries.map((entry) => entry.usage.total)),
        activeMinutes: distribution(entries.map((entry) => entry.activeMs / 60_000)),
        stepsPerHumanMessage: distribution(entries.flatMap((entry) => {
            const humans = entry.ownRecords.filter((record) => record.eventType === 'user/message' && record.sourceKind === 'user').length;
            return humans === 0 ? [] : [entry.steps / humans];
        })),
    };
}
/** Treated minus control for each comparable outcome. */
function deltasOf(treated, control) {
    const both = (left, right) => left.n > 0 && right.n > 0;
    return {
        ...(treated.verifiedShare === undefined || control.verifiedShare === undefined
            ? {}
            : { verifiedShare: treated.verifiedShare - control.verifiedShare }),
        ...(both(treated.tokens, control.tokens)
            ? { tokensP50: treated.tokens.p50 - control.tokens.p50 }
            : {}),
        ...(both(treated.activeMinutes, control.activeMinutes)
            ? { activeMinutesP50: treated.activeMinutes.p50 - control.activeMinutes.p50 }
            : {}),
        ...(both(treated.stepsPerHumanMessage, control.stepsPerHumanMessage)
            ? {
                stepsPerHumanMessageP50: treated.stepsPerHumanMessage.p50 - control.stepsPerHumanMessage.p50,
            }
            : {}),
    };
}
/** Split a cohort into matching cells: tool-call bin, or bin plus week. */
function matchCohorts(treated, control, minEpisodes) {
    const treatedByBin = new Map();
    const controlByBin = new Map();
    for (const entry of treated) {
        const bin = toolBin(entry.toolCalls);
        const list = treatedByBin.get(bin) ?? [];
        list.push(entry);
        treatedByBin.set(bin, list);
    }
    for (const entry of control) {
        const bin = toolBin(entry.toolCalls);
        const list = controlByBin.get(bin) ?? [];
        list.push(entry);
        controlByBin.set(bin, list);
    }
    const matchedTreated = new Set();
    const matchedControl = new Set();
    let weekRelaxed = false;
    for (const bin of new Set([...treatedByBin.keys(), ...controlByBin.keys()])) {
        const treatedBin = treatedByBin.get(bin) ?? [];
        const controlBin = controlByBin.get(bin) ?? [];
        if (treatedBin.length === 0 || controlBin.length === 0)
            continue;
        const weeks = new Set();
        for (const entry of [...treatedBin, ...controlBin])
            weeks.add(weekStart(entry.episode.start));
        const cells = [...weeks].map((week) => ({
            treated: treatedBin.filter((entry) => weekStart(entry.episode.start) === week),
            control: controlBin.filter((entry) => weekStart(entry.episode.start) === week),
        }));
        // Every week cell inside the bin must be large enough on both sides; a
        // small cell aggregates the whole bin across weeks and says so.
        const strong = cells.every((cell) => cell.treated.length >= minEpisodes && cell.control.length >= minEpisodes);
        const paired = strong ? cells : [{ treated: treatedBin, control: controlBin }];
        if (!strong)
            weekRelaxed = true;
        for (const pair of paired) {
            // Equal cell sizes, so one week's episode count cannot weigh the pooled
            // distributions and manufacture a delta the cells do not have.
            const size = Math.min(pair.treated.length, pair.control.length);
            const order = (left, right) => left.episode.start - right.episode.start;
            for (const entry of [...pair.treated].sort(order).slice(0, size)) {
                matchedTreated.add(entry);
            }
            for (const entry of [...pair.control].sort(order).slice(0, size)) {
                matchedControl.add(entry);
            }
        }
    }
    return {
        treated: [...matchedTreated],
        control: [...matchedControl],
        matched: matchedTreated.size > 0 && matchedControl.size > 0,
        weekRelaxed,
    };
}
/** One scorecard per configured signal row. */
export function scorecards(rows, work, minEpisodes) {
    return rows
        .filter((entry) => entry.row.kind === 'signal')
        .map((entry) => {
        const eligible = work.filter((candidate) => eligibleIn(candidate, entry.row));
        const fired = eligible.filter((candidate) => firedIn(candidate, entry));
        const firedOutside = work.filter((candidate) => !eligibleIn(candidate, entry.row) && firedIn(candidate, entry));
        const control = eligible.filter((candidate) => !firedIn(candidate, entry));
        const matched = matchCohorts(fired, control, minEpisodes);
        const treatedMetrics = cohortMetrics(matched.treated);
        const controlMetrics = cohortMetrics(matched.control);
        const insufficient = treatedMetrics.n < minEpisodes || controlMetrics.n < minEpisodes;
        return {
            rowId: entry.row.id,
            label: entry.row.label,
            ...(entry.row.goal === undefined ? {} : { goal: entry.row.goal }),
            eligibilityDeclared: entry.row.eligible !== undefined,
            eligible: eligible.length,
            fired: fired.length,
            firedOutside: firedOutside.length,
            ...(eligible.length === 0 ? {} : { activation: fired.length / eligible.length }),
            ...(fired.length === 0
                ? {}
                : {
                    errorRate: fired.filter((candidate) => candidate.failures > 0).length / fired.length,
                }),
            treated: treatedMetrics,
            control: controlMetrics,
            deltas: deltasOf(treatedMetrics, controlMetrics),
            matched: matched.matched,
            weekRelaxed: matched.weekRelaxed,
            insufficient,
            association: 'association, not proof',
        };
    });
}
