import type { Context } from '@deepseek-ai/cordis';
/**
 * The Host half of the plugin.
 *
 * The bundle row mounts this module so the package is a real DSH plugin; the
 * visible contribution lives in the Client half (`./client`), declared by
 * `dsh.client`. The Host half declares the plugin identity and stays inert
 * until the plugin grows a Host-side capability.
 */
export declare const name = "@dsh-setup/plugin-composer-clock";
export declare function apply(_ctx: Context): void;
