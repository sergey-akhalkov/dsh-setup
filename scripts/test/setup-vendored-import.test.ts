import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { rootDir } from '../lib/workspace.ts'

/**
 * The setup bundle's vendored plugin copies must load from a linked checkout
 * without a profile install, so their runtime imports have to resolve from the
 * repository root. This exercises the real generated entry, not a mock.
 */
describe('vendored setup imports', () => {
  it('resolves the lazy MCP bundle from the vendored tree', async () => {
    const entry = join(
      rootDir,
      'packages/setup/node_modules/@dsh-setup/plugin-mcp-lazy/lib/index.js',
    )
    expect(readFileSync(entry, 'utf8')).toContain('@modelcontextprotocol/client')
    const module = (await import(pathToFileURL(entry).href)) as {
      name: string
      TOOLS_TOOL: string
      CALL_TOOL: string
      apply: (ctx: unknown, config: unknown, options?: unknown) => void
    }
    expect(module.name).toBe('@dsh-setup/plugin-mcp-lazy')
    expect(module.TOOLS_TOOL).toBe('mcp_tools')
    expect(module.CALL_TOOL).toBe('mcp_call')
  })

  it('refuses a lazy call when an enabled static adapter row exists', async () => {
    const entry = join(
      rootDir,
      'packages/setup/node_modules/@dsh-setup/plugin-mcp-lazy/lib/index.js',
    )
    const module = (await import(pathToFileURL(entry).href)) as {
      apply: (ctx: unknown, config: unknown, options?: unknown) => void
    }
    const definitions = new Map<
      string,
      { execute: (args: unknown, exec: unknown) => Promise<unknown> }
    >()
    const ctx = {
      tools: {
        register: (definition: { name: string; execute: never }) => {
          definitions.set(definition.name, definition)
          return () => undefined
        },
        schemas: () => [],
      },
      effect: () => () => undefined,
      get: (name: string) =>
        name === 'loader'
          ? {
              entries: () => [
                {
                  disabled: false,
                  options: {
                    id: 'dsh-setup-nuphus-mcp',
                    name: '@deepseek-ai/dsh-mcp-client',
                    config: { serverName: 'nuphus-mcp' },
                  },
                },
              ],
            }
          : undefined,
    }
    module.apply(ctx, {
      servers: [{ serverName: 'nuphus-mcp', transport: 'stdio', command: 'nuphus-mcp' }],
    })
    const tool = definitions.get('mcp_tools')
    expect(tool).toBeDefined()
    await expect(
      tool?.execute({ server: 'nuphus-mcp' }, { signal: new AbortController().signal }),
    ).rejects.toThrow(/also mounted as a static adapter/)
  })

  it('ships the updated Nuphus guidance in the vendored setup', () => {
    const skill = readFileSync(
      join(
        rootDir,
        'packages/setup/node_modules/@dsh-setup/plugin-nuphus-mcp/assets/nuphus-discipline/SKILL.md',
      ),
      'utf8',
    )
    expect(skill).toContain('mcp__nuphus-mcp__')
    expect(skill).toContain('mcp_tools')
    expect(skill).toContain('mcp_call')
  })
})
