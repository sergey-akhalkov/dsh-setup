import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseConfig } from '../src/host/config.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const defaultsFile = join(root, 'packages', 'setup', 'defaults.yml')

interface DefaultsEntry {
  readonly id: string
  readonly config?: Record<string, unknown>
}

function shippedConfig() {
  const document: unknown = parse(readFileSync(defaultsFile, 'utf8'))
  if (!Array.isArray(document)) throw new Error('defaults.yml must be an array')
  const entry = (document as DefaultsEntry[]).find(
    (value) => value.id === 'dsh-setup-observability',
  )
  if (entry === undefined) throw new Error('defaults.yml has no dsh-setup-observability entry')
  return parseConfig(entry.config)
}

function shippedRows() {
  return shippedConfig().rows
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

/** Registries one plugin's entrypoint contributed under the stub context. */
interface CapturedRegistry {
  readonly tools: Set<string>
  readonly sections: Set<string>
  readonly skills: Set<string>
}

/** A context whose missing services are inert stubs, so `apply` can register its contributions. */
function stubContext(captured: CapturedRegistry, pending: Array<() => unknown>): unknown {
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
    // Optional-service access: a plugin that registers its tool through `ctx.get('tools')`
    // (as goal-continuity does) still contributes it to the captured registry.
    get: (name: string) =>
      name === 'tools'
        ? {
            register: (definition: { name?: unknown }) => {
              if (typeof definition.name === 'string') captured.tools.add(definition.name)
              return () => {}
            },
            restrict: () => () => {},
            schemas: () => [],
          }
        : undefined,
    tools: {
      register: (definition: { name?: unknown }) => {
        if (typeof definition.name === 'string') captured.tools.add(definition.name)
        return () => {}
      },
      schemas: () => [],
    },
    skills: {
      registerProvider: (factory: () => unknown) => {
        pending.push(factory)
        return () => {}
      },
      register: () => () => {},
    },
    systemPrompt: {
      section: (definition: { name?: unknown }) => {
        if (typeof definition.name === 'string') captured.sections.add(definition.name)
        return () => {}
      },
    },
  }
  return new Proxy(base, {
    get(target, property) {
      return property in target ? target[property as keyof typeof target] : stub
    },
  })
}

/** Contributions the plugin's own entrypoint registers when applied with stub services. */
async function capturedRegistry(id: string): Promise<CapturedRegistry | undefined> {
  const captured: CapturedRegistry = { tools: new Set(), sections: new Set(), skills: new Set() }
  const pending: Array<() => unknown> = []
  try {
    const module = (await import(pathToFileURL(join(pluginDir(id), 'lib', 'index.js')).href)) as {
      apply?: (ctx: unknown, config: unknown) => unknown
    }
    try {
      await module.apply?.(stubContext(captured, pending), {})
    } catch {
      // Later services can be missing; registrations made before the failure still count.
    }
    // Skill providers expose their catalog through `list()`, so resolve them after apply.
    for (const factory of pending) {
      try {
        const provider = factory() as {
          list?: () => Promise<readonly { name?: unknown }[]>
        }
        for (const candidate of (await provider.list?.()) ?? []) {
          if (typeof candidate.name === 'string') captured.skills.add(candidate.name)
        }
      } catch {
        // An unavailable provider contributes nothing to the captured catalog.
      }
    }
    return captured
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
      const captured = await capturedRegistry(row.id)
      for (const tool of mapped) {
        if (captured !== undefined && captured.tools.size > 0) {
          expect(captured.tools.has(tool), `${row.id} must register ${tool}`).toBe(true)
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

  it('every row states what it waits for while it is silent', () => {
    for (const row of shippedRows()) {
      expect(typeof row.trigger, `${row.id} must carry a trigger`).toBe('string')
      expect(row.trigger?.trim(), `${row.id} trigger must not be empty`).not.toBe('')
    }
  })

  it('attributes the work_checkpoint tool to the goal-continuity row', () => {
    const row = shippedRows().find((candidate) => candidate.id === 'goal-continuity')
    const predicate = row?.match?.find((candidate) => candidate.tool === 'work_checkpoint')
    expect(predicate, 'goal-continuity must map the work_checkpoint tool').toBeDefined()
    expect(predicate?.sourceKind).toBeUndefined()
  })

  it('every row declares a non-empty business goal', () => {
    for (const row of shippedRows()) {
      expect(typeof row.goal, `${row.id} must carry a goal`).toBe('string')
      expect(row.goal?.trim(), `${row.id} goal must not be empty`).not.toBe('')
    }
  })

  it('declares eligibility only on signal rows and only where it is meaningful', () => {
    for (const row of shippedRows()) {
      if (row.kind === 'guidance') {
        expect(row.eligible, `${row.id} guidance must not declare eligibility`).toBeUndefined()
      }
      for (const predicate of row.eligible ?? []) {
        expect(
          Object.keys(predicate).length,
          `${row.id} eligible predicate must name a field`,
        ).toBeGreaterThan(0)
      }
    }
    const eligible = shippedRows().filter((row) => row.eligible !== undefined)
    expect(eligible.map((row) => row.id).sort()).toEqual([
      'delegation-rules',
      'goal-continuity',
      'verification-gate',
    ])
    for (const row of eligible) {
      expect(row.kind).toBe('signal')
      expect(row.eligible?.map((predicate) => predicate.tool).sort()).toEqual(['edit', 'write'])
    }
  })

  it('ships the two default hypotheses over the fixed metric catalog', () => {
    const { hypotheses } = shippedConfig()
    expect(hypotheses.map((entry) => entry.metric)).toEqual([
      'steps-per-human-message',
      'active-minutes-per-episode',
    ])
    for (const hypothesis of hypotheses) {
      expect(hypothesis.direction).toBe('decrease')
      expect(hypothesis.threshold).toBeGreaterThan(0)
      expect(hypothesis.guardrail).toBe('failure-rate')
      expect(hypothesis.minSamples).toBe(20)
      expect(hypothesis.window).toBe('week')
    }
  })

  it('every guidance row declares its contribution and the named plugin registers it', async () => {
    for (const row of shippedRows()) {
      if (row.kind !== 'guidance') continue
      expect(row.mounted, `${row.id} must declare its mounted names`).toBeDefined()
      expect(
        [row.mounted?.section, row.mounted?.skill].filter((name) => name !== undefined).length,
        `${row.id} must name a section or a skill`,
      ).toBeGreaterThan(0)
      const captured = await capturedRegistry(row.id)
      if (captured === undefined) {
        throw new Error(`${row.id}: the built module could not be applied under the stub context`)
      }
      if (row.mounted?.section !== undefined) {
        expect(
          captured.sections.has(row.mounted.section),
          `${row.id} must register prompt section ${row.mounted.section}`,
        ).toBe(true)
      }
      if (row.mounted?.skill !== undefined) {
        expect(
          captured.skills.has(row.mounted.skill),
          `${row.id} must publish skill ${row.mounted.skill}`,
        ).toBe(true)
      }
    }
  })

  it('the documented custom-signal example validates against the row schema', () => {
    const doc = readFileSync(join(root, 'docs', 'plugins.md'), 'utf8')
    const start = doc.indexOf('To add a custom signal')
    const example = /```yaml\n([\s\S]*?)```/u.exec(doc.slice(start))
    if (example?.[1] === undefined) throw new Error('the documented example is missing')
    const document: unknown = parse(example[1])
    if (!Array.isArray(document)) throw new Error('the documented example must be an array')
    const entry = (document as DefaultsEntry[]).find(
      (value) => value.id === 'dsh-setup-observability',
    )
    if (entry === undefined) throw new Error('the documented example has no observability entry')
    const config = parseConfig(entry.config)
    expect(config.rows.map((row) => row.id)).toEqual(['my-tool', 'my-notes-writes', 'my-skill'])
    for (const row of config.rows) {
      expect(row.trigger, `${row.id} example must carry a trigger`).toBeDefined()
      expect(row.goal, `${row.id} example must carry a goal`).toBeDefined()
    }
    // The example restates the configuration fields a profile patch replaces.
    expect(config.idleGapMinutes).toBe(30)
    expect(config.minEpisodes).toBe(10)
    expect(config.hypotheses).toEqual([])
  })
})
