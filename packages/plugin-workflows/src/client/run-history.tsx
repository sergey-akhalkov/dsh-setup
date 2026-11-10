import {
  AnimatedRows,
  Button,
  relativeTime,
  StateDot,
  Tag,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { formatTime, type HealthView, type RunView, type Translate } from './panel.tsx'

/**
 * The session run history: the status line and the newest-first run rows.
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
