import { describe, expect, it } from 'vitest'
import { validatePackageManifest } from '../lib/manifest.ts'
import type { PackageManifest } from '../lib/workspace.ts'

function manifest(overrides: Partial<PackageManifest> = {}): PackageManifest {
  return {
    name: '@dsh-setup/plugin-composer-clock',
    version: '0.1.0',
    engines: { dsh: '>=0.2.1-rc.3 <0.3.0' },
    exports: { './client': './lib/client.js' },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      client: { platform: 'web' },
    },
    ...overrides,
  }
}

describe('validatePackageManifest', () => {
  it('accepts the repository package shape', () => {
    expect(validatePackageManifest(manifest(), '>=0.2.1-rc.3 <0.3.0')).toEqual([])
  })

  it('rejects a missing engines.dsh range', () => {
    expect(validatePackageManifest(manifest({ engines: {} }))).toContain(
      'missing engines.dsh range',
    )
  })

  it('rejects an engines.dsh range that differs from dsh.json', () => {
    expect(validatePackageManifest(manifest(), '>=0.3.0 <0.4.0')).toEqual([
      'engines.dsh ">=0.2.1-rc.3 <0.3.0" does not match dsh.json ">=0.3.0 <0.4.0"',
    ])
  })

  it('rejects a missing bundle patch', () => {
    expect(validatePackageManifest(manifest({ dsh: { client: { platform: 'web' } } }))).toContain(
      'missing dsh.bundle.patch',
    )
  })

  it('rejects a Client half without a declared client export', () => {
    expect(validatePackageManifest(manifest({ exports: {} }))).toContain(
      'dsh.client is declared but exports["./client"] is missing',
    )
  })

  it('rejects every install-time build script', () => {
    const scripts = {
      prepare: 'pnpm build',
      preinstall: 'node setup.js',
      install: 'node install.js',
      postinstall: 'node post.js',
    }
    expect(validatePackageManifest(manifest({ scripts }))).toEqual([
      'install-time script "prepare" is not allowed',
      'install-time script "preinstall" is not allowed',
      'install-time script "install" is not allowed',
      'install-time script "postinstall" is not allowed',
    ])
  })
})
