/**
 * Row configuration for the durable memory export. Every field is optional and
 * documented in `docs/hindsight.md`; omission selects the documented default.
 */
export interface ExportConfig {
    /** Export at all (default true). Disabling stops every write and Git command. */
    enabled?: boolean;
    /** Repository directory; the machine-local file wins over this value. */
    dir?: string;
    /** Minutes between automatic exports (default 5). */
    intervalMinutes?: number;
    /** Commit a changed snapshot (default true). */
    autoCommit?: boolean;
    /** Push after a commit when a remote is configured (default true). */
    autoPush?: boolean;
    /** Carry the operational history section (default false). */
    includeHistory?: boolean;
    /** Carry attachment rows and bytes (default false). */
    includeAttachments?: boolean;
    /**
     * Report an empty memory server so the manual restore path stays discoverable
     * (default false). Informational only: it never imports; `restore-hindsight.ps1` does.
     */
    importOnEmpty?: boolean;
}
/** Machine-local overrides: the target directory and remote never enter a tracked file. */
export interface MachineExportConfig extends ExportConfig {
    /** Private Git remote; the only place a remote is configured. */
    remote?: string;
}
/** Fully resolved export settings; the exporter never runs on partial values. */
export interface ResolvedExportConfig {
    readonly enabled: boolean;
    readonly dir: string;
    readonly remote?: string;
    readonly intervalMinutes: number;
    readonly autoCommit: boolean;
    readonly autoPush: boolean;
    readonly includeHistory: boolean;
    readonly includeAttachments: boolean;
    readonly importOnEmpty: boolean;
}
/** Documented defaults: on, every five minutes, no history, no attachments. */
export declare const DEFAULT_EXPORT_CONFIG: Readonly<{
    enabled: true;
    intervalMinutes: 5;
    autoCommit: true;
    autoPush: true;
    includeHistory: false;
    includeAttachments: false;
    importOnEmpty: false;
}>;
/** Name of the machine-local export file inside the Harness home. */
export declare const EXPORT_CONFIG_FILE = "hindsight-export.json";
/** The Harness home; a throwaway `DSH_HOME` keeps tests off the live profile. */
export declare function dshHome(): string;
/** Path of the machine-local file; `HINDSIGHT_EXPORT_CONFIG` overrides it like the upstream config. */
export declare function machineExportConfigPath(): string;
/** Read the machine-local file; invalid or missing content means no overrides. */
export declare function readMachineExportConfig(path?: string): MachineExportConfig;
/** The machine-local file outranks the row, which outranks the defaults. */
export declare function resolveExportConfig(config?: ExportConfig, machine?: MachineExportConfig, home?: string): ResolvedExportConfig;
/**
 * Whether a directory sits inside the Harness home or the Hindsight database
 * root. Both were wiped together once, so an export there proves nothing.
 */
export declare function isForbiddenExportDir(dir: string, home?: string): boolean;
