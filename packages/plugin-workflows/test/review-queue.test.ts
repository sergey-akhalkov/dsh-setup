import { describe, expect, it } from 'vitest'
import {
  type QueueLimits,
  type QueueRun,
  ReviewQueue,
  retryDelayMs,
} from '../src/host/review-queue.ts'

interface TestRun extends QueueRun {
  readonly label: string
}

function run(label: string, key = label, identity = label): TestRun {
  return {
    label,
    file: {
      id: label,
      key,
      identity,
      state: 'queued',
    },
  }
}

/**
 * The retired `concurrency`, `maxQueued`, and `waitTimeoutMs` values stay in
 * the fixture on purpose: they are accepted and ignored.
 */
function limits(overrides: Partial<QueueLimits> = {}): QueueLimits {
  return {
    enabled: true,
    concurrency: 1,
    maxQueued: 1,
    waitTimeoutMs: 20,
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    ...overrides,
  }
}

interface Hooks {
  started: string[]
  failed: string[]
  settled: string[]
  start?: (entry: TestRun) => Promise<void>
}

function hooks(): Hooks {
  return { started: [], failed: [], settled: [] }
}

function queueFor(state: Hooks, overrides: Partial<QueueLimits> = {}): ReviewQueue<TestRun> {
  return new ReviewQueue<TestRun>(limits(overrides), {
    start: async (entry) => {
      state.started.push(entry.label)
      await state.start?.(entry)
    },
    persist: () => undefined,
    fail: async (entry) => {
      state.failed.push(entry.label)
    },
    settled: (entry) => state.settled.push(entry.label),
    now: () => new Date(),
  })
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition did not settle in time')
}

describe('review queue admission', () => {
  it('starts many distinct identities together with no queue position', async () => {
    const state = hooks()
    const queue = queueFor(state)
    const pending = Array.from({ length: 20 }, (_, index) => run(`run-${String(index)}`))
    for (const entry of pending) {
      expect(await queue.submit(entry)).toEqual({ kind: 'accepted', phase: 'running' })
      expect('queuePosition' in entry.file).toBe(false)
      expect('waitMs' in entry.file).toBe(false)
    }
    expect(state.started).toHaveLength(20)
    expect(queue.summary()).toEqual({ enabled: true, active: 20, attempts: 20 })
    queue.dispose()
  })

  it('serializes one shared conversation key and starts its follower when it settles', async () => {
    const state = hooks()
    const queue = queueFor(state)
    const first = run('a', 'unit')
    const second = run('b', 'unit')
    expect((await queue.submit(first)).kind).toBe('accepted')
    expect(await queue.submit(second)).toEqual({ kind: 'accepted', phase: 'queued' })
    expect(state.started).toEqual(['a'])
    expect(queue.summary()).toMatchObject({ active: 1 })
    await queue.complete(first, 'completed')
    await waitFor(() => state.started.includes('b'))
    expect(state.started).toEqual(['a', 'b'])
    expect(state.settled).toEqual(['a'])
    await queue.complete(second, 'completed')
    expect(queue.summary()).toEqual({ enabled: true, active: 0, attempts: 0 })
    queue.dispose()
  })

  it('dedupes a live identity and admits a changed identity as a distinct run', async () => {
    const state = hooks()
    const queue = queueFor(state)
    const first = run('a', 'unit', 'identity-a')
    expect((await queue.submit(first)).kind).toBe('accepted')
    expect(await queue.submit(run('duplicate', 'unit', 'identity-a'))).toEqual({
      kind: 'duplicate',
      run: first,
    })
    const changed = run('changed', 'unit', 'identity-b')
    expect(await queue.submit(changed)).toEqual({ kind: 'accepted', phase: 'queued' })
    expect(state.started).toEqual(['a'])
    await queue.complete(first, 'completed')
    await waitFor(() => state.started.includes('changed'))
    queue.dispose()
  })

  it('never times out a follower waiting on a shared key', async () => {
    const state = hooks()
    const queue = queueFor(state, { waitTimeoutMs: 10 })
    const first = run('a', 'unit')
    const second = run('b', 'unit')
    await queue.submit(first)
    await queue.submit(second)
    await new Promise((resolve) => setTimeout(resolve, 60))
    // The retired wait timeout has no effect: no failure, no start.
    expect(state.started).toEqual(['a'])
    expect(state.failed).toEqual([])
    await queue.complete(first, 'completed')
    await waitFor(() => state.started.includes('b'))
    expect(state.started).toEqual(['a', 'b'])
    queue.dispose()
  })

  it('retries a transient start failure with backoff and starts one reviewer', async () => {
    const state = hooks()
    let calls = 0
    state.start = async () => {
      calls += 1
      if (calls === 1) throw new Error('active child limit reached')
    }
    const queue = queueFor(state, { maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 10 })
    const entry = run('a')
    expect((await queue.submit(entry)).kind).toBe('accepted')
    await waitFor(() => state.started.length === 2 && calls === 2)
    expect(state.failed).toEqual([])
    expect(queue.attemptsOf('a')).toBe(2)
    queue.dispose()
  })

  it('settles the identity once when the retry budget is exhausted', async () => {
    const state = hooks()
    const queue = queueFor(state, { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 })
    state.start = async () => {
      throw new Error('active child limit reached')
    }
    await queue.submit(run('a'))
    await waitFor(() => state.failed.length === 1)
    expect(state.started).toEqual(['a'])
    expect(state.failed).toEqual(['a'])
    expect(state.settled).toEqual(['a'])
    queue.dispose()
  })
})

describe('review queue retry backoff', () => {
  it('backs off exponentially with a cap and honors retry-after', () => {
    const limits = {
      enabled: true,
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    }
    expect(retryDelayMs(1, limits, undefined, () => 1)).toBe(100)
    expect(retryDelayMs(1, limits, undefined, () => 0)).toBe(50)
    expect(retryDelayMs(2, limits, undefined, () => 1)).toBe(200)
    expect(retryDelayMs(3, limits, undefined, () => 1)).toBe(400)
    expect(retryDelayMs(10, limits, undefined, () => 1)).toBe(1000)
    expect(retryDelayMs(1, limits, 700, () => 0)).toBe(700)
    expect(retryDelayMs(1, limits, 5000, () => 1)).toBe(1000)
  })
})
