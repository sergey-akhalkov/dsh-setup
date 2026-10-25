import type { Context } from '@deepseek-ai/cordis';
/**
 * RTK token-workflow plugin: registers a short always-on routing rule and one
 * on-demand skill. Both read the assets that ship inside the package, so
 * installation, catalog listing, and prompt assembly never touch the network.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-rtk";
/** Services both registrations depend on. */
export declare const inject: string[];
/** Row configuration; only an explicit false disables the always-on rule. */
interface BundleConfig {
    alwaysOn?: boolean;
}
/**
 * Register the skill and, unless the row configures `alwaysOn: false`, the
 * always-on routing rule.
 */
export declare function apply(ctx: Context, config?: BundleConfig): void;
export {};
