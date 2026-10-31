import { RANGES } from './aggregate.js';
/** Every accepted metric id, in catalog order. */
export const HYPOTHESIS_METRICS = [
    'verified-completion-rate',
    'tokens-per-episode',
    'context-tokens-per-step',
    'active-minutes-per-episode',
    'steps-per-human-message',
    'human-messages-per-completed-goal',
    'delegate-rate',
    'checkpoint-coverage',
    'failure-rate',
];
/** The preferred direction of every catalog metric, used by guardrails. */
export const METRIC_DIRECTION = {
    'verified-completion-rate': 'increase',
    'tokens-per-episode': 'decrease',
    'context-tokens-per-step': 'decrease',
    'active-minutes-per-episode': 'decrease',
    'steps-per-human-message': 'decrease',
    'human-messages-per-completed-goal': 'decrease',
    'delegate-rate': 'increase',
    'checkpoint-coverage': 'increase',
    'failure-rate': 'decrease',
};
/** Samples a hypothesis needs before it can support or refute anything. */
export const DEFAULT_MIN_SAMPLES = 20;
/** A configuration error that names the offending field or metric. */
export class HypothesisConfigError extends Error {
    constructor(message) {
        super(`observability config: ${message}`);
        this.name = 'HypothesisConfigError';
    }
}
const HYPOTHESIS_FIELDS = new Set([
    'description',
    'metric',
    'direction',
    'threshold',
    'window',
    'minSamples',
    'minEpisodes',
    'guardrail',
]);
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isMetric(value) {
    return typeof value === 'string' && HYPOTHESIS_METRICS.includes(value);
}
function readMetric(value, at) {
    if (!isMetric(value)) {
        throw new HypothesisConfigError(`${at} must be one of: ${HYPOTHESIS_METRICS.join(', ')}; received ${JSON.stringify(value)}`);
    }
    return value;
}
function readHypothesis(value, at) {
    if (!isRecord(value))
        throw new HypothesisConfigError(`${at} must be a mapping`);
    for (const key of Object.keys(value)) {
        if (!HYPOTHESIS_FIELDS.has(key)) {
            throw new HypothesisConfigError(`${at}: unknown field "${key}"`);
        }
    }
    const metric = readMetric(value.metric, `${at}.metric`);
    const direction = value.direction ?? 'increase';
    if (direction !== 'increase' && direction !== 'decrease') {
        throw new HypothesisConfigError(`${at}.direction must be "increase" or "decrease"`);
    }
    const threshold = value.threshold;
    if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
        throw new HypothesisConfigError(`${at}.threshold must be a non-negative number`);
    }
    const window = value.window ?? 'week';
    if (typeof window !== 'string' || !RANGES.includes(window)) {
        throw new HypothesisConfigError(`${at}.window must be one of: ${RANGES.join(', ')}`);
    }
    // The design calls the sample minimum `minEpisodes`; `minSamples` is the
    // shorter alias the shipped configuration uses.
    const readMinimum = (raw, field) => {
        if (raw === undefined)
            return undefined;
        if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 1) {
            throw new HypothesisConfigError(`${at}.${field} must be a positive integer`);
        }
        return raw;
    };
    const samplesMinimum = readMinimum(value.minSamples, 'minSamples');
    const episodesMinimum = readMinimum(value.minEpisodes, 'minEpisodes');
    const minSamples = samplesMinimum ?? episodesMinimum ?? DEFAULT_MIN_SAMPLES;
    const guardrail = value.guardrail === undefined ? undefined : readMetric(value.guardrail, `${at}.guardrail`);
    const description = value.description;
    if (description !== undefined && (typeof description !== 'string' || description.trim() === '')) {
        throw new HypothesisConfigError(`${at}.description must be a non-empty string`);
    }
    return {
        ...(description === undefined ? {} : { description }),
        metric,
        direction,
        threshold,
        window: window,
        minSamples,
        ...(guardrail === undefined ? {} : { guardrail }),
    };
}
/** Validate the configured hypothesis list; an absent list is valid. */
export function parseHypotheses(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw))
        throw new HypothesisConfigError('config.hypotheses must be an array');
    return raw.map((value, index) => readHypothesis(value, `hypotheses[${index}]`));
}
/** One metric's value, or undefined when the window holds no data for it. */
export function metricValue(values, metric) {
    switch (metric) {
        case 'verified-completion-rate':
            return values.verifiedCompletionRate;
        case 'tokens-per-episode':
            return values.tokensPerEpisode;
        case 'context-tokens-per-step':
            return values.contextTokensPerStep;
        case 'active-minutes-per-episode':
            return values.activeMinutesPerEpisode;
        case 'steps-per-human-message':
            return values.stepsPerHumanMessage;
        case 'human-messages-per-completed-goal':
            return values.humanMessagesPerCompletedGoal;
        case 'delegate-rate':
            return values.delegateRate;
        case 'checkpoint-coverage':
            return values.checkpointCoverage;
        case 'failure-rate':
            return values.failureRate;
    }
}
const LABELS = {
    collecting: 'collecting: fewer samples than the minimum',
    supported: 'supported in the observed window',
    refuted: 'refuted in the observed window',
    inconclusive: 'inconclusive in the observed window',
};
/** How far a metric moved in a direction; positive is movement in that direction. */
function movementIn(direction, current, baseline) {
    const movement = current - baseline;
    return direction === 'increase' ? movement : -movement;
}
/** How far a metric moved in its preferred direction; positive is an improvement. */
function improvement(metric, current, baseline) {
    return movementIn(METRIC_DIRECTION[metric], current, baseline);
}
function guardrailOf(metric, current, baseline) {
    if (metric === undefined)
        return undefined;
    const currentValue = metricValue(current, metric);
    const baselineValue = baseline === undefined ? undefined : metricValue(baseline, metric);
    // A guardrail carries no threshold of its own: any worsening blocks support.
    const regressed = currentValue !== undefined &&
        baselineValue !== undefined &&
        improvement(metric, currentValue, baselineValue) < 0;
    return {
        metric,
        ...(baselineValue === undefined ? {} : { baseline: baselineValue }),
        ...(currentValue === undefined ? {} : { current: currentValue }),
        regressed,
    };
}
/**
 * Evaluate every hypothesis over the observed window. Supported needs the
 * sample minimum, the threshold in the expected direction, and no guardrail
 * regression; refuted needs movement opposite the threshold; nothing else is
 * claimed.
 */
export function evaluateHypotheses(hypotheses, current, baseline) {
    return hypotheses.map((hypothesis, index) => {
        const currentValue = metricValue(current, hypothesis.metric);
        const baselineValue = baseline === undefined ? undefined : metricValue(baseline, hypothesis.metric);
        const guardrail = guardrailOf(hypothesis.guardrail, current, baseline);
        let status;
        if (current.samples < hypothesis.minSamples || currentValue === undefined) {
            status = 'collecting';
        }
        else if (baselineValue === undefined) {
            status = 'inconclusive';
        }
        else {
            const movement = movementIn(hypothesis.direction, currentValue, baselineValue);
            // A configured guardrail must be observed on both sides before support;
            // an absent guardrail value is not a clean guardrail.
            const guardrailKnown = hypothesis.guardrail === undefined ||
                (guardrail?.current !== undefined && guardrail?.baseline !== undefined);
            if (movement >= hypothesis.threshold && guardrailKnown && guardrail?.regressed !== true) {
                status = 'supported';
            }
            else if (movement < 0 && movement <= -hypothesis.threshold) {
                // A zero threshold must not refute an unchanged metric.
                status = 'refuted';
            }
            else {
                status = 'inconclusive';
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
            ...(baselineValue === undefined ? {} : { baseline: baselineValue }),
            ...(currentValue === undefined ? {} : { current: currentValue }),
            ...(guardrail === undefined ? {} : { guardrail }),
            status,
            label: LABELS[status],
            observed: 'association, not proof',
        };
    });
}
