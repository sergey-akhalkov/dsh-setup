import { Button, PathLabel, Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import {
  ErrorLine,
  evidenceUrl,
  formatTime,
  isRecordEvidence,
  LoadingLine,
  type RunStepView,
  type RunView,
  type Translate,
} from './panel.tsx'
import { durationText } from './run-history.tsx'

/**
 * One run's page: identity, trigger, times, status, steps with their evidence,
 * violations, error, and the record link. The back control restores the list.
 */

function evidenceCell(step: RunStepView, session: string | undefined): ReactNode {
  const ref = step.evidenceRef
  if (ref !== undefined) {
    const raw = ref.ref
    const name = ref.kind
    if (raw === undefined) return <span data-evidence-kind={name}>{name}</span>
    const label = raw.includes('/') ? <PathLabel path={raw} /> : <span>{raw}</span>
    if (session !== undefined && isRecordEvidence(raw)) {
      return (
        <a
          href={evidenceUrl(session, raw)}
          target="_blank"
          rel="noreferrer"
          data-evidence-kind={name}
        >
          <span className="dsh-wf-evidence-kind">{name}</span> {label}
        </a>
      )
    }
    return (
      <span data-evidence-kind={name}>
        <span className="dsh-wf-evidence-kind">{name}</span> {label}
      </span>
    )
  }
  if (step.evidence === undefined) return '—'
  if (session === undefined || !isRecordEvidence(step.evidence)) return step.evidence
  return (
    <a href={evidenceUrl(session, step.evidence)} target="_blank" rel="noreferrer">
      <PathLabel path={step.evidence} />
    </a>
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

/** The run detail page; a back control returns to the run list. */
export function RunDetailPage(props: {
  readonly run: RunView
  readonly t: Translate
  readonly session?: string
  onBack(): void
}): ReactNode {
  const { run, t, session } = props
  const identity =
    run.definition === undefined
      ? t(`runs.source.${run.source}`)
      : `${run.definition.name} · v${String(run.definition.version)}`
  const duration = durationText(run.startedAt, run.endedAt)
  return (
    <section className="dsh-wf-detail" data-run-detail={run.id}>
      <div className="dsh-wf-detail-bar">
        <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
          {t('runs.back')}
        </Button>
        <h2 className="dsh-wf-detail-title">{run.title}</h2>
        <Tag
          tone={run.status === 'failed' ? 'danger' : run.status === 'done' ? 'success' : 'neutral'}
        >
          {t(`runs.status.${run.status}`)}
        </Tag>
      </div>
      <dl className="dsh-wf-facts">
        <Fact
          label={t('runs.definition')}
          value={<span data-run-definition={run.definition?.id ?? run.source}>{identity}</span>}
        />
        <Fact label={t('runs.trigger')} value={run.trigger ?? '—'} />
        <Fact label={t('runs.started')} value={formatTime(run.startedAt, t)} />
        {run.endedAt === undefined ? null : (
          <Fact label={t('runs.ended')} value={formatTime(run.endedAt, t)} />
        )}
        {duration === undefined ? null : <Fact label={t('runs.duration')} value={duration} />}
      </dl>
      {run.record === undefined ? null : (
        <p className="dsh-wf-muted">
          {`${t('runs.record')}: `}
          {session === undefined ? (
            run.record
          ) : (
            <a href={evidenceUrl(session, run.record)} target="_blank" rel="noreferrer">
              <PathLabel path={run.record} />
            </a>
          )}
        </p>
      )}
      {run.error === undefined ? null : (
        <p className="dsh-wf-error" role="alert">
          {run.error}
        </p>
      )}
      <section className="dsh-wf-section" data-section="steps">
        <h3 className="dsh-wf-heading">{t('runs.steps')}</h3>
        <table className="dsh-wf-table">
          <thead>
            <tr>
              <th>{t('runs.step')}</th>
              <th>{t('runs.state')}</th>
              <th>{t('runs.time')}</th>
              <th>{t('runs.evidence')}</th>
              <th>{t('runs.issue')}</th>
            </tr>
          </thead>
          <tbody>
            {run.steps.map((step) => (
              <tr key={step.id} data-step={step.id} data-state={step.state}>
                <td>{step.title}</td>
                <td>{step.state}</td>
                <td>{step.at === undefined ? '—' : formatTime(step.at, t)}</td>
                <td>{evidenceCell(step, session)}</td>
                <td>
                  {step.failureClass === undefined ? null : (
                    <span data-failure-class={step.failureClass}>{step.failureClass}</span>
                  )}
                  {step.reason === undefined ? null : (
                    <span className="dsh-wf-error"> {step.reason}</span>
                  )}
                  {step.failureClass === undefined && step.reason === undefined ? '—' : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {run.violations === undefined || run.violations.length === 0 ? null : (
        <section className="dsh-wf-section" data-section="violations">
          <h3 className="dsh-wf-heading">{t('runs.violations')}</h3>
          <ul className="dsh-wf-violations">
            {run.violations.map((violation, index) => (
              <li key={`${String(violation.at)}:${String(index)}`} data-step={violation.stepId}>
                {violation.stepId === undefined ? '' : `${violation.stepId}: `}
                {violation.reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}

/** A confirmed lookup miss: the run is no longer recorded; back returns to the list. */
export function MissingRunPage(props: { readonly t: Translate; onBack(): void }): ReactNode {
  return (
    <section className="dsh-wf-detail" data-state="missing" role="status">
      <div className="dsh-wf-detail-bar">
        <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
          {props.t('runs.back')}
        </Button>
      </div>
      <p className="dsh-wf-empty-title">{props.t('runs.missing')}</p>
      <p className="dsh-wf-muted">{props.t('runs.missingBody')}</p>
    </section>
  )
}

/**
 * The selected-run page while its lookup is pending or failed: the back
 * control stays available so a failing lookup never traps the user.
 */
export function RunLookupPage(props: {
  readonly t: Translate
  readonly message?: string
  onBack(): void
  onRetry?(): void
}): ReactNode {
  return (
    <section
      className="dsh-wf-detail"
      data-state={props.message === undefined ? 'loading' : 'error'}
    >
      <div className="dsh-wf-detail-bar">
        <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
          {props.t('runs.back')}
        </Button>
      </div>
      {props.message === undefined ? (
        <LoadingLine t={props.t} />
      ) : (
        <ErrorLine message={props.message} t={props.t} onRetry={props.onRetry ?? (() => {})} />
      )}
    </section>
  )
}
