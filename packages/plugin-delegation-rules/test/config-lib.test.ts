import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_QUEUE, validateConfig } from '../lib/index.js'

/**
 * The packaged entry point is what a profile loads. Keep one check here so a
 * stale committed lib/ cannot silently reject a source-level configuration.
 */
describe('packaged configuration entry point', () => {
  it('applies the documented review queue defaults through lib/', () => {
    const config = validateConfig({})
    expect(config.reviewQueue).toEqual({
      enabled: true,
      concurrency: 2,
      maxQueued: 16,
      maxAttempts: 3,
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
      waitTimeoutMs: 300_000,
    })
    expect(config.reviewQueue).toEqual({ ...DEFAULT_REVIEW_QUEUE })
  })

  it('accepts the off switch and a partial block through lib/', () => {
    expect(validateConfig({ reviewQueue: { enabled: false } }).reviewQueue.enabled).toBe(false)
    expect(
      validateConfig({ reviewQueue: { concurrency: 3, maxAttempts: 2 } }).reviewQueue,
    ).toMatchObject({ enabled: true, concurrency: 3, maxAttempts: 2 })
  })

  it('fails plugin load with the field and range through lib/', () => {
    expect(() => validateConfig({ reviewQueue: { concurrency: 0 } })).toThrow(
      /reviewQueue\.concurrency must be a whole number from 1 to 4/,
    )
    expect(() => validateConfig({ reviewQueue: { maxAttempts: -1 } })).toThrow(
      /reviewQueue\.maxAttempts must be a whole number at least 1/,
    )
  })
})
