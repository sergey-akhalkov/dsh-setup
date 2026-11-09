import type { ReactNode } from 'react'
import type { Translate } from './panel.tsx'

/**
 * The obligation-engine sections of the Workflows view: the installed
 * definitions, their triggers and steps, and the authenticated receipts. They
 * are read-only; a display action never starts a run or writes a record.
 */

export interface DefinitionStepView {
  readonly id: string
  readonly title: string
  readonly executor: string
  readonly ownership: string
  readonly blockTurnClose: boolean
}

export interface DefinitionView {
  readonly id: string
  readonly name: string
  readonly version: number
  readonly trigger: {
    readonly kind: string
    readonly mode: string
    readonly dedupe: string
    readonly match?: Readonly<Record<string, string>>
  }
  readonly risk: string
  readonly allowModelStart: boolean
  readonly gateOwnership: string
  readonly steps: readonly DefinitionStepView[]
}

export interface ReceiptView {
  readonly change: string
  readonly kind: string
  readonly digest: string
  readonly issuedAt: number
}

export function definitionsUrl(sessionId: string): string {
  return `/api/workflows/definitions?session=${encodeURIComponent(sessionId)}`
}

export function receiptsUrl(sessionId: string): string {
  return `/api/workflows/receipts?session=${encodeURIComponent(sessionId)}`
}

function filterSummary(match: Readonly<Record<string, string>> | undefined): string {
  if (match === undefined) return 'any'
  const entries = Object.entries(match)
  return entries.length === 0 ? 'any' : entries.map(([key, value]) => `${key}: ${value}`).join(', ')
}

/** The Definitions section: trigger, mode, risk, and the owned/deferred steps. */
export function DefinitionsTable(props: {
  readonly definitions: readonly DefinitionView[]
  readonly t: Translate
}): ReactNode {
  const { definitions, t } = props
  return (
    <section className="dsh-wf-section" data-section="definitions">
      <h3 className="dsh-wf-heading">{t('definitions.heading')}</h3>
      {definitions.length === 0 ? (
        <p className="dsh-wf-muted">{t('definitions.empty')}</p>
      ) : (
        <table className="dsh-wf-table">
          <thead>
            <tr>
              <th>{t('definitions.id')}</th>
              <th>{t('definitions.trigger')}</th>
              <th>{t('definitions.mode')}</th>
              <th>{t('definitions.risk')}</th>
              <th>{t('definitions.steps')}</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((definition) => (
              <tr key={definition.id} data-definition={definition.id}>
                <td>{definition.id}</td>
                <td>
                  {definition.trigger.kind} ({filterSummary(definition.trigger.match)})
                </td>
                <td>
                  {definition.trigger.mode} / {definition.gateOwnership}
                </td>
                <td>{definition.risk}</td>
                <td>
                  {definition.steps
                    .map((step) => `${step.id}:${step.executor}/${step.ownership}`)
                    .join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/** The Receipts section: one row per authenticated completion/adoption receipt. */
export function ReceiptsList(props: {
  readonly receipts: readonly ReceiptView[]
  readonly t: Translate
}): ReactNode {
  const { receipts, t } = props
  return (
    <section className="dsh-wf-section" data-section="receipts">
      <h3 className="dsh-wf-heading">{t('receipts.heading')}</h3>
      {receipts.length === 0 ? (
        <p className="dsh-wf-muted">{t('receipts.empty')}</p>
      ) : (
        <ul className="dsh-wf-runs">
          {receipts.map((receipt) => (
            <li key={`${receipt.kind}:${receipt.change}`} data-receipt={receipt.change}>
              <span className="dsh-wf-kind">{receipt.kind}</span>
              <span className="dsh-wf-subject">{receipt.change}</span>
              <span className="dsh-wf-summary">{receipt.digest.slice(0, 12)}…</span>
              <span className="dsh-wf-time">{new Date(receipt.issuedAt).toISOString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
