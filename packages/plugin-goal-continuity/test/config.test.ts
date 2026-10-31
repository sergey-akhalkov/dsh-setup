import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  apply,
  DEFAULT_BLOCK_REVIEW_CONFIG,
  DEFAULT_CHECKPOINT_CONFIG,
  DEFAULT_CONFIG,
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

const CHECKPOINT_DEFAULTS = {
  enabled: true,
  minToolCalls: 4,
  requireWrite: true,
  maxBlocks: 3,
  enforceParallel: true,
  maxMessageChars: 1200,
}

describe('goal continuity configuration', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

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
      checkpoint: CHECKPOINT_DEFAULTS,
    })
    expect(DEFAULT_BLOCK_REVIEW_CONFIG).toEqual(BLOCK_REVIEW_DEFAULTS)
    expect(DEFAULT_CHECKPOINT_CONFIG).toEqual(CHECKPOINT_DEFAULTS)
    expect(Object.isFrozen(DEFAULT_BLOCK_REVIEW_CONFIG)).toBe(true)
    expect(Object.isFrozen(DEFAULT_CHECKPOINT_CONFIG)).toBe(true)
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
        checkpoint: {
          enabled: false,
          minToolCalls: 1,
          requireWrite: false,
          maxBlocks: 0,
          enforceParallel: false,
          maxMessageChars: 200,
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
      checkpoint: {
        enabled: false,
        minToolCalls: 1,
        requireWrite: false,
        maxBlocks: 0,
        enforceParallel: false,
        maxMessageChars: 200,
      },
    })
  })

  it('returns a frozen complete value', () => {
    const resolved = resolveConfig({ maxSessionResumes: 3, checkpoint: { minToolCalls: 7 } })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Object.isFrozen(resolved.blockReview)).toBe(true)
    expect(Object.isFrozen(resolved.checkpoint)).toBe(true)
    expect(resolved.maxSessionResumes).toBe(3)
    expect(resolved.enabled).toBe(true)
    expect(resolved.blockReview.reviewerPreset).toBe('goal-reviewer')
    expect(resolved.checkpoint.minToolCalls).toBe(7)
    expect(resolved.checkpoint.requireWrite).toBe(true)
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
    expect(() => resolveConfig({ checkpoint: { unknown: true } })).toThrow(
      /unknown config field "checkpoint.unknown"/u,
    )
    expect(() => resolveConfig({ checkpoint: { minToolCall: 3 } })).toThrow(/unknown config field/u)
  })

  it('rejects a malformed block review section', () => {
    for (const value of [null, [], 'review', 4]) {
      expect(() => resolveConfig({ blockReview: value })).toThrow(/blockReview/u)
    }
  })

  it('rejects a malformed checkpoint section', () => {
    for (const value of [null, [], 'checkpoint', 4]) {
      expect(() => resolveConfig({ checkpoint: value })).toThrow(/checkpoint/u)
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
    for (const field of ['enabled', 'requireWrite', 'enforceParallel']) {
      for (const value of ['yes', 1, 0, null]) {
        expect(() => resolveConfig({ checkpoint: { [field]: value } })).toThrow(
          new RegExp(`checkpoint\\.${field}`, 'u'),
        )
      }
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

  it('accepts the checkpoint integer boundaries and rejects out-of-range values', () => {
    expect(resolveConfig({ checkpoint: { minToolCalls: 1 } }).checkpoint.minToolCalls).toBe(1)
    expect(resolveConfig({ checkpoint: { minToolCalls: 1000 } }).checkpoint.minToolCalls).toBe(1000)
    expect(resolveConfig({ checkpoint: { maxBlocks: 0 } }).checkpoint.maxBlocks).toBe(0)
    expect(resolveConfig({ checkpoint: { maxBlocks: 100 } }).checkpoint.maxBlocks).toBe(100)
    expect(resolveConfig({ checkpoint: { maxMessageChars: 200 } }).checkpoint.maxMessageChars).toBe(
      200,
    )
    expect(
      resolveConfig({ checkpoint: { maxMessageChars: 20_000 } }).checkpoint.maxMessageChars,
    ).toBe(20_000)

    const invalid: Record<string, unknown[]> = {
      minToolCalls: [0, 1001, 1.5, '4', Number.NaN],
      maxBlocks: [-1, 101, 1.5, '3'],
      maxMessageChars: [199, 20_001, 1.5, '1200', Number.POSITIVE_INFINITY],
    }
    for (const [field, values] of Object.entries(invalid)) {
      for (const value of values) {
        expect(() => resolveConfig({ checkpoint: { [field]: value } })).toThrow(
          new RegExp(`checkpoint\\.${field}`, 'u'),
        )
      }
    }
  })

  it('accepts a legacy speedReview object, warns once, and ignores it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const legacy = {
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
    expect(resolveConfig({ speedReview: legacy })).toEqual(DEFAULT_CONFIG)
    expect(resolveConfig({ speedReview: legacy })).toEqual(DEFAULT_CONFIG)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('speedReview')
    expect(String(warn.mock.calls[0]?.[0])).toContain('deprecated')
    for (const value of [null, [], 'review', 4]) {
      expect(() => resolveConfig({ speedReview: value })).toThrow(/speedReview/u)
    }
  })

  it('fails the plugin load on an invalid row config', () => {
    const ctx = {} as Context
    expect(() => apply(ctx, { resumeAfterUserStop: 'always' } as never)).toThrow(
      /resumeAfterUserStop/u,
    )
    expect(() => apply(ctx, { blockReview: { timeoutMs: 0 } } as never)).toThrow(
      /blockReview\.timeoutMs/u,
    )
    expect(() => apply(ctx, { checkpoint: { minToolCalls: 0 } } as never)).toThrow(
      /checkpoint\.minToolCalls/u,
    )
    expect(() => apply(ctx, { checkpoint: { enforceParallel: 'yes' } } as never)).toThrow(
      /checkpoint\.enforceParallel/u,
    )
  })
})
