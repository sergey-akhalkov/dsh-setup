import { type FindingClass } from '../shared/approval.js';
/**
 * Bounded local finding history: the review engine overwrites its record on a
 * later PASS, so this separate JSONL keeps the findings that P0/P1 repetitions
 * are measured from. Local scratch only; never tracked.
 */
export declare const REVIEW_LEARNING_DIR = ".dsh/review-learning";
/** Default and hard ceiling for the retro/history window. */
export declare const DEFAULT_HISTORY_WINDOW = 50;
export declare const MAX_HISTORY_WINDOW = 200;
export interface HistoryFinding {
    class: FindingClass;
    title: string;
    evidence: string;
    fix: string;
}
export interface HistoryRunEntry {
    v: 1;
    kind: 'run';
    rule: string;
    change: string;
    taskId?: string;
    verdict: 'PASS' | 'FINDINGS';
    digest: string;
    findings: HistoryFinding[];
    time: string;
}
export interface HistoryGapEntry {
    v: 1;
    kind: 'gap';
    time: string;
    reason: string;
}
export type HistoryEntry = HistoryRunEntry | HistoryGapEntry;
/** Stable per-workspace key: the hash of the resolved root, never the root. */
export declare function workspaceKeyOf(workspaceRoot: string): string;
export declare function findingHistoryPath(workspaceRoot: string): string;
/** The configured window, clamped to the documented default and ceiling. */
export declare function historyWindowOf(value: number | undefined): number;
/** One JSONL line's valid entry, or undefined when the line is malformed. */
export declare function parseHistoryLine(line: string): HistoryEntry | undefined;
export interface HistoryRead {
    entries: HistoryEntry[];
    skipped: number;
    gaps: number;
}
/** Read the last `window` entries; a malformed line is counted, never fatal. */
export declare function readFindingHistory(workspaceRoot: string, options?: {
    window?: number;
}): Promise<HistoryRead>;
export interface HistoryAppendResult {
    appended: boolean;
    gapAppended: boolean;
    /** Bounded reason when the run entry or its gap marker could not be written. */
    detail?: string;
}
/** Redact machine paths and credentials before a failure reason is stored. */
export declare function sanitizeHistoryReason(error: unknown): string;
/**
 * Append one settled review's findings, pruning to the window first. A failure
 * never throws: one bounded `gap` marker is attempted, and when the file cannot
 * be written at all the caller reports the returned detail.
 */
export declare function appendFindingHistory(workspaceRoot: string, entry: HistoryRunEntry, options?: {
    window?: number;
}): Promise<HistoryAppendResult>;
