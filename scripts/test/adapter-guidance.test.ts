import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCompositionFragment } from '../lib/fragments.ts'
import { computeGenerated } from '../lib/generate.ts'
import type { DshVersions, PackageManifest, WorkspacePackage } from '../lib/workspace.ts'

/**
 * The two MCP bundles now ship an adapter row and a guidance row in one
 * fragment. The rows must stay independent: the adapter keeps its complete
 * server configuration, and the guidance row mounts the package's own module
 * with no configuration of its own.
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
  serverName: string
  adapterRowId: string
  guidanceRowId: string
}

const FIXTURES: Fixture[] = [
  {
    slug: 'plugin-serena',
    serverName: 'serena',
    adapterRowId: 'dsh-setup-serena',
    guidanceRowId: 'dsh-setup-serena-guidance',
  },
  {
    slug: 'plugin-nuphus-mcp',
    serverName: 'nuphus-mcp',
    adapterRowId: 'dsh-setup-nuphus-mcp',
    guidanceRowId: 'dsh-setup-nuphus-guidance',
  },
]

function readManifest(slug: string): PackageManifest {
  const path = join(repoRoot, 'packages', slug, 'package.json')
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

function readFragmentText(slug: string): string {
  return readFileSync(join(repoRoot, 'packages', slug, 'cordis.fragment.yml'), 'utf8')
}

describe.each(FIXTURES)(
  '$slug composition',
  ({ slug, serverName, adapterRowId, guidanceRowId }) => {
    it('declares an adapter row with complete config and an unconfigured guidance row', () => {
      const manifest = readManifest(slug)
      const fragment = parseCompositionFragment(readFragmentText(slug), manifest.name)

      expect(fragment.rows.map((row) => row.id)).toEqual([adapterRowId, guidanceRowId])
      const [adapter, guidance] = fragment.rows
      expect(adapter?.name).toBe('@deepseek-ai/dsh-mcp-client')
      expect(adapter?.config).toMatchObject({ serverName, transport: 'stdio' })
      expect(typeof adapter?.config?.command).toBe('string')
      expect(guidance?.name).toBe(manifest.name)
      expect(guidance?.config).toBeUndefined()
    })

    it('generates a patch mounting both rows for a code-bearing package', () => {
      const manifest = readManifest(slug)
      const rows = parseCompositionFragment(readFragmentText(slug), manifest.name).rows
      const pkg: WorkspacePackage = {
        dir: `packages/${slug}`,
        relativeDir: `packages/${slug}`,
        manifest: { ...manifest, main: 'lib/index.js', types: 'lib/index.d.ts' },
      }

      const files = computeGenerated([{ pkg, rows }], [], '0.1.0', VERSIONS)
      const patch = files.get(join('packages', slug, 'cordis.patch.yml'))?.toString() ?? ''

      expect(patch).toContain('@deepseek-ai/dsh-mcp-client')
      expect(patch).toContain(manifest.name)
      expect(patch).toContain(adapterRowId)
      expect(patch).toContain(guidanceRowId)
    })
  },
)
