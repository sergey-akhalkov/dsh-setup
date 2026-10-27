import { describe, expect, it } from 'vitest'
import { buildRestartPayload, buildRestartScript, restartAsAdministrator } from '../lib/restart.js'

const WIN = String.fromCharCode(92)
const APP = ['C:', 'Apps', 'DeepSeek Harness.exe'].join(WIN)
const NODE = ['C:', 'Apps', 'node.exe'].join(WIN)

describe('admin indicator restart action', () => {
  it('builds the elevated close-and-start payload for the owning process tree', () => {
    const payload = buildRestartPayload(APP, 4242)
    expect(payload).toContain(APP)
    expect(payload).toContain('$rootPid = 4242')
    expect(payload).not.toContain('$hostPid')
    expect(payload).not.toContain('for ($depth')
    expect(payload).not.toContain('$current')
    expect(payload).toContain('Get-CimInstance Win32_Process')
    expect(payload).toContain('ParentProcessId')
    expect(payload).toContain('[void]$ids.Remove($PID)')
    expect(payload).toContain('CloseMainWindow')
    expect(payload).toContain('Stop-Process')
    expect(payload).toContain('Start-Process -FilePath')
    expect(payload).not.toContain('-Verb RunAs')
    expect(payload).toContain('AddSeconds(2)')
    expect(payload).not.toContain('AddSeconds(15)')
    expect(payload).not.toContain("Get-Process -Name 'DeepSeek Harness'")
  })

  it('builds a UAC-first launcher around the elevated payload', () => {
    const script = buildRestartScript(APP, 4242)
    expect(script).toContain('-Verb RunAs')
    expect(script).toContain('-EncodedCommand')
    expect(script).toContain('$payload')
    expect(script).not.toContain('$rootPid')
  })

  it('refuses a restart from a non-Desktop executable', async () => {
    await expect(restartAsAdministrator(NODE, 'win32')).rejects.toThrow(/Desktop app/u)
  })
})
