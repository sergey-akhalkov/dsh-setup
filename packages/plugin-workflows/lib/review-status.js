import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CHANGE_NAME } from './command-parse.js';
import { currentSpecDigest, readWorkspaceFile } from './evidence.js';
import { isInside } from './fs-change.js';
import { checkedTaskLines, portableTaskReview, reviewerBinding, } from './parity.js';
import { localRecordError } from './projection.js';
/** Most missing checked tasks one summary names; the card's tooltip stays bounded. */
const MAX_MISSING = 20;
/** Longest raw checked line a task summary repeats. */
const MAX_UNPARSED = 40;
/** Longest unit label kept; the card's one review line stays one line. */
const MAX_LABEL = 80;
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nonEmpty(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
/**
 * The local whole-spec record when it is a readable whole-scope spec record.
 * The record's digest is the artifact digest a current PASS must still match.
 */
async function readSpecState(workspace, change, currentDigest) {
    // The gate's own reader: a linked or oversized record is not evidence.
    const record = await readWorkspaceFile(workspace, `.dsh/workflows/records/spec-review/${change}/spec.json`);
    if (record === undefined) {
        // A fresh clone has no local record; absence is not a failed review.
        return null;
    }
    let raw;
    try {
        raw = JSON.parse(record.text);
    }
    catch {
        return null;
    }
    if (!isRecord(raw) || localRecordError(raw) !== undefined)
        return null;
    if (raw.rule !== 'spec-review' || raw.change !== change || raw.phase !== 'spec')
        return null;
    if (raw.scope !== 'whole')
        return null;
    const target = isRecord(raw.target) ? raw.target : {};
    const model = nonEmpty(target.model);
    return {
        verdict: raw.verdict,
        current: currentDigest !== undefined && raw.digest === currentDigest,
        at: String(raw.time),
        findings: Array.isArray(raw.findings) ? raw.findings.length : 0,
        reviewer: nonEmpty(raw.reviewer) ?? nonEmpty(target.provider) ?? 'reviewer',
        ...(model === undefined ? {} : { model }),
    };
}
/** Checked-task coverage by the archive gate's portable approval match. */
function taskCoverage(workspace, change, markdown, binding) {
    const rule = binding?.taskRule ?? 'task-review';
    const tasks = checkedTaskLines(markdown);
    const missing = [];
    let checked = 0;
    let passed = 0;
    let at;
    for (const task of tasks) {
        checked += 1;
        const match = binding?.invalid === undefined
            ? portableTaskReview(workspace, change, task, rule, binding)
            : { mismatch: [binding.invalid] };
        if (match.mismatch.length === 0) {
            passed += 1;
            if (match.time !== undefined &&
                (at === undefined || Date.parse(match.time) > Date.parse(at))) {
                at = match.time;
            }
        }
        else if (missing.length < MAX_MISSING) {
            missing.push(task.number);
        }
    }
    // A checked line the task parser cannot read is an unapproved checked task,
    // exactly as the completion coverage treats it: it counts and is named raw.
    for (const line of markdown.split('\n')) {
        if (!/^\s*[-*+]\s*\[[xX]\]/u.test(line))
            continue;
        if (/^\s*-\s*\[[xX]\]\s+\d+(?:\.\d+)*\s+\S/u.test(line))
            continue;
        checked += 1;
        if (missing.length < MAX_MISSING)
            missing.push(line.trim().slice(0, MAX_UNPARSED));
    }
    return { checked, passed, missing, ...(at === undefined ? {} : { at }) };
}
/** One change's static review state; an unknown or unreadable change is undefined. */
export async function reviewSummary(workspace, change, 
/** Test seam for the artifact digest read; production uses `currentSpecDigest`. */
digestOf = currentSpecDigest) {
    if (!CHANGE_NAME.test(change))
        return undefined;
    // A change directory that resolves outside the workspace is never a row: a
    // junction there would otherwise expose another tree's tasks to the card.
    const root = await realpath(workspace).catch(() => undefined);
    const changeDirectory = await realpath(join(workspace, 'openspec', 'changes', change)).catch(() => undefined);
    if (root === undefined || changeDirectory === undefined || !isInside(root, changeDirectory)) {
        return undefined;
    }
    const info = await stat(changeDirectory).catch(() => undefined);
    // A missing change directory is an unknown row, not an unreviewed one.
    if (info?.isDirectory() !== true)
        return undefined;
    const binding = reviewerBinding(workspace);
    // A failed digest read does not hide the change: it only makes `current` false.
    const currentDigest = await digestOf(workspace, change).catch(() => undefined);
    const spec = await readSpecState(workspace, change, currentDigest);
    let tasks = null;
    try {
        const markdown = await readFile(join(workspace, 'openspec', 'changes', change, 'tasks.md'), 'utf8');
        tasks = taskCoverage(workspace, change, markdown, binding);
    }
    catch {
        // An unreadable tasks file omits the task unit instead of claiming coverage.
        tasks = null;
    }
    return { spec, tasks };
}
/** Per-change summaries; an unknown or unreadable row is omitted, never thrown. */
export async function summaries(workspace, changes) {
    const result = {};
    for (const change of changes) {
        try {
            const summary = await reviewSummary(workspace, change);
            if (summary !== undefined)
                result[change] = summary;
        }
        catch {
            // One unreadable change never fails the list request.
        }
    }
    return result;
}
/** The unit one review step produces; a custom whole-scope phase reads as spec. */
function unitOf(step) {
    if (step.review?.scope === 'task')
        return 'tasks';
    return step.review?.phase === 'integration' ? 'integration' : 'spec';
}
/** The bounded section title a task unit carries, when the run records one. */
function labelOf(context) {
    const title = context.sectionTitle;
    if (typeof title !== 'string')
        return undefined;
    const bounded = title.trim().slice(0, MAX_LABEL);
    return bounded === '' ? undefined : bounded;
}
/**
 * One entry per live or waiting review in the workspace. The #7 projection
 * decides the state and the host's admission set decides `starting`; an
 * orphaned run with no executor is never reported.
 */
export function live(workspace, source) {
    const definitions = source.definitionsFor(workspace);
    const running = [];
    const waiting = [];
    for (const { run, liveness, starting } of source.candidatesFor(workspace)) {
        if (liveness.state === 'orphaned')
            continue;
        const change = typeof run.context.name === 'string' ? run.context.name : '';
        if (!CHANGE_NAME.test(change))
            continue;
        const definition = definitions.find((entry) => entry.id === run.definition.id);
        const step = definition?.steps.find((entry) => entry.executor === 'review');
        const stored = step === undefined ? undefined : run.steps.find((entry) => entry.id === step.id);
        if (step === undefined || stored === undefined)
            continue;
        const label = labelOf(run.context);
        const entry = {
            session: run.session,
            change,
            definition: run.definition.id,
            unit: unitOf(step),
            ...(label === undefined ? {} : { label }),
            state: starting ? 'starting' : liveness.state,
            attempt: stored.attempts ?? liveness.attempt ?? 1,
            since: new Date(stored.requestedAt ?? run.updatedAt).toISOString(),
        };
        // A unit can be both running and waited on; the first entry a client picks
        // for that unit must be the running one, never its waiter.
        if (liveness.state === 'waiting')
            waiting.push(entry);
        else
            running.push(entry);
    }
    return [...running, ...waiting];
}
