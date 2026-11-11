import type { ReactNode } from 'react'
import type { Translate } from './panel.tsx'

/**
 * The authenticated receipts of the design page's Diagnostics disclosure. They
 * are read-only; a display action never starts a run or writes a record.
 */

export interface ReceiptView {
  readonly change: string
  readonly kind: string
  readonly digest: string
  readonly issuedAt: number
}

export function receiptsUrl(sessionId: string): string {
  return `/api/workflows/receipts?session=${encodeURIComponent(sessionId)}`
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
              <span className="dsh-wf-summary">{receipt.digest.slice(0, 8)}…</span>
              <span className="dsh-wf-time">{new Date(receipt.issuedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
