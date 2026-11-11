import type { Context } from '@deepseek-ai/cordis';
/**
 * OpenSpec plugin: contributes the `change-intake` definition and the four
 * OpenSpec shadow triggers to the optional workflows engine. The assets are
 * read-only; editing one creates a workspace-local copy through the engine's
 * editor and approval flow, never a plugin write.
 */
/** Cordis plugin name, equal to the package name; also the contribution source. */
export declare const WORKFLOWS_SOURCE = "@dsh-setup/plugin-openspec";
/** One contribution the engine's `workflowsDefinitions` registry accepts. */
export interface WorkflowsContribution {
    source: string;
    definitions: readonly unknown[];
    triggers: readonly unknown[];
}
/**
 * Read both assets eagerly so a malformed file fails the plugin load with its
 * path. Only the outer shape is checked here: the engine's closed schema
 * validates each definition and trigger and refuses an invalid one by field.
 */
export declare function readWorkflowContribution(): WorkflowsContribution;
/**
 * Register the contribution when the engine's registry service exists. A host
 * without `inject`, or a profile without the workflows plugin, registers
 * nothing and keeps the panel, picker, and skill surfaces working.
 */
export declare function registerWorkflowsContribution(ctx: Context): void;
