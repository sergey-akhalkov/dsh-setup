import { appendFile, mkdir, readdir, readFile, rename, stat, truncate, unlink, } from 'node:fs/promises';
import { join } from 'node:path';
import { redactPayload, redactValue } from './redact.js';
/**
 * Bounded per-session event journal: one JSONL line per observed process
 * event, an index of the session log rather than a copy of it. Everything here
 * is local scratch under `.dsh/workflows`; nothing is tracked.
 */
/** Record schema version; a reader ignores a line it does not understand. */
export const JOURNAL_VERSION = 1;
/** Per-record cap: one record over this is summarized and marked truncated. */
export const MAX_RECORD_BYTES = 4096;
/** Per-session cap before the current file rotates to `.1`. */
export const MAX_SESSION_BYTES = 5 * 1024 * 1024;
/** Workspace cap across every session file; the oldest are pruned first. */
export const MAX_WORKSPACE_BYTES = 50 * 1024 * 1024;
/** Workspace retention window. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Characters one summary may spend before the record cap applies. */
export const MAX_SUMMARY_CHARS = 600;
/** The directories the journal owns inside a session workspace. */
export function workflowsDirectory(workspace) {
    return join(workspace, '.dsh', 'workflows');
}
export function eventsDirectory(workspace) {
    return join(workflowsDirectory(workspace), 'events');
}
/**
 * A file name that is safe on every platform. Session ids are UUIDs, so the
 * substitution only matters for an unexpected id.
 */
export function sessionFileName(session) {
    const safe = session.replace(/[^A-Za-z0-9._-]+/gu, '_').slice(0, 120);
    return safe === '' ? 'session' : safe;
}
/** Event files and their single rotation. */
function isJournalFile(name) {
    return /\.jsonl(?:\.1)?$/u.test(name);
}
async function listJournalFiles(directory) {
    try {
        const names = await readdir(directory);
        const files = await Promise.all(names.filter(isJournalFile).map(async (name) => {
            const info = await stat(join(directory, name));
            return { name, size: info.size, mtimeMs: info.mtimeMs };
        }));
        return files;
    }
    catch {
        return [];
    }
}
async function statJournalFile(file) {
    try {
        const info = await stat(file);
        return { size: info.size, mtimeMs: info.mtimeMs };
    }
    catch {
        return undefined;
    }
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
/** The text a tool result carries, without any structured payload. */
export function toolResultText(result) {
    if (result.isError)
        return result.error.message;
    const parts = [];
    for (const block of result.content) {
        if (block.type === 'text')
            parts.push(block.text);
    }
    return parts.join('\n');
}
/**
 * A short redacted summary and the original payload size. Redaction happens
 * before the cut, so truncating a private-key block can never leave its prefix;
 * over-long text is cut with a marker and the raw payload stays in the session
 * log.
 */
export function summarize(text, maxChars = MAX_SUMMARY_CHARS) {
    const redacted = redactPayload(text);
    const bytes = Buffer.byteLength(text, 'utf8');
    const oversized = bytes > MAX_RECORD_BYTES;
    if (redacted.length <= maxChars)
        return { summary: redacted, bytes, truncated: oversized };
    return { summary: `${redacted.slice(0, maxChars - 1)}…`, bytes, truncated: true };
}
/**
 * Shrink one record until its JSON line fits the per-record cap. The summary
 * and then the subject are cut; optional metadata is dropped last, so an
 * oversized field can never push the line over the limit.
 */
export function capRecord(record, maxBytes = MAX_RECORD_BYTES) {
    const fits = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= maxBytes;
    if (fits(record))
        return { record, truncated: false };
    let candidate = { ...record, truncated: true };
    for (const field of ['summary', 'subject']) {
        let value = candidate[field];
        while (value.length > 0) {
            const shorter = value.slice(0, Math.floor(value.length / 2));
            candidate = { ...candidate, [field]: `${shorter}…` };
            if (fits(candidate))
                return { record: candidate, truncated: true };
            value = shorter;
        }
        candidate = { ...candidate, [field]: '…' };
        if (fits(candidate))
            return { record: candidate, truncated: true };
    }
    const minimal = {
        v: candidate.v,
        at: candidate.at,
        session: candidate.session,
        ...(candidate.turn === undefined ? {} : { turn: candidate.turn }),
        kind: candidate.kind,
        subject: '…',
        summary: '',
        bytes: candidate.bytes,
        truncated: true,
    };
    if (!fits(minimal)) {
        throw new Error(`journal record metadata exceeds the ${String(maxBytes)}-byte cap`);
    }
    return { record: minimal, truncated: true };
}
/**
 * Append-only JSONL journal. Writes are serialized per session file so record
 * order and line integrity survive concurrent events; a failed write returns a
 * result and never throws into the event dispatch path.
 */
export class Journal {
    maxRecordBytes;
    maxSessionBytes;
    maxWorkspaceBytes;
    retentionMs;
    now;
    writeLine;
    readText;
    truncateFile;
    listFiles;
    statFile;
    renameFile;
    removeFile;
    queues = new Map();
    /** Session files whose last append left a torn line that must be repaired. */
    repairNeeded = new Set();
    /** Session files whose trailing boundary this instance has already validated. */
    verified = new Set();
    constructor(options = {}) {
        this.maxRecordBytes = options.maxRecordBytes ?? MAX_RECORD_BYTES;
        this.maxSessionBytes = options.maxSessionBytes ?? MAX_SESSION_BYTES;
        this.maxWorkspaceBytes = options.maxWorkspaceBytes ?? MAX_WORKSPACE_BYTES;
        this.retentionMs = options.retentionMs ?? RETENTION_MS;
        this.now = options.now ?? (() => Date.now());
        this.writeLine = options.writeLine ?? ((file, line) => appendFile(file, line, 'utf8'));
        this.readText = options.readText ?? ((file) => readFile(file, 'utf8'));
        this.truncateFile = options.truncateFile ?? ((file, size) => truncate(file, size));
        this.listFiles = options.listFiles ?? listJournalFiles;
        this.statFile = options.statFile ?? statJournalFile;
        this.renameFile = options.renameFile ?? ((from, to) => rename(from, to));
        this.removeFile = options.removeFile ?? ((file) => unlink(file));
    }
    /** Build the redacted, bounded record a producer's fields describe. */
    record(input) {
        const built = {
            v: JOURNAL_VERSION,
            at: input.at,
            session: input.session,
            ...(input.turn === undefined ? {} : { turn: input.turn }),
            kind: input.kind,
            subject: input.subject,
            ...(input.callId === undefined ? {} : { callId: input.callId }),
            ...(input.ok === undefined ? {} : { ok: input.ok }),
            summary: input.summary,
            bytes: input.bytes,
            // An oversized original payload is marked even when redaction replaced
            // its text with one marker and the stored line is short.
            truncated: input.truncated || input.bytes > this.maxRecordBytes,
            ...(input.triggers === undefined ? {} : { triggers: input.triggers }),
        };
        // Whole-record redaction also covers any structured field a later producer
        // adds; a secret-named key never reaches the file even inside JSON text.
        const redacted = redactValue(built);
        const capped = capRecord(redacted, this.maxRecordBytes);
        return { record: capped.record, truncated: capped.truncated || redacted.truncated };
    }
    /** Append one record; returns a result instead of throwing. */
    async append(workspace, record) {
        const directory = eventsDirectory(workspace);
        const file = join(directory, `${sessionFileName(record.session)}.jsonl`);
        const line = `${JSON.stringify(record)}\n`;
        // Writes and pruning are serialized per workspace, so a prune can never
        // overlap another append and two passes cannot both remove the same file.
        const previous = this.queues.get(directory) ?? Promise.resolve();
        // shortcut: one appendFile call is the atomic unit; a crash mid-write can
        // leave a torn final line, which the next append repairs.
        const write = previous.then(async () => {
            await mkdir(directory, { recursive: true });
            // Validate or repair this session file's trailing boundary before its
            // first append in this instance; a previous instance may have died, and
            // another session's append must never clear this file's repair state.
            if (this.repairNeeded.has(file) || !this.verified.has(file)) {
                await this.repairTail(file);
                this.repairNeeded.delete(file);
                this.verified.add(file);
            }
            try {
                await this.writeLine(file, line);
            }
            catch (error) {
                this.verified.delete(file);
                this.repairNeeded.add(file);
                throw error;
            }
            // Rotation only after the record is durable, so a failed append can
            // never remove a readable record.
            await this.rotateIfNeeded(file).catch(() => undefined);
            await this.prune(directory);
        });
        this.queues.set(directory, write.catch(() => undefined));
        try {
            await write;
            return { ok: true };
        }
        catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    }
    /** Drop only the torn suffix so every committed record stays readable. */
    async repairTail(file) {
        let raw = '';
        try {
            raw = await this.readText(file);
        }
        catch (error) {
            // Only an absent file is a valid empty state; any other read failure
            // must fail the append and keep the repair pending.
            if (error.code === 'ENOENT')
                return;
            throw error;
        }
        if (raw === '' || raw.endsWith('\n'))
            return;
        const boundary = raw.lastIndexOf('\n');
        const keep = boundary === -1 ? '' : raw.slice(0, boundary + 1);
        await this.truncateFile(file, Buffer.byteLength(keep, 'utf8'));
    }
    /** Rotate the current file to `.1` once it exceeds its per-session cap. */
    async rotateIfNeeded(file) {
        const current = await this.statFile(file);
        if (current === undefined || current.size <= this.maxSessionBytes)
            return;
        const rotated = `${file}.1`;
        await this.removeFile(rotated).catch(() => undefined);
        await this.renameFile(file, rotated);
    }
    /** Drop expired files, then the oldest files until the workspace cap holds. */
    async prune(directory) {
        try {
            for (;;) {
                const files = (await this.listFiles(directory)).filter((file) => isJournalFile(file.name));
                const cutoff = this.now() - this.retentionMs;
                let removed = false;
                for (const file of files) {
                    if (file.mtimeMs >= cutoff)
                        continue;
                    try {
                        await this.removeFile(join(directory, file.name));
                        removed = true;
                    }
                    catch {
                        // A file that another pass already removed is fine.
                    }
                }
                let total = files
                    .filter((file) => file.mtimeMs >= cutoff)
                    .reduce((sum, file) => sum + file.size, 0);
                for (const file of [...files].sort((left, right) => left.mtimeMs - right.mtimeMs)) {
                    if (total <= this.maxWorkspaceBytes)
                        break;
                    try {
                        await this.removeFile(join(directory, file.name));
                        total -= file.size;
                        removed = true;
                    }
                    catch {
                        // Continue with the next-oldest file.
                    }
                }
                if (!removed)
                    return;
            }
        }
        catch {
            // Pruning never fails the append that triggered it.
        }
    }
    /** One page of a session's records; the rotation and current file are one log. */
    async read(workspace, session, cursor = 0, limit = 50) {
        const file = join(eventsDirectory(workspace), `${sessionFileName(session)}.jsonl`);
        const records = [];
        for (const candidate of [`${file}.1`, file]) {
            let raw = '';
            try {
                raw = await this.readText(candidate);
            }
            catch {
                continue;
            }
            for (const line of raw.split('\n')) {
                if (line.trim() === '')
                    continue;
                try {
                    const value = JSON.parse(line);
                    if (value.v !== JOURNAL_VERSION || typeof value.at !== 'number')
                        continue;
                    records.push(value);
                }
                catch {
                    // A torn or foreign line is not a record; the next line still is.
                }
            }
        }
        const start = Math.min(Math.max(0, cursor), records.length);
        const page = records.slice(start, start + limit);
        const next = start + page.length < records.length ? String(start + page.length) : undefined;
        return { records: page, ...(next === undefined ? {} : { next }) };
    }
    /** The clock this journal stamps when a producer does not. */
    time() {
        return this.now();
    }
}
