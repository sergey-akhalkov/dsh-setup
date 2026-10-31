import type { SessionId } from '@deepseek-ai/dsh-session';
import type { SessionEventRecord, SessionLogSnapshot, SessionRecord } from '@deepseek-ai/dsh-session-query';
import { type Range } from './aggregate.js';
import type { SessionCache } from './cache.js';
import { type ArgumentFieldMap, type SessionMeta, type TraceRecord } from './records.js';
/** One read's neutral records and the header metadata of the sessions they came from. */
export interface SessionReadResult {
    readonly records: readonly TraceRecord[];
    readonly sessions: readonly SessionMeta[];
}
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
    /** Explicit window override; the baseline uses the previous equal window. */
    readonly window?: {
        readonly from: number;
        readonly to: number;
    };
    /** Open session; scopes `session` ranges and the workspace of wider ranges. */
    readonly sessionId?: SessionId | undefined;
    readonly concurrency?: number;
    readonly cache?: SessionCache;
    /** Argument fields the configured predicates read; nothing else is kept. */
    readonly argumentFields?: ArgumentFieldMap;
}
/**
 * Read every session a range covers and return the neutral records it owns
 * together with the header metadata of the sessions they came from.
 *
 * A `session` range reads the open session and every descendant it started,
 * because a subagent's work belongs to that session's episodes. Wider ranges
 * read every session in the same workspace whose events fall in the window. A
 * fork seed's copied prefix is skipped at `inheritedEventCount`, so a parent's
 * events count once.
 */
export declare function readSessions(options: ReadSessionsOptions): Promise<SessionReadResult>;
/** The previous window or session a report compares against. */
export interface BaselineRead extends SessionReadResult {
    readonly kind: 'previous equal window' | 'previous completed session';
    readonly from: number;
    readonly to: number;
}
/** A baseline read starts from the current report window's first instant. */
export interface BaselineOptions extends ReadSessionsOptions {
    /** The current window's start; the previous equal window ends there. */
    readonly windowFrom: number;
    /** The current window's end, so the baseline covers the same duration. */
    readonly windowTo: number;
}
/**
 * Read the comparison corpus. Day, week, and month read the previous equal
 * window through the same session query; the session range reads the previous
 * completed session in the same workspace, or none. Nothing is written and the
 * per-session cache is reused.
 */
export declare function readBaseline(options: BaselineOptions): Promise<BaselineRead | undefined>;
