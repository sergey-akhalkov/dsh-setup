import type { Range } from './aggregate.js';
import type { Episode, EpisodeCheckpoints, EpisodeGoals, EpisodeOutcome } from './episodes.js';
import type { TokenUsage, TraceRecord } from './records.js';
/**
 * Episode metrics: usage, outcomes, active time, goals and autonomy, subagent
 * work, and the coverage behind each number. Everything is computed over the
 * observed window by event time; nothing here reads message text.
 */
/** An observed window; `to` is exclusive. */
export interface Window {
    readonly from: number;
    readonly to: number;
}
/** The whole corpus, used by the session range which has no cutoff. */
export declare const FULL_WINDOW: Window;
/** The cutoff the session range reports. */
export declare const NO_CUTOFF: number;
/** A p50/p90 pair with its sample size. */
export interface Distribution {
    readonly p50: number;
    readonly p90: number;
    readonly n: number;
}
/** The nearest-rank percentile of a value list; empty list reads zero. */
export declare function percentile(values: readonly number[], fraction: number): number;
/** A p50/p90 distribution of a value list. */
export declare function distribution(values: readonly number[]): Distribution;
/** Sum the usage of the records inside a window. */
export declare function windowUsage(records: readonly TraceRecord[], window: Window): TokenUsage;
/** How much of a window's usage the log actually recorded. */
export interface UsageCoverage {
    /** Distinct steps that started inside the window. */
    readonly steps: number;
    /** Distinct steps carrying an assistant message with usage. */
    readonly stepsWithUsage: number;
    /** Assistant messages inside the window. */
    readonly messages: number;
    /** Assistant messages inside the window that recorded usage. */
    readonly messagesWithUsage: number;
    /** `stepsWithUsage / steps`; one when no step started. */
    readonly stepCoverage: number;
    /** `messagesWithUsage / messages`; one when no message was recorded. */
    readonly messageCoverage: number;
    /** The lower of step and message coverage; zero when the window holds neither. */
    readonly coverage: number;
}
/** Count the steps and messages that recorded usage. */
export declare function usageCoverage(records: readonly TraceRecord[], window: Window): UsageCoverage;
/** One child session's work inside the observed window. */
export interface EpisodeChildWork {
    readonly sessionId: string;
    readonly start: number;
    readonly end: number;
    readonly outcome: EpisodeOutcome;
    readonly verified: boolean;
    readonly usage: TokenUsage;
    readonly toolCalls: number;
}
/** One episode's work inside the observed window. */
export interface EpisodeWork {
    readonly episode: Episode;
    /** Usage recorded inside the window. */
    readonly usage: TokenUsage;
    /** Usage of the whole episode, including work outside the window. */
    readonly fullUsage: TokenUsage;
    readonly ownRecords: readonly TraceRecord[];
    readonly childRecords: readonly TraceRecord[];
    readonly childUsage: TokenUsage;
    /** Joined children with work inside the window, already clipped and classified at the cutoff. */
    readonly children: readonly EpisodeChildWork[];
    readonly steps: number;
    readonly toolCalls: number;
    readonly activeMs: number;
    readonly outcome: EpisodeOutcome;
    readonly verified: boolean;
    readonly failures: number;
    readonly checkpoints: EpisodeCheckpoints;
    readonly goals: EpisodeGoals;
    /** The final terminal kind observed at the cutoff, when the log recorded one. */
    readonly terminal?: string;
    /** The observation cutoff (`Infinity` for the session range). */
    readonly cutoff: number;
    /** At least four tool calls and one successful edit or write inside the window. */
    readonly substantive: boolean;
    readonly costBasis: 'through cutoff';
}
/** Clip one episode to the observed window. */
export declare function episodeWork(episode: Episode, window: Window): EpisodeWork;
/** Whether an episode started inside a window; cohorts select by start. */
export declare function startsIn(episode: Episode, window: Window): boolean;
/** Whether an episode has any work or span inside a window. */
export declare function overlapsWindow(episode: Episode, window: Window): boolean;
/** Cost, context load, and usage coverage of the window and its episodes. */
export interface CostSummary {
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly total: number;
    /** Input plus cache read: what the model had to hold for the step. */
    readonly contextLoad: number;
    readonly contextPerStep: number;
    /** Cache read as a share of input plus cache read; absent when both are zero. */
    readonly cacheHitRatio?: number;
    readonly steps: number;
    readonly stepsWithUsage: number;
    readonly usageCoverage: number;
    readonly messages: number;
    readonly messagesWithUsage: number;
    /** `null` for the session range, which observes the whole session. */
    readonly cutoff: number | null;
    readonly cutoffLabel: 'through cutoff' | 'full episode';
    readonly tokensPerEpisode: Distribution;
    readonly fullTokensPerEpisode: Distribution;
}
/** Cost and usage of one window's event-time totals and its cohort episodes. */
export declare function costSummary(work: readonly EpisodeWork[], usage: TokenUsage, coverage: UsageCoverage, cutoff: number): CostSummary;
/** Outcome shares of the cohort, with verified and unverified closes. */
export interface QualitySummary {
    readonly episodes: number;
    readonly completed: number;
    readonly verified: number;
    readonly failed: number;
    readonly cut: number;
    readonly blocked: number;
    readonly other: number;
    readonly open: number;
    /** Verified completions over completed episodes; absent when none completed. */
    readonly verifiedShare?: number;
    /** Failed episodes over the cohort; absent when the cohort is empty. */
    readonly failureRate?: number;
    /** Episodes with at least four tool calls and a successful edit or write. */
    readonly substantive: number;
    /** Substantive episodes with a completed checkpoint over all substantive ones. */
    readonly checkpointCoverage?: number;
    /** Completed episodes without a completed checkpoint. */
    readonly unverified: number;
    /** Steps per completed episode; a percentile of the quality of the closes. */
    readonly stepsToCompletion: Distribution;
}
/** Classify a cohort's outcomes. */
export declare function qualitySummary(work: readonly EpisodeWork[]): QualitySummary;
/** Active-time distributions; wall-clock span is never used. */
export interface SpeedSummary {
    readonly n: number;
    readonly activeMinutes: Distribution;
    readonly completedActiveMinutes?: Distribution;
}
/** Active minutes per cohort episode, and per completed episode. */
export declare function speedSummary(work: readonly EpisodeWork[]): SpeedSummary;
/** Steps and machine injections per human message, and goal completion. */
export interface AutonomySummary {
    readonly episodes: number;
    readonly sessions: number;
    readonly episodesPerSession?: number;
    readonly humanMessages: number;
    readonly machineMessages: number;
    readonly stepsPerHumanMessage: Distribution;
    readonly machineMessagesPerHumanMessage: Distribution;
    readonly goals: number;
    readonly completedGoals: number;
    /** Completed goals over touched goals; absent when no goal was recorded. */
    readonly goalCompletionRate?: number;
    readonly rounds: number;
    /** Human messages per completed goal; absent when no goal completed. */
    readonly humanMessagesPerCompletedGoal?: number;
}
/**
 * Autonomy over the window. `work` supplies the window's messages and goal
 * lifecycles (including an episode spanning the boundary); `counted` is the
 * start-selected cohort the episode and session counts come from; `goalStreams`
 * replays the session's complete goal stream, including events in an idle gap.
 */
export declare function autonomySummary(work: readonly EpisodeWork[], counted?: readonly EpisodeWork[], goalStreams?: ReadonlyMap<string, readonly TraceRecord[]>, window?: Window): AutonomySummary;
/** The widest number of spans active at one instant; a zero-length span is one instant. */
export declare function parallelWidth(spans: readonly {
    readonly start: number;
    readonly end: number;
}[]): number;
/** Delegate calls, child work, wait time, and child outcomes. */
export interface SubagentSummary {
    readonly episodes: number;
    readonly episodesWithChild: number;
    /** Episodes with a child over the cohort; absent when the cohort is empty. */
    readonly delegateRate?: number;
    readonly delegateCalls: number;
    readonly parallelWidth: number;
    /** Milliseconds the parent waited on a delegate call, per episode that waited. */
    readonly parentWaitMs: Distribution;
    readonly childTokens: number;
    readonly childFailures: number;
    readonly linkedChildren: number;
    readonly unlinkedChildren: number;
}
/** Join delegate calls and child outcomes to their episodes. */
export declare function subagentSummary(work: readonly EpisodeWork[], unlinkedChildren: number): SubagentSummary;
/** The coverage behind every metric, stated rather than hidden. */
export interface DataQuality {
    readonly steps: number;
    readonly stepsWithUsage: number;
    readonly messages: number;
    readonly messagesWithUsage: number;
    readonly usageCoverage: number;
    readonly stepCoverage: number;
    readonly messageCoverage: number;
    readonly episodes: number;
    readonly linkedChildren: number;
    readonly unlinkedChildren: number;
    readonly goalEvents: number;
    readonly checkpoints: number;
    /** Episodes whose final terminal kind the outcome map does not define. */
    readonly unmappedClosers: number;
    /** Episodes entering the treated-and-control comparison. */
    readonly comparisonSample: number;
}
/** The data-quality line for a window. */
export declare function dataQuality(work: readonly EpisodeWork[], coverage: UsageCoverage, unlinkedChildren: number, comparisonSample?: number): DataQuality;
/** One outcome word per accepted outcome, in report order. */
export declare const OUTCOME_ORDER: readonly EpisodeOutcome[];
/** Whether a range observes a cutoff or the whole session. */
export declare function cutoffOf(range: Range, window: Window): number;
