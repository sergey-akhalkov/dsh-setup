import { type FindingClass } from '../shared/approval.js';
/**
 * Local lesson store: one JSONL record per lesson revision under
 * `.dsh/review-learning/<workspaceKey>.jsonl`. The store is untracked scratch,
 * bounded, and deduped by normalized class + title. It is never an instruction:
 * only a direct user answer moves a lesson past `proposed`.
 */
export declare const DEFAULT_MAX_LESSONS = 200;
export declare const MAX_STORE_BYTES = 1000000;
export type LessonStatus = 'proposed' | 'accepted' | 'rejected' | 'applied';
export interface LessonScope {
    /** Rule ids, or `*`; an empty list matches any rule. */
    rules: string[];
    /** Change delta capability names; an empty list matches any change. */
    capabilities: string[];
}
export interface LessonSource {
    change?: string;
    taskId?: string;
    findingHashes?: string[];
}
export interface Lesson {
    v: 1;
    /** Revision identity; a duplicate proposal never mutates an accepted record. */
    id: string;
    class: FindingClass;
    title: string;
    body: string;
    appliesTo: LessonScope;
    status: LessonStatus;
    source: LessonSource;
    createdAt: number;
    decidedAt?: number;
    appliedIn?: string;
    /** The accepted lesson a proposed revision would replace. */
    supersedes?: string;
}
/** A validation problem or the bounded-store refusal; `code` is stable for callers. */
export declare class LessonStoreError extends Error {
    readonly code: 'validation' | 'capacity' | 'not-found' | 'transition';
    constructor(message: string, code: 'validation' | 'capacity' | 'not-found' | 'transition');
}
/** Lowercase, whitespace-collapsed, punctuation-trimmed class + title. */
export declare function lessonDedupeKey(lesson: Pick<Lesson, 'class' | 'title'>): string;
/** Absolute path of the workspace's lesson store. */
export declare function lessonStorePath(workspaceRoot: string): string;
export interface LessonStoreRead {
    lessons: Lesson[];
    /** Malformed non-empty lines, counted; never fatal. */
    skipped: number;
}
/** Read every lesson revision; a missing file is empty. */
export declare function readLessons(workspaceRoot: string): Promise<LessonStoreRead>;
export interface ProposeLessonInput {
    class: unknown;
    title: unknown;
    body: unknown;
    appliesTo?: unknown;
    source?: unknown;
    /** Current time from the caller's clock seam. */
    now: number;
    maxLessons?: number;
}
export interface ProposeLessonResult {
    lesson: Lesson;
    /** `created`, `updated`, or `revision`. */
    kind: 'created' | 'updated' | 'revision';
    replaced?: Lesson;
}
/**
 * Store a proposed lesson. The same normalized class + title updates a proposed
 * record; a duplicate of an accepted or applied lesson creates a new proposed
 * revision with a `supersedes` link and never changes the accepted content.
 */
export declare function proposeLesson(workspaceRoot: string, input: ProposeLessonInput): Promise<ProposeLessonResult>;
/** Apply a direct user decision; the caller supplies the answer, never the model. */
export declare function decideLesson(workspaceRoot: string, id: string, decision: 'accepted' | 'rejected', now: number): Promise<Lesson>;
/** Mark an accepted lesson applied against a named target. */
export declare function applyLesson(workspaceRoot: string, id: string, target: string, now: number): Promise<Lesson>;
/** Accepted and applied lessons only; proposed and rejected are never injected. */
export declare function injectableLessons(lessons: readonly Lesson[]): Lesson[];
/** Delta capability directory names a change declares under `specs/`. */
export declare function changeCapabilities(changeDir: string): Promise<string[]>;
/** Lessons whose rule and capability scope matches this review; proposed/rejected never match. */
export declare function matchingLessons(lessons: readonly Lesson[], rule: string, capabilities: readonly string[]): Lesson[];
