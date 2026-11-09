import type { DiagramEdge, DiagramNode, EdgeKind, NodeKind } from './graph.ts'

/**
 * Edge labels and connection targets shared by the canvas handler, the
 * property panel, and the keyboard connect list.
 */

export const EDGE_LABELS: Record<EdgeKind, string> = {
  start: 'start',
  next: 'next',
  true: 'true',
  false: 'false',
  body: 'body',
  exit: 'exit',
}

/** The output handles one node kind offers. */
export function outputKinds(kind: NodeKind): readonly EdgeKind[] {
  if (kind === 'trigger') return ['start']
  if (kind === 'branch') return ['true', 'false']
  if (kind === 'loop') return ['exit']
  if (kind === 'end') return []
  return ['next']
}

export interface ConnectChoice {
  readonly kind: EdgeKind
  readonly label: string
  readonly targets: readonly { readonly id: string; readonly title: string }[]
}

/**
 * The labelled list the keyboard path offers: one choice per output kind, with
 * every other node as a possible target (a self target is already the loop's
 * cosmetic body edge and is not offered).
 */
export function connectChoices(
  nodes: readonly DiagramNode[],
  sourceId: string,
): readonly ConnectChoice[] {
  const source = nodes.find((node) => node.id === sourceId)
  if (source === undefined) return []
  const targets = nodes
    .filter((node) => node.id !== sourceId)
    .map((node) => ({ id: node.id, title: node.title }))
  return outputKinds(source.kind).map((kind) => ({
    kind,
    label: EDGE_LABELS[kind],
    targets,
  }))
}

export function connectionEdge(source: string, target: string, kind: EdgeKind): DiagramEdge {
  return {
    id: `${source}:${kind}`,
    source,
    target,
    kind,
    ...(kind === 'start' || kind === 'body' ? {} : { label: EDGE_LABELS[kind] }),
  }
}

/** The node one output currently points at, if any. */
export function currentTarget(
  edges: readonly DiagramEdge[],
  source: string,
  kind: EdgeKind,
): string | undefined {
  return edges.find((entry) => entry.source === source && entry.kind === kind)?.target
}
