/**
 * The elevated close-and-start payload.
 *
 * The Host is spawned by the Electron main, so its parent PID is the owning
 * Desktop root; the payload acts only on that process tree and never walks
 * above it. It runs elevated, so it can close the standard app and start the
 * replacement without another UAC prompt.
 */
export declare function buildRestartPayload(execPath: string, rootPid: number): string;
/**
 * The fixed UAC-first launcher.
 *
 * The launcher is spawned detached by the standard Host, but it only asks for
 * UAC and starts the elevated payload. UAC creates the payload outside the
 * Desktop job, so the app can be killed by the payload without killing the
 * process that is about to start the replacement. Declining UAC leaves the
 * current app running.
 */
export declare function buildRestartScript(execPath: string, rootPid: number): string;
/** Spawn the fixed detached restart; Windows Desktop only. */
export declare function restartAsAdministrator(execPath: string, platform: NodeJS.Platform, argv?: readonly string[], rootPid?: number): Promise<void>;
