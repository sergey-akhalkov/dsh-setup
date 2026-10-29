import type { Context } from '@deepseek-ai/cordis';
import type { ContextFormed } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'goal-continuity': {
            kind: 'goal-continuity';
        } & ContextFormed;
    }
}
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-goal-continuity";
/** Services the supervisor needs. */
export declare const inject: string[];
/** Independent block-review policy nested under `blockReview`. */
export interface BlockReviewConfig {
    /** Review proposed blocks at all (default true); the supervisor keeps running when false. */
    enabled?: boolean;
    /** Registered subagent provider that starts the reviewer (default `spawn`). */
    provider?: string;
    /** Reviewer model; omitted provider options fall back to the provider defaults. */
    model?: string;
    /** Reviewer reasoning effort; same fallback as `model`. */
    reasoningEffort?: string;
    /** Read-only preset the reviewer child joins (default `goal-reviewer`). */
    reviewerPreset?: string;
    /** The goal tool's `blockedAfterConsecutiveRounds`; the gate reviews at this round (default 3). */
    blockedAfterConsecutiveRounds?: number;
    /** One review's wall-clock bound in milliseconds (default 300000). */
    timeoutMs?: number;
    /** Reviews a single goal may start (default 3); a reused verdict is free. */
    maxReviewsPerGoal?: number;
    /** Policy for a target error, timeout, or malformed verdict (default `deny`). */
    onReviewError?: 'deny' | 'allow';
    /** Policy for a missing provider, preset, or child-scope restriction (default `allow`). */
    onUnavailable?: 'deny' | 'allow';
    /** Policy once `maxReviewsPerGoal` is reached (default `deny`). */
    onExhausted?: 'deny' | 'allow';
}
/** Row configuration. Every field is optional; omission selects the documented default. */
export interface Config {
    /** Supervise goals at all (default true). */
    enabled?: boolean;
    /** Resume an active goal observed after process start (default false). */
    resumeAfterRestart?: boolean;
    /** Re-arm after a user abort of a turn that is not a goal round (default `non-goal`). */
    resumeAfterUserStop?: 'non-goal' | 'never';
    /** Automatic resumes allowed per session (default 20). */
    maxSessionResumes?: number;
    /** Rounds added by one cap extension (default 1000). */
    roundExtension?: number;
    /** Cap extensions allowed per goal (default 2). */
    maxRoundExtensions?: number;
    /** Upper bound for a goal's round cap (default 5000). */
    hardMaxGoalRounds?: number;
    /** Independent review of a proposed goal block (enabled by default). */
    blockReview?: BlockReviewConfig;
}
/** Fully resolved block-review policy; the plugin never runs on partial values. */
export interface ResolvedBlockReviewConfig {
    readonly enabled: boolean;
    readonly provider: string;
    readonly model: string;
    readonly reasoningEffort: string;
    readonly reviewerPreset: string;
    readonly blockedAfterConsecutiveRounds: number;
    readonly timeoutMs: number;
    readonly maxReviewsPerGoal: number;
    readonly onReviewError: 'deny' | 'allow';
    readonly onUnavailable: 'deny' | 'allow';
    readonly onExhausted: 'deny' | 'allow';
}
/** Fully resolved configuration; the plugin never runs on partial values. */
export interface ResolvedConfig {
    readonly enabled: boolean;
    readonly resumeAfterRestart: boolean;
    readonly resumeAfterUserStop: 'non-goal' | 'never';
    readonly maxSessionResumes: number;
    readonly roundExtension: number;
    readonly maxRoundExtensions: number;
    readonly hardMaxGoalRounds: number;
    readonly blockReview: ResolvedBlockReviewConfig;
}
/** Documented block-review defaults; the composition fragment repeats them. */
export declare const DEFAULT_BLOCK_REVIEW_CONFIG: ResolvedBlockReviewConfig;
/** Documented defaults; the composition fragment repeats them for the generated patch. */
export declare const DEFAULT_CONFIG: ResolvedConfig;
/**
 * Validate the row configuration fail-loud and apply the documented defaults.
 * @param raw - the loader-supplied config object, or undefined when the row has none.
 * @returns an immutable complete configuration.
 * @throws when a field is unknown, mistyped, or outside its allowed range.
 */
export declare function resolveConfig(raw: unknown): ResolvedConfig;
/**
 * Install the supervisor and the block-review gate. The configuration is
 * validated at load, so a bad profile fails loudly; supervision itself fails
 * open and the review failures follow their configured policies.
 */
export declare function apply(ctx: Context, config?: Config): void;
