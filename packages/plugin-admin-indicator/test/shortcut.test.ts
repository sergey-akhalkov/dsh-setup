import { describe, expect, it } from 'vitest'
import {
  buildShortcutScript,
  createDesktopShortcut,
  isAuthorizedStatusRequest,
  SHORTCUT_NAME,
} from '../lib/shortcut.js'

const WIN = String.fromCharCode(92)
const APP = ['C:', 'Apps', 'DeepSeek Harness.exe'].join(WIN)
const NODE = ['C:', 'Apps', 'node.exe'].join(WIN)

describe('admin indicator shortcut action', () => {
  it('names the fixed shortcut and targets Windows PowerShell with UAC', () => {
    const script = buildShortcutScript(APP)
    expect(SHORTCUT_NAME).toBe('DeepSeek Harness (Administrator)')
    expect(script).toContain(`${SHORTCUT_NAME}.lnk`)
    expect(script).toContain('WScript.Shell')
    expect(script).toContain('Start-Process -FilePath')
    expect(script).toContain('-Verb RunAs')
    expect(script).toContain(APP)
    expect(script).toContain('System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })

  it('refuses to create a shortcut from a non-Desktop executable', async () => {
    await expect(createDesktopShortcut(NODE, 'win32')).rejects.toThrow(/Desktop app/u)
  })

  it('accepts the status request from the app origin or the Desktop forward', () => {
    const server = 'http://127.0.0.1:1234'
    expect(isAuthorizedStatusRequest(server, undefined, server)).toBe(true)
    expect(isAuthorizedStatusRequest(undefined, 'dsh-auth=test', server)).toBe(true)
    expect(isAuthorizedStatusRequest(undefined, undefined, server)).toBe(false)
    expect(isAuthorizedStatusRequest('http://127.0.0.1:1235', 'dsh-auth=test', server)).toBe(false)
  })
})
