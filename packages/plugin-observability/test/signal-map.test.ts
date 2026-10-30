import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseRows } from '../src/host/rows.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const defaultsFile = join(root, 'packages', 'setup', 'defaults.yml')

interface DefaultsEntry {
  readonly id: string
  readonly config?: Record<string, unknown>
}

function shippedRows() {
  const document: unknown = parse(readFileSync(defaultsFile, 'utf8'))
  if (!Array.isArray(document)) throw new Error('defaults.yml must be an array')
  const entry = (document as DefaultsEntry[]).find(
    (value) => value.id === 'dsh-setup-observability',
  )
  if (entry === undefined) throw new Error('defaults.yml has no dsh-setup-observability entry')
  return parseRows(entry.config)
}

function pluginDir(id: string): string {
  return join(root, 'packages', `plugin-${id}`)
}

function walk(directory: string): string[] {
  if (!existsSync(directory)) return []
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...walk(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/** Handwritten sources when present; the vendored Codex fork has only lib/. */
function pluginCode(id: string): string {
  const dir = pluginDir(id)
  const sources = walk(join(dir, 'src')).filter(
    (file) => file.endsWith('.ts') || file.endsWith('.tsx'),
  )
  const files =
    sources.length > 0 ? sources : walk(join(dir, 'lib')).filter((file) => file.endsWith('.js'))
  return files.map((file) => readFileSync(file, 'utf8')).join('\n')
}

/** A context whose missing services are inert stubs, so `apply` can register its tools. */
function stubContext(names: Set<string>): unknown {
  const stub: object = new Proxy(() => {}, {
    get: () => stub,
    apply: () => stub,
    construct: () => stub,
  })
  const base = {
    effect: (callback: () => (() => void) | undefined) => {
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    on: () => () => {},
    inject: () => () => {},
    get: () => undefined,
    tools: {
      register: (definition: { name?: unknown }) => {
        if (typeof definition.name === 'string') names.add(definition.name)
        return () => {}
      },
      schemas: () => [],
    },
    skills: { registerProvider: () => () => {}, register: () => () => {} },
    systemPrompt: { section: () => () => {} },
  }
  return new Proxy(base, {
    get(target, property) {
      return property in target ? target[property as keyof typeof target] : stub
    },
  })
}

/** Tools the plugin's own entrypoint registers when applied with stub services. */
async function capturedTools(id: string): Promise<Set<string> | undefined> {
  try {
    const module = (await import(pathToFileURL(join(pluginDir(id), 'lib', 'index.js')).href)) as {
      apply?: (ctx: unknown, config: unknown) => unknown
    }
    const names = new Set<string>()
    try {
      await module.apply?.(stubContext(names), {})
    } catch {
      // Later services can be missing; registrations made before the failure still count.
    }
    return names
  } catch {
    return undefined
  }
}

/** The native Hindsight entry that owns the hindsight_* tools and registers them per agent. */
function nativeHindsightCode(): string {
  return readFileSync(
    join(
      pluginDir('hindsight'),
      'node_modules',
      '@vectorize-io',
      'hindsight-coding-agents',
      'dist',
      'dsh.js',
    ),
    'utf8',
  )
}

function names(code: string, tool: string): boolean {
  return code.includes(`'${tool}'`) || code.includes(`"${tool}"`)
}

describe('shipped observability signal map', () => {
  it('every row names an installed plugin package with a unique id', () => {
    const rows = shippedRows()
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
    for (const row of rows) {
      const manifest = JSON.parse(
        readFileSync(join(pluginDir(row.id), 'package.json'), 'utf8'),
      ) as { name: string }
      expect(manifest.name).toBe(`@dsh-setup/plugin-${row.id}`)
    }
  })

  it('every mapped tool name is registered by the plugin that maps it', async () => {
    for (const row of shippedRows()) {
      const mapped = (row.match ?? []).flatMap((predicate) =>
        predicate.tool === undefined ? [] : [predicate.tool],
      )
      if (mapped.length === 0) continue
      const captured = await capturedTools(row.id)
      for (const tool of mapped) {
        if (captured !== undefined && captured.size > 0) {
          expect(captured.has(tool), `${row.id} must register ${tool}`).toBe(true)
          continue
        }
        // The Codex fork's module graph cannot be imported in this repo (a peer
        // is composed only in a profile), so its registration is checked
        // statically: the literal, a real register call, and the definition
        // helper. Hindsight's native plugin registers its tools per agent from
        // its spec list, so the native registration loop itself is required.
        // shortcut: static registration check for codex-subagent and hindsight,
        // upgrade when those modules can be applied under a stub context.
        const registration =
          row.id === 'hindsight'
            ? {
                code: nativeHindsightCode(),
                required: [
                  'function registerTools(',
                  'for (const spec of specsOf(template))',
                  'toolCtx.tools.register({',
                  'spec.name',
                ],
              }
            : {
                code: pluginCode(row.id),
                required: ['defineTool(', 'ctx.tools.register('],
              }
        for (const fragment of registration.required) {
          expect(registration.code, `${row.id} must contain ${fragment}`).toContain(fragment)
        }
        expect(names(registration.code, tool), `${row.id} must define ${tool}`).toBe(true)
        if (row.id === 'hindsight') {
          // The mapped tools belong to the native plugin; the shipped plugin
          // must still activate it, or the registration exists but never runs.
          expect(
            pluginCode('hindsight'),
            'plugin-hindsight must activate the native plugin',
          ).toContain('applyHindsight(ctx)')
        }
      }
    }
  })

  it('every guidance row names a plugin that registers no tool', () => {
    for (const row of shippedRows()) {
      if (row.kind !== 'guidance') continue
      expect(pluginCode(row.id), `${row.id} must not register a tool`).not.toContain(
        'tools.register',
      )
    }
  })
})
