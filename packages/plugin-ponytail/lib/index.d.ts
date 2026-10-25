import type { Context } from '@deepseek-ai/cordis';
/**
 * Ponytail plugin: registers the pinned upstream prompt as an on-demand skill
 * and, by default, as an always-on system-prompt section.
 *
 * Both contributions read the vendored files that ship beside the built module,
 * so installation, catalog listing, and prompt assembly never touch the network.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-ponytail";
/** Services both registrations depend on. */
export declare const inject: string[];
/** Row configuration accepted by the plugin; only an explicit false disables always-on. */
interface PonytailConfig {
    alwaysOn?: boolean;
}
/**
 * Register the on-demand skill and, unless the row configures
 * `alwaysOn: false`, the always-on system-prompt section.
 */
export declare function apply(ctx: Context, config?: PonytailConfig): void;
export {};
