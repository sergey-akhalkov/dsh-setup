import type { Range } from './aggregate.js';
/**
 * Declarative hypotheses. A hypothesis is inert configuration: a metric id, a
 * direction, a threshold, a window, and an optional guardrail. Nothing here is
 * executed, and no result ever claims causation.
 */
/** The fixed metric catalog a hypothesis may name. */
export type HypothesisMetric = 'verified-completion-rate' | 'tokens-per-episode' | 'context-tokens-per-step' | 'active-minutes-per-episode' | 'steps-per-human-message' | 'human-messages-per-completed-goal' | 'delegate-rate' | 'checkpoint-coverage' | 'failure-rate';
/** Every accepted metric id, in catalog order. */
export declare const HYPOTHESIS_METRICS: readonly HypothesisMetric[];
/** The direction in which a metric is expected to improve. */
export type HypothesisDirection = 'increase' | 'decrease';
/** The preferred direction of every catalog metric, used by guardrails. */
export declare const METRIC_DIRECTION: Readonly<Record<HypothesisMetric, HypothesisDirection>>;
/** One configured hypothesis. */
export interface Hypothesis {
    /** Rendered as data; never executed. */
    readonly description?: string;
    readonly metric: HypothesisMetric;
    readonly direction: HypothesisDirection;
    /** Non-negative movement the metric must show to count as a change. */
    readonly threshold: number;
    /** The window the hypothesis is stated over. */
    readonly window: Range;
    readonly minSamples: number;
    readonly guardrail?: HypothesisMetric;
}
/** Samples a hypothesis needs before it can support or refute anything. */
export declare const DEFAULT_MIN_SAMPLES = 20;
/** A configuration error that names the offending field or metric. */
export declare class HypothesisConfigError extends Error {
    constructor(message: string);
}
/** Validate the configured hypothesis list; an absent list is valid. */
export declare function parseHypotheses(raw: unknown): Hypothesis[];
/** The metric values a hypothesis is evaluated against. */
export interface MetricValues {
    /** Episodes in the observed window. */
    readonly samples: number;
    readonly verifiedCompletionRate?: number;
    readonly tokensPerEpisode?: number;
    readonly contextTokensPerStep?: number;
    readonly activeMinutesPerEpisode?: number;
    readonly stepsPerHumanMessage?: number;
    readonly humanMessagesPerCompletedGoal?: number;
    readonly delegateRate?: number;
    readonly checkpointCoverage?: number;
    readonly failureRate?: number;
}
/** One metric's value, or undefined when the window holds no data for it. */
export declare function metricValue(values: MetricValues, metric: HypothesisMetric): number | undefined;
/** How one hypothesis came out; never a claim of causation. */
export type HypothesisStatus = 'collecting' | 'supported' | 'refuted' | 'inconclusive';
/** The guardrail's observation beside a hypothesis result. */
export interface GuardrailResult {
    readonly metric: HypothesisMetric;
    readonly baseline?: number;
    readonly current?: number;
    readonly regressed: boolean;
}
/** One evaluated hypothesis. */
export interface HypothesisResult {
    readonly index: number;
    readonly description?: string;
    readonly metric: HypothesisMetric;
    readonly direction: HypothesisDirection;
    readonly threshold: number;
    readonly window: Range;
    readonly minSamples: number;
    readonly samples: number;
    readonly baseline?: number;
    readonly current?: number;
    readonly guardrail?: GuardrailResult;
    readonly status: HypothesisStatus;
    /** The one sentence the view renders. */
    readonly label: string;
    readonly observed: 'association, not proof';
}
/**
 * Evaluate every hypothesis over the observed window. Supported needs the
 * sample minimum, the threshold in the expected direction, and no guardrail
 * regression; refuted needs movement opposite the threshold; nothing else is
 * claimed.
 */
export declare function evaluateHypotheses(hypotheses: readonly Hypothesis[], current: MetricValues, baseline?: MetricValues): HypothesisResult[];
