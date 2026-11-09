import type { WorkflowRun } from './runs.js';
/**
 * The `workflows-active-runs` system-prompt context: at most five bounded lines
 * in total, one per active run; no section at all when none is active, so a
 * prompt without workflows stays byte-identical.
 */
export declare const ACTIVE_RUNS_CONTEXT = "workflows-active-runs";
export declare const MAX_ACTIVE_RUN_LINES = 5;
/** One rendered line never exceeds this bound, whatever the identifiers hold. */
export declare const MAX_ACTIVE_RUN_LINE_CHARS = 240;
/** One bounded line for an active run, or '' when there is none. */
export declare function renderActiveRunsContext(runs: readonly WorkflowRun[]): string;
export interface ActiveRunsPromptTarget {
    readonly systemPrompt?: {
        context?(contribution: {
            readonly name: string;
            readonly order: number;
            readonly required: boolean;
            /** Data-derived text: never interpolate model-controlled identifiers. */
            readonly interpolate?: boolean;
            readonly text: (context?: {
                readonly scope?: unknown;
            }) => string;
        }): () => void;
    };
    effect?(callback: () => () => void): () => void;
}
/** Register the dynamic context when the host's system-prompt service exists. */
export declare function registerActiveRunsContext(ctx: ActiveRunsPromptTarget, activeRuns: (context?: {
    readonly scope?: unknown;
}) => readonly WorkflowRun[]): boolean;
