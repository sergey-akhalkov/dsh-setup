import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { apply, DEFAULT_CONFIG, inject, name, resolveConfig } from '../lib/index.js'

/**
 * The package test loads the built module, so it also proves the build emits
 * the Host entry the bundle row imports.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))

describe('goal continuity package', () => {
  it('emits the bundle identity', () => {
    expect(name).toBe('@dsh-setup/plugin-goal-continuity')
    expect(inject).toEqual(['agents', 'goals'])
  })

  it('resolves the documented defaults', () => {
    expect(resolveConfig(undefined)).toEqual(DEFAULT_CONFIG)
    expect(Object.isFrozen(resolveConfig({}))).toBe(true)
    expect(resolveConfig({}).blockReview.reviewerPreset).toBe('goal-reviewer')
  })

  it('ships the reviewer prompt asset and declares it in the package files', () => {
    const asset = readFileSync(join(packageDir, 'assets', 'blocker-review.md'), 'utf8')
    expect(asset).toContain('independent, read-only reviewer')
    const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as {
      files?: string[]
    }
    expect(manifest.files).toContain('assets/blocker-review.md')
  })

  it('validates the row configuration at load', () => {
    const ctx = new Context()
    ctx.provide('agents', { list: () => [], get: () => undefined } as never)
    expect(() => apply(ctx)).not.toThrow()
    expect(() => apply(ctx, { enabled: false })).not.toThrow()
    expect(() => apply(ctx, { blockReview: { enabled: false } })).not.toThrow()
    expect(() => apply(ctx, { maxSessionResumes: -1 })).toThrow(/maxSessionResumes/u)
    expect(() => apply(ctx, { resumeAfterUserStop: null } as never)).toThrow(/resumeAfterUserStop/u)
    expect(() => apply(ctx, { blockReview: { maxReviewsPerGoal: -1 } } as never)).toThrow(
      /blockReview\.maxReviewsPerGoal/u,
    )
    expect(() => apply(ctx, { unknown: true } as never)).toThrow(/unknown/u)
  })
})
