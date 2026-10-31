import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionEventRecord, SessionLogSnapshot, SessionRecord } from '@deepseek-ai/dsh-session-query';
import { type Range } from './aggregate.js';
import type { SessionCache } from './cache.js';
import { type ArgumentFieldMap, type TraceRecord } from './records.js';
/** The narrow part of `ctx.sessionQuery` the reader drives; tests fake it. */
export interface SessionQueryService {
    listSessions(signal?: AbortSignal): Promise<SessionRecord[]>;
    readSession(sessionId: SessionId): Promise<SessionLogSnapshot>;
    listEvents(sessionId: SessionId): Promise<SessionEventRecord[]>;
    /** Optional batch title lookup; a fake without it still reports failures. */
    readTitleSnapshots?(sessionIds: readonly SessionId[]): Promise<readonly TitleObservation[]>;
}
/** The part of one title observation the failure list uses. */
export interface TitleObservation {
    readonly sessionId: SessionId;
    readonly status: 'fulfilled' | 'rejected';
    readonly value?: {
        readonly title?: {
            readonly title?: string;
        };
    };
}
/** Resolve titles for the unique failure sessions; every failure mode drops a title only. */
export declare function readSessionTitles(query: SessionQueryService, sessionIds: readonly SessionId[]): Promise<Map<string, string>>;
/** How many sessions the reader opens at once. */
export declare const READ_CONCURRENCY = 4;
export interface ReadSessionsOptions {
    readonly query: SessionQueryService;
    readonly range: Range;
    readonly now: number;
    /** Open session; scopes `session` ranges and the workspace of wider ranges. */
    readonly sessionId?: SessionId | undefined;
    readonly concurrency?: number;
    readonly cache?: SessionCache;
    /** Argument fields the configured predicates read; nothing else is kept. */
    readonly argumentFields?: ArgumentFieldMap;
}
/**
 * Read every session a range covers and return the neutral records it owns.
 *
 * A `session` range reads only the open session, because its buckets are that
 * session's turns. Wider ranges read every session in the same workspace whose
 * events fall in the window, subagent children included. A fork seed's copied
 * prefix is skipped at `inheritedEventCount`, so a parent's events count once.
 */
export declare function readSessions(options: ReadSessionsOptions): Promise<TraceRecord[]>;
