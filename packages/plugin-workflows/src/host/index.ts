import type { Context } from '@deepseek-ai/cordis'

/** Workflows: a read-only Host recorder and the Workflows conversation view. */
export const name = '@dsh-setup/plugin-workflows'

/**
 * Host services the recorder needs. A host without them stays inert instead of
 * registering half a surface; the Client half independently checks its own.
 */
export const inject = ['agents', 'workingDirectory', 'fs', 'connection']

/** Register the recorder and its read-only routes. Filled in by the recorder task. */
export function apply(_ctx: Context): void {}
