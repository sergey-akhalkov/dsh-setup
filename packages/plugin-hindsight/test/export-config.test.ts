import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isForbiddenExportDir,
  machineExportConfigPath,
  readMachineExportConfig,
  resolveExportConfig,
} from '../lib/index.js'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hindsight-export-config-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('export configuration', () => {
  it('defaults to enabled, five minutes, and a target outside the DSH home', () => {
    const home = tempDir()
    const resolved = resolveExportConfig({}, {}, home)
    expect(resolved.enabled).toBe(true)
    expect(resolved.dir).toBe(join(home, 'hindsight-export'))
    expect(resolved.intervalMinutes).toBe(5)
    expect(resolved.autoCommit).toBe(true)
    expect(resolved.autoPush).toBe(true)
    expect(resolved.includeHistory).toBe(false)
    expect(resolved.includeAttachments).toBe(false)
    expect(resolved.importOnEmpty).toBe(false)
    expect(resolved.remote).toBeUndefined()
    expect(isForbiddenExportDir(resolved.dir, home)).toBe(false)
  })

  it('stops on an explicit disable from the row or the machine-local file', () => {
    const home = tempDir()
    expect(resolveExportConfig({ enabled: false }, {}, home).enabled).toBe(false)
    expect(resolveExportConfig({ enabled: true }, { enabled: false }, home).enabled).toBe(false)
    expect(resolveExportConfig({ enabled: false }, { enabled: true }, home).enabled).toBe(true)
  })

  it('lets the machine-local file win for the directory, remote, and flags', () => {
    const home = tempDir()
    const machineDir = join(home, 'machine-repo')
    const resolved = resolveExportConfig(
      {
        dir: join(home, 'row-repo'),
        intervalMinutes: 30,
        includeHistory: false,
        includeAttachments: false,
      },
      {
        dir: machineDir,
        remote: 'https://git.example.invalid/private/hindsight-export.git',
        intervalMinutes: 1,
        includeHistory: true,
        includeAttachments: true,
      },
      home,
    )
    expect(resolved.dir).toBe(machineDir)
    expect(resolved.remote).toBe('https://git.example.invalid/private/hindsight-export.git')
    expect(resolved.intervalMinutes).toBe(1)
    expect(resolved.includeHistory).toBe(true)
    expect(resolved.includeAttachments).toBe(true)
  })

  it('ignores a remote declared in the row configuration', () => {
    const home = tempDir()
    const row = { remote: 'https://git.example.invalid/private/hindsight-export.git' } as never
    expect(resolveExportConfig(row, {}, home).remote).toBeUndefined()
  })

  it('rejects an interval that is not a positive finite number', () => {
    const home = tempDir()
    expect(resolveExportConfig({ intervalMinutes: 0 }, {}, home).intervalMinutes).toBe(5)
    expect(resolveExportConfig({ intervalMinutes: -3 }, {}, home).intervalMinutes).toBe(5)
    expect(resolveExportConfig({ intervalMinutes: Number.NaN }, {}, home).intervalMinutes).toBe(5)
    expect(
      resolveExportConfig({}, { intervalMinutes: 'soon' as never }, home).intervalMinutes,
    ).toBe(5)
  })

  it('reads the machine-local file and treats invalid content as no overrides', () => {
    const dir = tempDir()
    const path = join(dir, 'hindsight-export.json')
    writeFileSync(
      path,
      JSON.stringify({ dir: join(dir, 'repo'), remote: 'https://x.invalid/x.git' }),
    )
    expect(readMachineExportConfig(path)).toEqual({
      dir: join(dir, 'repo'),
      remote: 'https://x.invalid/x.git',
    })

    writeFileSync(path, '[]')
    expect(readMachineExportConfig(path)).toEqual({})
    writeFileSync(path, '{not json')
    expect(readMachineExportConfig(path)).toEqual({})
    expect(readMachineExportConfig(join(dir, 'missing.json'))).toEqual({})
  })

  it('places the machine-local file under the Harness home by default', () => {
    const original = process.env.DSH_HOME
    const originalFile = process.env.HINDSIGHT_EXPORT_CONFIG
    delete process.env.HINDSIGHT_EXPORT_CONFIG
    try {
      process.env.DSH_HOME = join(tempDir(), 'throwaway-home')
      expect(machineExportConfigPath()).toBe(join(process.env.DSH_HOME, 'hindsight-export.json'))
      process.env.HINDSIGHT_EXPORT_CONFIG = join(tempDir(), 'override.json')
      expect(machineExportConfigPath()).toBe(process.env.HINDSIGHT_EXPORT_CONFIG)
    } finally {
      if (original === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = original
      if (originalFile === undefined) delete process.env.HINDSIGHT_EXPORT_CONFIG
      else process.env.HINDSIGHT_EXPORT_CONFIG = originalFile
    }
    expect(machineExportConfigPath()).toBe(
      process.env.DSH_HOME === undefined
        ? join(homedir(), '.dsh', 'hindsight-export.json')
        : join(process.env.DSH_HOME, 'hindsight-export.json'),
    )
  })

  it('treats the DSH home and the Hindsight database root as forbidden targets', () => {
    const home = tempDir()
    const original = process.env.DSH_HOME
    delete process.env.DSH_HOME
    try {
      expect(isForbiddenExportDir(join(home, '.dsh'), home)).toBe(true)
      expect(isForbiddenExportDir(join(home, '.dsh', 'export'), home)).toBe(true)
      expect(isForbiddenExportDir(join(home, '.pg0', 'instances', 'export'), home)).toBe(true)
      expect(isForbiddenExportDir(join(home, 'hindsight-export'), home)).toBe(false)
      expect(isForbiddenExportDir(join(home, 'hindsight-export-backup'), home)).toBe(false)
      process.env.DSH_HOME = join(home, 'elsewhere', 'home')
      expect(isForbiddenExportDir(join(home, 'elsewhere', 'home', 'export'), home)).toBe(true)
    } finally {
      if (original === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = original
    }
  })
})
