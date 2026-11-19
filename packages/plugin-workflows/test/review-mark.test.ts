import { describe, expect, it } from 'vitest'
import { reviewMarkView, sameEntries } from '../src/client/review-mark-view.ts'
import type { LiveReviewEntry } from '../src/client/review-store.ts'

/**
 * The session-row review mark: a running review names its unit and attempt, a
 * waiting one keeps the spinner off, and an unchanged batch never re-renders.
 */

const COPY: Record<string, string> = {
  'mark.live': 'Review running',
  'mark.waiting': 'Waiting for review',
  'mark.running': 'running',
  'mark.attempt': 'attempt',
  'mark.waitingTooltip': 'Waiting for the live review run',
}

const t = (key: string): string => COPY[key] ?? key

function entry(overrides: Partial<LiveReviewEntry> = {}): LiveReviewEntry {
  return {
    session: 'session-a',
    change: 'show-review-status',
    definition: 'task-review',
    unit: 'tasks',
    label: '1. Lane',
    state: 'live',
    attempt: 1,
    since: '2026-11-19T10:00:00.000Z',
    ...overrides,
  }
}

describe('session review mark', () => {
  it('names a running review unit and its attempt', () => {
    expect(
      reviewMarkView(entry({ definition: 'spec-review', unit: 'spec', attempt: 2 }), t),
    ).toEqual({
      label: 'Review running: spec',
      tooltip: 'spec-review running - attempt 2',
      waiting: false,
    })
  })

  it('treats a starting review like a running one', () => {
    expect(reviewMarkView(entry({ state: 'starting', attempt: 1 }), t).waiting).toBe(false)
  })

  it('keeps the spinner off for a waiting review', () => {
    expect(reviewMarkView(entry({ state: 'waiting' }), t)).toEqual({
      label: 'Waiting for review: tasks',
      tooltip: 'Waiting for the live review run',
      waiting: true,
    })
  })

  it('suppresses a re-render for an unchanged batch', () => {
    expect(sameEntries([entry()], [entry()])).toBe(true)
    expect(sameEntries([entry()], [entry({ attempt: 2 })])).toBe(false)
    expect(sameEntries([entry()], [])).toBe(false)
    expect(sameEntries([], [entry()])).toBe(false)
  })
})
