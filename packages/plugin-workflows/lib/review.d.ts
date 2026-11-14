import type { Definition, Step } from './definitions.js';
import { type EvidenceContext } from './evidence.js';
import type { SubagentRunner } from './executors.js';
import { type WorkflowRun } from './runs.js';
/**
 * The native review executor. It resolves a reviewer from the row's
 * `reviewers` map, renders a bundled instruction with the change, task and
 * digest context, accepts exactly one fenced JSON verdict that echoes the
 * prepared digest, writes the local record (and, for a task PASS, the committed
 * approval first), and settles the step from its own evidence. Every failure
 * writes an ERROR record and publishes no PASS.
 */
export declare const TASK_ID_PATTERN: RegExp;
/** The fixed finding vocabulary every review producer shares. */
export declare const FINDING_CLASSES: readonly ["spec-ambiguity", "missing-test", "path-boundary", "state-persistence", "stale-input", "api-contract", "plan-shape", "docs-drift", "security", "other"];
export type FindingClass = (typeof FINDING_CLASSES)[number];
export declare function normalizeFindingClass(value: unknown): FindingClass;
export interface ReviewFinding {
    readonly severity: 'P0' | 'P1';
    readonly class: FindingClass;
    readonly title: string;
    readonly evidence: string;
    readonly fix: string;
}
export type ReviewVerdict = 'PASS' | 'FINDINGS' | 'ERROR';
/** Where a reviewer comes from: a profile target id, never a provider. */
export interface ReviewerTargetConfig {
    readonly provider: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly agentOptions?: Readonly<Record<string, unknown>>;
}
export type ReviewerMap = Readonly<Record<string, ReviewerTargetConfig>>;
export interface ResolvedReviewer {
    readonly id: string;
    readonly provider: string;
    readonly model?: string;
    readonly reasoningEffort?: string;
    readonly agentOptions?: Readonly<Record<string, unknown>>;
}
/**
 * Validate the row's `reviewers` map. A provider that is registered without
 * `agentOptions` support rejects a model or effort at load; an unregistered
 * provider is not a load error and fails the run with the target name.
 */
export declare function resolveReviewers(raw: unknown, providerSupportsOptions?: (provider: string) => boolean | undefined): ReviewerMap;
/** Resolve one reviewer for a run; a missing id names the config and remedy. */
export declare function resolveReviewer(reviewers: ReviewerMap, target: string): {
    readonly ok: true;
    readonly reviewer: ResolvedReviewer;
} | {
    readonly ok: false;
    readonly error: string;
};
/** The review queue's validated profile settings. */
export interface ReviewQueueConfig {
    readonly enabled: boolean;
    readonly concurrency: number;
    readonly maxQueued: number;
    readonly maxAttempts: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly waitTimeoutMs: number;
}
export declare const DEFAULT_REVIEW_QUEUE: ReviewQueueConfig;
export declare function resolveReviewQueue(raw: unknown): ReviewQueueConfig;
export declare const DEFAULT_REVIEW_TIMEOUT_MS = 600000;
/** Resolve `timeouts.review`; a timeout outside the bounded range fails load. */
export declare function resolveReviewTimeout(raw: unknown): number;
/** The review step's record phase; a task-scoped record is always phase "task". */
export declare function reviewPhase(scope: 'whole' | 'task', phase: string | undefined): string;
/** The workspace-relative local record path for one review. */
export declare function localReviewRecordPath(input: {
    readonly rule: string;
    readonly change: string;
    readonly scope: 'whole' | 'task';
    readonly phase?: string;
    readonly taskId?: string;
}): string;
/** The committed portable approval path; the format is unchanged. */
export declare function portableApprovalPath(change: string, taskId: string): string;
/** One review record; the local file is a provenance superset of the approval. */
export interface ReviewRecord {
    readonly definition: string;
    readonly rule: string;
    readonly change: string;
    readonly phase: string;
    readonly scope: 'whole' | 'task';
    readonly taskId?: string;
    readonly digest: string;
    readonly worktreeDigest?: string;
    readonly verdict: ReviewVerdict;
    readonly findings: readonly ReviewFinding[];
    readonly target: Readonly<{
        provider: string;
        model?: string;
        reasoningEffort?: string;
    }>;
    readonly reviewer: string;
    readonly session?: string;
    readonly runId?: string;
    readonly failureClass?: string;
    readonly error?: string;
    readonly time: string;
}
/** Redact machine paths and credentials, then bound the result. */
export declare function sanitizeReviewText(text: string, maximum?: number): string;
export type ParsedVerdict = {
    readonly ok: true;
    readonly verdict: 'PASS' | 'FINDINGS';
    readonly findings: ReviewFinding[];
} | {
    readonly ok: false;
    readonly error: string;
};
/** Accept exactly one fenced JSON verdict that echoes the requested digest. */
export declare function parseReviewVerdict(text: string, expectedDigest: string): ParsedVerdict;
/** The shipped bundled review instructions live beside the definitions. */
export declare function reviewAssetsDirectory(): string;
export declare function readReviewInstruction(id: string): string;
export interface ReviewPromptInput {
    readonly instruction: string;
    readonly rule: string;
    readonly change: string;
    readonly scope: 'whole' | 'task';
    readonly phase?: string;
    readonly task?: {
        readonly id: string;
        readonly number?: string;
        readonly text: string;
    };
    readonly digest: string;
    readonly snapshot: boolean;
    readonly extra?: string;
}
/** Render the bundled instruction with the review's digest-bound context. */
export declare function renderReviewPrompt(input: ReviewPromptInput): string;
/** The task-scope digest binds the frozen tree; whole scope binds the artifacts. */
export declare function reviewDigest(input: {
    readonly scope: 'whole' | 'task';
    readonly specDigest: string;
    readonly tree?: string;
}): string;
/** Write one file atomically: temp beside the target, then rename. */
export declare function writeReviewFileAtomic(file: string, bytes: string): Promise<void>;
/** The committed approval subset; the field set and order are the stable format. */
export declare function portableApprovalOf(record: ReviewRecord): Readonly<Record<string, unknown>>;
export type ReviewWrite = {
    readonly ok: true;
    readonly path: string;
} | {
    readonly ok: false;
    readonly error: string;
};
/** Write the local review record; the path is derived from the record. */
export declare function writeLocalReviewRecord(workspace: string, record: ReviewRecord): Promise<ReviewWrite>;
/** Write the committed approval before the local record; a task PASS only. */
export declare function writePortableApproval(workspace: string, record: ReviewRecord): Promise<ReviewWrite>;
export interface ReviewRunInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly reviewer: ResolvedReviewer;
    readonly runner: SubagentRunner;
    readonly context: EvidenceContext;
    readonly change: string;
    readonly task?: {
        readonly id: string;
        readonly number?: string;
        readonly text: string;
    };
    readonly prepared: {
        readonly specDigest: string;
        /** A content tree digest for a frozen task snapshot. */
        readonly tree?: string;
        /** The frozen checkout to run in; absent means the live worktree. */
        readonly reviewCwd?: string;
        /** Re-check the change digest after the run and discard a changed verdict. */
        readonly liveGuard?: () => Promise<boolean>;
    };
    readonly timeoutMs: number;
    readonly session: string;
    readonly now?: number;
    readonly signal?: AbortSignal;
    /** Test seams; production writes the real stores. */
    readonly writePortable?: typeof writePortableApproval;
    readonly writeLocal?: typeof writeLocalReviewRecord;
    /** Test seam: the prompt renderer; production reads the bundled instruction. */
    readonly renderPrompt?: (prompt: ReviewPromptInput) => string;
}
export interface ReviewRunResult {
    readonly run: WorkflowRun;
    readonly record?: ReviewRecord;
    readonly recordPath?: string;
    readonly error?: string;
}
/**
 * Run one review step. It awaits the reviewer (the queue and asynchronous
 * admission wrap this function), writes the record, and settles the step from
 * the evidence verifier. A failed start, a timeout, a malformed verdict, or a
 * changed whole-scope input writes an ERROR record and publishes no PASS.
 */
export declare function runReviewStep(input: ReviewRunInput): Promise<ReviewRunResult>;
