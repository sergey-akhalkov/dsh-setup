import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildSetupManifest,
  computeGenerated,
  diffGenerated,
  parseDefaults,
  renderBundlePatch,
  renderSetupPatch,
  SETUP_PATCH_FILE,
  validateSetupManifest,
} from '../lib/generate.ts'
import { validatePackageManifest } from '../lib/manifest.ts'
import type { DshVersions, PackageManifest, WorkspacePackage } from '../lib/workspace.ts'

const VERSIONS: DshVersions = {
  runtime: '0.2.1-rc.3',
  enginesDsh: '>=0.2.1-rc.3 <0.3.0',
  supportedVersions: ['0.2.1-rc.3'],
  repository: 'https://github.com/example/dsh-setup',
  installBundles: {
    shipped: ['@deepseek-ai/dsh-experimental-agent-team-profile'],
    registry: ['@deepseek-ai/dsh-subagent-codex'],
  },
}

const DEFAULTS = [
  {
    id: 'agent-default-model',
    config: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  },
  { id: 'ui-theme', config: { preference: 'dark' } },
]

function plugin(
  name: string,
  version = '0.1.0',
  dependencies?: Record<string, string>,
): PackageManifest {
  return {
    name,
    version,
    engines: { dsh: VERSIONS.enginesDsh },
    exports: { './client': './lib/client.js' },
    ...(dependencies === undefined ? {} : { dependencies }),
    dsh: { bundle: { patch: './cordis.patch.yml' }, client: { platform: 'web' } },
  }
}

/** One synthetic workspace package for the adapter-row generation cases. */
function workspacePackage(
  name: string,
  overrides: Partial<PackageManifest> = {},
): WorkspacePackage {
  const slug = name.replace('@dsh-setup/', '')
  return {
    dir: `packages/${slug}`,
    relativeDir: `packages/${slug}`,
    manifest: {
      name,
      version: '0.1.0',
      engines: { dsh: VERSIONS.enginesDsh },
      ...overrides,
      dsh: { bundle: { patch: './cordis.patch.yml' }, ...(overrides.dsh ?? {}) },
    },
  }
}

const ADAPTER_ROWS = [{ id: 'dsh-setup-adapter', name: '@deepseek-ai/dsh-mcp-client' }]

describe('defaults', () => {
  it('parses id and complete config pairs', () => {
    expect(
      parseDefaults('- id: agent-default-model\n  config:\n    model: deepseek-flash\n'),
    ).toEqual([{ id: 'agent-default-model', config: { model: 'deepseek-flash' } }])
  })

  it('rejects an unknown field', () => {
    expect(() => parseDefaults('- id: ui-theme\n  config: {}\n  name: x\n')).toThrow(
      /unknown field "name"/,
    )
  })

  it('rejects the reserved plugin row prefix', () => {
    expect(() => parseDefaults('- id: dsh-setup-example\n  config: {}\n')).toThrow(
      /reserved plugin row prefix/,
    )
  })

  it('rejects a duplicate id', () => {
    expect(() =>
      parseDefaults('- id: ui-theme\n  config: {}\n- id: ui-theme\n  config: {}\n'),
    ).toThrow(/not unique/)
  })

  it('rejects a missing config', () => {
    expect(() => parseDefaults('- id: ui-theme\n')).toThrow(/config must be a mapping/)
  })
})

describe('patch rendering', () => {
  it('renders a plugin bundle patch that mounts the package row', () => {
    const patch = renderBundlePatch([{ id: 'dsh-setup-a', name: '@dsh-setup/plugin-a' }])
    expect(patch).toContain('- insert:')
    expect(patch).toContain('id: dsh-setup-a')
    expect(patch).toContain('@dsh-setup/plugin-a')
    expect(patch).toContain('do not edit')
  })

  it('renders the setup patch with every row and complete defaults', () => {
    const patch = renderSetupPatch(
      [
        { id: 'dsh-setup-a', name: '@dsh-setup/plugin-a' },
        { id: 'dsh-setup-b', name: '@dsh-setup/plugin-b', config: { flag: true } },
      ],
      DEFAULTS,
    )
    // The output must stay loadable YAML; the loader parses it as a patch list.
    expect(patch).toMatch(/- insert:/)
    for (const field of ['provider', 'model', 'reasoningEffort', 'preference']) {
      expect(patch).toContain(field)
    }
    for (const row of ['dsh-setup-a', 'dsh-setup-b', 'agent-default-model', 'ui-theme']) {
      expect(patch).toContain(row)
    }
  })
})

describe('adapter rows', () => {
  it('generates an approved adapter row for a configuration-only package', () => {
    const files = computeGenerated(
      [{ pkg: workspacePackage('@dsh-setup/plugin-a'), rows: ADAPTER_ROWS }],
      [],
      '0.1.0',
      VERSIONS,
    )
    expect(files.get(SETUP_PATCH_FILE)?.toString()).toContain('@deepseek-ai/dsh-mcp-client')
    expect(files.get(join('packages', 'plugin-a', 'cordis.patch.yml'))?.toString()).toContain(
      '@deepseek-ai/dsh-mcp-client',
    )
  })

  it('rejects an unapproved adapter target', () => {
    expect(() =>
      computeGenerated(
        [
          {
            pkg: workspacePackage('@dsh-setup/plugin-a'),
            rows: [{ id: 'dsh-setup-a', name: '@deepseek-ai/dsh-tools' }],
          },
        ],
        [],
        '0.1.0',
        VERSIONS,
      ),
    ).toThrow(/not an approved adapter target/)
  })

  it('generates an adapter row beside an owned row on a package with a Host entry', () => {
    const files = computeGenerated(
      [
        {
          pkg: workspacePackage('@dsh-setup/plugin-a', { main: 'lib/index.js' }),
          rows: [{ id: 'dsh-setup-a', name: '@dsh-setup/plugin-a' }, ...ADAPTER_ROWS],
        },
      ],
      [],
      '0.1.0',
      VERSIONS,
    )
    const patch = files.get(join('packages', 'plugin-a', 'cordis.patch.yml'))?.toString() ?? ''
    expect(patch).toContain('@dsh-setup/plugin-a')
    expect(patch).toContain('@deepseek-ai/dsh-mcp-client')
  })

  it('generates an adapter row on a package with a Client entry', () => {
    const files = computeGenerated(
      [
        {
          pkg: workspacePackage('@dsh-setup/plugin-a', {
            dsh: {
              bundle: { patch: './cordis.patch.yml' },
              client: { platform: 'web' },
            },
          }),
          rows: ADAPTER_ROWS,
        },
      ],
      [],
      '0.1.0',
      VERSIONS,
    )
    expect(files.get(SETUP_PATCH_FILE)?.toString()).toContain('@deepseek-ai/dsh-mcp-client')
  })

  it('still generates a self-named row for a code-bearing package', () => {
    const files = computeGenerated(
      [
        {
          pkg: workspacePackage('@dsh-setup/plugin-a', { main: 'lib/index.js' }),
          rows: [{ id: 'dsh-setup-a', name: '@dsh-setup/plugin-a' }],
        },
      ],
      [],
      '0.1.0',
      VERSIONS,
    )
    expect(files.get(join('packages', 'plugin-a', 'cordis.patch.yml'))?.toString()).toContain(
      '@dsh-setup/plugin-a',
    )
  })
})

describe('setup manifest', () => {
  it('declares every plugin as an exact dependency and bundled dependency', () => {
    const manifest = buildSetupManifest(
      [plugin('@dsh-setup/plugin-b', '0.2.0'), plugin('@dsh-setup/plugin-a')],
      '0.1.0',
      VERSIONS,
    )
    expect(manifest.dependencies).toEqual({
      '@dsh-setup/plugin-a': '0.1.0',
      '@dsh-setup/plugin-b': '0.2.0',
    })
    expect(manifest.bundleDependencies).toEqual(['@dsh-setup/plugin-a', '@dsh-setup/plugin-b'])
    expect(validatePackageManifest(manifest, VERSIONS.enginesDsh)).toEqual([])
    expect(
      validateSetupManifest(manifest, [
        plugin('@dsh-setup/plugin-a'),
        plugin('@dsh-setup/plugin-b', '0.2.0'),
      ]),
    ).toEqual([])
  })

  it('hoists plugin runtime dependencies without bundling them', () => {
    const runtime = { '@deepseek-ai/dsh-brand': '0.2.1-rc.3', '@openai/codex': '0.164.0' }
    const owners = [plugin('@dsh-setup/plugin-a', '0.1.0', runtime)]
    const manifest = buildSetupManifest(owners, '0.1.0', VERSIONS)
    expect(manifest.dependencies).toEqual({
      '@dsh-setup/plugin-a': '0.1.0',
      '@deepseek-ai/dsh-brand': '0.2.1-rc.3',
      '@openai/codex': '0.164.0',
    })
    expect(manifest.bundleDependencies).toEqual(['@dsh-setup/plugin-a'])
    expect(validatePackageManifest(manifest, VERSIONS.enginesDsh)).toEqual([])
    expect(validateSetupManifest(manifest, owners)).toEqual([])
  })

  it('reports a missing hoisted runtime dependency', () => {
    const owners = [plugin('@dsh-setup/plugin-a', '0.1.0', { '@openai/codex': '0.164.0' })]
    const manifest = buildSetupManifest(owners, '0.1.0', VERSIONS)
    const stripped = { ...manifest, dependencies: { '@dsh-setup/plugin-a': '0.1.0' } }
    expect(validateSetupManifest(stripped, owners)).toEqual([
      'missing runtime dependency @openai/codex',
    ])
  })

  it('changes when the plugin set changes, so drift cannot go unnoticed', () => {
    const single = buildSetupManifest([plugin('@dsh-setup/plugin-a')], '0.1.0', VERSIONS)
    const double = buildSetupManifest(
      [plugin('@dsh-setup/plugin-a'), plugin('@dsh-setup/plugin-b')],
      '0.1.0',
      VERSIONS,
    )
    expect(JSON.stringify(single)).not.toBe(JSON.stringify(double))
  })

  it('reports a dependency set that differs from the workspace plugins', () => {
    const mismatched = buildSetupManifest([plugin('@dsh-setup/plugin-a')], '0.1.0', VERSIONS)
    expect(
      validateSetupManifest(mismatched, [
        plugin('@dsh-setup/plugin-a'),
        plugin('@dsh-setup/plugin-b'),
      ]),
    ).toEqual([
      'missing dependency @dsh-setup/plugin-b',
      'missing bundleDependency @dsh-setup/plugin-b',
    ])
  })
})

describe('generated-file drift', () => {
  it('reports missing, changed, and unexpected files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-setup-drift-'))
    try {
      const vendorRoot = join(dir, 'node_modules')
      mkdirSync(vendorRoot, { recursive: true })
      const same = join(dir, 'same.txt')
      const changed = join(dir, 'changed.txt')
      const unexpected = join(vendorRoot, 'extra.txt')
      writeFileSync(same, 'same')
      writeFileSync(changed, 'stale')
      writeFileSync(unexpected, 'extra')
      const expected = new Map([
        [same, Buffer.from('same')],
        [changed, Buffer.from('fresh')],
        [join(dir, 'missing.txt'), Buffer.from('missing')],
      ])
      const report = diffGenerated(expected, [vendorRoot])
      expect(report.missing).toEqual([join(dir, 'missing.txt')])
      expect(report.changed).toEqual([changed])
      expect(report.unexpected).toEqual([unexpected])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
