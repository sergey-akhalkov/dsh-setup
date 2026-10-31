import type { Range } from './aggregate.js'
import { RANGES } from './aggregate.js'

/**
 * Declarative hypotheses. A hypothesis is inert configuration: a metric id, a
 * direction, a threshold, a window, and an optional guardrail. Nothing here is
 * executed, and no result ever claims causation.
 */

/** The fixed metric catalog a hypothesis may name. */
export type HypothesisMetric =
  | 'verified-completion-rate'
  | 'tokens-per-episode'
  | 'context-tokens-per-step'
  | 'active-minutes-per-episode'
  | 'steps-per-human-message'
  | 'human-messages-per-completed-goal'
  | 'delegate-rate'
  | 'checkpoint-coverage'
  | 'failure-rate'

/** Every accepted metric id, in catalog order. */
export const HYPOTHESIS_METRICS: readonly HypothesisMetric[] = [
  'verified-completion-rate',
  'tokens-per-episode',
  'context-tokens-per-step',
  'active-minutes-per-episode',
  'steps-per-human-message',
  'human-messages-per-completed-goal',
  'delegate-rate',
  'checkpoint-coverage',
  'failure-rate',
]

/** The direction in which a metric is expected to improve. */
export type HypothesisDirection = 'increase' | 'decrease'

/** The preferred direction of every catalog metric, used by guardrails. */
export const METRIC_DIRECTION: Readonly<Record<HypothesisMetric, HypothesisDirection>> = {
  'verified-completion-rate': 'increase',
  'tokens-per-episode': 'decrease',
  'context-tokens-per-step': 'decrease',
  'active-minutes-per-episode': 'decrease',
  'steps-per-human-message': 'decrease',
  'human-messages-per-completed-goal': 'decrease',
  'delegate-rate': 'increase',
  'checkpoint-coverage': 'increase',
  'failure-rate': 'decrease',
}

/** One configured hypothesis. */
export interface Hypothesis {
  /** Rendered as data; never executed. */
  readonly description?: string
  readonly metric: HypothesisMetric
  readonly direction: HypothesisDirection
  /** Non-negative movement the metric must show to count as a change. */
  readonly threshold: number
  /** The window the hypothesis is stated over. */
  readonly window: Range
  readonly minSamples: number
  readonly guardrail?: HypothesisMetric
}

/** Samples a hypothesis needs before it can support or refute anything. */
export const DEFAULT_MIN_SAMPLES = 20

/** A configuration error that names the offending field or metric. */
export class HypothesisConfigError extends Error {
  constructor(message: string) {
    super(`observability config: ${message}`)
    this.name = 'HypothesisConfigError'
  }
}

const HYPOTHESIS_FIELDS: ReadonlySet<string> = new Set([
  'description',
  'metric',
  'direction',
  'threshold',
  'window',
  'minSamples',
  'minEpisodes',
  'guardrail',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMetric(value: unknown): value is HypothesisMetric {
  return typeof value === 'string' && (HYPOTHESIS_METRICS as readonly string[]).includes(value)
}

function readMetric(value: unknown, at: string): HypothesisMetric {
  if (!isMetric(value)) {
    throw new HypothesisConfigError(
      `${at} must be one of: ${HYPOTHESIS_METRICS.join(', ')}; received ${JSON.stringify(value)}`,
    )
  }
  return value
}

function readHypothesis(value: unknown, at: string): Hypothesis {
  if (!isRecord(value)) throw new HypothesisConfigError(`${at} must be a mapping`)
  for (const key of Object.keys(value)) {
    if (!HYPOTHESIS_FIELDS.has(key)) {
      throw new HypothesisConfigError(`${at}: unknown field "${key}"`)
    }
  }
  const metric = readMetric(value.metric, `${at}.metric`)
  const direction = value.direction ?? 'increase'
  if (direction !== 'increase' && direction !== 'decrease') {
    throw new HypothesisConfigError(`${at}.direction must be "increase" or "decrease"`)
  }
  const threshold = value.threshold
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
    throw new HypothesisConfigError(`${at}.threshold must be a non-negative number`)
  }
  const window = value.window ?? 'week'
  if (typeof window !== 'string' || !(RANGES as readonly string[]).includes(window)) {
    throw new HypothesisConfigError(`${at}.window must be one of: ${RANGES.join(', ')}`)
  }
  // The design calls the sample minimum `minEpisodes`; `minSamples` is the
  // shorter alias the shipped configuration uses.
  const readMinimum = (raw: unknown, field: string): number | undefined => {
    if (raw === undefined) return undefined
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) {
      throw new HypothesisConfigError(`${at}.${field} must be a positive integer`)
    }
    return raw
  }
  const samplesMinimum = readMinimum(value.minSamples, 'minSamples')
  const episodesMinimum = readMinimum(value.minEpisodes, 'minEpisodes')
  const minSamples = samplesMinimum ?? episodesMinimum ?? DEFAULT_MIN_SAMPLES
  const guardrail =
    value.guardrail === undefined ? undefined : readMetric(value.guardrail, `${at}.guardrail`)
  const description = value.description
  if (description !== undefined && (typeof description !== 'string' || description.trim() === '')) {
    throw new HypothesisConfigError(`${at}.description must be a non-empty string`)
  }
  return {
    ...(description === undefined ? {} : { description }),
    metric,
    direction,
    threshold,
    window: window as Range,
    minSamples,
    ...(guardrail === undefined ? {} : { guardrail }),
  }
}

/** Validate the configured hypothesis list; an absent list is valid. */
export function parseHypotheses(raw: unknown): Hypothesis[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) throw new HypothesisConfigError('config.hypotheses must be an array')
  return raw.map((value, index) => readHypothesis(value, `hypotheses[${index}]`))
}

/** The metric values a hypothesis is evaluated against. */
export interface MetricValues {
  /** Episodes in the observed window. */
  readonly samples: number
  readonly verifiedCompletionRate?: number
  readonly tokensPerEpisode?: number
  readonly contextTokensPerStep?: number
  readonly activeMinutesPerEpisode?: number
  readonly stepsPerHumanMessage?: number
  readonly humanMessagesPerCompletedGoal?: number
  readonly delegateRate?: number
  readonly checkpointCoverage?: number
  readonly failureRate?: number
}

/** One metric's value, or undefined when the window holds no data for it. */
export function metricValue(values: MetricValues, metric: HypothesisMetric): number | undefined {
  switch (metric) {
    case 'verified-completion-rate':
      return values.verifiedCompletionRate
    case 'tokens-per-episode':
      return values.tokensPerEpisode
    case 'context-tokens-per-step':
      return values.contextTokensPerStep
    case 'active-minutes-per-episode':
      return values.activeMinutesPerEpisode
    case 'steps-per-human-message':
      return values.stepsPerHumanMessage
    case 'human-messages-per-completed-goal':
      return values.humanMessagesPerCompletedGoal
    case 'delegate-rate':
      return values.delegateRate
    case 'checkpoint-coverage':
      return values.checkpointCoverage
    case 'failure-rate':
      return values.failureRate
  }
}

/** How one hypothesis came out; never a claim of causation. */
export type HypothesisStatus = 'collecting' | 'supported' | 'refuted' | 'inconclusive'

/** The guardrail's observation beside a hypothesis result. */
export interface GuardrailResult {
  readonly metric: HypothesisMetric
  readonly baseline?: number
  readonly current?: number
  readonly regressed: boolean
}

/** One evaluated hypothesis. */
export interface HypothesisResult {
  readonly index: number
  readonly description?: string
  readonly metric: HypothesisMetric
  readonly direction: HypothesisDirection
  readonly threshold: number
  readonly window: Range
  readonly minSamples: number
  readonly samples: number
  /** The baseline window's sample count, when a baseline exists. */
  readonly baselineSamples?: number
  readonly baseline?: number
  readonly current?: number
  readonly guardrail?: GuardrailResult
  readonly status: HypothesisStatus
  /** The one sentence the view renders. */
  readonly label: string
  readonly observed: 'association, not proof'
}

const LABELS: Readonly<Record<HypothesisStatus, string>> = {
  collecting: 'collecting: fewer samples than the minimum',
  supported: 'supported in the observed window',
  refuted: 'refuted in the observed window',
  inconclusive: 'inconclusive in the observed window',
}

/** How far a metric moved in a direction; positive is movement in that direction. */
function movementIn(direction: HypothesisDirection, current: number, baseline: number): number {
  const movement = current - baseline
  return direction === 'increase' ? movement : -movement
}

/** How far a metric moved in its preferred direction; positive is an improvement. */
function improvement(metric: HypothesisMetric, current: number, baseline: number): number {
  return movementIn(METRIC_DIRECTION[metric], current, baseline)
}

function guardrailOf(
  metric: HypothesisMetric | undefined,
  current: MetricValues,
  baseline: MetricValues | undefined,
): GuardrailResult | undefined {
  if (metric === undefined) return undefined
  const currentValue = metricValue(current, metric)
  const baselineValue = baseline === undefined ? undefined : metricValue(baseline, metric)
  // A guardrail carries no threshold of its own: any worsening blocks support.
  const regressed =
    currentValue !== undefined &&
    baselineValue !== undefined &&
    improvement(metric, currentValue, baselineValue) < 0
  return {
    metric,
    ...(baselineValue === undefined ? {} : { baseline: baselineValue }),
    ...(currentValue === undefined ? {} : { current: currentValue }),
    regressed,
  }
}

/**
 * Evaluate every hypothesis over the observed window. Supported needs the
 * sample minimum, the threshold in the expected direction, and no guardrail
 * regression; refuted needs movement opposite the threshold; nothing else is
 * claimed.
 */
export function evaluateHypotheses(
  hypotheses: readonly Hypothesis[],
  current: MetricValues,
  baseline?: MetricValues,
): HypothesisResult[] {
  return hypotheses.map((hypothesis, index) => {
    const currentValue = metricValue(current, hypothesis.metric)
    const baselineValue =
      baseline === undefined ? undefined : metricValue(baseline, hypothesis.metric)
    const guardrail = guardrailOf(hypothesis.guardrail, current, baseline)
    let status: HypothesisStatus
    // The sample minimum applies to both sides: a thin baseline cannot support
    // or refute a hypothesis, however large the current window is.
    const baselineTooSmall = baseline !== undefined && baseline.samples < hypothesis.minSamples
    if (current.samples < hypothesis.minSamples || currentValue === undefined || baselineTooSmall) {
      status = 'collecting'
    } else if (baselineValue === undefined) {
      status = 'inconclusive'
    } else {
      const movement = movementIn(hypothesis.direction, currentValue, baselineValue)
      // A configured guardrail must be observed on both sides before support;
      // an absent guardrail value is not a clean guardrail.
      const guardrailKnown =
        hypothesis.guardrail === undefined ||
        (guardrail?.current !== undefined && guardrail?.baseline !== undefined)
      if (movement >= hypothesis.threshold && guardrailKnown && guardrail?.regressed !== true) {
        status = 'supported'
      } else if (movement < 0 && movement <= -hypothesis.threshold) {
        // A zero threshold must not refute an unchanged metric.
        status = 'refuted'
      } else {
        status = 'inconclusive'
      }
    }
    return {
      index,
      ...(hypothesis.description === undefined ? {} : { description: hypothesis.description }),
      metric: hypothesis.metric,
      direction: hypothesis.direction,
      threshold: hypothesis.threshold,
      window: hypothesis.window,
      minSamples: hypothesis.minSamples,
      samples: current.samples,
      ...(baseline === undefined ? {} : { baselineSamples: baseline.samples }),
      ...(baselineValue === undefined ? {} : { baseline: baselineValue }),
      ...(currentValue === undefined ? {} : { current: currentValue }),
      ...(guardrail === undefined ? {} : { guardrail }),
      status,
      label: LABELS[status],
      observed: 'association, not proof',
    }
  })
}
