import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools';
/**
 * Bounded per-session event journal: one JSONL line per observed process
 * event, an index of the session log rather than a copy of it. Everything here
 * is local scratch under `.dsh/workflows`; nothing is tracked.
 */
/** Record schema version; a reader ignores a line it does not understand. */
export declare const JOURNAL_VERSION = 1;
/** Per-record cap: one record over this is summarized and marked truncated. */
export declare const MAX_RECORD_BYTES = 4096;
/** Characters one summary may spend before the record cap applies. */
export declare const MAX_SUMMARY_CHARS = 600;
/** The directories the journal owns inside a session workspace. */
export declare function workflowsDirectory(workspace: string): string;
export declare function eventsDirectory(workspace: string): string;
/**
 * A file name that is safe on every platform. Session ids are UUIDs, so the
 * substitution only matters for an unexpected id.
 */
export declare function sessionFileName(session: string): string;
/** One journal record, as the read API and the Why-not view consume it. */
export interface JournalRecord {
    readonly v: number;
    readonly at: number;
    readonly session: string;
    readonly turn?: number;
    readonly kind: string;
    readonly subject: string;
    readonly callId?: string;
    readonly ok?: boolean;
    readonly summary: string;
    readonly bytes: number;
    readonly truncated: boolean;
}
/** The fields a producer supplies; the journal stamps the rest. */
export interface JournalInput {
    readonly at: number;
    readonly session: string;
    readonly turn?: number;
    readonly kind: string;
    readonly subject: string;
    readonly callId?: string;
    readonly ok?: boolean;
    readonly summary: string;
    readonly bytes: number;
    readonly truncated: boolean;
}
export type AppendResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly error: string;
};
/** One page of session records. `next` is absent on the last page. */
export interface JournalPage {
    readonly records: readonly JournalRecord[];
    readonly next?: string;
}
export interface JournalOptions {
    readonly maxRecordBytes?: number;
    readonly now?: () => number;
    /** Test seam: write one complete line. */
    readonly writeLine?: (file: string, line: string) => Promise<void>;
    readonly readText?: (file: string) => Promise<string>;
}
/** The text a tool result carries, without any structured payload. */
export declare function toolResultText(result: ToolExecutionResult): string;
/**
 * A short summary and the original payload size. Over-long text is cut with a
 * marker; the raw payload stays in the session log.
 */
export declare function summarize(text: string, maxChars?: number): {
    summary: string;
    bytes: number;
    truncated: boolean;
};
/**
 * Shrink one record until its JSON line fits the per-record cap. The summary
 * is the only unbounded field, so it is cut first and a marker is kept.
 */
export declare function capRecord(record: JournalRecord, maxBytes?: number): {
    record: JournalRecord;
    truncated: boolean;
};
/**
 * Append-only JSONL journal. Writes are serialized per session file so record
 * order and line integrity survive concurrent events; a failed write returns a
 * result and never throws into the event dispatch path.
 */
export declare class Journal {
    private readonly maxRecordBytes;
    private readonly now;
    private readonly writeLine;
    private readonly readText;
    private readonly queues;
    constructor(options?: JournalOptions);
    /** Build the bounded record a producer's fields describe. */
    record(input: JournalInput): {
        record: JournalRecord;
        truncated: boolean;
    };
    /** Append one record; returns a result instead of throwing. */
    append(workspace: string, record: JournalRecord): Promise<AppendResult>;
    /** One page of a session's records; an invalid stored line is skipped. */
    read(workspace: string, session: string, cursor?: number, limit?: number): Promise<JournalPage>;
    /** The clock this journal stamps when a producer does not. */
    time(): number;
}
