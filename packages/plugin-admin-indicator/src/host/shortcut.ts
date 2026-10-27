import { execFile } from 'node:child_process'
import { dirname } from 'node:path'
import { isDesktopExecutable, isDesktopHost } from './elevation.js'

/** Fixed shortcut name shared with the installer. */
export const SHORTCUT_NAME = 'DeepSeek Harness (Administrator)'

const SHORTCUT_FILE = `${SHORTCUT_NAME}.lnk`
const WINDOWS_POWERSHELL = 'powershell.exe'

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Build the PowerShell that writes the fixed launcher.
 *
 * The shortcut target is Windows PowerShell, which starts the installed app
 * with `Start-Process -Verb RunAs`; the app itself is never restarted or
 * elevated by this process.
 */
export function buildShortcutScript(execPath: string): string {
  const launcher = `-NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath ${psLiteral(execPath)} -Verb RunAs"`
  return [
    "$ErrorActionPreference = 'Stop'",
    "$desktop = [Environment]::GetFolderPath('Desktop')",
    `$link = Join-Path $desktop ${psLiteral(SHORTCUT_FILE)}`,
    '$shell = New-Object -ComObject WScript.Shell',
    '$shortcut = $shell.CreateShortcut($link)',
    "$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\\WindowsPowerShell\\v1.0\\powershell.exe'",
    `$shortcut.Arguments = ${psLiteral(launcher)}`,
    `$shortcut.WorkingDirectory = ${psLiteral(dirname(execPath))}`,
    `$shortcut.IconLocation = ${psLiteral(`${execPath},0`)}`,
    '$shortcut.Save()',
    '[Console]::Out.Write($link)',
  ].join('\n')
}

/**
 * Authorize the read-only status request from the app's own origin or the
 * Desktop shell's authenticated forwarded request. A foreign origin is rejected.
 */
export function isAuthorizedStatusRequest(
  origin: string | undefined,
  cookie: string | undefined,
  serverOrigin: string,
): boolean {
  if (origin === serverOrigin) return true
  if (origin !== undefined) return false
  return cookie !== undefined && cookie.length > 0
}

/** Create or replace the fixed administrator shortcut; Windows Desktop only. */
export function createDesktopShortcut(
  execPath: string,
  platform: NodeJS.Platform,
  argv: readonly string[] = process.argv,
): Promise<{ linkPath: string }> {
  if (!isDesktopExecutable(execPath, platform) || !isDesktopHost(argv)) {
    return Promise.reject(
      new Error('This action is available only from the DeepSeek Harness Desktop app.'),
    )
  }
  const script = buildShortcutScript(execPath)
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      WINDOWS_POWERSHELL,
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }
        resolve({ linkPath: stdout.trim() })
      },
    )
  })
}
