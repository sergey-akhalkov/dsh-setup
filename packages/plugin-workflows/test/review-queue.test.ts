import { describe, expect, it } from 'vitest'
import { type QueueLimits, type QueueRun, ReviewQueue } from '../src/host/review-queue.ts'

interface TestRun extends QueueRun {
  readonly label: string
}

function run(label: string): TestRun {
  return {
    label,
    file: {
      id: label,
      key: label,
      identity: label,
      state: 'queued',
    },
  }
}

function limits(overrides: Partial<QueueLimits> = {}): QueueLimits {
  return {
    enabled: true,
    concurrency: 1,
    maxQueued: 4,
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    waitTimeoutMs: 5_000,
    ...overrides,
  }
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
  it('serializes one key at concurrency 1 and releases the next slot', async () => {
    const starts: string[] = []
    const settled: string[] = []
    const queue = new ReviewQueue<TestRun>(limits(), {
      start: async (entry) => {
        starts.push(entry.label)
      },
      persist: () => undefined,
      fail: async () => undefined,
      timeout: async () => undefined,
      settled: (entry) => settled.push(entry.label),
      now: () => new Date(),
    })
    const first = run('a')
    const second = run('b')
    expect((await queue.submit(first)).kind).toBe('accepted')
    expect((await queue.submit(second)).kind).toBe('accepted')
    expect(queue.summary()).toMatchObject({ active: 1, queued: 1 })
    await waitFor(() => starts.includes('a'))
    expect(starts).toEqual(['a'])
    await queue.complete(first, 'completed')
    await waitFor(() => starts.includes('b'))
    expect(starts).toEqual(['a', 'b'])
    expect(settled).toEqual(['a'])
    await queue.complete(second, 'completed')
    expect(queue.summary()).toMatchObject({ active: 0, queued: 0 })
    queue.dispose()
  })

  it('reports full when the waiting cap is reached', async () => {
    const queue = new ReviewQueue<TestRun>(limits({ maxQueued: 0 }), {
      start: async () => undefined,
      persist: () => undefined,
      fail: async () => undefined,
      timeout: async () => undefined,
      settled: () => undefined,
      now: () => new Date(),
    })
    const first = run('a')
    await queue.submit(first)
    const admission = await queue.submit(run('b'))
    expect(admission.kind).toBe('full')
    queue.dispose()
  })

  it('times out a queued run after the wait deadline', async () => {
    const timedOut: string[] = []
    const queue = new ReviewQueue<TestRun>(limits({ waitTimeoutMs: 20 }), {
      start: async () => undefined,
      persist: () => undefined,
      fail: async () => undefined,
      timeout: async (entry) => {
        timedOut.push(entry.label)
      },
      settled: () => undefined,
      now: () => new Date(),
    })
    const first = run('a')
    await queue.submit(first)
    await queue.submit(run('b'))
    await waitFor(() => timedOut.length === 1)
    expect(timedOut).toEqual(['b'])
    queue.dispose()
  })
})
