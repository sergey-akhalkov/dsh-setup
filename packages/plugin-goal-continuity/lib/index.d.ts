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
}
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
 * Install the supervisor. The configuration is validated at load, so a bad
 * profile fails loudly; supervision itself fails open.
 */
export declare function apply(ctx: Context, config?: Config): void;
