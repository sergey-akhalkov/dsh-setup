import type { Context } from '@deepseek-ai/cordis';
/**
 * Serena plugin: the adapter row mounts the Harness MCP client from the
 * composition fragment, and this module contributes the always-on code-surface
 * rule and the guidance skill that describes how to use that server well. The
 * two rows are independent, so disabling this one leaves the Serena tools
 * working.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-serena";
/** Services both registrations depend on. */
export declare const inject: string[];
/** Row configuration; only an explicit false disables the always-on rule. */
interface BundleConfig {
    alwaysOn?: boolean;
}
/**
 * Register the skill and, unless the row configures `alwaysOn: false`, the
 * always-on code-surface rule.
 */
export declare function apply(ctx: Context, config?: BundleConfig): void;
export {};
