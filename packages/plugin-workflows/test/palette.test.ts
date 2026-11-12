import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { TAB_ORDER } from '../src/client/a11y.ts'
import { connectChoices, currentTarget, EDGE_LABELS, outputKinds } from '../src/client/edges.ts'
import {
  addStep,
  addStepForExecutor,
  blankDefinition,
  connectSteps,
  deleteStep,
  type EditorApi,
  type EditorState,
  openNew,
  patchDefinition,
  patchStep,
  renameStepId,
  save,
  setMode,
  setTriggerKind,
} from '../src/client/editor.ts'
import {
  autoPositions,
  definitionToGraph,
  END_NODE,
  type GraphDefinition,
  type GraphStep,
  nodeIdOf,
  TRIGGER_NODE,
} from '../src/client/graph.ts'
import { withLayout } from '../src/client/layout.ts'
import { overlayFor, withOverlay } from '../src/client/overlay.ts'
import type { RunView } from '../src/client/panel.tsx'
import { validateDefinition } from '../src/host/definitions.ts'
import {
  call,
  type Element,
  elements,
  fire,
  loadClientModules,
  packageDir,
  text,
} from './client-harness.ts'

const ui = loadClientModules([
  'palette.tsx',
  'properties.tsx',
  'list.tsx',
  'canvas.tsx',
  'rail.tsx',
])

/** Walk elements without rendering function components, keeping their keys. */
function rawElements(node: unknown, found: Element[] = []): Element[] {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const child of node) rawElements(child, found)
    return found
  }
  const element = node as Element
  if (element.props !== undefined) {
    found.push(element)
    for (const value of Object.values(element.props)) rawElements(value, found)
  }
  return found
}

/** Render a JsonField element (the shared JSON textarea) and return its textarea. */
function jsonTextarea(tree: unknown, label: string): Element | undefined {
  return elements(tree).find(
    (element) => element.type === 'textarea' && element.props['aria-label'] === label,
  )
}

const listRowModel = ui.listRowModel as (
  state: EditorState,
  step: GraphStep,
) => Readonly<Record<string, string>>

const patchListField = ui.patchListField as (
  graphId: string,
  step: GraphStep,
  field: string,
  value: string,
  onPatch: (stepId: string, patch: Readonly<Record<string, unknown>>) => void,
) => void

function byId(found: Element[], id: string): Element | undefined {
  return found.find((element) => element.type === 'handle' && element.props.id === id)
}

const DEFINITION = JSON.parse(
  readFileSync(
    join(packageDir, '..', 'plugin-openspec', 'assets', 'workflows', 'change-intake.json'),
    'utf8',
  ),
) as GraphDefinition

function editor(): EditorState {
  return openNew(DEFINITION)
}

function stubApi(overrides: Partial<EditorApi> = {}): EditorApi {
  return {
    list: async () => ({ definitions: [] }),
    templates: async () => [],
    drafts: async () => [],
    read: async () => ({ definition: DEFINITION, revision: 'rev-1', source: 'local' }),
    readDraft: async () => DEFINITION,
    readLayout: async () => ({ layout: null, revision: null }),
    saveDefinition: async () => ({ ok: true, revision: 'rev-2' }),
    deleteDefinition: async () => ({ ok: true, revision: 'rev-2' }),
    saveLayout: async () => ({ ok: true, revision: 'layout-1' }),
    runs: async () => [],
    ...overrides,
  }
}

describe('canvas node rendering', () => {
  it('renders the trigger first with a start handle and every step node labelled', () => {
    const trigger = call(ui, 'TriggerNodeView', {
      data: { title: 'turn.stopping', kind: 'trigger' },
    })
    expect(text(trigger)).toContain('Trigger')
    expect(text(trigger)).toContain('turn.stopping')
    expect(byId(elements(trigger), 'start')).toBeDefined()

    const graph = definitionToGraph(DEFINITION)
    expect(graph.nodes[0]?.kind).toBe('trigger')
    const stepNodes = graph.nodes.filter((node) => node.kind !== 'trigger' && node.kind !== 'end')
    expect(stepNodes.map((node) => node.title)).toEqual(DEFINITION.steps.map((step) => step.title))
    const step = call(ui, 'StepNodeView', {
      data: { title: DEFINITION.steps[0]?.title, kind: 'step' },
    })
    expect(byId(elements(step), 'target')).toBeDefined()
    expect(byId(elements(step), 'next')).toBeDefined()
  })

  it('labels the branch outputs true/false and the loop outputs body/exit', () => {
    const branch = call(ui, 'BranchNodeView', { data: { title: 'Choose', kind: 'branch' } })
    expect(byId(elements(branch), 'true')).toBeDefined()
    expect(byId(elements(branch), 'false')).toBeDefined()
    const loop = call(ui, 'LoopNodeView', { data: { title: 'Repeat', kind: 'loop' } })
    expect(byId(elements(loop), 'body')).toBeDefined()
    expect(byId(elements(loop), 'exit')).toBeDefined()
    const human = call(ui, 'HumanNodeView', { data: { title: 'Ask', kind: 'human' } })
    expect(byId(elements(human), 'next')).toBeDefined()
    expect(byId(elements(human), 'exit')).toBeUndefined()

    expect(EDGE_LABELS.true).toBe('true')
    expect(EDGE_LABELS.false).toBe('false')
    expect(outputKinds('branch')).toEqual(['true', 'false'])
    expect(outputKinds('loop')).toEqual(['exit'])
  })

  it('converts graph edges to labelled canvas edges attached to their handles', () => {
    const graph = definitionToGraph(DEFINITION)
    const flow = (
      ui.toFlowEdges as (edges: unknown) => { id: string; label?: string; sourceHandle?: string }[]
    )(graph.edges)
    for (const edge of graph.edges) {
      const converted = flow.find((entry) => entry.id === edge.id)
      expect(converted?.sourceHandle).toBe(edge.kind)
      // Only the branch and loop outputs need a label on the canvas; the
      // start/next edges stay quiet so the default graph is readable.
      if (
        edge.kind === 'true' ||
        edge.kind === 'false' ||
        edge.kind === 'body' ||
        edge.kind === 'exit'
      ) {
        expect(converted?.label).toBe(edge.label)
      } else {
        expect(converted?.label).toBeUndefined()
      }
    }
    const converted = (ui.toFlowEdges as (edges: unknown) => { sourceHandle?: string }[])(
      ['start', 'next', 'true', 'false', 'body', 'exit'].map((kind) => ({
        id: `n:${kind}`,
        source: 'a',
        target: 'b',
        kind,
      })),
    )
    expect(converted.map((edge) => edge.sourceHandle)).toEqual([
      'start',
      'next',
      'true',
      'false',
      'body',
      'exit',
    ])
  })

  it('exposes focusable nodes and edges with accessible names and selection', () => {
    const graph = definitionToGraph(DEFINITION)
    let selectedId: string | undefined
    const tree = call(ui, 'DesignCanvas', {
      nodes: graph.nodes,
      edges: graph.edges,
      selected: nodeIdOf('requirements'),
      focusKey: 'test',
      onSelect: (id: string | undefined) => {
        selectedId = id
      },
      onMove: () => {},
      onConnectNode: () => {},
    })
    const flow = elements(tree).find((element) => element.type === 'reactflow')
    expect(flow?.props.nodesFocusable).toBe(true)
    expect(flow?.props.edgesFocusable).toBe(true)
    const nodes = flow?.props.nodes as {
      id: string
      type: string
      ariaLabel: string
      selected?: boolean
    }[]
    expect(nodes.some((node) => node.type === 'step')).toBe(true)
    const node = nodes.find((node) => node.id === nodeIdOf('requirements'))
    expect(node?.ariaLabel).toBe(DEFINITION.steps.find((step) => step.id === 'requirements')?.title)
    expect(node?.selected).toBe(true)
    // Keyboard selection inside React Flow arrives as a select change, not a
    // node click, and must still update the editor's selection.
    const nodeChanges = flow?.props.onNodesChange as (
      changes: readonly { type: string; id: string; selected: boolean }[],
    ) => void
    nodeChanges([
      { type: 'select', id: nodeIdOf('architecture'), selected: true },
      { type: 'select', id: nodeIdOf('requirements'), selected: false },
    ])
    expect(selectedId).toBe(nodeIdOf('architecture'))
    // Deselecting without selecting another node clears the selection.
    nodeChanges([{ type: 'select', id: nodeIdOf('architecture'), selected: false }])
    expect(selectedId).toBeUndefined()
    const selection = flow?.props.onSelectionChange as (value: { nodes: { id: string }[] }) => void
    selection({ nodes: [{ id: nodeIdOf('approval') }] })
    expect(selectedId).toBe(nodeIdOf('approval'))
    const flowEdges = flow?.props.edges as { ariaLabel: string }[]
    expect(flowEdges.every((edge) => edge.ariaLabel.length > 0)).toBe(true)
    const distinct = (
      ui.toFlowEdges as (
        edges: unknown,
        nodes: { id: string; title: string }[],
      ) => { ariaLabel: string }[]
    )(
      ['true', 'false', 'exit'].map((kind) => ({
        id: `e:${kind}`,
        source: 'a',
        target: 'b',
        kind,
      })),
      [
        { id: 'a', title: 'Check' },
        { id: 'b', title: 'Done' },
      ],
    )
    expect(new Set(distinct.map((edge) => edge.ariaLabel)).size).toBe(3)
    expect(distinct[0]?.ariaLabel).toContain('Check')
  })

  it('drops a step brick on the canvas at the dropped flow position', () => {
    const graph = definitionToGraph(DEFINITION)
    const dropped: { executor: string; position: { x: number; y: number } }[] = []
    const tree = call(ui, 'DesignCanvas', {
      nodes: graph.nodes,
      edges: graph.edges,
      focusKey: 'drop',
      onSelect: () => {},
      onMove: () => {},
      onConnectNode: () => {},
      onDropBrick: (executor: string, position: { x: number; y: number }) =>
        dropped.push({ executor, position }),
    })
    const flow = elements(tree).find((element) => element.type === 'reactflow')
    const wrapper = elements(tree).find((element) => typeof element.props.onDrop === 'function')
    // React Flow reports its live instance on init; the drop converts the screen
    // point through it, so a non-identity transform proves the conversion is used.
    const onInit = flow?.props.onInit as ((instance: unknown) => void) | undefined
    expect(onInit).toBeDefined()
    onInit?.({
      screenToFlowPosition: (point: { x: number; y: number }) => ({
        x: point.x * 2 + 5,
        y: point.y - 3,
      }),
    })
    const drop = wrapper?.props.onDrop as ((event: Record<string, unknown>) => void) | undefined
    expect(drop).toBeDefined()
    const event = (payload: string) => ({
      clientX: 40,
      clientY: 60,
      preventDefault: () => {},
      dataTransfer: { getData: () => payload },
    })
    drop?.(event('step:branch'))
    expect(dropped).toEqual([{ executor: 'branch', position: { x: 85, y: 57 } }])
    // A trigger payload, an unknown executor, and an empty payload are ignored.
    drop?.(event('trigger:fs.change'))
    drop?.(event('step:unknown'))
    drop?.(event(''))
    expect(dropped).toHaveLength(1)
  })

  it('starts a drag only from a step brick and writes the engine payload', () => {
    const tree = call(ui, 'WorkflowRail', {
      definitions: [],
      currentId: 'alpha',
      currentTrigger: 'fs.change',
      t: (key: string) => key,
      onOpen: () => {},
      onTrigger: () => {},
      onExecutor: () => {},
    })
    const found = elements(tree)
    const branch = found.find((element) => element.props['data-block'] === 'branch')
    const data: Record<string, string> = {}
    const onDragStart = branch?.props.onDragStart as ((event: unknown) => void) | undefined
    expect(onDragStart).toBeDefined()
    onDragStart?.({
      dataTransfer: {
        setData: (kind: string, value: string) => {
          data[kind] = value
        },
        effectAllowed: '',
      },
    })
    expect(data['application/x-dsh-wf-brick']).toBe('step:branch')
    // The trigger is a single choice, so it is not draggable.
    const trigger = found.find((element) => element.props['data-block'] === 'fs.change')
    expect(trigger?.props.draggable).not.toBe(true)
    expect(trigger?.props['data-current']).toBe('true')
  })

  it('exposes tab stops on the palette, canvas, and properties in order', () => {
    expect(TAB_ORDER).toEqual(['palette', 'canvas', 'properties'])
    const paletteTree = call(ui, 'PaletteMenu', {
      open: true,
      onOpen: () => {},
      onClose: () => {},
      onAdd: () => {},
    })
    const menu = elements(paletteTree).find((element) => element.type === 'menu')
    expect(menu).toBeDefined()
    expect(menu?.props.open).toBe(true)
    expect(elements(paletteTree).some((element) => element.type === 'button')).toBe(true)
    expect(
      elements(
        call(ui, 'DesignCanvas', {
          nodes: definitionToGraph(DEFINITION).nodes,
          edges: definitionToGraph(DEFINITION).edges,
          focusKey: 'tab',
          onSelect: () => {},
          onMove: () => {},
          onConnectNode: () => {},
        }),
      ).find((element) => element.type === 'reactflow')?.props.nodesFocusable,
    ).toBe(true)
    expect(
      elements(
        call(ui, 'PropertyPanel', {
          state: editor(),
          selected: nodeIdOf('requirements'),
          onDefinitionPatch: () => {},
          onPatch: () => {},
          onConnect: () => {},
          onDelete: () => {},
          onRename: () => {},
        }),
      ).some((element) => element.type === 'input' || element.type === 'textarea'),
    ).toBe(true)
  })

  it('shows the overlay state, failure class, evidence, and violation on a node', () => {
    const rendered = call(ui, 'StepNodeView', {
      data: {
        title: 'One',
        kind: 'step',
        runState: 'blocked',
        failureClass: 'missing-file',
        evidence: { kind: 'file', ref: '.dsh/x.md' },
        violations: ['bypassed'],
      },
    })
    const content = text(rendered)
    expect(content).toContain('blocked')
    expect(content).toContain('missing-file')
    expect(content).toContain('.dsh/x.md')
    expect(content).toContain('bypassed')
    expect(
      elements(rendered).some((element) => element.props['data-run-state'] === 'blocked'),
    ).toBe(true)
  })
})

describe('palette and property panel', () => {
  it('adds a step from the Add step menu', () => {
    const kinds: string[] = []
    let closed = 0
    let opened = 0
    const tree = call(ui, 'PaletteMenu', {
      open: true,
      onOpen: () => (opened += 1),
      onClose: () => (closed += 1),
      onAdd: (kind: string) => kinds.push(kind),
    })
    const menu = elements(tree).find((element) => element.type === 'menu')
    expect(menu).toBeDefined()
    const items = menu?.props.items as Array<{ id: string; label: string }>
    expect(items.map((item) => item.id)).toEqual([
      'main',
      'tool',
      'subagent',
      'human',
      'branch',
      'loop',
    ])
    expect(items.map((item) => item.label)).toEqual([
      'Add step',
      'Add tool',
      'Add subagent',
      'Add human',
      'Add branch',
      'Add loop',
    ])
    ;(menu?.props.onSelect as (id: string) => void)?.('branch')
    expect(kinds).toEqual(['branch'])
    expect(closed).toBe(1)
    fire(
      elements(tree).find((element) => element.type === 'button'),
      'onClick',
    )
    expect(opened).toBe(1)
    // The anchor stays rendered while the menu is closed.
    const closedTree = call(ui, 'PaletteMenu', {
      open: false,
      onOpen: () => {},
      onClose: () => {},
      onAdd: () => {},
    })
    expect(elements(closedTree).find((element) => element.type === 'menu')?.props.open).toBe(false)
  })

  it('edits the definition description and sends undefined when cleared', () => {
    let state = editor()
    const patches: Record<string, unknown>[] = []
    const render = (): unknown =>
      call(ui, 'PropertyPanel', {
        state,
        selected: nodeIdOf('requirements'),
        onDefinitionPatch: (patch: Record<string, unknown>) => {
          patches.push(patch)
          state = patchDefinition(state, patch)
        },
        onPatch: () => {},
        onConnect: () => {},
        onDelete: () => {},
        onRename: () => {},
      })
    const field = (): Element | undefined =>
      elements(render()).find(
        (element) =>
          element.type === 'textarea' && element.props['aria-label'] === 'Definition description',
      )
    expect(field()?.props.value).toBe(DEFINITION.description)
    fire(field(), 'onChange', 'A revised summary.')
    expect(state.document.definition.description).toBe('A revised summary.')
    fire(field(), 'onChange', '')
    expect(state.document.definition.description).toBeUndefined()
    expect(patches).toEqual([{ description: 'A revised summary.' }, { description: undefined }])
  })

  it('renders the workflow rail with the workflow list and both block groups', () => {
    const entries = [
      {
        id: 'alpha',
        name: 'Alpha',
        description: 'First flow.',
        trigger: 'tool.pre-execute',
        version: 1,
        stepCount: 2,
        source: 'shipped' as const,
        revision: null,
      },
      {
        id: 'beta',
        name: 'Beta',
        trigger: 'fs.change',
        version: 2,
        stepCount: 1,
        source: 'local' as const,
        revision: 'rev-1',
      },
    ]
    const opened: string[] = []
    const triggers: string[] = []
    const executors: string[] = []
    const tree = call(ui, 'WorkflowRail', {
      definitions: entries,
      currentId: 'alpha',
      latestRun: { id: 'workflow:run-1', status: 'running' },
      t: (key: string) => key,
      onOpen: (id: string) => opened.push(id),
      onTrigger: (kind: string) => triggers.push(kind),
      onExecutor: (executor: string) => executors.push(executor),
    })
    const found = elements(tree)
    const rows = found.filter(
      (element) => element.type === 'button' && element.props['data-definition'] !== undefined,
    )
    expect(rows).toHaveLength(2)
    expect(text(tree)).toContain('Alpha')
    expect(text(tree)).toContain('First flow.')
    expect(text(tree)).toContain('design.noDescription')
    expect(text(tree)).toContain('definitions.trigger: tool.pre-execute')
    expect(text(tree)).toContain('definitions.trigger: fs.change')
    expect(text(tree)).toContain('overview.latestRun')
    expect(text(tree)).toContain('design.blocksTriggers')
    expect(text(tree)).toContain('design.blocksSteps')
    expect(
      found.filter(
        (element) => element.type === 'button' && element.props['data-block'] !== undefined,
      ),
    ).toHaveLength(12)
    fire(
      rows.find((row) => row.props['data-definition'] === 'beta'),
      'onClick',
    )
    expect(opened).toEqual(['beta'])
    fire(
      found.find((element) => element.props['data-block'] === 'tool'),
      'onClick',
    )
    expect(executors).toEqual(['tool'])
    fire(
      found.find((element) => element.props['data-block'] === 'fs.change'),
      'onClick',
    )
    expect(triggers).toEqual(['fs.change'])
    expect((ui.defaultDefinitionId as (list: unknown[]) => string | undefined)(entries)).toBe(
      'alpha',
    )
    expect((ui.defaultDefinitionId as (list: unknown[]) => string | undefined)([])).toBeUndefined()
  })

  it('renders the named inspector with the definition form when nothing is selected', () => {
    const state = editor()
    const patches: Record<string, unknown>[] = []
    const tree = call(ui, 'PropertyPanel', {
      state,
      onDefinitionPatch: (patch: Record<string, unknown>) => patches.push(patch),
      onPatch: () => {},
      onConnect: () => {},
      onDelete: () => {},
    })
    const found = elements(tree)
    // The form stays a named Properties landmark for screen-reader navigation.
    expect(found.find((element) => element.props['aria-label'] === 'Properties')?.type).toBe(
      'section',
    )
    const name = found.find(
      (element) => element.type === 'input' && element.props['aria-label'] === 'Definition name',
    )
    expect(name?.props.value).toBe(state.document.definition.name)
    expect(
      found.some(
        (element) => element.type === 'input' && element.props['aria-label'] === 'Allowed tools',
      ),
    ).toBe(true)
    expect(text(tree)).toContain('Select a node to edit it.')
    fire(name, 'onChange', 'Renamed workflow')
    expect(patches).toEqual([{ name: 'Renamed workflow' }])
  })

  it('adds every executor block as a definition the host validator accepts', async () => {
    for (const executor of ['main', 'tool', 'subagent', 'human', 'branch', 'loop']) {
      const taken = new Set([`block-${executor}`])
      let state = openNew(blankDefinition(taken))
      state = addStepForExecutor(state, executor)
      const added = state.diagram.nodes.at(-1)
      if (added === undefined) throw new Error(`missing added node for ${executor}`)
      if (added.kind === 'branch') {
        state = connectSteps(state, added.id, END_NODE, 'true')
        state = connectSteps(state, added.id, END_NODE, 'false')
      } else if (added.kind === 'loop') {
        state = connectSteps(state, added.id, END_NODE, 'exit')
      } else {
        state = connectSteps(state, added.id, END_NODE, 'next')
      }
      expect(state.issues, executor).toEqual([])
      const validated = validateDefinition(state.document.definition)
      expect(validated.steps.at(-1)?.executor, executor).toBe(executor)
      if (executor === 'tool') {
        expect(validated.settings.allowTools).toContain('shell')
        expect(validated.steps.at(-1)?.tool).toMatchObject({ name: 'shell' })
        expect(validated.steps.at(-1)?.evidence).toEqual({ kind: 'declaration' })
        expect(validated.steps.at(-1)?.nonCritical).toBe(true)
      }
      const saved = await save(
        { ...state, document: { ...state.document, revision: 'rev-1' } },
        {
          api: stubApi({ saveDefinition: async () => ({ ok: true, revision: 'rev-2' }) }),
          taken,
        },
      )
      expect(saved.status, executor).toBe('saved')
    }
  })

  it('sets the trigger kind from a block and repairs an unsupported dedupe policy', () => {
    let state = openNew(blankDefinition(new Set(['trigger-block'])))
    state = setTriggerKind(state, 'tool.pre-execute')
    expect(state.document.definition.trigger).toMatchObject({
      kind: 'tool.pre-execute',
      dedupe: 'turn',
    })
    expect(state.diagram.nodes.find((node) => node.kind === 'trigger')?.title).toBe(
      'tool.pre-execute',
    )
    expect(validateDefinition(state.document.definition).trigger.kind).toBe('tool.pre-execute')
    // `name` is valid for tool.pre-execute but not for turn.stopping.
    state = patchDefinition(state, {
      trigger: { ...state.document.definition.trigger, dedupe: 'name' },
    })
    state = setTriggerKind(state, 'turn.stopping')
    expect(state.document.definition.trigger.dedupe).toBe('none')
    expect(validateDefinition(state.document.definition).trigger).toMatchObject({
      kind: 'turn.stopping',
      dedupe: 'none',
    })
  })

  it('edits a field, a connection, and deletes from the property panel', () => {
    const patches: { id: string; patch: Record<string, unknown> }[] = []
    const connections: { source: string; target: string; kind: string }[] = []
    const deleted: string[] = []
    const tree = call(ui, 'PropertyPanel', {
      state: editor(),
      selected: nodeIdOf('requirements'),
      onDefinitionPatch: () => {},
      onPatch: (id: string, patch: Record<string, unknown>) => patches.push({ id, patch }),
      onConnect: (source: string, target: string, kind: string) =>
        connections.push({ source, target, kind }),
      onDelete: (id: string) => deleted.push(id),
    })
    const found = elements(tree)
    const titleInput = found.find(
      (element) => element.type === 'input' && element.props['aria-label'] === 'Step title',
    )
    fire(titleInput, 'onChange', 'Business requirements')
    expect(patches[0]).toEqual({
      id: nodeIdOf('requirements'),
      patch: { title: 'Business requirements' },
    })

    const nextSelect = found.find(
      (element) =>
        element.type === 'select' &&
        elements(element).some((option) => option.props.value === nodeIdOf('architecture')),
    )
    expect(nextSelect).toBeDefined()
    fire(nextSelect, 'onChange', nodeIdOf('architecture'))
    expect(connections[0]).toEqual({
      source: nodeIdOf('requirements'),
      target: nodeIdOf('architecture'),
      kind: 'next',
    })

    const deleteButton = found.find(
      (element) => element.type === 'button' && text(element) === 'Delete step',
    )
    fire(deleteButton, 'onClick')
    expect(deleted).toEqual([nodeIdOf('requirements')])
  })

  it('accepts JSON typed incrementally and only commits valid parses', () => {
    const patches: Record<string, unknown>[] = []
    const tree = call(ui, 'PropertyPanel', {
      state: editor(),
      selected: nodeIdOf('requirements'),
      onDefinitionPatch: () => {},
      onPatch: (_id: string, patch: Record<string, unknown>) => patches.push(patch),
      onConnect: () => {},
      onDelete: () => {},
    })
    const evidence = jsonTextarea(tree, 'Evidence JSON')
    expect(evidence?.props.value).toBeDefined()
    fire(evidence, 'onChange', '{')
    expect(patches).toEqual([])
    fire(evidence, 'onChange', '{"kind":"declaration"}')
    expect(patches[0]).toEqual({ evidence: { kind: 'declaration' } })
    // A second valid edit from the same focused field keeps committing.
    fire(evidence, 'onChange', '{"kind":"file","path":"notes.md"}')
    expect(patches[1]).toEqual({ evidence: { kind: 'file', path: 'notes.md' } })
  })

  it('refreshes a JSON field when another control changes the committed value', () => {
    let state = editor()
    const render = (current: EditorState): unknown =>
      call(ui, 'PropertyPanel', {
        state: current,
        selected: nodeIdOf('requirements'),
        onDefinitionPatch: () => {},
        onPatch: () => {},
        onConnect: () => {},
        onDelete: () => {},
        onRename: () => {},
      })
    fire(jsonTextarea(render(state), 'Evidence JSON'), 'onChange', '{"kind":"declaration"}')
    state = patchStep(state, nodeIdOf('requirements'), { evidence: { kind: 'declaration' } })
    expect(jsonTextarea(render(state), 'Evidence JSON')?.props.value).toBe('{"kind":"declaration"}')
    state = patchStep(state, nodeIdOf('requirements'), { executor: 'human' })
    expect(String(jsonTextarea(render(state), 'Evidence JSON')?.props.value)).toContain('"human"')
  })

  it('edits flags, human timeout, loop cap, and the step id with validation', () => {
    let state = openNew(blankDefinition(new Set(['flags-demo'])))
    const render = (current: EditorState, selected: string): unknown =>
      call(ui, 'PropertyPanel', {
        state: current,
        selected,
        onDefinitionPatch: () => {},
        onPatch: (id: string, patch: Record<string, unknown>) => {
          state = patchStep(state, id, patch)
        },
        onConnect: () => {},
        onDelete: () => {},
        onRename: (id: string, nextId: string) => {
          state = renameStepId(state, id, nextId)
        },
      })
    const find = (tree: unknown, label: string): Element | undefined =>
      elements(tree).find(
        (element) =>
          (element.type === 'input' || element.type === 'select') &&
          element.props['aria-label'] === label,
      )
    // A declaration requires non-critical: turning that flag off must be
    // visible to the real validator, and turning it back on must pass.
    const setFlag = (label: string, value: boolean): void => {
      const element = elements(render(state, nodeIdOf('step-1'))).find(
        (entry) => entry.type === 'checkbox' && entry.props.label === label,
      )
      const onChange = element?.props.onChange as ((next: boolean) => void) | undefined
      onChange?.(value)
    }
    setFlag('Non-critical step', false)
    expect(() => validateDefinition(state.document.definition)).toThrow(/nonCritical/u)
    setFlag('Non-critical step', true)
    expect(validateDefinition(state.document.definition).steps[0]?.nonCritical).toBe(true)

    // Renaming the id updates the node and keeps the definition valid.
    fire(find(render(state, nodeIdOf('step-1')), 'Step id'), 'onBlur', 'renamed-step')
    expect(state.document.definition.steps[0]?.id).toBe('renamed-step')
    expect(state.diagram.nodes.some((node) => node.id === nodeIdOf('renamed-step'))).toBe(true)
    expect(validateDefinition(state.document.definition).steps[0]?.id).toBe('renamed-step')

    // Human timeout and loop cap are editable and validate.
    state = patchStep(state, nodeIdOf('renamed-step'), { executor: 'human' })
    fire(
      find(render(state, nodeIdOf('renamed-step')), 'Human timeout action'),
      'onChange',
      'cancel',
    )
    expect(state.document.definition.steps[0]?.human?.timeoutAction).toBe('cancel')
    expect(validateDefinition(state.document.definition).steps[0]?.human?.timeoutAction).toBe(
      'cancel',
    )
    state = patchStep(state, nodeIdOf('renamed-step'), { executor: 'loop' })
    fire(find(render(state, nodeIdOf('renamed-step')), 'Loop cap'), 'onChange', 'failed')
    expect(state.document.definition.steps[0]?.loop?.cap).toBe('failed')
    expect(validateDefinition(state.document.definition).steps[0]?.loop?.cap).toBe('failed')
  })

  it('creates a validated tool workflow from the shared forms', () => {
    let state = openNew(blankDefinition(new Set(['tool-demo'])))
    const render = (): unknown =>
      call(ui, 'PropertyPanel', {
        state,
        selected: nodeIdOf('step-1'),
        onDefinitionPatch: (patch: Record<string, unknown>) => {
          state = patchDefinition(state, patch)
        },
        onPatch: (id: string, patch: Record<string, unknown>) => {
          state = patchStep(state, id, patch)
        },
        onConnect: () => {},
        onDelete: () => {},
        onRename: () => {},
      })
    const find = (label: string): Element | undefined =>
      elements(render()).find(
        (element) =>
          (element.type === 'input' || element.type === 'select' || element.type === 'textarea') &&
          element.props['aria-label'] === label,
      )
    fire(find('Allowed tools'), 'onChange', 'shell')
    expect(state.document.definition.settings.allowTools).toEqual(['shell'])
    fire(find('Executor'), 'onChange', 'tool')
    expect(state.document.definition.steps[0]?.executor).toBe('tool')
    fire(
      jsonTextarea(render(), 'Tool config JSON'),
      'onChange',
      '{"name":"shell","command":"echo ok"}',
    )
    expect(state.document.definition.steps[0]?.tool).toMatchObject({
      name: 'shell',
      command: 'echo ok',
    })
    const validated = validateDefinition(state.document.definition)
    expect(validated.steps[0]?.executor).toBe('tool')
    expect(validated.settings.allowTools).toEqual(['shell'])
  })

  it('edits ownership, legacy, and the remaining trigger fields with validation', () => {
    let state = openNew(blankDefinition(new Set(['fields-demo'])))
    const render = (): unknown =>
      call(ui, 'PropertyPanel', {
        state,
        selected: nodeIdOf('step-1'),
        onDefinitionPatch: (patch: Record<string, unknown>) => {
          state = patchDefinition(state, patch)
        },
        onPatch: (id: string, patch: Record<string, unknown>) => {
          state = patchStep(state, id, patch)
        },
        onConnect: () => {},
        onDelete: () => {},
        onRename: () => {},
      })
    const find = (label: string): Element | undefined =>
      elements(render()).find(
        (element) =>
          (element.type === 'input' || element.type === 'select' || element.type === 'textarea') &&
          element.props['aria-label'] === label,
      )
    fire(find('Step ownership'), 'onChange', 'defer')
    fire(
      jsonTextarea(render(), 'Step legacy JSON'),
      'onChange',
      '{"plugin":"delegation-rules","signal":"task-review"}',
    )
    expect(state.document.definition.steps[0]?.ownership).toBe('defer')
    expect(state.document.definition.steps[0]?.legacy).toEqual({
      plugin: 'delegation-rules',
      signal: 'task-review',
    })
    expect(validateDefinition(state.document.definition).steps[0]?.ownership).toBe('defer')
    const renderTrigger = (): unknown =>
      call(ui, 'PropertyPanel', {
        state,
        selected: TRIGGER_NODE,
        onDefinitionPatch: (patch: Record<string, unknown>) => {
          state = patchDefinition(state, patch)
        },
        onPatch: () => {},
        onConnect: () => {},
        onDelete: () => {},
      })
    const trigger = (label: string): Element | undefined =>
      elements(renderTrigger()).find(
        (element) =>
          (element.type === 'input' || element.type === 'select') &&
          element.props['aria-label'] === label,
      )
    const repeatFlag = elements(renderTrigger()).find(
      (element) =>
        element.type === 'checkbox' && element.props.label === 'Repeat on a matching event',
    )
    const setRepeat = repeatFlag?.props.onChange as ((next: boolean) => void) | undefined
    setRepeat?.(true)
    fire(trigger('Trigger applicability'), 'onChange', 'checkpoint-required')
    expect(state.document.definition.trigger).toMatchObject({
      repeat: true,
      applicability: 'checkpoint-required',
    })
    expect(validateDefinition(state.document.definition).trigger.repeat).toBe(true)
  })

  it('scopes a JSON draft identity to the selected node', () => {
    let state = addStep(openNew(blankDefinition(new Set(['keys-demo']))), 'step')
    state = patchStep(state, nodeIdOf('step-2'), {
      prompt: 'Two.',
      evidence: { kind: 'declaration' },
      nonCritical: true,
    })
    const fieldKey = (selected: string): string | undefined => {
      const tree = call(ui, 'PropertyPanel', {
        state,
        selected,
        onDefinitionPatch: () => {},
        onPatch: () => {},
        onConnect: () => {},
        onDelete: () => {},
        onRename: () => {},
      })
      return rawElements(tree).find((element) => element.props['ariaLabel'] === 'Evidence JSON')
        ?.key
    }
    const first = fieldKey(nodeIdOf('step-1'))
    const second = fieldKey(nodeIdOf('step-2'))
    expect(first).toContain(nodeIdOf('step-1'))
    expect(second).toContain(nodeIdOf('step-2'))
    expect(first).not.toBe(second)
  })

  it('clears optional settings and loop fields without an unsavable definition', () => {
    let state = openNew(blankDefinition(new Set(['clear-demo'])))
    const render = (): unknown =>
      call(ui, 'PropertyPanel', {
        state,
        selected: nodeIdOf('step-1'),
        onDefinitionPatch: (patch: Record<string, unknown>) => {
          state = patchDefinition(state, patch)
        },
        onPatch: (id: string, patch: Record<string, unknown>) => {
          state = patchStep(state, id, patch)
        },
        onConnect: () => {},
        onDelete: () => {},
        onRename: () => {},
      })
    const find = (label: string): Element | undefined =>
      elements(render()).find(
        (element) =>
          (element.type === 'input' || element.type === 'select') &&
          element.props['aria-label'] === label,
      )
    fire(find('Allowed tools'), 'onChange', 'shell')
    expect(state.document.definition.settings.allowTools).toEqual(['shell'])
    fire(find('Allowed tools'), 'onChange', '')
    expect(state.document.definition.settings.allowTools).toBeUndefined()
    expect(validateDefinition(state.document.definition).settings.allowTools).toBeUndefined()
    state = patchStep(state, nodeIdOf('step-1'), { executor: 'loop' })
    fire(find('Loop list key'), 'onChange', 'items')
    expect(state.document.definition.steps[0]?.loop?.list).toBe('items')
    fire(find('Loop list key'), 'onChange', '')
    expect(state.document.definition.steps[0]?.loop?.list).toBeUndefined()
    expect(validateDefinition(state.document.definition).steps[0]?.loop?.list).toBeUndefined()
    fire(
      elements(render()).find(
        (element) => element.type === 'textarea' && element.props['aria-label'] === 'Prompt',
      ),
      'onChange',
      '',
    )
    expect(state.document.definition.steps[0]?.prompt).toBeUndefined()
    expect(validateDefinition(state.document.definition).steps[0]?.prompt).toBeUndefined()
  })

  it('offers the human timeout for a valid human step without a config object', () => {
    let state = openNew(blankDefinition(new Set(['human-demo'])))
    state = patchStep(state, nodeIdOf('step-1'), { executor: 'human' })
    state = patchStep(state, nodeIdOf('step-1'), { human: undefined })
    expect(state.document.definition.steps[0]?.human).toBeUndefined()
    expect(validateDefinition(state.document.definition).steps[0]?.executor).toBe('human')
    const tree = call(ui, 'PropertyPanel', {
      state,
      selected: nodeIdOf('step-1'),
      onDefinitionPatch: () => {},
      onPatch: (id: string, patch: Record<string, unknown>) => {
        state = patchStep(state, id, patch)
      },
      onConnect: () => {},
      onDelete: () => {},
      onRename: () => {},
    })
    const timeout = elements(tree).find(
      (element) =>
        element.type === 'select' && element.props['aria-label'] === 'Human timeout action',
    )
    fire(timeout, 'onChange', 'cancel')
    expect(state.document.definition.steps[0]?.human?.timeoutAction).toBe('cancel')
    expect(validateDefinition(state.document.definition).steps[0]?.human?.timeoutAction).toBe(
      'cancel',
    )
  })

  it('selects an overlaid node through the canvas click and opens its property panel', () => {
    const state = editor()
    const step = DEFINITION.steps.find((entry) => entry.id === 'requirements')
    if (step === undefined) throw new Error('missing template step')
    const run: RunView = {
      id: 'workflow:run-1',
      source: 'workflow',
      session: 'session-1',
      attribution: 'local',
      title: 'change-intake intake',
      startedAt: 1,
      status: 'running',
      definition: { id: 'change-intake', name: 'OpenSpec change intake', version: 1 },
      steps: [
        {
          id: step.id,
          title: step.title,
          state: 'blocked',
          failureClass: 'no-answer',
        },
      ],
      violations: [{ stepId: step.id, at: 2, reason: 'bypassed' }],
    }
    const nodes = withOverlay(state.diagram.nodes, overlayFor(run, state.document.definition))
    let selectedId: string | undefined
    const writes: unknown[] = []
    const tree = call(ui, 'DesignCanvas', {
      nodes,
      edges: state.diagram.edges,
      focusKey: 'canvas',
      onSelect: (id: string | undefined) => {
        selectedId = id
      },
      onMove: (id: string) => writes.push(id),
      onConnectNode: (id: string) => writes.push(id),
    })
    const flow = rawElements(tree).find(
      (element) =>
        typeof element.type === 'function' && typeof element.props['onNodeClick'] === 'function',
    )
    const click = flow?.props['onNodeClick'] as
      | ((event: unknown, node: { id: string }) => void)
      | undefined
    if (click === undefined) throw new Error('no node click handler')
    click({}, { id: nodeIdOf(step.id) })
    expect(selectedId).toBe(nodeIdOf(step.id))
    expect(writes).toEqual([])
    expect(nodes.find((node) => node.step?.id === step.id)).toMatchObject({
      runState: 'blocked',
      failureClass: 'no-answer',
      violations: ['bypassed'],
    })
    const panel = call(ui, 'PropertyPanel', {
      state,
      selected: selectedId,
      onDefinitionPatch: () => {},
      onPatch: () => {},
      onConnect: () => {},
      onDelete: () => {},
      onRename: () => {},
    })
    expect(
      elements(panel).find((element) => element.props['aria-label'] === 'Step title')?.props.value,
    ).toBe(step.title)
    // The interaction must not start a run or a tool or write the run record.
    const runFile = join(tmpdir(), `dsh-wf-run-${String(process.pid)}.json`)
    const runBytes = `${JSON.stringify(run, null, 2)}\n`
    writeFileSync(runFile, runBytes)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      click({}, { id: nodeIdOf(step.id) })
      call(ui, 'PropertyPanel', {
        state,
        selected: selectedId,
        onDefinitionPatch: () => {},
        onPatch: () => {},
        onConnect: () => {},
        onDelete: () => {},
        onRename: () => {},
      })
      expect(readFileSync(runFile, 'utf8')).toBe(runBytes)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
      rmSync(runFile, { force: true })
    }
  })

  it('opens the property panel for the selected node', () => {
    const state = editor()
    const step = DEFINITION.steps[1]
    if (step === undefined) throw new Error('missing template step')
    const tree = call(ui, 'PropertyPanel', {
      state,
      selected: nodeIdOf(step.id),
      onDefinitionPatch: () => {},
      onPatch: () => {},
      onConnect: () => {},
      onDelete: () => {},
    })
    const title = elements(tree).find(
      (element) => element.type === 'input' && element.props['aria-label'] === 'Step title',
    )
    expect(title?.props.value).toBe(step.title)
  })

  it('patches a step through the shared state machine', () => {
    const patched = patchStep(editor(), nodeIdOf('approval'), { title: 'Owner sign-off' })
    expect(patched.document.definition.steps.at(-1)?.title).toBe('Owner sign-off')
    expect(patched.dirty).toBe(true)
  })
})

describe('list mode', () => {
  it('exposes the same step values and parses every list field', () => {
    const state = editor()
    const step = DEFINITION.steps[0]
    if (step === undefined) throw new Error('missing template step')
    expect(listRowModel(state, step)).toMatchObject({
      id: 'requirements',
      executor: 'main',
      evidenceKind: 'file',
      'connection:next': nodeIdOf('architecture'),
    })
    const patches: Record<string, unknown>[] = []
    patchListField(nodeIdOf('requirements'), step, 'title', 'Requirements', (_id, patch) =>
      patches.push(patch),
    )
    patchListField(nodeIdOf('requirements'), step, 'evidenceKind', 'declaration', (_id, patch) =>
      patches.push(patch),
    )
    patchListField(nodeIdOf('requirements'), step, 'prompt', 'Do it', (_id, patch) =>
      patches.push(patch),
    )
    patchListField(nodeIdOf('requirements'), step, 'prompt', '', (_id, patch) =>
      patches.push(patch),
    )
    patchListField(nodeIdOf('requirements'), step, 'loopMaxIterations', '4', (_id, patch) =>
      patches.push(patch),
    )
    expect(patches).toEqual([
      { title: 'Requirements' },
      { evidence: { kind: 'declaration' } },
      { prompt: 'Do it' },
      { prompt: undefined },
    ])
  })

  it('creates the same two-step definition from the list fields and the canvas', () => {
    const taken = new Set<string>(['canvas-demo', 'list-demo'])
    const canvas = connectSteps(
      connectSteps(
        addStep(openNew({ ...blankDefinition(taken), id: 'canvas-demo' }), 'step'),
        nodeIdOf('step-1'),
        nodeIdOf('step-2'),
        'next',
      ),
      nodeIdOf('step-2'),
      END_NODE,
      'next',
    )
    let list = openNew({ ...blankDefinition(taken), id: 'list-demo', name: 'List demo' })
    const first = list.document.definition.steps[0]
    if (first === undefined) throw new Error('missing blank step')
    patchListField(nodeIdOf('step-1'), first, 'title', 'First step', (id, patch) => {
      list = patchStep(list, id, patch)
    })
    list = addStep(list, 'step')
    list = connectSteps(
      connectSteps(list, nodeIdOf('step-1'), nodeIdOf('step-2'), 'next'),
      nodeIdOf('step-2'),
      END_NODE,
      'next',
    )
    expect(canvas.document.definition.steps.map((step) => step.id)).toEqual(['step-1', 'step-2'])
    expect(list.document.definition.steps.map((step) => step.id)).toEqual(['step-1', 'step-2'])
    expect(canvas.issues).toEqual([])
    expect(list.issues).toEqual([])
    expect(list.document.definition.steps[0]?.title).toBe('First step')
  })

  it('shares the editor state and save path with the canvas', async () => {
    const expected: (string | null)[] = []
    const state = setMode(
      { ...editor(), document: { ...editor().document, revision: 'rev-1' } },
      'list',
    )
    const saved = await save(state, {
      api: stubApi({
        saveDefinition: async (_id, definition, revision) => {
          expected.push(revision)
          expect(definition.version).toBe(DEFINITION.version + 1)
          return { ok: true, revision: 'rev-2' }
        },
      }),
      taken: new Set([DEFINITION.id]),
    })
    expect(expected).toEqual(['rev-1'])
    expect(saved.status).toBe('saved')
  })
  it('edits the trigger and start connection from the list and repairs a deletion', () => {
    let state = addStep(openNew(blankDefinition(new Set(['list-trigger']))), 'step')
    state = patchStep(state, nodeIdOf('step-2'), {
      prompt: 'Two.',
      evidence: { kind: 'declaration' },
      nonCritical: true,
    })
    state = connectSteps(state, nodeIdOf('step-1'), nodeIdOf('step-2'), 'next')
    state = connectSteps(state, nodeIdOf('step-2'), END_NODE, 'next')
    expect(state.issues).toEqual([])
    const list = (): unknown =>
      call(ui, 'ListEditor', {
        state,
        onSelect: () => {},
        onDefinitionPatch: (patch: Record<string, unknown>) => {
          state = patchDefinition(state, patch)
        },
        onPatch: (id: string, patch: Record<string, unknown>) => {
          state = patchStep(state, id, patch)
        },
        onConnect: (source: string, target: string, kind: 'start' | 'next') => {
          state = connectSteps(state, source, target, kind)
        },
        onDelete: (id: string) => {
          state = deleteStep(state, id)
        },
      })
    const select = (label: string): Element | undefined =>
      elements(list()).find(
        (element) => element.type === 'select' && element.props['aria-label'] === label,
      )
    fire(
      elements(list()).find(
        (element) => element.type === 'input' && element.props['aria-label'] === 'Trigger kind',
      ),
      'onChange',
      'turn.stopping',
    )
    expect(state.document.definition.trigger.kind).toBe('turn.stopping')
    fire(
      elements(list()).find(
        (element) =>
          element.type === 'textarea' && element.props['aria-label'] === 'Trigger match JSON',
      ),
      'onChange',
      '{"tool":"shell"}',
    )
    expect(state.document.definition.trigger.match).toEqual({ tool: 'shell' })
    fire(
      elements(list()).find(
        (element) => element.type === 'input' && element.props['aria-label'] === 'Trigger repeat',
      ),
      'onChange',
      true,
    )
    fire(select('Trigger applicability'), 'onChange', 'checkpoint-required')
    expect(state.document.definition.trigger).toMatchObject({
      repeat: true,
      applicability: 'checkpoint-required',
    })
    expect(validateDefinition(state.document.definition).trigger.match).toEqual({ tool: 'shell' })
    fire(select('Start step'), 'onChange', nodeIdOf('step-2'))
    expect(state.document.definition.steps[0]?.id).toBe('step-2')
    state = deleteStep(state, nodeIdOf('step-2'))
    expect(state.issues.some((issue) => issue.message.includes('trigger has no first step'))).toBe(
      true,
    )
    fire(select('Start step'), 'onChange', nodeIdOf('step-1'))
    fire(select('next target of step-1'), 'onChange', END_NODE)
    expect(state.issues).toEqual([])
    expect(state.document.definition.steps[0]?.id).toBe('step-1')
    expect(validateDefinition(state.document.definition).steps.map((step) => step.id)).toEqual([
      'step-1',
    ])
  })
})

describe('layout integration', () => {
  it('uses the deterministic layout when none was saved', () => {
    const graph = definitionToGraph(DEFINITION)
    const laidOut = withLayout(graph)
    const positions = autoPositions(graph.nodes, graph.edges)
    expect(laidOut.nodes.find((node) => node.id === 'requirements')?.position).toEqual(
      positions.requirements,
    )
    expect(currentTarget(graph.edges, nodeIdOf('requirements'), 'next')).toBe(
      nodeIdOf('architecture'),
    )
    expect(connectChoices(graph.nodes, nodeIdOf('approval')).map((choice) => choice.kind)).toEqual([
      'next',
    ])
  })
})
