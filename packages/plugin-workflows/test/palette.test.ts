import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectChoices, currentTarget, EDGE_LABELS, outputKinds } from '../src/client/edges.ts'
import {
  addStep,
  blankDefinition,
  connectSteps,
  type EditorApi,
  type EditorState,
  openNew,
  patchStep,
  save,
  setMode,
} from '../src/client/editor.ts'
import {
  autoPositions,
  definitionToGraph,
  END_NODE,
  type GraphDefinition,
  type GraphStep,
  nodeIdOf,
} from '../src/client/graph.ts'
import { withLayout } from '../src/client/layout.ts'
import {
  call,
  type Element,
  elements,
  fire,
  loadClientModules,
  packageDir,
  text,
} from './client-harness.ts'

const ui = loadClientModules(['palette.tsx', 'properties.tsx', 'list.tsx', 'canvas.tsx'])

const listRowModel = ui.listRowModel as (
  state: EditorState,
  step: GraphStep,
) => Readonly<Record<string, string>>

const patchListField = ui.patchListField as (
  step: GraphStep,
  field: string,
  value: string,
  onPatch: (stepId: string, patch: Readonly<Record<string, unknown>>) => void,
) => void

function byId(found: Element[], id: string): Element | undefined {
  return found.find((element) => element.type === 'handle' && element.props.id === id)
}

const DEFINITION = JSON.parse(
  readFileSync(join(packageDir, 'assets', 'definitions', 'change-intake.json'), 'utf8'),
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

  it('converts graph edges to labelled canvas edges', () => {
    const graph = definitionToGraph(DEFINITION)
    const flow = (ui.toFlowEdges as (edges: unknown) => { id: string; label?: string }[])(
      graph.edges,
    )
    for (const edge of graph.edges) {
      expect(flow.find((entry) => entry.id === edge.id)?.label).toBe(edge.label)
    }
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
  it('adds a step by click and by keyboard Enter', () => {
    const kinds: string[] = []
    const tree = call(ui, 'Palette', { onAdd: (kind: string) => kinds.push(kind) })
    const buttons = elements(tree).filter((element) => element.type === 'button')
    expect(buttons.map((button) => button.props['data-kind'])).toEqual([
      'step',
      'branch',
      'loop',
      'human',
    ])
    fire(
      buttons.find((button) => button.props['data-kind'] === 'step'),
      'onClick',
    )
    expect(kinds).toEqual(['step'])
    fire(
      buttons.find((button) => button.props['data-kind'] === 'branch'),
      'onKeyDown',
      'Enter',
    )
    expect(kinds).toEqual(['step', 'branch'])
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
    patchListField(nodeIdOf('requirements'), step, 'loopMaxIterations', '4', (_id, patch) =>
      patches.push(patch),
    )
    expect(patches).toEqual([
      { title: 'Requirements' },
      { evidence: { kind: 'declaration' } },
      { prompt: 'Do it' },
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
