import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, DEFAULT_CONFIG, resolveConfig } from '../lib/index.js'

/**
 * Configuration is a trust boundary: the row is loaded from a profile patch the
 * user may have written by hand. Every accepted value is checked once, at load,
 * and every rejected value names its field.
 */

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
    })
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
      }),
    ).toEqual({
      enabled: false,
      resumeAfterRestart: true,
      resumeAfterUserStop: 'never',
      maxSessionResumes: 0,
      roundExtension: 1,
      maxRoundExtensions: 0,
      hardMaxGoalRounds: 1,
    })
  })

  it('returns a frozen complete value', () => {
    const resolved = resolveConfig({ maxSessionResumes: 3 })
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(resolved.maxSessionResumes).toBe(3)
    expect(resolved.enabled).toBe(true)
  })

  it('rejects a non-object config', () => {
    for (const value of [null, [], 'config', 4]) {
      expect(() => resolveConfig(value)).toThrow(/config must be an object/u)
    }
  })

  it('rejects unknown fields and typos', () => {
    expect(() => resolveConfig({ unknown: true })).toThrow(/unknown config field "unknown"/u)
    expect(() => resolveConfig({ resumeAfterRestartt: true })).toThrow(/unknown config field/u)
  })

  it('rejects every invalid boolean', () => {
    for (const field of ['enabled', 'resumeAfterRestart']) {
      for (const value of ['yes', 1, 0, null]) {
        expect(() => resolveConfig({ [field]: value })).toThrow(new RegExp(field, 'u'))
      }
    }
  })

  it('rejects every invalid user-stop policy value', () => {
    for (const value of ['always', 'goal', '', 1, null, true]) {
      expect(() => resolveConfig({ resumeAfterUserStop: value })).toThrow(/resumeAfterUserStop/u)
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

  it('fails the plugin load on an invalid row config', () => {
    const ctx = {} as Context
    expect(() => apply(ctx, { resumeAfterUserStop: 'always' } as never)).toThrow(
      /resumeAfterUserStop/u,
    )
  })
})
