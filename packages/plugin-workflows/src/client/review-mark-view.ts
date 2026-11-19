import type { LiveReviewEntry } from './review-store.ts'

/**
 * The session-row review mark's pure part: the entry comparison that keeps a
 * polling row from re-rendering, and the wording of the mark's accessible name
 * and tooltip. No React here, so it is unit-testable without the client runtime.
 */

/** Entry identity for the hook: an unchanged batch must not re-render the row. */
export function sameEntries(
  left: readonly LiveReviewEntry[],
  right: readonly LiveReviewEntry[],
): boolean {
  if (left.length !== right.length) return false
  return left.every((entry, index) => {
    const other = right[index]
    return (
      other !== undefined &&
      entry.session === other.session &&
      entry.change === other.change &&
      entry.definition === other.definition &&
      entry.unit === other.unit &&
      entry.label === other.label &&
      entry.state === other.state &&
      entry.attempt === other.attempt &&
      entry.since === other.since
    )
  })
}

export interface ReviewMarkView {
  /** The accessible name: `Review running: <unit>` or `Waiting for review: <unit>`. */
  readonly label: string
  readonly tooltip: string
  readonly waiting: boolean
}

/** The mark's wording for one entry; the first entry is the freshest open review. */
export function reviewMarkView(entry: LiveReviewEntry, t: (key: string) => string): ReviewMarkView {
  if (entry.state === 'waiting') {
    return {
      label: `${t('mark.waiting')}: ${entry.unit}`,
      tooltip: t('mark.waitingTooltip'),
      waiting: true,
    }
  }
  return {
    label: `${t('mark.live')}: ${entry.unit}`,
    tooltip: `${entry.definition} ${t('mark.running')} - ${t('mark.attempt')} ${String(entry.attempt)}`,
    waiting: false,
  }
}
