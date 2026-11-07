import type { Context } from '@deepseek-ai/cordis';
/** Workflows: a read-only Host recorder and the Workflows conversation view. */
export declare const name = "@dsh-setup/plugin-workflows";
/**
 * Host services the recorder needs. A host without them stays inert instead of
 * registering half a surface; the Client half independently checks its own.
 */
export declare const inject: string[];
/**
 * Register the recorder. Every listener is observe-only: it never calls
 * `agent.steer`, `agent.inject`, or a tool, and a thrown observation is
 * contained so the turn is unaffected.
 */
export declare function apply(ctx: Context): void;
