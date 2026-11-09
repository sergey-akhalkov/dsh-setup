/**
 * The definition <-> graph projection. The definition JSON stays the only
 * source of truth: nodes carry the original step object, and the reverse
 * conversion rewrites only the connection fields. Layout never enters here.
 */

export interface GraphBranch {
  readonly predicate?: unknown
  readonly then?: string
  readonly else?: string
}

export interface GraphLoop {
  readonly maxIterations?: number
  readonly stop?: unknown
  readonly next?: string
  readonly cap?: string
  readonly list?: string
}

export interface GraphStep {
  readonly id: string
  readonly title: string
  readonly executor: string
  readonly next?: string
  readonly branch?: GraphBranch
  readonly loop?: GraphLoop
  readonly [field: string]: unknown
}

export interface GraphDefinition {
  readonly v: number
  readonly id: string
  readonly name: string
  readonly version: number
  readonly trigger: Readonly<Record<string, unknown>>
  readonly settings: Readonly<Record<string, unknown>>
  readonly steps: readonly GraphStep[]
  readonly [field: string]: unknown
}

export type NodeKind = 'trigger' | 'step' | 'branch' | 'loop' | 'human' | 'end'
export type EdgeKind = 'start' | 'next' | 'true' | 'false' | 'body' | 'exit'

export const TRIGGER_NODE = '__trigger'
export const END_NODE = '__end'
/**
 * Step nodes live in their own id namespace. A definition step id is any
 * non-empty string (the host only reserves "end"), so a bare copy could name a
 * step "__end" and collide with the synthetic terminal node.
 */
export const STEP_NODE_PREFIX = 'step:'

export function nodeIdOf(stepId: string): string {
  return `${STEP_NODE_PREFIX}${stepId}`
}

export function stepIdOfNode(nodeId: string): string | undefined {
  return nodeId.startsWith(STEP_NODE_PREFIX) ? nodeId.slice(STEP_NODE_PREFIX.length) : undefined
}

export interface GraphEvidence {
  readonly kind: string
  readonly ref?: string
  readonly at?: number
}

export interface DiagramNode {
  readonly id: string
  readonly kind: NodeKind
  readonly title: string
  /** The original step object; absent on the synthetic trigger and end nodes. */
  readonly step?: GraphStep
  readonly index: number
  readonly position: { readonly x: number; readonly y: number }
  readonly runState?: string
  readonly failureClass?: string
  readonly evidence?: GraphEvidence
  readonly violations?: readonly string[]
  readonly orphan?: boolean
}

export interface DiagramEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly kind: EdgeKind
  readonly label?: string
}

export interface Diagram {
  readonly definition: GraphDefinition
  readonly nodes: readonly DiagramNode[]
  readonly edges: readonly DiagramEdge[]
}

export interface GraphIssue {
  readonly nodeId?: string
  readonly path: string
  readonly message: string
}

/** A graph the editor cannot convert back safely. */
export class GraphError extends Error {
  readonly path: string

  constructor(path: string, message: string) {
    super(`${path}: ${message}`)
    this.name = 'GraphError'
    this.path = path
  }
}

export function nodeKindOf(executor: string): NodeKind {
  if (executor === 'branch') return 'branch'
  if (executor === 'loop') return 'loop'
  if (executor === 'human') return 'human'
  return 'step'
}

function edge(
  source: string,
  target: string | undefined,
  kind: EdgeKind,
  label?: string,
): DiagramEdge | undefined {
  if (target === undefined || target === '') return undefined
  const resolved = target === 'end' ? END_NODE : nodeIdOf(target)
  return {
    id: `${source}:${kind}`,
    source,
    target: resolved,
    kind,
    ...(label === undefined ? {} : { label }),
  }
}

/** Project a definition into the canvas nodes and edges. */
export function definitionToGraph(
  definition: GraphDefinition,
  positions: Readonly<Record<string, { readonly x: number; readonly y: number }>> = {},
): Diagram {
  const place = (id: string, fallback: number): { x: number; y: number } => {
    const saved = positions[id]
    return saved === undefined ? { x: fallback * 220, y: 0 } : saved
  }
  const nodes: DiagramNode[] = [
    {
      id: TRIGGER_NODE,
      kind: 'trigger',
      title: String(definition.trigger.kind ?? 'trigger'),
      index: -1,
      position: place(TRIGGER_NODE, 0),
    },
  ]
  const edges: DiagramEdge[] = []
  const start = edge(TRIGGER_NODE, definition.steps[0]?.id, 'start', 'start')
  if (start !== undefined) edges.push(start)
  let usesEnd = false
  definition.steps.forEach((step, index) => {
    const id = nodeIdOf(step.id)
    nodes.push({
      id,
      kind: nodeKindOf(step.executor),
      title: step.title,
      step,
      index,
      position: place(step.id, index + 1),
    })
    if (step.branch !== undefined) {
      const yes = edge(id, step.branch.then, 'true', 'true')
      const no = edge(id, step.branch.else, 'false', 'false')
      if (yes !== undefined) edges.push(yes)
      if (no !== undefined) edges.push(no)
      usesEnd ||= step.branch.then === 'end' || step.branch.else === 'end'
    } else if (step.loop !== undefined) {
      edges.push({
        id: `${id}:body`,
        source: id,
        target: id,
        kind: 'body',
        label: 'body',
      })
      const exit = edge(id, step.loop.next, 'exit', 'exit')
      if (exit !== undefined) edges.push(exit)
      usesEnd ||= step.loop.next === 'end'
    } else {
      const next = edge(id, step.next, 'next', 'next')
      if (next !== undefined) edges.push(next)
      usesEnd ||= step.next === 'end'
    }
  })
  if (usesEnd) {
    nodes.push({
      id: END_NODE,
      kind: 'end',
      title: 'end',
      index: definition.steps.length,
      position: place(END_NODE, definition.steps.length + 1),
    })
  }
  return { definition, nodes, edges }
}

function targetOf(
  edges: readonly DiagramEdge[],
  source: string,
  kind: EdgeKind,
): string | undefined {
  return edges.find((entry) => entry.source === source && entry.kind === kind)?.target
}

/** Set a connection field, or remove it when the user deleted the edge. */
function withConnection<T extends object>(value: T, key: string, next: string | undefined): T {
  const copy = { ...value } as Record<string, unknown>
  if (next === undefined) delete copy[key]
  else copy[key] = next
  return copy as T
}

/** Convert the graph back to the definition, preserving every non-connection field. */
export function graphToDefinition(
  definition: GraphDefinition,
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): GraphDefinition {
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const entry of edges) {
    if (!nodeIds.has(entry.source) || !nodeIds.has(entry.target)) {
      throw new GraphError(
        entry.id,
        `the edge "${entry.id}" points outside the graph (${entry.source} -> ${entry.target})`,
      )
    }
  }
  // Synthetic nodes are validated before they are filtered out: a step-bearing
  // node mislabeled trigger/end would otherwise silently drop that step.
  for (const node of nodes) {
    if (node.kind === 'trigger') {
      if (node.id !== TRIGGER_NODE || node.step !== undefined) {
        throw new GraphError(node.id, 'only the synthetic trigger node may have the trigger kind')
      }
    } else if (node.kind === 'end') {
      if (node.id !== END_NODE || node.step !== undefined) {
        throw new GraphError(node.id, 'only the synthetic end node may have the end kind')
      }
    } else if (node.step === undefined) {
      throw new GraphError(node.id, 'the node carries no definition step')
    }
  }
  const stepNodes = nodes
    .filter((node) => node.kind !== 'trigger' && node.kind !== 'end')
    .sort((left, right) => left.index - right.index)
  const ids = new Set<string>()
  const target = (nodeId: string, kind: EdgeKind): string | undefined => {
    const value = targetOf(edges, nodeId, kind)
    if (value === undefined) return undefined
    if (value === END_NODE) return 'end'
    const stepId = stepIdOfNode(value)
    if (stepId === undefined) {
      throw new GraphError(nodeId, `the ${kind} edge points outside the definition steps`)
    }
    return stepId
  }
  const steps: GraphStep[] = []
  for (const node of stepNodes) {
    const stepId = stepIdOfNode(node.id)
    if (
      node.step === undefined ||
      stepId === undefined ||
      node.step.id !== stepId ||
      node.id !== nodeIdOf(node.step.id)
    ) {
      throw new GraphError(node.id, 'the node carries no matching definition step')
    }
    if (node.kind !== nodeKindOf(node.step.executor)) {
      throw new GraphError(node.id, 'the node kind does not match the step executor')
    }
    if (ids.has(node.step.id)) throw new GraphError(node.id, 'the step id is duplicated')
    ids.add(node.step.id)
    const original = node.step
    let patched: GraphStep
    if (original.branch !== undefined) {
      const yes = target(node.id, 'true')
      const no = target(node.id, 'false')
      const branch = withConnection(withConnection(original.branch, 'then', yes), 'else', no)
      patched = { ...original, branch }
    } else if (original.loop !== undefined) {
      const exit = target(node.id, 'exit')
      patched = { ...original, loop: withConnection(original.loop, 'next', exit) }
    } else {
      patched = withConnection(original, 'next', target(node.id, 'next'))
    }
    steps.push(patched)
  }
  const startTarget = targetOf(edges, TRIGGER_NODE, 'start')
  if (startTarget !== undefined) {
    if (startTarget === END_NODE) {
      throw new GraphError(TRIGGER_NODE, 'the trigger must point at a definition step, not the end')
    }
    const stepId = stepIdOfNode(startTarget)
    if (stepId === undefined) {
      throw new GraphError(TRIGGER_NODE, 'the trigger points outside the definition steps')
    }
    const index = steps.findIndex((step) => step.id === stepId)
    if (index > 0) steps.unshift(...steps.splice(index, 1))
  }
  return { ...definition, steps }
}

/** The editor's structural pre-check; the host remains the schema authority. */
export function precheckGraph(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): GraphIssue[] {
  const issues: GraphIssue[] = []
  const stepIds = new Set<string>()
  for (const node of nodes) {
    if (node.kind === 'trigger' || node.kind === 'end') {
      const validNode =
        node.step === undefined &&
        (node.kind === 'trigger' ? node.id === TRIGGER_NODE : node.id === END_NODE)
      if (!validNode) {
        issues.push({
          nodeId: node.id,
          path: `nodes.${node.id}`,
          message: 'a synthetic node must not carry a definition step',
        })
      }
      continue
    }
    const stepId = node.step?.id
    if (stepId === undefined || stepIdOfNode(node.id) === undefined) {
      issues.push({ nodeId: node.id, path: `nodes.${node.id}`, message: 'the node has no step id' })
      continue
    }
    if (stepIds.has(stepId)) {
      issues.push({
        nodeId: node.id,
        path: `steps.${stepId}`,
        message: 'the step id is duplicated',
      })
    }
    stepIds.add(stepId)
  }
  const nodeIds = new Set(nodes.map((node) => node.id))
  const knownKinds = new Set<EdgeKind>(['start', 'next', 'true', 'false', 'body', 'exit'])
  for (const entry of edges) {
    if (!nodeIds.has(entry.source) || !nodeIds.has(entry.target)) {
      issues.push({
        nodeId: entry.source,
        path: `edges.${entry.id}`,
        message: `the edge "${entry.id}" is dangling (${entry.source} -> ${entry.target})`,
      })
    } else if (!knownKinds.has(entry.kind)) {
      issues.push({ nodeId: entry.source, path: `edges.${entry.id}`, message: 'unknown edge kind' })
    }
  }
  const outs = (source: string, kind: EdgeKind): number =>
    edges.filter((entry) => entry.source === source && entry.kind === kind).length
  if (outs(TRIGGER_NODE, 'start') === 0) {
    issues.push({ nodeId: TRIGGER_NODE, path: 'trigger', message: 'the trigger has no first step' })
  }
  for (const node of nodes) {
    if (node.kind === 'trigger' || node.kind === 'end') continue
    if (node.kind === 'branch') {
      if (outs(node.id, 'true') !== 1 || outs(node.id, 'false') !== 1) {
        issues.push({
          nodeId: node.id,
          path: `steps.${node.id}.branch`,
          message: 'the branch needs one true and one false edge',
        })
      }
    } else if (node.kind === 'loop') {
      if (outs(node.id, 'exit') !== 1) {
        issues.push({
          nodeId: node.id,
          path: `steps.${node.id}.loop.next`,
          message: 'the loop needs one exit edge',
        })
      }
    } else if (outs(node.id, 'next') !== 1) {
      issues.push({
        nodeId: node.id,
        path: `steps.${node.id}.next`,
        message: 'the step needs one next edge (or the end node)',
      })
    }
  }
  return issues
}

/** A stable layered fallback: trigger first, then one column per edge, ties by id. */
export function autoPositions(
  nodes: readonly DiagramNode[],
  edges: readonly DiagramEdge[],
): Record<string, { x: number; y: number }> {
  const outgoing = new Map<string, DiagramEdge[]>()
  for (const entry of edges) {
    if (entry.kind === 'body') continue
    const list = outgoing.get(entry.source) ?? []
    list.push(entry)
    outgoing.set(entry.source, list)
  }
  const depth = new Map<string, number>()
  const queue: string[] = [TRIGGER_NODE]
  depth.set(TRIGGER_NODE, 0)
  const order = new Map<string, number>()
  let count = 0
  while (queue.length > 0) {
    const current = queue.shift() as string
    if (!order.has(current)) order.set(current, count++)
    const currentDepth = depth.get(current) ?? 0
    for (const entry of (outgoing.get(current) ?? []).sort((left, right) =>
      left.target.localeCompare(right.target),
    )) {
      const next = Math.max(depth.get(entry.target) ?? 0, currentDepth + 1)
      depth.set(entry.target, next)
      if (!order.has(entry.target)) queue.push(entry.target)
    }
  }
  const columns = new Map<number, string[]>()
  for (const node of nodes) {
    const column = depth.get(node.id) ?? nodes.length
    const list = columns.get(column) ?? []
    list.push(node.id)
    columns.set(column, list)
  }
  const positions: Record<string, { x: number; y: number }> = {}
  for (const column of [...columns.keys()].sort((left, right) => left - right)) {
    const ids = (columns.get(column) ?? []).sort(
      (left, right) =>
        (order.get(left) ?? 0) - (order.get(right) ?? 0) || left.localeCompare(right),
    )
    ids.forEach((id, row) => {
      positions[id] = { x: column * 240, y: row * 120 }
    })
  }
  return positions
}
