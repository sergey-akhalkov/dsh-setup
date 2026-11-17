import { describe, expect, it } from 'vitest'
import {
  DEFAULT_REVIEW_QUEUE,
  DEFAULT_REVIEW_TIMEOUT_MS,
  resolveReviewer,
  resolveReviewers,
  resolveReviewQueue,
  resolveReviewTimeout,
} from '../src/host/review.ts'
import { type QueueRunFile, ReviewQueue } from '../src/host/review-queue.ts'

describe('reviewers config', () => {
  it('defaults to an empty map and keeps a valid reviewer', () => {
    expect(resolveReviewers(undefined)).toEqual({})
    const reviewers = resolveReviewers({
      codex: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
    })
    expect(reviewers.codex).toEqual({
      provider: 'codex-subagent',
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
    expect(
      resolveReviewers({
        codex: { provider: 'codex-subagent', agentOptions: { model: 'm', maxTokens: 10 } },
      }).codex?.agentOptions,
    ).toEqual({ model: 'm', maxTokens: 10 })
  })

  it('rejects an invalid id, an unknown field, and a non-object reviewer', () => {
    expect(() => resolveReviewers({ Codex: { provider: 'p' } })).toThrow(/kebab-case/u)
    expect(() => resolveReviewers({ codex: { provider: 'p', model2: 'm' } })).toThrow(
      /unknown field/u,
    )
    expect(() => resolveReviewers({ codex: 'p' })).toThrow(/must be an object/u)
    expect(() => resolveReviewers({ codex: { provider: '' } })).toThrow(/non-empty/u)
  })

  it('rejects model/effort when the registered provider lacks agentOptions', () => {
    expect(() =>
      resolveReviewers({ codex: { provider: 'plain', model: 'm' } }, (provider) =>
        provider === 'plain' ? false : undefined,
      ),
    ).toThrow(/does not declare agentOptions support/u)
    expect(() =>
      resolveReviewers({ codex: { provider: 'plain', reasoningEffort: 'high' } }, () => false),
    ).toThrow(/agentOptions support/u)
  })

  it('does not fail a load for an unregistered provider, only the run', () => {
    const reviewers = resolveReviewers(
      { codex: { provider: 'not-registered', model: 'm' } },
      () => undefined,
    )
    expect(reviewers.codex?.provider).toBe('not-registered')
    const resolved = resolveReviewer(reviewers, 'codex')
    expect(resolved.ok).toBe(true)
    const missing = resolveReviewer(reviewers, 'other')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('reviewers.other')
  })
})

describe('review queue config', () => {
  it('applies the documented defaults', () => {
    expect(resolveReviewQueue(undefined)).toEqual(DEFAULT_REVIEW_QUEUE)
    expect(DEFAULT_REVIEW_QUEUE).toEqual({
      enabled: true,
      concurrency: 10,
      maxQueued: 16,
      maxAttempts: 3,
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
      waitTimeoutMs: 1_200_000,
    })
  })

  it('accepts every documented field and rejects an out-of-range value', () => {
    expect(
      resolveReviewQueue({
        enabled: false,
        concurrency: 10,
        maxQueued: 100,
        maxAttempts: 10,
        baseDelayMs: 0,
        maxDelayMs: 3_600_000,
        waitTimeoutMs: 1_000,
      }),
    ).toEqual({
      enabled: false,
      concurrency: 10,
      maxQueued: 100,
      maxAttempts: 10,
      baseDelayMs: 0,
      maxDelayMs: 3_600_000,
      waitTimeoutMs: 1_000,
    })
    expect(resolveReviewQueue({ baseDelayMs: 3_600_000, maxDelayMs: 0 }).baseDelayMs).toBe(
      3_600_000,
    )
    expect(resolveReviewQueue({ waitTimeoutMs: 3_600_000 }).waitTimeoutMs).toBe(3_600_000)
    for (const bad of [
      { concurrency: 0 },
      { concurrency: 11 },
      { maxQueued: 0 },
      { maxQueued: 101 },
      { maxAttempts: 0 },
      { maxAttempts: 11 },
      { baseDelayMs: -1 },
      { maxDelayMs: 3_600_001 },
      { waitTimeoutMs: 999 },
      { waitTimeoutMs: 3_600_001 },
      { baseDelayMs: 3_600_001 },
      { maxDelayMs: -1 },
      { enabled: 'yes' },
      { unknown: true },
    ]) {
      expect(() => resolveReviewQueue(bad)).toThrow()
    }
  })
})

describe('retired review queue limits', () => {
  it('accepts a legacy profile and ignores its retired limits at admission', async () => {
    // A profile written before the retirement still sets all three fields; it
    // must load, and admission must not enforce them.
    const legacy = resolveReviewQueue({
      enabled: true,
      concurrency: 1,
      maxQueued: 1,
      waitTimeoutMs: 1_000,
      maxAttempts: 3,
    })
    expect(legacy).toMatchObject({ concurrency: 1, maxQueued: 1, waitTimeoutMs: 1_000 })
    const started: string[] = []
    const queue = new ReviewQueue<{ file: QueueRunFile }>(
      {
        enabled: legacy.enabled,
        maxAttempts: legacy.maxAttempts,
        baseDelayMs: legacy.baseDelayMs,
        maxDelayMs: legacy.maxDelayMs,
        concurrency: legacy.concurrency,
        maxQueued: legacy.maxQueued,
        waitTimeoutMs: legacy.waitTimeoutMs,
      },
      {
        start: async (entry) => {
          started.push(entry.file.id)
        },
        persist: () => undefined,
        fail: async () => undefined,
        settled: () => undefined,
        now: () => new Date(),
      },
    )
    for (const id of ['a', 'b', 'c']) {
      const admission = await queue.submit({
        file: { id, key: id, identity: id, state: 'queued' },
      })
      expect(admission).toEqual({ kind: 'accepted', phase: 'running' })
    }
    // concurrency 1 and maxQueued 1 are not enforced: all three started.
    expect(started).toEqual(['a', 'b', 'c'])
    expect(queue.summary()).toEqual({ enabled: true, active: 3, attempts: 3 })
    queue.dispose()
  })
})

describe('review timeout config', () => {
  it('defaults to 600000 and enforces the bounded range', () => {
    expect(resolveReviewTimeout(undefined)).toBe(DEFAULT_REVIEW_TIMEOUT_MS)
    expect(DEFAULT_REVIEW_TIMEOUT_MS).toBe(600_000)
    expect(resolveReviewTimeout({ review: 1_000 })).toBe(1_000)
    expect(resolveReviewTimeout({ review: 3_600_000 })).toBe(3_600_000)
    expect(() => resolveReviewTimeout({ review: 999 })).toThrow(/between 1000 and 3600000/u)
    expect(() => resolveReviewTimeout({ review: 3_600_001 })).toThrow()
    expect(() => resolveReviewTimeout({ other: 1 })).toThrow(/unknown field/u)
  })
})

describe('nested reviewer options', () => {
  it('rejects an invalid nested agent option value with its full field', () => {
    for (const agentOptions of [
      { model: 42 },
      { reasoningEffort: [] },
      { provider: '' },
      { maxTokens: -1 },
      { maxTokens: 0 },
      { maxTokens: 1.5 },
    ]) {
      expect(() => resolveReviewers({ codex: { provider: 'p', agentOptions } })).toThrow(
        /reviewers\.codex\.agentOptions\./u,
      )
    }
    expect(
      resolveReviewers({ codex: { provider: 'p', agentOptions: { maxTokens: 10 } } }).codex
        ?.agentOptions,
    ).toEqual({ maxTokens: 10 })
  })
})
