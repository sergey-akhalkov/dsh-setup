import type { Context } from '@deepseek-ai/cordis';
/**
 * Working-principles plugin: registers a first-party working contract as an
 * always-on system-prompt section and lists on-demand skills beside it.
 *
 * Both contributions read the vendored assets that ship inside the package, so
 * installation, catalog listing, and prompt assembly never touch the network.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-working-principles";
/** Services both registrations depend on. */
export declare const inject: string[];
/** Row configuration; only an explicit false disables the always-on contract. */
interface BundleConfig {
    alwaysOn?: boolean;
}
/**
 * Register both skills and, unless the row configures `alwaysOn: false`, the
 * always-on contract.
 */
export declare function apply(ctx: Context, config?: BundleConfig): void;
export {};
