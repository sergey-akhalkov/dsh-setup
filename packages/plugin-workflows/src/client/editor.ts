import {
  type Diagram,
  type DiagramEdge,
  type DiagramNode,
  definitionToGraph,
  type GraphDefinition,
  GraphError,
  type GraphIssue,
  type GraphStep,
  graphToDefinition,
  type NodeKind,
  nodeIdOf,
  nodeKindOf,
  precheckGraph,
} from './graph.ts'
import { type Layout, type LayoutPosition, layoutOf, withLayout } from './layout.ts'
import type { RunView } from './panel.tsx'

/**
 * The Design mode's state machine and lifecycle. The canvas and the list mode
 * share this state and the same save path; the host is the schema authority and
 * this module only pre-checks the graph and tracks the revision contract.
 */

export type EditorSource = 'shipped' | 'local' | 'draft'
export type EditorMode = 'canvas' | 'list'
export type SaveKind = 'create' | 'update' | 'layout'

export interface DefinitionDocument {
  readonly definition: GraphDefinition
  readonly revision: string | null
  readonly source: 'shipped' | 'local'
}

export interface EditorListEntry {
  readonly id: string
  readonly name: string
  readonly version: number
  readonly stepCount: number
  readonly source: 'shipped' | 'local'
  readonly revision: string | null
}

export interface TemplateEntry extends EditorListEntry {
  readonly definition: GraphDefinition
}

export interface DraftEntry {
  readonly name: string
  readonly id: string
  readonly title: string
  readonly stepCount: number
}

export interface LayoutDocument {
  readonly layout: Layout | null
  readonly revision: string | null
}

export interface HostFieldError {
  readonly path: string
  readonly message: string
}

export type SaveResult =
  | { readonly ok: true; readonly revision: string }
  | {
      readonly ok: false
      readonly kind: 'conflict'
      readonly status: number
      readonly revision: string | null
      readonly runs?: readonly string[]
    }
  | {
      readonly ok: false
      readonly kind: 'invalid'
      readonly status: number
      readonly errors: readonly HostFieldError[]
    }
  | { readonly ok: false; readonly kind: 'error'; readonly status: number; readonly error: string }

export interface EditorApi {
  list(): Promise<{ definitions: readonly EditorListEntry[]; errors?: readonly string[] }>
  templates(): Promise<readonly TemplateEntry[]>
  drafts(): Promise<readonly DraftEntry[]>
  read(id: string): Promise<DefinitionDocument>
  readDraft(name: string): Promise<GraphDefinition>
  readLayout(id: string): Promise<LayoutDocument>
  saveDefinition(
    id: string,
    definition: GraphDefinition,
    expectedRevision: string | null,
  ): Promise<SaveResult>
  deleteDefinition(id: string, expectedRevision: string): Promise<SaveResult>
  saveLayout(layout: Layout, expectedRevision: string | null): Promise<SaveResult>
  /** The newest runs for one definition, used by the read-only overlay. */
  runs(definitionId: string): Promise<readonly RunView[]>
}

export interface EditorConflict {
  readonly kind: SaveKind
  readonly currentRevision: string | null
  readonly nextId?: string
  readonly runs?: readonly string[]
}

export interface EditorState {
  readonly document: {
    readonly definition: GraphDefinition
    readonly revision: string | null
    readonly source: EditorSource
    readonly draftName?: string
  }
  readonly diagram: Diagram
  readonly layout: Layout
  readonly layoutRevision: string | null
  readonly mode: EditorMode
  readonly dirty: boolean
  readonly issues: readonly GraphIssue[]
  readonly status: 'clean' | 'dirty' | 'saving' | 'saved' | 'error'
  readonly conflict?: EditorConflict
  readonly message?: string
}

export interface OpenedDocument {
  readonly definition: GraphDefinition
  readonly revision: string | null
  readonly source: EditorSource
  readonly draftName?: string
  readonly layout?: LayoutDocument
}

const STEP_PREFIX = 'step-'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** The next free id: the candidate itself, then `-2`, `-3`, … */
export function nextFreeId(candidate: string, taken: ReadonlySet<string>): string {
  if (!taken.has(candidate)) return candidate
  for (let index = 2; ; index += 1) {
    const next = `${candidate}-${String(index)}`
    if (!taken.has(next)) return next
  }
}

/** The copy id rule: `<id>-copy`, then `<id>-copy-2`, … */
export function copyId(sourceId: string, taken: ReadonlySet<string>): string {
  return nextFreeId(`${sourceId}-copy`, taken)
}

function stepIds(definition: GraphDefinition): string[] {
  return definition.steps.map((step) => step.id)
}

function freeStepId(definition: GraphDefinition): string {
  return nextFreeId(
    `${STEP_PREFIX}${String(definition.steps.length + 1)}`,
    new Set(stepIds(definition)),
  )
}

/** A brand-new valid local definition: one declaration step that ends. */
export function blankDefinition(taken: ReadonlySet<string>): GraphDefinition {
  return {
    v: 1,
    id: nextFreeId('new-workflow', taken),
    name: 'New workflow',
    version: 1,
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
        id: `${STEP_PREFIX}1`,
        title: 'First step',
        executor: 'main',
        prompt: 'Describe what this step must do.',
        evidence: { kind: 'declaration' },
        nonCritical: true,
        next: 'end',
        blockTurnClose: true,
      },
    ],
  }
}

/** Copy any definition into an editable local one with a new id and version 1. */
export function copyDefinition(
  source: GraphDefinition,
  taken: ReadonlySet<string>,
  name?: string,
): GraphDefinition {
  const copy = clone(source)
  return {
    ...copy,
    id: copyId(source.id, taken),
    name: name ?? `${source.name} copy`,
    version: 1,
  }
}

/** The same copy rule for a local duplicate, kept as a named operation. */
export function duplicateDefinition(
  source: GraphDefinition,
  taken: ReadonlySet<string>,
): GraphDefinition {
  return copyDefinition(source, taken, `${source.name} (duplicate)`)
}

/** Build the state for one opened document; a missing layout uses the fallback. */
export function openDocument(document: OpenedDocument): EditorState {
  const layout = document.layout?.layout ?? undefined
  const base = definitionToGraph(document.definition)
  const diagram = withLayout(base, layout)
  const editor = {
    document: {
      definition: document.definition,
      revision: document.revision,
      source: document.source,
      ...(document.draftName === undefined ? {} : { draftName: document.draftName }),
    },
    diagram,
    layout: layout ?? layoutOf(diagram),
    layoutRevision: document.layout?.revision ?? null,
    mode: 'canvas' as EditorMode,
    dirty: false,
    issues: [],
    status: 'clean' as const,
  }
  return editor
}

/** Open the blank/create state without touching the host. */
export function openNew(definition: GraphDefinition): EditorState {
  return openDocument({ definition, revision: null, source: 'local' })
}

/** Open a draft; nothing is installed until the user saves it. */
export function openDraft(name: string, definition: GraphDefinition): EditorState {
  return openDocument({
    definition: { ...definition, version: 1 },
    revision: null,
    source: 'draft',
    draftName: name,
  })
}

/**
 * Rebuild the definition from the graph. A conversion error (an edge outside
 * the graph) is returned as an issue instead of throwing into React.
 */
export function updateGraph(
  state: EditorState,
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): EditorState {
  const issues = precheckGraph(nodes, edges)
  let definition: GraphDefinition
  try {
    definition = graphToDefinition(state.document.definition, nodes, edges)
  } catch (error) {
    if (!(error instanceof GraphError)) throw error
    return {
      ...state,
      dirty: true,
      status: 'error',
      issues: [...issues, { nodeId: error.path, path: error.path, message: error.message }],
      message: error.message,
    }
  }
  return {
    ...state,
    document: { ...state.document, definition },
    diagram: { definition, nodes, edges },
    issues,
    dirty: true,
    status: 'dirty',
    conflict: undefined,
    message: undefined,
  }
}

export function setMode(state: EditorState, mode: EditorMode): EditorState {
  return { ...state, mode }
}

export function renameDefinition(state: EditorState, name: string): EditorState {
  if (name.trim() === '') return state
  const definition = { ...state.document.definition, name }
  return {
    ...state,
    document: { ...state.document, definition },
    diagram: { ...state.diagram, definition },
    dirty: true,
    status: 'dirty',
  }
}

/** Move one step node; the position stays client-side until the layout save. */
export function moveStep(
  state: EditorState,
  nodeId: string,
  position: LayoutPosition,
): EditorState {
  return {
    ...state,
    diagram: {
      ...state.diagram,
      nodes: state.diagram.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
    },
    dirty: true,
    status: 'dirty',
  }
}

function executorOf(kind: NodeKind): string {
  return kind === 'trigger' || kind === 'end' ? 'main' : kind
}

/** Add one unconnected step of the chosen kind; the pre-check names the gap. */
export function addStep(state: EditorState, kind: NodeKind): EditorState {
  const definition = state.document.definition
  const id = freeStepId(definition)
  const step: GraphStep = {
    id,
    title: `Step ${String(definition.steps.length + 1)}`,
    executor: executorOf(kind),
    ...(kind === 'branch' ? { branch: { predicate: { '==': [1, 1] } } } : {}),
    ...(kind === 'loop' ? { loop: { maxIterations: 3, stop: { '==': [1, 1] } } } : {}),
    ...(kind === 'human' ? { human: { timeoutAction: 'block' } } : {}),
  }
  const nodes: DiagramNode[] = [
    ...state.diagram.nodes,
    {
      id: nodeIdOf(id),
      kind,
      title: step.title,
      step,
      index: definition.steps.length,
      position: { x: 240, y: (definition.steps.length + 1) * 120 },
    },
  ]
  return updateGraph(state, nodes, state.diagram.edges)
}

/** Connect one output. The target is a step id or the synthetic end node. */
export function connectSteps(
  state: EditorState,
  source: string,
  target: string,
  kind: DiagramEdge['kind'],
): EditorState {
  const nodeIds = new Set(state.diagram.nodes.map((node) => node.id))
  if (!nodeIds.has(target)) return state
  const edges = state.diagram.edges.filter(
    (entry) => !(entry.source === source && entry.kind === kind),
  )
  const edge: DiagramEdge = {
    id: `${source}:${kind}`,
    source,
    target,
    kind,
    ...(kind === 'start' || kind === 'body' ? {} : { label: kind === 'next' ? 'next' : kind }),
  }
  return updateGraph(state, state.diagram.nodes, [...edges, edge])
}

/** Remove one step and every edge that refers to it. */
export function deleteStep(state: EditorState, id: string): EditorState {
  const nodes = state.diagram.nodes.filter((node) => node.id !== id)
  const edges = state.diagram.edges.filter((entry) => entry.source !== id && entry.target !== id)
  return updateGraph(state, nodes, edges)
}

/** Patch one step's fields from the property panel. */
export function patchStep(
  state: EditorState,
  id: string,
  patch: Readonly<Record<string, unknown>>,
): EditorState {
  const nodes = state.diagram.nodes.map((node) => {
    if (node.id !== id || node.step === undefined) return node
    const step = { ...node.step, ...patch } as GraphStep
    const kind = nodeKindOf(step.executor)
    return { ...node, kind, step, title: step.title }
  })
  return updateGraph(state, nodes, state.diagram.edges)
}

/** Patch definition-level fields (name, trigger, settings); steps stay as nodes. */
export function patchDefinition(
  state: EditorState,
  patch: Readonly<Record<string, unknown>>,
): EditorState {
  const definition = { ...state.document.definition, ...patch } as GraphDefinition
  return {
    ...state,
    document: { ...state.document, definition },
    diagram: { ...state.diagram, definition },
    dirty: true,
    status: 'dirty',
  }
}

/** Map host field errors onto the node or field the editor shows. */
export function mapHostErrors(
  errors: readonly HostFieldError[],
  definition: GraphDefinition,
): GraphIssue[] {
  return errors.map((entry) => {
    const stepMatch = /^steps\[(\d+)\](?:\.(.*))?$/u.exec(entry.path)
    if (stepMatch === null) return { path: entry.path, message: entry.message }
    const step = definition.steps[Number(stepMatch[1])]
    return {
      ...(step === undefined ? {} : { nodeId: step.id }),
      path: entry.path,
      message: entry.message,
    }
  })
}

/** The version rule: a create starts at 1, a save bumps the loaded version. */
export function nextVersion(state: EditorState): number {
  return state.document.revision === null ? 1 : state.document.definition.version + 1
}

export interface SaveContext {
  readonly api: EditorApi
  readonly taken: ReadonlySet<string>
}

/**
 * Save the definition, then its layout. Expected revisions are independent: the
 * first layout save sends null and a layout conflict never rolls back the
 * definition it did not touch.
 */
export async function save(state: EditorState, context: SaveContext): Promise<EditorState> {
  if (state.document.source === 'shipped') {
    return {
      ...state,
      status: 'error',
      message: 'a shipped definition is read-only; copy it before saving',
    }
  }
  if (state.issues.length > 0) {
    return { ...state, status: 'error', message: 'fix the highlighted graph issues first' }
  }
  const definition = { ...clone(state.document.definition), version: nextVersion(state) }
  const expected = state.document.revision
  const saving = { ...state, status: 'saving' as const, message: undefined, conflict: undefined }
  const result = await context.api.saveDefinition(
    state.document.definition.id,
    definition,
    expected,
  )
  if (!result.ok) {
    const failed = failure(saving, result)
    if (result.kind !== 'conflict' || expected !== null) return failed
    // A create collision offers the next free id so the draft is never lost.
    return {
      ...failed,
      conflict: {
        ...(failed.conflict as EditorConflict),
        kind: 'create',
        nextId: nextFreeId(`${state.document.definition.id}-copy`, context.taken),
      },
      message: 'the id already exists; pick the next free id or save a copy',
    }
  }
  const saved: EditorState = {
    ...state,
    document: {
      definition,
      revision: result.revision,
      source: 'local',
      ...(state.document.draftName === undefined ? {} : { draftName: state.document.draftName }),
    },
    diagram: { ...state.diagram, definition },
    dirty: false,
    status: 'saved',
    conflict: undefined,
    message: undefined,
  }
  return saveLayout(saved, context.api)
}

async function saveLayout(state: EditorState, api: EditorApi): Promise<EditorState> {
  const layout = layoutOf(state.diagram, state.layout)
  const result = await api.saveLayout(layout, state.layoutRevision)
  if (result.ok) {
    return { ...state, layout, layoutRevision: result.revision }
  }
  if (result.kind === 'conflict') {
    return {
      ...state,
      layout,
      conflict: { kind: 'layout', currentRevision: result.revision },
      status: 'error',
      message: 'the layout changed on disk; reload the layout or save a copy',
    }
  }
  if (result.kind === 'invalid') {
    return {
      ...state,
      layout,
      issues: [
        ...state.issues,
        ...result.errors.map((entry) => ({ path: entry.path, message: entry.message })),
      ],
      status: 'error',
      message: 'the layout was refused by the host',
    }
  }
  return {
    ...state,
    layout,
    status: 'error',
    message: `the layout save failed: ${result.error}`,
  }
}

function failure(state: EditorState, result: Exclude<SaveResult, { ok: true }>): EditorState {
  if (result.kind === 'conflict') {
    return {
      ...state,
      status: 'error',
      conflict: {
        kind: 'update',
        currentRevision: result.revision,
        ...(result.runs === undefined ? {} : { runs: result.runs }),
      },
      message: 'the definition changed on disk; reload or save a copy',
    }
  }
  if (result.kind === 'invalid') {
    return {
      ...state,
      issues: mapHostErrors(result.errors, state.document.definition),
      status: 'error',
      message: 'the host refused the definition; fix the named fields',
    }
  }
  return { ...state, status: 'error', message: result.error }
}

/** Re-read the open document and its layout from the host. */
export async function reload(state: EditorState, api: EditorApi): Promise<EditorState> {
  try {
    const document = await api.read(state.document.definition.id)
    const layout = await api.readLayout(state.document.definition.id)
    const next = openDocument({
      definition: document.definition,
      revision: document.revision,
      source: document.source,
      ...(state.document.draftName === undefined ? {} : { draftName: state.document.draftName }),
      layout,
    })
    return { ...next, mode: state.mode }
  } catch (error) {
    return {
      ...state,
      status: 'error',
      message: `the definition could not be reloaded: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** Save a conflict as a create-only copy under the next free id. */
export async function saveAsCopy(
  state: EditorState,
  context: SaveContext,
  copyName?: string,
): Promise<EditorState> {
  const definition = copyDefinition(
    state.document.definition,
    context.taken,
    copyName ?? `${state.document.definition.name} copy`,
  )
  const copy = openNew(definition)
  return save({ ...copy, mode: state.mode }, context)
}

/** Install a draft with the user's save: create-only, version 1, approved. */
export async function installDraft(state: EditorState, context: SaveContext): Promise<EditorState> {
  if (state.document.source !== 'draft') {
    return { ...state, status: 'error', message: 'the open document is not a draft' }
  }
  return save({ ...state, document: { ...state.document, revision: null } }, context)
}

export interface DeleteOutcome {
  readonly state: EditorState
  readonly deleted: boolean
}

/** Delete a local definition; an active run refuses with its run ids. */
export async function deleteDefinition(state: EditorState, api: EditorApi): Promise<DeleteOutcome> {
  const revision = state.document.revision
  if (revision === null) {
    return {
      state: { ...state, status: 'error', message: 'the definition was never saved' },
      deleted: false,
    }
  }
  const result = await api.deleteDefinition(state.document.definition.id, revision)
  if (result.ok) {
    return { state: { ...state, status: 'saved', message: 'deleted' }, deleted: true }
  }
  if (result.kind === 'conflict') {
    const inUse = (result.runs ?? []).length > 0
    return {
      state: {
        ...state,
        status: 'error',
        conflict: {
          kind: 'update',
          currentRevision: result.revision,
          ...(result.runs === undefined ? {} : { runs: result.runs }),
        },
        message: inUse
          ? `an active run references this definition: ${(result.runs ?? []).join(', ')}; finish or cancel it first`
          : 'the definition changed on disk; reload before deleting',
      },
      deleted: false,
    }
  }
  return { state: failure(state, result), deleted: false }
}

/** The ids already used by shipped and local definitions. */
export function idsOf(entries: readonly EditorListEntry[]): Set<string> {
  return new Set(entries.map((entry) => entry.id))
}

/** Whether the graph can be saved without a host round trip. */
export function savable(state: EditorState): boolean {
  return state.issues.length === 0
}

/** The ids referenced by the definition, for a quick stale-edge check. */
export function referencedIds(definition: GraphDefinition): Set<string> {
  const ids = new Set<string>()
  for (const step of definition.steps) {
    if (step.next !== undefined) ids.add(step.next)
    if (step.branch !== undefined) {
      if (step.branch.then !== undefined) ids.add(step.branch.then)
      if (step.branch.else !== undefined) ids.add(step.branch.else)
    }
    if (step.loop?.next !== undefined) ids.add(step.loop.next)
  }
  return ids
}
