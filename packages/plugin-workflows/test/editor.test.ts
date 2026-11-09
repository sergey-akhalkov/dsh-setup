import { describe, expect, it } from 'vitest'
import {
  addStep,
  blankDefinition,
  copyDefinition,
  deleteDefinition,
  deleteStep,
  duplicateDefinition,
  type EditorApi,
  type EditorState,
  installDraft,
  moveStep,
  nextFreeId,
  openDocument,
  openDraft,
  openNew,
  patchStep,
  renameDefinition,
  type SaveResult,
  savable,
  save,
  saveAsCopy,
  unsavedChanges,
} from '../src/client/editor.ts'
import { type GraphDefinition, nodeIdOf } from '../src/client/graph.ts'
import { validateDefinition } from '../src/host/definitions.ts'

const definition = {
  v: 1,
  id: 'demo',
  name: 'Demo',
  version: 3,
  trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
  settings: {
    allowModelStart: false,
    risk: 'low',
    gateOwnership: 'own',
    maxBlocks: 3,
    allowIntent: false,
  },
  steps: [
    {
      id: 'one',
      title: 'One',
      executor: 'main',
      prompt: 'One.',
      evidence: { kind: 'declaration' },
      nonCritical: true,
      next: 'two',
    },
    {
      id: 'two',
      title: 'Two',
      executor: 'main',
      prompt: 'Two.',
      evidence: { kind: 'declaration' },
      nonCritical: true,
      next: 'end',
    },
  ],
} as unknown as GraphDefinition

interface Store {
  definitions: Map<string, { definition: GraphDefinition; revision: string }>
  layouts: Map<string, { layout: unknown; revision: string }>
}

interface Calls {
  saveDefinition: { id: string; definition: GraphDefinition; expected: string | null }[]
  saveLayout: { expected: string | null }[]
  deleteDefinition: { id: string; expected: string }[]
}

function fakeApi(
  options: {
    store?: Store
    save?: (id: string, expected: string | null) => SaveResult
    deleteResult?: SaveResult
    layout?: (expected: string | null) => SaveResult
  } = {},
): { api: EditorApi; calls: Calls; store: Store } {
  const store: Store = options.store ?? {
    definitions: new Map([['demo', { definition, revision: 'rev-1' }]]),
    layouts: new Map(),
  }
  const calls: Calls = { saveDefinition: [], saveLayout: [], deleteDefinition: [] }
  let counter = 1
  const api: EditorApi = {
    async list() {
      return {
        definitions: [...store.definitions.entries()].map(([id, entry]) => ({
          id,
          name: entry.definition.name,
          version: entry.definition.version,
          stepCount: entry.definition.steps.length,
          source: 'local' as const,
          revision: entry.revision,
        })),
      }
    },
    async templates() {
      return []
    },
    async drafts() {
      return []
    },
    async read(id) {
      const entry = store.definitions.get(id)
      if (entry === undefined) throw new Error('missing')
      return { definition: entry.definition, revision: entry.revision, source: 'local' as const }
    },
    async readDraft(name) {
      return { ...definition, id: name }
    },
    async readLayout(id) {
      const entry = store.layouts.get(id)
      if (entry === undefined) return { layout: null, revision: null }
      return { layout: entry.layout as never, revision: entry.revision }
    },
    async saveDefinition(id, candidate, expected) {
      calls.saveDefinition.push({ id, definition: candidate, expected })
      if (options.save !== undefined) return options.save(id, expected)
      if (expected === null && store.definitions.has(id)) {
        return {
          ok: false,
          kind: 'conflict',
          status: 409,
          revision: store.definitions.get(id)?.revision ?? null,
        }
      }
      if (expected !== null) {
        const current = store.definitions.get(id)
        if (current === undefined || current.revision !== expected) {
          return {
            ok: false,
            kind: 'conflict',
            status: 409,
            revision: current?.revision ?? null,
          }
        }
      }
      counter += 1
      const revision = `rev-new-${String(counter)}`
      store.definitions.set(id, { definition: candidate, revision })
      return { ok: true, revision }
    },
    async deleteDefinition(id, expected) {
      calls.deleteDefinition.push({ id, expected })
      if (options.deleteResult !== undefined) return options.deleteResult
      store.definitions.delete(id)
      return { ok: true, revision: 'rev-deleted' }
    },
    async saveLayout(layout, expected) {
      calls.saveLayout.push({ expected })
      if (options.layout !== undefined) return options.layout(expected)
      counter += 1
      store.layouts.set(layout.id, { layout, revision: `layout-${String(counter)}` })
      return { ok: true, revision: `layout-${String(counter)}` }
    },
    async runs() {
      return []
    },
  }
  return { api, calls, store }
}

function opened(): EditorState {
  return openDocument({ definition, revision: 'rev-1', source: 'local' })
}

const TAKEN = new Set(['demo'])

describe('definition lifecycle', () => {
  it('creates a blank definition that passes the host schema', () => {
    const blank = blankDefinition(TAKEN)
    expect(blank.id).toBe('new-workflow')
    expect(blank.version).toBe(1)
    expect(validateDefinition(blank).id).toBe('new-workflow')
    expect(blankDefinition(new Set(['new-workflow'])).id).toBe('new-workflow-2')
  })

  it('copies a shipped definition without mutating it and duplicates a local one', () => {
    const shipped = { ...definition, id: 'change-intake', name: 'Shipped' } as GraphDefinition
    const frozen = JSON.stringify(shipped)
    const copy = copyDefinition(shipped, new Set(['change-intake']), 'My copy')
    expect(copy.id).toBe('change-intake-copy')
    expect(copy.name).toBe('My copy')
    expect(copy.version).toBe(1)
    expect(JSON.stringify(shipped)).toBe(frozen)
    const second = copyDefinition(shipped, new Set(['change-intake', 'change-intake-copy']))
    expect(second.id).toBe('change-intake-copy-2')
    const duplicated = duplicateDefinition(definition, TAKEN)
    expect(duplicated.id).toBe('demo-copy')
    expect(duplicated.version).toBe(1)
  })

  it('renames without changing the id and refuses delete while a run is active', async () => {
    const renamed = renameDefinition(opened(), 'Renamed')
    expect(renamed.document.definition.name).toBe('Renamed')
    expect(renamed.document.definition.id).toBe('demo')
    expect(renamed.dirty).toBe(true)
    const { api } = fakeApi({
      deleteResult: {
        ok: false,
        kind: 'conflict',
        status: 409,
        revision: 'rev-1',
        runs: ['run-1'],
      },
    })
    const outcome = await deleteDefinition(opened(), api)
    expect(outcome.deleted).toBe(false)
    expect(outcome.state.message).toContain('run-1')
  })

  it('surfaces a create collision and offers the next free id', async () => {
    const { api, calls } = fakeApi()
    const blank = openNew({ ...definition, id: 'demo' })
    const result = await save(blank, { api, taken: TAKEN })
    expect(calls.saveDefinition[0]?.expected).toBeNull()
    expect(result.conflict).toMatchObject({ kind: 'create', currentRevision: 'rev-1' })
    expect(result.document.definition.id).toBe('demo')
    const colliding = await save(blank, {
      api: fakeApi({
        save: () => ({ ok: false, kind: 'conflict', status: 409, revision: 'rev-1' }),
      }).api,
      taken: TAKEN,
    })
    expect(colliding.conflict?.nextId).toBe('demo-copy')
    expect(nextFreeId('demo-copy', new Set(['demo-copy']))).toBe('demo-copy-2')
  })
})

describe('draft, dirty tracking, and save', () => {
  it('reports unsaved changes only while the document is dirty', () => {
    expect(unsavedChanges(opened())).toBe(false)
    expect(unsavedChanges(patchStep(opened(), nodeIdOf('one'), { title: 'Mine' }))).toBe(true)
    expect(unsavedChanges(undefined)).toBe(false)
  })

  it('tracks dirty state and bumps the version on save', async () => {
    const { api, calls } = fakeApi()
    const state = opened()
    expect(state.dirty).toBe(false)
    const moved = moveStep(state, nodeIdOf('one'), { x: 10, y: 20 })
    expect(moved.dirty).toBe(true)
    const saved = await save(moved, { api, taken: TAKEN })
    expect(saved.status).toBe('saved')
    expect(calls.saveDefinition[0]?.definition.version).toBe(4)
    expect(calls.saveDefinition[0]?.expected).toBe('rev-1')
    expect(saved.document.revision).toBe('rev-new-2')
    expect(saved.dirty).toBe(false)
    expect(calls.saveLayout[0]?.expected).toBeNull()
    expect(saved.layoutRevision).toBe('layout-3')
  })

  it('leaves the file unchanged when the editor is reloaded instead of saved', async () => {
    const { api, store, calls } = fakeApi()
    const dirty = patchStep(opened(), nodeIdOf('one'), { title: 'Changed' })
    expect(dirty.document.definition.steps[0]?.title).toBe('Changed')
    const reloaded = openDocument(await api.read('demo'))
    expect(reloaded.document.definition).toEqual(definition)
    expect(store.definitions.get('demo')?.definition).toEqual(definition)
    expect(calls.saveDefinition).toHaveLength(0)
  })

  it('saves a conflict as a create-only copy under a new id and version 1', async () => {
    const { api, calls } = fakeApi()
    const copied = await saveAsCopy(opened(), { api, taken: TAKEN })
    expect(calls.saveDefinition[0]?.id).toBe('demo-copy')
    expect(calls.saveDefinition[0]?.definition.version).toBe(1)
    expect(calls.saveDefinition[0]?.expected).toBeNull()
    expect(copied.document.definition.id).toBe('demo-copy')
  })

  it('installs a draft only through the create-only save', async () => {
    const { api, calls } = fakeApi()
    const draft = openDraft('intake-draft', { ...definition, id: 'draft-demo', version: 7 })
    expect(draft.document.source).toBe('draft')
    const saved = await installDraft(draft, { api, taken: TAKEN })
    expect(calls.saveDefinition[0]?.expected).toBeNull()
    expect(calls.saveDefinition[0]?.definition.version).toBe(1)
    expect(saved.document.source).toBe('local')
  })
})

describe('revision contract', () => {
  it('creates with null and sends the returned revision on the next save', async () => {
    const { api, calls } = fakeApi()
    const created = await save(openNew({ ...definition, id: 'fresh' }), {
      api,
      taken: new Set(['demo', 'fresh']),
    })
    expect(calls.saveDefinition[0]?.expected).toBeNull()
    expect(created.document.revision).toBe('rev-new-2')
    const updated = await save(patchStep(created, nodeIdOf('one'), { title: 'Again' }), {
      api,
      taken: new Set(['demo', 'fresh']),
    })
    expect(calls.saveDefinition[1]?.expected).toBe('rev-new-2')
    expect(updated.document.revision).not.toBe('rev-new-2')
  })

  it('writes nothing on a conflicting update', async () => {
    const { api, store, calls } = fakeApi()
    const state = openDocument({ definition, revision: 'stale', source: 'local' })
    const result = await save(patchStep(state, nodeIdOf('one'), { title: 'Mine' }), {
      api,
      taken: TAKEN,
    })
    expect(calls.saveDefinition).toHaveLength(1)
    expect(result.conflict).toMatchObject({ kind: 'update', currentRevision: 'rev-1' })
    expect(store.definitions.get('demo')?.definition).toEqual(definition)
    expect(result.document.revision).toBe('stale')
  })

  it('keeps the definition saved when only the layout conflicts', async () => {
    const { api } = fakeApi({
      layout: () => ({ ok: false, kind: 'conflict', status: 409, revision: 'layout-9' }),
    })
    const result = await save(opened(), { api, taken: TAKEN })
    expect(result.conflict?.kind).toBe('layout')
    expect(result.document.revision).toBe('rev-new-2')
    expect(result.status).toBe('error')
  })
})

describe('pre-check and host error mapping', () => {
  it('blocks a save the client pre-check rejects without calling the host', async () => {
    const { api, calls } = fakeApi()
    const broken = deleteStep(opened(), nodeIdOf('one'))
    expect(savable(broken)).toBe(false)
    const result = await save(broken, { api, taken: TAKEN })
    expect(result.status).toBe('error')
    expect(result.message).toContain('graph issues')
    expect(calls.saveDefinition).toHaveLength(0)
  })

  it('maps a host field error back to the node and field', async () => {
    const { api } = fakeApi({
      save: () => ({
        ok: false,
        kind: 'invalid',
        status: 400,
        errors: [{ path: 'steps[1].title', message: 'must be a non-empty string' }],
      }),
    })
    const result = await save(patchStep(opened(), nodeIdOf('two'), { title: '' }), {
      api,
      taken: TAKEN,
    })
    expect(result.status).toBe('error')
    expect(result.issues[0]).toMatchObject({ nodeId: 'two', path: 'steps[1].title' })
    expect(result.issues[0]?.message).toContain('non-empty string')
  })

  it('adds a palette step as an unconnected node the pre-check names', () => {
    const state = addStep(opened(), 'human')
    const added = state.diagram.nodes.find((node) => node.kind === 'human')
    expect(added).toBeDefined()
    expect(state.issues.some((issue) => issue.nodeId === added?.id)).toBe(true)
  })
})
