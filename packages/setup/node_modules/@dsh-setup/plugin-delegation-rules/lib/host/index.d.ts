import type { Context } from '@deepseek-ai/cordis';
import { type NumberedTask, type ReviewFinding } from '../shared/approval.js';
import { type FailureClass } from './review-queue.js';
/**
 * Delegation-rules plugin: a model-agnostic engine where rules, targets,
 * instructions, result contracts, and gate policies are configuration. The
 * Host registers the `delegate`, `task_progress`, and `delegation_status`
 * tools, one on-demand skill, and the `agent/turn-stopping` gate. It has no
 * always-on prompt section and no runtime dependency on any other DSH or
 * `@dsh-setup` package.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-delegation-rules";
/** Services the registrations depend on; the learning surfaces attach when present. */
export declare const inject: string[];
/**
 * Catalog text; a test keeps it identical to the asset frontmatter. Kept short
 * because the tool descriptions plus this line share the model-facing budget.
 */
export declare const skillDescription = "Delegation rules: authored triggers, targets, result contracts, and the task-by-task review workflow. Load when authoring or debugging delegation rules, when a gate steers, or when reviewing a completed task or spec through a delegated model.";
/**
 * Tool descriptions are model-facing policy: they are the only delegation
 * guidance present without opening the skill. A budget test pins their size.
 */
export declare const toolDescriptions: {
    readonly delegate: "Run one configured delegation rule through its target. Gate rules: `spec-review` reviews the whole active OpenSpec change before implementation; `task-review` reviews the next checked task without a PASS/ERROR record, or one `section` (a tasks.md level-2 heading number such as `1`, its `1.x` form, or the normalized title) with every checked task of that section in one run; `integration-review` is the optional whole-worktree check. One section run writes one verdict and publishes one per-task approval per covered checked task; `task` and `section` are mutually exclusive, unchecked tasks are out of scope, and a newly checked task needs a new review. The engine validates the rule, starts the configured DSH subagent provider, parses the contract result, and writes a digest-bound record under `.dsh/delegation`; a review PASS needs zero P0/P1 findings, FINDINGS/ERROR are reported but do not pass a strict gate, and a matching PASS is reused without another run. Only a matching record satisfies the turn-stopping gate: a text claim does not. A note rule runs through task_progress, not this tool. A missing or incompatible target is reported with the target id, provider name, and next action.";
    readonly task_progress: "Record an explicit in-progress or blocked note for one unchecked task, with the reason and the current worktree digest. Use it when a task spans turns instead of ticking `tasks.md`: it runs no model and costs nothing. The note lets a code-changing turn close only while the worktree still matches it; after any further change it is stale and a fresh note or the tick plus `delegate` task review is required. A checked task never accepts a note, and a note never counts as a task-review PASS.";
    readonly delegation_status: "Report registered DSH subagent providers and capabilities, configured delegation targets and rules, each active change's involvement by this session (created, spec changed, checked tasks), per-change task/progress-note state, review record state (matching, stale, missing, malformed), and missing-target diagnostics with the next action. It never attributes a change. Use it when a `delegate` call reports a target problem or before configuring rules.";
};
/** Queue defaults stay well below the DSH active-child limit so workers keep room. */
export declare const DEFAULT_REVIEW_QUEUE: Readonly<ReviewQueueConfig>;
export type Trigger = 'manual' | 'spec-ready' | 'spec-task-ready' | 'implementation-work' | 'lane-assignment' | 'lane-boundary' | 'implementation-complete';
export type Contract = 'review' | 'note';
export type Gate = 'strict' | 'soft' | 'none';
export type ReviewScope = 'whole' | 'task';
export type ProgressStatus = 'in-progress' | 'blocked';
export type Verdict = 'PASS' | 'FINDINGS' | 'ERROR';
/** One LLM route override accepted by a DSH in-process provider. */
export interface AgentOptionsConfig {
    provider?: string;
    model?: string;
    reasoningEffort?: string;
    maxTokens?: number;
}
/** One target: a registered `ctx.subagents` provider plus optional options. */
export interface TargetConfig {
    provider: string;
    model?: string;
    reasoningEffort?: string;
    agentOptions?: AgentOptionsConfig;
}
/** One configured rule; every field is data, never a provider name hard-coded in code. */
export interface RuleConfig {
    id: string;
    when: Trigger;
    to?: string;
    instruction?: string;
    contract: Contract;
    gate: Gate;
    phase?: string;
    scope?: ReviewScope;
}
/** The review-run target timeout in milliseconds. */
export interface TimeoutConfig {
    review: number;
}
/** Per-profile review queue limits and retry policy. */
export interface ReviewQueueConfig {
    /** Off restores the direct target start. */
    enabled: boolean;
    /** Live review targets allowed at once; below the DSH active-child limit. */
    concurrency: number;
    /** Unique waiting runs allowed before admission is refused. */
    maxQueued: number;
    /** Original attempt plus retries. */
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    waitTimeoutMs: number;
}
/** Row configuration accepted by {@link apply}. */
export interface BundleConfig {
    targets?: Record<string, TargetConfig>;
    rules?: RuleConfig[];
    timeouts?: Partial<TimeoutConfig>;
    reviewQueue?: Partial<ReviewQueueConfig>;
    /** Gate-only retirement switch (default `workflowOwned: true`). */
    gates?: {
        workflowOwned?: boolean;
    };
}
/** Resolved gate ownership: false moves the task-review and archive gates to the workflow. */
export interface GatesConfig {
    readonly workflowOwned: boolean;
}
/** Test seams; production uses the filesystem, git, and the wall clock. */
export interface ApplyOptions {
    runGit?: GitRunner;
    now?: () => Date;
    /** Called once per review run after it settles; the run is no longer pending. */
    onRunSettled?: (runId: string, state: SettledRunState) => void;
    /** Test seam: observes each published review record. */
    onPublished?: (runId: string, record: ReviewRecord) => void;
    /** Test seam: throws before admission to simulate an internal queue failure. */
    queueFault?: () => void;
    /** Test seam: delays the once-per-workspace recovery scan. */
    recoverDelay?: () => Promise<void>;
    /** Test seam: runs inside the publication lock before any record is written. */
    publishHold?: (info: {
        rule: string;
        change: string;
        section?: string;
    }) => Promise<void> | void;
    /** Test seam: runs after admission and before a target starts. */
    startHold?: (info: {
        rule: string;
        change: string;
        section?: string;
    }) => Promise<void> | void;
}
/** Terminal review-run states reported to the settlement observer. */
export type SettledRunState = 'completed' | 'failed' | 'discarded';
/** One fixed-argument git invocation; output is raw bytes so diffs stay lossless. */
export type GitRunner = (args: readonly string[], cwd: string, signal?: AbortSignal, 
/** Extra environment, merged over `process.env`; used for `GIT_INDEX_FILE`. */
env?: Record<string, string>, 
/** Bytes written to the child's stdin and closed; used for `--stdin` path lists. */
stdin?: string | Buffer) => Promise<Buffer>;
interface EngineConfig {
    targets: Map<string, TargetConfig>;
    rules: RuleConfig[];
    timeouts: TimeoutConfig;
    reviewQueue: ReviewQueueConfig;
    gates: GatesConfig;
}
/**
 * Validate one row configuration. Configuration mistakes fail the row with the
 * rule/target id and a next action; a missing provider is deliberately not a
 * validation error, so the profile composes without the target installed.
 */
export declare function validateConfig(raw: unknown): EngineConfig;
/** Validate the gate-only retirement switch fail-loud with its field and shape. */
export declare function validateGates(raw: unknown): GatesConfig;
/**
 * Validate the review queue block. An omitted block enables the documented
 * defaults; an invalid field fails plugin load with the field and its range.
 */
export declare function validateReviewQueue(raw: unknown): ReviewQueueConfig;
/** Fixed-argument git runner. The shell is never used, so no input is interpolated. */
export declare function defaultGit(args: readonly string[], cwd: string, signal?: AbortSignal, env?: Record<string, string>, stdin?: string | Buffer): Promise<Buffer>;
type TaskInfo = NumberedTask;
/** One resolved `tasks.md` section: a level-2 heading and the tasks it covers. */
interface SectionInfo {
    /** Stable identity: heading number, normalized title, or `untitled`. */
    key: string;
    /** Heading title without `##`; empty for the untitled leading group. */
    title: string;
    /** Every numbered task under the heading at resolution time. */
    tasks: TaskInfo[];
    /** The checked tasks this run reviews, in heading order. */
    covered: TaskInfo[];
    /** The tasks excluded because they are unchecked. */
    unchecked: TaskInfo[];
}
interface ChangeInfo {
    name: string;
    dir: string;
    reviewReady: boolean;
}
interface ReviewRecord {
    rule: string;
    change: string;
    phase: string;
    scope: ReviewScope;
    taskId?: string;
    digest: string;
    worktreeDigest?: string;
    verdict: Verdict;
    findings: Finding[];
    target: {
        provider: string;
        model?: string;
        reasoningEffort?: string;
    };
    /** Owning DSH session id; absent on records written before thread scoping. */
    session?: string;
    /** Background review run that wrote this record; absent on older records. */
    runId?: string;
    time: string;
    error?: string;
    /** Section key for a section-scope review; absent on per-task and whole records. */
    section?: string;
    /** Section heading title, kept beside the key for readability. */
    sectionTitle?: string;
    /** Covered checked task ids for a section-scope review, in review order. */
    taskIds?: string[];
    /** Classified failure for a failed section run, preserved on each covered task's record. */
    failureClass?: FailureClass;
}
type Finding = ReviewFinding;
type RecordState = {
    kind: 'missing';
} | {
    kind: 'malformed';
    error: string;
} | {
    kind: 'record';
    record: ReviewRecord;
};
/** Hash every change artifact, normalizing `tasks.md` checkbox state. */
export declare function specDigest(changeDir: string, signal?: AbortSignal): Promise<string>;
/** One immutable review checkout; the digest binds to `tree`. */
export interface ReviewSnapshot {
    /** Content tree the task digest binds to. */
    tree: string;
    /** Snapshot commit checked out in the disposable worktree. */
    commit: string;
    /** Disposable worktree the reviewer runs in. */
    worktree: string;
    /** Frozen change directory inside the worktree. */
    changeDir: string;
    /** Change-artifact digest computed from the frozen copy. */
    specDigest: string;
}
/**
 * Build the disposable task-review snapshot from the exact review input set.
 * Returns undefined when it cannot be built safely; the caller reviews the live
 * worktree with the mutation guard instead and gets the cause through `onUnavailable`.
 */
export declare function createReviewSnapshot(cwd: string, change: ChangeInfo, runId: string, runGit: GitRunner, signal: AbortSignal, 
/** Test seam: runs after the change directory is frozen, before its digest. */
afterCopy?: () => Promise<void> | void, 
/** Called once with a bounded cause when no snapshot is produced. */
onUnavailable?: (reason: string) => void): Promise<ReviewSnapshot | undefined>;
/**
 * Write the initial lease and start renewing it. The initial write is awaited,
 * so a lease exists before the worktree it protects is created.
 */
export declare function startSnapshotLease(cwd: string, runId: string, refreshMs?: number): Promise<void>;
/** Stop renewal and await any in-flight write, so none lands after cleanup. */
export declare function stopSnapshotLease(cwd: string, runId: string): Promise<void>;
/**
 * Remove snapshots no live run owns. Ownership is the lease, never age or the
 * configured review timeout; a lease-less directory is given a grace period.
 * Orphaned leases before creation, scratch indexes, and stale worktree metadata
 * are also retried here. Runs at most once per throttle window and never throws.
 */
export declare function sweepReviewSnapshots(cwd: string, runGit: GitRunner, now?: number): Promise<void>;
/** Remove one snapshot checkout, its lease, and its scratch index; best effort. */
export declare function discardReviewSnapshot(cwd: string, runId: string, runGit: GitRunner, 
/** Test seam: the filesystem remover, so a failed removal can be injected. */
remove?: (path: string) => Promise<void>): Promise<void>;
/** A gate match: PASS/ERROR only, identified, with an optional current-digest check. */
export declare function recordSatisfies(state: RecordState, change: string, scope: ReviewScope, digest: string | undefined, taskId?: string): boolean;
interface ParsedVerdict {
    verdict: 'PASS' | 'FINDINGS';
    findings: Finding[];
}
/** Accept exactly one fenced JSON verdict that echoes the requested digest. */
export declare function parseVerdict(text: string, expectedDigest: string): ParsedVerdict;
/** Export for the prompt-budget tests; the engine is the only production caller. */
export declare function reviewPrompt(rule: RuleConfig, change: ChangeInfo, digest: string, task: TaskInfo | undefined, context: string | undefined, objective: string | undefined, snapshot?: boolean, section?: SectionInfo): string;
/**
 * Register the three tools, the on-demand skill, and the turn-stopping gate.
 * A missing subagent provider is not fatal here: it is diagnosed by the tools
 * and `delegation_status`, so the profile composes without that provider.
 */
export declare function apply(ctx: Context, config?: BundleConfig, options?: ApplyOptions): void;
export {};
