import {
  AnimatedRows,
  Button,
  relativeTime,
  StateDot,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import {
  formatTime,
  type HealthView,
  type JournalEvent,
  projectedRunId,
  type RunView,
  reasonLabel,
  type Translate,
} from './panel.tsx'

/**
 * The session run history: the status line, the newest-first run rows, and the
 * journal segment whose evaluations render beside the event they evaluated.
 * Every component is a pure function of host data.
 */

const DOT_STATES = ['done', 'warning', 'ongoing', 'error', 'idle'] as const
type DotState = (typeof DOT_STATES)[number]

/** A run status as the shipped state dot describes it. */
export function runDot(status: RunView['status']): DotState {
  if (status === 'running') return 'ongoing'
  if (status === 'done') return 'done'
  if (status === 'failed') return 'error'
  return 'idle'
}

/** A listener state as the shipped state dot describes it. */
function healthDot(state: HealthView['state']): DotState {
  if (state === 'healthy') return 'done'
  if (state === 'waiting') return 'ongoing'
  if (state === 'journal-readonly') return 'warning'
  return 'error'
}

/** Compact relative time in the view dictionary, never a raw locale key. */
export function relativeLabel(
  bucket: ReturnType<typeof relativeTime> | undefined,
  t: Translate,
): string {
  if (bucket === undefined || bucket.unit === 'now') return t('time.now')
  return `${String(bucket.n)}${t(`time.${bucket.unit}`)}`
}

/** The terminal duration of one run; absent while the run has no end time. */
export function durationText(startedAt: number, endedAt: number | undefined): string | undefined {
  if (endedAt === undefined) return undefined
  const milliseconds = endedAt - startedAt
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return undefined
  const seconds = Math.round(milliseconds / 1000)
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`
  const hours = Math.floor(minutes / 60)
  return `${String(hours)}h ${String(minutes % 60)}m`
}

/** The listener facts behind the status line, available on demand. */
export function statusDetails(health: HealthView, t: Translate): string {
  const parts = [
    `${String(health.listenerCount)} ${t('health.listeners')}`,
    `${String(health.triggerCount)} ${t('health.triggers')}`,
    `${t('health.lastEvent')}: ${formatTime(health.lastEventAt, t)}`,
    `${t('health.lastCheck')}: ${formatTime(health.lastCheckAt, t)}`,
  ]
  if (health.lastError !== undefined) parts.push(`${t('health.lastError')}: ${health.lastError}`)
  return parts.join(' · ')
}

/** One status line: the four states stay distinguishable, details on demand. */
export function StatusLine(props: {
  readonly health: HealthView
  readonly t: Translate
  readonly refreshing?: boolean
  readonly onRefresh?: () => void
}): ReactNode {
  const { health, t } = props
  return (
    <div className="dsh-wf-status" data-state={health.state}>
      <StateDot state={healthDot(health.state)} />
      <span className="dsh-wf-status-text">{t(`health.${health.state}`)}</span>
      <Tooltip label={statusDetails(health, t)}>
        <Button type="button" variant="ghost" size="sm">
          {t('status.details')}
        </Button>
      </Tooltip>
      {props.onRefresh === undefined ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.refreshing === true}
          onClick={props.onRefresh}
        >
          {props.refreshing === true ? t('state.refreshing') : t('state.refresh')}
        </Button>
      )}
    </div>
  )
}

/** One run row: title, trigger (or source), status, relative start, duration. */
function RunRow(props: {
  readonly run: RunView
  readonly t: Translate
  readonly now: number
  onOpen(): void
}): ReactNode {
  const { run, t } = props
  const started = run.startedAt > 0 ? new Date(run.startedAt).toLocaleString() : t('time.unknown')
  const relative =
    run.startedAt > 0 ? relativeLabel(relativeTime(run.startedAt, props.now), t) : t('time.unknown')
  const duration = durationText(run.startedAt, run.endedAt)
  return (
    <li className="dsh-wf-row" data-row-key={run.id} data-status={run.status}>
      <Button
        type="button"
        variant="toolbar"
        size="sm"
        className="dsh-wf-row-button"
        data-run={run.id}
        onClick={props.onOpen}
      >
        <StateDot state={runDot(run.status)} />
        <span className="dsh-wf-run-title">{run.title}</span>
        <Tag tone="quiet">
          {run.trigger === undefined
            ? t(`runs.source.${run.source}`)
            : `${t('runs.trigger')}: ${run.trigger}`}
        </Tag>
        <span className="dsh-wf-run-status">{t(`runs.status.${run.status}`)}</span>
        <Tooltip label={started}>
          <span className="dsh-wf-time">{relative}</span>
        </Tooltip>
        {duration === undefined ? null : (
          <span className="dsh-wf-time" data-duration={duration}>
            {duration}
          </span>
        )}
      </Button>
    </li>
  )
}

/** The attributed runs; selecting a row opens its detail page. */
export function RunList(props: {
  readonly runs: readonly RunView[]
  readonly t: Translate
  readonly now?: number
  readonly onOpen?: (runId: string) => void
}): ReactNode {
  const { runs, t } = props
  if (runs.length === 0) {
    return (
      <p className="dsh-wf-muted" data-section="runs" data-state="empty">
        {t('runs.empty')}
      </p>
    )
  }
  const now = props.now ?? Date.now()
  return (
    <AnimatedRows
      className="dsh-wf-rows"
      role="list"
      label={t('runs.title')}
      rowKeys={runs.map((run) => run.id)}
      ready
      resetKey={`runs:${String(runs.length)}`}
    >
      {runs.map((run) => (
        <RunRow key={run.id} run={run} t={t} now={now} onOpen={() => props.onOpen?.(run.id)} />
      ))}
    </AnimatedRows>
  )
}

/** A run link from an evaluation: only an evaluation with a run id renders one. */
function runLink(runId: string, t: Translate, open: (runId: string) => void): ReactNode {
  return (
    <Button type="button" variant="ghost" size="sm" data-run={runId} onClick={() => open(runId)}>
      {t('events.openRun')}
    </Button>
  )
}

/** One event's triggers, each with its recorded reason and any run link. */
function Evaluations(props: {
  readonly event: JournalEvent
  readonly t: Translate
  open(runId: string): void
}): ReactNode {
  const { event, t } = props
  const evaluations = event.triggers ?? []
  if (evaluations.length === 0) return null
  return (
    <ul className="dsh-wf-evaluations" aria-label={t('events.evaluations')}>
      {evaluations.map((evaluation) => {
        // The producer records a bare engine run id; the projection adds its
        // source prefix, so the journal link must address the projected run.
        const runId = evaluation.runId === undefined ? undefined : projectedRunId(evaluation.runId)
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
            {runId === undefined ? null : runLink(runId, t, props.open)}
          </li>
        )
      })}
    </ul>
  )
}

/** The journal segment: events in time order with their evaluations inline. */
export function JournalList(props: {
  readonly events: readonly JournalEvent[]
  readonly t: Translate
  readonly onOpenRun?: (runId: string) => void
}): ReactNode {
  const { events, t } = props
  if (events.length === 0) {
    return (
      <p className="dsh-wf-muted" data-section="journal" data-state="empty">
        {t('events.empty')}
      </p>
    )
  }
  const open = props.onOpenRun ?? (() => {})
  return (
    <ol className="dsh-wf-events" data-section="journal">
      {events.map((event, index) => (
        <li key={`${String(event.at)}:${String(index)}`} data-kind={event.kind}>
          <div className="dsh-wf-event-head">
            <span className="dsh-wf-time">{formatTime(event.at, t)}</span>
            <Tag tone="quiet">{event.kind}</Tag>
            <span className="dsh-wf-subject">{event.subject}</span>
            <span className="dsh-wf-summary">{event.summary}</span>
            {event.truncated ? <Tag tone="warning">{t('events.truncated')}</Tag> : null}
          </div>
          <Evaluations event={event} t={t} open={open} />
        </li>
      ))}
    </ol>
  )
}
