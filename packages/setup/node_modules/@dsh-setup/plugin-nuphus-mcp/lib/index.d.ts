import type { Context } from '@deepseek-ai/cordis';
/**
 * Nuphus plugin: this module contributes the guidance skill that describes how
 * to drive the desktop and browser tools the `nuphus-mcp` server exposes. The
 * server itself is configured by the setup's lazy MCP row, so a session reaches
 * it through `mcp_tools`/`mcp_call` rather than static `mcp__nuphus-mcp__*` tools;
 * a profile may still add its own static adapter row.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-nuphus-mcp";
/** Service the registration depends on. */
export declare const inject: string[];
/** Register the on-demand skill; the adapter row mounts separately. */
export declare function apply(ctx: Context): void;
