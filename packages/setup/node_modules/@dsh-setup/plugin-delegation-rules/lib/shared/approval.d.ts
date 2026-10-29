/**
 * Pure approval core shared by the Host engine and the repository audit script.
 * No DSH imports and no filesystem access: the Host and `scripts/reviews-check.ts`
 * must compute the same task ids, records, coverage, and archive recognition.
 */
/** Stable 16-hex task id: sha256 of the whitespace-normalized numbered task text. */
export declare const TASK_ID_PATTERN: RegExp;
/** Change directory names are plain kebab-ish names. */
export declare const CHANGE_PATTERN: RegExp;
/** A review digest; the same shape for the task digest and the worktree digest. */
export declare const DIGEST_PATTERN: RegExp;
/** Kebab-case rule ids, matching the engine's rule validation. */
export declare const RULE_ID_PATTERN: RegExp;
/** Reserved directory inside a change that holds portable approval records. */
export declare const REVIEWS_DIRECTORY = "reviews";
/** Repository opt-in marker, relative to the OpenSpec root. */
export declare const APPROVAL_MARKER_FILE = "review-approval.json";
/** One numbered checkbox task parsed from `tasks.md`. */
export interface NumberedTask {
    id: string;
    at: number;
    number: string;
    text: string;
    checked: boolean;
}
export declare function normalizeTaskText(text: string): string;
export declare function taskIdOf(text: string): string;
export declare function parseTasksText(markdown: string): NumberedTask[];
/** Checkbox state only: a task tick alone never changes this normalized text. */
export declare function normalizeCheckboxes(markdown: string): string;
/** One checked markdown line that is not a numbered task; approval fails closed on it. */
export interface UnparseableCheckedLine {
    line: number;
    text: string;
}
export declare function unparseableCheckedLines(markdown: string): UnparseableCheckedLine[];
/** One review finding; the engine and the portable record share this shape. */
export interface ReviewFinding {
    severity: 'P0' | 'P1';
    title: string;
    evidence: string;
    fix: string;
}
export type ReviewVerdict = 'PASS' | 'FINDINGS' | 'ERROR';
/** The target selection kept in a record; never a machine path. */
export interface ReviewTarget {
    provider: string;
    model?: string;
    reasoningEffort?: string;
}
/** The sanitized, committed approval record for one checked task. */
export interface PortableTaskReviewRecord {
    rule: string;
    change: string;
    scope: 'task';
    taskId: string;
    digest: string;
    worktreeDigest?: string;
    verdict: ReviewVerdict;
    findings: ReviewFinding[];
    target: ReviewTarget;
    time: string;
}
export declare function isReviewFinding(value: unknown): value is ReviewFinding;
/**
 * Validate the committed record: only the sanitized fields may appear, so a
 * record carrying a session id, run id, or machine path can never approve.
 */
export declare function parsePortableTaskReviewRecord(value: unknown): {
    record?: PortableTaskReviewRecord;
    error?: string;
};
/** Absolute path of one portable record inside a change. */
export declare function portableTaskRecordPath(changeDir: string, taskId: string): string;
/** Repository-relative display path of one portable record, for messages. */
export declare function portableTaskRecordDisplayPath(changeDirectory: string, taskId: string): string;
/** Absolute path of one local `.dsh` task-review record the export may copy. */
export declare function localTaskRecordPath(workspaceRoot: string, rule: string, change: string, taskId: string): string;
/** What the coverage reader found at one record path. */
export type ApprovalRecordState = {
    kind: 'missing';
} | {
    kind: 'malformed';
    error: string;
} | {
    kind: 'record';
    record: PortableTaskReviewRecord;
};
export interface ApprovalTaskReport {
    number: string;
    text: string;
    id: string;
    recordPath: string;
    state: 'pass' | 'error' | 'missing';
    detail?: string;
}
export interface ApprovalCoverage {
    change: string;
    rule: string;
    checked: number;
    pass: number;
    error: number;
    missing: number;
    unchecked: Array<{
        number: string;
        text: string;
    }>;
    unparseable: UnparseableCheckedLine[];
    tasks: ApprovalTaskReport[];
    archiveReady: boolean;
}
export interface ApprovalCoverageInput {
    change: string;
    /** The strict task-review rule whose PASS is the approval. */
    rule: string;
    tasks: readonly NumberedTask[];
    unparseable?: readonly UnparseableCheckedLine[];
    /** Repository-relative display path of the expected record for one task. */
    recordPath(taskId: string): string;
    inspect(taskId: string): ApprovalRecordState | Promise<ApprovalRecordState>;
}
/**
 * PASS-only coverage over every checked task, independent of session
 * attribution. Unchecked tasks are reported; they never block approval.
 */
export declare function computeApprovalCoverage(input: ApprovalCoverageInput): Promise<ApprovalCoverage>;
/** The shared audit/deny wording: one line per gap plus the next review call. */
export declare function formatApprovalGapLines(coverage: ApprovalCoverage): string[];
/** `task-review PASS x/y, ERROR z, missing n; archive-ready: yes|no` */
export declare function approvalSummaryLine(coverage: ApprovalCoverage): string;
/** The repository opt-in marker read from `<OpenSpec root>/review-approval.json`. */
export interface ReviewApprovalMarker {
    version: 1;
    archiveGate: boolean;
    taskRule: string;
    cutoff?: string;
    grandfathered?: Record<string, string>;
}
export declare function parseReviewApprovalMarker(value: unknown): {
    marker?: ReviewApprovalMarker;
    error?: string;
};
/** Quote-aware shell tokens; quoted text stays one argument and never becomes an operator. */
export interface ShellToken {
    readonly value: string;
    readonly quoted: boolean;
}
export interface ShellSegment {
    readonly tokens: readonly ShellToken[];
}
export declare function shellSegments(command: string): ShellSegment[];
/** One recognized archive operation, before the listener resolves its evidence. */
export interface ArchiveIntent {
    kind: 'openspec-archive' | 'move';
    change: string;
}
/**
 * Recognize the documented archive operations in one shell command. This is a
 * guard, not a sandbox: an intentionally obfuscated move is out of scope and
 * the push audit is the backstop.
 */
export declare function recognizeArchiveCommands(command: string, cwd: string): ArchiveIntent[];
/** Identity a local `.dsh` task-review record must carry to be exported. */
export interface ExportRecordInput {
    value: unknown;
    rule: string;
    change: string;
    taskId: string;
}
/**
 * Turn one local `.dsh` PASS record into the sanitized portable record. Only a
 * PASS that names this rule, change, and task id is copied; the export cannot
 * invent an approval.
 */
export declare function portableRecordFromLocal(input: ExportRecordInput): {
    record?: PortableTaskReviewRecord;
    error?: string;
};
