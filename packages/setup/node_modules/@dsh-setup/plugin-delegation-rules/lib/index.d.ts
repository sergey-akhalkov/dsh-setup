import type { Context } from '@deepseek-ai/cordis';
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
/** Services the registrations depend on. */
export declare const inject: string[];
/**
 * Catalog text; a test keeps it identical to the asset frontmatter. Kept short
 * because the tool descriptions plus this line share the model-facing budget.
 */
export declare const skillDescription = "Delegation rules: authored triggers, targets, result contracts, and the task-by-task review workflow. Load when authoring or debugging delegation rules, when a gate steers, when reviewing a completed task or spec, or when consulting, researching, or patching through a delegated model.";
/**
 * Tool descriptions are model-facing policy: they are the only delegation
 * guidance present without opening the skill. A budget test pins their size.
 */
export declare const toolDescriptions: {
    readonly delegate: "Run one configured delegation rule through its target. Manual tasks: `research` answers a question with evidence and sources; `blocker` consults on a stuck plan when the failure-streak hint appears; `bug-fix` runs a write target in an isolated git worktree and returns the diff and test report (never auto-merged). Gate rules: `spec-review` reviews the whole active OpenSpec change before implementation; `task-review` reviews the next checked task without a PASS/ERROR record; `integration-review` is the optional whole-worktree check. The engine validates the rule, starts the configured DSH subagent provider, parses the contract result, and writes a digest-bound record under `.dsh/delegation`; a review PASS needs zero P0/P1 findings, FINDINGS/ERROR are reported but do not pass a strict gate, and a matching PASS is reused without another run. The `answer` contract writes no gate record. Only a matching record satisfies the turn-stopping gate: a text claim does not. A missing or incompatible target is reported with the target id, provider name, and next action.";
    readonly task_progress: "Record an explicit in-progress or blocked note for one unchecked task, with the reason and the current worktree digest. Use it when a task spans turns instead of ticking `tasks.md`: it runs no model and costs nothing. The note lets a code-changing turn close only while the worktree still matches it; after any further change it is stale and a fresh note or the tick plus `delegate` task review is required. A checked task never accepts a note, and a note never counts as a task-review PASS.";
    readonly delegation_status: "Report registered DSH subagent providers and capabilities, configured delegation targets and rules, per-change task/progress-note state, review record state (matching, stale, missing, malformed), and missing-target diagnostics with the next action. Use it when a `delegate` call reports a target problem or before configuring rules.";
};
export type Trigger = 'manual' | 'spec-ready' | 'spec-task-ready' | 'implementation-work' | 'implementation-complete' | 'failure-streak';
export type Contract = 'review' | 'answer' | 'patch' | 'note';
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
    /** Declares that this provider instance may write; required by `patch` rules. */
    write?: boolean;
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
    threshold?: number;
    isolation?: 'worktree';
}
/** Per-contract target-run timeouts in milliseconds. */
export interface TimeoutConfig {
    review: number;
    answer: number;
    patch: number;
}
/** Row configuration accepted by {@link apply}. */
export interface BundleConfig {
    targets?: Record<string, TargetConfig>;
    rules?: RuleConfig[];
    timeouts?: Partial<TimeoutConfig>;
    failureStreak?: number;
}
/** Test seams; production uses the filesystem, git, and the wall clock. */
export interface ApplyOptions {
    runGit?: GitRunner;
    now?: () => Date;
}
/** One fixed-argument git invocation; output is raw bytes so diffs stay lossless. */
export type GitRunner = (args: readonly string[], cwd: string, signal?: AbortSignal) => Promise<Buffer>;
interface EngineConfig {
    targets: Map<string, TargetConfig>;
    rules: RuleConfig[];
    timeouts: TimeoutConfig;
    failureStreak: number;
}
/**
 * Validate one row configuration. Configuration mistakes fail the row with the
 * rule/target id and a next action; a missing provider is deliberately not a
 * validation error, so the profile composes without the target installed.
 */
export declare function validateConfig(raw: unknown): EngineConfig;
/**
 * Register the three tools, the on-demand skill, and the turn-stopping gate.
 * A missing subagent provider is not fatal here: it is diagnosed by the tools
 * and `delegation_status`, so the profile composes without that provider.
 */
export declare function apply(ctx: Context, config?: BundleConfig, options?: ApplyOptions): void;
export {};
