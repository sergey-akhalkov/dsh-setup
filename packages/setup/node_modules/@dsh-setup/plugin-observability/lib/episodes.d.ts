import type { SessionMeta, TokenUsage, TraceRecord } from './records.js';
/**
 * Task episodes. An episode starts at a human message and ends before the next
 * one, at session end, or after the configured idle gap. Machine messages and
 * tool activity stay inside it; nothing here reads message text.
 */
/** The terminal classification of one episode. */
export type EpisodeOutcome = 'completed' | 'failed' | 'cut' | 'blocked' | 'other' | 'open';
/** Every outcome word, in report order. */
export declare const EPISODE_OUTCOMES: readonly EpisodeOutcome[];
/** The idle gap default: no event for this long ends the episode. */
export declare const DEFAULT_IDLE_GAP_MINUTES = 30;
/** One session's owned records and its header metadata. */
export interface SessionInput {
    readonly id: string;
    readonly records: readonly TraceRecord[];
    readonly meta: SessionMeta;
}
/** An active work interval, clipped to its episode. */
export interface EpisodeInterval {
    readonly from: number;
    readonly to: number;
}
/** What the episode's own goal changes say. */
export interface EpisodeGoals {
    readonly created: number;
    readonly paused: number;
    readonly resumed: number;
    readonly completed: number;
    /** The highest cumulative `roundsStarted` the episode recorded. */
    readonly rounds: number;
    readonly phase?: string;
}
/** What one episode's work checkpoints say. */
export interface EpisodeCheckpoints {
    readonly total: number;
    /** Completed checkpoints; a `continue` checkpoint is not a close. */
    readonly closes: number;
    /** Completed checkpoints that carried non-empty evidence. */
    readonly verified: number;
}
/** One child session joined to a parent episode. */
export interface EpisodeChild {
    readonly sessionId: string;
    readonly origin?: string;
    readonly delegationDepth?: number;
    readonly start: number;
    readonly end: number;
    readonly outcome: EpisodeOutcome;
    readonly verified: boolean;
    readonly usage: TokenUsage;
    readonly toolCalls: number;
    /** The child's own records, so its work is counted once in the parent episode. */
    readonly records: readonly TraceRecord[];
}
/** One derived episode. */
export interface Episode {
    /** `sessionId#index`, index following start time. */
    readonly id: string;
    readonly sessionId: string;
    readonly index: number;
    readonly start: number;
    /** The last included record's time. */
    readonly end: number;
    /** The episode's own records, in time order. */
    readonly records: readonly TraceRecord[];
    /** Child sessions joined to this episode; their work is counted here once. */
    readonly children: readonly EpisodeChild[];
    readonly humanMessages: number;
    readonly machineMessages: number;
    readonly turns: number;
    readonly steps: number;
    readonly toolCalls: number;
    readonly commands: number;
    readonly outcome: EpisodeOutcome;
    readonly verified: boolean;
    readonly checkpoints: EpisodeCheckpoints;
    readonly goals: EpisodeGoals;
    /** The episode's own usage plus every joined child's usage. */
    readonly usage: TokenUsage;
    /** Unioned step and tool intervals of the episode and its children, clipped. */
    readonly intervals: readonly EpisodeInterval[];
    readonly activeMs: number;
    /** Turn failures plus tool failures no completed turn closer recovered. */
    readonly failures: number;
}
/** One session whose parent chain does not reach the read corpus. */
export interface UnlinkedChild {
    readonly sessionId: string;
    readonly parentSession: string;
}
/** The episodes of every root session plus the children that could not be joined. */
export interface EpisodeIndex {
    readonly episodes: readonly Episode[];
    readonly unlinked: readonly UnlinkedChild[];
}
/** The empty usage a message without a usage record contributes. */
export declare const NO_USAGE: TokenUsage;
/** Every terminal kind the outcome map defines. */
export declare const KNOWN_TERMINALS: ReadonlySet<string>;
/** Whether a record is a human message; the only thing that starts an episode. */
export declare function isHumanMessage(record: TraceRecord): boolean;
/** Add one record's usage, if it recorded any. */
export declare function addUsage(total: TokenUsage, usage: TokenUsage | undefined): TokenUsage;
/** The usage of a record list, in one pass. */
export declare function usageOf(records: readonly TraceRecord[]): TokenUsage;
/**
 * Classify an episode from its recorded turn ends and failures. An unrecovered
 * failure outranks the closer; a started turn with no end is open even when an
 * earlier turn closed.
 */
export declare function outcomeOf(records: readonly TraceRecord[]): {
    readonly outcome: EpisodeOutcome;
    readonly failures: number;
};
/** The final terminal kind when the last turn ended, whatever the map says. */
export declare function finalTerminalOf(records: readonly TraceRecord[]): string | undefined;
/** The final terminal kind when the map does not define it. */
export declare function unmappedTerminalOf(records: readonly TraceRecord[]): string | undefined;
/** Whether a completed checkpoint carried non-empty evidence. */
export declare function checkpointEvidence(records: readonly TraceRecord[]): EpisodeCheckpoints;
/** The episode's goal operations, phase, and cumulative rounds. */
export declare function goalsOf(records: readonly TraceRecord[]): EpisodeGoals;
/**
 * The raw step and tool intervals of a record list, before clipping. Pairing
 * happens over the complete session so an interval that crosses a human message
 * still contributes the part inside the later episode.
 */
export declare function laneIntervals(records: readonly TraceRecord[]): {
    readonly steps: readonly EpisodeInterval[];
    readonly tools: readonly EpisodeInterval[];
};
/** Both lane interval lists of a record list, before clipping. */
export declare function intervalPairs(records: readonly TraceRecord[]): EpisodeInterval[];
/** Clip raw intervals to `[start, end]` and merge the overlaps. */
export declare function clipIntervals(raw: readonly EpisodeInterval[], start: number, end: number): EpisodeInterval[];
/**
 * The union of step and tool intervals, clipped to `[start, end]`. A tool call
 * inside a step overlaps it and counts once; a command is neither, so it adds
 * no active time.
 */
export declare function activeIntervals(records: readonly TraceRecord[], start: number, end: number): EpisodeInterval[];
/** The total length of unioned intervals. */
export declare function intervalLength(intervals: readonly EpisodeInterval[]): number;
/**
 * Derive one session's episodes. Events before its first human message are
 * preamble; activity after an idle gap ends an episode and stays outside every
 * episode until the next human message starts one.
 */
export declare function deriveEpisodes(session: SessionInput, idleGapMs: number): Episode[];
/**
 * Derive the episodes of every root session and join each descendant session to
 * the root episode its time overlaps most. A child never becomes a top-level
 * episode; a child whose parent chain leaves the read corpus, or whose time
 * overlaps no root episode, is reported as unlinked rather than dropped.
 */
export declare function buildEpisodes(sessions: readonly SessionInput[], idleGapMs?: number): EpisodeIndex;
