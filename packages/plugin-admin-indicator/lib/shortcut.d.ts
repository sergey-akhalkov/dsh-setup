/** Fixed shortcut name shared with the installer. */
export declare const SHORTCUT_NAME = "DeepSeek Harness (Administrator)";
/**
 * Build the PowerShell that writes the fixed launcher.
 *
 * The shortcut target is Windows PowerShell, which starts the installed app
 * with `Start-Process -Verb RunAs`; the app itself is never restarted or
 * elevated by this process.
 */
export declare function buildShortcutScript(execPath: string): string;
/**
 * Authorize the read-only status request from the app's own origin or the
 * Desktop shell's authenticated forwarded request. A foreign origin is rejected.
 */
export declare function isAuthorizedStatusRequest(origin: string | undefined, cookie: string | undefined, serverOrigin: string): boolean;
/** Create or replace the fixed administrator shortcut; Windows Desktop only. */
export declare function createDesktopShortcut(execPath: string, platform: NodeJS.Platform, argv?: readonly string[]): Promise<{
    linkPath: string;
}>;
