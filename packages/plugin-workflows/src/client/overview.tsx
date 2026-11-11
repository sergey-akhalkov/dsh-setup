import { Button, relativeTime, StateDot, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { CanvasBoundary, DesignCanvas } from './canvas.tsx'
import { type Diagram, definitionToGraph, type GraphDefinition } from './graph.ts'
import { withLayout } from './layout.ts'
import { type Overlay, overlayFor, withOverlay } from './overlay.ts'
import {
  type DefinitionStatView,
  type DefinitionStepView,
  type DefinitionTriggerView,
  type DefinitionView,
  ErrorLine,
  formatTime,
  type JournalEvent,
  LoadingLine,
  LoadMore,
  type Page,
  type PageStates,
  pageLoadProps,
  projectedRunId,
  type RunStatsView,
  type RunView,
  reasonLabel,
  type Translate,
  type TriggerCounts,
  type TriggerEvaluation,
  type TriggerView,
} from './panel.tsx'
import { RunList, relativeLabel, runDot } from './run-history.tsx'
import { FLOW_CSS } from './styles.ts'

/**
 * The session overview grouped by trigger kind, the per-workflow page, and the
 * pure joins both render. Every component here is a pure function of host data;
 * the view owns the loading, tokens, and navigation.
 */

/** The evaluation id a definition's own trigger records. */
export function definitionEvaluationId(definitionId: string): string {
  return `definition:${definitionId}`
}

/** A trigger match as readable data, never a raw JSON blob. */
export function matchText(match: Readonly<Record<string, unknown>> | undefined): string {
  if (match === undefined) return '—'
  const parts: string[] = []
  for (const [name, value] of Object.entries(match)) {
    if (value === undefined) continue
    parts.push(`${name}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
  }
  return parts.length === 0 ? '—' : parts.join(', ')
}

/** One workflow's own mode and filter, as its overview row states them. */
export function triggerText(trigger: DefinitionTriggerView | undefined, t: Translate): string {
  if (trigger === undefined) return t('overview.unknownKind')
  return `${t('definitions.mode')}: ${trigger.mode ?? '—'} · ${t('triggers.filter')}: ${matchText(trigger.match)}`
}

/** One definition's own evaluation counts, never a base catalog trigger's. */
export function triggerCountsFor(
  triggers: readonly TriggerView[],
  definitionId: string,
): TriggerCounts | undefined {
  return triggers.find((trigger) => trigger.id === definitionEvaluationId(definitionId))?.counts
}

export interface WorkflowBucket {
  readonly definition: DefinitionView
  readonly stats?: DefinitionStatView
  readonly firings?: TriggerCounts
}

export interface TriggerGroup {
  readonly kind: string
  readonly workflows: readonly WorkflowBucket[]
  readonly firings?: TriggerCounts
}

function sumFirings(workflows: readonly WorkflowBucket[]): TriggerCounts | undefined {
  if (workflows.length === 0) return undefined
  let matched = 0
  let total = 0
  for (const workflow of workflows) {
    // A partial sum would understate the group; show no counter instead.
    if (workflow.firings === undefined) return undefined
    matched += workflow.firings.matched
    total += workflow.firings.total
  }
  return { matched, total }
}

/**
 * Group the installed definitions by their `trigger.kind`. Definition order
 * leads; a base catalog kind with no bound definition is appended so the
 * session can say that nothing listens to it. The group counter sums only the
 * bound definitions' own evaluation counts.
 */
export function groupByTrigger(
  definitions: readonly DefinitionView[],
  triggers: readonly TriggerView[],
  stats?: RunStatsView,
): TriggerGroup[] {
  const order: string[] = []
  const buckets = new Map<string, WorkflowBucket[]>()
  for (const definition of definitions) {
    const kind = definition.trigger?.kind ?? ''
    const statsEntry =
      stats === undefined
        ? undefined
        : Object.hasOwn(stats.definitions, definition.id)
          ? stats.definitions[definition.id]
          : {
              completed: 0,
              failed: 0,
              cancelled: 0,
              interrupted: 0,
              running: 0,
              blocked: 0,
              total: 0,
            }
    const firings = triggerCountsFor(triggers, definition.id)
    const bucket: WorkflowBucket = {
      definition,
      ...(statsEntry === undefined ? {} : { stats: statsEntry }),
      ...(firings === undefined ? {} : { firings }),
    }
    const existing = buckets.get(kind)
    if (existing === undefined) {
      order.push(kind)
      buckets.set(kind, [bucket])
    } else {
      existing.push(bucket)
    }
  }
  for (const trigger of triggers) {
    if (trigger.source === 'workflow-definition') continue
    if (buckets.has(trigger.event)) continue
    order.push(trigger.event)
    buckets.set(trigger.event, [])
  }
  return order.map((kind) => {
    const workflows = buckets.get(kind) ?? []
    const firings = sumFirings(workflows)
    return { kind, workflows, ...(firings === undefined ? {} : { firings }) }
  })
}

/** The ratio plus the separate outcome counts; the host stats are never inferred. */
export function runStatsLabel(stats: DefinitionStatView | undefined, t: Translate): string {
  if (stats === undefined) return t('overview.statsUnavailable')
  const parts = [`${stats.completed} / ${stats.total} ${t('overview.runs')}`]
  parts.push(`${t('overview.failed')} ${stats.failed}`)
  parts.push(`${t('overview.running')} ${stats.running}`)
  if (stats.blocked > 0) parts.push(`${t('overview.blocked')} ${stats.blocked}`)
  parts.push(`${t('overview.cancelled')} ${stats.cancelled}`)
  parts.push(`${t('overview.interrupted')} ${stats.interrupted}`)
  return parts.join(' · ')
}

/**
 * The newest run of one definition in the loaded newest-first page.
 * shortcut: the row reads the loaded session run page, not a per-definition
 * latest-run query; upgrade if a definition's newest run can fall outside it.
 */
export function latestRunFor(runs: readonly RunView[], definitionId: string): RunView | undefined {
  return runs.find((run) => run.definition?.id === definitionId)
}

/** The evaluations one event recorded for the definition's own trigger. */
export function evaluationsFor(
  event: JournalEvent,
  definitionId: string,
): readonly TriggerEvaluation[] {
  const id = definitionEvaluationId(definitionId)
  return (event.triggers ?? []).filter((evaluation) => evaluation.id === id)
}

/** Events carrying at least one evaluation of the definition, other ids removed. */
export function historyEvents(
  events: readonly JournalEvent[],
  definitionId: string,
): readonly JournalEvent[] {
  const found: JournalEvent[] = []
  for (const event of events) {
    const triggers = evaluationsFor(event, definitionId)
    if (triggers.length > 0) found.push({ ...event, triggers })
  }
  return found
}

export interface ChainTarget {
  readonly kind: 'next' | 'then' | 'else' | 'loop'
  readonly target: string
  readonly detail?: string
}

export interface ChainRow {
  readonly step: DefinitionStepView
  readonly targets: readonly ChainTarget[]
}

/** The ordered step chain with each step's next, branch, and loop targets. */
export function architectureChain(
  steps: readonly DefinitionStepView[] | undefined,
  t: Translate,
): ChainRow[] {
  return (steps ?? []).map((step) => {
    const targets: ChainTarget[] = []
    if (step.branch !== undefined) {
      if (step.branch.then !== undefined) targets.push({ kind: 'then', target: step.branch.then })
      if (step.branch.else !== undefined) targets.push({ kind: 'else', target: step.branch.else })
    }
    if (step.loop !== undefined) {
      const details: string[] = []
      if (step.loop.maxIterations !== undefined) {
        details.push(`${String(step.loop.maxIterations)} ${t('overview.iterations')}`)
      }
      if (step.loop.cap !== undefined) details.push(`${t('overview.cap')} ${step.loop.cap}`)
      if (step.loop.list !== undefined) details.push(`${t('overview.list')} ${step.loop.list}`)
      targets.push({
        kind: 'loop',
        target: step.loop.next ?? '—',
        ...(details.length === 0 ? {} : { detail: details.join(', ') }),
      })
    }
    if (step.next !== undefined) targets.push({ kind: 'next', target: step.next })
    return { step, targets }
  })
}

function chainLabel(kind: ChainTarget['kind'], t: Translate): string {
  switch (kind) {
    case 'next':
      return t('workflow.next')
    case 'then':
      return t('workflow.then')
    case 'else':
      return t('workflow.else')
    case 'loop':
      return t('workflow.loop')
  }
}

/** One chain row's targets as visible text. */
export function chainTargetsText(row: ChainRow, t: Translate): string {
  if (row.targets.length === 0) return '—'
  return row.targets
    .map((target) => {
      const label = chainLabel(target.kind, t)
      return target.detail === undefined
        ? `${label}: ${target.target}`
        : `${label}: ${target.target} (${target.detail})`
    })
    .join(' · ')
}

function runStatusLabel(run: RunView, t: Translate): string {
  if (run.status === 'running') return t('runs.status.running')
  if (run.status === 'done') return t('runs.status.done')
  if (run.status === 'failed') return t('runs.status.failed')
  return t('runs.status.unknown')
}

/** One definition's evaluation history, newest page first as the host pages it. */
export function DefinitionHistory(props: {
  readonly events: readonly JournalEvent[]
  readonly definitionId: string
  readonly t: Translate
  onOpenRun(runId: string): void
}): ReactNode {
  const { t } = props
  const rows = props.events.flatMap((event) => {
    const evaluations = evaluationsFor(event, props.definitionId)
    return evaluations.length === 0 ? [] : [{ event, evaluations }]
  })
  if (rows.length === 0) {
    return (
      <p className="dsh-wf-muted" data-section="workflow-history" data-state="empty">
        {t('workflow.noHistory')}
      </p>
    )
  }
  return (
    <ol className="dsh-wf-events" data-section="workflow-history">
      {rows.map(({ event, evaluations }, index) => (
        <li key={`${String(event.at)}:${String(index)}`} data-kind={event.kind}>
          <div className="dsh-wf-event-head">
            <span className="dsh-wf-time">{formatTime(event.at, t)}</span>
            <Tag tone="quiet">{event.kind}</Tag>
            <span className="dsh-wf-subject">{event.subject}</span>
            <span className="dsh-wf-summary">{event.summary}</span>
            {event.truncated ? <Tag tone="warning">{t('events.truncated')}</Tag> : null}
          </div>
          <ul className="dsh-wf-evaluations" aria-label={t('events.evaluations')}>
            {evaluations.map((evaluation) => {
              const runId =
                evaluation.runId === undefined ? undefined : projectedRunId(evaluation.runId)
              return (
                <li
                  key={evaluation.id}
                  data-trigger={evaluation.id}
                  data-matched={evaluation.matched ? 'true' : 'false'}
                >
                  <span className="dsh-wf-trigger">{evaluation.id}</span>
                  <span className="dsh-wf-reason">{reasonLabel(evaluation.reason, t)}</span>
                  {evaluation.path === undefined ? null : (
                    <span className="dsh-wf-muted">{`${t('triggers.filter')}: ${evaluation.path}`}</span>
                  )}
                  {evaluation.filter === undefined ? null : (
                    <span className="dsh-wf-muted">{evaluation.filter}</span>
                  )}
                  {evaluation.detail === undefined ? null : (
                    <span className="dsh-wf-muted">{evaluation.detail}</span>
                  )}
                  {runId === undefined ? null : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-run={runId}
                      onClick={() => props.onOpenRun(runId)}
                    >
                      {t('events.openRun')}
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        </li>
      ))}
    </ol>
  )
}

/** One workflow row of a trigger group. */
function WorkflowRow(props: {
  readonly bucket: WorkflowBucket
  readonly latest?: RunView
  readonly now: number
  readonly t: Translate
  onOpen(): void
}): ReactNode {
  const { bucket, latest, now, t } = props
  const definition = bucket.definition
  return (
    <li className="dsh-wf-row" data-row-key={definition.id}>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        className="dsh-wf-row-button dsh-wf-workflow-row"
        data-workflow={definition.id}
        onClick={props.onOpen}
      >
        <span className="dsh-wf-card-head">
          <span className="dsh-wf-run-title">{definition.name}</span>
          {definition.version === undefined ? null : (
            <Tag tone="quiet">{`v${String(definition.version)}`}</Tag>
          )}
          {definition.risk === undefined ? null : (
            <Tag tone="quiet">{`${t('definitions.risk')}: ${definition.risk}`}</Tag>
          )}
          {definition.source === undefined ? null : (
            <Tag tone="quiet" data-source={definition.source}>
              {`${t('definitions.source')}: ${definition.plugin === undefined ? definition.source : `${definition.source}:${definition.plugin}`}`}
            </Tag>
          )}
        </span>
        <span className="dsh-wf-card-meta">
          <span className="dsh-wf-summary">{triggerText(definition.trigger, t)}</span>
        </span>
        <span className="dsh-wf-card-stats">
          {bucket.stats === undefined || bucket.stats.total === 0 ? null : (
            <span className="dsh-wf-progress" aria-hidden="true">
              <span
                className="dsh-wf-progress-fill"
                style={{
                  width: `${String(Math.round((bucket.stats.completed / bucket.stats.total) * 100))}%`,
                }}
              />
            </span>
          )}
          <span className="dsh-wf-summary" data-workflow-stats={definition.id}>
            {runStatsLabel(bucket.stats, t)}
          </span>
        </span>
        <span className="dsh-wf-card-foot">
          {latest === undefined ? (
            bucket.stats === undefined || bucket.stats.total === 0 ? (
              <span className="dsh-wf-muted">{t('overview.noRuns')}</span>
            ) : null
          ) : (
            <Tooltip label={`${latest.title} · ${new Date(latest.startedAt).toLocaleString()}`}>
              <span className="dsh-wf-time" data-latest-run={latest.id}>
                <StateDot state={runDot(latest.status)} />{' '}
                {`${t('overview.latestRun')}: ${relativeLabel(relativeTime(latest.startedAt, now), t)} · ${runStatusLabel(latest, t)}`}
              </span>
            </Tooltip>
          )}
        </span>
      </Button>
    </li>
  )
}

/** The overview: one section per trigger kind, its workflows, and its counts. */
export function WorkflowOverview(props: {
  readonly definitions: readonly DefinitionView[]
  readonly triggers: readonly TriggerView[]
  readonly stats?: RunStatsView
  readonly latestRuns?: Readonly<Record<string, RunView>>
  readonly runs: readonly RunView[]
  readonly t: Translate
  readonly now?: number
  onOpen(definitionId: string): void
}): ReactNode {
  const { t } = props
  if (props.definitions.length === 0) {
    return (
      <p className="dsh-wf-muted" data-section="workflow-overview" data-state="empty">
        {t('overview.empty')}
      </p>
    )
  }
  const now = props.now ?? Date.now()
  const groups = groupByTrigger(props.definitions, props.triggers, props.stats)
  const bound = groups.filter((group) => group.workflows.length > 0)
  const unbound = groups.filter((group) => group.workflows.length === 0)
  return (
    <div className="dsh-wf-overview" data-section="workflow-overview">
      {bound.map((group) => {
        const label = group.kind === '' ? t('overview.unknownKind') : group.kind
        return (
          <section
            className="dsh-wf-group"
            key={group.kind === '' ? '__unknown' : group.kind}
            data-trigger-kind={group.kind}
          >
            <div className="dsh-wf-group-head">
              <h3 className="dsh-wf-group-title">{label}</h3>
              {group.firings === undefined ? null : (
                <Tag tone="quiet">
                  {`${String(group.firings.matched)} / ${String(group.firings.total)} ${t('overview.firings')}`}
                </Tag>
              )}
            </div>
            <ul className="dsh-wf-rows" aria-label={label}>
              {group.workflows.map((bucket) => {
                const latest =
                  props.latestRuns === undefined
                    ? latestRunFor(props.runs, bucket.definition.id)
                    : Object.hasOwn(props.latestRuns, bucket.definition.id)
                      ? props.latestRuns[bucket.definition.id]
                      : undefined
                return (
                  <WorkflowRow
                    key={bucket.definition.id}
                    bucket={bucket}
                    {...(latest === undefined ? {} : { latest })}
                    now={now}
                    t={t}
                    onOpen={() => props.onOpen(bucket.definition.id)}
                  />
                )
              })}
            </ul>
          </section>
        )
      })}
      {unbound.length === 0 ? null : (
        <section className="dsh-wf-unbound" data-section="unbound-triggers">
          <h3 className="dsh-wf-group-title">{t('overview.unbound')}</h3>
          <div className="dsh-wf-unbound-list">
            {unbound.map((group) => (
              <span
                className="dsh-wf-unbound-row"
                key={group.kind === '' ? '__unknown' : group.kind}
                data-trigger-empty={group.kind}
              >
                <span className="dsh-wf-summary">
                  {group.kind === '' ? t('overview.unknownKind') : group.kind}
                </span>
                <span className="dsh-wf-muted">{t('overview.noWorkflows')}</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function Fact(props: { readonly label: string; readonly value: ReactNode }): ReactNode {
  return (
    <>
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </>
  )
}

export interface WorkflowCanvasModel {
  readonly graph: Diagram
  readonly overlay: Overlay
  readonly run?: RunView
}

/**
 * The workflow page's read-only canvas model: the definition graph in the
 * deterministic auto-layout with the selected run's overlay. The latest loaded
 * run is the default; the layout sidecar is never read or written here.
 */
export function workflowCanvasModel(
  document: DefinitionView,
  runs: readonly RunView[],
  selectedRunId?: string,
): WorkflowCanvasModel | undefined {
  if (document.trigger === undefined || document.steps === undefined) return undefined
  const definition = document as unknown as GraphDefinition
  const graph = withLayout(definitionToGraph(definition))
  const run =
    selectedRunId === undefined ? runs[0] : runs.find((entry) => entry.id === selectedRunId)
  return { graph, overlay: overlayFor(run, definition), ...(run === undefined ? {} : { run }) }
}

/** The workflow page: document facts, read-only canvas and chain, runs, history. */
export function WorkflowPage(props: {
  readonly definitionId: string
  readonly phase: 'loading' | 'ready' | 'error'
  readonly document?: DefinitionView
  readonly trigger?: TriggerView
  readonly runs?: Page<RunView>
  readonly events?: Page<JournalEvent>
  readonly message?: string
  readonly pageStates?: PageStates
  readonly t: Translate
  readonly now?: number
  onBack(): void
  onOpenRun(runId: string): void
  onLoadRuns(): void
  onLoadHistory(): void
  onRetry(): void
}): ReactNode {
  const { definitionId, document, t } = props
  const [overlayRunId, setOverlayRunId] = useState<string>()
  const [canvasSelection, setCanvasSelection] = useState<string>()
  const counts = props.trigger?.counts
  const risk = document?.risk ?? document?.settings?.risk
  const gateOwnership = document?.gateOwnership ?? document?.settings?.gateOwnership
  const chain = architectureChain(document?.steps, t)
  const pageRuns = props.runs?.items ?? []
  const canvas =
    document === undefined ? undefined : workflowCanvasModel(document, pageRuns, overlayRunId)
  return (
    <section className="dsh-wf-detail" data-workflow-page={definitionId}>
      <div className="dsh-wf-detail-bar">
        <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
          {t('workflow.back')}
        </Button>
        <h2 className="dsh-wf-detail-title">{document?.name ?? definitionId}</h2>
        {document?.version === undefined ? null : (
          <Tag tone="quiet">{`v${String(document.version)}`}</Tag>
        )}
      </div>
      {props.phase === 'loading' ? (
        <LoadingLine t={t} />
      ) : props.phase === 'error' || document === undefined ? (
        <ErrorLine message={props.message ?? ''} t={t} onRetry={props.onRetry} />
      ) : (
        <>
          <p className="dsh-wf-description" data-section="workflow-description">
            {document.description === undefined || document.description.trim() === ''
              ? t('workflow.noDescription')
              : document.description}
          </p>
          <dl className="dsh-wf-facts">
            <Fact
              label={t('workflow.version')}
              value={document.version === undefined ? '—' : `v${String(document.version)}`}
            />
            <Fact label={t('definitions.risk')} value={risk ?? '—'} />
            <Fact label={t('workflow.gateOwnership')} value={gateOwnership ?? '—'} />
            <Fact
              label={t('definitions.source')}
              value={
                document.source === undefined
                  ? '—'
                  : document.plugin === undefined
                    ? document.source
                    : `${document.source}:${document.plugin}`
              }
            />
            <Fact
              label={t('workflow.trigger')}
              value={
                document.trigger === undefined
                  ? t('overview.unknownKind')
                  : `${document.trigger.kind} · ${t('definitions.mode')}: ${document.trigger.mode ?? '—'} · ${t('triggers.filter')}: ${matchText(document.trigger.match)}`
              }
            />
            <Fact
              label={t('workflow.firings')}
              value={
                counts === undefined
                  ? t('workflow.countsUnavailable')
                  : `${String(counts.matched)} / ${String(counts.total)} ${t('overview.firings')}`
              }
            />
          </dl>
          <section className="dsh-wf-section" data-section="workflow-architecture">
            <h3 className="dsh-wf-heading">{t('workflow.architecture')}</h3>
            {canvas === undefined ? null : (
              <>
                <style>{FLOW_CSS}</style>
                <div className="dsh-wf-canvas-toolbar">
                  <label>
                    {t('workflow.overlayRun')}
                    <select
                      aria-label={t('workflow.overlayRun')}
                      value={overlayRunId ?? ''}
                      onChange={(event) =>
                        setOverlayRunId(
                          event.currentTarget.value === '' ? undefined : event.currentTarget.value,
                        )
                      }
                      disabled={pageRuns.length === 0}
                    >
                      <option value="">{t('workflow.overlayLatest')}</option>
                      {pageRuns.map((run) => (
                        <option key={run.id} value={run.id}>
                          {`${run.id} · ${run.status}`}
                        </option>
                      ))}
                    </select>
                  </label>
                  {canvas.overlay.versionsDiffer ? (
                    <span className="dsh-wf-muted">{t('workflow.overlayDiffers')}</span>
                  ) : null}
                </div>
                {canvas.overlay.notices.length === 0 ? null : (
                  <p className="dsh-wf-issue" role="status">
                    {canvas.overlay.notices.join(' ')}
                  </p>
                )}
                <div
                  className="dsh-wf-canvas dsh-wf-session-canvas"
                  data-readonly="true"
                  data-tab-group="workflow-canvas"
                >
                  <CanvasBoundary
                    fallback={<p className="dsh-wf-muted">{t('workflow.canvasFallback')}</p>}
                  >
                    <DesignCanvas
                      nodes={withOverlay(canvas.graph.nodes, canvas.overlay)}
                      edges={canvas.graph.edges}
                      {...(canvasSelection === undefined ? {} : { selected: canvasSelection })}
                      focusKey={`${document?.id ?? definitionId}:${String(document?.version ?? 0)}:${canvas.run?.id ?? 'none'}`}
                      readOnly
                      onSelect={setCanvasSelection}
                    />
                  </CanvasBoundary>
                </div>
              </>
            )}
            {chain.length === 0 ? (
              <p className="dsh-wf-muted">{t('workflow.noSteps')}</p>
            ) : (
              <table className="dsh-wf-table">
                <thead>
                  <tr>
                    <th>{t('workflow.step')}</th>
                    <th>{t('workflow.executor')}</th>
                    <th>{t('workflow.next')}</th>
                  </tr>
                </thead>
                <tbody>
                  {chain.map((row) => (
                    <tr key={row.step.id} data-step={row.step.id}>
                      <td>{row.step.title}</td>
                      <td>
                        <span className="dsh-wf-chip">{row.step.executor}</span>
                      </td>
                      <td className="dsh-wf-summary">{chainTargetsText(row, t)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="dsh-wf-section" data-section="workflow-runs">
            <h3 className="dsh-wf-heading">{t('workflow.runs')}</h3>
            {props.runs === undefined ? (
              <LoadingLine t={t} />
            ) : props.runs.items.length === 0 ? (
              <p className="dsh-wf-muted" data-state="empty">
                {t('workflow.noRuns')}
              </p>
            ) : (
              <RunList runs={props.runs.items} t={t} now={props.now} onOpen={props.onOpenRun} />
            )}
            <LoadMore
              next={props.runs?.next}
              t={t}
              onLoad={props.onLoadRuns}
              {...pageLoadProps(props.pageStates, 'workflowRuns', props.runs?.next, t)}
            />
          </section>
          <section className="dsh-wf-section" data-section="workflow-history">
            <h3 className="dsh-wf-heading">{t('workflow.history')}</h3>
            {props.events === undefined ? (
              <LoadingLine t={t} />
            ) : (
              <DefinitionHistory
                events={props.events.items}
                definitionId={definitionId}
                t={t}
                onOpenRun={props.onOpenRun}
              />
            )}
            <LoadMore
              next={props.events?.next}
              t={t}
              onLoad={props.onLoadHistory}
              {...pageLoadProps(props.pageStates, 'history', props.events?.next, t)}
            />
          </section>
        </>
      )}
    </section>
  )
}
