import type { TraceRecord } from './records.js'

/** One session's memory-resident aggregate inputs. */
interface CacheEntry {
  readonly stamp: string
  readonly records: readonly TraceRecord[]
}

/**
 * Least-recently-used cache of per-session extracted records, keyed by session
 * identity and a modification stamp (event count plus newest event time). It
 * holds no path and opens no file: a Host restart starts empty, so there is no
 * on-disk cache to migrate or leak.
 */
export class SessionCache {
  readonly #capacity: number
  readonly #entries = new Map<string, CacheEntry>()

  constructor(capacity = 64) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('observability: cache capacity must be a positive integer')
    }
    this.#capacity = capacity
  }

  /** Cached records for an unchanged session, or undefined when stale/absent. */
  get(sessionId: string, stamp: string): readonly TraceRecord[] | undefined {
    const entry = this.#entries.get(sessionId)
    if (entry === undefined || entry.stamp !== stamp) return undefined
    this.#entries.delete(sessionId)
    this.#entries.set(sessionId, entry)
    return entry.records
  }

  /** Replace one session's records and evict the least recently used entry. */
  set(sessionId: string, stamp: string, records: readonly TraceRecord[]): void {
    this.#entries.delete(sessionId)
    this.#entries.set(sessionId, { stamp, records })
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next()
      if (oldest.done === true) return
      this.#entries.delete(oldest.value)
    }
  }

  /** Number of cached sessions. */
  get size(): number {
    return this.#entries.size
  }
}
