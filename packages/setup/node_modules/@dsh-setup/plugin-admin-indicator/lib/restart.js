import { spawn } from 'node:child_process';
import { isDesktopExecutable, isDesktopHost } from './elevation.js';
const WINDOWS_POWERSHELL = 'powershell.exe';
function psLiteral(value) {
    return `'${value.replaceAll("'", "''")}'`;
}
/**
 * The elevated close-and-start payload.
 *
 * The Host is spawned by the Electron main, so its parent PID is the owning
 * Desktop root; the payload acts only on that process tree and never walks
 * above it. It runs elevated, so it can close the standard app and start the
 * replacement without another UAC prompt.
 */
export function buildRestartPayload(execPath, rootPid) {
    return [
        "$ErrorActionPreference = 'SilentlyContinue'",
        'Start-Sleep -Milliseconds 500',
        `$rootPid = ${Math.trunc(rootPid)}`,
        '$tree = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)',
        '$ids = New-Object System.Collections.Generic.List[int]',
        '$ids.Add($rootPid)',
        '$changed = $true',
        'while ($changed) {',
        '  $changed = $false',
        '  foreach ($entry in $tree) {',
        '    $childId = [int]$entry.ProcessId',
        '    $parentId = [int]$entry.ParentProcessId',
        '    if (-not $ids.Contains($childId) -and $ids.Contains($parentId)) {',
        '      $ids.Add($childId)',
        '      $changed = $true',
        '    }',
        '  }',
        '}',
        '# The payload is not in the Desktop job; never kill the process that starts the elevated app.',
        '[void]$ids.Remove($PID)',
        'foreach ($id in $ids) {',
        '  $process = Get-Process -Id $id -ErrorAction SilentlyContinue',
        '  if ($process -and $process.MainWindowHandle -ne 0) { $process.CloseMainWindow() | Out-Null }',
        '}',
        '$deadline = (Get-Date).AddSeconds(2)',
        'while ((Get-Date) -lt $deadline) {',
        '  $alive = @($ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })',
        '  if ($alive.Count -eq 0) { break }',
        '  Start-Sleep -Milliseconds 200',
        '}',
        'foreach ($id in $ids) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue }',
        'Start-Sleep -Milliseconds 300',
        `Start-Process -FilePath ${psLiteral(execPath)}`,
    ].join('\n');
}
/**
 * The fixed UAC-first launcher.
 *
 * The launcher is spawned detached by the standard Host, but it only asks for
 * UAC and starts the elevated payload. UAC creates the payload outside the
 * Desktop job, so the app can be killed by the payload without killing the
 * process that is about to start the replacement. Declining UAC leaves the
 * current app running.
 */
export function buildRestartScript(execPath, rootPid) {
    const payload = Buffer.from(buildRestartPayload(execPath, rootPid), 'utf16le').toString('base64');
    return [
        "$ErrorActionPreference = 'SilentlyContinue'",
        `$payload = '${payload}'`,
        "Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList '-NoProfile','-WindowStyle','Hidden','-EncodedCommand',$payload",
    ].join('\n');
}
/** Spawn the fixed detached restart; Windows Desktop only. */
export function restartAsAdministrator(execPath, platform, argv = process.argv, rootPid = process.ppid > 0 ? process.ppid : process.pid) {
    if (!isDesktopExecutable(execPath, platform) || !isDesktopHost(argv)) {
        return Promise.reject(new Error('The administrator restart is available only from the DeepSeek Harness Desktop app.'));
    }
    const encoded = Buffer.from(buildRestartScript(execPath, rootPid), 'utf16le').toString('base64');
    return new Promise((resolve, reject) => {
        const child = spawn(WINDOWS_POWERSHELL, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore', windowsHide: true });
        const cleanup = () => {
            child.off('error', onError);
            child.off('spawn', onSpawn);
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onSpawn = () => {
            cleanup();
            child.unref();
            resolve();
        };
        child.once('error', onError);
        child.once('spawn', onSpawn);
    });
}
