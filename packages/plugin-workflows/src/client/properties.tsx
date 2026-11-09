import type { ReactNode } from 'react'
import { connectChoices, currentTarget, EDGE_LABELS, outputKinds } from './edges.ts'
import type { EditorState } from './editor.ts'
import type { DiagramNode, EdgeKind, GraphStep } from './graph.ts'

/**
 * The property panel. It edits the same definition the canvas and the list
 * editor share and never evaluates a value: JSONLogic predicates are edited as
 * JSON data, and every change goes back through the editor state machine.
 */

export function parseJsonField(
  text: string,
): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function jsonText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value)
}

const EXECUTORS = ['main', 'branch', 'loop', 'human'] as const
const EVIDENCE_KINDS = ['file', 'record', 'tool', 'check', 'human', 'all', 'declaration'] as const

export interface PropertiesProps {
  readonly state: EditorState
  readonly selected?: string
  readonly onDefinitionPatch: (patch: Readonly<Record<string, unknown>>) => void
  readonly onPatch: (stepId: string, patch: Readonly<Record<string, unknown>>) => void
  readonly onConnect: (source: string, target: string, kind: EdgeKind) => void
  readonly onDelete: (stepId: string) => void
}

function selectTarget(props: PropertiesProps, node: DiagramNode, kind: EdgeKind): ReactNode {
  const current = currentTarget(props.state.diagram.edges, node.id, kind)
  const choices = connectChoices(props.state.diagram.nodes, node.id).find(
    (choice) => choice.kind === kind,
  )
  return (
    <label key={kind} data-connection={kind}>
      {EDGE_LABELS[kind]}
      <select
        value={current ?? ''}
        onChange={(event) => {
          const target = event.currentTarget.value
          if (target !== '') props.onConnect(node.id, target, kind)
        }}
      >
        <option value="">(unconnected)</option>
        {(choices?.targets ?? []).map((target) => (
          <option key={target.id} value={target.id}>
            {target.title} ({target.id})
          </option>
        ))}
      </select>
    </label>
  )
}

function stepFields(props: PropertiesProps, node: DiagramNode, step: GraphStep): ReactNode {
  const branch = step.branch
  const loop = step.loop
  return (
    <>
      <label>
        Step title
        <input
          value={step.title}
          aria-label="Step title"
          onChange={(event) => props.onPatch(node.id, { title: event.currentTarget.value })}
        />
      </label>
      <label>
        Executor
        <select
          value={step.executor}
          aria-label="Executor"
          onChange={(event) => props.onPatch(node.id, { executor: event.currentTarget.value })}
        >
          {EXECUTORS.map((executor) => (
            <option key={executor} value={executor}>
              {executor}
            </option>
          ))}
        </select>
      </label>
      <label>
        Prompt
        <textarea
          value={typeof step.prompt === 'string' ? step.prompt : ''}
          aria-label="Prompt"
          rows={3}
          onChange={(event) => props.onPatch(node.id, { prompt: event.currentTarget.value })}
        />
      </label>
      <label>
        Evidence (JSON)
        <textarea
          key={`evidence:${node.id}`}
          defaultValue={jsonText(step.evidence)}
          aria-label="Evidence JSON"
          rows={3}
          onChange={(event) => {
            const text = event.currentTarget.value
            if (text.trim() === '') {
              props.onPatch(node.id, { evidence: undefined })
              return
            }
            const parsed = parseJsonField(text)
            if (parsed.ok) props.onPatch(node.id, { evidence: parsed.value })
          }}
        />
      </label>
      <label>
        Evidence kind
        <select
          value={
            typeof (step.evidence as { kind?: unknown } | undefined)?.kind === 'string'
              ? String((step.evidence as { kind: string }).kind)
              : ''
          }
          aria-label="Evidence kind"
          onChange={(event) =>
            props.onPatch(node.id, { evidence: { kind: event.currentTarget.value } })
          }
        >
          <option value="">(none)</option>
          {EVIDENCE_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </label>
      {branch === undefined ? null : (
        <>
          <label>
            Branch predicate (JSON)
            <textarea
              key={`predicate:${node.id}`}
              defaultValue={jsonText(branch.predicate)}
              aria-label="Branch predicate JSON"
              rows={2}
              onChange={(event) => {
                const parsed = parseJsonField(event.currentTarget.value)
                if (parsed.ok) {
                  props.onPatch(node.id, { branch: { ...branch, predicate: parsed.value } })
                }
              }}
            />
          </label>
          {selectTarget(props, node, 'true')}
          {selectTarget(props, node, 'false')}
        </>
      )}
      {loop === undefined ? null : (
        <>
          <label>
            Max iterations
            <input
              type="number"
              min={1}
              value={loop.maxIterations ?? 1}
              aria-label="Max iterations"
              onChange={(event) =>
                props.onPatch(node.id, {
                  loop: { ...loop, maxIterations: Number(event.currentTarget.value) },
                })
              }
            />
          </label>
          <label>
            Loop stop (JSON)
            <textarea
              key={`stop:${node.id}`}
              defaultValue={jsonText(loop.stop)}
              aria-label="Loop stop JSON"
              rows={2}
              onChange={(event) => {
                const parsed = parseJsonField(event.currentTarget.value)
                if (parsed.ok) props.onPatch(node.id, { loop: { ...loop, stop: parsed.value } })
              }}
            />
          </label>
          <label>
            Loop list key
            <input
              value={loop.list ?? ''}
              aria-label="Loop list key"
              onChange={(event) =>
                props.onPatch(node.id, {
                  loop: { ...loop, list: event.currentTarget.value },
                })
              }
            />
          </label>
          {selectTarget(props, node, 'exit')}
        </>
      )}
      {branch !== undefined || loop !== undefined
        ? null
        : outputKinds(node.kind).map((kind) => selectTarget(props, node, kind))}
      <div className="dsh-wf-row-actions">
        <button type="button" onClick={() => props.onDelete(node.id)}>
          Delete step
        </button>
      </div>
    </>
  )
}

function triggerFields(props: PropertiesProps): ReactNode {
  const trigger = props.state.document.definition.trigger
  const match = trigger.match
  const triggerNode = props.state.diagram.nodes.find((node) => node.kind === 'trigger')
  return (
    <>
      <label>
        Trigger kind
        <input
          value={typeof trigger.kind === 'string' ? trigger.kind : ''}
          aria-label="Trigger kind"
          onChange={(event) =>
            props.onDefinitionPatch({ trigger: { ...trigger, kind: event.currentTarget.value } })
          }
        />
      </label>
      <label>
        Trigger mode
        <select
          value={typeof trigger.mode === 'string' ? trigger.mode : 'shadow'}
          aria-label="Trigger mode"
          onChange={(event) =>
            props.onDefinitionPatch({ trigger: { ...trigger, mode: event.currentTarget.value } })
          }
        >
          <option value="shadow">shadow</option>
          <option value="active">active</option>
        </select>
      </label>
      <label>
        Dedupe
        <select
          value={typeof trigger.dedupe === 'string' ? trigger.dedupe : 'turn'}
          aria-label="Dedupe policy"
          onChange={(event) =>
            props.onDefinitionPatch({
              trigger: { ...trigger, dedupe: event.currentTarget.value },
            })
          }
        >
          {['none', 'turn', 'path+content-hash', 'callId', 'name'].map((policy) => (
            <option key={policy} value={policy}>
              {policy}
            </option>
          ))}
        </select>
      </label>
      <label>
        Trigger match (JSON)
        <textarea
          key={`match:${props.state.document.definition.id}`}
          defaultValue={jsonText(match ?? {})}
          aria-label="Trigger match JSON"
          rows={2}
          onChange={(event) => {
            const parsed = parseJsonField(event.currentTarget.value)
            if (parsed.ok) props.onDefinitionPatch({ trigger: { ...trigger, match: parsed.value } })
          }}
        />
      </label>
      {triggerNode === undefined
        ? null
        : outputKinds('trigger').map((kind) => selectTarget(props, triggerNode, kind))}
    </>
  )
}

export function PropertyPanel(props: PropertiesProps): ReactNode {
  const node = props.state.diagram.nodes.find((entry) => entry.id === props.selected)
  return (
    <aside className="dsh-wf-properties" data-tab-group="properties" aria-label="Properties">
      <h4>Properties</h4>
      <label>
        Definition name
        <input
          value={props.state.document.definition.name}
          aria-label="Definition name"
          onChange={(event) => props.onDefinitionPatch({ name: event.currentTarget.value })}
        />
      </label>
      {node === undefined ? (
        <p className="dsh-wf-muted">Select a node to edit it.</p>
      ) : node.kind === 'trigger' ? (
        triggerFields(props)
      ) : node.kind === 'end' || node.step === undefined ? (
        <p className="dsh-wf-muted">The end node has no fields.</p>
      ) : (
        stepFields(props, node, node.step)
      )}
    </aside>
  )
}
