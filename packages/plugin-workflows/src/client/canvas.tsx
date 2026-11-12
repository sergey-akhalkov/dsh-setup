import { IconCheckCircleOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  Handle,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import { Component, type DragEvent, type ReactNode, useRef } from 'react'
import { BRICK_MIME, parseBrickPayload } from './bricks.ts'
import { brickGlyph, executorIcon } from './glyphs.tsx'
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
  /** The step's executor; a node kind alone cannot tell a tool step from main. */
  readonly executor?: string
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

function nodeHead(data: CanvasNodeData): ReactNode {
  return (
    <div className="dsh-wf-node-head">
      <span className="dsh-wf-node-icon" aria-hidden="true">
        {brickGlyph(executorIcon(data.executor, data.kind))}
      </span>
      <div className="dsh-wf-node-titles">
        <div className="dsh-wf-node-title">{data.title}</div>
        <div className="dsh-wf-node-meta">{data.executor ?? data.kind}</div>
      </div>
    </div>
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
      {nodeHead(data)}
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
      <div className="dsh-wf-node-head">
        <span className="dsh-wf-node-icon" aria-hidden="true">
          {brickGlyph('trigger')}
        </span>
        <div className="dsh-wf-node-titles">
          <div className="dsh-wf-node-title">Trigger</div>
          <div className="dsh-wf-node-meta">{data.title}</div>
        </div>
      </div>
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
    <div className="dsh-wf-node dsh-wf-node-end" data-kind="end">
      <div className="dsh-wf-node-head">
        <span className="dsh-wf-node-icon" aria-hidden="true">
          <IconCheckCircleOutlineRegular />
        </span>
        <div className="dsh-wf-node-titles">
          <div className="dsh-wf-node-title">{data.title}</div>
          <div className="dsh-wf-node-meta">end</div>
        </div>
      </div>
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
  readonly ariaLabel?: string
  readonly selected?: boolean
}

export interface FlowEdge {
  readonly id: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string
  readonly label?: string
  readonly ariaLabel?: string
  readonly data: { readonly kind: EdgeKind }
}

export function toFlowNodes(
  nodes: readonly {
    readonly id: string
    readonly kind: string
    readonly title: string
    readonly position: { readonly x: number; readonly y: number }
    readonly step?: { readonly id: string; readonly executor: string }
    readonly runState?: string
    readonly failureClass?: string
    readonly evidence?: { readonly kind: string; readonly ref?: string }
    readonly violations?: readonly string[]
  }[],
  selected?: string,
): FlowNode[] {
  return nodes.map((node) => ({
    id: node.id,
    type: node.kind,
    position: node.position,
    // React Flow takes its accessible name from ariaLabel, not data.
    ariaLabel: node.title,
    ...(selected === undefined ? {} : { selected: selected === node.id }),
    data: {
      title: node.title,
      kind: node.kind,
      ...(node.step === undefined ? {} : { stepId: node.step.id }),
      ...(node.step === undefined ? {} : { executor: node.step.executor }),
      ...(node.runState === undefined ? {} : { runState: node.runState }),
      ...(node.failureClass === undefined ? {} : { failureClass: node.failureClass }),
      ...(node.evidence === undefined ? {} : { evidence: node.evidence }),
      ...(node.violations === undefined ? {} : { violations: node.violations }),
    },
  }))
}

/** The edge kinds whose label carries meaning; start/next would be noise. */
const LABELLED_EDGES: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['true', 'false', 'body', 'exit'])

export function toFlowEdges(
  edges: readonly {
    readonly id: string
    readonly source: string
    readonly target: string
    readonly kind: EdgeKind
    readonly label?: string
  }[],
  nodes: readonly { readonly id: string; readonly title: string }[] = [],
): FlowEdge[] {
  const titles = new Map(nodes.map((node) => [node.id, node.title]))
  return edges.map((edge) => {
    const source = titles.get(edge.source) ?? edge.source
    const target = titles.get(edge.target) ?? edge.target
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      // The node views expose one handle id per edge kind, so the edge must name
      // it; otherwise React Flow attaches every edge to the first source handle.
      sourceHandle: edge.kind,
      // Distinct outputs between the same nodes must not share an accessible name.
      ariaLabel: `${source} ${edge.label ?? edge.kind} ${target}`,
      ...(LABELLED_EDGES.has(edge.kind) && edge.label !== undefined ? { label: edge.label } : {}),
      data: { kind: edge.kind },
    }
  })
}

export interface DesignCanvasProps {
  readonly nodes: readonly DiagramNode[]
  readonly edges: readonly DiagramEdge[]
  readonly selected?: string
  readonly focusKey: string
  readonly onSelect: (nodeId: string | undefined) => void
  /** No drag or connect and no layout write; selection stays available. */
  readonly readOnly?: boolean
  readonly onMove?: (nodeId: string, position: { readonly x: number; readonly y: number }) => void
  readonly onConnectNode?: (source: string, target: string, kind: EdgeKind) => void
  /** A palette step brick dropped on the canvas, at the dropped flow position. */
  readonly onDropBrick?: (executor: string, position: { x: number; y: number }) => void
}

const KNOWN_KINDS = new Set<string>(['start', 'next', 'true', 'false', 'body', 'exit'])

/** The canvas; the container remounts it when the definition or overlay changes. */
export function DesignCanvas(props: DesignCanvasProps): ReactNode {
  const flowNodes = toFlowNodes(props.nodes, props.selected) as unknown as Node[]
  const flowEdges = toFlowEdges(props.edges, props.nodes) as unknown as Edge[]
  const readOnly = props.readOnly === true
  const instance = useRef<ReactFlowInstance | undefined>(undefined)
  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    const parsed = parseBrickPayload(event.dataTransfer.getData(BRICK_MIME))
    if (parsed === undefined || parsed.kind !== 'step' || props.onDropBrick === undefined) return
    if (instance.current === undefined) return
    event.preventDefault()
    props.onDropBrick(
      parsed.value,
      instance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
    )
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the wrapper is the palette's drop target; the keyboard path is the brick buttons, not this surface.
    <div className="dsh-wf-flow" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <ReactFlow
        key={props.focusKey}
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={CANVAS_NODE_TYPES as never}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1.1 }}
        nodesFocusable
        edgesFocusable
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        onInit={(flow) => {
          instance.current = flow
        }}
        onNodeClick={(_event, node) => props.onSelect(node.id)}
        onPaneClick={() => props.onSelect(undefined)}
        // Controlled nodes only change selection through onNodesChange; the
        // bundled keyboard handler reports Enter/Space that way, not as a click.
        onNodesChange={(changes: readonly { type: string; id?: string; selected?: boolean }[]) => {
          const selects = changes.filter(
            (change) => change.type === 'select' && change.id !== undefined,
          )
          if (selects.length === 0) return
          // React Flow emits the newly selected node before deselecting the old
          // one; prefer the new selection instead of the last change in the batch.
          const selected = selects.filter((change) => change.selected === true).at(-1)?.id
          props.onSelect(selected)
        }}
        // Keyboard selection inside React Flow changes its selection without a
        // node click; report it so the property panel and C follow the focus.
        onSelectionChange={(selection: { nodes?: readonly { id: string }[] }) => {
          const first = selection.nodes?.[0]
          props.onSelect(first?.id)
        }}
        onNodeDragStop={
          readOnly ? undefined : (_event, node) => props.onMove?.(node.id, node.position)
        }
        onConnect={
          readOnly
            ? undefined
            : (connection: Connection) => {
                if (connection.source === null || connection.target === null) return
                const handle = connection.sourceHandle
                props.onConnectNode?.(
                  connection.source,
                  connection.target,
                  handle !== null && KNOWN_KINDS.has(handle) ? (handle as EdgeKind) : 'next',
                )
              }
        }
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={18}
          size={1.2}
          color="var(--dsw-alias-border-l2)"
        />
        <Controls showInteractive={false} aria-label="Canvas controls" />
      </ReactFlow>
    </div>
  )
}
