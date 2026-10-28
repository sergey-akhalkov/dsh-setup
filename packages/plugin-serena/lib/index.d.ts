import type { Context } from '@deepseek-ai/cordis';
/**
 * Serena plugin: this module contributes the always-on code-surface trigger and
 * the guidance skill that describes how to use the `serena` server well. The
 * server itself is configured by the setup's lazy MCP row, so a session reaches
 * it through `mcp_tools`/`mcp_call` rather than static `mcp__serena__*` tools; a
 * profile may still add its own static adapter row.
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
