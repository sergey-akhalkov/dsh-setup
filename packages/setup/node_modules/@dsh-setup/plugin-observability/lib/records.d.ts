import type { SessionEvent } from '@deepseek-ai/dsh-session';
/**
 * Token usage recorded on one assistant message. A record without it carries
 * no usage at all, which lowers the reported coverage instead of guessing.
 */
export interface TokenUsage {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
}
/** The session-level header facts the report needs; no message text is read. */
export interface SessionMeta {
    readonly id: string;
    /** The session this one was started from, when recorded. */
    readonly parentSession?: string;
    /** Coarse product classification of a child session. */
    readonly origin?: string;
    /** Delegation depth; absent means top level. */
    readonly delegationDepth?: number;
    /** The workspace the session ran in; relative plan and remedy paths resolve here. */
    readonly cwd?: string;
}
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
    /** Only the argument fields a configured predicate reads; raw arguments never survive. */
    readonly argumentValues?: Readonly<Record<string, string>>;
    readonly failed?: true;
    /** Tool call identity, shared by a call and its result. */
    readonly callId?: string;
    /** A failed tool result's recorded error name. */
    readonly errorName?: string;
    /** A failed result's code, or the turn failure's stable `LlmFailure.code`. */
    readonly errorCode?: string;
    /**
     * A delegate result's classification, kept as a boolean: false means the
     * result reports reuse or a pending/queued run, so it is not a worker start.
     */
    readonly delegateStarted?: boolean;
    /** `turn/end` reason kind, so a cut is distinguishable from a failure. */
    readonly turnEnd?: string;
    /** Assistant message usage; absent when the event recorded none. */
    readonly usage?: TokenUsage;
    /** `goal/change` operation; the objective text is never kept. */
    readonly goalOperation?: string;
    /** The goal's opaque id, so its lifecycle can be followed without its objective. */
    readonly goalId?: string;
    /** The goal's phase after the change. */
    readonly goalPhase?: string;
    /** Rounds the goal supervisor started. */
    readonly goalRounds?: number;
    /** `work_checkpoint` outcome word; the lists and plan text are dropped. */
    readonly checkpointOutcome?: string;
    /** Length of the checkpoint's verified list, never its text. */
    readonly checkpointVerifiedCount?: number;
    /** Lanes the checkpoint plan declared; the lane text is dropped. */
    readonly checkpointLaneCount?: number;
    /** Lanes the plan left `blocked`; the lane text is dropped. */
    readonly checkpointBlockedLaneCount?: number;
    /** Whether the plan computes parallel work; the declaration flag is gone. */
    readonly checkpointParallelComputed?: boolean;
    /** The bottleneck remedy the checkpoint declared, never its owner or targets. */
    readonly checkpointBottleneckAction?: string;
    /** Consecutive same-session checkpoints with this bottleneck owner and blocking set. */
    readonly checkpointBottleneckAge?: number;
    /** Whether the declared remedy was matched before the next checkpoint or turn end. */
    readonly checkpointRemedyResolved?: boolean;
    /** Completion time of the matched remedy evidence; absent when nothing matched. */
    readonly checkpointRemedyResolvedAt?: number;
}
/**
 * The tools that start a worker. The plugin gate additionally requires the
 * checkpoint id in the arguments; this metric does not, so it stays metadata.
 */
export declare const WORKER_START_TOOLS: ReadonlySet<string>;
/** The argument fields the configured predicates read, per tool. */
export type ArgumentFieldMap = ReadonlyMap<string, ReadonlySet<string>>;
/**
 * Extract the aggregation records a session owns.
 *
 * `start` is the session's durable inheritance boundary: a fork seed copies a
 * parent prefix and owns only what follows it. `fields` names the argument
 * fields a configured predicate reads; anything else in the arguments is dropped.
 */
export declare function extractRecords(sessionId: string, events: readonly SessionEvent[], start?: number, fields?: ArgumentFieldMap, cwd?: string): TraceRecord[];
