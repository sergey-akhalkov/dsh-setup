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
/** Per-session cap before the current file rotates to `.1`. */
export declare const MAX_SESSION_BYTES: number;
/** Workspace cap across every session file; the oldest are pruned first. */
export declare const MAX_WORKSPACE_BYTES: number;
/** Workspace retention window. */
export declare const RETENTION_MS: number;
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
/** One session file on disk, as retention sees it. */
export interface JournalFileInfo {
    readonly name: string;
    readonly size: number;
    readonly mtimeMs: number;
}
export interface JournalOptions {
    readonly maxRecordBytes?: number;
    readonly maxSessionBytes?: number;
    readonly maxWorkspaceBytes?: number;
    readonly retentionMs?: number;
    readonly now?: () => number;
    /** Test seam: write one complete line. */
    readonly writeLine?: (file: string, line: string) => Promise<void>;
    readonly readText?: (file: string) => Promise<string>;
    /** Test seam: list the event directory. */
    readonly listFiles?: (directory: string) => Promise<JournalFileInfo[]>;
    /** Test seam: one file's size and age, or undefined when absent. */
    readonly statFile?: (file: string) => Promise<{
        size: number;
        mtimeMs: number;
    } | undefined>;
    readonly renameFile?: (from: string, to: string) => Promise<void>;
    readonly removeFile?: (file: string) => Promise<void>;
}
/** The text a tool result carries, without any structured payload. */
export declare function toolResultText(result: ToolExecutionResult): string;
/**
 * A short redacted summary and the original payload size. Redaction happens
 * before the cut, so truncating a private-key block can never leave its prefix;
 * over-long text is cut with a marker and the raw payload stays in the session
 * log.
 */
export declare function summarize(text: string, maxChars?: number): {
    summary: string;
    bytes: number;
    truncated: boolean;
};
/**
 * Shrink one record until its JSON line fits the per-record cap. The summary
 * and then the subject are cut; optional metadata is dropped last, so an
 * oversized field can never push the line over the limit.
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
    private readonly maxSessionBytes;
    private readonly maxWorkspaceBytes;
    private readonly retentionMs;
    private readonly now;
    private readonly writeLine;
    private readonly readText;
    private readonly listFiles;
    private readonly statFile;
    private readonly renameFile;
    private readonly removeFile;
    private readonly queues;
    constructor(options?: JournalOptions);
    /** Build the redacted, bounded record a producer's fields describe. */
    record(input: JournalInput): {
        record: JournalRecord;
        truncated: boolean;
    };
    /** Append one record; returns a result instead of throwing. */
    append(workspace: string, record: JournalRecord): Promise<AppendResult>;
    /** Rotate the current session file to `.1` when the next line would exceed its cap. */
    private rotateIfNeeded;
    /** Drop expired files, then the oldest files until the workspace cap holds. */
    private prune;
    /** One page of a session's records; the rotation and current file are one log. */
    read(workspace: string, session: string, cursor?: number, limit?: number): Promise<JournalPage>;
    /** The clock this journal stamps when a producer does not. */
    time(): number;
}
