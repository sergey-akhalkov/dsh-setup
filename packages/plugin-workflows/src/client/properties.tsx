import { Button, Checkbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ReactNode, useState } from 'react'
import { connectChoices, currentTarget, EDGE_LABELS, outputKinds } from './edges.ts'
import type { EditorState } from './editor.ts'
import { brickGlyph, executorIcon } from './glyphs.tsx'
import type { DiagramNode, EdgeKind, GraphStep } from './graph.ts'

/**
 * The inspector. It edits the same definition the canvas and the list editor
 * share and never evaluates a value: JSONLogic predicates are edited as JSON
 * data, and every change goes back through the editor state machine.
 *
 * The layout is ordered by importance: the selected node's identity and prompt
 * first, then behavior, connections, evidence, the workflow it belongs to (a
 * collapsed disclosure while a node is selected), and the destructive action
 * last. Raw JSON fields live inside their own disclosure so the common fields
 * stay readable.
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
    <label className="dsh-wf-field">
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

/** One titled card in the inspector. */
function Card(props: {
  readonly id: string
  readonly title: string
  readonly hint?: string
  readonly className?: string
  readonly children?: ReactNode
}): ReactNode {
  return (
    <section
      className={`dsh-wf-card${props.className === undefined ? '' : ` ${props.className}`}`}
      data-group={props.id}
    >
      <header className="dsh-wf-card-head">
        <h5 className="dsh-wf-card-title">{props.title}</h5>
        {props.hint === undefined ? null : <span className="dsh-wf-card-hint">{props.hint}</span>}
      </header>
      <div className="dsh-wf-card-body">{props.children}</div>
    </section>
  )
}

/** A labeled form control; the input keeps its own accessible name. */
function Field(props: { readonly label: string; readonly children?: ReactNode }): ReactNode {
  return (
    <div className="dsh-wf-field">
      <span className="dsh-wf-field-label">{props.label}</span>
      {props.children}
    </div>
  )
}

/** A disclosure for the less common raw-data fields. */
function Advanced(props: { readonly label: string; readonly children?: ReactNode }): ReactNode {
  return (
    <details className="dsh-wf-advanced">
      <summary>{props.label}</summary>
      <div className="dsh-wf-advanced-body">{props.children}</div>
    </details>
  )
}

function selectTarget(props: PropertiesProps, node: DiagramNode, kind: EdgeKind): ReactNode {
  const current = currentTarget(props.state.diagram.edges, node.id, kind)
  const choices = connectChoices(props.state.diagram.nodes, node.id).find(
    (choice) => choice.kind === kind,
  )
  return (
    <Field key={kind} label={EDGE_LABELS[kind]}>
      <select
        value={current ?? ''}
        aria-label={EDGE_LABELS[kind]}
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
    </Field>
  )
}

function settingsFields(props: PropertiesProps): ReactNode {
  const settings = props.state.document.definition.settings
  const allowTools = Array.isArray(settings.allowTools) ? settings.allowTools.join(', ') : ''
  const patch = (value: Record<string, unknown>): void =>
    props.onDefinitionPatch({ settings: value })
  return (
    <div className="dsh-wf-settings">
      <div className="dsh-wf-field-grid">
        <Field label="Risk">
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
        </Field>
        <Field label="Max blocks">
          <input
            type="number"
            min={1}
            value={Number(settings.maxBlocks ?? 3)}
            aria-label="Max blocks"
            onChange={(event) =>
              patch({ ...settings, maxBlocks: Number(event.currentTarget.value) })
            }
          />
        </Field>
        <Field label="Gate ownership">
          <select
            value={typeof settings.gateOwnership === 'string' ? settings.gateOwnership : 'own'}
            aria-label="Gate ownership"
            onChange={(event) => patch({ ...settings, gateOwnership: event.currentTarget.value })}
          >
            <option value="own">own</option>
            <option value="defer">defer</option>
          </select>
        </Field>
        <Field label="Allowed tools">
          <input
            value={allowTools}
            aria-label="Allowed tools"
            placeholder="shell, subagent"
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
        </Field>
      </div>
      <div className="dsh-wf-check-list">
        <Checkbox
          checked={settings.allowModelStart === true}
          onChange={(next) => patch({ ...settings, allowModelStart: next })}
          label="Allow model start"
        />
        <Checkbox
          checked={settings.allowIntent === true}
          onChange={(next) => patch({ ...settings, allowIntent: next })}
          label="Allow intent"
        />
      </div>
      <Advanced label="Legacy settings (JSON)">
        <JsonField
          key={`settings-legacy:${props.state.document.definition.id}`}
          label="Legacy (JSON)"
          value={settings.legacy}
          ariaLabel="Settings legacy JSON"
          allowEmpty
          commit={(value) => patch({ ...settings, legacy: value })}
        />
      </Advanced>
    </div>
  )
}

function workflowContent(props: PropertiesProps): ReactNode {
  const description = props.state.document.definition.description
  return (
    <>
      <Field label="Definition name">
        <input
          value={props.state.document.definition.name}
          aria-label="Definition name"
          onChange={(event) => props.onDefinitionPatch({ name: event.currentTarget.value })}
        />
      </Field>
      <Field label="Description">
        <textarea
          value={typeof description === 'string' ? description : ''}
          aria-label="Definition description"
          rows={3}
          onChange={(event) =>
            props.onDefinitionPatch({
              // Empty sends undefined so a definition without one stays unchanged.
              description: event.currentTarget.value === '' ? undefined : event.currentTarget.value,
            })
          }
        />
      </Field>
    </>
  )
}

function workflowSection(props: PropertiesProps): ReactNode {
  return (
    <Card id="workflow" title="Workflow" hint="Definition">
      {workflowContent(props)}
    </Card>
  )
}

/** While a node is selected the workflow block stays one click away. */
function workflowDetails(props: PropertiesProps): ReactNode {
  return (
    <details className="dsh-wf-advanced" data-group="workflow">
      <summary>Workflow · {props.state.document.definition.name}</summary>
      <div className="dsh-wf-advanced-body">
        {workflowContent(props)}
        <h6 className="dsh-wf-subhead">Settings</h6>
        {settingsFields(props)}
      </div>
    </details>
  )
}

function stepFields(props: PropertiesProps, node: DiagramNode, step: GraphStep): ReactNode {
  const branch = step.branch
  const loop = step.loop
  const regularConnections = branch === undefined && loop === undefined
  return (
    <>
      <Card id="step" title="Step" hint="What it does">
        <Field label="Title">
          <input
            value={step.title}
            aria-label="Step title"
            onChange={(event) => props.onPatch(node.id, { title: event.currentTarget.value })}
          />
        </Field>
        <Field label="Executor">
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
        </Field>
        <Field label="Prompt">
          <textarea
            value={typeof step.prompt === 'string' ? step.prompt : ''}
            aria-label="Prompt"
            rows={4}
            onChange={(event) =>
              props.onPatch(node.id, {
                prompt: event.currentTarget.value === '' ? undefined : event.currentTarget.value,
              })
            }
          />
        </Field>
        <Field label="Step id">
          <input
            key={`id:${step.id}`}
            className="dsh-wf-mono"
            defaultValue={step.id}
            aria-label="Step id"
            disabled={props.onRename === undefined}
            onBlur={(event) => props.onRename?.(node.id, event.currentTarget.value)}
          />
        </Field>
      </Card>
      <Card id="behavior" title="Behavior" hint="Ownership and flags">
        <Field label="Ownership">
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
        </Field>
        <div className="dsh-wf-check-list">
          <Checkbox
            checked={step.nonCritical === true}
            onChange={(next) => props.onPatch(node.id, { nonCritical: next })}
            label="Non-critical step"
          />
          <Checkbox
            checked={step.blockTurnClose === true}
            onChange={(next) => props.onPatch(node.id, { blockTurnClose: next ? true : undefined })}
            label="Blocks turn close"
          />
        </div>
        {step.executor === 'human' ? (
          <Field label="Human timeout">
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
          </Field>
        ) : null}
      </Card>
      <Card id="connections" title="Connections" hint="Where it goes next">
        {regularConnections
          ? outputKinds(node.kind).map((kind) => selectTarget(props, node, kind))
          : null}
        {branch === undefined ? null : (
          <>
            {selectTarget(props, node, 'true')}
            {selectTarget(props, node, 'false')}
            <Advanced label="Branch predicate (JSON)">
              <JsonField
                key={`predicate:${node.id}`}
                label="Predicate"
                value={branch.predicate}
                ariaLabel="Branch predicate JSON"
                commit={(value) =>
                  props.onPatch(node.id, { branch: { ...branch, predicate: value } })
                }
              />
            </Advanced>
          </>
        )}
        {loop === undefined ? null : (
          <>
            <Field label="Max iterations">
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
            </Field>
            <Field label="Loop list key">
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
            </Field>
            <Field label="Loop cap">
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
            </Field>
            {selectTarget(props, node, 'exit')}
            <Advanced label="Loop stop (JSON)">
              <JsonField
                key={`stop:${node.id}`}
                label="Stop"
                value={loop.stop}
                ariaLabel="Loop stop JSON"
                commit={(value) => props.onPatch(node.id, { loop: { ...loop, stop: value } })}
              />
            </Advanced>
          </>
        )}
      </Card>
      <Card id="evidence" title="Evidence" hint="What proves it ran">
        <Field label="Evidence kind">
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
        </Field>
        {step.tool === undefined && step.subagent === undefined ? null : (
          <Advanced label="Executor config (JSON)">
            {step.tool === undefined ? null : (
              <JsonField
                key={`tool:${node.id}`}
                label="Tool config"
                value={step.tool}
                ariaLabel="Tool config JSON"
                commit={(value) => props.onPatch(node.id, { tool: value })}
              />
            )}
            {step.subagent === undefined ? null : (
              <JsonField
                key={`subagent:${node.id}`}
                label="Subagent config"
                value={step.subagent}
                ariaLabel="Subagent config JSON"
                commit={(value) => props.onPatch(node.id, { subagent: value })}
              />
            )}
          </Advanced>
        )}
        <Advanced label="Raw records (JSON)">
          <JsonField
            key={`evidence:${node.id}`}
            label="Evidence"
            value={step.evidence}
            ariaLabel="Evidence JSON"
            rows={3}
            allowEmpty
            commit={(value) => props.onPatch(node.id, { evidence: value })}
          />
          <JsonField
            key={`legacy:${node.id}`}
            label="Legacy"
            value={step.legacy}
            ariaLabel="Step legacy JSON"
            allowEmpty
            commit={(value) => props.onPatch(node.id, { legacy: value })}
          />
        </Advanced>
      </Card>
      {workflowDetails(props)}
      <Card id="danger" title="Danger" className="dsh-wf-danger-card">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="dsh-wf-danger"
          onClick={() => props.onDelete(node.id)}
        >
          Delete step
        </Button>
      </Card>
    </>
  )
}

function triggerFields(props: PropertiesProps): ReactNode {
  const trigger = props.state.document.definition.trigger
  const match = trigger.match
  const triggerNode = props.state.diagram.nodes.find((node) => node.kind === 'trigger')
  return (
    <>
      <Card id="trigger" title="Trigger" hint="What starts the workflow">
        <Field label="Kind">
          <input
            value={typeof trigger.kind === 'string' ? trigger.kind : ''}
            aria-label="Trigger kind"
            onChange={(event) =>
              props.onDefinitionPatch({ trigger: { ...trigger, kind: event.currentTarget.value } })
            }
          />
        </Field>
        <Field label="Mode">
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
        </Field>
      </Card>
      <Card id="behavior" title="Behavior" hint="Matching and dedupe">
        <Field label="Dedupe">
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
        </Field>
        <Field label="Applicability">
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
        </Field>
        <div className="dsh-wf-check-list">
          <Checkbox
            checked={trigger.repeat === true}
            onChange={(next) => props.onDefinitionPatch({ trigger: { ...trigger, repeat: next } })}
            label="Repeat on a matching event"
          />
        </div>
        <Advanced label="Match filters (JSON)">
          <JsonField
            key={`match:${props.state.document.definition.id}`}
            label="Match"
            value={match ?? {}}
            ariaLabel="Trigger match JSON"
            commit={(value) => props.onDefinitionPatch({ trigger: { ...trigger, match: value } })}
          />
        </Advanced>
      </Card>
      <Card id="connections" title="Connections" hint="Where the first step is">
        {triggerNode === undefined
          ? null
          : outputKinds('trigger').map((kind) => selectTarget(props, triggerNode, kind))}
      </Card>
      {workflowDetails(props)}
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
      {node === undefined ? (
        <>
          {workflowSection(props)}
          <Card id="settings" title="Settings" hint="Definition-level">
            {settingsFields(props)}
          </Card>
          <p className="dsh-wf-hint">Select a node to edit it.</p>
        </>
      ) : node.kind === 'trigger' ? (
        triggerFields(props)
      ) : node.kind === 'end' || node.step === undefined ? (
        <>
          <Card id="end" title="End" hint="Terminal node">
            <p className="dsh-wf-hint">The end node has no fields.</p>
          </Card>
          {workflowDetails(props)}
        </>
      ) : (
        stepFields(props, node, node.step)
      )}
    </section>
  )
}
