import type { Context } from '@deepseek-ai/cordis';
import type { ContextFormed, StreamChunk } from '@deepseek-ai/dsh-llm';
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'loop-guard': {
            kind: 'loop-guard';
        } & ContextFormed;
    }
}
/**
 * Loop guard: cuts repeated streamed text, steers a recovery notice into the
 * next step, then escalates to a bounded turn reset and a final stop.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-loop-guard";
/** Agents are the only service read directly; events are dispatched to the fiber. */
export declare const inject: string[];
/** Row configuration. Every field is optional; omission selects the documented default. */
export interface Config {
    /** Inspect streamed reasoning (default true). */
    reasoning?: boolean;
    /** Inspect streamed visible text (default false). */
    text?: boolean;
    /** Also guard subagent sessions (default false). */
    subagents?: boolean;
    /** Repetitions of one normalized line within one request that trigger a cut (default 5). */
    minRepeats?: number;
    /** Lines shorter than this are ignored (default 12). */
    minLineChars?: number;
    /** Number of recent reasoning blocks compared across steps (default 10). */
    crossBlockWindow?: number;
    /** Blocks, including the current one, that must contain the line (default 4). */
    crossBlockRepeats?: number;
    /** Recovery notices allowed in one turn before the reset (default 3). */
    maxInterventionsPerTurn?: number;
    /** Automatic turn resets allowed per session before the final stop (default 2). */
    maxResetsPerSession?: number;
    /** Maximum characters of the repeated line quoted in a notice or stop reason (default 80). */
    previewChars?: number;
    /** Last resort after the reset limit (default `stop`). */
    finalFallback?: 'stop';
}
/** Fully resolved configuration; the plugin never runs on partial values. */
export interface ResolvedConfig {
    readonly reasoning: boolean;
    readonly text: boolean;
    readonly subagents: boolean;
    readonly minRepeats: number;
    readonly minLineChars: number;
    readonly crossBlockWindow: number;
    readonly crossBlockRepeats: number;
    readonly maxInterventionsPerTurn: number;
    readonly maxResetsPerSession: number;
    readonly previewChars: number;
    readonly finalFallback: 'stop';
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
/** One detected repetition, with the normalized line kept only in memory. */
export interface LoopDetection {
    readonly line: string;
    readonly count: number;
    readonly kind: 'reasoning' | 'text';
    readonly acrossBlocks: boolean;
}
/**
 * Streaming repetition detector. Per-request state counts normalized lines
 * inside one model request; per-turn state keeps a ring of reasoning-block
 * line-hash sets and resets with the turn.
 */
export declare class LoopDetector {
    #private;
    constructor(config: ResolvedConfig);
    /** Start one model request: request counts and the open block set reset; the cross-block ring survives. */
    beginRequest(): void;
    /** Start a new turn: request state and the recent-block ring start empty. */
    resetTurn(): void;
    /** Finish the request, committing every open reasoning block to the cross-block ring. */
    endRequest(): void;
    /** Feed one chunk and return the first repetition it completes, if any. */
    observe(chunk: StreamChunk): LoopDetection | undefined;
}
/** Install the detector, stream guard, and step-end reset. */
export declare function apply(ctx: Context, config?: Config): void;
