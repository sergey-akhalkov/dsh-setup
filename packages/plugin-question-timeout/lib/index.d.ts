import type { Context } from '@deepseek-ai/cordis';
/** Row configuration shipped by the setup bundle; the settings file overrides it. */
export interface Config {
    /** Ask with the timed definition, whose pending result releases the turn. */
    timed?: boolean;
    /** Foreground wait in seconds before the timed question returns pending. */
    timeout?: number;
}
export declare const name = "@dsh-setup/plugin-question-timeout";
/** Resolved options. */
export interface Options {
    readonly timed: boolean;
    readonly timeout: number;
}
/** One editable preset entry as the Host config editor reports it. */
export interface PresetConfiguration {
    readonly entry: {
        readonly options: {
            readonly id: string;
        };
    };
    readonly inherited: Record<string, unknown>;
    readonly override: Record<string, unknown>;
}
/** The part of the Host config editor this plugin uses. */
export interface ConfigEditorLike {
    configuration(): readonly PresetConfiguration[];
    edit(entry: PresetConfiguration['entry'], change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}
/** What the plugin wrote for one preset: the config it wrote and the one it replaced. */
export interface Owned {
    readonly wrote: string;
    readonly from?: string;
}
/** The watched settings file: user knobs plus the ownership record the plugin maintains. */
export interface SettingsFile {
    timed?: boolean;
    timeout?: number;
    managed?: Record<string, Owned>;
}
/** Resolve options with their documented defaults. */
export declare function resolveOptions(config?: Config): Options;
/** Stable content hash of one preset config. */
export declare function configHash(value: Record<string, unknown>): string;
/** Read the settings file; a missing or unreadable file yields the shipped defaults. */
export declare function readSettings(directory: string): SettingsFile;
/** The exact file content a settings value serializes to. */
export declare function serializeSettings(value: SettingsFile): string;
/** Replace the settings file atomically; a failed write leaves the previous record intact. */
export declare function writeSettings(directory: string, value: SettingsFile): boolean;
/** The child list with the ask-user row set for the options, or undefined when it has no such row. */
export declare function timedPlugins(plugins: unknown, options: Options): unknown[] | undefined;
/**
 * The declaration the plugin wants: the installed one with the ask row timed, or the installed one
 * unchanged when timed is off. Returns undefined when the declaration carries no question row.
 */
export declare function derivedConfig(inherited: Record<string, unknown>, options: Options): Record<string, unknown> | undefined;
/** Whether the plugin may rewrite the config a preset currently shows. */
export declare function owned(current: Record<string, unknown>, inherited: Record<string, unknown>, managed: Record<string, Owned>, id: string): boolean;
/**
 * Derive the timed row of every preset through the Host config editor. Ownership for the exact
 * configuration is persisted before that configuration leaves the callback, so an interrupted or
 * rejected profile write re-derives instead of adopting a stale row or treating the plugin's own
 * override as foreign.
 */
export declare function derive(editor: ConfigEditorLike, options: Options, settings: SettingsFile, persist: (managed: Record<string, Owned>, applied: Options) => boolean, logger?: {
    info?(message: string): void;
    warn?(message: string): void;
}): Promise<void>;
/** Read options from the row config overlaid by the settings file. */
export declare function optionsFrom(settings: SettingsFile, config?: Config): Options;
/** Derive the timed row of every preset and follow the settings file for later changes. */
export declare function apply(ctx: Context, config?: Config): void;
