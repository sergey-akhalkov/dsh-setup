import { describe, expect, it, vi } from 'vitest'
import {
  addStep,
  blankDefinition,
  connectSteps,
  copyDefinition,
  deleteDefinition,
  deleteStep,
  duplicateDefinition,
  type EditorApi,
  type EditorState,
  installDraft,
  issueLabel,
  leaveEditor,
  moveStep,
  nextCopyId,
  nextFreeId,
  openDocument,
  openDraft,
  openNew,
  patchDefinition,
  patchStep,
  reconcileCopy,
  reconcileSave,
  renameDefinition,
  renameToNextId,
  type SaveResult,
  savable,
  save,
  saveAsCopy,
  unsavedChanges,
  updateGraph,
} from '../src/client/editor.ts'
import { END_NODE, type GraphDefinition, nodeIdOf } from '../src/client/graph.ts'
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
    // A collision on an already-generated copy keeps the numeric sequence.
    const copyCollision = await save(openNew({ ...definition, id: 'demo-copy' }), {
      api: fakeApi({
        save: () => ({ ok: false, kind: 'conflict', status: 409, revision: 'rev-1' }),
      }).api,
      taken: new Set(['demo']),
    })
    expect(copyCollision.conflict?.nextId).toBe('demo-copy-2')
    expect(nextCopyId('demo-copy', new Set(['demo']))).toBe('demo-copy-2')
    expect(nextCopyId('demo-copy-2', new Set(['demo', 'demo-copy', 'demo-copy-2']))).toBe(
      'demo-copy-3',
    )
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

  it('carries the description into the save payload and drops it when cleared', async () => {
    const withText = fakeApi()
    const described = patchDefinition(opened(), { description: 'A visible summary.' })
    expect(described.document.definition.description).toBe('A visible summary.')
    await save(described, { api: withText.api, taken: TAKEN })
    expect(withText.calls.saveDefinition[0]?.definition.description).toBe('A visible summary.')

    const clearedApi = fakeApi()
    const cleared = patchDefinition(opened(), { description: undefined })
    expect(cleared.document.definition.description).toBeUndefined()
    await save(cleared, { api: clearedApi.api, taken: TAKEN })
    const sent = clearedApi.calls.saveDefinition[0]?.definition
    expect(sent === undefined || 'description' in sent).toBe(false)
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

  it('keeps the current node positions in a saved copy and stays dirty if it fails', async () => {
    const { api, store } = fakeApi()
    const moved = moveStep(opened(), nodeIdOf('one'), { x: 999, y: 888 })
    const copied = await saveAsCopy(moved, { api, taken: TAKEN })
    expect(copied.status).toBe('saved')
    const layout = store.layouts.get('demo-copy')?.layout as {
      id: string
      positions: Record<string, { x: number; y: number }>
    }
    expect(layout.id).toBe('demo-copy')
    expect(layout.positions['one']).toEqual({ x: 999, y: 888 })

    const failing = await saveAsCopy(moved, {
      api: fakeApi({
        save: () => ({ ok: false, kind: 'conflict', status: 409, revision: 'rev-1' }),
      }).api,
      taken: TAKEN,
    })
    expect(failing.document.revision).toBeNull()
    expect(failing.dirty).toBe(true)

    // The definition save succeeded and only the layout failed: the copy has
    // already replaced the open document and reports it, so the view must
    // reload runs for the copy rather than keep the original's.
    const layoutFailed = await saveAsCopy(moved, {
      api: fakeApi({
        layout: () => ({ ok: false, kind: 'conflict', status: 409, revision: 'layout-rev' }),
      }).api,
      taken: TAKEN,
    })
    expect(layoutFailed.status).toBe('error')
    expect(layoutFailed.document.definition.id).toBe('demo-copy')
    expect(layoutFailed.document.revision).not.toBeNull()
    // An edit during the request keeps the original document; its runs must
    // stay selected instead of the ignored copy's.
    const editedDuringCopy = patchStep(moved, nodeIdOf('one'), { title: 'Edited during copy' })
    const retained = reconcileCopy(moved, editedDuringCopy, layoutFailed)
    expect(retained.document.definition.id).toBe('demo')
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
    // The positions are still unsaved, so a navigation must warn.
    expect(result.dirty).toBe(true)
  })

  it('refuses to save a read-only plugin definition', async () => {
    const { api } = fakeApi()
    const state = openDocument({
      definition,
      revision: null,
      source: 'plugin',
    })
    const result = await save(state, { api, taken: TAKEN })
    expect(result.status).toBe('error')
    expect(result.message).toContain('read-only')
  })

  it('keeps the draft when a transport failure rejects the save', async () => {
    const { api, store } = fakeApi({
      save: () => {
        throw new Error('the network is offline')
      },
    })
    const dirty = patchStep(opened(), nodeIdOf('one'), { title: 'Mine' })
    const result = await save(dirty, { api, taken: TAKEN })
    expect(result.status).toBe('error')
    expect(result.message).toContain('offline')
    expect(result.dirty).toBe(true)
    expect(result.document.definition.steps[0]?.title).toBe('Mine')
    expect(store.definitions.get('demo')?.definition).toEqual(definition)
  })

  it('reconciles an edit made while the save was in flight', () => {
    const captured = opened()
    const current = patchStep(captured, nodeIdOf('one'), { title: 'During save' })
    const saved: EditorState = {
      ...captured,
      document: {
        ...captured.document,
        definition: { ...captured.document.definition, version: 5 },
        revision: 'rev-9',
        source: 'local',
      },
      diagram: {
        ...captured.diagram,
        definition: { ...captured.diagram.definition, version: 5 },
      },
      dirty: false,
      status: 'saved',
    }
    expect(reconcileSave(captured, captured, saved)).toBe(saved)
    const merged = reconcileSave(captured, current, saved)
    expect(merged.document.definition.steps[0]?.title).toBe('During save')
    expect(merged.document.revision).toBe('rev-9')
    expect(merged.document.definition.version).toBe(5)
    expect(merged.dirty).toBe(true)
  })

  it('adopts the saved layout revision when reconciling an in-flight edit', async () => {
    const { api, calls } = fakeApi()
    const captured = opened()
    const first = await save(captured, { api, taken: TAKEN })
    expect(first.layoutRevision).toBe('layout-3')
    const current = patchStep(captured, nodeIdOf('one'), { title: 'During save' })
    const merged = reconcileSave(captured, current, first)
    expect(merged.layoutRevision).toBe('layout-3')
    // The newer positions can be saved with the file revision from the first save.
    const second = await save(merged, { api, taken: TAKEN })
    expect(calls.saveLayout.at(-1)?.expected).toBe('layout-3')
    expect(second.status).toBe('saved')
  })

  it('keeps a dirty draft when the discard confirmation is declined', () => {
    const { store, calls } = fakeApi()
    const dirty = patchStep(opened(), nodeIdOf('one'), { title: 'Mine' })
    const declined = vi.fn(() => false)
    expect(leaveEditor(dirty, declined)).toBe(false)
    expect(declined).toHaveBeenCalledTimes(1)
    expect(dirty.dirty).toBe(true)
    expect(dirty.document.definition.steps[0]?.title).toBe('Mine')
    // Declining leaves the draft and writes neither the definition nor the layout.
    expect(calls.saveDefinition).toHaveLength(0)
    expect(calls.saveLayout).toHaveLength(0)
    expect(store.definitions.get('demo')?.definition).toEqual(definition)
    // Accepting, a clean document, and no document all allow the leave.
    expect(
      leaveEditor(
        dirty,
        vi.fn(() => true),
      ),
    ).toBe(true)
    expect(leaveEditor(opened(), declined)).toBe(true)
    expect(leaveEditor(undefined, declined)).toBe(true)
  })

  it('preserves positions when recovering with the next free id', () => {
    const dirty = moveStep(opened(), nodeIdOf('one'), { x: 999, y: 888 })
    const next = renameToNextId(dirty, 'demo-2')
    expect(next.document.definition.id).toBe('demo-2')
    expect(next.document.revision).toBeNull()
    expect(next.layoutRevision).toBeNull()
    expect(next.layout.id).toBe('demo-2')
    expect(next.diagram.nodes.find((node) => node.step?.id === 'one')?.position).toEqual({
      x: 999,
      y: 888,
    })
    expect(next.dirty).toBe(true)
  })

  it('keeps a failed save conflict when reconciling an in-flight edit', () => {
    const captured = opened()
    const current = patchStep(captured, nodeIdOf('one'), { title: 'During save' })
    const failed: EditorState = {
      ...captured,
      dirty: true,
      status: 'error',
      conflict: { kind: 'create', currentRevision: 'rev-1', nextId: 'demo-copy' },
      message: 'the id already exists',
    }
    const merged = reconcileSave(captured, current, failed)
    expect(merged.dirty).toBe(true)
    expect(merged.conflict).toMatchObject({ kind: 'create', nextId: 'demo-copy' })
    expect(merged.message).toContain('already exists')
    expect(merged.document.definition.steps[0]?.title).toBe('During save')
  })

  it('keeps newer edits in the original draft when a copy completes', async () => {
    const { api } = fakeApi()
    const captured = opened()
    const current = patchStep(captured, nodeIdOf('one'), { title: 'During copy' })
    const copyResult = await saveAsCopy(captured, { api, taken: TAKEN })
    const merged = reconcileCopy(captured, current, copyResult)
    expect(merged.document.definition.id).toBe('demo')
    expect(merged.document.definition.steps[0]?.title).toBe('During copy')
    expect(merged.dirty).toBe(true)
    expect(reconcileCopy(captured, captured, copyResult)).toBe(copyResult)

    const failedCopy: EditorState = {
      ...captured,
      dirty: true,
      status: 'error',
      conflict: { kind: 'create', currentRevision: 'rev-1', nextId: 'demo-copy-2' },
      message: 'the id already exists',
    }
    const recovering = reconcileCopy(captured, current, failedCopy)
    expect(recovering.conflict).toMatchObject({ kind: 'create', nextId: 'demo-copy-2' })
    expect(recovering.message).toContain('already exists')
    expect(recovering.document.definition.steps[0]?.title).toBe('During copy')
    expect(recovering.dirty).toBe(true)

    const withFieldError: EditorState = {
      ...failedCopy,
      issues: [{ path: 'settings.maxBlocks', message: 'must be a positive integer', kind: 'host' }],
    }
    const moved = moveStep(captured, nodeIdOf('one'), { x: 5, y: 6 })
    const mergedMove = reconcileCopy(captured, moved, withFieldError)
    expect(mergedMove.issues.some((issue) => issue.kind === 'host')).toBe(true)
    const edited = patchStep(captured, nodeIdOf('one'), { title: 'Fixed' })
    expect(reconcileCopy(captured, edited, withFieldError).issues).toEqual([])
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
    expect(result.issues[0]).toMatchObject({
      nodeId: nodeIdOf('two'),
      path: 'steps[1].title',
      kind: 'host',
    })
    expect(result.issues[0]?.message).toContain('non-empty string')
    expect(issueLabel(result.issues[0] as never)).toBe(`${nodeIdOf('two')}: steps[1].title`)
  })

  it('retries after a host error once the named field is corrected', async () => {
    let attempt = 0
    const { api, calls } = fakeApi({
      save: () => {
        attempt += 1
        return attempt === 1
          ? {
              ok: false,
              kind: 'invalid',
              status: 400,
              errors: [{ path: 'name', message: 'must be a non-empty string' }],
            }
          : { ok: true, revision: 'rev-2' }
      },
    })
    const rejected = await save(opened(), { api, taken: TAKEN })
    expect(rejected.issues[0]).toMatchObject({ path: 'name', kind: 'host' })
    const corrected = patchDefinition(rejected, { name: 'Fixed name' })
    expect(corrected.issues).toEqual([])
    // Saving the corrected definition retries the host instead of blocking on
    // the stale field error.
    const retried = await save(corrected, { api, taken: TAKEN })
    expect(retried.status).toBe('saved')
    expect(calls.saveDefinition).toHaveLength(2)
  })

  it('refuses a structurally invalid save-as-copy without writing', async () => {
    const { api, calls } = fakeApi()
    const graph = opened()
    const withoutNext = updateGraph(
      graph,
      graph.diagram.nodes,
      graph.diagram.edges.filter(
        (edge) => !(edge.source === nodeIdOf('one') && edge.kind === 'next'),
      ),
    )
    expect(withoutNext.issues.some((issue) => issue.kind === 'structural')).toBe(true)
    const result = await saveAsCopy(withoutNext, { api, taken: TAKEN })
    expect(result.status).toBe('error')
    expect(result.issues.some((issue) => issue.kind === 'structural')).toBe(true)
    expect(calls.saveDefinition).toHaveLength(0)

    const dangling = updateGraph(graph, graph.diagram.nodes, [
      ...graph.diagram.edges,
      { id: 'ghost', source: nodeIdOf('one'), target: 'ghost', kind: 'next' },
    ])
    expect(dangling.status).toBe('error')
    const danglingCopy = await saveAsCopy(dangling, { api, taken: TAKEN })
    expect(danglingCopy.status).toBe('error')
    expect(calls.saveDefinition).toHaveLength(0)
  })

  it('keeps a pending host field error when only a node moved during save', () => {
    const captured = opened()
    const failed: EditorState = {
      ...captured,
      dirty: true,
      status: 'error',
      issues: [
        {
          nodeId: nodeIdOf('one'),
          path: 'steps[0].title',
          message: 'must not be empty',
          kind: 'host',
        },
      ],
      message: 'the host refused the definition',
    }
    const moved = moveStep(captured, nodeIdOf('one'), { x: 1, y: 2 })
    const merged = reconcileSave(captured, moved, failed)
    expect(merged.issues.some((issue) => issue.kind === 'host')).toBe(true)
    const edited = patchStep(captured, nodeIdOf('one'), { title: 'Fixed' })
    const dropped = reconcileSave(captured, edited, failed)
    expect(dropped.issues).toEqual([])
  })

  it('adds a palette step as an unconnected node the pre-check names', () => {
    const state = addStep(opened(), 'human')
    const added = state.diagram.nodes.find((node) => node.kind === 'human')
    expect(added).toBeDefined()
    expect(state.issues.some((issue) => issue.nodeId === added?.id)).toBe(true)
  })

  it('creates a valid main step from the palette', () => {
    let state = addStep(openNew(blankDefinition(new Set(['palette-demo']))), 'step')
    expect(state.document.definition.steps[1]?.executor).toBe('main')
    state = patchStep(state, nodeIdOf('step-2'), {
      prompt: 'Do it.',
      evidence: { kind: 'declaration' },
      nonCritical: true,
    })
    state = connectSteps(state, nodeIdOf('step-1'), nodeIdOf('step-2'), 'next')
    state = connectSteps(state, nodeIdOf('step-2'), END_NODE, 'next')
    expect(state.issues).toEqual([])
    expect(
      validateDefinition(state.document.definition).steps.map((step) => step.executor),
    ).toEqual(['main', 'main'])
  })

  it('keeps a connected next target across an executor change', () => {
    let state = opened()
    // The fixture already points one at two; connect it to end so a stale node
    // target (two) would be visibly different from the intended target.
    state = connectSteps(state, nodeIdOf('one'), END_NODE, 'next')
    const connected = state.document.definition.steps.find((step) => step.id === 'one')
    expect(connected?.next).toBe('end')
    state = patchStep(state, nodeIdOf('one'), { executor: 'human' })
    expect(state.document.definition.steps[0]?.next).toBe('end')
    expect(validateDefinition(state.document.definition).steps[0]?.next).toBe('end')
  })

  it('normalizes required configuration when the executor changes', () => {
    let state = opened()
    state = patchStep(state, nodeIdOf('one'), { executor: 'branch' })
    expect(state.document.definition.steps[0]?.branch).toMatchObject({
      // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
      then: 'end',
      else: 'end',
    })
    expect(state.document.definition.steps[0]?.next).toBeUndefined()
    expect(validateDefinition(state.document.definition).steps[0]?.executor).toBe('branch')
    state = patchStep(state, nodeIdOf('one'), { executor: 'main' })
    expect(state.document.definition.steps[0]?.branch).toBeUndefined()
    expect(state.document.definition.steps[0]?.next).toBe('end')
    expect(validateDefinition(state.document.definition).steps[0]?.executor).toBe('main')
  })

  it('applies add, connect, field edit, and delete to the definition', () => {
    let state = addStep(opened(), 'human')
    const added = state.diagram.nodes.at(-1)
    if (added === undefined) throw new Error('missing added node')
    state = patchStep(state, added.id, { title: 'Confirm with the owner' })
    expect(state.document.definition.steps.at(-1)?.title).toBe('Confirm with the owner')
    state = connectSteps(state, added.id, nodeIdOf('two'), 'next')
    expect(
      state.diagram.edges.some(
        (edge) => edge.source === added.id && edge.target === nodeIdOf('two'),
      ),
    ).toBe(true)
    const before = state.document.definition.steps.length
    state = deleteStep(state, added.id)
    expect(state.document.definition.steps).toHaveLength(before - 1)
    expect(state.diagram.nodes.some((node) => node.id === added.id)).toBe(false)
    expect(state.diagram.edges.some((edge) => edge.source === added.id)).toBe(false)
  })
})
