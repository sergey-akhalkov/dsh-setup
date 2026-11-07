import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { normalizeFindingClass, sanitizeText } from '../shared/approval.js';
/**
 * Bounded local finding history: the review engine overwrites its record on a
 * later PASS, so this separate JSONL keeps the findings that P0/P1 repetitions
 * are measured from. Local scratch only; never tracked.
 */
export const REVIEW_LEARNING_DIR = '.dsh/review-learning';
/** Default and hard ceiling for the retro/history window. */
export const DEFAULT_HISTORY_WINDOW = 50;
export const MAX_HISTORY_WINDOW = 200;
const MAX_HISTORY_FINDINGS = 20;
const MAX_HISTORY_TEXT = 1_000;
/** Stable per-workspace key: the hash of the resolved root, never the root. */
export function workspaceKeyOf(workspaceRoot) {
    return createHash('sha256').update(resolve(workspaceRoot)).digest('hex').slice(0, 16);
}
export function findingHistoryPath(workspaceRoot) {
    return join(workspaceRoot, REVIEW_LEARNING_DIR, `${workspaceKeyOf(workspaceRoot)}.history.jsonl`);
}
/** The configured window, clamped to the documented default and ceiling. */
export function historyWindowOf(value) {
    if (value === undefined || !Number.isSafeInteger(value) || value < 1)
        return DEFAULT_HISTORY_WINDOW;
    return Math.min(value, MAX_HISTORY_WINDOW);
}
function clip(text) {
    return text.length <= MAX_HISTORY_TEXT ? text : `${text.slice(0, MAX_HISTORY_TEXT - 1)}…`;
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseFinding(value) {
    if (!isRecord(value))
        return undefined;
    const { title, evidence, fix } = value;
    if (typeof title !== 'string' || title === '')
        return undefined;
    if (typeof evidence !== 'string' || evidence === '')
        return undefined;
    if (typeof fix !== 'string' || fix === '')
        return undefined;
    return {
        class: normalizeFindingClass(value.class),
        title: clip(title),
        evidence: clip(evidence),
        fix: clip(fix),
    };
}
function parseHistoryEntry(value) {
    if (!isRecord(value) || value.v !== 1)
        return undefined;
    if (typeof value.time !== 'string' || value.time === '')
        return undefined;
    if (value.kind === 'gap') {
        if (typeof value.reason !== 'string' || value.reason === '')
            return undefined;
        return { v: 1, kind: 'gap', time: value.time, reason: clip(value.reason) };
    }
    if (value.kind !== 'run')
        return undefined;
    if (typeof value.rule !== 'string' || value.rule === '')
        return undefined;
    if (typeof value.change !== 'string' || value.change === '')
        return undefined;
    if (value.taskId !== undefined && typeof value.taskId !== 'string')
        return undefined;
    if (value.verdict !== 'PASS' && value.verdict !== 'FINDINGS')
        return undefined;
    if (typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest))
        return undefined;
    if (!Array.isArray(value.findings))
        return undefined;
    const findings = value.findings.slice(0, MAX_HISTORY_FINDINGS).map(parseFinding);
    if (!findings.every((finding) => finding !== undefined))
        return undefined;
    return {
        v: 1,
        kind: 'run',
        rule: value.rule,
        change: value.change,
        ...(value.taskId === undefined ? {} : { taskId: value.taskId }),
        verdict: value.verdict,
        digest: value.digest,
        findings,
        time: value.time,
    };
}
/** One JSONL line's valid entry, or undefined when the line is malformed. */
export function parseHistoryLine(line) {
    try {
        return parseHistoryEntry(JSON.parse(line));
    }
    catch {
        return undefined;
    }
}
async function readRawEntries(path) {
    let raw;
    try {
        raw = await readFile(path, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return { entries: [], skipped: 0 };
        throw error;
    }
    const entries = [];
    let skipped = 0;
    for (const line of raw.split(/\r?\n/)) {
        if (line.trim() === '')
            continue;
        const entry = parseHistoryLine(line);
        if (entry === undefined)
            skipped += 1;
        else
            entries.push(entry);
    }
    return { entries, skipped };
}
/** Serialize same-process writers per file so a prune never races an append. */
const historyWrites = new Map();
function withHistoryLock(path, work) {
    const previous = historyWrites.get(path) ?? Promise.resolve();
    const next = previous.then(work);
    historyWrites.set(path, next);
    return next.finally(() => {
        if (historyWrites.get(path) === next)
            historyWrites.delete(path);
    });
}
/** Keep at most `window - 1` earlier entries; `window = 1` retains none. */
function pruneEntries(entries, window) {
    const keep = window - 1;
    return keep <= 0 ? [] : entries.slice(-keep);
}
/** Write the whole bounded file atomically; the caller holds the file lock. */
async function writeHistoryLines(path, entries) {
    await mkdir(dirname(path), { recursive: true });
    const body = entries.map((entry) => JSON.stringify(entry)).join('\n');
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${body}\n`, 'utf8');
    try {
        await rename(temporary, path);
    }
    catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}
/** Read the last `window` entries; a malformed line is counted, never fatal. */
export async function readFindingHistory(workspaceRoot, options = {}) {
    const window = historyWindowOf(options.window);
    const { entries, skipped } = await readRawEntries(findingHistoryPath(workspaceRoot));
    const windowed = entries.slice(-window);
    return {
        entries: windowed,
        skipped,
        gaps: windowed.filter((entry) => entry.kind === 'gap').length,
    };
}
/** Redact machine paths and credentials before a failure reason is stored. */
export function sanitizeHistoryReason(error) {
    const message = error instanceof Error ? error.message : String(error);
    return clip(sanitizeText(message, MAX_HISTORY_TEXT).replace(/\s+/g, ' ').trim());
}
/**
 * Append one settled review's findings, pruning to the window first. A failure
 * never throws: one bounded `gap` marker is attempted, and when the file cannot
 * be written at all the caller reports the returned detail.
 */
export async function appendFindingHistory(workspaceRoot, entry, options = {}) {
    const window = historyWindowOf(options.window);
    const path = findingHistoryPath(workspaceRoot);
    const bounded = {
        ...entry,
        findings: entry.findings.slice(0, MAX_HISTORY_FINDINGS),
    };
    // The whole read-prune-write (including the gap marker) runs under the lock:
    // two concurrent completions must never rewrite the same prior contents.
    return withHistoryLock(path, async () => {
        try {
            const { entries } = await readRawEntries(path);
            await writeHistoryLines(path, [...pruneEntries(entries, window), bounded]);
            return { appended: true, gapAppended: false };
        }
        catch (error) {
            const reason = sanitizeHistoryReason(error);
            try {
                const { entries } = await readRawEntries(path);
                const gap = { v: 1, kind: 'gap', time: entry.time, reason };
                await writeHistoryLines(path, [...pruneEntries(entries, window), gap]);
                return { appended: false, gapAppended: true, detail: reason };
            }
            catch {
                return { appended: false, gapAppended: false, detail: reason };
            }
        }
    });
}
