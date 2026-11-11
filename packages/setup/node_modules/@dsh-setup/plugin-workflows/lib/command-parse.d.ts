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
/**
 * Normalize one command for a `match.command` template: trim, collapse
 * whitespace, and strip one documented `rtk` or `pnpm exec` invocation prefix.
 * A compound command, a shell control, a backslash, or a substitution returns
 * undefined and never matches; the archive gate re-parses its own exceptions.
 */
export declare function normalizeCommand(command: string): string | undefined;
/** One template match: the captured name when the template declares a capture. */
export interface TriggerCapture {
    readonly capture?: string;
}
/**
 * Match one normalized command against a `match.command` template. A template
 * with `{name}` matches its literal prefix and suffix and captures one
 * unquoted, validated change name; a template without a capture is compared
 * literally and behaves as before.
 */
export declare function matchCommandTemplate(template: string, command: string): TriggerCapture | undefined;
/**
 * Match one workspace path against a `match.path` glob. The single `{name}`
 * segment captures one validated change name; every other segment keeps the
 * existing glob syntax.
 */
export declare function matchPathTemplate(pattern: string, path: string): TriggerCapture | undefined;
/** The archive directory a move must target. */
export declare const ARCHIVE_DIR = "openspec/changes/archive";
export declare function parseArchiveCommand(command: string, workspace?: string, workdir?: string): ArchiveIntent | undefined;
