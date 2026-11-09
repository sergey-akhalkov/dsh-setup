import type { Context } from '@deepseek-ai/cordis';
import { type ObservedEvent } from './evaluate.js';
import { type JournalInput } from './journal.js';
import { type DefinitionEvent } from './triggers.js';
/** Workflows: a read-only Host recorder and the Workflows conversation view. */
export declare const name = "@dsh-setup/plugin-workflows";
/**
 * Host services the recorder needs. A host without them stays inert instead of
 * registering half a surface; the Client half independently checks its own.
 */
export declare const inject: string[];
/** Normalize one observed plugin event into definition trigger events. */
export declare function definitionEventsOf(input: JournalInput, event: ObservedEvent, workspace: string): DefinitionEvent[];
/** The row-level retro applicability settings; they mirror the goal-continuity row. */
export interface CheckpointApplicabilityConfig {
    /** Minimum tool calls in a turn before a checkpoint is required; default 4. */
    readonly minToolCalls?: number;
    /** Require a write or a started worker; default true. */
    readonly requireWrite?: boolean;
    /** Consecutive checkpoints a bottleneck may persist before a route change; default 2. */
    readonly bottleneckAge?: number;
    /** Steps after the latest checkpoint before it is stale; default 40. */
    readonly stepInterval?: number;
    /** Require a tagged worker start for computed parallel lanes; default true. */
    readonly enforceParallel?: boolean;
}
export interface ResolvedCheckpointApplicability {
    readonly minToolCalls: number;
    readonly requireWrite: boolean;
    readonly bottleneckAge: number;
    readonly stepInterval: number;
    readonly enforceParallel: boolean;
}
export declare const DEFAULT_CHECKPOINT_APPLICABILITY: ResolvedCheckpointApplicability;
/**
 * Register the recorder. Every listener is observe-only: it never calls
 * `agent.steer`, `agent.inject`, or a tool, and a thrown observation is
 * contained so the turn is unaffected.
 */
export interface WorkflowsConfig {
    /** The engine-level opt-in for the optional intent trigger; default false. */
    readonly allowIntent?: boolean;
    /** The open-run limit for every admission path; default 20. */
    readonly maxRuns?: number;
    /** The retro applicability settings; must mirror the goal-continuity row. */
    readonly checkpointApplicability?: CheckpointApplicabilityConfig;
    /** The validate-only profile settings for the `verify` definition. */
    readonly verify?: {
        readonly commands?: readonly string[];
        readonly maxBlocks?: number;
    };
}
export declare function apply(ctx: Context, config?: WorkflowsConfig): void;
