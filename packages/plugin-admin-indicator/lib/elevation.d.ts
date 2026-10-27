/** Result of inspecting the running Host process token. */
export type ElevationState = 'administrator' | 'standard' | 'unknown';
/**
 * Read the mandatory-label SID from `whoami /groups` output.
 *
 * High (S-1-16-12288) and System (S-1-16-16384) are the administrator levels;
 * the untrusted, low, and medium labels are standard. The label text is
 * localized, the SID is not. Missing or unrecognized output is unknown, never
 * a false standard result.
 */
export declare function parseElevation(output: string): ElevationState;
/** Inspect the current Host process token once; never rejects. */
export declare function detectElevation(): Promise<ElevationState>;
/** Cache the process-lifetime elevation result behind one shared promise. */
export declare function createStatusCache(detect: () => Promise<ElevationState>): () => Promise<ElevationState>;
/** True when the running executable is the DeepSeek Harness Desktop app. */
export declare function isDesktopExecutable(execPath: string, platform: NodeJS.Platform): boolean;
/**
 * True when this Host is the Electron-owned Desktop Host, not the bundled CLI.
 *
 * The installed `dsh.cmd` also launches `DeepSeek Harness.exe` in Node mode for
 * a Web profile; only the Desktop shell spawns the `dsh-desktop-host` entry.
 */
export declare function isDesktopHost(argv: readonly string[]): boolean;
