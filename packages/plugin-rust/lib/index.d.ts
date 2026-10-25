import type { Context } from '@deepseek-ai/cordis';
/**
 * Rust plugin: registers the packaged `rust` skill in the catalog. The body and
 * its references ship beside the built module, so listing and loading never
 * touch the network.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-rust";
/** Service the registration depends on. */
export declare const inject: string[];
/** Register the on-demand skill. */
export declare function apply(ctx: Context): void;
