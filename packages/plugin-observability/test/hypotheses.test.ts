import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MIN_SAMPLES,
  evaluateHypotheses,
  HypothesisConfigError,
  type MetricValues,
  parseHypotheses,
} from '../src/host/hypotheses.ts'

function rejection(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof HypothesisConfigError) return error.message
    throw error
  }
  throw new Error('expected a HypothesisConfigError')
}

const READY: MetricValues = {
  samples: 40,
  verifiedCompletionRate: 0.4,
  tokensPerEpisode: 1000,
  contextTokensPerStep: 500,
  activeMinutesPerEpisode: 6,
  stepsPerHumanMessage: 8,
  humanMessagesPerCompletedGoal: 2,
  delegateRate: 0.2,
  checkpointCoverage: 0.3,
  failureRate: 0.1,
}

describe('hypothesis configuration', () => {
  it('accepts a fully specified hypothesis and defaults what it omits', () => {
    const hypotheses = parseHypotheses([
      {
        description: 'goal continuity reduces steps per human message',
        metric: 'steps-per-human-message',
        direction: 'decrease',
        threshold: 0.5,
        window: 'week',
        minSamples: 25,
        guardrail: 'failure-rate',
      },
      { metric: 'delegate-rate', direction: 'increase', threshold: 0 },
    ])
    expect(hypotheses[0]).toEqual({
      description: 'goal continuity reduces steps per human message',
      metric: 'steps-per-human-message',
      direction: 'decrease',
      threshold: 0.5,
      window: 'week',
      minSamples: 25,
      guardrail: 'failure-rate',
    })
    expect(hypotheses[1]).toEqual({
      metric: 'delegate-rate',
      direction: 'increase',
      threshold: 0,
      window: 'week',
      minSamples: DEFAULT_MIN_SAMPLES,
    })
    expect(parseHypotheses(undefined)).toEqual([])
    // The design names the sample minimum `minEpisodes`; it is the same knob.
    const [designNamed] = parseHypotheses([
      { metric: 'failure-rate', direction: 'decrease', threshold: 0.1, minEpisodes: 25 },
    ])
    expect(designNamed?.minSamples).toBe(25)
  })

  it('rejects each invalid field by name', () => {
    const base = { metric: 'failure-rate', direction: 'decrease', threshold: 0.1 }
    expect(rejection(() => parseHypotheses([{ ...base, threshold: -1 }]))).toBe(
      'observability config: hypotheses[0].threshold must be a non-negative number',
    )
    expect(rejection(() => parseHypotheses([{ ...base, threshold: 'high' }]))).toBe(
      'observability config: hypotheses[0].threshold must be a non-negative number',
    )
    expect(rejection(() => parseHypotheses([{ ...base, direction: 'sideways' }]))).toBe(
      'observability config: hypotheses[0].direction must be "increase" or "decrease"',
    )
    expect(rejection(() => parseHypotheses([{ ...base, window: 'year' }]))).toBe(
      'observability config: hypotheses[0].window must be one of: session, day, week, month',
    )
    expect(rejection(() => parseHypotheses([{ ...base, minSamples: 0 }]))).toBe(
      'observability config: hypotheses[0].minSamples must be a positive integer',
    )
    expect(rejection(() => parseHypotheses([{ ...base, minSamples: 1.5 }]))).toBe(
      'observability config: hypotheses[0].minSamples must be a positive integer',
    )
    expect(rejection(() => parseHypotheses([{ ...base, description: '' }]))).toBe(
      'observability config: hypotheses[0].description must be a non-empty string',
    )
    expect(rejection(() => parseHypotheses([{ ...base, formula: 'x' }]))).toBe(
      'observability config: hypotheses[0]: unknown field "formula"',
    )
    expect(rejection(() => parseHypotheses('nope'))).toBe(
      'observability config: config.hypotheses must be an array',
    )
  })

  it('names an unknown metric and a constant metric such as human messages per episode', () => {
    expect(
      rejection(() =>
        parseHypotheses([
          { metric: 'human-messages-per-episode', direction: 'increase', threshold: 1 },
        ]),
      ),
    ).toContain('must be one of: verified-completion-rate')
    expect(rejection(() => parseHypotheses([{ metric: 'revenue', threshold: 1 }]))).toContain(
      'received "revenue"',
    )
    expect(
      rejection(() =>
        parseHypotheses([
          { metric: 'delegate-rate', threshold: 0.1, guardrail: 'human-messages-per-episode' },
        ]),
      ),
    ).toContain('hypotheses[0].guardrail must be one of')
  })

  it('keeps a description inert data and never executes it', () => {
    const script = 'throw new Error("executed")'
    const [hypothesis] = parseHypotheses([
      { description: script, metric: 'failure-rate', direction: 'decrease', threshold: 0.1 },
    ])
    expect(hypothesis?.description).toBe(script)
    // Evaluation carries the text through unchanged; nothing evaluates it.
    const [result] = evaluateHypotheses([hypothesis!], READY, READY)
    expect(result?.description).toBe(script)
    expect(result?.observed).toBe('association, not proof')
  })
})

describe('hypothesis evaluation', () => {
  const supported = {
    description: 'fewer steps per human message',
    metric: 'steps-per-human-message' as const,
    direction: 'decrease' as const,
    threshold: 1,
    window: 'week' as const,
    minSamples: 10,
  }

  it('reports collecting below the sample minimum', () => {
    const [result] = evaluateHypotheses([supported], { ...READY, samples: 5 })
    expect(result?.status).toBe('collecting')
    expect(result?.label).toContain('collecting')
    expect(result?.samples).toBe(5)
  })

  it('reports supported when the threshold is met and the guardrail holds', () => {
    const baseline = { ...READY, stepsPerHumanMessage: 12 }
    const [result] = evaluateHypotheses([supported], READY, baseline)
    expect(result?.status).toBe('supported')
    expect(result?.current).toBe(8)
    expect(result?.baseline).toBe(12)
    expect(result?.label).toBe('supported in the observed window')
  })

  it('reports refuted when the metric moves opposite beyond the threshold', () => {
    const baseline = { ...READY, stepsPerHumanMessage: 5 }
    const [result] = evaluateHypotheses([supported], READY, baseline)
    expect(result?.status).toBe('refuted')
    expect(result?.label).toBe('refuted in the observed window')
  })

  it('reports inconclusive inside the threshold and without a baseline', () => {
    const inside = evaluateHypotheses([supported], READY, {
      ...READY,
      stepsPerHumanMessage: 8.5,
    })
    expect(inside[0]?.status).toBe('inconclusive')
    const noBaseline = evaluateHypotheses([supported], READY)
    expect(noBaseline[0]?.status).toBe('inconclusive')
    expect(noBaseline[0]?.baseline).toBeUndefined()
  })

  it('blocks support when the guardrail regresses', () => {
    const guarded = { ...supported, guardrail: 'failure-rate' as const }
    const baseline = { ...READY, stepsPerHumanMessage: 12, failureRate: 0.05 }
    const [result] = evaluateHypotheses([guarded], READY, baseline)
    expect(result?.status).not.toBe('supported')
    expect(result?.guardrail?.regressed).toBe(true)
    expect(result?.guardrail?.current).toBe(0.1)
  })

  it('does not support a hypothesis whose guardrail is unobserved', () => {
    const guarded = { ...supported, guardrail: 'verified-completion-rate' as const }
    const qualifying = { ...READY, stepsPerHumanMessage: 12 }
    // The primary metric would qualify, but no current episode completed.
    const current: MetricValues = { ...READY, verifiedCompletionRate: undefined }
    const [missingCurrent] = evaluateHypotheses([guarded], current, qualifying)
    expect(missingCurrent?.status).toBe('inconclusive')
    expect(missingCurrent?.guardrail?.current).toBeUndefined()
    // The same holds when the baseline never observed the guardrail.
    const baselineWithout: MetricValues = {
      ...qualifying,
      verifiedCompletionRate: undefined,
    }
    const [missingBaseline] = evaluateHypotheses([guarded], READY, baselineWithout)
    expect(missingBaseline?.status).toBe('inconclusive')
    expect(missingBaseline?.guardrail?.baseline).toBeUndefined()
  })

  it('does not refute an unchanged metric at a zero threshold', () => {
    const zeroThreshold = { ...supported, threshold: 0, guardrail: 'failure-rate' as const }
    const baseline = { ...READY, failureRate: 0.05 }
    const [result] = evaluateHypotheses([zeroThreshold], READY, baseline)
    expect(result?.status).toBe('inconclusive')
  })

  it('reports the observed window and the sample size', () => {
    const [result] = evaluateHypotheses([supported], READY, READY)
    expect(result?.window).toBe('week')
    expect(result?.samples).toBe(40)
    expect(result?.minSamples).toBe(10)
    expect(result?.observed).toBe('association, not proof')
  })

  it('reads a metric with no data for the window as collecting', () => {
    const incomplete: MetricValues = { samples: 40 }
    const [result] = evaluateHypotheses([supported], incomplete, { samples: 40 })
    expect(result?.status).toBe('collecting')
    expect(result?.current).toBeUndefined()
  })
})
