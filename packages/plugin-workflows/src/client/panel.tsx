import { Button, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import { EN, reasonLabel, type Translate } from './locale.ts'

export type { Translate }
export { EN, reasonLabel }

/**
 * Shared client data shapes, API URLs, and copy. The session surfaces live in
 * view.tsx, run-history.tsx, and run-detail.tsx; this module keeps the read
 * contract and the small read-only presenters the design page reuses.
 */

export interface TriggerEvaluation {
  readonly id: string
  readonly matched: boolean
  readonly reason: string
  readonly path?: string
  readonly filter?: string
  readonly runId?: string
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
  /** The structured producer evidence the run overlay renders. */
  readonly evidenceRef?: { readonly kind: string; readonly ref?: string; readonly at?: number }
  /** The producer-owned class of a blocked or failed step. */
  readonly failureClass?: string
  readonly reason?: string
  /** A display row synthesized for a violation, not a real step. */
  readonly synthetic?: boolean
}

export interface RunViolationView {
  readonly stepId?: string
  readonly at: number
  readonly reason: string
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
  /** The definition identity a workflow run recorded at creation. */
  readonly definition?: { readonly id: string; readonly name: string; readonly version: number }
  /** The recorded trigger kind that started an engine run. */
  readonly trigger?: string
  /** The latest settlement time of a terminal run's recorded steps. */
  readonly endedAt?: number
  readonly violations?: readonly RunViolationView[]
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

function pageUrl(
  path: string,
  session: string,
  cursor?: string,
  limit?: number,
  extra?: Readonly<Record<string, string>>,
): string {
  const query = new URLSearchParams({ session })
  if (cursor !== undefined) query.set('cursor', cursor)
  if (limit !== undefined) query.set('limit', String(limit))
  for (const [name, value] of Object.entries(extra ?? {})) query.set(name, value)
  return `${path}?${query.toString()}`
}

export function eventsUrl(session: string, cursor?: string, limit?: number): string {
  return pageUrl(EVENTS_PATH, session, cursor, limit)
}

/** One run page; `order=newest` reverses before paging, `run` resolves one run. */
export function runsUrl(
  session: string,
  cursor?: string,
  limit?: number,
  options?: { readonly order?: 'newest'; readonly run?: string },
): string {
  return pageUrl(RUNS_PATH, session, cursor, limit, {
    ...(options?.order === undefined ? {} : { order: options.order }),
    ...(options?.run === undefined ? {} : { run: options.run }),
  })
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
/** A recorded journal run id in projected form; engine records are bare. */
const PROJECTED_PREFIXES = ['workflow:', 'delegation:', 'review:', 'checkpoint:', 'local-review:']

export function projectedRunId(runId: string): string {
  return PROJECTED_PREFIXES.some((prefix) => runId.startsWith(prefix)) ? runId : `workflow:${runId}`
}

export function formatTime(at: number | undefined, t: Translate): string {
  if (at === undefined || Number.isNaN(at) || at <= 0) return t('time.unknown')
  return new Date(at).toLocaleTimeString()
}

function filterText(trigger: TriggerView): string {
  const parts: string[] = []
  if (trigger.filter.path !== undefined) parts.push(`path: ${trigger.filter.path}`)
  if (trigger.filter.tool !== undefined) parts.push(`tool: ${trigger.filter.tool}`)
  if (trigger.filter.change !== undefined) parts.push(`change: ${trigger.filter.change}`)
  return parts.length === 0 ? '—' : parts.join(', ')
}

/** The configured catalog with its last evaluation; read-only on the design page. */
export function TriggersTable(props: {
  triggers: readonly TriggerView[]
  t: Translate
}): ReactNode {
  const { triggers, t } = props
  return (
    <section className="dsh-wf-section" data-section="triggers">
      <h3 className="dsh-wf-heading">{t('triggers.title')}</h3>
      {triggers.length === 0 ? (
        <p className="dsh-wf-muted">{t('triggers.empty')}</p>
      ) : (
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
                    : `${reasonLabel(trigger.last.reason, t)} · ${formatTime(trigger.last.at, t)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
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
      <Button type="button" variant="outline" size="sm" onClick={props.onRetry}>
        {props.t('state.retry')}
      </Button>
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
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="dsh-wf-more"
      disabled={props.loading === true}
      onClick={props.onLoad}
    >
      {props.t('paging.more')}
    </Button>
  )
}
