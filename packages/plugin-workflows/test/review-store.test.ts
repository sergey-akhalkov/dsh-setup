import { describe, expect, it } from 'vitest'
import {
  createLiveReviewStore,
  decodeLiveReviews,
  LIVE_REVIEWS_PATH,
  liveReviewsUrl,
  liveSessions,
  MAX_LIVE_SESSIONS,
  type LiveReviewEntry,
} from '../src/client/review-store.ts'

/**
 * The shared sidebar poll: one batched read for every mounted row, last state
 * kept on a failed read, and no request while the document is hidden.
 */

function entry(session: string, overrides: Partial<LiveReviewEntry> = {}): LiveReviewEntry {
  return {
    session,
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

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A manual clock: one scheduled callback at a time, run only by `tick`. */
function clock(): {
  setTimer: (callback: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  tick: () => Promise<void>
} {
  let pending: (() => void) | undefined
  return {
    setTimer: (callback: () => void) => {
      pending = callback
      return callback
    },
    clearTimer: () => {
      pending = undefined
    },
    tick: async () => {
      const callback = pending
      pending = undefined
      callback?.()
      await flush()
    },
  }
}

describe('live review wire', () => {
  it('decodes a valid body and drops malformed entries without failing the read', () => {
    const decoded = decodeLiveReviews({
      live: [
        entry('session-a'),
        entry('session-a', { label: undefined, state: 'waiting' }),
        { session: 'session-b', change: 'auth' },
        entry('session-c', { state: 'orphaned' as never }),
        entry('session-d', { attempt: 0 }),
        entry('', {}),
      ],
    })
    expect(decoded).toEqual([entry('session-a'), entry('session-a', { label: undefined, state: 'waiting' })])
    expect(decodeLiveReviews({ live: 'nope' })).toEqual([])
    expect(decodeLiveReviews(undefined)).toEqual([])
  })

  it('dedupes session ids, drops empties, and caps the list', () => {
    expect(liveSessions(['a', 'b', 'a', '', 'c'])).toEqual(['a', 'b', 'c'])
    const many = Array.from({ length: MAX_LIVE_SESSIONS + 5 }, (_, index) => `s-${index}`)
    expect(liveSessions(many)).toHaveLength(MAX_LIVE_SESSIONS)
  })

  it('builds the batch URL under the liveness route', () => {
    expect(liveReviewsUrl(['a b', 'c'])).toBe(`${LIVE_REVIEWS_PATH}?sessions=a%20b,c`)
  })
})

describe('live review store', () => {
  it('sends one batched read for the mounted rows and splits the entries', async () => {
    const manual = clock()
    const urls: string[] = []
    const store = createLiveReviewStore({
      fetch: async (url) => {
        urls.push(url)
        return { live: [entry('session-a'), entry('session-b')] }
      },
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
    })
    const seenA: LiveReviewEntry[][] = []
    const seenB: LiveReviewEntry[][] = []
    store.subscribe('session-a', (entries) => seenA.push([...entries]))
    store.subscribe('session-b', (entries) => seenB.push([...entries]))
    await flush()
    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe(`${LIVE_REVIEWS_PATH}?sessions=session-a,session-b`)
    expect(seenA.at(-1)?.map((value) => value.session)).toEqual(['session-a'])
    expect(seenB.at(-1)?.map((value) => value.session)).toEqual(['session-b'])
    store.dispose()
  })

  it('keeps the last state on a failed read and stops after dispose', async () => {
    const manual = clock()
    let fail = false
    const store = createLiveReviewStore({
      fetch: async () => {
        if (fail) throw new Error('the host is unreachable')
        return { live: [entry('session-a')] }
      },
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
    })
    const seen: LiveReviewEntry[][] = []
    store.subscribe('session-a', (entries) => seen.push([...entries]))
    await flush()
    expect(seen).toHaveLength(1)
    fail = true
    await manual.tick()
    await manual.tick()
    // The failed reads publish nothing and keep the last state.
    expect(seen).toHaveLength(1)
    fail = false
    await manual.tick()
    expect(seen).toHaveLength(2)
    expect(seen[1]).toEqual(seen[0])
    store.dispose()
    await manual.tick()
    expect(seen).toHaveLength(2)
  })

  it('pauses while hidden and reads once on the visibility edge', async () => {
    const manual = clock()
    const urls: string[] = []
    let visibilityState: string = 'hidden'
    const listeners: Array<() => void> = []
    const store = createLiveReviewStore({
      fetch: async (url) => {
        urls.push(url)
        return { live: [entry('session-a')] }
      },
      setTimer: manual.setTimer,
      clearTimer: manual.clearTimer,
      document: {
        get visibilityState() {
          return visibilityState
        },
        addEventListener: (type, listener) => {
          if (type === 'visibilitychange') listeners.push(listener)
        },
        removeEventListener: () => {},
      },
    })
    store.subscribe('session-a', () => undefined)
    await flush()
    expect(urls).toHaveLength(0)
    await manual.tick()
    expect(urls).toHaveLength(0)
    visibilityState = 'visible'
    for (const listener of listeners) listener()
    await flush()
    expect(urls).toHaveLength(1)
    store.dispose()
  })
})
