import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { paletteLabel } from './a11y.ts'
import { BRICK_MIME, type Brick, brickPayload, STEP_BRICKS, TRIGGER_BRICKS } from './bricks.ts'
import type { EditorListEntry } from './editor.ts'
import { brickGlyph } from './glyphs.tsx'
import type { Translate } from './locale.ts'
import type { RunView } from './panel.tsx'

/**
 * The workbench's left rail: the building blocks and the installed workflows.
 * It is presentational: the editor container owns opening, saving, and the
 * dirty guard, and every rail action goes back through it.
 */

/** The workflow the page opens when it has no selection: the first installed one. */
export function defaultDefinitionId(definitions: readonly EditorListEntry[]): string | undefined {
  return definitions[0]?.id
}

/** The run-state dot one latest-run status maps to. */
export function runDotState(status: string): 'done' | 'warning' | 'ongoing' | 'error' | 'idle' {
  if (status === 'done' || status === 'completed') return 'done'
  if (status === 'running') return 'ongoing'
  if (status === 'failed') return 'error'
  if (status === 'blocked' || status === 'interrupted' || status === 'cancelled') return 'warning'
  return 'idle'
}

function sourceLabel(entry: EditorListEntry): string {
  return entry.plugin === undefined ? entry.source : `${entry.source}:${entry.plugin}`
}

export interface WorkflowRailProps {
  readonly definitions: readonly EditorListEntry[]
  /** The open definition, marked as the selected row. */
  readonly currentId?: string
  /** The open definition's trigger kind, marked in the trigger bricks. */
  readonly currentTrigger?: string
  /** The open definition's latest run, when the editor has loaded one. */
  readonly latestRun?: RunView
  readonly disabled?: boolean
  readonly t: Translate
  onOpen(id: string): void
  /** A trigger block sets `trigger.kind`; it never adds a step. */
  onTrigger(kind: string): void
  /** A step block adds a step with that executor. */
  onExecutor(executor: string): void
  /** The library's create affordance; absent on a read-only rail render. */
  onNew?(): void
}

function TriggerBricks(props: WorkflowRailProps): ReactNode {
  const { t } = props
  return (
    <ul className="dsh-wf-bricks" data-bricks="triggers">
      {TRIGGER_BRICKS.map((brick: Brick) => {
        const current = props.currentTrigger === brick.value
        return (
          <li key={brick.value}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="dsh-wf-brick"
              data-block={brick.value}
              data-brick-kind="trigger"
              {...(current ? { 'data-current': 'true' } : {})}
              aria-pressed={current}
              aria-label={`Set trigger ${brick.value}`}
              title={brick.hintKey === undefined ? brick.value : t(brick.hintKey)}
              disabled={props.disabled === true || props.currentId === undefined}
              onClick={() => props.onTrigger(brick.value)}
            >
              <span className="dsh-wf-brick-icon">{brickGlyph(brick.icon)}</span>
              <span className="dsh-wf-brick-label">{brick.value}</span>
            </Button>
          </li>
        )
      })}
    </ul>
  )
}

function StepBricks(props: WorkflowRailProps): ReactNode {
  const { t } = props
  return (
    <ul className="dsh-wf-bricks" data-bricks="steps">
      {STEP_BRICKS.map((brick: Brick) => (
        <li key={brick.value}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="dsh-wf-brick"
            data-block={brick.value}
            data-brick-kind="step"
            aria-label={paletteLabel(brick.value)}
            title={brick.hintKey === undefined ? brick.value : t(brick.hintKey)}
            draggable={props.disabled !== true && props.currentId !== undefined}
            disabled={props.disabled === true || props.currentId === undefined}
            onDragStart={(event) => {
              event.dataTransfer.setData(BRICK_MIME, brickPayload('step', brick.value))
              event.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => props.onExecutor(brick.value)}
          >
            <span className="dsh-wf-brick-icon">{brickGlyph(brick.icon)}</span>
            <span className="dsh-wf-brick-label">
              {brick.labelKey === undefined ? brick.value : t(brick.labelKey)}
            </span>
          </Button>
        </li>
      ))}
    </ul>
  )
}

export function WorkflowRail(props: WorkflowRailProps): ReactNode {
  const { t } = props
  return (
    <aside className="dsh-wf-rail" data-tab-group="palette">
      <section className="dsh-wf-rail-section" data-section="workflow-rail">
        <div className="dsh-wf-rail-head">
          <h3 className="dsh-wf-heading">{t('design.railWorkflows')}</h3>
          {props.onNew === undefined ? null : (
            <Button
              type="button"
              variant="toolbar"
              size="sm"
              aria-label={t('design.new')}
              title={t('design.new')}
              icon={<span aria-hidden="true">+</span>}
              disabled={props.disabled === true}
              onClick={() => props.onNew?.()}
            />
          )}
        </div>
        {props.definitions.length === 0 ? (
          <p className="dsh-wf-muted">{t('definitions.empty')}</p>
        ) : (
          <ul className="dsh-wf-library">
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
                    <span className="dsh-wf-lib-title">{entry.name}</span>
                    <span className="dsh-wf-lib-desc" data-description={entry.id}>
                      {entry.description ?? t('design.noDescription')}
                    </span>
                    <span className="dsh-wf-lib-meta">
                      <span className="dsh-wf-chip" data-trigger-kind={entry.trigger ?? ''}>
                        {entry.trigger === undefined
                          ? t('overview.unknownKind')
                          : `${t('definitions.trigger')}: ${entry.trigger}`}
                      </span>
                      <span className="dsh-wf-muted" data-source={entry.source}>
                        v{String(entry.version)} · {sourceLabel(entry)} · {String(entry.stepCount)}{' '}
                        steps
                      </span>
                      {current && props.latestRun !== undefined ? (
                        <span className="dsh-wf-lib-run" data-latest-run={props.latestRun.id}>
                          <StateDot state={runDotState(props.latestRun.status)} />
                          {`${t('overview.latestRun')}: ${props.latestRun.status}`}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section className="dsh-wf-rail-section" data-section="block-rail">
        <h3 className="dsh-wf-heading">{t('design.railBlocks')}</h3>
        <p className="dsh-wf-kind">{t('design.blocksTriggers')}</p>
        <TriggerBricks {...props} />
        <p className="dsh-wf-kind">{t('design.blocksSteps')}</p>
        <StepBricks {...props} />
      </section>
    </aside>
  )
}
