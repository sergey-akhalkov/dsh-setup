import type { SessionEvent } from '@deepseek-ai/dsh-session';
/**
 * One neutral fact extracted from a session event. Aggregation works on these,
 * never on raw events, so assistant streams and message text never enter a
 * bucket or a report.
 */
export interface TraceRecord {
    readonly sessionId: string;
    readonly seq: number;
    readonly time: number;
    readonly eventType: string;
    readonly turn?: number;
    readonly step?: number;
    readonly tool?: string;
    readonly sourceKind?: string;
    readonly abortPrefix?: string;
    readonly command?: string;
    /** Raw tool-call argument JSON, kept unparsed until a predicate needs a field. */
    readonly arguments?: string;
    readonly failed?: true;
}
/**
 * Extract the aggregation records a session owns.
 *
 * `start` is the session's durable inheritance boundary: a fork seed copies a
 * parent prefix and owns only what follows it.
 */
export declare function extractRecords(sessionId: string, events: readonly SessionEvent[], start?: number): TraceRecord[];
