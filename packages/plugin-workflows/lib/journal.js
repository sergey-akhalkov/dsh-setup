import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
/**
 * Bounded per-session event journal: one JSONL line per observed process
 * event, an index of the session log rather than a copy of it. Everything here
 * is local scratch under `.dsh/workflows`; nothing is tracked.
 */
/** Record schema version; a reader ignores a line it does not understand. */
export const JOURNAL_VERSION = 1;
/** Per-record cap: one record over this is summarized and marked truncated. */
export const MAX_RECORD_BYTES = 4096;
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
 * A short summary and the original payload size. Over-long text is cut with a
 * marker; the raw payload stays in the session log.
 */
export function summarize(text, maxChars = MAX_SUMMARY_CHARS) {
    const bytes = Buffer.byteLength(text, 'utf8');
    if (text.length <= maxChars)
        return { summary: text, bytes, truncated: false };
    return { summary: `${text.slice(0, maxChars - 1)}…`, bytes, truncated: true };
}
/**
 * Shrink one record until its JSON line fits the per-record cap. The summary
 * is the only unbounded field, so it is cut first and a marker is kept.
 */
export function capRecord(record, maxBytes = MAX_RECORD_BYTES) {
    const encode = (value) => JSON.stringify(value);
    if (Buffer.byteLength(encode(record), 'utf8') <= maxBytes)
        return { record, truncated: false };
    let summary = record.summary;
    while (summary.length > 0) {
        const next = summary.slice(0, Math.max(0, Math.floor(summary.length / 2)));
        const candidate = { ...record, summary: `${next}…`, truncated: true };
        if (Buffer.byteLength(encode(candidate), 'utf8') <= maxBytes) {
            return { record: candidate, truncated: true };
        }
        summary = next;
    }
    const candidate = { ...record, summary: '', truncated: true };
    return { record: candidate, truncated: true };
}
/**
 * Append-only JSONL journal. Writes are serialized per session file so record
 * order and line integrity survive concurrent events; a failed write returns a
 * result and never throws into the event dispatch path.
 */
export class Journal {
    maxRecordBytes;
    now;
    writeLine;
    readText;
    queues = new Map();
    constructor(options = {}) {
        this.maxRecordBytes = options.maxRecordBytes ?? MAX_RECORD_BYTES;
        this.now = options.now ?? (() => Date.now());
        this.writeLine = options.writeLine ?? ((file, line) => appendFile(file, line, 'utf8'));
        this.readText = options.readText ?? ((file) => readFile(file, 'utf8'));
    }
    /** Build the bounded record a producer's fields describe. */
    record(input) {
        const record = {
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
            truncated: input.truncated,
        };
        return capRecord(record, this.maxRecordBytes);
    }
    /** Append one record; returns a result instead of throwing. */
    async append(workspace, record) {
        const directory = eventsDirectory(workspace);
        const file = join(directory, `${sessionFileName(record.session)}.jsonl`);
        const line = `${JSON.stringify(record)}\n`;
        const previous = this.queues.get(file) ?? Promise.resolve();
        const write = previous.then(async () => {
            await mkdir(directory, { recursive: true });
            await this.writeLine(file, line);
        });
        this.queues.set(file, write.catch(() => undefined));
        try {
            await write;
            return { ok: true };
        }
        catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    }
    /** One page of a session's records; an invalid stored line is skipped. */
    async read(workspace, session, cursor = 0, limit = 50) {
        const file = join(eventsDirectory(workspace), `${sessionFileName(session)}.jsonl`);
        let raw = '';
        try {
            raw = await this.readText(file);
        }
        catch {
            return { records: [] };
        }
        const records = [];
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
