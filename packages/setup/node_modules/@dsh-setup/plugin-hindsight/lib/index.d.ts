import type { Context } from '@deepseek-ai/cordis';
import type { ExportConfig } from './export-config.js';
export type { ExportConfig, MachineExportConfig, ResolvedExportConfig } from './export-config.js';
export { DEFAULT_EXPORT_CONFIG, EXPORT_CONFIG_FILE, isForbiddenExportDir, machineExportConfigPath, readMachineExportConfig, resolveExportConfig, } from './export-config.js';
export type { ExportErrorCode } from './export-errors.js';
export { ExportError, messageOf } from './export-errors.js';
export type { ArchiveEntries } from './export-zip.js';
export { packArchive, unpackArchive } from './export-zip.js';
/**
 * Hindsight memory plugin: delegates the whole memory lifecycle (seeding,
 * recall, injection, retention, native tools, companion skill) to the official
 * native DSH plugin. This module supplies the setup's local-server defaults,
 * only when the machine has not set them already, and starts the installed
 * local daemon if it is missing.
 */
/** Cordis plugin name, equal to the package name. */
export declare const name = "@dsh-setup/plugin-hindsight";
/** The official plugin binds the agent lifecycle events. */
export declare const inject: string[];
export interface HindsightConfig {
    serverMode?: 'cloud' | 'self-hosted' | 'daemon';
    apiUrl?: string;
    /** Start the installed local daemon when a local self-hosted server is down. Default true. */
    autostart?: boolean;
    /** Durable JSON export of every memory bank; on by default. */
    export?: ExportConfig;
}
export interface MachineConfig {
    serverMode?: string;
    apiUrl?: string;
    disabled?: boolean;
    autostart?: boolean;
    harnesses?: Record<string, MachineConfig>;
    paths?: Record<string, MachineConfig>;
    banks?: Record<string, MachineConfig>;
}
/** Whether a URL addresses the machine itself. */
export declare function isLoopbackUrl(apiUrl: string | undefined): boolean;
/** Whether a URL is the managed hindsight-embed default profile endpoint. */
export declare function isManagedEndpoint(apiUrl: string | undefined): boolean;
/**
 * Autostart only for an explicitly local self-hosted connection, unless the
 * row or machine-local config disables it. The upstream file wins over the
 * environment and the row.
 */
export declare function shouldAutostart(config: HindsightConfig, machine?: MachineConfig): boolean;
/**
 * Apply the row's connection defaults as environment fallbacks, then start the
 * official plugin. The upstream config file wins over these values, and an
 * explicit environment variable is never overwritten.
 */
export declare function apply(ctx: Context, config?: HindsightConfig): void;
