import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCompositionFragment } from '../lib/fragments.ts'
import { computeGenerated, parseDefaults } from '../lib/generate.ts'
import type { DshVersions, PackageManifest, WorkspacePackage } from '../lib/workspace.ts'

/**
 * The two MCP bundles ship guidance only: one enabled guidance row and no static
 * adapter row. The setup carries both servers in the lazy row, so a session
 * reaches them through mcp_tools/mcp_call.
 */

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

const VERSIONS: DshVersions = {
  runtime: '0.2.1-rc.3',
  enginesDsh: '>=0.2.1-rc.3 <0.3.0',
  supportedVersions: ['0.2.1-rc.3'],
  repository: 'https://github.com/example/dsh-setup',
  installBundles: { shipped: [], registry: [] },
}

interface Fixture {
  slug: string
  guidanceRowId: string
}

const FIXTURES: Fixture[] = [
  { slug: 'plugin-serena', guidanceRowId: 'dsh-setup-serena-guidance' },
  { slug: 'plugin-nuphus-mcp', guidanceRowId: 'dsh-setup-nuphus-guidance' },
]

function readManifest(slug: string): PackageManifest {
  const path = join(repoRoot, 'packages', slug, 'package.json')
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function readFragmentText(slug: string): string {
  return readFileSync(join(repoRoot, 'packages', slug, 'cordis.fragment.yml'), 'utf8')
}

describe.each(FIXTURES)('$slug composition', ({ slug, guidanceRowId }) => {
  it('declares exactly one enabled guidance row and no adapter row', () => {
    const manifest = readManifest(slug)
    const fragment = parseCompositionFragment(readFragmentText(slug), manifest.name)

    expect(fragment.rows).toHaveLength(1)
    expect(fragment.rows[0]).toMatchObject({ id: guidanceRowId, name: manifest.name })
    expect(fragment.rows[0]?.config).toBeUndefined()
    expect(fragment.rows[0]?.disabled).toBeUndefined()
  })

  it('generates a guidance-only patch that mounts no static adapter', () => {
    const manifest = readManifest(slug)
    const rows = parseCompositionFragment(readFragmentText(slug), manifest.name).rows
    const pkg: WorkspacePackage = {
      dir: `packages/${slug}`,
      relativeDir: `packages/${slug}`,
      manifest: { ...manifest, main: 'lib/index.js', types: 'lib/index.d.ts' },
    }

    const files = computeGenerated([{ pkg, rows }], [], '0.1.0', VERSIONS)
    const patch = files.get(join('packages', slug, 'cordis.patch.yml'))?.toString() ?? ''

    expect(patch).toContain(guidanceRowId)
    expect(patch).toContain(manifest.name)
    expect(patch).not.toContain('@deepseek-ai/dsh-mcp-client')
    expect(patch).not.toContain('disabled:')
  })
})

describe('setup lazy MCP configuration', () => {
  const defaults = parseDefaults(
    readFileSync(join(repoRoot, 'packages', 'setup', 'defaults.yml'), 'utf8'),
  )

  it('configures both servers in the lazy row and retires both adapter rows', () => {
    const lazy = defaults.find((entry) => entry.id === 'dsh-setup-mcp-lazy')
    const servers = lazy?.config?.servers as Array<Record<string, unknown>> | undefined
    expect(servers?.map((server) => server.serverName)).toEqual(['nuphus-mcp', 'serena'])
    expect(servers?.[0]).toMatchObject({
      transport: 'stdio',
      command: 'nuphus-mcp',
      args: ['--confirm-write'],
      toolCallTimeoutMs: 120000,
    })
    expect(servers?.[1]).toMatchObject({
      transport: 'stdio',
      command: 'uvx',
      args: [
        '--from',
        'serena-agent==1.7.0',
        'serena',
        'start-mcp-server',
        '--context=vscode',
        '--enable-web-dashboard=false',
        '--enable-gui-log-window=false',
      ],
      toolCallTimeoutMs: 120000,
    })
    expect(defaults.map((entry) => entry.id)).not.toContain('dsh-setup-nuphus-mcp')
    expect(defaults.map((entry) => entry.id)).not.toContain('dsh-setup-serena')
  })

  it('generates a setup patch with enabled guidance rows and no static adapter', () => {
    const patch = readFileSync(join(repoRoot, 'packages', 'setup', 'cordis.patch.yml'), 'utf8')
    for (const { guidanceRowId } of FIXTURES) expect(patch).toContain(guidanceRowId)
    expect(patch).not.toContain('@deepseek-ai/dsh-mcp-client')
    expect(patch).not.toContain('disabled:')
    expect(patch).toContain('serverName: nuphus-mcp')
    expect(patch).toContain('serverName: serena')
  })
})
