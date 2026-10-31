import type { SessionMeta, TraceRecord } from './records.js';
/**
 * Least-recently-used cache of per-session extracted records, keyed by session
 * identity and a modification stamp (event count plus newest event time). It
 * holds no path and opens no file: a Host restart starts empty, so there is no
 * on-disk cache to migrate or leak.
 */
export declare class SessionCache {
    #private;
    constructor(capacity?: number);
    /** Cached records and metadata for an unchanged session, or undefined when stale/absent. */
    get(sessionId: string, stamp: string): {
        records: readonly TraceRecord[];
        meta?: SessionMeta;
    } | undefined;
    /** Replace one session's records and metadata; evict the least recently used entry. */
    set(sessionId: string, stamp: string, records: readonly TraceRecord[], meta?: SessionMeta): void;
    /** Number of cached sessions. */
    get size(): number;
}
