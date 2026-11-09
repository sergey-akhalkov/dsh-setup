import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectChoices, currentTarget, EDGE_LABELS, outputKinds } from '../src/client/edges.ts'
import {
  addStep,
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

const ui = loadClientModules(['palette.tsx', 'properties.tsx', 'list.tsx', 'canvas.tsx'])

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

  it('converts graph edges to labelled canvas edges attached to their handles', () => {
    const graph = definitionToGraph(DEFINITION)
    const flow = (
      ui.toFlowEdges as (edges: unknown) => { id: string; label?: string; sourceHandle?: string }[]
    )(graph.edges)
    for (const edge of graph.edges) {
      const converted = flow.find((entry) => entry.id === edge.id)
      expect(converted?.label).toBe(edge.label)
      expect(converted?.sourceHandle).toBe(edge.kind)
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

  it('exposes focusable nodes and edges on the canvas', () => {
    const graph = definitionToGraph(DEFINITION)
    const tree = call(ui, 'DesignCanvas', {
      nodes: graph.nodes,
      edges: graph.edges,
      focusKey: 'test',
      onSelect: () => {},
      onMove: () => {},
      onConnectNode: () => {},
    })
    const flow = elements(tree).find((element) => element.type === 'reactflow')
    expect(flow?.props.nodesFocusable).toBe(true)
    expect(flow?.props.edgesFocusable).toBe(true)
    expect(Array.isArray(flow?.props.nodes)).toBe(true)
    const nodes = flow?.props.nodes as { id: string; type: string }[]
    expect(nodes.some((node) => node.type === 'step')).toBe(true)
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
    fire(find(render(state, nodeIdOf('step-1')), 'Non-critical step'), 'onChange', false)
    expect(() => validateDefinition(state.document.definition)).toThrow(/nonCritical/u)
    fire(find(render(state, nodeIdOf('step-1')), 'Non-critical step'), 'onChange', true)
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
    fire(trigger('Trigger repeat'), 'onChange', true)
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
