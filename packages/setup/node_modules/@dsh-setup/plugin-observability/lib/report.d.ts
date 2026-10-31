import type { AggregateTotals, Range } from './aggregate.js';
import type { RowGroup } from './builtins.js';
import type { EpisodeCheckpoints, EpisodeGoals, EpisodeInterval, EpisodeOutcome } from './episodes.js';
import type { Finding } from './findings.js';
import type { Hypothesis, HypothesisResult, MetricValues } from './hypotheses.js';
import type { AutonomySummary, CostSummary, DataQuality, QualitySummary, SpeedSummary, SubagentSummary, Window } from './metrics.js';
import type { SessionMeta, TokenUsage, TraceRecord } from './records.js';
import type { Row } from './rows.js';
import { type Scorecard } from './scorecards.js';
import { type Readiness, type ReadinessSources, type RowStatus } from './status.js';
/** The client renders these beside the report; re-exported so one module is enough. */
export type { Finding } from './findings.js';
export type { HypothesisResult } from './hypotheses.js';
export type { Scorecard } from './scorecards.js';
/** Metadata for one drill-down entry; never message text or tool arguments. */
export interface DetailRow {
    readonly time: number;
    readonly turn?: number;
    readonly signalId: string;
    readonly tool?: string;
    readonly failed?: true;
}
/** The failure classes the log itself records. */
export type FailureSeverity = 'turn failure' | 'turn cut' | 'tool failure';
/** One failure in the window, independent of the configured rows. */
export interface FailureEntry {
    readonly seq: number;
    readonly time: number;
    readonly sessionId: string;
    /** Session title when the Host could resolve one; the view falls back to a short id. */
    readonly sessionTitle?: string;
    readonly severity: FailureSeverity;
    /** A tool failure whose turn ended `completed` did not end the work. */
    readonly recovered: boolean;
    readonly turn?: number;
    readonly step?: number;
    readonly tool?: string;
    readonly callId?: string;
    readonly errorName?: string;
    readonly errorCode?: string;
}
/** Uncapped failure counts; the rendered list itself is bounded. */
export interface FailureTotals {
    readonly total: number;
    readonly turnFailures: number;
    readonly turnCuts: number;
    readonly toolFailures: number;
    readonly recovered: number;
}
/** One tool's in-window call population and how many of those calls failed. */
export interface ToolOutcome {
    readonly tool: string;
    readonly calls: number;
    readonly failed: number;
}
/** One rendered row of the report. */
export interface ReportRow {
    readonly id: string;
    readonly label: string;
    readonly kind: Row['kind'];
    /** How the dashboard files this row: totals, tools, plugins, and so on. */
    readonly group: RowGroup;
    readonly status?: RowStatus;
    /** A guidance row's declared contribution checked against the live registries. */
    readonly readiness?: Readiness;
    readonly note: string;
    /** What a silent row waits for, when the configuration declares it. */
    readonly trigger?: string;
    /** The declared business goal, shown beside the row detail. */
    readonly goal?: string;
    /** Whether the row declares an eligible population. */
    readonly eligibilityDeclared: boolean;
    readonly traces: number;
    readonly errors: number;
    /** Failed traces whose turn did not recover them; silence never counts here. */
    readonly unrecoveredErrors: number;
    /** Matched traces per bucket, for the row's sparkline. */
    readonly counts: readonly number[];
    readonly tools: readonly string[];
    /** Newest matched trace in the window, if any. */
    readonly lastActivity?: number;
    /** Newest failure the row owns, so an error card can name it. */
    readonly lastFailure?: {
        readonly time: number;
        readonly tool?: string;
        readonly errorName?: string;
        readonly errorCode?: string;
    };
    readonly details: readonly DetailRow[];
}
/** One child session as the episode detail shows it. */
export interface EpisodeChildReport {
    readonly sessionId: string;
    readonly sessionTitle?: string;
    readonly origin?: string;
    readonly delegationDepth?: number;
    readonly outcome: EpisodeOutcome;
    readonly verified: boolean;
    readonly usage: TokenUsage;
    readonly toolCalls: number;
}
/** The per-episode lanes the Tasks detail renders. */
export interface EpisodeTimeline {
    readonly from: number;
    readonly to: number;
    readonly steps: readonly EpisodeInterval[];
    readonly tools: readonly EpisodeInterval[];
    readonly human: readonly number[];
    readonly errors: readonly number[];
    /** Recorded step starts, including a step whose end is missing. */
    readonly stepsCount: number;
    /** Recorded tool calls, including a call whose result is missing. */
    readonly callsCount: number;
}
/** One episode as the Tasks table and its detail render it. */
export interface EpisodeReport {
    readonly id: string;
    readonly sessionId: string;
    readonly sessionTitle?: string;
    readonly start: number;
    readonly end: number;
    readonly durationMs: number;
    readonly steps: number;
    readonly toolCalls: number;
    readonly turns: number;
    readonly commands: number;
    readonly humanMessages: number;
    readonly machineMessages: number;
    readonly outcome: EpisodeOutcome;
    readonly verified: boolean;
    readonly failures: number;
    readonly substantive: boolean;
    /** Active time inside the window. */
    readonly activeMs: number;
    /** Active time of the whole episode. */
    readonly activeMsFull: number;
    /** Usage measured through the window cutoff. */
    readonly usage: TokenUsage;
    /** Usage of the whole episode. */
    readonly fullUsage: TokenUsage;
    /** Usage from the episode's start through the window cutoff, including its prefixed work. */
    readonly throughCutoffUsage: TokenUsage;
    readonly costBasis: 'through cutoff' | 'full episode';
    readonly goals: EpisodeGoals;
    readonly checkpoints: EpisodeCheckpoints;
    readonly delegateCalls: number;
    readonly parallelWidth: number;
    readonly parentWaitMs: number;
    readonly children: readonly EpisodeChildReport[];
    /** Configured signal row ids that fired inside this episode; the Tasks filter reads it. */
    readonly firedRows: readonly string[];
    /** The episode's own lanes, for the detail timeline. */
    readonly timeline: EpisodeTimeline;
}
/** One turn of a session timeline. */
export interface TimelineTurn {
    readonly turn: number;
    readonly start: number;
    readonly end: number;
    readonly durationMs: number;
    readonly steps: readonly EpisodeInterval[];
    readonly tools: readonly EpisodeInterval[];
    readonly human: readonly number[];
    readonly errors: readonly number[];
    readonly stepsCount: number;
    readonly callsCount: number;
    readonly errorCount: number;
}
/** The session range's time-based timeline. */
export interface SessionTimelineData {
    readonly from: number;
    readonly to: number;
    readonly turns: readonly TimelineTurn[];
}
/** The previous window, or the previous completed session, the report compares against. */
export interface BaselineComparison {
    readonly kind: 'previous equal window' | 'previous completed session';
    readonly from: number;
    readonly to: number;
    readonly episodes: number;
    readonly quality: QualitySummary;
    readonly cost: CostSummary;
    readonly speed: SpeedSummary;
    readonly autonomy: AutonomySummary;
    readonly subagents: SubagentSummary;
    /** The metric values a hypothesis compares against. */
    readonly metrics: MetricValues;
}
/** What the view must state it cannot observe, not hide. */
export declare const BLIND_SPOTS: readonly string[];
/** How many drill-down entries one row keeps; the dashboard shows five. */
export declare const DETAIL_LIMIT = 25;
/** How many failure entries the report carries; the counts are uncapped. */
export declare const FAILURE_LIMIT = 200;
/** How many episodes the report carries; the counts remain uncapped. */
export declare const EPISODE_LIMIT = 200;
/** The metric values a window's records produce; used for a hypothesis's own window. */
export declare function metricValuesFor(options: {
    readonly records: readonly TraceRecord[];
    readonly sessions?: readonly SessionMeta[];
    readonly idleGapMinutes: number;
    readonly window: Window;
}): MetricValues;
/** Everything the view renders for one range. */
export interface Report {
    readonly range: Range;
    readonly from: number;
    readonly to: number;
    readonly bucketLabels: readonly string[];
    /** Whole-window counts, computed from the records once. */
    readonly totals: AggregateTotals;
    /** Window usage attributed by event time. */
    readonly windowCost: TokenUsage;
    /** All records per bucket, for the range series. */
    readonly activity: readonly number[];
    /** Failed records per bucket, a subset of `activity`. */
    readonly errorSeries: readonly number[];
    /** Newest failures first; bounded to {@link FAILURE_LIMIT} entries. */
    readonly failures: readonly FailureEntry[];
    readonly failureTotals: FailureTotals;
    /** In-window tool calls and the failing share of each, joined by call identity. */
    readonly toolOutcomes: readonly ToolOutcome[];
    readonly rows: readonly ReportRow[];
    /** Newest first, capped at {@link EPISODE_LIMIT}; the counts stay uncapped. */
    readonly episodes: readonly EpisodeReport[];
    readonly episodeCount: number;
    /** Episodes whose start lies in the window; the cohort outcomes select by start. */
    readonly cohortCount: number;
    readonly quality: QualitySummary;
    readonly cost: CostSummary;
    readonly speed: SpeedSummary;
    readonly autonomy: AutonomySummary;
    readonly subagents: SubagentSummary;
    readonly dataQuality: DataQuality;
    readonly scorecards: readonly Scorecard[];
    readonly hypotheses: readonly HypothesisResult[];
    /** Attention findings derived from the metadata; empty when nothing is wrong. */
    readonly findings: readonly Finding[];
    /** Uncapped active time of the window, attributed by event time. */
    readonly windowActiveMs: number;
    readonly baseline?: BaselineComparison;
    /** Only the session range, whose buckets are time rather than turns. */
    readonly timeline?: SessionTimelineData;
    readonly blindSpots: readonly string[];
    readonly cutoffLabel: 'through cutoff' | 'full episode';
    /** The configured minimum episodes per comparison side. */
    readonly minEpisodes: number;
}
/**
 * Assemble the report for one range from the sessions' neutral records.
 * Built-in rows come first, configured rows after; nothing is persisted.
 */
export declare function buildReport(options: {
    readonly range: Range;
    readonly now: number;
    readonly records: readonly TraceRecord[];
    readonly configured: readonly Row[];
    readonly registry: ReadonlySet<string>;
    readonly readiness?: ReadinessSources;
    /** Session header metadata from the reader, used to join child sessions. */
    readonly sessions?: readonly SessionMeta[];
    /** Episode boundaries, comparison minimum, and hypotheses. */
    readonly config?: {
        readonly idleGapMinutes: number;
        readonly minEpisodes: number;
        readonly hypotheses: readonly Hypothesis[];
    };
    /** The previous window or session, when the reader resolved one. */
    readonly baseline?: {
        readonly kind: BaselineComparison['kind'];
        readonly records: readonly TraceRecord[];
        readonly sessions?: readonly SessionMeta[];
        readonly from: number;
        readonly to: number;
    };
    /** Session titles by id; applied to failures and episodes. */
    readonly titles?: ReadonlyMap<string, string>;
    /**
     * Metric values per hypothesis window, when the caller resolved windows other
     * than the requested range. Without it a hypothesis falls back to the report's
     * own window values.
     */
    readonly hypothesisValues?: ReadonlyMap<Range, {
        current: MetricValues;
        baseline?: MetricValues;
    }>;
}): Report;
/** Name the sessions of failures, episodes, and children; an absent title falls back to the id. */
export declare function attachSessionTitles(report: Report, titles: ReadonlyMap<string, string>): Report;
