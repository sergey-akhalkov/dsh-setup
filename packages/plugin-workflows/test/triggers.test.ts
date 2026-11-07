import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { EVENT_KINDS, loadCatalog, validateCatalog } from '../src/host/triggers.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

describe('shadow trigger catalog', () => {
  it('loads the shipped catalog with every supported event kind', () => {
    const triggers = loadCatalog()
    expect(triggers.length).toBeGreaterThanOrEqual(9)
    expect(new Set(triggers.map((trigger) => trigger.id)).size).toBe(triggers.length)
    for (const trigger of triggers) {
      expect(EVENT_KINDS).toContain(trigger.event)
      expect(trigger.mode).toBe('shadow')
      expect(['none', 'path+content-hash']).toContain(trigger.dedupe)
    }
    expect(triggers.map((trigger) => trigger.event)).toEqual(
      expect.arrayContaining([...EVENT_KINDS]),
    )
    const tasks = triggers.find((trigger) => trigger.id === 'openspec-tasks-checked')
    expect(tasks?.filter.path).toBe('openspec/changes/**/tasks.md')
    expect(tasks?.filter.change).toBe('created-or-modified')
    expect(tasks?.dedupe).toBe('path+content-hash')
  })

  it('loads the catalog from the compiled lib layout too', async () => {
    const compiled = join(packageDir, 'lib', 'triggers.js')
    if (!existsSync(compiled)) throw new Error('run `pnpm build` before this test')
    const module = (await import(pathToFileURL(compiled).href)) as {
      loadCatalog(): unknown[]
    }
    expect(module.loadCatalog()).toHaveLength(loadCatalog().length)
  })

  it('accepts a valid trigger without a filter', () => {
    const triggers = validateCatalog({
      triggers: [{ id: 'worker', event: 'subagent.start', mode: 'shadow', dedupe: 'none' }],
    })
    expect(triggers).toEqual([
      { id: 'worker', event: 'subagent.start', filter: {}, mode: 'shadow', dedupe: 'none' },
    ])
  })

  it('refuses an unknown event and names the trigger and field', () => {
    expect(() =>
      validateCatalog({
        triggers: [{ id: 'bad', event: 'intent.change', mode: 'shadow', dedupe: 'none' }],
      }),
    ).toThrow(/trigger "bad".*field "event"/u)
  })

  it('refuses an empty id, an invalid filter, a mode, and a duplicate', () => {
    expect(() =>
      validateCatalog({
        triggers: [{ id: '', event: 'tool.result', mode: 'shadow', dedupe: 'none' }],
      }),
    ).toThrow(/field ".*id"/u)
    expect(() =>
      validateCatalog({
        triggers: [
          { id: 'bad', event: 'tool.result', filter: 'nope', mode: 'shadow', dedupe: 'none' },
        ],
      }),
    ).toThrow(/trigger "bad".*field "filter"/u)
    expect(() =>
      validateCatalog({
        triggers: [
          {
            id: 'bad',
            event: 'tool.result',
            filter: { nope: 'x' },
            mode: 'shadow',
            dedupe: 'none',
          },
        ],
      }),
    ).toThrow(/field "filter.nope"/u)
    expect(() =>
      validateCatalog({
        triggers: [{ id: 'bad', event: 'tool.result', mode: 'active', dedupe: 'none' }],
      }),
    ).toThrow(/field "mode"/u)
    expect(() =>
      validateCatalog({
        triggers: [{ id: 'bad', event: 'tool.result', mode: 'shadow', dedupe: 'sometimes' }],
      }),
    ).toThrow(/field "dedupe"/u)
    expect(() =>
      validateCatalog({
        triggers: [
          { id: 'same', event: 'tool.result', mode: 'shadow', dedupe: 'none' },
          { id: 'same', event: 'tool.result', mode: 'shadow', dedupe: 'none' },
        ],
      }),
    ).toThrow(/field "id"/u)
  })
})
