import { type Definition, type Evidence, type RecordEvidence, type Step } from './definitions.js';
import { type EvidenceContext } from './evidence.js';
import type { SubagentRunner } from './executors.js';
import { type GitRunner } from './git.js';
import { type FailureClass } from './review-queue.js';
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
/**
 * Typed review failures: the queue's classifier reads the name and provider
 * message, so a permanent cause is never retried as a transient one.
 */
export declare class ConfigError extends Error {
    constructor(message: string);
}
export declare class ProviderStartError extends Error {
    readonly providerMessage?: string | undefined;
    readonly retryAfterMs?: number | undefined;
    constructor(message: string, providerMessage?: string | undefined, retryAfterMs?: number | undefined);
}
export declare class ProviderResultError extends Error {
    readonly providerMessage?: string | undefined;
    readonly retryAfterMs?: number | undefined;
    constructor(message: string, providerMessage?: string | undefined, retryAfterMs?: number | undefined);
}
export declare class InputMutationError extends Error {
    constructor(message: string);
}
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
/** A focused re-review confirms every prior finding by its stable per-record id. */
export interface ReviewConfirmation {
    readonly id: string;
    readonly status: 'closed' | 'open';
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
    readonly definition: string;
    readonly change: string;
    readonly scope: 'whole' | 'task';
    readonly phase?: string;
    readonly taskId?: string;
}): string;
/** The committed portable approval path; the format is unchanged. */
export declare function portableApprovalPath(change: string, taskId: string): string;
/** One section-scope task review: the resolved section and its checked coverage. */
export interface SectionReview {
    readonly key: string;
    readonly title: string;
    /** The stable 16-hex id the step's record evidence names in place of a task id. */
    readonly recordId: string;
    readonly covered: ReadonlyArray<{
        readonly id: string;
        readonly number: string;
        readonly text: string;
    }>;
    readonly unchecked: ReadonlyArray<{
        readonly id: string;
        readonly number: string;
        readonly text: string;
    }>;
}
/** The section digest: key, title, sorted covered ids/numbers/texts, the frozen
 * change artifacts, and the snapshot tree. Any coverage change invalidates it. */
export declare function sectionReviewDigest(section: SectionReview, artifactDigest: string, tree?: string): string;
/** One review record; the local file is a provenance superset of the approval. */
export interface ReviewRecord {
    readonly definition: string;
    readonly rule: string;
    readonly change: string;
    readonly phase: string;
    readonly scope: 'whole' | 'task';
    readonly taskId?: string;
    /** A section-scope task review: the section key, title, and covered task ids. */
    readonly section?: string;
    readonly sectionTitle?: string;
    readonly taskIds?: readonly string[];
    readonly digest: string;
    readonly worktreeDigest?: string;
    /** The snapshot tree the verdict was rendered from; a focused re-review diffs from it. */
    readonly reviewedTree?: string;
    /** The focused re-review confirmations; local only, never in the committed approval. */
    readonly previous?: readonly ReviewConfirmation[];
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
    readonly previous?: readonly ReviewConfirmation[];
} | {
    readonly ok: false;
    readonly error: string;
};
/**
 * Accept exactly one fenced JSON verdict that echoes the requested digest. With
 * prior ids the verdict is a focused re-review: it confirms every prior finding
 * by id, and an open prior id is repeated by exactly one finding.
 */
export declare function parseReviewVerdict(text: string, expectedDigest: string, priorIds?: readonly string[]): ParsedVerdict;
/** The shipped bundled review instructions live beside the definitions. */
export declare function reviewAssetsDirectory(): string;
export declare function readReviewInstruction(id: string): string;
/** One prior finding keyed by its stable per-record id (`f1`..`fn`). */
export interface FocusedFinding {
    readonly id: string;
    readonly finding: ReviewFinding;
}
/** The bounded change set between the prior reviewed tree and the current one. */
export interface ReviewChangeSet {
    readonly fromTree: string;
    readonly toTree: string;
    /** The changed-path list, bounded to the first entries. */
    readonly paths: readonly string[];
    readonly pathsTruncated: boolean;
    readonly patch: string;
    readonly patchTruncated: boolean;
    /** The current snapshot checkout, named when the patch is truncated. */
    readonly reviewCwd?: string;
}
/** The focused re-review context rendered after the review's sections. */
export interface FocusedReviewContext {
    /** The complete prior-finding inventory, in the prior record's order. */
    readonly previous: readonly FocusedFinding[];
    /** The bounded diff; absent means it could not be built. */
    readonly changes?: ReviewChangeSet;
    /** Why the diff is unavailable, named in the prompt. */
    readonly diffUnavailable?: string;
}
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
    readonly section?: SectionReview;
    readonly digest: string;
    readonly snapshot: boolean;
    readonly extra?: string;
    /** Caller-supplied facts carried by the delegate alias into this review. */
    readonly context?: string;
    readonly objective?: string;
    /** The prior findings and bounded diff when this unit's last record is a moved FINDINGS. */
    readonly focused?: FocusedReviewContext;
}
/** Render the bundled instruction with the review's digest-bound context. */
export declare function renderReviewPrompt(input: ReviewPromptInput): string;
/** The per-scope digest lives with the evidence verifier; kept importable here. */
export { reviewDigest } from './evidence.js';
/** Write one file atomically: temp beside the target, then rename. */
export declare function writeReviewFileAtomic(file: string, bytes: string, cancelled?: () => boolean): Promise<void>;
/**
 * Resolve a workspace-relative record path and prove every existing ancestor
 * stays inside the canonical workspace. A linked store would otherwise publish
 * outside the workspace, which evidence validation cannot undo after the write.
 */
export declare function containedRecordTarget(workspace: string, relative: string): Promise<string>;
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
export declare function writeLocalReviewRecord(workspace: string, record: ReviewRecord, cancelled?: () => boolean): Promise<ReviewWrite>;
/** Write the committed approval before the local record; a task PASS only. */
export declare function writePortableApproval(workspace: string, record: ReviewRecord, cancelled?: () => boolean): Promise<ReviewWrite>;
/** A review's runner: it can report when the target actually started. */
export interface ReviewSubagentRunner extends SubagentRunner {
    /** Resolves once the most recent target activation is published; rejects on a start failure. */
    awaitStart?(): Promise<void>;
}
export interface ReviewRunInput {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly reviewer: ResolvedReviewer;
    readonly runner: ReviewSubagentRunner;
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
        /** The frozen change-artifact digest for a task review. */
        readonly artifactDigest?: string;
        /** The frozen checkout to run in; absent means the live worktree. */
        readonly reviewCwd?: string;
        /** The authoritative section coverage of a section-scope task review. */
        readonly section?: SectionReview;
        /** Re-check the reviewed input set after the run; a reason discards the verdict. */
        readonly liveGuard?: () => Promise<string | undefined>;
    };
    readonly timeoutMs: number;
    readonly session: string;
    readonly now?: number;
    readonly signal?: AbortSignal;
    /** The git runner the focused diff uses; production spawns the bounded runner. */
    readonly runGit?: GitRunner;
    /** Captured before the first start; a retry preserves it across attempts. */
    readonly baseline?: ReviewRecordBaseline;
    /** True once the run settled completed-soft; a late verdict is discarded. */
    readonly cancelled?: () => boolean;
    /** The delegate alias's caller payload, persisted in the run context. */
    readonly callerContext?: string;
    readonly callerObjective?: string;
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
    /** A newer authoritative record superseded this attempt; nothing was written. */
    readonly discarded?: boolean;
}
/**
 * The authoritative record fingerprint captured immediately before a review's
 * first start; a retry keeps it, so only the settled attempt may publish.
 */
export interface ReviewRecordBaseline {
    /** The record file's normalized JSON, or undefined when no record existed. */
    readonly fingerprint: string | undefined;
}
/** The local record path one review attempt publishes to. */
export declare function reviewRecordPathOf(input: Pick<ReviewRunInput, 'definition' | 'change' | 'step' | 'task' | 'prepared'>): string;
/** Read the authoritative record's comparable fingerprint; absent or unreadable is undefined. */
export declare function readReviewRecordFingerprint(workspace: string, input: Pick<ReviewRunInput, 'definition' | 'change' | 'step' | 'task' | 'prepared'>): Promise<string | undefined>;
/** Record an engine-side failure (queue full, timeout) as an ERROR review record. */
export declare function recordReviewFailure(input: {
    readonly run: WorkflowRun;
    readonly definition: Definition;
    readonly step: Step;
    readonly reviewer: ResolvedReviewer;
    readonly context: EvidenceContext;
    readonly change: string;
    readonly task?: {
        readonly id: string;
        readonly number?: string;
        readonly text: string;
    };
    readonly prepared: ReviewRunInput['prepared'];
    readonly session: string;
    readonly error: string;
    readonly failureClass: string;
    readonly now?: number;
    readonly writeLocal?: typeof writeLocalReviewRecord;
    /** A started attempt's start baseline; a pre-start failure carries none. */
    readonly baseline?: ReviewRecordBaseline;
}): Promise<ReviewRunResult>;
/**
 * The step's record contract narrowed to the ERROR verdict, when it is one.
 * Shared with the intake, which consumes a current matching ERROR without
 * starting a second review.
 */
export declare function errorContractOf(evidence: Evidence): RecordEvidence | undefined;
/**
 * The failed review steps whose current record is a contract-matching ERROR.
 * Only those failures are provisional turn-close evidence: a recordless failure
 * (unreadable artifacts, an unpublished ERROR) or a record that no longer
 * matches the step contract keeps the close blocked.
 */
export declare function provisionalReviewSteps(run: WorkflowRun, definition: Definition, context: EvidenceContext): Promise<ReadonlySet<string>>;
/** The review identity every attempt carries before a verdict exists. */
type ReviewRecordBase = Omit<ReviewRecord, 'verdict' | 'findings'>;
export type ReviewAttemptResult = {
    readonly kind: 'verdict';
    readonly verdict: 'PASS' | 'FINDINGS';
    readonly findings: readonly ReviewFinding[];
    /** The focused re-review confirmations; present only with prior ids. */
    readonly previous?: readonly ReviewConfirmation[];
} | {
    readonly kind: 'failure';
    readonly error: string;
    readonly failureClass: FailureClass;
    readonly transient: boolean;
    readonly retryAfterMs?: number;
};
/** One executed attempt, unpublished: the scheduler decides whether it settles. */
export interface ReviewAttemptOutcome {
    readonly record?: ReviewRecordBase;
    readonly result: ReviewAttemptResult;
}
export interface ReviewAttemptHandle {
    /** Resolves when the target actually started; rejects with the raw start failure. */
    readonly started: Promise<void>;
    /** The attempt result; it never rejects. */
    readonly result: Promise<ReviewAttemptOutcome>;
    readonly now: number;
}
/**
 * Prepare one review attempt and return only after the target actually started.
 * The result continues in the background; the queue's start hook awaits
 * `started`, so an activation failure is classified and retried before the
 * acceptance deadline is cleared. No record is written here.
 */
export declare function beginReviewAttempt(input: ReviewRunInput): Promise<ReviewAttemptHandle>;
/**
 * Publish one settled attempt: write the ERROR record or the verdict record
 * (and the committed approval first for a task PASS), then settle the step from
 * its own evidence. Only the scheduler's settled attempt reaches this.
 */
export declare function publishReviewOutcome(input: ReviewRunInput, outcome: ReviewAttemptOutcome, now?: number): Promise<ReviewRunResult>;
/**
 * Run one review step synchronously: execute the attempt and publish it. The
 * queue wraps `beginReviewAttempt` and `publishReviewOutcome` instead, so a
 * retried attempt publishes nothing.
 */
export declare function runReviewStep(input: ReviewRunInput): Promise<ReviewRunResult>;
