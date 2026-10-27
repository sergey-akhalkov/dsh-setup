import { execFile } from 'node:child_process';
import { basename } from 'node:path';
/**
 * Read the mandatory-label SID from `whoami /groups` output.
 *
 * High (S-1-16-12288) and System (S-1-16-16384) are the administrator levels;
 * the untrusted, low, and medium labels are standard. The label text is
 * localized, the SID is not. Missing or unrecognized output is unknown, never
 * a false standard result.
 */
export function parseElevation(output) {
    if (/S-1-16-(?:12288|16384)\b/u.test(output))
        return 'administrator';
    if (/S-1-16-(?:0|4096|8192)\b/u.test(output))
        return 'standard';
    return 'unknown';
}
/** Inspect the current Host process token once; never rejects. */
export function detectElevation() {
    if (process.platform !== 'win32')
        return Promise.resolve('unknown');
    return new Promise((resolve) => {
        execFile('whoami.exe', ['/groups'], { encoding: 'utf8', windowsHide: true, timeout: 5_000 }, (error, stdout) => {
            resolve(error === null ? parseElevation(stdout) : 'unknown');
        });
    });
}
/** Cache the process-lifetime elevation result behind one shared promise. */
export function createStatusCache(detect) {
    let pending;
    return () => {
        pending ??= detect();
        return pending;
    };
}
/** True when the running executable is the DeepSeek Harness Desktop app. */
export function isDesktopExecutable(execPath, platform) {
    return platform === 'win32' && basename(execPath).toLowerCase() === 'deepseek harness.exe';
}
/**
 * True when this Host is the Electron-owned Desktop Host, not the bundled CLI.
 *
 * The installed `dsh.cmd` also launches `DeepSeek Harness.exe` in Node mode for
 * a Web profile; only the Desktop shell spawns the `dsh-desktop-host` entry.
 */
export function isDesktopHost(argv) {
    return argv.some((value) => /[\\/]dsh-desktop-host[\\/]lib[\\/]index\.js$/u.test(value));
}
