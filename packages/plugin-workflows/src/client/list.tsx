import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { connectChoices, currentTarget, EDGE_LABELS } from './edges.ts'
import type { EditorState } from './editor.ts'
import type { EdgeKind, GraphStep } from './graph.ts'
import { TRIGGER_NODE } from './graph.ts'

/**
 * The List mode: the same state and save path as the canvas, with every step
 * field and every edge editable through form controls. It is the fallback when
 * the canvas cannot render and an equal editor, never a read-only mirror.
 */

const EXECUTORS = ['main', 'subagent', 'tool', 'branch', 'loop', 'human'] as const
const EVIDENCE_KINDS = ['file', 'record', 'tool', 'check', 'human', 'all', 'declaration'] as const

export interface ListEditorProps {
  readonly state: EditorState
  readonly selected?: string
  readonly onSelect: (nodeId: string) => void
  readonly onDefinitionPatch: (patch: Readonly<Record<string, unknown>>) => void
  readonly onPatch: (stepId: string, patch: Readonly<Record<string, unknown>>) => void
  readonly onConnect: (source: string, target: string, kind: EdgeKind) => void
  readonly onDelete: (stepId: string) => void
}

function outputsFor(step: GraphStep): readonly EdgeKind[] {
  if (step.branch !== undefined) return ['true', 'false']
  if (step.loop !== undefined) return ['exit']
  return ['next']
}

function evidenceKind(step: GraphStep): string {
  const evidence = step.evidence as { kind?: unknown } | undefined
  return typeof evidence?.kind === 'string' ? evidence.kind : ''
}

/** The canvas node id of one definition step; the list uses the same graph ids. */
export function graphIdOfStep(state: EditorState, stepId: string): string {
  return state.diagram.nodes.find((node) => node.step?.id === stepId)?.id ?? ''
}

/** A row's selectable connection values, shared with the keyboard connect list. */
export function listConnectionChoices(
  state: EditorState,
  step: GraphStep,
): readonly {
  readonly kind: EdgeKind
  readonly targets: readonly { id: string; title: string }[]
}[] {
  const graphId = graphIdOfStep(state, step.id)
  return outputsFor(step).flatMap((kind) =>
    connectChoices(state.diagram.nodes, graphId)
      .filter((choice) => choice.kind === kind)
      .map((choice) => ({ kind, targets: choice.targets })),
  )
}

/** One step row's editable value; the list mode renders exactly these. */
export function listRowModel(
  state: EditorState,
  step: GraphStep,
): Readonly<Record<string, string>> {
  const graphId = graphIdOfStep(state, step.id)
  const values: Record<string, string> = {
    id: step.id,
    title: step.title,
    executor: step.executor,
    prompt: typeof step.prompt === 'string' ? step.prompt : '',
    evidenceKind: evidenceKind(step),
  }
  for (const kind of outputsFor(step)) {
    values[`connection:${kind}`] = currentTarget(state.diagram.edges, graphId, kind) ?? ''
  }
  return values
}

/** Apply one list field edit through the same editor callbacks as the canvas. */
export function patchListField(
  graphId: string,
  step: GraphStep,
  field: string,
  value: string,
  onPatch: (nodeId: string, patch: Readonly<Record<string, unknown>>) => void,
): void {
  if (field === 'title' || field === 'prompt' || field === 'executor') {
    onPatch(graphId, { [field]: value === '' && field === 'prompt' ? undefined : value })
    return
  }
  if (field === 'evidenceKind') {
    onPatch(graphId, { evidence: value === '' ? undefined : { kind: value } })
    return
  }
  if (field === 'branchPredicate') {
    if (step.branch === undefined) return
    try {
      onPatch(graphId, { branch: { ...step.branch, predicate: JSON.parse(value) } })
    } catch {
      // The JSON textarea keeps the raw text; an invalid value is not stored.
    }
    return
  }
  if (field === 'loopStop') {
    if (step.loop === undefined) return
    try {
      onPatch(graphId, { loop: { ...step.loop, stop: JSON.parse(value) } })
    } catch {
      // Same as the branch predicate: never store an unparsable value.
    }
    return
  }
  if (field === 'loopMaxIterations') {
    if (step.loop === undefined) return
    const iterations = Number(value)
    if (Number.isSafeInteger(iterations) && iterations > 0) {
      onPatch(graphId, { loop: { ...step.loop, maxIterations: iterations } })
    }
  }
}

export function ListEditor(props: ListEditorProps): ReactNode {
  const steps = props.state.document.definition.steps
  const trigger = props.state.document.definition.trigger
  const startTarget = currentTarget(props.state.diagram.edges, TRIGGER_NODE, 'start')
  const stepTargets = props.state.diagram.nodes.filter((node) => node.step !== undefined)
  return (
    <div className="dsh-wf-list-wrap" data-tab-group="list">
      <section className="dsh-wf-list-trigger" data-tab-group="trigger">
        <h4>Trigger</h4>
        <label>
          Kind
          <input
            value={typeof trigger.kind === 'string' ? trigger.kind : ''}
            aria-label="Trigger kind"
            onChange={(event) =>
              props.onDefinitionPatch({ trigger: { ...trigger, kind: event.currentTarget.value } })
            }
          />
        </label>
        <label>
          Mode
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
          Start step
          <select
            value={startTarget ?? ''}
            aria-label="Start step"
            onChange={(event) => {
              const target = event.currentTarget.value
              if (target !== '') props.onConnect(TRIGGER_NODE, target, 'start')
            }}
          >
            <option value="">(unconnected)</option>
            {stepTargets.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title} ({node.step?.id ?? node.id})
              </option>
            ))}
          </select>
        </label>
        <label>
          Repeat
          <input
            type="checkbox"
            checked={trigger.repeat === true}
            aria-label="Trigger repeat"
            onChange={(event) =>
              props.onDefinitionPatch({
                trigger: { ...trigger, repeat: event.currentTarget.checked },
              })
            }
          />
        </label>
        <label>
          Applicability
          <select
            value={typeof trigger.applicability === 'string' ? trigger.applicability : ''}
            aria-label="Trigger applicability"
            onChange={(event) =>
              props.onDefinitionPatch({
                trigger: {
                  ...trigger,
                  ...(event.currentTarget.value === ''
                    ? { applicability: undefined }
                    : { applicability: event.currentTarget.value }),
                },
              })
            }
          >
            <option value="">(none)</option>
            <option value="checkpoint-required">checkpoint-required</option>
          </select>
        </label>
        <label>
          Match (JSON)
          <textarea
            key={`match:${props.state.document.definition.id}:${JSON.stringify(trigger.match ?? {})}`}
            defaultValue={JSON.stringify(trigger.match ?? {})}
            aria-label="Trigger match JSON"
            rows={2}
            onChange={(event) => {
              try {
                const match = JSON.parse(event.currentTarget.value) as unknown
                props.onDefinitionPatch({ trigger: { ...trigger, match } })
              } catch {
                // Incomplete JSON stays in the textarea until it parses.
              }
            }}
          />
        </label>
      </section>
      <table className="dsh-wf-list" aria-label="Definition steps">
        <thead>
          <tr>
            <th>Step</th>
            <th>Title</th>
            <th>Executor</th>
            <th>Evidence kind</th>
            <th>Connections</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {steps.map((step) => {
            const values = listRowModel(props.state, step)
            const graphId = graphIdOfStep(props.state, step.id)
            const selected = props.selected === graphId
            return (
              <tr
                key={step.id}
                data-step={step.id}
                data-selected={selected ? 'true' : undefined}
                onClick={() => props.onSelect(graphId)}
              >
                <td>
                  <code>{step.id}</code>
                </td>
                <td>
                  <input
                    value={values.title ?? ''}
                    aria-label={`Title of ${step.id}`}
                    onChange={(event) =>
                      patchListField(
                        graphId,
                        step,
                        'title',
                        event.currentTarget.value,
                        props.onPatch,
                      )
                    }
                  />
                  <input
                    value={values.prompt ?? ''}
                    aria-label={`Prompt of ${step.id}`}
                    placeholder="Prompt"
                    onChange={(event) =>
                      patchListField(
                        graphId,
                        step,
                        'prompt',
                        event.currentTarget.value,
                        props.onPatch,
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    value={values.executor ?? 'main'}
                    aria-label={`Executor of ${step.id}`}
                    onChange={(event) =>
                      patchListField(
                        graphId,
                        step,
                        'executor',
                        event.currentTarget.value,
                        props.onPatch,
                      )
                    }
                  >
                    {EXECUTORS.map((executor) => (
                      <option key={executor} value={executor}>
                        {executor}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={values.evidenceKind ?? ''}
                    aria-label={`Evidence kind of ${step.id}`}
                    onChange={(event) =>
                      patchListField(
                        graphId,
                        step,
                        'evidenceKind',
                        event.currentTarget.value,
                        props.onPatch,
                      )
                    }
                  >
                    <option value="">(none)</option>
                    {EVIDENCE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {listConnectionChoices(props.state, step).map((choice) => (
                    <label key={choice.kind} data-connection={choice.kind}>
                      {EDGE_LABELS[choice.kind]}
                      <select
                        value={values[`connection:${choice.kind}`] ?? ''}
                        aria-label={`${EDGE_LABELS[choice.kind]} target of ${step.id}`}
                        onChange={(event) => {
                          const target = event.currentTarget.value
                          if (target !== '') props.onConnect(graphId, target, choice.kind)
                        }}
                      >
                        <option value="">(unconnected)</option>
                        {choice.targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.title} ({target.id})
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </td>
                <td>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => props.onDelete(graphId)}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
