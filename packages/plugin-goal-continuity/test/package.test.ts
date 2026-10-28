import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, DEFAULT_CONFIG, inject, name, resolveConfig } from '../lib/index.js'

/**
 * The package test loads the built module, so it also proves the build emits
 * the Host entry the bundle row imports.
 */

describe('goal continuity package', () => {
  it('emits the bundle identity', () => {
    expect(name).toBe('@dsh-setup/plugin-goal-continuity')
    expect(inject).toEqual(['agents', 'goals'])
  })

  it('resolves the documented defaults', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(Object.isFrozen(resolveConfig({}))).toBe(true)
  })

  it('validates the row configuration at load', () => {
    const ctx = new Context()
    ctx.provide('agents', { list: () => [], get: () => undefined } as never)
    expect(() => apply(ctx)).not.toThrow()
    expect(() => apply(ctx, { enabled: false })).not.toThrow()
    expect(() => apply(ctx, { maxSessionResumes: -1 })).toThrow(/maxSessionResumes/u)
    expect(() => apply(ctx, { resumeAfterUserStop: null } as never)).toThrow(/resumeAfterUserStop/u)
    expect(() => apply(ctx, { unknown: true } as never)).toThrow(/unknown/u)
  })
})
