import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { paletteLabel } from './a11y.ts'
import type { EditorListEntry } from './editor.ts'
import type { Translate } from './locale.ts'
import type { RunView } from './panel.tsx'

/**
 * The workbench's left rail: the installed workflows and the engine's building
 * blocks. It is presentational: the editor container owns opening, saving, and
 * the dirty guard, and every rail action goes back through it.
 */

/** The deterministic trigger kinds a block can set, in engine order. */
export const TRIGGER_BLOCKS = [
  'turn.stopping',
  'tool.pre-execute',
  'tool.result',
  'fs.change',
  'subagent.end',
  'review.record',
] as const

/** The step executors a block can add, in engine order. */
export const EXECUTOR_BLOCKS = ['main', 'tool', 'subagent', 'human', 'branch', 'loop'] as const

/** The workflow the page opens when it has no selection: the first installed one. */
export function defaultDefinitionId(definitions: readonly EditorListEntry[]): string | undefined {
  return definitions[0]?.id
}

export interface WorkflowRailProps {
  readonly definitions: readonly EditorListEntry[]
  /** The open definition, marked as the selected row. */
  readonly currentId?: string
  /** The open definition's latest run, when the editor has loaded one. */
  readonly latestRun?: RunView
  readonly disabled?: boolean
  readonly t: Translate
  onOpen(id: string): void
  /** A trigger block sets `trigger.kind`; it never adds a step. */
  onTrigger(kind: string): void
  /** A step block adds a step with that executor. */
  onExecutor(executor: string): void
  /** The lifecycle controls (new, template, draft, reload, delete). */
  readonly actions?: ReactNode
}

export function WorkflowRail(props: WorkflowRailProps): ReactNode {
  const { t } = props
  return (
    <aside className="dsh-wf-rail" data-tab-group="palette">
      <section className="dsh-wf-rail-section" data-section="workflow-rail">
        <h3 className="dsh-wf-heading">{t('design.railWorkflows')}</h3>
        {props.definitions.length === 0 ? (
          <p className="dsh-wf-muted">{t('definitions.empty')}</p>
        ) : (
          <ul className="dsh-wf-rows">
            {props.definitions.map((entry) => {
              const current = entry.id === props.currentId
              return (
                <li key={entry.id}>
                  <Button
                    type="button"
                    variant="toolbar"
                    size="sm"
                    className="dsh-wf-lib-row"
                    data-definition={entry.id}
                    aria-pressed={current}
                    {...(current ? { 'data-selected': 'true' } : {})}
                    disabled={props.disabled === true}
                    onClick={() => props.onOpen(entry.id)}
                  >
                    <span className="dsh-wf-subject">{entry.name}</span>
                    <span className="dsh-wf-muted" data-description={entry.id}>
                      {entry.description ?? t('design.noDescription')}
                    </span>
                    <span className="dsh-wf-muted">
                      {entry.id} · v{String(entry.version)} · {entry.source} ·{' '}
                      {String(entry.stepCount)} steps
                    </span>
                    {current && props.latestRun !== undefined ? (
                      <span className="dsh-wf-time" data-latest-run={props.latestRun.id}>
                        {`${t('overview.latestRun')}: ${props.latestRun.status}`}
                      </span>
                    ) : null}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        {props.actions}
      </section>
      <section className="dsh-wf-rail-section" data-section="block-rail">
        <h3 className="dsh-wf-heading">{t('design.railBlocks')}</h3>
        <p className="dsh-wf-kind">{t('design.blocksTriggers')}</p>
        <ul className="dsh-wf-block-rows">
          {TRIGGER_BLOCKS.map((kind) => (
            <li key={kind}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="dsh-wf-block-row"
                data-block={kind}
                aria-label={`Set trigger ${kind}`}
                disabled={props.disabled === true || props.currentId === undefined}
                onClick={() => props.onTrigger(kind)}
              >
                {kind}
              </Button>
            </li>
          ))}
        </ul>
        <p className="dsh-wf-kind">{t('design.blocksSteps')}</p>
        <ul className="dsh-wf-block-rows">
          {EXECUTOR_BLOCKS.map((executor) => (
            <li key={executor}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="dsh-wf-block-row"
                data-block={executor}
                aria-label={paletteLabel(executor)}
                disabled={props.disabled === true || props.currentId === undefined}
                onClick={() => props.onExecutor(executor)}
              >
                {paletteLabel(executor)}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
