import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { validateExportConfig, validateHindsightPin } from '../lib/hindsight.ts'
import { readRepositoryFiles, scanMachinePaths, scanSecrets } from '../lib/scan.ts'
import { rootDir } from '../lib/workspace.ts'

describe('Hindsight pin', () => {
  it('accepts one exact version in all three declarations', () => {
    expect(validateHindsightPin('0.8.2', '0.8.2', '0.8.2')).toEqual([])
  })

  it('rejects a range', () => {
    expect(validateHindsightPin('^0.8.2', '^0.8.2', '^0.8.2')).toEqual([
      'plugin version "^0.8.2" is not an exact version',
      'root version "^0.8.2" is not an exact version',
      'setup version "^0.8.2" is not an exact version',
    ])
  })

  it('rejects the latest tag', () => {
    expect(validateHindsightPin('latest', 'latest', 'latest')).toEqual([
      'plugin version "latest" is not an exact version',
      'root version "latest" is not an exact version',
      'setup version "latest" is not an exact version',
    ])
  })

  it('rejects null declarations', () => {
    const nullVersion = null as unknown as string
    expect(validateHindsightPin(nullVersion, nullVersion, nullVersion)).toEqual([
      'plugin is missing @vectorize-io/hindsight-coding-agents',
      'root is missing @vectorize-io/hindsight-coding-agents',
      'setup is missing @vectorize-io/hindsight-coding-agents',
    ])
  })

  it('rejects a mutable tag disguised as a prerelease', () => {
    expect(
      validateHindsightPin('0.8.2-preview..1', '0.8.2-preview..1', '0.8.2-preview..1'),
    ).toEqual([
      'plugin version "0.8.2-preview..1" is not an exact version',
      'root version "0.8.2-preview..1" is not an exact version',
      'setup version "0.8.2-preview..1" is not an exact version',
    ])
  })

  it('rejects a mismatched exact version', () => {
    expect(validateHindsightPin('0.8.2', '0.8.2', '0.8.1')).toEqual([
      'plugin, root, and setup versions differ (plugin=0.8.2, root=0.8.2, setup=0.8.1)',
    ])
  })

  it('reports a missing declaration', () => {
    expect(validateHindsightPin('0.8.2', undefined, '0.8.2')).toEqual([
      'root is missing @vectorize-io/hindsight-coding-agents',
    ])
  })
})

// Compose machine-path fixtures at runtime so the repository scan never finds them.
const WINDOWS_PATH = ['C', ':', '\\', 'Users', '\\', 'someone', '\\', 'hindsight-export'].join('')
const POSIX_HOME_PATH = ['/', 'home', '/', 'someone', '/', 'hindsight-export'].join('')

function scanFile(path: string, content: string) {
  return { path, content }
}

describe('export configuration boundary', () => {
  it('rejects a machine-local directory or remote in tracked configuration', () => {
    expect(
      validateExportConfig(
        { export: { enabled: true, dir: WINDOWS_PATH } },
        'packages/plugin-hindsight/cordis.fragment.yml',
      ),
    ).toEqual([
      'packages/plugin-hindsight/cordis.fragment.yml: export.dir is machine-local and must not be tracked',
    ])
    expect(
      validateExportConfig(
        { export: { remote: 'https://git.example.invalid/private.git' } },
        'packages/setup/defaults.yml',
      ),
    ).toEqual([
      'packages/setup/defaults.yml: export.remote is machine-local and must not be tracked',
    ])
    expect(
      validateExportConfig({ export: { enabled: true, intervalMinutes: 5 } }, 'defaults.yml'),
    ).toEqual([])
    expect(validateExportConfig(undefined, 'defaults.yml')).toEqual([])
    expect(validateExportConfig({}, 'defaults.yml')).toEqual([])
  })

  it('rejects a credential file or machine path in reviewed sources', () => {
    expect(scanMachinePaths([scanFile('docs/hindsight.md', `dir: ${WINDOWS_PATH}`)])).toHaveLength(
      1,
    )
    expect(
      scanMachinePaths([scanFile('packages/setup/defaults.yml', `dir: ${POSIX_HOME_PATH}`)]),
    ).toHaveLength(1)
    expect(
      scanSecrets([scanFile('.dsh/.credentials.yaml', 'remote: https://example.invalid/x.git')]),
    ).toHaveLength(1)
  })

  it('finds no export remote, credential, or machine path in the repository', () => {
    const files = readRepositoryFiles()
    expect(files.length).toBeGreaterThan(0)
    expect(scanMachinePaths(files)).toEqual([])
    expect(scanSecrets(files)).toEqual([])
  })

  it('accepts the shipped export block and rejects a machine-local key added to it', () => {
    const fragment = parse(
      readFileSync(join(rootDir, 'packages/plugin-hindsight/cordis.fragment.yml'), 'utf8'),
    ) as { rows: Array<{ id: string; config?: unknown }> }
    const row = fragment.rows.find((entry) => entry.id === 'dsh-setup-hindsight')
    expect(row).toBeDefined()
    expect(
      validateExportConfig(row?.config, 'packages/plugin-hindsight/cordis.fragment.yml'),
    ).toEqual([])
    const exportBlock = (row as { config: { export: Record<string, unknown> } }).config.export
    expect(exportBlock.enabled).toBe(true)
    expect(Object.keys(exportBlock)).not.toContain('dir')
    expect(Object.keys(exportBlock)).not.toContain('remote')

    const defaults = parse(
      readFileSync(join(rootDir, 'packages/setup/defaults.yml'), 'utf8'),
    ) as Array<{
      id: string
      config?: unknown
    }>
    const setupRow = defaults.find((entry) => entry.id === 'dsh-setup-hindsight')
    expect(setupRow).toBeDefined()
    expect(validateExportConfig(setupRow?.config, 'packages/setup/defaults.yml')).toEqual([])
    expect(
      validateExportConfig(
        { export: { ...exportBlock, dir: WINDOWS_PATH } },
        'packages/setup/defaults.yml',
      ),
    ).toHaveLength(1)

    // The generated setup patch is what a profile actually composes.
    const patch = parse(
      readFileSync(join(rootDir, 'packages/setup/cordis.patch.yml'), 'utf8'),
    ) as Array<{ insert?: Array<{ id: string; config?: unknown }>; id?: string; config?: unknown }>
    const inserted = patch.find((entry) => Array.isArray(entry.insert))
    const generatedRow = inserted?.insert?.find((entry) => entry.id === 'dsh-setup-hindsight')
    expect(generatedRow).toBeDefined()
    expect(validateExportConfig(generatedRow?.config, 'packages/setup/cordis.patch.yml')).toEqual(
      [],
    )
    expect(
      validateExportConfig(
        (generatedRow as { config: Record<string, unknown> }).config,
        'packages/setup/cordis.patch.yml',
      ),
    ).toEqual([])
    const generatedDefaults = patch.find((entry) => entry.id === 'dsh-setup-hindsight')
    expect(generatedDefaults).toBeDefined()
    expect(
      validateExportConfig(generatedDefaults?.config, 'packages/setup/cordis.patch.yml'),
    ).toEqual([])
  })

  it('takes the directory and remote only from the machine-local file', async () => {
    const entry = join(
      rootDir,
      'packages/setup/node_modules/@dsh-setup/plugin-hindsight/lib/index.js',
    )
    const module = (await import(pathToFileURL(entry).href)) as {
      resolveExportConfig: (
        config: unknown,
        machine: unknown,
        home: string,
      ) => { dir: string; remote?: string; enabled: boolean }
    }
    const home = mkdtempSync(join(tmpdir(), 'hindsight-export-boundary-'))
    try {
      const machineDir = join(home, 'private-repo')
      const resolved = module.resolveExportConfig(
        { dir: join(home, 'row-dir'), remote: 'https://row.invalid/x.git' },
        { dir: machineDir, remote: 'https://machine.invalid/x.git' },
        home,
      )
      expect(resolved.dir).toBe(machineDir)
      expect(resolved.remote).toBe('https://machine.invalid/x.git')
      const disabled = module.resolveExportConfig({ enabled: false }, {}, home)
      expect(disabled.enabled).toBe(false)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
