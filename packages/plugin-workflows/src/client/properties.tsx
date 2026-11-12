import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ReactNode, useState } from 'react'
import { connectChoices, currentTarget, EDGE_LABELS, outputKinds } from './edges.ts'
import type { EditorState } from './editor.ts'
import { brickGlyph, executorIcon } from './glyphs.tsx'
import type { DiagramNode, EdgeKind, GraphStep } from './graph.ts'

/**
 * The inspector. It edits the same definition the canvas and the list editor
 * share and never evaluates a value: JSONLogic predicates are edited as JSON
 * data, and every change goes back through the editor state machine.
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

/**
 * A JSON textarea with a stable identity: it keeps the user's draft while they
 * type and synchronizes only when the committed value changes from elsewhere
 * (for example an executor change rewriting the evidence), so focus and caret
 * survive ordinary multi-character edits.
 */
function JsonField(props: {
  readonly label: string
  readonly value: unknown
  readonly ariaLabel: string
  readonly rows?: number
  readonly allowEmpty?: boolean
  readonly commit: (value: unknown) => void
}): ReactNode {
  const committed = jsonText(props.value)
  const [draft, setDraft] = useState(committed)
  const [seen, setSeen] = useState(committed)
  if (seen !== committed) {
    setSeen(committed)
    setDraft(committed)
  }
  return (
    <label>
      {props.label}
      <textarea
        value={draft}
        aria-label={props.ariaLabel}
        rows={props.rows ?? 2}
        onChange={(event) => {
          const text = event.currentTarget.value
          setDraft(text)
          if (text.trim() === '' && props.allowEmpty === true) {
            props.commit(undefined)
            return
          }
          const parsed = parseJsonField(text)
          if (parsed.ok) props.commit(parsed.value)
        }}
      />
    </label>
  )
}

const EXECUTORS = ['main', 'subagent', 'tool', 'branch', 'loop', 'human'] as const
const EVIDENCE_KINDS = ['file', 'record', 'tool', 'check', 'human', 'all', 'declaration'] as const

export interface PropertiesProps {
  readonly state: EditorState
  readonly selected?: string
  readonly onDefinitionPatch: (patch: Readonly<Record<string, unknown>>) => void
  readonly onPatch: (stepId: string, patch: Readonly<Record<string, unknown>>) => void
  readonly onConnect: (source: string, target: string, kind: EdgeKind) => void
  readonly onDelete: (stepId: string) => void
  readonly onRename?: (nodeId: string, nextId: string) => void
}

/** One labeled inspector section; the heading names the group the fields edit. */
function Group(props: {
  readonly id: string
  readonly title: string
  readonly children?: ReactNode
}): ReactNode {
  return (
    <section className="dsh-wf-group" data-group={props.id}>
      <h5 className="dsh-wf-group-title">{props.title}</h5>
      {props.children}
    </section>
  )
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

function settingsFields(props: PropertiesProps): ReactNode {
  const settings = props.state.document.definition.settings
  const allowTools = Array.isArray(settings.allowTools) ? settings.allowTools.join(', ') : ''
  const patch = (value: Record<string, unknown>): void =>
    props.onDefinitionPatch({ settings: value })
  return (
    <fieldset className="dsh-wf-row-actions" data-section="settings">
      <legend>Settings</legend>
      <label>
        Risk
        <select
          value={typeof settings.risk === 'string' ? settings.risk : 'low'}
          aria-label="Risk"
          onChange={(event) => patch({ ...settings, risk: event.currentTarget.value })}
        >
          {['low', 'medium', 'high'].map((risk) => (
            <option key={risk} value={risk}>
              {risk}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.allowModelStart === true}
          aria-label="Allow model start"
          onChange={(event) => patch({ ...settings, allowModelStart: event.currentTarget.checked })}
        />
        model start
      </label>
      <label>
        Max blocks
        <input
          type="number"
          min={1}
          value={Number(settings.maxBlocks ?? 3)}
          aria-label="Max blocks"
          onChange={(event) => patch({ ...settings, maxBlocks: Number(event.currentTarget.value) })}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.allowIntent === true}
          aria-label="Allow intent"
          onChange={(event) => patch({ ...settings, allowIntent: event.currentTarget.checked })}
        />
        intent
      </label>
      <label>
        Gate ownership
        <select
          value={typeof settings.gateOwnership === 'string' ? settings.gateOwnership : 'own'}
          aria-label="Gate ownership"
          onChange={(event) => patch({ ...settings, gateOwnership: event.currentTarget.value })}
        >
          <option value="own">own</option>
          <option value="defer">defer</option>
        </select>
      </label>
      <label>
        Allowed tools
        <input
          value={allowTools}
          aria-label="Allowed tools"
          onChange={(event) => {
            const names = event.currentTarget.value
              .split(',')
              .map((name) => name.trim())
              .filter((name) => name !== '')
            patch({
              ...settings,
              // The host rejects an empty allowlist; omit it when unused.
              ...(names.length === 0 ? { allowTools: undefined } : { allowTools: names }),
            })
          }}
        />
      </label>
      <JsonField
        key={`settings-legacy:${props.state.document.definition.id}`}
        label="Legacy (JSON)"
        value={settings.legacy}
        ariaLabel="Settings legacy JSON"
        allowEmpty
        commit={(value) => patch({ ...settings, legacy: value })}
      />
    </fieldset>
  )
}

function stepFields(props: PropertiesProps, node: DiagramNode, step: GraphStep): ReactNode {
  const branch = step.branch
  const loop = step.loop
  const regularConnections = branch === undefined && loop === undefined
  return (
    <>
      <Group id="step" title="Step">
        <label>
          Step title
          <input
            value={step.title}
            aria-label="Step title"
            onChange={(event) => props.onPatch(node.id, { title: event.currentTarget.value })}
          />
        </label>
        <label>
          Step id
          <input
            key={`id:${step.id}`}
            defaultValue={step.id}
            aria-label="Step id"
            disabled={props.onRename === undefined}
            onBlur={(event) => props.onRename?.(node.id, event.currentTarget.value)}
          />
        </label>
      </Group>
      <Group id="behavior" title="Behavior">
        <label>
          <span>Flags</span>
          <label>
            <input
              type="checkbox"
              checked={step.nonCritical === true}
              aria-label="Non-critical step"
              onChange={(event) =>
                props.onPatch(node.id, { nonCritical: event.currentTarget.checked })
              }
            />
            non-critical
          </label>
          <label>
            <input
              type="checkbox"
              checked={step.blockTurnClose === true}
              aria-label="Blocks turn close"
              onChange={(event) =>
                props.onPatch(node.id, {
                  ...(event.currentTarget.checked
                    ? { blockTurnClose: true }
                    : { blockTurnClose: undefined }),
                })
              }
            />
            blocks turn close
          </label>
        </label>
        <label>
          Ownership
          <select
            value={typeof step.ownership === 'string' ? step.ownership : ''}
            aria-label="Step ownership"
            onChange={(event) =>
              props.onPatch(node.id, {
                ...(event.currentTarget.value === ''
                  ? { ownership: undefined }
                  : { ownership: event.currentTarget.value }),
              })
            }
          >
            <option value="">(default)</option>
            <option value="own">own</option>
            <option value="defer">defer</option>
          </select>
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
            onChange={(event) =>
              props.onPatch(node.id, {
                prompt: event.currentTarget.value === '' ? undefined : event.currentTarget.value,
              })
            }
          />
        </label>
      </Group>
      <Group id="evidence" title="Evidence">
        <JsonField
          key={`evidence:${node.id}`}
          label="Evidence (JSON)"
          value={step.evidence}
          ariaLabel="Evidence JSON"
          rows={3}
          allowEmpty
          commit={(value) => props.onPatch(node.id, { evidence: value })}
        />
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
        {step.executor === 'human' ? (
          <label>
            Human timeout
            <select
              value={step.human?.timeoutAction ?? 'block'}
              aria-label="Human timeout action"
              onChange={(event) =>
                props.onPatch(node.id, {
                  human: { ...(step.human ?? {}), timeoutAction: event.currentTarget.value },
                })
              }
            >
              <option value="block">block</option>
              <option value="cancel">cancel</option>
            </select>
          </label>
        ) : null}
        {step.tool === undefined ? null : (
          <JsonField
            key={`tool:${node.id}`}
            label="Tool config (JSON)"
            value={step.tool}
            ariaLabel="Tool config JSON"
            commit={(value) => props.onPatch(node.id, { tool: value })}
          />
        )}
        {step.subagent === undefined ? null : (
          <JsonField
            key={`subagent:${node.id}`}
            label="Subagent config (JSON)"
            value={step.subagent}
            ariaLabel="Subagent config JSON"
            commit={(value) => props.onPatch(node.id, { subagent: value })}
          />
        )}
        <JsonField
          key={`legacy:${node.id}`}
          label="Legacy (JSON)"
          value={step.legacy}
          ariaLabel="Step legacy JSON"
          allowEmpty
          commit={(value) => props.onPatch(node.id, { legacy: value })}
        />
      </Group>
      {regularConnections ? (
        <Group id="connections" title="Connections">
          {outputKinds(node.kind).map((kind) => selectTarget(props, node, kind))}
        </Group>
      ) : (
        <Group id="connections" title="Connections">
          {branch === undefined ? null : (
            <>
              <JsonField
                key={`predicate:${node.id}`}
                label="Branch predicate (JSON)"
                value={branch.predicate}
                ariaLabel="Branch predicate JSON"
                commit={(value) =>
                  props.onPatch(node.id, { branch: { ...branch, predicate: value } })
                }
              />
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
              <JsonField
                key={`stop:${node.id}`}
                label="Loop stop (JSON)"
                value={loop.stop}
                ariaLabel="Loop stop JSON"
                commit={(value) => props.onPatch(node.id, { loop: { ...loop, stop: value } })}
              />
              <label>
                Loop list key
                <input
                  value={loop.list ?? ''}
                  aria-label="Loop list key"
                  onChange={(event) =>
                    props.onPatch(node.id, {
                      loop: {
                        ...loop,
                        // An empty list means "no list"; omit it rather than send "".
                        ...(event.currentTarget.value === ''
                          ? { list: undefined }
                          : { list: event.currentTarget.value }),
                      },
                    })
                  }
                />
              </label>
              <label>
                Loop cap
                <select
                  value={loop.cap ?? 'blocked'}
                  aria-label="Loop cap"
                  onChange={(event) =>
                    props.onPatch(node.id, {
                      loop: { ...loop, cap: event.currentTarget.value as 'blocked' | 'failed' },
                    })
                  }
                >
                  <option value="blocked">blocked</option>
                  <option value="failed">failed</option>
                </select>
              </label>
              {selectTarget(props, node, 'exit')}
            </>
          )}
        </Group>
      )}
      <Group id="danger" title="Danger">
        <div className="dsh-wf-row-actions">
          <Button type="button" variant="ghost" size="sm" onClick={() => props.onDelete(node.id)}>
            Delete step
          </Button>
        </div>
      </Group>
    </>
  )
}

function triggerFields(props: PropertiesProps): ReactNode {
  const trigger = props.state.document.definition.trigger
  const match = trigger.match
  const triggerNode = props.state.diagram.nodes.find((node) => node.kind === 'trigger')
  return (
    <>
      <Group id="trigger" title="Trigger">
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
      </Group>
      <Group id="behavior" title="Behavior">
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
          repeat
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
        <JsonField
          key={`match:${props.state.document.definition.id}`}
          label="Trigger match (JSON)"
          value={match ?? {}}
          ariaLabel="Trigger match JSON"
          commit={(value) => props.onDefinitionPatch({ trigger: { ...trigger, match: value } })}
        />
      </Group>
      <Group id="connections" title="Connections">
        {triggerNode === undefined
          ? null
          : outputKinds('trigger').map((kind) => selectTarget(props, triggerNode, kind))}
      </Group>
    </>
  )
}

function workflowFields(props: PropertiesProps): ReactNode {
  const description = props.state.document.definition.description
  return (
    <>
      <Group id="workflow" title="Workflow">
        <label>
          Definition name
          <input
            value={props.state.document.definition.name}
            aria-label="Definition name"
            onChange={(event) => props.onDefinitionPatch({ name: event.currentTarget.value })}
          />
        </label>
        <label>
          Description
          <textarea
            value={typeof description === 'string' ? description : ''}
            aria-label="Definition description"
            rows={2}
            onChange={(event) =>
              props.onDefinitionPatch({
                // Empty sends undefined so a definition without one stays unchanged.
                description:
                  event.currentTarget.value === '' ? undefined : event.currentTarget.value,
              })
            }
          />
        </label>
      </Group>
      <div className="dsh-wf-group" data-group="settings">
        {settingsFields(props)}
      </div>
    </>
  )
}

export function PropertyPanel(props: PropertiesProps): ReactNode {
  const node = props.state.diagram.nodes.find((entry) => entry.id === props.selected)
  return (
    <section className="dsh-wf-properties" data-tab-group="properties" aria-label="Properties">
      <header className="dsh-wf-inspector-title">
        <span
          className="dsh-wf-inspector-glyph"
          data-kind={node?.kind ?? 'definition'}
          aria-hidden="true"
        >
          {node === undefined ? null : brickGlyph(executorIcon(node.step?.executor, node.kind))}
        </span>
        <div className="dsh-wf-inspector-titles">
          <h4>{node === undefined ? 'Workflow' : node.title}</h4>
          <span className="dsh-wf-muted">
            {node === undefined ? 'Definition and settings' : (node.step?.id ?? node.kind)}
          </span>
        </div>
      </header>
      {workflowFields(props)}
      {node === undefined ? (
        <p className="dsh-wf-muted">Select a node to edit it.</p>
      ) : node.kind === 'trigger' ? (
        triggerFields(props)
      ) : node.kind === 'end' || node.step === undefined ? (
        <p className="dsh-wf-muted">The end node has no fields.</p>
      ) : (
        stepFields(props, node, node.step)
      )}
    </section>
  )
}
