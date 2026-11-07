import type { FindingClass } from '../shared/approval.js';
import { type HistoryEntry, type HistoryFinding } from './finding-history.js';
export declare const REVIEW_RETRO_DESCRIPTION = "Report repeated review findings by class from the local bounded finding history, and optionally propose at most one lesson draft. Deterministic: calls no model and edits no source file. A proposed lesson is never injected until a user accepts it.";
export declare const MAX_REPORT_CHARS = 4000;
export interface RetroExample {
    class: FindingClass;
    title: string;
    evidence: string;
    rule: string;
    change: string;
    taskId?: string;
    time: string;
}
export interface RetroClassCount {
    class: FindingClass;
    count: number;
    repeats: number;
    /** Repeats divided by count, in whole percent. */
    rate: number;
}
export interface RetroDraft {
    class: FindingClass;
    title: string;
    body: string;
    appliesTo: {
        rules: string[];
        capabilities: string[];
    };
    source: {
        change?: string;
        taskId?: string;
        findingHashes: string[];
    };
}
export interface RetroReport {
    window: number;
    entries: number;
    findings: number;
    gaps: number;
    skipped: number;
    classes: RetroClassCount[];
    topClass?: FindingClass;
    examples: RetroExample[];
    draft?: RetroDraft;
    text: string;
}
/** Normalized title identity used to count a repeat across records. */
export declare function findingTitleHash(finding: Pick<HistoryFinding, 'class' | 'title'>): string;
/** Deterministic clustering over the already-read history entries. */
export declare function buildRetroReport(entries: readonly HistoryEntry[], options?: {
    window?: number;
    skipped?: number;
    maxChars?: number;
}): RetroReport;
/** Read the windowed history and build the deterministic report. */
export declare function reviewRetro(workspaceRoot: string, options?: {
    window?: number;
}): Promise<RetroReport>;
export interface RetroToolContext {
    workspaceRoot: string;
    now: () => Date;
    window?: number;
    maxChars?: number;
    maxLessons?: number;
}
/** Run one `review_retro` action; `report` writes nothing, `propose` stores one draft. */
export declare function executeReviewRetro(value: unknown, context: RetroToolContext): Promise<string>;
