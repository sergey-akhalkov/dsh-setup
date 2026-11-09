import {
  type Connection,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from '@xyflow/react'
import { Component, type ReactNode } from 'react'
import type { DiagramEdge, DiagramNode, EdgeKind } from './graph.ts'

/**
 * The Design mode's single client artifact. React Flow is a static import, so
 * the canvas ships inside `lib/client.js`; there is no lazy chunk and no second
 * artifact. The error boundary falls back to the list editor.
 */

export interface CanvasNodeData {
  readonly title: string
  readonly stepId?: string
  readonly kind: string
  readonly runState?: string
  readonly failureClass?: string
  readonly evidence?: { readonly kind: string; readonly ref?: string }
  readonly violations?: readonly string[]
}

function stateBadge(data: CanvasNodeData): ReactNode {
  const parts: string[] = []
  if (data.runState !== undefined) parts.push(data.runState)
  if (data.failureClass !== undefined) parts.push(data.failureClass)
  return parts.length === 0 ? null : (
    <span className="dsh-wf-node-badge" data-run-state={data.runState}>
      {parts.join(' · ')}
    </span>
  )
}

function StepHandles(props: { readonly kind: string }): ReactNode {
  return (
    <>
      <Handle type="target" position={Position.Left} id="target" />
      {props.kind === 'branch' ? (
        <>
          <Handle type="source" position={Position.Right} id="true" style={{ top: '30%' }} />
          <Handle type="source" position={Position.Right} id="false" style={{ top: '70%' }} />
        </>
      ) : props.kind === 'loop' ? (
        <>
          <Handle type="source" position={Position.Right} id="exit" />
          <Handle type="source" position={Position.Bottom} id="body" />
        </>
      ) : (
        <Handle type="source" position={Position.Right} id="next" />
      )}
    </>
  )
}

function nodeBody(data: CanvasNodeData): ReactNode {
  return (
    <>
      <div className="dsh-wf-node-title">{data.title}</div>
      <div className="dsh-wf-node-meta">{data.kind}</div>
      {stateBadge(data)}
      {data.evidence === undefined ? null : (
        <span className="dsh-wf-node-evidence" title={data.evidence.ref}>
          {data.evidence.kind}
          {data.evidence.ref === undefined ? '' : `: ${data.evidence.ref}`}
        </span>
      )}
      {(data.violations ?? []).map((reason) => (
        <span key={reason} className="dsh-wf-node-violation">
          {reason}
        </span>
      ))}
    </>
  )
}

export function TriggerNodeView(props: NodeProps): ReactNode {
  const data = props.data as unknown as CanvasNodeData
  return (
    <div className="dsh-wf-node" data-kind="trigger" data-state={data.runState}>
      <div className="dsh-wf-node-title">Trigger</div>
      <div className="dsh-wf-node-meta">{data.title}</div>
      <Handle type="source" position={Position.Right} id="start" />
    </div>
  )
}

export function StepNodeView(props: NodeProps): ReactNode {
  const data = props.data as unknown as CanvasNodeData
  return (
    <div className="dsh-wf-node" data-kind="step" data-state={data.runState}>
      {nodeBody(data)}
      <StepHandles kind="step" />
    </div>
  )
}

export function BranchNodeView(props: NodeProps): ReactNode {
  const data = props.data as unknown as CanvasNodeData
  return (
    <div className="dsh-wf-node" data-kind="branch" data-state={data.runState}>
      {nodeBody(data)}
      <StepHandles kind="branch" />
    </div>
  )
}

export function LoopNodeView(props: NodeProps): ReactNode {
  const data = props.data as unknown as CanvasNodeData
  return (
    <div className="dsh-wf-node" data-kind="loop" data-state={data.runState}>
      {nodeBody(data)}
      <StepHandles kind="loop" />
    </div>
  )
}

export function HumanNodeView(props: NodeProps): ReactNode {
  const data = props.data as unknown as CanvasNodeData
  return (
    <div className="dsh-wf-node" data-kind="human" data-state={data.runState}>
      {nodeBody(data)}
      <StepHandles kind="human" />
    </div>
  )
}

export function EndNodeView(props: NodeProps): ReactNode {
  const data = props.data as unknown as CanvasNodeData
  return (
    <div className="dsh-wf-node" data-kind="end">
      <div className="dsh-wf-node-title">{data.title}</div>
      <Handle type="target" position={Position.Left} id="target" />
    </div>
  )
}

export const CANVAS_NODE_TYPES = {
  trigger: TriggerNodeView,
  step: StepNodeView,
  branch: BranchNodeView,
  loop: LoopNodeView,
  human: HumanNodeView,
  end: EndNodeView,
}

/** The React Flow render error the boundary receives; never rethrows into the host. */
export class CanvasBoundary extends Component<
  {
    readonly fallback: ReactNode
    readonly children?: ReactNode
    readonly onError?: (error: unknown) => void
  },
  { readonly failed: boolean }
> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    console.error(
      `workflows: the Design canvas failed to render (${error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200)}); the list editor is showing`,
    )
    this.props.onError?.(error)
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export interface FlowNode {
  readonly id: string
  readonly type: string
  readonly position: { readonly x: number; readonly y: number }
  readonly data: CanvasNodeData
}

export interface FlowEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly label?: string
  readonly data: { readonly kind: EdgeKind }
}

export function toFlowNodes(
  nodes: readonly {
    readonly id: string
    readonly kind: string
    readonly title: string
    readonly position: { readonly x: number; readonly y: number }
    readonly step?: { readonly id: string }
    readonly runState?: string
    readonly failureClass?: string
    readonly evidence?: { readonly kind: string; readonly ref?: string }
    readonly violations?: readonly string[]
  }[],
): FlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: node.position,
    data: {
      title: node.title,
      kind: node.kind,
      ...(node.step === undefined ? {} : { stepId: node.step.id }),
      ...(node.runState === undefined ? {} : { runState: node.runState }),
      ...(node.failureClass === undefined ? {} : { failureClass: node.failureClass }),
      ...(node.evidence === undefined ? {} : { evidence: node.evidence }),
      ...(node.violations === undefined ? {} : { violations: node.violations }),
    },
  }))
}

export function toFlowEdges(
  edges: readonly {
    readonly id: string
    readonly source: string
    readonly target: string
    readonly kind: EdgeKind
    readonly label?: string
  }[],
): FlowEdge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.label === undefined ? {} : { label: edge.label }),
    data: { kind: edge.kind },
  }))
}

export interface DesignCanvasProps {
  readonly nodes: readonly DiagramNode[]
  readonly edges: readonly DiagramEdge[]
  readonly selected?: string
  readonly focusKey: string
  readonly onSelect: (nodeId: string | undefined) => void
  readonly onMove: (nodeId: string, position: { readonly x: number; readonly y: number }) => void
  readonly onConnectNode: (source: string, target: string, kind: EdgeKind) => void
}

const KNOWN_KINDS = new Set<string>(['start', 'next', 'true', 'false', 'body', 'exit'])

/** The canvas; the container remounts it when the definition or overlay changes. */
export function DesignCanvas(props: DesignCanvasProps): ReactNode {
  const flowNodes = toFlowNodes(props.nodes) as unknown as Node[]
  const flowEdges = toFlowEdges(props.edges) as unknown as Edge[]
  return (
    <ReactFlow
      key={props.focusKey}
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={CANVAS_NODE_TYPES as never}
      fitView
      fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
      nodesFocusable
      edgesFocusable
      onNodeClick={(_event, node) => props.onSelect(node.id)}
      onPaneClick={() => props.onSelect(undefined)}
      onNodeDragStop={(_event, node) => props.onMove(node.id, node.position)}
      onConnect={(connection: Connection) => {
        if (connection.source === null || connection.target === null) return
        const handle = connection.sourceHandle
        props.onConnectNode(
          connection.source,
          connection.target,
          handle !== null && KNOWN_KINDS.has(handle) ? (handle as EdgeKind) : 'next',
        )
      }}
    />
  )
}
