import type { Context } from '@deepseek-ai/cordis';
/**
 * Issue-triage plugin: registers the opt-in `issue-triage` skill in the catalog.
 * The method body ships beside the built module, so listing and loading never
 * touch the network. Nothing is always-on.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-issue-triage";
/** Service the registration depends on. */
export declare const inject: string[];
/** Register the on-demand skill; no system-prompt or tool contribution. */
export declare function apply(ctx: Context): void;
