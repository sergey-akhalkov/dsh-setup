import { AsyncLocalStorage } from 'node:async_hooks'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import {
  apply,
  configHash,
  derive,
  derivedConfig,
  inject,
  name,
  type Owned,
  optionsFrom,
  owned,
  readSettings,
  resolveOptions,
  timedPlugins,
  writeSettings,
} from '../lib/index.js'

type Row = Record<string, unknown>

interface FakePreset {
  entry: { options: { id: string } }
  inherited: Row
  override: Row
  composed: Row
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function preset(id: string, inherited: Row, override: Row = {}): FakePreset {
  return { entry: { options: { id } }, inherited, override, composed: override }
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'question-timeout-'))
  dirs.push(dir)
  return dir
}

/** Wait for the watched apply path to reach a condition; a missing run fails on the bound. */
async function until(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(check()).toBe(true)
}

interface EditorOptions {
  failFor?: string
  /** Replace the commit-time composed config, simulating an edit made after the snapshot. */
  currentAtCommit?: Row
  /** Observe the async-context store the edit runs in. */
  onEdit?: () => void
}

function createEditor(configurations: FakePreset[], options: EditorOptions = {}) {
  const writes: Array<{ id: string; next: Row }> = []
  let failed = false
  return {
    writes,
    configuration: () => configurations,
    async edit(
      entry: FakePreset['entry'],
      change: (current: Row, inherited: Row) => Row,
    ): Promise<void> {
      options.onEdit?.()
      const target = configurations.find((candidate) => candidate.entry === entry)
      if (target === undefined) throw new Error('unknown entry')
      if (options.failFor === entry.options.id && !failed) {
        failed = true
        throw new Error('editor refused')
      }
      const current = options.currentAtCommit ?? target.composed
      const next = change(current, target.inherited)
      // The real editor deletes the profile override when the config equals the inherited one.
      const restored = JSON.stringify(next) === JSON.stringify(target.inherited)
      writes.push({ id: entry.options.id, next })
      target.override = restored ? {} : next
      target.composed = restored ? target.inherited : next
    },
  }
}

function createContext(
  editor: unknown,
  dir?: string,
  hmr?: unknown,
): { ctx: never; logs: string[]; disposers: Array<() => void> } {
  const logs: string[] = []
  const disposers: Array<() => void> = []
  const logger = () => ({
    info: (message: string) => logs.push(`info:${message}`),
    warn: (message: string) => logs.push(`warn:${message}`),
  })
  const ctx = {
    get: (key: string) => {
      if (key === 'configEditor') return editor
      if (key === 'profileContext') return dir === undefined ? undefined : { dir }
      if (key === 'hmr') return hmr
      return undefined
    },
    logger,
    fiber: {},
    effect: (callback: () => unknown) => {
      const cleanup = callback()
      if (typeof cleanup === 'function') disposers.push(cleanup as () => void)
    },
  }
  return { ctx: ctx as never, logs, disposers }
}

const askRow = { id: 'tool-ask-user', name: '@deepseek-ai/dsh-tool-ask-user' }
const standard = (plugins: unknown[]) => ({ id: 'standard', order: 1, plugins })
const askConfig = (next: Row) => {
  const plugins = (next.plugins ?? []) as Array<Row & { config?: Row }>
  return plugins.find((row) => row.id === 'tool-ask-user')?.config
}
const options = resolveOptions({ timeout: 240 })

interface RunOutcome {
  persisted: Array<Record<string, { wrote: string; from?: string }>>
  logs: string[]
}

async function run(
  editor: ReturnType<typeof createEditor>,
  optionsValue = options,
  settings: Record<string, unknown> = {},
): Promise<RunOutcome> {
  const persisted: RunOutcome['persisted'] = []
  const logs: string[] = []
  await derive(
    editor,
    optionsValue,
    settings as never,
    (managed) => {
      persisted.push(managed as RunOutcome['persisted'][number])
      return true
    },
    {
      info: (message) => logs.push(`info:${message}`),
      warn: (message) => logs.push(`warn:${message}`),
    },
  )
  return { persisted, logs }
}

describe('question timeout derivation', () => {
  it('derives a fresh preset whose composed config equals its declaration', async () => {
    const editor = createEditor([preset('preset-standard', standard([askRow, { id: 'tool-web' }]))])
    const { persisted } = await run(editor)
    expect(editor.writes.map((write) => write.id)).toEqual(['preset-standard'])
    expect(askConfig(editor.writes[0]?.next ?? {})).toEqual({ mode: 'timed', timeout: 240 })
    expect(persisted.at(-1)?.['preset-standard']?.wrote).toBe(
      configHash(editor.writes[0]?.next ?? {}),
    )
  })

  it('is idempotent across a restart through the ownership record', async () => {
    const editor = createEditor([preset('preset-standard', standard([askRow]))])
    const first = await run(editor)
    const second = await run(editor, options, { managed: first.persisted.at(-1) })
    expect(second.persisted).toHaveLength(0)
    expect(editor.writes).toHaveLength(1)
  })

  it('re-derives when the configured wait changes', async () => {
    const editor = createEditor([preset('preset-standard', standard([askRow]))])
    const first = await run(editor, options)
    await run(editor, { timed: true, timeout: 30 }, { managed: first.persisted.at(-1) })
    expect(askConfig(editor.writes[1]?.next ?? {})).toEqual({ mode: 'timed', timeout: 30 })
  })

  it('follows an upstream child-list change instead of its own row', async () => {
    const target = preset('preset-standard', standard([askRow]))
    const editor = createEditor([target])
    const first = await run(editor)
    target.inherited = standard([askRow, { id: 'tool-new' }])
    await run(editor, options, { managed: first.persisted.at(-1) })
    const rows = (editor.writes[1]?.next.plugins ?? []) as Array<{ id: string }>
    expect(rows.map((row) => row.id)).toEqual(['tool-ask-user', 'tool-new'])
  })

  it('restores the inherited declaration when the upstream row disappears', async () => {
    const target = preset('preset-standard', standard([askRow]))
    const editor = createEditor([target])
    const first = await run(editor)
    target.inherited = standard([{ id: 'tool-fs' }])
    const second = await run(editor, options, { managed: first.persisted.at(-1) })
    expect(editor.writes[1]?.next).toEqual(standard([{ id: 'tool-fs' }]))
    expect(second.persisted.at(-1) ?? {}).toEqual({})
  })

  it('restores the inherited config untouched when timed is false', async () => {
    const inherited = standard([{ ...askRow, config: { mode: 'legacy', timeout: 120 } }])
    const target = preset('preset-standard', inherited)
    const editor = createEditor([target])
    const first = await run(editor)
    const second = await run(
      editor,
      { timed: false, timeout: 240 },
      { managed: first.persisted.at(-1) },
    )
    expect(editor.writes[1]?.next).toEqual(inherited)
    expect(second.persisted.at(-1) ?? {}).toEqual({})
    const stable = await run(editor, { timed: false, timeout: 240 }, { managed: {} })
    expect(stable.persisted).toHaveLength(0)
    expect(editor.writes).toHaveLength(2)
  })

  it('leaves a foreign profile override untouched', async () => {
    const editor = createEditor([
      preset('preset-standard', standard([askRow]), standard([askRow, { id: 'tool-mine' }])),
    ])
    const { persisted, logs } = await run(editor)
    expect(editor.writes).toHaveLength(0)
    expect(logs).toContain('info:preset preset-standard keeps its own profile override')
    expect(persisted).toHaveLength(0)
  })

  it('keeps a foreign override added after the snapshot', async () => {
    const foreign = standard([askRow, { id: 'tool-mine' }])
    const editor = createEditor([preset('preset-standard', standard([askRow]))], {
      currentAtCommit: foreign,
    })
    const { persisted, logs } = await run(editor)
    expect(editor.writes[0]?.next).toBe(foreign)
    expect(persisted.at(-1) ?? {}).toEqual({})
    expect(logs).toContain('info:preset preset-standard keeps its own profile override')
  })

  it('keeps ownership of successful edits when another preset fails', async () => {
    const editor = createEditor(
      [preset('preset-standard', standard([askRow])), preset('preset-cordis', standard([askRow]))],
      { failFor: 'preset-cordis' },
    )
    const first = await run(editor)
    expect(editor.writes.map((write) => write.id)).toEqual(['preset-standard'])
    expect(Object.keys(first.persisted.at(-1) ?? {})).toEqual(['preset-standard'])
    await run(editor, options, { managed: first.persisted.at(-1) })
    expect(editor.writes).toHaveLength(2)
  })

  it('reaches a stable state after a persistent editor rejection', async () => {
    const dir = tempDir()
    let calls = 0
    const editor = {
      configuration: () => [preset('preset-standard', standard([askRow]))],
      async edit(): Promise<void> {
        calls += 1
        throw new Error('editor refused')
      },
    }
    const { ctx } = createContext(editor, dir)
    apply(ctx, {})
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(calls).toBe(1)
  })

  it('records the hash of the config it actually wrote', async () => {
    const newer = standard([askRow, { id: 'tool-new' }])
    const editor = createEditor([preset('preset-standard', standard([askRow]))], {
      currentAtCommit: undefined,
    })
    editor.edit = async (entry, change) => {
      const target = { inherited: newer }
      const next = change({}, target.inherited)
      editor.writes.push({ id: entry.options.id, next })
      return Promise.resolve()
    }
    const { persisted } = await run(editor)
    expect(persisted.at(-1)?.['preset-standard']?.wrote).toBe(
      configHash(editor.writes[0]?.next ?? {}),
    )
  })

  it('aborts the preset edit when the ownership record cannot be written', async () => {
    const editor = createEditor([preset('preset-standard', standard([askRow]))])
    let failures = 1
    const persist = (managed: Record<string, Owned>): boolean => {
      if (failures > 0) {
        failures -= 1
        return false
      }
      return managed['preset-standard'] !== undefined
    }
    await derive(editor, options, {}, persist, {})
    expect(editor.writes[0]?.next).toEqual({})
    await derive(editor, options, {}, persist, {})
    expect(askConfig(editor.writes[1]?.next ?? {})).toEqual({ mode: 'timed', timeout: 240 })
  })

  it('re-derives when the settings file changes during a run', async () => {
    const dir = tempDir()
    let saved = false
    const configurations = [
      preset('preset-standard', standard([askRow])),
      preset('preset-cordis', standard([askRow])),
    ]
    const editor = createEditor(configurations, {
      onEdit: () => {
        if (saved) return
        saved = true
        writeSettings(dir, { timed: true, timeout: 20 })
      },
    })
    const { ctx } = createContext(editor, dir)
    apply(ctx, { timeout: 300 })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(readSettings(dir).timeout).toBe(20)
    const applied = editor.writes.filter((write) => askConfig(write.next)?.timeout === 20)
    expect(new Set(applied.map((write) => write.id))).toEqual(
      new Set(['preset-standard', 'preset-cordis']),
    )
  })
  it('fails open without the config editor or the profile directory', async () => {
    const withoutEditor = createContext(undefined)
    apply(withoutEditor.ctx, {})
    expect(withoutEditor.logs).toContain(
      'warn:configEditor is unavailable; preset rows are left untouched',
    )
    const withoutDir = createContext({ configuration: () => [], edit: async () => {} })
    apply(withoutDir.ctx, {})
    expect(withoutDir.logs).toContain(
      'warn:the profile directory is unavailable; preset rows are left untouched',
    )
  })
})

describe('question timeout activation path', () => {
  // The live Host activates the row before the config editor exists; without the declared
  // dependencies the derivation ran into an empty context and left every preset untimed.
  it('waits for the profile services instead of deriving into an empty context', async () => {
    const dir = tempDir()
    const editor = createEditor([preset('preset-standard', standard([askRow]))])
    const app = new Context()
    const fiber = app.plugin({ name, inject, apply }, { timeout: 240 })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(editor.writes).toHaveLength(0)
    app.provide('profileContext', { dir })
    app.provide('configEditor', editor)
    await until(() => editor.writes.length === 1)
    expect(askConfig(editor.writes[0]?.next ?? {})).toEqual({ mode: 'timed', timeout: 240 })
    expect(readSettings(dir)).toMatchObject({ timed: true, timeout: 240 })
    await fiber.dispose()
  })
})

describe('question timeout apply path', () => {
  it('leaves an enclosing HMR transaction before the editor runs', async () => {
    const dir = tempDir()
    const als = new AsyncLocalStorage<boolean>()
    const stores: unknown[] = []
    const editor = createEditor([preset('preset-standard', standard([askRow]))], {
      onEdit: () => stores.push(als.getStore()),
    })
    const { ctx } = createContext(editor, dir, { executing: als })
    als.run(true, () => apply(ctx, {}))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(stores).toEqual([undefined])
    expect(editor.writes).toHaveLength(1)
  })

  it('stops deriving when the row is disposed', async () => {
    const dir = tempDir()
    const configurations = [
      preset('preset-standard', standard([askRow])),
      preset('preset-cordis', standard([askRow])),
    ]
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let first = true
    const calls: string[] = []
    const editor = {
      configuration: () => configurations,
      async edit(
        entry: FakePreset['entry'],
        change: (current: Row, inherited: Row) => Row,
      ): Promise<void> {
        calls.push(entry.options.id)
        const target = configurations.find((candidate) => candidate.entry === entry)
        if (target === undefined) throw new Error('unknown entry')
        if (first) {
          first = false
          await gate
        }
        const next = change({}, target.inherited)
        target.override = JSON.stringify(next) === JSON.stringify(target.inherited) ? {} : next
      },
    }
    const { ctx, disposers } = createContext(editor, dir)
    apply(ctx, {})
    await new Promise((resolve) => setTimeout(resolve, 25))
    for (const dispose of disposers) dispose()
    release()
    await new Promise((resolve) => setTimeout(resolve, 35))
    expect(calls).toEqual(['preset-standard'])
  })
  it('applies a saved wait and restores the inherited config when timed is off', async () => {
    const dir = tempDir()
    const target = preset('preset-standard', standard([askRow]))
    const editor = createEditor([target])
    const { ctx } = createContext(editor, dir)
    apply(ctx, {})
    await until(() => editor.writes.length === 1)
    expect(askConfig(editor.writes[0]?.next ?? {})).toEqual({ mode: 'timed', timeout: 300 })
    expect(readSettings(dir)).toMatchObject({ timed: true, timeout: 300 })

    writeSettings(dir, { timed: true, timeout: 20, managed: readSettings(dir).managed })
    await until(() => editor.writes.some((write) => askConfig(write.next)?.timeout === 20))
    expect(askConfig(target.composed)).toEqual({ mode: 'timed', timeout: 20 })
    expect(readSettings(dir)).toMatchObject({ timed: true, timeout: 20 })
    expect(readSettings(dir).managed?.['preset-standard']).toBeDefined()

    writeSettings(dir, { timed: false, timeout: 20, managed: readSettings(dir).managed })
    await until(() => target.override !== undefined && JSON.stringify(target.override) === '{}')
    expect(target.override).toEqual({})
    expect(target.composed).toEqual(standard([askRow]))
    expect(readSettings(dir).managed).toEqual({})
  })
})

describe('question timeout helpers', () => {
  it('round-trips the file and defaults a missing one', () => {
    const dir = tempDir()
    expect(readSettings(dir)).toEqual({})
    writeSettings(dir, { timed: false, timeout: 45, managed: {} })
    expect(readSettings(dir)).toEqual({ timed: false, timeout: 45, managed: {} })
    expect(readFileSync(join(dir, '.dsh-setup-question-timeout.json'), 'utf8')).toContain(
      '"timeout": 45',
    )
  })

  it('lets the file win over the row config', () => {
    expect(optionsFrom({ timeout: 45 }, { timeout: 300 })).toEqual({ timed: true, timeout: 45 })
    expect(optionsFrom({}, { timed: false, timeout: 300 })).toEqual({ timed: false, timeout: 300 })
  })

  it('defaults the options and reports no row or ownership', () => {
    expect(resolveOptions()).toEqual({ timed: true, timeout: 300 })
    expect(resolveOptions({ timed: false, timeout: 0 })).toEqual({ timed: false, timeout: 300 })
    expect(derivedConfig(standard([{ id: 'tool-fs' }]), options)).toBeUndefined()
    expect(timedPlugins('not-a-list', options)).toBeUndefined()
    expect(owned({}, standard([askRow]), {}, 'preset-standard')).toBe(true)
    expect(owned(standard([askRow]), standard([askRow]), {}, 'preset-standard')).toBe(true)
    expect(owned(standard([askRow, { id: 'x' }]), standard([askRow]), {}, 'preset-standard')).toBe(
      false,
    )
    expect(configHash({ a: 1 })).not.toBe(configHash({ a: 2 }))
  })
})
