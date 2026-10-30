import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import {
  apply,
  DEFAULT_BLOCK_REVIEW_CONFIG,
  DEFAULT_CONFIG,
  DEFAULT_SPEED_REVIEW_CONFIG,
  resolveConfig,
} from '../lib/index.js'

/**
 * Configuration is a trust boundary: the row is loaded from a profile patch the
 * user may have written by hand. Every accepted value is checked once, at load,
 * and every rejected value names its field.
 */

const BLOCK_REVIEW_DEFAULTS = {
  enabled: true,
  provider: 'spawn',
  model: 'deepseek-flash',
  reasoningEffort: 'max',
  reviewerPreset: 'goal-reviewer',
  blockedAfterConsecutiveRounds: 3,
  timeoutMs: 300000,
  maxReviewsPerGoal: 3,
  onReviewError: 'deny',
  onUnavailable: 'allow',
  onExhausted: 'deny',
}

const SPEED_REVIEW_DEFAULTS = {
  enabled: true,
  provider: 'spawn',
  model: 'deepseek-flash',
  reasoningEffort: 'max',
  minToolCalls: 12,
  minMinutes: 5,
  slowCallMs: 120000,
  everyRound: false,
  timeoutMs: 120000,
  maxPerGoal: 20,
  brief: true,
}

describe('goal continuity configuration', () => {
  it('applies the documented defaults', () => {
    expect(DEFAULT_CONFIG).toEqual({
      enabled: true,
      resumeAfterRestart: false,
      resumeAfterUserStop: 'non-goal',
      maxSessionResumes: 20,
      roundExtension: 1000,
      maxRoundExtensions: 2,
      hardMaxGoalRounds: 5000,
      blockReview: BLOCK_REVIEW_DEFAULTS,
      speedReview: SPEED_REVIEW_DEFAULTS,
    })
    expect(DEFAULT_BLOCK_REVIEW_CONFIG).toEqual(BLOCK_REVIEW_DEFAULTS)
    expect(DEFAULT_SPEED_REVIEW_CONFIG).toEqual(SPEED_REVIEW_DEFAULTS)
    expect(Object.isFrozen(DEFAULT_BLOCK_REVIEW_CONFIG)).toBe(true)
    expect(Object.isFrozen(DEFAULT_SPEED_REVIEW_CONFIG)).toBe(true)
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(resolveConfig({})).toEqual(DEFAULT_CONFIG)
  })

  it('accepts every documented override', () => {
    expect(
      resolveConfig({
        enabled: false,
        resumeAfterRestart: true,
        resumeAfterUserStop: 'never',
        maxSessionResumes: 0,
        roundExtension: 1,
        maxRoundExtensions: 0,
        hardMaxGoalRounds: 1,
        blockReview: {
          enabled: false,
          provider: 'fork',
          model: 'other-model',
          reasoningEffort: 'high',
          reviewerPreset: 'another-reviewer',
          blockedAfterConsecutiveRounds: 5,
          timeoutMs: 50,
          maxReviewsPerGoal: 0,
          onReviewError: 'allow',
          onUnavailable: 'deny',
          onExhausted: 'allow',
        },
        speedReview: {
          enabled: false,
          provider: 'fork',
          model: 'other-model',
          reasoningEffort: 'high',
          minToolCalls: 0,
          minMinutes: 0,
          slowCallMs: 0,
          everyRound: true,
          timeoutMs: 50,
          maxPerGoal: 0,
          brief: false,
        },
      }),
    ).toEqual({
      enabled: false,
      resumeAfterRestart: true,
      resumeAfterUserStop: 'never',
      maxSessionResumes: 0,
      roundExtension: 1,
      maxRoundExtensions: 0,
      hardMaxGoalRounds: 1,
      blockReview: {
        enabled: false,
        provider: 'fork',
        model: 'other-model',
        reasoningEffort: 'high',
        reviewerPreset: 'another-reviewer',
        blockedAfterConsecutiveRounds: 5,
        timeoutMs: 50,
        maxReviewsPerGoal: 0,
        onReviewError: 'allow',
        onUnavailable: 'deny',
        onExhausted: 'allow',
      },
      speedReview: {
        enabled: false,
        provider: 'fork',
        model: 'other-model',
        reasoningEffort: 'high',
        minToolCalls: 0,
        minMinutes: 0,
        slowCallMs: 0,
        everyRound: true,
        timeoutMs: 50,
        maxPerGoal: 0,
        brief: false,
      },
    })
  })

  it('returns a frozen complete value', () => {
    const resolved = resolveConfig({ maxSessionResumes: 3, speedReview: { minToolCalls: 7 } })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.blockReview)).toBe(true)
    expect(Object.isFrozen(resolved.speedReview)).toBe(true)
    expect(resolved.maxSessionResumes).toBe(3)
    expect(resolved.enabled).toBe(true)
    expect(resolved.blockReview.reviewerPreset).toBe('goal-reviewer')
    expect(resolved.speedReview.minToolCalls).toBe(7)
  })

  it('rejects a non-object config', () => {
    for (const value of [null, [], 'config', 4]) {
      expect(() => resolveConfig(value)).toThrow(/config must be an object/u)
    }
  })

  it('rejects unknown fields and typos', () => {
    expect(() => resolveConfig({ unknown: true })).toThrow(/unknown config field "unknown"/u)
    expect(() => resolveConfig({ resumeAfterRestartt: true })).toThrow(/unknown config field/u)
    expect(() => resolveConfig({ blockReview: { unknown: true } })).toThrow(
      /unknown config field "blockReview.unknown"/u,
    )
    expect(() => resolveConfig({ blockReview: { reviewerPresett: 'x' } })).toThrow(
      /unknown config field/u,
    )
  })

  it('rejects a malformed block review section', () => {
    for (const value of [null, [], 'review', 4]) {
      expect(() => resolveConfig({ blockReview: value })).toThrow(/blockReview/u)
    }
  })

  it('rejects every invalid boolean', () => {
    for (const field of ['enabled', 'resumeAfterRestart']) {
      for (const value of ['yes', 1, 0, null]) {
        expect(() => resolveConfig({ [field]: value })).toThrow(new RegExp(field, 'u'))
      }
    }
    for (const value of ['yes', 1, 0, null]) {
      expect(() => resolveConfig({ blockReview: { enabled: value } })).toThrow(
        /blockReview\.enabled/u,
      )
    }
  })

  it('rejects every invalid user-stop policy value', () => {
    for (const value of ['always', 'goal', '', 1, null, true]) {
      expect(() => resolveConfig({ resumeAfterUserStop: value })).toThrow(/resumeAfterUserStop/u)
    }
  })

  it('rejects every invalid block review string', () => {
    for (const field of ['provider', 'model', 'reasoningEffort', 'reviewerPreset']) {
      for (const value of ['', '   ', 5, null, true]) {
        expect(() => resolveConfig({ blockReview: { [field]: value } })).toThrow(
          new RegExp(`blockReview\\.${field}`, 'u'),
        )
      }
    }
  })

  it('rejects every invalid block review policy value', () => {
    for (const field of ['onReviewError', 'onUnavailable', 'onExhausted']) {
      for (const value of ['always', 'never', '', 1, null, true]) {
        expect(() => resolveConfig({ blockReview: { [field]: value } })).toThrow(
          new RegExp(`blockReview\\.${field}`, 'u'),
        )
      }
    }
  })

  it('rejects every invalid block review integer', () => {
    const invalid: Record<string, unknown[]> = {
      blockedAfterConsecutiveRounds: [0, 1001, 1.5, '3', Number.NaN],
      timeoutMs: [49, 3_600_001, 1.5, '300000', Number.POSITIVE_INFINITY],
      maxReviewsPerGoal: [-1, 101, 1.5, '3'],
    }
    for (const [field, values] of Object.entries(invalid)) {
      for (const value of values) {
        expect(() => resolveConfig({ blockReview: { [field]: value } })).toThrow(
          new RegExp(`blockReview\\.${field}`, 'u'),
        )
      }
    }
  })

  it('rejects every invalid integer value', () => {
    const invalid: Record<string, unknown[]> = {
      maxSessionResumes: [-1, 1001, 1.5, '20', Number.NaN, Number.POSITIVE_INFINITY],
      roundExtension: [0, 1_000_001, 1.5, '1000', Number.NaN],
      maxRoundExtensions: [-1, 101, 1.5, '2'],
      hardMaxGoalRounds: [0, 1_000_001, 1.5, '5000', Number.NaN],
    }
    for (const [field, values] of Object.entries(invalid)) {
      for (const value of values) {
        expect(() => resolveConfig({ [field]: value })).toThrow(new RegExp(field, 'u'))
      }
    }
  })

  it('rejects an unknown or malformed speed review section', () => {
    for (const value of [null, [], 'review', 4]) {
      expect(() => resolveConfig({ speedReview: value })).toThrow(/speedReview/u)
    }
    expect(() => resolveConfig({ speedReview: { unknown: true } })).toThrow(
      /unknown config field "speedReview.unknown"/u,
    )
    expect(() => resolveConfig({ speedReview: { minToolCall: 3 } })).toThrow(
      /unknown config field/u,
    )
  })

  it('rejects every invalid speed review boolean', () => {
    for (const field of ['enabled', 'everyRound', 'brief']) {
      for (const value of ['yes', 1, 0, null]) {
        expect(() => resolveConfig({ speedReview: { [field]: value } })).toThrow(
          new RegExp(`speedReview\\.${field}`, 'u'),
        )
      }
    }
  })

  it('rejects every invalid speed review string', () => {
    for (const field of ['provider', 'model', 'reasoningEffort']) {
      for (const value of ['', '   ', 5, null, true]) {
        expect(() => resolveConfig({ speedReview: { [field]: value } })).toThrow(
          new RegExp(`speedReview\\.${field}`, 'u'),
        )
      }
    }
  })

  it('accepts the minMinutes boundaries and rejects out-of-range values', () => {
    expect(resolveConfig({ speedReview: { minMinutes: 0 } }).speedReview.minMinutes).toBe(0)
    expect(resolveConfig({ speedReview: { minMinutes: 1440 } }).speedReview.minMinutes).toBe(1440)
    expect(resolveConfig({ speedReview: { minMinutes: 0.5 } }).speedReview.minMinutes).toBe(0.5)
    for (const value of [-1, 1441, 1.5e9, Number.NaN, Number.POSITIVE_INFINITY, '5', null]) {
      expect(() => resolveConfig({ speedReview: { minMinutes: value } })).toThrow(
        /speedReview\.minMinutes/u,
      )
    }
  })

  it('accepts every speed review integer boundary value', () => {
    expect(resolveConfig({ speedReview: { minToolCalls: 0 } }).speedReview.minToolCalls).toBe(0)
    expect(resolveConfig({ speedReview: { minToolCalls: 1000 } }).speedReview.minToolCalls).toBe(
      1000,
    )
    expect(resolveConfig({ speedReview: { slowCallMs: 0 } }).speedReview.slowCallMs).toBe(0)
    expect(resolveConfig({ speedReview: { slowCallMs: 3_600_000 } }).speedReview.slowCallMs).toBe(
      3_600_000,
    )
    expect(resolveConfig({ speedReview: { timeoutMs: 50 } }).speedReview.timeoutMs).toBe(50)
    expect(resolveConfig({ speedReview: { timeoutMs: 3_600_000 } }).speedReview.timeoutMs).toBe(
      3_600_000,
    )
    expect(resolveConfig({ speedReview: { maxPerGoal: 0 } }).speedReview.maxPerGoal).toBe(0)
    expect(resolveConfig({ speedReview: { maxPerGoal: 100 } }).speedReview.maxPerGoal).toBe(100)
  })

  it('rejects every invalid speed review integer', () => {
    const invalid: Record<string, unknown[]> = {
      minToolCalls: [-1, 1001, 1.5, '12', Number.NaN],
      slowCallMs: [-1, 3_600_001, 1.5, '120000', Number.POSITIVE_INFINITY],
      timeoutMs: [49, 3_600_001, 1.5, '120000', Number.NaN],
      maxPerGoal: [-1, 101, 1.5, '20'],
    }
    for (const [field, values] of Object.entries(invalid)) {
      for (const value of values) {
        expect(() => resolveConfig({ speedReview: { [field]: value } })).toThrow(
          new RegExp(`speedReview\\.${field}`, 'u'),
        )
      }
    }
    expect(resolveConfig({ speedReview: { minToolCalls: 0 } }).speedReview.minToolCalls).toBe(0)
    expect(resolveConfig({ speedReview: { maxPerGoal: 0 } }).speedReview.maxPerGoal).toBe(0)
  })

  it('fails the plugin load on an invalid row config', () => {
    const ctx = {} as Context
    expect(() => apply(ctx, { resumeAfterUserStop: 'always' } as never)).toThrow(
      /resumeAfterUserStop/u,
    )
    expect(() => apply(ctx, { blockReview: { timeoutMs: 0 } } as never)).toThrow(
      /blockReview\.timeoutMs/u,
    )
    expect(() => apply(ctx, { speedReview: { minToolCalls: -1 } } as never)).toThrow(
      /speedReview\.minToolCalls/u,
    )
    expect(() => apply(ctx, { speedReview: { brief: 'yes' } } as never)).toThrow(
      /speedReview\.brief/u,
    )
  })
})
