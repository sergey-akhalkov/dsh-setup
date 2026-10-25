import type { Context } from '@deepseek-ai/cordis';
/**
 * Nuphus plugin: the adapter row mounts the Harness MCP client from the
 * composition fragment, and this module contributes the guidance skill that
 * describes how to drive the desktop and browser tools it exposes. The two rows
 * are independent, so disabling this one leaves the Nuphus tools working.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-nuphus-mcp";
/** Service the registration depends on. */
export declare const inject: string[];
/** Register the on-demand skill; the adapter row mounts separately. */
export declare function apply(ctx: Context): void;
