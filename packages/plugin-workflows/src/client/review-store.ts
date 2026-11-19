/**
 * The shared live-review poll: every mounted sidebar row names its session, and
 * the store sends one batched read per interval for all of them. A failed read
 * keeps the last known state so an indicator never blinks off, and the poll
 * pauses while the document is hidden.
 */

/** The read-only liveness route; document-relative for the Web and shell carriers. */
export const LIVE_REVIEWS_PATH = '/api/workflows/reviews/live'

/** A review runs for tens of seconds at minimum, so four seconds is a deliberate approximation. */
export const LIVE_POLL_MS = 4000

/** The route's bounded session list. */
export const MAX_LIVE_SESSIONS = 100

export type LiveReviewState = 'starting' | 'live' | 'waiting'

/** One live or waiting review as the route reports it. */
export interface LiveReviewEntry {
  readonly session: string
  readonly change: string
  readonly definition: string
  readonly unit: 'spec' | 'tasks' | 'integration' | string
  /** Bounded unit detail: a section title, a task number, or a phase. */
  readonly label?: string
  readonly state: LiveReviewState
  readonly attempt: number
  readonly since: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function decodeEntry(value: unknown): LiveReviewEntry | undefined {
  if (!isRecord(value)) return undefined
  const session = nonEmpty(value.session)
  const change = nonEmpty(value.change)
  const definition = nonEmpty(value.definition)
  const unit = nonEmpty(value.unit)
  const state = value.state
  const attempt = value.attempt
  const since = nonEmpty(value.since)
  if (
    session === undefined ||
    change === undefined ||
    definition === undefined ||
    unit === undefined ||
    since === undefined ||
    (state !== 'starting' && state !== 'live' && state !== 'waiting') ||
    typeof attempt !== 'number' ||
    !Number.isSafeInteger(attempt) ||
    attempt < 1
  ) {
    return undefined
  }
  const label = nonEmpty(value.label)
  return {
    session,
    change,
    definition,
    unit,
    ...(label === undefined ? {} : { label }),
    state,
    attempt,
    since,
  }
}

/** Decode one live response; a malformed entry is dropped and a malformed body reads empty. */
export function decodeLiveReviews(body: unknown): LiveReviewEntry[] {
  if (!isRecord(body) || !Array.isArray(body.live)) return []
  const entries: LiveReviewEntry[] = []
  for (const value of body.live) {
    const entry = decodeEntry(value)
    if (entry !== undefined) entries.push(entry)
  }
  return entries
}

/** The deduped, capped id list the batch form sends. */
export function liveSessions(ids: Iterable<string>): string[] {
  const unique: string[] = []
  for (const id of new Set(ids)) {
    if (id !== '' && unique.length < MAX_LIVE_SESSIONS) unique.push(id)
  }
  return unique
}

/** The batch read URL for the given sessions. */
export function liveReviewsUrl(sessions: readonly string[]): string {
  return `${LIVE_REVIEWS_PATH}?sessions=${sessions.map(encodeURIComponent).join(',')}`
}

/** One shared polling store; row occupants subscribe with their session id. */
export interface LiveReviewStore {
  subscribe(session: string, listener: (entries: readonly LiveReviewEntry[]) => void): () => void
  dispose(): void
}

export interface LiveReviewStoreOptions {
  /** The read seam; production calls the route and returns its JSON body. */
  readonly fetch?: (url: string) => Promise<unknown>
  readonly intervalMs?: number
  readonly setTimer?: (callback: () => void, ms: number) => unknown
  readonly clearTimer?: (handle: unknown) => void
  /** The document whose visibility pauses the poll; absent means always visible. */
  readonly document?: {
    readonly visibilityState?: string
    readonly addEventListener?: (type: string, listener: () => void) => void
    readonly removeEventListener?: (type: string, listener: () => void) => void
  }
}

async function defaultFetch(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`the live review read failed (${String(response.status)})`)
  }
  return (await response.json()) as unknown
}

export function createLiveReviewStore(options: LiveReviewStoreOptions = {}): LiveReviewStore {
  const listeners = new Map<string, Set<(entries: readonly LiveReviewEntry[]) => void>>()
  const last = new Map<string, LiveReviewEntry[]>()
  const intervalMs = options.intervalMs ?? LIVE_POLL_MS
  const fetchLive = options.fetch ?? defaultFetch
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
  const clearTimer =
    options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const documentLike = options.document
  let timer: unknown
  let disposed = false
  /** One read at a time: an older response never overwrites a newer state. */
  let inFlight = false

  const visible = (): boolean => (documentLike?.visibilityState ?? 'visible') === 'visible'

  const publish = (): void => {
    for (const [session, sessionListeners] of listeners) {
      const entries = last.get(session) ?? []
      for (const listener of sessionListeners) listener(entries)
    }
  }

  const poll = async (): Promise<void> => {
    if (disposed) return
    if (timer !== undefined) clearTimer(timer)
    timer = setTimer(() => {
      void poll()
    }, intervalMs)
    if (inFlight || !visible()) return
    const sessions = liveSessions(listeners.keys())
    if (sessions.length === 0) return
    inFlight = true
    try {
      const body = await fetchLive(liveReviewsUrl(sessions))
      if (disposed) return
      const bySession = new Map<string, LiveReviewEntry[]>()
      for (const entry of decodeLiveReviews(body)) {
        if (!sessions.includes(entry.session)) continue
        bySession.set(entry.session, [...(bySession.get(entry.session) ?? []), entry])
      }
      for (const session of sessions) last.set(session, bySession.get(session) ?? [])
      publish()
    } catch {
      // A failed read keeps the last state: the indicator must not blink off.
    } finally {
      inFlight = false
    }
  }

  const onVisibility = (): void => {
    if (visible()) void poll()
  }
  documentLike?.addEventListener?.('visibilitychange', onVisibility)

  return {
    subscribe(session, listener) {
      if (disposed) return () => undefined
      const first = listeners.size === 0
      const sessionListeners = listeners.get(session) ?? new Set()
      sessionListeners.add(listener)
      listeners.set(session, sessionListeners)
      // An immediate read only for the first mount; it runs as a microtask so a
      // batch of rows mounting together still sends one request. Later rows join
      // the next tick.
      if (first) {
        queueMicrotask(() => {
          void poll()
        })
      }
      return () => {
        sessionListeners.delete(listener)
        if (sessionListeners.size === 0) {
          listeners.delete(session)
          last.delete(session)
        }
      }
    },
    dispose() {
      disposed = true
      listeners.clear()
      last.clear()
      if (timer !== undefined) clearTimer(timer)
      timer = undefined
      documentLike?.removeEventListener?.('visibilitychange', onVisibility)
    },
  }
}
