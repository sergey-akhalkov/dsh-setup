import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { type ReactNode, useEffect, useState } from 'react'
import { reviewMarkView, sameEntries } from './review-mark-view.ts'
import {
  createLiveReviewStore,
  type LiveReviewEntry,
  type LiveReviewStoreOptions,
} from './review-store.ts'

/**
 * The session row's review mark: the shell's own ongoing state dot while a review
 * the session owns is starting or running, and a static dashed ring while it
 * waits on a covering review. The seat renders only on an idle row, so it never
 * competes with the turn spinner; the mark is non-interactive and carries its
 * meaning in the accessible name and the tooltip.
 */

const store = createLiveReviewStore(
  typeof document === 'undefined'
    ? {}
    : { document: document as unknown as LiveReviewStoreOptions['document'] },
)

/** One mount's subscription to the shared poll for its session. */
export function useLiveReviews(sessionId: string | undefined): readonly LiveReviewEntry[] {
  const [entries, setEntries] = useState<readonly LiveReviewEntry[]>([])
  useEffect(() => {
    if (sessionId === undefined) return undefined
    return store.subscribe(sessionId, (next) => {
      setEntries((previous) => (sameEntries(previous, next) ? previous : next))
    })
  }, [sessionId])
  return entries
}

const MARK_CSS = `
.dsh-wf-review-mark { display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; flex: none; }
.dsh-wf-review-ring { box-sizing: border-box; width: 14px; height: 14px; border: 2px dashed var(--dsw-alias-label-secondary); border-radius: 50%; }
`

/** The `sidebar.session.row.leading` occupant: absent unless this session holds a review. */
export function SidebarReviewMark(props: {
  readonly sessionId?: string
  readonly t: (key: string) => string
}): ReactNode {
  const entries = useLiveReviews(props.sessionId)
  const entry = entries[0]
  if (entry === undefined) return null
  const view = reviewMarkView(entry, props.t)
  return (
    <span
      className="dsh-wf-review-mark"
      data-workflows-review-mark=""
      role="status"
      aria-label={view.label}
      title={view.tooltip}
    >
      <style>{MARK_CSS}</style>
      {view.waiting ? (
        <span className="dsh-wf-review-ring" aria-hidden="true" />
      ) : (
        <StateDot state="ongoing" size={14} />
      )}
    </span>
  )
}
