import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'

/**
 * Presentational pieces of the Workflows conversation view. Every component is
 * a pure function of data the host API returned; the container in view.tsx owns
 * fetching, paging, and selection so these stay statically testable.
 */

export type Translate = (key: string) => string

export interface TriggerEvaluation {
  readonly id: string
  readonly matched: boolean
  readonly reason: string
  readonly path?: string
  readonly filter?: string
  readonly detail?: string
}

export interface JournalEvent {
  readonly v: number
  readonly at: number
  readonly session: string
  readonly turn?: number
  readonly kind: string
  readonly subject: string
  readonly callId?: string
  readonly ok?: boolean
  readonly summary: string
  readonly bytes: number
  readonly truncated: boolean
  readonly triggers?: readonly TriggerEvaluation[]
}

export interface TriggerView {
  readonly id: string
  readonly event: string
  readonly filter: { readonly path?: string; readonly tool?: string; readonly change?: string }
  readonly mode: string
  readonly dedupe: string
  readonly last?: { readonly at: number; readonly matched: boolean; readonly reason: string }
}

export interface HealthView {
  readonly state: 'listener-down' | 'journal-readonly' | 'waiting' | 'healthy'
  readonly listenerCount: number
  readonly lastEventAt?: number
  readonly lastCheckAt?: number
  readonly journalWritable: boolean
  readonly triggerCount: number
  readonly lastErrorAt?: number
  readonly lastError?: string
  readonly session: string
}

export interface RunStepView {
  readonly id: string
  readonly title: string
  readonly state: string
  readonly at?: number
  readonly evidence?: string
}

export interface RunView {
  readonly id: string
  readonly source: 'checkpoint' | 'delegation' | 'review' | 'workflow'
  readonly session?: string
  readonly attribution: 'local' | 'portable' | 'unattributed'
  readonly title: string
  readonly startedAt: number
  readonly status: 'running' | 'done' | 'failed' | 'unknown'
  readonly steps: readonly RunStepView[]
  readonly error?: string
  readonly record?: string
}

export interface Page<T> {
  readonly items: readonly T[]
  readonly next?: string
}

/** Document-relative API paths, so the Web page and desktop shell agree. */
export const EVENTS_PATH = '/api/workflows/events'
export const RUNS_PATH = '/api/workflows/runs'
export const TRIGGERS_PATH = '/api/workflows/triggers'
export const HEALTH_PATH = '/api/workflows/health'
export const EVIDENCE_PATH = '/api/workflows/evidence'

function pageUrl(path: string, session: string, cursor?: string, limit?: number): string {
  const query = new URLSearchParams({ session })
  if (cursor !== undefined) query.set('cursor', cursor)
  if (limit !== undefined) query.set('limit', String(limit))
  return `${path}?${query.toString()}`
}

export function eventsUrl(session: string, cursor?: string, limit?: number): string {
  return pageUrl(EVENTS_PATH, session, cursor, limit)
}

export function runsUrl(session: string, cursor?: string, limit?: number): string {
  return pageUrl(RUNS_PATH, session, cursor, limit)
}

export function triggersUrl(session: string): string {
  return pageUrl(TRIGGERS_PATH, session)
}

export function isRecordEvidence(value: string): boolean {
  if (!value.endsWith('.json')) return false
  return (
    value.startsWith('.dsh/delegation/') ||
    value.startsWith('.dsh/work-checkpoints/') ||
    value.startsWith('openspec/changes/')
  )
}

export function evidenceUrl(session: string, path: string): string {
  const search = new URLSearchParams({ session, path })
  return `${EVIDENCE_PATH}?${search.toString()}`
}

export function healthUrl(session: string): string {
  return pageUrl(HEALTH_PATH, session)
}

/** Fetch one JSON response; a failure carries the host's bounded message. */
export async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  const body = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `the request failed (${String(response.status)})`)
  return body
}

/** View copy, registered into the Client locale registry. */
export const EN: Record<string, string> = {
  'view.label': 'Workflows',
  'state.loading': 'Reading the workflow journal…',
  'state.error': 'The Workflows view could not be loaded.',
  'state.retry': 'Retry',
  'state.empty': 'Nothing recorded yet.',
  'state.noSession': 'Open a session to see its workflow process.',
  'health.title': 'Health',
  'health.listener-down': 'The recorder listener is down',
  'health.journal-readonly': 'The journal is read-only',
  'health.waiting': 'Listener healthy, no matching event yet',
  'health.healthy': 'Listener healthy and matching events observed',
  'health.listeners': 'listeners',
  'health.triggers': 'triggers',
  'health.lastEvent': 'last event',
  'health.lastCheck': 'last check',
  'health.never': 'never',
  'health.lastError': 'last error',
  'triggers.title': 'Triggers',
  'triggers.empty': 'No trigger catalog is loaded.',
  'triggers.id': 'Trigger',
  'triggers.event': 'Event',
  'triggers.filter': 'Filter',
  'triggers.mode': 'Mode',
  'triggers.last': 'Last evaluation',
  'triggers.notEvaluated': 'not evaluated yet',
  'events.title': 'Session',
  'events.empty': 'No process event recorded in this session yet.',
  'events.truncated': 'payload truncated',
  'events.calls': 'Load more events',
  'runs.title': 'Runs',
  'runs.empty': 'No run is attributable to this session yet.',
  'runs.open': 'Open run detail',
  'runs.detail': 'Run detail',
  'runs.record': 'Record',
  'runs.steps': 'Steps',
  'runs.step': 'Step',
  'runs.state': 'State',
  'runs.time': 'Time',
  'runs.evidence': 'Evidence',
  'runs.attribution.local': 'local',
  'runs.attribution.portable': 'portable',
  'runs.attribution.unattributed': 'unattributed',
  'runs.status.running': 'running',
  'runs.status.done': 'done',
  'runs.status.failed': 'failed',
  'runs.status.unknown': 'unknown',
  'runs.source.checkpoint': 'checkpoint',
  'runs.source.delegation': 'delegation',
  'runs.source.review': 'review',
  'runs.source.workflow': 'workflow',
  'whyNot.title': 'Why not',
  'whyNot.empty': 'No trigger evaluation has been recorded yet.',
  'whyNot.trigger': 'Trigger',
  'whyNot.result': 'Result',
  'whyNot.reason': 'Reason',
  'whyNot.path': 'Rejected path',
  'whyNot.filter': 'Filter',
  'whyNot.matched': 'matched',
  'whyNot.notMatched': 'not matched',
  'reason.would-fire': 'would fire',
  'reason.event-mismatch': 'event mismatch',
  'reason.filter-mismatch': 'filter mismatch',
  'reason.dedupe': 'duplicate',
  'reason.disabled': 'disabled',
  'reason.not-ready': 'not ready',
  'reason.error': 'error',
  'paging.more': 'Load more',
  'paging.end': 'End of the recorded page.',
  'time.unknown': 'unknown time',
  'bytes.unknown': 'size unknown',
}

export function formatTime(at: number | undefined, t: Translate): string {
  if (at === undefined || Number.isNaN(at) || at <= 0) return t('time.unknown')
  return new Date(at).toLocaleTimeString()
}

function dotFor(state: HealthView['state']): 'done' | 'warning' | 'ongoing' | 'error' {
  if (state === 'healthy') return 'done'
  if (state === 'waiting') return 'ongoing'
  if (state === 'journal-readonly') return 'warning'
  return 'error'
}

function Section(props: { id: string; title: string; children: ReactNode }): ReactNode {
  return (
    <section className="dsh-wf-section" data-section={props.id}>
      <h2 className="dsh-wf-heading">{props.title}</h2>
      {props.children}
    </section>
  )
}

/** One-line listener health, never derived from silence alone. */
export function HealthStrip(props: { health: HealthView; t: Translate }): ReactNode {
  const { health, t } = props
  return (
    <section className="dsh-wf-health" data-state={health.state}>
      <span className="dsh-wf-health-dot" data-state={dotFor(health.state)} aria-hidden="true" />
      <strong>{t(`health.${health.state}`)}</strong>
      <span>{`${String(health.listenerCount)} ${t('health.listeners')}`}</span>
      <span>{`${String(health.triggerCount)} ${t('health.triggers')}`}</span>
      <span>{`${t('health.lastEvent')}: ${formatTime(health.lastEventAt, t)}`}</span>
      <span>{`${t('health.lastCheck')}: ${formatTime(health.lastCheckAt, t)}`}</span>
      {health.lastError === undefined ? null : (
        <span className="dsh-wf-error" role="alert">
          {`${t('health.lastError')}: ${health.lastError}`}
        </span>
      )}
    </section>
  )
}

function filterText(trigger: TriggerView): string {
  const parts: string[] = []
  if (trigger.filter.path !== undefined) parts.push(`path: ${trigger.filter.path}`)
  if (trigger.filter.tool !== undefined) parts.push(`tool: ${trigger.filter.tool}`)
  if (trigger.filter.change !== undefined) parts.push(`change: ${trigger.filter.change}`)
  return parts.length === 0 ? '—' : parts.join(', ')
}

/** The configured shadow catalog with its last evaluation. */
export function TriggersTable(props: {
  triggers: readonly TriggerView[]
  t: Translate
}): ReactNode {
  const { triggers, t } = props
  if (triggers.length === 0) {
    return (
      <Section id="triggers" title={t('triggers.title')}>
        <p className="dsh-wf-muted">{t('triggers.empty')}</p>
      </Section>
    )
  }
  return (
    <Section id="triggers" title={t('triggers.title')}>
      <table className="dsh-wf-table">
        <thead>
          <tr>
            <th>{t('triggers.id')}</th>
            <th>{t('triggers.event')}</th>
            <th>{t('triggers.filter')}</th>
            <th>{t('triggers.mode')}</th>
            <th>{t('triggers.last')}</th>
          </tr>
        </thead>
        <tbody>
          {triggers.map((trigger) => (
            <tr key={trigger.id} data-trigger={trigger.id}>
              <td>{trigger.id}</td>
              <td>{trigger.event}</td>
              <td>{filterText(trigger)}</td>
              <td>
                <Tag tone="quiet">{trigger.mode}</Tag>
              </td>
              <td>
                {trigger.last === undefined
                  ? t('triggers.notEvaluated')
                  : `${t(`reason.${trigger.last.reason}`)} · ${formatTime(trigger.last.at, t)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

/** The session's event rows, including a truncation marker. */
export function EventList(props: { events: readonly JournalEvent[]; t: Translate }): ReactNode {
  const { events, t } = props
  return (
    <Section id="events" title={t('events.title')}>
      {events.length === 0 ? (
        <p className="dsh-wf-muted">{t('events.empty')}</p>
      ) : (
        <ol className="dsh-wf-events">
          {events.map((event, index) => (
            <li key={`${String(event.at)}:${String(index)}`} data-kind={event.kind}>
              <span className="dsh-wf-time">{formatTime(event.at, t)}</span>
              <span className="dsh-wf-kind">{event.kind}</span>
              <span className="dsh-wf-subject">{event.subject}</span>
              <span className="dsh-wf-summary">{event.summary}</span>
              {event.truncated ? <Tag tone="warning">{t('events.truncated')}</Tag> : null}
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

/** Every trigger evaluation for the loaded events, matched and explained. */
export function WhyNotTable(props: { events: readonly JournalEvent[]; t: Translate }): ReactNode {
  const rows = props.events.flatMap((event) =>
    (event.triggers ?? []).map((evaluation) => ({ evaluation, at: event.at })),
  )
  const { t } = props
  return (
    <Section id="why-not" title={t('whyNot.title')}>
      {rows.length === 0 ? (
        <p className="dsh-wf-muted">{t('whyNot.empty')}</p>
      ) : (
        <table className="dsh-wf-table">
          <thead>
            <tr>
              <th>{t('whyNot.trigger')}</th>
              <th>{t('whyNot.result')}</th>
              <th>{t('whyNot.reason')}</th>
              <th>{t('whyNot.path')}</th>
              <th>{t('whyNot.filter')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={`${row.evaluation.id}:${String(row.at)}:${String(index)}`}
                data-trigger={row.evaluation.id}
                data-matched={row.evaluation.matched ? 'true' : 'false'}
              >
                <td>{row.evaluation.id}</td>
                <td>{row.evaluation.matched ? t('whyNot.matched') : t('whyNot.notMatched')}</td>
                <td>{t(`reason.${row.evaluation.reason}`)}</td>
                <td>{row.evaluation.path ?? '—'}</td>
                <td>{row.evaluation.filter ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  )
}

/** The attributed run list; selecting a row opens its detail. */
export function RunsList(props: {
  runs: readonly RunView[]
  t: Translate
  selected?: string
  onSelect(run: RunView): void
}): ReactNode {
  const { runs, t } = props
  return (
    <Section id="runs" title={t('runs.title')}>
      {runs.length === 0 ? (
        <p className="dsh-wf-muted">{t('runs.empty')}</p>
      ) : (
        <ol className="dsh-wf-runs">
          {runs.map((run) => (
            <li key={run.id}>
              <button
                type="button"
                className="dsh-wf-run"
                data-run={run.id}
                data-status={run.status}
                aria-pressed={props.selected === run.id}
                onClick={() => props.onSelect(run)}
              >
                <span className="dsh-wf-time">{formatTime(run.startedAt, t)}</span>
                <span>{run.title}</span>
                <Tag tone="quiet">{t(`runs.source.${run.source}`)}</Tag>
                <Tag tone="outline">{t(`runs.attribution.${run.attribution}`)}</Tag>
                <Tag tone={run.status === 'failed' ? 'danger' : 'neutral'}>
                  {t(`runs.status.${run.status}`)}
                </Tag>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Section>
  )
}

/** One run's steps, evidence, and any recorded error. */
export function RunDetail(props: { run: RunView; t: Translate; session?: string }): ReactNode {
  const { run, t } = props
  return (
    <Section id="run-detail" title={t('runs.detail')}>
      <div className="dsh-wf-run-head">
        <strong>{run.title}</strong>
        <span>{t(`runs.source.${run.source}`)}</span>
        <span>{t(`runs.attribution.${run.attribution}`)}</span>
        <span>{t(`runs.status.${run.status}`)}</span>
      </div>
      {run.record === undefined ? null : (
        <p className="dsh-wf-muted">
          {`${t('runs.record')}: `}
          {props.session === undefined ? (
            run.record
          ) : (
            <a href={evidenceUrl(props.session, run.record)} target="_blank" rel="noreferrer">
              {run.record}
            </a>
          )}
        </p>
      )}
      {run.error === undefined ? null : (
        <p className="dsh-wf-error" role="alert">
          {run.error}
        </p>
      )}
      <table className="dsh-wf-table">
        <thead>
          <tr>
            <th>{t('runs.step')}</th>
            <th>{t('runs.state')}</th>
            <th>{t('runs.time')}</th>
            <th>{t('runs.evidence')}</th>
          </tr>
        </thead>
        <tbody>
          {run.steps.map((step) => (
            <tr key={step.id} data-step={step.id}>
              <td>{step.title}</td>
              <td>{step.state}</td>
              <td>{step.at === undefined ? '—' : formatTime(step.at, t)}</td>
              <td>
                {step.evidence === undefined ? (
                  '—'
                ) : props.session === undefined || !isRecordEvidence(step.evidence) ? (
                  step.evidence
                ) : (
                  <a
                    href={evidenceUrl(props.session, step.evidence)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {step.evidence}
                  </a>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  )
}

export function LoadingLine(props: { t: Translate }): ReactNode {
  return (
    <p className="dsh-wf-muted" role="status">
      {props.t('state.loading')}
    </p>
  )
}

export function ErrorLine(props: { message: string; t: Translate; onRetry(): void }): ReactNode {
  return (
    <div className="dsh-wf-error-block" role="alert">
      <p>{`${props.t('state.error')} ${props.message}`}</p>
      <button type="button" className="dsh-wf-retry" onClick={props.onRetry}>
        {props.t('state.retry')}
      </button>
    </div>
  )
}

export function LoadMore(props: {
  next: string | undefined
  t: Translate
  loading?: boolean
  error?: string
  onLoad(): void
}): ReactNode {
  if (props.next === undefined) return null
  if (props.error !== undefined) {
    return <ErrorLine message={props.error} t={props.t} onRetry={props.onLoad} />
  }
  return (
    <button
      type="button"
      className="dsh-wf-more"
      disabled={props.loading === true}
      onClick={props.onLoad}
    >
      {props.t('paging.more')}
    </button>
  )
}
