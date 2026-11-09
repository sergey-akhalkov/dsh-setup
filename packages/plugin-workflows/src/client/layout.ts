import { autoPositions, type Diagram, type DiagramNode } from './graph.ts'

/**
 * The layout sidecar. Positions live under `.dsh/workflows/layout/<id>.json`
 * and are never written into the definition; the engine ignores the sidecar, so
 * a missing or stale layout cannot change a run.
 */

export const LAYOUT_VERSION = 1

export interface LayoutPosition {
  readonly x: number
  readonly y: number
}

export interface Layout {
  readonly v: typeof LAYOUT_VERSION
  readonly id: string
  readonly positions: Readonly<Record<string, LayoutPosition>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read an untrusted sidecar; an unusable file reads as no layout at all. */
export function parseLayout(raw: unknown, id: string): Layout | undefined {
  if (!isRecord(raw) || raw.v !== LAYOUT_VERSION || raw.id !== id) return undefined
  if (!isRecord(raw.positions)) return undefined
  const positions: Record<string, LayoutPosition> = {}
  for (const [stepId, value] of Object.entries(raw.positions)) {
    if (
      !isRecord(value) ||
      typeof value.x !== 'number' ||
      typeof value.y !== 'number' ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y)
    ) {
      continue
    }
    positions[stepId] = { x: value.x, y: value.y }
  }
  return { v: LAYOUT_VERSION, id, positions }
}

/** Collect the step positions of the current canvas into the sidecar shape. */
export function layoutOf(diagram: Diagram, previous?: Layout): Layout {
  const positions: Record<string, LayoutPosition> = { ...(previous?.positions ?? {}) }
  for (const node of diagram.nodes) {
    if (node.kind === 'trigger' || node.kind === 'end' || node.step === undefined) continue
    positions[node.step.id] = { x: node.position.x, y: node.position.y }
  }
  for (const id of Object.keys(positions)) {
    if (!diagram.nodes.some((node) => node.step?.id === id)) delete positions[id]
  }
  return { v: LAYOUT_VERSION, id: diagram.definition.id, positions }
}

/**
 * Apply saved positions and fall back to the deterministic layered layout for
 * every node the sidecar does not know (or when there is no sidecar at all).
 */
export function withLayout(diagram: Diagram, layout?: Layout): Diagram {
  const automatic = autoPositions(diagram.nodes, diagram.edges)
  const nodes: DiagramNode[] = diagram.nodes.map((node) => {
    const stepId = node.step?.id
    const saved = stepId === undefined ? undefined : layout?.positions[stepId]
    const fallback = automatic[node.id]
    const position = saved ?? fallback ?? node.position
    return { ...node, position }
  })
  return { ...diagram, nodes }
}

/** Replace one step node's position; the edit stays in client state until saved. */
export function moveNode(diagram: Diagram, nodeId: string, position: LayoutPosition): Diagram {
  return {
    ...diagram,
    nodes: diagram.nodes.map((node) => (node.id === nodeId ? { ...node, position } : node)),
  }
}
