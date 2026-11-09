/**
 * The deterministic shell command parser for the two OpenSpec actions the
 * workflow gates enforce. It accepts only the three documented invocation
 * forms and a single validated change name; a compound command, extra token,
 * shell control character, or unparseable name is not matched. The archive gate
 * and the file watcher are the backstop for a bypass, not this parser.
 */
export type OpenspecIntent = {
    readonly kind: 'create-change';
    readonly name: string;
} | {
    readonly kind: 'archive';
    readonly change: string;
};
/** A change name as the interpolation and draft path rules require it. */
export declare const CHANGE_NAME: RegExp;
/**
 * Parse one shell command. Returns undefined for anything that is not exactly
 * one documented, unquoted-name `openspec new change` or `openspec archive`.
 */
export declare function parseOpenspecCommand(command: string): OpenspecIntent | undefined;
export interface ArchiveIntent {
    readonly kind: 'archive';
    readonly change: string;
    readonly form: 'openspec' | 'mv' | 'Move-Item' | 'git';
    /** A move of more than one change; the host refuses it rather than authorizing each. */
    readonly multipleSources?: true;
}
/** The archive directory a move must target. */
export declare const ARCHIVE_DIR = "openspec/changes/archive";
export declare function parseArchiveCommand(command: string, workspace?: string, workdir?: string): ArchiveIntent | undefined;
