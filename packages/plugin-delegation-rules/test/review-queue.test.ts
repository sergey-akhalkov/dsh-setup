import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { specDigest } from '../src/host/index.js'
import {
  classifyFailure,
  type QueueRun,
  ReviewQueue,
  retryDelayMs,
} from '../src/host/review-queue.js'
import {
  type BundleConfigLike,
  defaultTestConfig,
  FakeGit,
  FakeSubagents,
  Harness,
  makeWorkspace,
  passResponder,
  type RunRecord,
  runIdFrom,
  taskIdFor,
  writeChange,
} from './helpers.js'

interface Workspace {
  root: string
  cleanup: () => Promise<void>
}

/** Captured before any fake timers: lets a test flush real I/O after advancing. */
const realSetTimeout = globalThis.setTimeout

function deferred() {
  const releases: Array<() => void> = []
  return {
    responder: (run: RunRecord): Promise<ReturnType<typeof passResponder>> =>
      new Promise((resolve) => {
        releases.push(() => resolve(passResponder(run)))
      }),
    releases,
  }
}

async function harnessFor(
  root: string,
  config: BundleConfigLike,
  agents: FakeSubagents,
  git?: FakeGit,
): Promise<Harness> {
  return new Harness({ cwd: root, config, agents, ...(git === undefined ? {} : { git }) })
}

async function readRun(root: string, runId: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(root, '.dsh', 'delegation', 'runs', `${runId}.json`), 'utf8'),
  ) as Record<string, unknown>
}

const roots: Array<Workspace> = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((workspace) => workspace.cleanup()))
})

async function workspace(): Promise<string> {
  const created = await makeWorkspace()
  roots.push(created)
  return created.root
}

function fakeRun(id: string, key: string, identity: string): QueueRun {
  return { file: { id, key, identity, state: 'queued' } }
}

function taskReviewConfig(reviewQueue?: BundleConfigLike['reviewQueue']): BundleConfigLike {
  return {
    targets: { codex: { provider: 'codex-subagent' } },
    rules: [
      {
        id: 'task-review',
        when: 'spec-task-ready',
        to: 'codex',
        contract: 'review',
        scope: 'task',
        gate: 'strict',
        instruction: 'bundled:review-task',
      },
    ],
    ...(reviewQueue === undefined ? {} : { reviewQueue }),
  }
}

describe('review queue admission', () => {
  it('admits up to the concurrency limit and promotes queued runs in FIFO order', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    await writeChange(root, 'change-c', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = await harnessFor(
      root,
      { ...defaultTestConfig(), reviewQueue: { concurrency: 1 } },
      subagents,
    )

    const first = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    const firstRun = runIdFrom(first)
    const second = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-b' })
    const secondRun = runIdFrom(second)
    const third = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-c' })
    const thirdRun = runIdFrom(third)

    expect(first).toContain('review started')
    expect(second).toContain('review queued')
    expect(second).toContain('queue position: 1')
    expect(third).toContain('queue position: 2')
    expect(subagents.startCalls).toBe(1)

    pending.releases.shift()?.()
    expect(await harness.waitForRun(firstRun)).toContain('state=completed')
    await subagents.waitForStarts(2)
    await vi.waitFor(async () => {
      expect((await readRun(root, secondRun)).state).toBe('running')
    })
    expect((await readRun(root, thirdRun)).state).toBe('queued')
    expect((await readRun(root, thirdRun)).queuePosition).toBe(1)

    pending.releases.shift()?.()
    expect(await harness.waitForRun(secondRun)).toContain('state=completed')
    await subagents.waitForStarts(3)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(thirdRun)).toContain('state=completed')
    expect(subagents.startCalls).toBe(3)
  })

  it('counts per-key followers against maxQueued and refuses further admission', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
    await writeChange(root, 'change-b', [{ number: '1.1', text: 'Second task', checked: true }])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = await harnessFor(
      root,
      {
        ...defaultTestConfig(),
        reviewQueue: { concurrency: 1, maxQueued: 1 },
        rules: [
          {
            id: 'task-review',
            when: 'spec-task-ready',
            to: 'codex',
            contract: 'review',
            scope: 'task',
            gate: 'strict',
            instruction: 'bundled:review-task',
          },
          {
            id: 'task-review-extra',
            when: 'spec-task-ready',
            to: 'codex',
            contract: 'review',
            scope: 'task',
            gate: 'soft',
            instruction: 'bundled:review-task',
          },
        ],
      },
      subagents,
    )

    const first = await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' })
    const firstRun = runIdFrom(first)
    const taskId = /task id: ([0-9a-f]{16})/.exec(first)?.[1] as string
    const follower = await harness.toolText('delegate', {
      rule: 'task-review-extra',
      change: 'change-a',
      task: taskId,
    })
    const followerRun = runIdFrom(follower)
    expect(follower).toContain('review queued')
    expect(follower).toContain('queue position: 1')

    await expect(
      harness.callTool('delegate', { rule: 'task-review', change: 'change-b' }),
    ).rejects.toThrow(/review queue full: 1 waiting run\(s\) at maxQueued=1/)

    pending.releases.shift()?.()
    expect(await harness.waitForRun(firstRun)).toContain('state=completed')
    await subagents.waitForStarts(2)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(followerRun)).toContain('state=completed')
  })

  it('settles a wait timeout asynchronously with an ERROR and starts no target', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = await harnessFor(
      root,
      {
        ...defaultTestConfig(),
        reviewQueue: { concurrency: 1, waitTimeoutMs: 30 },
      },
      subagents,
    )

    const firstRun = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    const timed = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-b' })
    const timedRun = runIdFrom(timed)
    expect(timed).toContain('review queued')

    expect(await harness.waitForRun(timedRun)).toContain('state=failed')
    expect(subagents.startCalls).toBe(1)
    const run = await readRun(root, timedRun)
    expect(run.failureClass).toBe('queue-timeout')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-b', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('review queue wait timed out')
    expect(record.error).toContain('no target started')
    const status = await harness.toolText('delegation_status', {})
    expect(status).toMatch(new RegExp(`run ${timedRun}: .*state=failed`))

    pending.releases.shift()?.()
    expect(await harness.waitForRun(firstRun)).toContain('state=completed')
  })

  it('returns a running handle for a free slot and a positioned queued handle otherwise', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = await harnessFor(
      root,
      { ...defaultTestConfig(), reviewQueue: { concurrency: 1 } },
      subagents,
    )

    const running = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    expect(running).toContain('review started')
    expect(running).toContain('state: running')
    expect(running).toMatch(/^run: \S+$/m)
    expect(running).toContain('record: .dsh/delegation/spec-review/change-a/spec.json')

    const queued = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-b' })
    expect(queued).toContain('review queued')
    expect(queued).toContain('state: queued')
    expect(queued).toMatch(/^queue position: 1$/m)

    const duplicate = await harness.toolText('delegate', {
      rule: 'spec-review',
      change: 'change-b',
    })
    expect(duplicate).toContain('review already pending')
    expect(duplicate).toContain('state: queued')
    expect(duplicate).toMatch(/^queue position: 1$/m)

    pending.releases.shift()?.()
    await harness.waitForRun(runIdFrom(running))
    await subagents.waitForStarts(2)
    pending.releases.shift()?.()
    await harness.waitForRun(runIdFrom(queued))
  })

  it('returns a settled handle when a duplicate joins an in-flight start', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const originalStart = subagents.startActivation.bind(subagents)
    let releaseStart: () => void = () => undefined
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    let enteredStart: () => void = () => undefined
    const firstStarted = new Promise<void>((resolve) => {
      enteredStart = resolve
    })
    let holding = false
    subagents.startActivation = async (spec) => {
      if (!holding) {
        holding = true
        enteredStart()
        await startGate
      }
      return originalStart(spec)
    }
    const harness = await harnessFor(root, defaultTestConfig(), subagents)

    const firstCall = harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    await firstStarted
    const duplicateCall = harness.toolText('delegate', {
      rule: 'spec-review',
      change: 'change-a',
    })
    releaseStart()
    const first = await firstCall
    const duplicate = await duplicateCall
    expect(first).toContain('review started')
    expect(duplicate).toContain('review already pending')
    expect(duplicate).toContain('state: running')
    expect(duplicate).not.toContain('state: starting')
    expect(subagents.startCalls).toBe(1)

    pending.releases.shift()?.()
    expect(await harness.waitForRun(runIdFrom(first))).toContain('state=completed')
  })

  it('does not serialize independent admissions behind a pending target start', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    await writeChange(root, 'change-c', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const originalStart = subagents.startActivation.bind(subagents)
    let releaseStart: () => void = () => undefined
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    let holding = false
    let enteredStart: () => void = () => undefined
    const firstStarted = new Promise<void>((resolve) => {
      enteredStart = resolve
    })
    subagents.startActivation = async (spec) => {
      if (!holding) {
        holding = true
        enteredStart()
        await startGate
      }
      return originalStart(spec)
    }
    const harness = await harnessFor(
      root,
      {
        ...defaultTestConfig(),
        reviewQueue: { concurrency: 2, waitTimeoutMs: 60 },
      },
      subagents,
    )

    const firstCall = harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    await firstStarted
    const second = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-b' })
    expect(second).toContain('review started')
    const third = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-c' })
    const thirdRun = runIdFrom(third)
    expect(third).toContain('review queued')
    expect(third).toContain('queue position: 1')

    // The queued handle arrived and its timeout settles while A's start is still
    // held open: no unrelated start may block admission or the wait timeout.
    expect(await harness.waitForRun(thirdRun)).toContain('state=failed')
    expect(subagents.startCalls).toBe(1)

    releaseStart()
    const first = await firstCall
    expect(first).toContain('review started')
    const firstRun = runIdFrom(first)
    const secondRun = runIdFrom(second)
    await subagents.waitForStarts(2)
    pending.releases.shift()?.()
    pending.releases.shift()?.()
    expect(await harness.waitForRun(firstRun)).toContain('state=completed')
    expect(await harness.waitForRun(secondRun)).toContain('state=completed')
  })

  it('removes a queued task-review snapshot when its wait times out', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [
      { number: '1.1', text: 'First task', checked: true },
      { number: '1.2', text: 'Second task', checked: true },
    ])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const git = new FakeGit()
    git.files = ['src/engine.ts']
    const harness = await harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent' } },
        rules: [
          {
            id: 'task-review',
            when: 'spec-task-ready',
            to: 'codex',
            contract: 'review',
            scope: 'task',
            gate: 'strict',
            instruction: 'bundled:review-task',
          },
        ],
        reviewQueue: { concurrency: 1, waitTimeoutMs: 40 },
      },
      subagents,
      git,
    )

    const first = await harness.startReview({
      rule: 'task-review',
      change: 'change-a',
      task: taskIdFor('First task'),
    })
    const queued = await harness.startReview({
      rule: 'task-review',
      change: 'change-a',
      task: taskIdFor('Second task'),
    })
    expect(await harness.waitForRun(queued)).toContain('state=failed')
    const snapshots = join(root, '.dsh', 'delegation', 'snapshots')
    const entries = await readdir(snapshots)
    expect(entries).not.toContain(queued)
    expect(entries).toContain(first)

    pending.releases.shift()?.()
    expect(await harness.waitForRun(first)).toContain('state=completed')
    expect(await readdir(snapshots)).toEqual([])
  })

  it('admits an independent run into a free slot even when the waiting list is full', async () => {
    const internalFault = vi.fn(async (run: QueueRun) => {
      run.file.failureClass = 'queue-internal-error'
    })
    const hooks = {
      start: vi.fn(async () => undefined),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      internalFault,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 2,
        maxQueued: 1,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    expect(await queue.submit(fakeRun('run-a1', 'key-a', 'identity-a1'))).toEqual({
      kind: 'accepted',
      phase: 'running',
    })
    expect(await queue.submit(fakeRun('run-a2', 'key-a', 'identity-a2'))).toEqual({
      kind: 'accepted',
      phase: 'queued',
    })
    // Two slots, one running: an independent key may use the free slot even
    // though the one-entry waiting list already holds A2.
    expect(await queue.submit(fakeRun('run-b', 'key-b', 'identity-b'))).toEqual({
      kind: 'accepted',
      phase: 'running',
    })
    expect(await queue.submit(fakeRun('run-c', 'key-c', 'identity-c'))).toEqual({
      kind: 'full',
      depth: 1,
      maxQueued: 1,
    })
    queue.dispose()
  })

  it('settles a retry that cannot re-enter the full waiting list', async () => {
    let firstStart = true
    const hooks = {
      start: vi.fn(async (run: QueueRun) => {
        if (run.file.id === 'run-a' && firstStart) {
          firstStart = false
          throw new Error('subagent limit reached (active child limit: 8)')
        }
      }),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 1,
        maxAttempts: 3,
        baseDelayMs: 5,
        maxDelayMs: 10,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    const retrying = fakeRun('run-a', 'key-a', 'identity-a')
    expect(await queue.submit(retrying)).toEqual({ kind: 'accepted', phase: 'retry-wait' })
    expect(await queue.submit(fakeRun('run-b', 'key-b', 'identity-b'))).toEqual({
      kind: 'accepted',
      phase: 'running',
    })
    const waiting = fakeRun('run-c', 'key-c', 'identity-c')
    expect(await queue.submit(waiting)).toEqual({ kind: 'accepted', phase: 'queued' })

    await vi.waitFor(() => {
      expect(hooks.settled).toHaveBeenCalledWith(retrying, 'failed')
    })
    expect(hooks.fail).toHaveBeenCalledWith(retrying, expect.any(Error), 'queue-timeout')
    expect(queue.summary().queued).toBe(1)
    expect(waiting.file.queuePosition).toBe(1)
    queue.dispose()
  })

  it('enforces the acceptance wait deadline during retry backoff', async () => {
    let firstStart = true
    const hooks = {
      start: vi.fn(async (run: QueueRun) => {
        if (run.file.id === 'run-a' && firstStart) {
          firstStart = false
          throw new Error('subagent limit reached (active child limit: 8)')
        }
      }),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 3,
        maxAttempts: 3,
        baseDelayMs: 200,
        maxDelayMs: 200,
        waitTimeoutMs: 50,
      },
      hooks,
    )
    const retrying = fakeRun('run-a', 'key-a', 'identity-a')
    expect(await queue.submit(retrying)).toEqual({ kind: 'accepted', phase: 'retry-wait' })
    expect(await queue.submit(fakeRun('run-b', 'key-b', 'identity-b'))).toEqual({
      kind: 'accepted',
      phase: 'running',
    })

    // The backoff (100-200 ms) outlives the 50 ms acceptance deadline, so the
    // run must settle instead of re-entering the queue and starting late.
    await vi.waitFor(
      () => {
        expect(hooks.settled).toHaveBeenCalledWith(retrying, 'failed')
      },
      { timeout: 2_000 },
    )
    const aStarts = hooks.start.mock.calls.filter(
      (call: unknown[]) => (call[0] as QueueRun).file.id === 'run-a',
    )
    expect(aStarts).toHaveLength(1)
    expect(hooks.timeout).toHaveBeenCalledWith(retrying, { waitMs: expect.any(Number) })
    expect(hooks.fail).not.toHaveBeenCalled()
    expect(queue.owns('run-a')).toBe(false)
    expect(queue.summary().queued).toBe(0)
    queue.dispose()
  })

  it('settles an expired waiting run when a slot frees before its timer callback', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z')
    const hooks = {
      start: vi.fn(async () => undefined),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      now: () => clock,
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 2,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    const running = fakeRun('run-a', 'key-a', 'identity-a')
    expect(await queue.submit(running)).toEqual({ kind: 'accepted', phase: 'running' })
    const waiting = fakeRun('run-b', 'key-b', 'identity-b')
    expect(await queue.submit(waiting)).toEqual({ kind: 'accepted', phase: 'queued' })

    // Move the clock past the acceptance deadline without dispatching timers,
    // then free the slot: the queued run must settle instead of starting late.
    clock = new Date(clock.getTime() + 400_000)
    await queue.complete(running, 'completed')
    await vi.waitFor(() => {
      expect(hooks.settled).toHaveBeenCalledWith(waiting, 'failed')
    })
    expect(hooks.timeout).toHaveBeenCalledWith(waiting, { position: 1, waitMs: 400_000 })
    const started = hooks.start.mock.calls.filter(
      (call: unknown[]) => (call[0] as QueueRun).file.id === 'run-b',
    )
    expect(started).toHaveLength(0)
    expect(queue.owns('run-b')).toBe(false)
    queue.dispose()
  })

  it('enforces the acceptance deadline when a slow start fails after it', async () => {
    let clock = new Date('2026-01-01T00:00:00.000Z')
    let releaseStart: (error: Error) => void = () => undefined
    const startGate = new Promise<Error>((resolve) => {
      releaseStart = resolve
    })
    const hooks = {
      start: vi.fn(async (run: QueueRun) => {
        if (run.file.id === 'run-a') throw await startGate
      }),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      now: () => clock,
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 2,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 20,
      },
      hooks,
    )
    const delayed = fakeRun('run-a', 'key-a', 'identity-a')
    const submitting = queue.submit(delayed)
    await vi.waitFor(() => {
      expect(hooks.start).toHaveBeenCalledWith(delayed)
    })

    clock = new Date(clock.getTime() + 100)
    releaseStart(new Error('subagent limit reached (active child limit: 8)'))
    expect(await submitting).toEqual({ kind: 'settled' })
    expect(hooks.timeout).toHaveBeenCalledWith(delayed, { waitMs: expect.any(Number) })
    expect(hooks.settled).toHaveBeenCalledWith(delayed, 'failed')
    expect(hooks.fail).not.toHaveBeenCalled()
    expect(queue.owns('run-a')).toBe(false)
    queue.dispose()
  })

  it('settles a wait timeout exactly once when the timer dispatch races the slot release', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
      let releaseTimeout: () => void = () => undefined
      const timeoutGate = new Promise<void>((resolve) => {
        releaseTimeout = resolve
      })
      const hooks = {
        start: vi.fn(async () => undefined),
        persist: vi.fn(),
        fail: vi.fn(async () => undefined),
        timeout: vi.fn(async () => {
          await timeoutGate
        }),
        settled: vi.fn(),
        now: () => new Date(),
      }
      const queue = new ReviewQueue<QueueRun>(
        {
          enabled: true,
          concurrency: 1,
          maxQueued: 2,
          maxAttempts: 3,
          baseDelayMs: 5_000,
          maxDelayMs: 60_000,
          waitTimeoutMs: 20,
        },
        hooks,
      )
      const running = fakeRun('run-a', 'key-a', 'identity-a')
      expect(await queue.submit(running)).toEqual({ kind: 'accepted', phase: 'running' })
      const waiting = fakeRun('run-b', 'key-b', 'identity-b')
      expect(await queue.submit(waiting)).toEqual({ kind: 'accepted', phase: 'queued' })

      // The slot frees after the deadline but before the timer dispatch: the
      // pump starts the timeout settlement while the original timer is armed.
      vi.setSystemTime(new Date('2026-01-01T00:00:00.100Z'))
      await queue.complete(running, 'completed')
      expect(hooks.timeout).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(20)
      expect(hooks.timeout).toHaveBeenCalledTimes(1)

      releaseTimeout()
      await vi.runAllTimersAsync()
      expect(hooks.timeout).toHaveBeenCalledTimes(1)
      const settledRunB = hooks.settled.mock.calls.filter(
        (call: unknown[]) => (call[0] as QueueRun).file.id === 'run-b',
      )
      expect(settledRunB).toEqual([[waiting, 'failed']])
      expect(queue.owns('run-b')).toBe(false)
      queue.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not discard a queued run whose predecessor publishes while it waits', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await writeChange(root, 'change-b', [{ number: '1.1', text: 'Holds the slot', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const git = new FakeGit()
    git.files = ['src/engine.ts']
    const harness = await harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent' } },
        rules: [
          {
            id: 'task-review',
            when: 'spec-task-ready',
            to: 'codex',
            contract: 'review',
            scope: 'task',
            gate: 'strict',
            instruction: 'bundled:review-task',
          },
        ],
        reviewQueue: { concurrency: 1 },
      },
      subagents,
      git,
    )
    const reviewedTask = taskIdFor('Reviewed task')

    // One live-slot holder keeps the queue occupied while both D snapshots prepare.
    const holder = await harness.startReview({
      rule: 'task-review',
      change: 'change-b',
      task: taskIdFor('Holds the slot'),
    })
    const predecessor = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task: reviewedTask,
    })
    const predecessorRun = runIdFrom(predecessor)
    expect(predecessor).toContain('review queued')

    // A new frozen tree makes the successor's digest distinct from D1.
    git.status = 'M src/engine.ts'
    const successor = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task: reviewedTask,
    })
    const successorRun = runIdFrom(successor)
    expect(successorRun).not.toBe(predecessorRun)
    expect(successor).toContain('review queued')

    pending.releases.shift()?.()
    expect(await harness.waitForRun(holder)).toContain('state=completed')
    await subagents.waitForStarts(2)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(predecessorRun)).toContain('state=completed')
    const recordPath = join(
      root,
      '.dsh',
      'delegation',
      'task-review',
      'change-a',
      'tasks',
      `${reviewedTask}.json`,
    )
    const first = JSON.parse(await readFile(recordPath, 'utf8')) as {
      runId: string
      digest: string
      verdict: string
    }
    expect(first.runId).toBe(predecessorRun)
    expect(first.verdict).toBe('PASS')

    await subagents.waitForStarts(3)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(successorRun)).toContain('state=completed')
    const second = JSON.parse(await readFile(recordPath, 'utf8')) as {
      runId: string
      digest: string
      verdict: string
    }
    expect(second.runId).toBe(successorRun)
    expect(second.digest).not.toBe(first.digest)
    expect(second.verdict).toBe('PASS')
  })

  it('re-prepares a queued run when its reviewed inputs change', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = await harnessFor(
      root,
      { ...defaultTestConfig(), reviewQueue: { concurrency: 1 } },
      subagents,
    )

    const holder = await harness.startReview({ rule: 'spec-review', change: 'change-b' })
    const queued = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    const queuedRun = runIdFrom(queued)
    expect(queued).toContain('review queued')

    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'proposal.md'),
      '# Proposal\n\nChanged while queued.\n',
      'utf8',
    )

    pending.releases.shift()?.()
    expect(await harness.waitForRun(holder)).toContain('state=completed')
    await subagents.waitForStarts(2)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(queuedRun)).toContain('state=completed')

    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { digest: string; verdict: string }
    expect(record.verdict).toBe('PASS')
    expect(record.digest).toBe(await specDigest(join(root, 'openspec', 'changes', 'change-a')))
  })

  it('settles a re-preparing queued head discarded when a successor holds the new identity', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = await harnessFor(
      root,
      { ...defaultTestConfig(), reviewQueue: { concurrency: 1 } },
      subagents,
    )

    const holder = await harness.startReview({ rule: 'spec-review', change: 'change-b' })
    const predecessor = await harness.toolText('delegate', {
      rule: 'spec-review',
      change: 'change-a',
    })
    const predecessorRun = runIdFrom(predecessor)
    expect(predecessor).toContain('review queued')

    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'proposal.md'),
      '# Proposal\n\nNew digest.\n',
      'utf8',
    )
    const successor = await harness.toolText('delegate', {
      rule: 'spec-review',
      change: 'change-a',
    })
    const successorRun = runIdFrom(successor)
    expect(successorRun).not.toBe(predecessorRun)
    expect(successor).toContain('review queued')

    pending.releases.shift()?.()
    expect(await harness.waitForRun(holder)).toContain('state=completed')
    expect(await harness.waitForRun(predecessorRun)).toContain('state=discarded')
    const predecessorFile = await readRun(root, predecessorRun)
    expect(String(predecessorFile.detail)).toContain(`duplicate of run ${successorRun}`)

    await subagents.waitForStarts(2)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(successorRun)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { digest: string; runId: string }
    expect(record.runId).toBe(successorRun)
    const startedForDigest = subagents.runs.filter((run) => run.prompt.includes(record.digest))
    expect(startedForDigest).toHaveLength(1)
  })

  it('starts an unchanged queued run without a re-preparation', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = await harnessFor(
      root,
      { ...defaultTestConfig(), reviewQueue: { concurrency: 1 } },
      subagents,
    )

    const holder = await harness.startReview({ rule: 'spec-review', change: 'change-b' })
    const queued = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    const queuedRun = runIdFrom(queued)
    expect(queued).toContain('review queued')

    pending.releases.shift()?.()
    expect(await harness.waitForRun(holder)).toContain('state=completed')
    await subagents.waitForStarts(2)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(queuedRun)).toContain('state=completed')

    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { digest: string }
    expect(record.digest).toBe(await specDigest(join(root, 'openspec', 'changes', 'change-a')))
    expect(subagents.startCalls).toBe(2)
  })

  it('re-prepares a queued frozen snapshot when the source changes during preparation', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
    await writeChange(root, 'change-b', [{ number: '1.1', text: 'Shared task', checked: true }])
    await writeChange(root, 'change-c', [{ number: '1.1', text: 'Holds the slot', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'one\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const git = new FakeGit()
    git.files = ['src/engine.ts']
    const harness = await harnessFor(root, taskReviewConfig({ concurrency: 1 }), subagents, git)
    const task = taskIdFor('Shared task')
    const recordFor = async (change: string) =>
      JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'task-review', change, 'tasks', `${task}.json`),
          'utf8',
        ),
      ) as { digest: string; verdict: string }

    // Control: a review prepared entirely in the final state.
    git.status = 'M src/engine.ts'
    await writeFile(join(root, 'src', 'engine.ts'), 'two\n', 'utf8')
    const controlRun = await harness.startReview({ rule: 'task-review', change: 'change-b', task })
    pending.releases.shift()?.()
    expect(await harness.waitForRun(controlRun)).toContain('state=completed')
    const control = await recordFor('change-b')

    // Scenario: reset, then mutate after the snapshot tree was written but
    // before preparation returned, so a late signature read would look stable.
    git.status = ''
    await writeFile(join(root, 'src', 'engine.ts'), 'one\n', 'utf8')
    const holder = await harness.startReview({
      rule: 'task-review',
      change: 'change-c',
      task: taskIdFor('Holds the slot'),
    })
    let mutated = false
    git.beforeReturn = async (args) => {
      if (mutated || args[0] !== 'worktree' || args[1] !== 'add') return
      mutated = true
      git.status = 'M src/engine.ts'
      await writeFile(join(root, 'src', 'engine.ts'), 'two\n', 'utf8')
    }
    const queued = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task,
    })
    const queuedRun = runIdFrom(queued)
    expect(queued).toContain('review queued')

    pending.releases.shift()?.()
    expect(await harness.waitForRun(holder)).toContain('state=completed')
    await subagents.waitForStarts(3)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(queuedRun)).toContain('state=completed')
    const record = await recordFor('change-a')
    expect(record.verdict).toBe('PASS')
    expect(record.digest).toBe(control.digest)
  })

  it('fails a queued live-fallback review when its task is unchecked while waiting', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Queued task', checked: true }])
    await writeChange(root, 'change-b', [{ number: '1.1', text: 'Holds the slot', checked: true }])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const git = new FakeGit()
    git.failSnapshot = true
    const harness = await harnessFor(root, taskReviewConfig({ concurrency: 1 }), subagents, git)
    const queuedTask = taskIdFor('Queued task')

    const holder = await harness.startReview({
      rule: 'task-review',
      change: 'change-b',
      task: taskIdFor('Holds the slot'),
    })
    const queued = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task: queuedTask,
    })
    const queuedRun = runIdFrom(queued)
    expect(queued).toContain('review queued')

    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 Queued task\n',
      'utf8',
    )
    pending.releases.shift()?.()
    expect(await harness.waitForRun(holder)).toContain('state=completed')
    expect(await harness.waitForRun(queuedRun)).toContain('state=failed')

    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks', `${queuedTask}.json`),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('no longer a checked task')
    expect(subagents.startCalls).toBe(1)
  })

  it('re-checks the source inputs before a retry start', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    subagents.startError = new Error('subagent limit reached (active child limit: 8)')
    const harness = await harnessFor(
      root,
      {
        ...defaultTestConfig(),
        reviewQueue: { concurrency: 1, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 200 },
      },
      subagents,
    )

    const handle = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    const runId = runIdFrom(handle)
    expect(handle).toContain('review retrying')
    expect(handle).toContain('failure class: child-limit')

    subagents.startError = undefined
    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'proposal.md'),
      '# Proposal\n\nChanged during retry wait.\n',
      'utf8',
    )

    expect(await harness.waitForRun(runId)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { digest: string; verdict: string }
    expect(record.verdict).toBe('PASS')
    expect(record.digest).toBe(await specDigest(join(root, 'openspec', 'changes', 'change-a')))
    expect((await readRun(root, runId)).attempts).toBe(2)
  })

  it('settles ERROR when inputs change again after the one re-preparation', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const originalStart = subagents.startActivation.bind(subagents)
    let attempts = 0
    subagents.startActivation = async (spec) => {
      attempts += 1
      if (attempts <= 2) throw new Error('subagent limit reached (active child limit: 8)')
      return originalStart(spec)
    }
    const harness = await harnessFor(
      root,
      {
        ...defaultTestConfig(),
        reviewQueue: { concurrency: 1, maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 200 },
      },
      subagents,
    )
    const handle = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    const runId = runIdFrom(handle)
    expect(handle).toContain('review retrying')

    // D1 -> D2: the retry re-prepares once, then its own start fails again.
    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'proposal.md'),
      '# Proposal\n\nD2.\n',
      'utf8',
    )
    await vi.waitFor(
      async () => {
        expect((await readRun(root, runId)).attempts).toBe(2)
      },
      { timeout: 5_000 },
    )

    // D2 -> D3 while the retried run waits again: the one re-prepare is spent.
    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'proposal.md'),
      '# Proposal\n\nD3.\n',
      'utf8',
    )
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('re-prepares only once')
    expect(attempts).toBe(2)
  })
})

describe('review queue identity', () => {
  function hooksFor() {
    return {
      start: vi.fn(async () => undefined),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }
  }

  it('runs two independent keys up to the concurrency limit', async () => {
    const hooks = hooksFor()
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 2,
        maxQueued: 2,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    expect(await queue.submit(fakeRun('run-a', 'key-a', 'identity-a'))).toMatchObject({
      phase: 'running',
    })
    expect(await queue.submit(fakeRun('run-b', 'key-b', 'identity-b'))).toMatchObject({
      phase: 'running',
    })
    expect(hooks.start).toHaveBeenCalledTimes(2)
    expect(queue.summary()).toMatchObject({ active: 2, queued: 0 })
    queue.dispose()
  })

  it('settles a re-preparation collision as discarded and promotes its follower', async () => {
    const hooks = hooksFor()
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 3,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    const occupying = fakeRun('run-x', 'key-x', 'identity-x')
    expect(await queue.submit(occupying)).toEqual({ kind: 'accepted', phase: 'running' })
    // One key: a D1 head with a D2 follower.
    const reprepared = fakeRun('run-a', 'key-k', 'identity-d1')
    const incumbent = fakeRun('run-b', 'key-k', 'identity-d2')
    expect(await queue.submit(reprepared)).toEqual({ kind: 'accepted', phase: 'queued' })
    expect(await queue.submit(incumbent)).toEqual({ kind: 'accepted', phase: 'queued' })

    const collision = await queue.replaceIdentity(reprepared, 'identity-d2')
    expect(collision.collision).toBe(incumbent)
    expect(collision.replaced).toBe(false)
    expect(reprepared.file.state).toBe('discarded')
    expect(reprepared.file.detail).toContain('duplicate of run run-b')
    expect(queue.owns('run-a')).toBe(false)

    await queue.complete(occupying, 'completed')
    await vi.waitFor(() => {
      expect(
        hooks.start.mock.calls.some((call: unknown[]) => (call[0] as QueueRun).file.id === 'run-b'),
      ).toBe(true)
    })
    await queue.complete(incumbent, 'completed')

    const settledA = hooks.settled.mock.calls.filter(
      (call: unknown[]) => (call[0] as QueueRun).file.id === 'run-a',
    )
    const settledB = hooks.settled.mock.calls.filter(
      (call: unknown[]) => (call[0] as QueueRun).file.id === 'run-b',
    )
    expect(settledA).toEqual([[reprepared, 'discarded']])
    expect(settledB).toEqual([[incumbent, 'completed']])
    const startedA = hooks.start.mock.calls.filter(
      (call: unknown[]) => (call[0] as QueueRun).file.id === 'run-a',
    )
    expect(startedA).toHaveLength(0)
    const startedIdentities = hooks.start.mock.calls.map(
      (call: unknown[]) => (call[0] as QueueRun).file.identity,
    )
    expect(startedIdentities.filter((identity: string) => identity === 'identity-d2')).toHaveLength(
      1,
    )
    queue.dispose()
  })
})

describe('review queue cancellation', () => {
  it('settles a queued run discarded without starting a target', async () => {
    const internalFault = vi.fn(async (run: QueueRun) => {
      run.file.failureClass = 'queue-internal-error'
    })
    const hooks = {
      start: vi.fn(async () => undefined),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      internalFault,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 2,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    const running = fakeRun('run-a', 'key-a', 'identity-a')
    const waiting = fakeRun('run-b', 'key-b', 'identity-b')
    expect(await queue.submit(running)).toEqual({ kind: 'accepted', phase: 'running' })
    expect(await queue.submit(waiting)).toEqual({ kind: 'accepted', phase: 'queued' })
    expect(waiting.file.queuePosition).toBe(1)

    expect(await queue.cancel('run-b')).toBe(true)
    expect(await queue.cancel('run-b')).toBe(false)
    expect(hooks.start).toHaveBeenCalledTimes(1)
    expect(hooks.settled).toHaveBeenCalledTimes(1)
    expect(hooks.settled).toHaveBeenCalledWith(waiting, 'discarded')
    expect(waiting.file.state).toBe('discarded')
    expect(queue.owns('run-b')).toBe(false)
    expect(queue.summary()).toMatchObject({ active: 1, queued: 0 })
    queue.dispose()
  })

  it('recomputes positions from the current waiting list after a cancellation', async () => {
    let releasePersist: () => void = () => undefined
    let gate: Promise<void> | undefined
    const hooks = {
      start: vi.fn(async () => undefined),
      persist: vi.fn(async () => {
        if (gate !== undefined) await gate
      }),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 3,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    const running = fakeRun('run-a', 'key-a', 'identity-a')
    expect(await queue.submit(running)).toEqual({ kind: 'accepted', phase: 'running' })

    gate = new Promise<void>((resolve) => {
      releasePersist = resolve
    })
    const second = fakeRun('run-b', 'key-b', 'identity-b')
    const third = fakeRun('run-c', 'key-c', 'identity-c')
    const submitSecond = queue.submit(second)
    const submitThird = queue.submit(third)
    expect(third.file.queuePosition).toBe(2)

    const cancelling = queue.cancel('run-b')
    expect(queue.summary().queued).toBe(1)
    releasePersist()
    await Promise.all([submitSecond, submitThird, cancelling])
    expect(second.file.state).toBe('discarded')
    expect(third.file.queuePosition).toBe(1)
    queue.dispose()
  })

  it('serializes persistence so an earlier queued write cannot overwrite a terminal state', async () => {
    let releasePersist: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      releasePersist = resolve
    })
    const writes: Array<{ id: string; state: string }> = []
    const hooks = {
      start: vi.fn(async () => undefined),
      persist: vi.fn(async (run: QueueRun) => {
        const state = run.file.state
        if (run.file.id === 'run-b' && state === 'queued') await gate
        writes.push({ id: run.file.id, state })
      }),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 3,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    expect(await queue.submit(fakeRun('run-a', 'key-a', 'identity-a'))).toEqual({
      kind: 'accepted',
      phase: 'running',
    })
    const second = fakeRun('run-b', 'key-b', 'identity-b')
    expect(await queue.submit(second)).toEqual({ kind: 'accepted', phase: 'queued' })
    const cancelling = queue.cancel('run-b')
    releasePersist()
    await cancelling
    expect(writes.at(-1)).toEqual({ id: 'run-b', state: 'discarded' })
    expect(second.file.state).toBe('discarded')
    queue.dispose()
  })
})

describe('review failure classification', () => {
  const cases: Array<[string, Error, 'start' | 'run', string, boolean]> = [
    [
      'a child limit',
      new Error('subagent limit reached (active child limit: 8)'),
      'start',
      'child-limit',
      true,
    ],
    [
      'a provider start rejection',
      new Error(
        'target "codex" on provider "codex-subagent" could not start: provider unavailable',
      ),
      'start',
      'provider-not-started',
      true,
    ],
    [
      'a timeout',
      new Error('target "codex" did not finish within 1200000 ms; widen timeouts.review'),
      'run',
      'timeout',
      true,
    ],
    [
      'a in-run input mutation',
      new Error('reviewed inputs changed during the run (1 changed: proposal.md)'),
      'run',
      'reviewed-inputs-changed',
      false,
    ],
    [
      'an invalid verdict',
      new Error('the target returned no fenced JSON verdict; the review needs exactly one block'),
      'run',
      'invalid-output',
      false,
    ],
    [
      'a configuration error',
      new Error('target "x" names provider "missing", which is not registered'),
      'start',
      'config',
      false,
    ],
    [
      'a provider configuration rejection',
      new Error('could not start: unsupported Codex target option "maxTokens"'),
      'start',
      'config',
      false,
    ],
    [
      'a permission denial',
      new Error('permission denied: approval required for this target'),
      'run',
      'permission',
      false,
    ],
    [
      'an unrecognized failure',
      new Error('the target exploded unexpectedly'),
      'run',
      'unknown',
      false,
    ],
  ]

  for (const [name, error, phase, expected, transient] of cases) {
    it(`classifies ${name} as ${expected}`, () => {
      const classified = classifyFailure(error, phase)
      expect(classified.failureClass).toBe(expected)
      expect(classified.transient).toBe(transient)
    })
  }

  it('honors a provider retry-after hint', () => {
    expect(
      classifyFailure(
        new Error('subagent limit reached (active child limit: 8); retry after 7 s'),
        'start',
      ),
    ).toMatchObject({ failureClass: 'child-limit', retryAfterMs: 7_000 })
    const withProperty = Object.assign(new Error('subagent limit reached'), { retryAfterMs: 1_234 })
    expect(classifyFailure(withProperty, 'start').retryAfterMs).toBe(1_234)
  })

  it('prefers the reviewer-output marker over keywords inside the payload', () => {
    const error = Object.assign(
      new Error('the fenced verdict is not valid JSON: unexpected timeout token'),
      { name: 'InvalidOutputError' },
    )
    expect(classifyFailure(error, 'run')).toEqual({
      failureClass: 'invalid-output',
      transient: false,
    })
  })

  it('classifies a missing provider as config even when the rule name contains timeout', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    const harness = await harnessFor(
      root,
      {
        targets: { codex: { provider: 'missing-provider' } },
        rules: [
          {
            id: 'timeout-review',
            when: 'spec-ready',
            to: 'codex',
            contract: 'review',
            phase: 'spec',
            scope: 'whole',
            gate: 'strict',
            instruction: 'bundled:review-spec',
          },
        ],
      },
      subagents,
    )
    await expect(
      harness.startReview({ rule: 'timeout-review', change: 'change-a' }),
    ).rejects.toThrow(/not registered/)

    const runs = await readdir(join(root, '.dsh', 'delegation', 'runs'))
    expect(runs).toHaveLength(1)
    const run = JSON.parse(
      await readFile(join(root, '.dsh', 'delegation', 'runs', runs[0] as string), 'utf8'),
    ) as { failureClass: string; attempts: number }
    expect(run.failureClass).toBe('config')
    expect(run.attempts).toBe(1)
  })

  it('maps a provider authorization diagnostic to permission', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, () => ({
      output: [],
      stopReason: 'error' as const,
      // The permanent diagnostic sits beyond the public message bound.
      diagnostic: `${'x'.repeat(4_000)} category: access-policy`,
    }))
    const harness = await harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const run = await readRun(root, runId)
    expect(run.failureClass).toBe('permission')
  })

  it('bounds and redacts an immediate start rejection', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    subagents.startError = new Error(
      `permission denied: token=\\"synthetic-escaped-credential\\"\nauthorization: bearer "synthetic-quoted-credential" {"Authorization":"Bearer synthetic-example-value"} Cookie: session="synthetic-session-credential"; refresh=synthetic-refresh-credential api_key=sk-proj-${'a'.repeat(40)} {"access_token":"synthetic-access-credential"} AWS_SECRET_ACCESS_KEY=synthetic-aws-secret https://alice:synthetic-password@example.test/api {"path":"/home/alice/private/review.txt"} C:\\Users\\me\\private.txt\n${'y'.repeat(6_000)}`,
    )
    const harness = await harnessFor(root, defaultTestConfig(), subagents)

    let thrown: Error | undefined
    try {
      await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
    } catch (error) {
      thrown = error as Error
    }
    expect(thrown).toBeDefined()
    const message = thrown?.message ?? ''
    expect(message).not.toContain('synthetic-example-value')
    expect(message).not.toContain('synthetic-quoted-credential')
    expect(message).not.toContain('synthetic-escaped-credential')
    expect(message).not.toContain('synthetic-session-credential')
    expect(message).not.toContain('synthetic-access-credential')
    expect(message).not.toContain('synthetic-aws-secret')
    expect(message).not.toContain('sk-proj-')
    expect(message).not.toContain('C:\\Users')
    expect(message).not.toContain('/home/alice')
    expect(message).not.toContain('\n')
    expect(message.length).toBeLessThan(4_500)
  })

  it('classifies malformed provider output as invalid-output', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    let call = 0
    subagents.addProvider('codex-subagent', {}, () => {
      call += 1
      if (call === 1) {
        return {
          output: [
            {
              type: 'text' as const,
              text: '```json\n{}\n```\n```json\n{}\n```',
            },
          ],
          stopReason: 'completed' as const,
        }
      }
      return { output: [], stopReason: 'completed' as const }
    })
    const harness = await harnessFor(root, defaultTestConfig(), subagents)

    const first = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(first)).toContain('state=failed')
    const firstRun = await readRun(root, first)
    expect(firstRun.failureClass).toBe('invalid-output')
    const firstRecord = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(firstRecord.verdict).toBe('ERROR')
    expect(firstRecord.error).toContain('fenced blocks')

    const second = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(second)).toContain('state=failed')
    expect((await readRun(root, second)).failureClass).toBe('invalid-output')
  })

  it('keeps a typed input mutation permanent despite filename keywords', () => {
    const error = Object.assign(
      new Error('reviewed inputs changed during the run (1 changed: subagent limit reached.md)'),
      { name: 'InputMutationError' },
    )
    expect(classifyFailure(error, 'run')).toEqual({
      failureClass: 'reviewed-inputs-changed',
      transient: false,
    })
  })

  it('classifies an explicit not-authorized start denial as permanent', () => {
    const denial = Object.assign(new Error('rule "x": could not start: not authorized'), {
      name: 'ProviderStartError',
      providerMessage: 'not authorized',
    })
    expect(classifyFailure(denial, 'start')).toEqual({
      failureClass: 'permission',
      transient: false,
    })
  })

  it('does not retry a provider not-authorized start', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    subagents.startError = new Error('not authorized')
    const harness = await harnessFor(root, defaultTestConfig(), subagents)
    await expect(harness.startReview({ rule: 'spec-review', change: 'change-a' })).rejects.toThrow(
      /not authorized/,
    )
    const runs = await readdir(join(root, '.dsh', 'delegation', 'runs'))
    expect(runs).toHaveLength(1)
    const run = JSON.parse(
      await readFile(join(root, '.dsh', 'delegation', 'runs', runs[0] as string), 'utf8'),
    ) as { failureClass: string; attempts: number }
    expect(run.failureClass).toBe('permission')
    expect(run.attempts).toBe(1)
  })

  it('classifies a denial beyond the public-message bound', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    subagents.startError = new Error(`${'x'.repeat(4_000)}; permission denied`)
    const harness = await harnessFor(root, defaultTestConfig(), subagents)
    await expect(harness.startReview({ rule: 'spec-review', change: 'change-a' })).rejects.toThrow(
      /could not start/,
    )
    const runs = await readdir(join(root, '.dsh', 'delegation', 'runs'))
    const run = JSON.parse(
      await readFile(join(root, '.dsh', 'delegation', 'runs', runs[0] as string), 'utf8'),
    ) as { failureClass: string; attempts: number }
    expect(run.failureClass).toBe('permission')
    expect(run.attempts).toBe(1)
  })

  it('records an input mutation named like a child limit as reviewed-inputs-changed', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = await harnessFor(root, defaultTestConfig(), subagents)

    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'subagent limit reached.md'),
      'changed\n',
      'utf8',
    )
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    expect((await readRun(root, runId)).failureClass).toBe('reviewed-inputs-changed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { error: string }
    expect(record.error).toContain('subagent limit reached.md')
  })

  it('classifies a provider start failure independently of the rule name', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    subagents.startError = new Error('provider unavailable')
    const rule = (id: string, phase: string, gate: 'strict' | 'soft') => ({
      id,
      when: 'spec-ready' as const,
      to: 'codex',
      contract: 'review' as const,
      phase,
      scope: 'whole' as const,
      gate,
      instruction: 'bundled:review-spec',
    })
    const harness = await harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent' } },
        rules: [
          rule('spec-review', 'spec', 'strict'),
          rule('approval-review', 'approval', 'soft'),
          rule('unsupported-review', 'unsupported', 'soft'),
        ],
        reviewQueue: { concurrency: 1, maxAttempts: 1 },
      },
      subagents,
    )
    for (const id of ['spec-review', 'approval-review', 'unsupported-review']) {
      await expect(harness.startReview({ rule: id, change: 'change-a' })).rejects.toThrow(
        /could not start/,
      )
    }

    const byRule = new Map<string, unknown>()
    for (const name of await readdir(join(root, '.dsh', 'delegation', 'runs'))) {
      const run = JSON.parse(
        await readFile(join(root, '.dsh', 'delegation', 'runs', name), 'utf8'),
      ) as { rule: string; failureClass: string }
      byRule.set(run.rule, run.failureClass)
    }
    for (const id of ['spec-review', 'approval-review', 'unsupported-review']) {
      expect(byRule.get(id)).toBe('provider-not-started')
    }
  })

  it('classifies a provider result failure independently of the rule name', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, () => ({
      output: [],
      stopReason: 'error' as const,
      diagnostic: 'did not finish within 100 ms',
    }))
    const rule = (id: string, phase: string, gate: 'strict' | 'soft') => ({
      id,
      when: 'spec-ready' as const,
      to: 'codex',
      contract: 'review' as const,
      phase,
      scope: 'whole' as const,
      gate,
      instruction: 'bundled:review-spec',
    })
    const harness = await harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent' } },
        rules: [
          rule('spec-review', 'spec', 'strict'),
          rule('approval-review', 'approval', 'soft'),
          rule('unsupported-review', 'unsupported', 'soft'),
        ],
        reviewQueue: { concurrency: 1, maxAttempts: 1 },
      },
      subagents,
    )
    const byRule = new Map<string, unknown>()
    for (const id of ['spec-review', 'approval-review', 'unsupported-review']) {
      const runId = await harness.startReview({ rule: id, change: 'change-a' })
      expect(await harness.waitForRun(runId)).toContain('state=failed')
      byRule.set(id, (await readRun(root, runId)).failureClass)
    }
    for (const id of ['spec-review', 'approval-review', 'unsupported-review']) {
      expect(byRule.get(id)).toBe('timeout')
    }
  })

  it('records a bounded, redacted failure class on the run and record', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, () => {
      throw new Error(
        `permission denied: C:\\Users\\me\\secret.txt sk-abcdefgh12345678 token=\\"synthetic-escaped-credential\\" ${JSON.stringify(JSON.stringify({ access_token: 'synthetic-double-escaped-secret' }))}\nAuthorization: Bearer "synthetic-quoted-credential" authorization: bearer synthetic-example-value {"Authorization":"Bearer synthetic-example-value"} Cookie: preference="quoted-value"; session="synthetic-session-credential"; refresh=synthetic-refresh-credential api_key=sk-proj-${'a'.repeat(40)} token="synthetic-secret-value" {"password":"another-secret-value"} password="synthetic'private-value" {"access_token":"synthetic-access-credential","refresh_token":"synthetic-refresh-token"} AWS_SECRET_ACCESS_KEY=synthetic-aws-secret https://alice:synthetic-password@example.test/api {"path":"/home/alice/private/review.txt"} /tmp/review/private.txt\n${'x'.repeat(6_000)}`,
      )
    })
    const harness = await harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')

    const run = await readRun(root, runId)
    expect(run.failureClass).toBe('permission')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('[path]')
    expect(record.error).toContain('[secret]')
    expect(record.error).not.toContain('sk-abcdefgh12345678')
    expect(record.error).not.toContain('synthetic-example-value')
    expect(record.error).not.toContain('synthetic-quoted-credential')
    expect(record.error).not.toContain('synthetic-escaped-credential')
    expect(record.error).not.toContain('synthetic-double-escaped-secret')
    expect(record.error).not.toContain('sk-proj-')
    expect(record.error).not.toContain('synthetic-secret-value')
    expect(record.error).not.toContain('another-secret-value')
    expect(record.error).not.toContain('synthetic-password')
    expect(record.error).not.toContain("synthetic'private-value")
    expect(record.error).not.toContain('private-value')
    expect(record.error).not.toContain('synthetic-session-credential')
    expect(record.error).not.toContain('synthetic-refresh-credential')
    expect(record.error).not.toContain('quoted-value')
    expect(record.error).not.toContain('synthetic-access-credential')
    expect(record.error).not.toContain('synthetic-refresh-token')
    expect(record.error).not.toContain('synthetic-aws-secret')
    expect(record.error).not.toContain('/tmp/review')
    expect(record.error).not.toContain('/home/alice')
    expect(record.error).not.toContain('C:\\Users')
    expect(record.error.length).toBe(4_000)
  })

  it('keeps ordinary authorization and cookie prose in findings', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, (run) => {
      const digest = /- Digest: ([0-9a-f]{64})/.exec(run.prompt)?.[1] ?? '0'.repeat(64)
      const verdict = {
        digest,
        verdict: 'FINDINGS',
        findings: [
          {
            severity: 'P1',
            title: 'Authorization bypass on the cookie route',
            evidence: 'The Authorization header is trusted without a signature check',
            fix: 'Cookie handling must validate the session before redirect',
          },
        ],
      }
      return {
        output: [{ type: 'text' as const, text: `\`\`\`json\n${JSON.stringify(verdict)}\n\`\`\`` }],
        stopReason: 'completed' as const,
      }
    })
    const harness = await harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; findings: Array<{ title: string; evidence: string; fix: string }> }
    expect(record.verdict).toBe('FINDINGS')
    expect(record.findings[0]?.title).toBe('Authorization bypass on the cookie route')
    expect(record.findings[0]?.evidence).toBe(
      'The Authorization header is trusted without a signature check',
    )
    expect(record.findings[0]?.fix).toBe(
      'Cookie handling must validate the session before redirect',
    )
  })
})

describe('review retry policy', () => {
  it('applies exponential backoff, full jitter, and the max delay cap', () => {
    const limits = { baseDelayMs: 100, maxDelayMs: 1_000 }
    expect(retryDelayMs(1, limits, undefined, () => 1)).toBe(100)
    expect(retryDelayMs(1, limits, undefined, () => 0)).toBe(50)
    expect(retryDelayMs(2, limits, undefined, () => 1)).toBe(200)
    expect(retryDelayMs(3, limits, undefined, () => 1)).toBe(400)
    expect(retryDelayMs(10, limits, undefined, () => 1)).toBe(1_000)
    // A provider retry-after larger than the jittered delay wins, still capped.
    expect(retryDelayMs(1, limits, 700, () => 0)).toBe(700)
    expect(retryDelayMs(1, limits, 5_000, () => 1)).toBe(1_000)
  })

  it('retries a transient start failure up to maxAttempts on a fake clock', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent')
      let attempts = 0
      subagents.startActivation = async () => {
        attempts += 1
        throw new Error('subagent limit reached (active child limit: 8)')
      }
      const harness = await harnessFor(
        root,
        {
          ...defaultTestConfig(),
          reviewQueue: { concurrency: 1, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 200 },
        },
        subagents,
      )
      const handle = await harness.toolText('delegate', {
        rule: 'spec-review',
        change: 'change-a',
      })
      const runId = runIdFrom(handle)
      expect(handle).toContain('review retrying')
      expect(handle).toContain('failure class: child-limit')
      expect(attempts).toBe(1)

      // Fake timers drive the backoff; real I/O still needs a real tick.
      const flush = (): Promise<void> =>
        new Promise((resolve) => {
          realSetTimeout(resolve, 5)
        })
      await vi.advanceTimersByTimeAsync(99)
      expect(attempts).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(attempts).toBe(2)
      await vi.advanceTimersByTimeAsync(199)
      expect(attempts).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(attempts).toBe(3)

      expect(await harness.waitForRun(runId)).toContain('state=failed')
      const run = await readRun(root, runId)
      expect(run.attempts).toBe(3)
      expect(run.failureClass).toBe('child-limit')
      const record = JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
          'utf8',
        ),
      ) as { verdict: string }
      expect(record.verdict).toBe('ERROR')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})

describe('review retry-after and run retries', () => {
  const flush = (): Promise<void> =>
    new Promise((resolve) => {
      realSetTimeout(resolve, 5)
    })

  it('honors a provider retry-after through the start path', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent')
      const original = subagents.startActivation.bind(subagents)
      let attempts = 0
      subagents.startActivation = async (spec) => {
        attempts += 1
        if (attempts === 1) {
          throw Object.assign(new Error('subagent limit reached (active child limit: 8)'), {
            retryAfterMs: 700,
          })
        }
        return original(spec)
      }
      const harness = await harnessFor(
        root,
        {
          ...defaultTestConfig(),
          reviewQueue: { concurrency: 1, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
        },
        subagents,
      )
      const handle = await harness.toolText('delegate', {
        rule: 'spec-review',
        change: 'change-a',
      })
      const runId = runIdFrom(handle)
      expect(handle).toContain('review retrying')
      await flush()

      // The provider hint (700 ms) exceeds the jittered 50 ms base delay.
      await vi.advanceTimersByTimeAsync(699)
      await flush()
      expect(attempts).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(attempts).toBe(2)
      expect(await harness.waitForRun(runId)).toContain('state=completed')
      const record = JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
          'utf8',
        ),
      ) as { verdict: string }
      expect(record.verdict).toBe('PASS')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('retries a transient provider-result failure and publishes one record', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      let calls = 0
      subagents.addProvider('codex-subagent', {}, (run) => {
        calls += 1
        if (calls < 3) {
          return {
            output: [],
            stopReason: 'error' as const,
            diagnostic: 'subagent limit reached (active child limit: 8)',
          }
        }
        return passResponder(run)
      })
      const harness = await harnessFor(
        root,
        {
          ...defaultTestConfig(),
          reviewQueue: { concurrency: 1, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 200 },
        },
        subagents,
      )
      const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
      await flush()

      await vi.advanceTimersByTimeAsync(100)
      await flush()
      await vi.advanceTimersByTimeAsync(200)
      await flush()
      expect(await harness.waitForRun(runId)).toContain('state=completed')

      const run = await readRun(root, runId)
      expect(run.attempts).toBe(3)
      expect(calls).toBe(3)
      const record = JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
          'utf8',
        ),
      ) as { verdict: string; runId: string }
      expect(record.verdict).toBe('PASS')
      expect(record.runId).toBe(runId)
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('does not apply the admission deadline to an admitted run retry', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      let calls = 0
      subagents.addProvider('codex-subagent', {}, (run) => {
        calls += 1
        if (calls === 1) {
          return {
            output: [],
            stopReason: 'error' as const,
            diagnostic: 'subagent limit reached (active child limit: 8)',
          }
        }
        return passResponder(run)
      })
      let clock = new Date('2026-01-01T00:00:00.000Z')
      const harness = new Harness({
        cwd: root,
        config: {
          ...defaultTestConfig(),
          reviewQueue: {
            concurrency: 1,
            maxAttempts: 3,
            baseDelayMs: 10,
            maxDelayMs: 20,
            waitTimeoutMs: 100,
          },
        },
        agents: subagents,
        now: () => clock,
      })
      const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
      await flush()
      // Past the acceptance deadline, but the run was admitted long ago.
      clock = new Date(clock.getTime() + 150)
      await vi.advanceTimersByTimeAsync(10)
      await flush()
      expect(await harness.waitForRun(runId)).toContain('state=completed')
      expect((await readRun(root, runId)).attempts).toBe(2)
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('lets a retrying head start when a follower fills the waiting list', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent')
      const original = subagents.startActivation.bind(subagents)
      let firstStart = true
      subagents.startActivation = async (spec) => {
        if (firstStart) {
          firstStart = false
          throw new Error('subagent limit reached (active child limit: 8)')
        }
        return original(spec)
      }
      const git = new FakeGit()
      git.failSnapshot = true
      const harness = new Harness({
        cwd: root,
        config: {
          targets: { codex: { provider: 'codex-subagent' } },
          rules: [
            {
              id: 'task-review',
              when: 'spec-task-ready',
              to: 'codex',
              contract: 'review',
              scope: 'task',
              gate: 'strict',
              instruction: 'bundled:review-task',
            },
            {
              id: 'task-review-extra',
              when: 'spec-task-ready',
              to: 'codex',
              contract: 'review',
              scope: 'task',
              gate: 'soft',
              instruction: 'bundled:review-task',
            },
          ],
          reviewQueue: {
            concurrency: 1,
            maxQueued: 1,
            maxAttempts: 3,
            baseDelayMs: 10,
            maxDelayMs: 20,
          },
        },
        agents: subagents,
        git,
      })
      const task = taskIdFor('Shared task')
      const headHandle = await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task,
      })
      const headRun = runIdFrom(headHandle)
      expect(headHandle).toContain('review retrying')
      await flush()

      const follower = await harness.toolText('delegate', {
        rule: 'task-review-extra',
        change: 'change-a',
        task,
      })
      const followerRun = runIdFrom(follower)
      expect(follower).toContain('review queued')
      expect(follower).toContain('queue position: 1')

      await vi.advanceTimersByTimeAsync(10)
      await flush()
      expect(await harness.waitForRun(headRun)).toContain('state=completed')
      expect(await harness.waitForRun(followerRun)).toContain('state=completed')
      expect((await readRun(root, headRun)).attempts).toBe(2)
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('keeps retrying after the admission deadline when an admitted retry start fails', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      let responderCalls = 0
      subagents.addProvider('codex-subagent', {}, (run) => {
        responderCalls += 1
        if (responderCalls === 1) {
          return {
            output: [],
            stopReason: 'error' as const,
            diagnostic: 'subagent limit reached (active child limit: 8)',
          }
        }
        return passResponder(run)
      })
      const original = subagents.startActivation.bind(subagents)
      let startCalls = 0
      subagents.startActivation = async (spec) => {
        startCalls += 1
        if (startCalls === 2) {
          throw new Error('subagent limit reached (active child limit: 8)')
        }
        return original(spec)
      }
      let clock = new Date('2026-01-01T00:00:00.000Z')
      const harness = new Harness({
        cwd: root,
        config: {
          ...defaultTestConfig(),
          reviewQueue: {
            concurrency: 1,
            maxAttempts: 3,
            baseDelayMs: 10,
            maxDelayMs: 20,
            waitTimeoutMs: 100,
          },
        },
        agents: subagents,
        now: () => clock,
      })
      const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
      await flush()
      clock = new Date(clock.getTime() + 150)
      await vi.advanceTimersByTimeAsync(10)
      await flush()
      await vi.advanceTimersByTimeAsync(20)
      await flush()
      expect(await harness.waitForRun(runId)).toContain('state=completed')
      expect(startCalls).toBe(3)
      expect(responderCalls).toBe(2)
      expect((await readRun(root, runId)).attempts).toBe(3)
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('honors retry-after from the untruncated provider detail on both paths', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(0)
      const detail = `${'x'.repeat(4_000)}; subagent limit reached (active child limit: 8); retry after 60 s`

      const rootA = await workspace()
      await writeChange(rootA, 'change-a', [])
      const agentsA = new FakeSubagents()
      agentsA.addProvider('codex-subagent')
      const originalA = agentsA.startActivation.bind(agentsA)
      let startsA = 0
      agentsA.startActivation = async (spec) => {
        startsA += 1
        if (startsA === 1) throw new Error(detail)
        return originalA(spec)
      }
      const harnessA = await harnessFor(
        rootA,
        {
          ...defaultTestConfig(),
          reviewQueue: { concurrency: 1, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
        },
        agentsA,
      )
      const handleA = await harnessA.toolText('delegate', {
        rule: 'spec-review',
        change: 'change-a',
      })
      expect(handleA).toContain('review retrying')
      await flush()
      await vi.advanceTimersByTimeAsync(999)
      await flush()
      expect(startsA).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(startsA).toBe(2)
      expect(await harnessA.waitForRun(runIdFrom(handleA))).toContain('state=completed')

      const rootB = await workspace()
      await writeChange(rootB, 'change-a', [])
      const agentsB = new FakeSubagents()
      let callsB = 0
      agentsB.addProvider('codex-subagent', {}, (run) => {
        callsB += 1
        if (callsB === 1) {
          return { output: [], stopReason: 'error' as const, diagnostic: detail }
        }
        return passResponder(run)
      })
      const harnessB = await harnessFor(
        rootB,
        {
          ...defaultTestConfig(),
          reviewQueue: { concurrency: 1, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
        },
        agentsB,
      )
      const runB = await harnessB.startReview({ rule: 'spec-review', change: 'change-a' })
      await flush()
      await vi.advanceTimersByTimeAsync(999)
      await flush()
      expect(callsB).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(callsB).toBe(2)
      expect(await harnessB.waitForRun(runB)).toContain('state=completed')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('retries a nullish provider start rejection', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent')
      const original = subagents.startActivation.bind(subagents)
      let calls = 0
      subagents.startActivation = async (spec) => {
        calls += 1
        if (calls === 1) throw null
        return original(spec)
      }
      const harness = await harnessFor(
        root,
        {
          ...defaultTestConfig(),
          reviewQueue: { concurrency: 1, maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 20 },
        },
        subagents,
      )
      const handle = await harness.toolText('delegate', {
        rule: 'spec-review',
        change: 'change-a',
      })
      expect(handle).toContain('review retrying')
      await flush()
      await vi.advanceTimersByTimeAsync(10)
      await flush()
      expect(calls).toBe(2)
      expect(await harness.waitForRun(runIdFrom(handle))).toContain('state=completed')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('re-checks inputs when an immediately admitted review retries', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      let calls = 0
      subagents.addProvider('codex-subagent', {}, (run) => {
        calls += 1
        if (calls === 1) {
          return {
            output: [],
            stopReason: 'error' as const,
            diagnostic: 'subagent limit reached (active child limit: 8)',
          }
        }
        return passResponder(run)
      })
      const harness = await harnessFor(
        root,
        {
          ...defaultTestConfig(),
          reviewQueue: { concurrency: 1, maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 200 },
        },
        subagents,
      )
      const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
      await flush()
      await writeFile(
        join(root, 'openspec', 'changes', 'change-a', 'proposal.md'),
        '# Proposal\n\nChanged during backoff.\n',
        'utf8',
      )
      await vi.advanceTimersByTimeAsync(100)
      await flush()
      expect(await harness.waitForRun(runId)).toContain('state=completed')
      const record = JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
          'utf8',
        ),
      ) as { digest: string; verdict: string }
      expect(record.verdict).toBe('PASS')
      expect(record.digest).toBe(await specDigest(join(root, 'openspec', 'changes', 'change-a')))
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})

describe('review timeout retry and quarantine', () => {
  const flush = (): Promise<void> =>
    new Promise((resolve) => {
      realSetTimeout(resolve, 5)
    })

  function taskReviewRules() {
    return [
      {
        id: 'task-review',
        when: 'spec-task-ready' as const,
        to: 'codex',
        contract: 'review' as const,
        scope: 'task' as const,
        gate: 'strict' as const,
        instruction: 'bundled:review-task',
      },
      {
        id: 'task-review-extra',
        when: 'spec-task-ready' as const,
        to: 'codex',
        contract: 'review' as const,
        scope: 'task' as const,
        gate: 'soft' as const,
        instruction: 'bundled:review-task',
      },
    ]
  }

  it('retries a timeout whose cancellation is confirmed', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      let calls = 0
      subagents.addProvider('codex-subagent', {}, (run) => {
        calls += 1
        if (calls === 1) return new Promise(() => {})
        return passResponder(run)
      })
      const harness = await harnessFor(
        root,
        {
          ...defaultTestConfig(),
          timeouts: { review: 20 },
          reviewQueue: { concurrency: 1, maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 20 },
        },
        subagents,
      )
      const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
      await vi.advanceTimersByTimeAsync(20)
      await flush()
      await vi.advanceTimersByTimeAsync(10)
      await flush()
      expect(await harness.waitForRun(runId)).toContain('state=completed')
      expect(calls).toBe(2)
      const record = JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
          'utf8',
        ),
      ) as { verdict: string }
      expect(record.verdict).toBe('PASS')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('quarantines an unconfirmed timeout until teardown confirms', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
      const subagents = new FakeSubagents()
      let calls = 0
      subagents.addProvider('codex-subagent', {}, (run) => {
        calls += 1
        if (calls === 1) return new Promise(() => {})
        return passResponder(run)
      })
      const original = subagents.startActivation.bind(subagents)
      let disposals = 0
      subagents.startActivation = async (spec) => {
        const activation = await original(spec)
        return {
          ...activation,
          dispose: async () => {
            disposals += 1
            if (disposals <= 2) throw new Error('teardown unconfirmed')
          },
        }
      }
      const git = new FakeGit()
      git.failSnapshot = true
      const harness = new Harness({
        cwd: root,
        config: {
          targets: { codex: { provider: 'codex-subagent' } },
          rules: taskReviewRules(),
          timeouts: { review: 20 },
          reviewQueue: {
            concurrency: 1,
            maxQueued: 2,
            maxAttempts: 2,
            baseDelayMs: 50,
            maxDelayMs: 100,
          },
        },
        agents: subagents,
        git,
      })
      const task = taskIdFor('Shared task')
      const first = await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task,
      })
      const firstRun = runIdFrom(first)
      const follower = await harness.toolText('delegate', {
        rule: 'task-review-extra',
        change: 'change-a',
        task,
      })
      const followerRun = runIdFrom(follower)
      expect(follower).toContain('review queued')

      await vi.advanceTimersByTimeAsync(20)
      await flush()
      expect(await harness.waitForRun(firstRun)).toContain('state=failed')
      expect((await readRun(root, followerRun)).state).toBe('queued')
      expect(subagents.startCalls).toBe(1)
      const firstRecord = JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks', `${task}.json`),
          'utf8',
        ),
      ) as { verdict: string; error: string }
      expect(firstRecord.verdict).toBe('ERROR')
      expect(firstRecord.error).toContain('could not be confirmed cancelled')

      await vi.advanceTimersByTimeAsync(50)
      await flush()
      await flush()
      await flush()
      await flush()
      expect(subagents.startCalls).toBe(2)
      expect(await harness.waitForRun(followerRun)).toContain('state=completed')
      expect(calls).toBe(2)
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('quarantines a provider-reported timeout after a failed teardown', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent', {}, (run) => {
        if (run.prompt.includes('task-review-extra')) return passResponder(run)
        return {
          output: [],
          stopReason: 'error' as const,
          diagnostic: 'did not finish within 100 ms',
        }
      })
      const original = subagents.startActivation.bind(subagents)
      let disposals = 0
      subagents.startActivation = async (spec) => {
        const activation = await original(spec)
        return {
          ...activation,
          dispose: async () => {
            disposals += 1
            if (disposals <= 2) throw new Error('teardown unconfirmed')
          },
        }
      }
      const git = new FakeGit()
      git.failSnapshot = true
      const harness = new Harness({
        cwd: root,
        config: {
          targets: { codex: { provider: 'codex-subagent' } },
          rules: taskReviewRules(),
          reviewQueue: {
            concurrency: 1,
            maxQueued: 2,
            maxAttempts: 2,
            baseDelayMs: 50,
            maxDelayMs: 100,
          },
        },
        agents: subagents,
        git,
      })
      const task = taskIdFor('Shared task')
      const first = await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task,
      })
      const firstRun = runIdFrom(first)
      const follower = await harness.toolText('delegate', {
        rule: 'task-review-extra',
        change: 'change-a',
        task,
      })
      const followerRun = runIdFrom(follower)
      expect(follower).toContain('review queued')

      await flush()
      await flush()
      expect(await harness.waitForRun(firstRun)).toContain('state=failed')
      expect((await readRun(root, firstRun)).failureClass).toBe('timeout')
      const record = JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks', `${task}.json`),
          'utf8',
        ),
      ) as { verdict: string }
      expect(record.verdict).toBe('ERROR')
      expect(subagents.startCalls).toBe(1)
      expect((await readRun(root, followerRun)).state).toBe('queued')

      await vi.advanceTimersByTimeAsync(50)
      await flush()
      await flush()
      expect(subagents.startCalls).toBe(2)
      expect(await harness.waitForRun(followerRun)).toContain('state=completed')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('bounds an unresponsive dispose and still settles into quarantine', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
      const subagents = new FakeSubagents()
      let calls = 0
      subagents.addProvider('codex-subagent', {}, (run) => {
        calls += 1
        if (calls === 1) return new Promise(() => {})
        return passResponder(run)
      })
      const original = subagents.startActivation.bind(subagents)
      let disposals = 0
      subagents.startActivation = async (spec) => {
        const activation = await original(spec)
        return {
          ...activation,
          dispose: async () => {
            disposals += 1
            if (disposals === 1) return new Promise(() => {})
            if (disposals === 2) throw new Error('teardown unconfirmed')
          },
        }
      }
      const git = new FakeGit()
      git.failSnapshot = true
      const harness = new Harness({
        cwd: root,
        config: {
          targets: { codex: { provider: 'codex-subagent' } },
          rules: taskReviewRules(),
          timeouts: { review: 20 },
          reviewQueue: {
            concurrency: 1,
            maxQueued: 2,
            maxAttempts: 2,
            baseDelayMs: 50,
            maxDelayMs: 100,
          },
        },
        agents: subagents,
        git,
      })
      const task = taskIdFor('Shared task')
      const first = await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task,
      })
      const firstRun = runIdFrom(first)
      const follower = await harness.toolText('delegate', {
        rule: 'task-review-extra',
        change: 'change-a',
        task,
      })
      const followerRun = runIdFrom(follower)
      expect(follower).toContain('review queued')

      // Timeout (20 ms) plus the bounded cancellation grace (20 ms).
      await vi.advanceTimersByTimeAsync(40)
      await flush()
      expect(await harness.waitForRun(firstRun)).toContain('state=failed')
      expect((await readRun(root, followerRun)).state).toBe('queued')
      expect(subagents.startCalls).toBe(1)

      await vi.advanceTimersByTimeAsync(50)
      await flush()
      await flush()
      expect(subagents.startCalls).toBe(2)
      expect(await harness.waitForRun(followerRun)).toContain('state=completed')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('quarantines an unconfirmed timeout even when publication fails', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
      const task = taskIdFor('Shared task')
      const recordPath = join(
        root,
        '.dsh',
        'delegation',
        'task-review',
        'change-a',
        'tasks',
        `${task}.json`,
      )
      await mkdir(recordPath, { recursive: true })
      const subagents = new FakeSubagents()
      const releases: Array<() => void> = []
      let calls = 0
      subagents.addProvider('codex-subagent', {}, (run) => {
        calls += 1
        if (calls === 1) return new Promise(() => {})
        return new Promise((resolve) => {
          releases.push(() => resolve(passResponder(run)))
        })
      })
      const original = subagents.startActivation.bind(subagents)
      let disposals = 0
      subagents.startActivation = async (spec) => {
        const activation = await original(spec)
        return {
          ...activation,
          dispose: async () => {
            disposals += 1
            if (disposals <= 2) throw new Error('teardown unconfirmed')
          },
        }
      }
      const git = new FakeGit()
      git.failSnapshot = true
      const harness = new Harness({
        cwd: root,
        config: {
          targets: { codex: { provider: 'codex-subagent' } },
          rules: taskReviewRules(),
          timeouts: { review: 20 },
          reviewQueue: {
            concurrency: 1,
            maxQueued: 2,
            maxAttempts: 2,
            baseDelayMs: 50,
            maxDelayMs: 100,
          },
        },
        agents: subagents,
        git,
      })
      const first = await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task,
      })
      const firstRun = runIdFrom(first)
      const follower = await harness.toolText('delegate', {
        rule: 'task-review-extra',
        change: 'change-a',
        task,
      })
      const followerRun = runIdFrom(follower)
      expect(follower).toContain('review queued')

      await vi.advanceTimersByTimeAsync(20)
      await flush()
      expect(await harness.waitForRun(firstRun)).toContain('state=failed')
      expect(subagents.startCalls).toBe(1)
      expect((await readRun(root, followerRun)).state).toBe('queued')

      await vi.advanceTimersByTimeAsync(50)
      await flush()
      await flush()
      expect(subagents.startCalls).toBe(2)
      await rm(recordPath, { recursive: true, force: true })
      releases.shift()?.()
      expect(await harness.waitForRun(followerRun)).toContain('state=completed')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
  it('classifies an unconfirmed timeout under a permission-like rule name', () => {
    const error = Object.assign(
      new Error('rule "permission-review": target timed out and could not be cancelled'),
      { name: 'UnconfirmedTimeoutError' },
    )
    expect(classifyFailure(error, 'run')).toMatchObject({
      failureClass: 'timeout',
      transient: true,
    })
  })

  it('quarantines a rejected timeout result after a failed teardown', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent', {}, (run) => {
        if (run.prompt.includes('task-review-extra')) return passResponder(run)
        return Promise.reject(new Error('request timed out'))
      })
      const original = subagents.startActivation.bind(subagents)
      let disposals = 0
      subagents.startActivation = async (spec) => {
        const activation = await original(spec)
        return {
          ...activation,
          dispose: async () => {
            disposals += 1
            if (disposals <= 2) throw new Error('teardown unconfirmed')
          },
        }
      }
      const git = new FakeGit()
      git.failSnapshot = true
      const harness = new Harness({
        cwd: root,
        config: {
          targets: { codex: { provider: 'codex-subagent' } },
          rules: taskReviewRules(),
          reviewQueue: {
            concurrency: 1,
            maxQueued: 2,
            maxAttempts: 2,
            baseDelayMs: 50,
            maxDelayMs: 100,
          },
        },
        agents: subagents,
        git,
      })
      const task = taskIdFor('Shared task')
      const first = await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task,
      })
      const firstRun = runIdFrom(first)
      const follower = await harness.toolText('delegate', {
        rule: 'task-review-extra',
        change: 'change-a',
        task,
      })
      const followerRun = runIdFrom(follower)
      expect(follower).toContain('review queued')

      await flush()
      await flush()
      expect(await harness.waitForRun(firstRun)).toContain('state=failed')
      expect((await readRun(root, firstRun)).failureClass).toBe('timeout')
      expect(subagents.startCalls).toBe(1)

      await vi.advanceTimersByTimeAsync(50)
      await flush()
      await flush()
      expect(subagents.startCalls).toBe(2)
      expect(await harness.waitForRun(followerRun)).toContain('state=completed')
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  it('retains a quarantined snapshot until teardown confirms', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(Math, 'random').mockReturnValue(1)
      const root = await workspace()
      await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
      await mkdir(join(root, 'src'), { recursive: true })
      await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent', {}, () => new Promise(() => {}))
      const original = subagents.startActivation.bind(subagents)
      let disposals = 0
      subagents.startActivation = async (spec) => {
        const activation = await original(spec)
        return {
          ...activation,
          dispose: async () => {
            disposals += 1
            if (disposals <= 2) throw new Error('teardown unconfirmed')
          },
        }
      }
      const git = new FakeGit()
      git.files = ['src/engine.ts']
      const harness = new Harness({
        cwd: root,
        config: {
          targets: { codex: { provider: 'codex-subagent' } },
          rules: taskReviewRules().slice(0, 1),
          timeouts: { review: 20 },
          reviewQueue: { concurrency: 1, maxAttempts: 2, baseDelayMs: 50, maxDelayMs: 100 },
        },
        agents: subagents,
        git,
      })
      const runId = await harness.startReview({
        rule: 'task-review',
        change: 'change-a',
        task: taskIdFor('Reviewed task'),
      })
      await vi.advanceTimersByTimeAsync(20)
      await flush()
      expect(await harness.waitForRun(runId)).toContain('state=failed')

      const snapshots = join(root, '.dsh', 'delegation', 'snapshots')
      const during = await readdir(snapshots)
      expect(during.some((name) => name.startsWith(runId))).toBe(true)

      await vi.advanceTimersByTimeAsync(50)
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await readdir(snapshots)).length === 0) break
        await flush()
      }
      expect(await readdir(snapshots)).toEqual([])
      vi.clearAllTimers()
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })
})

describe('queue-internal-error fallback', () => {
  it('starts directly once and records the queue-internal-error', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    let faults = 0
    const harness = new Harness({
      cwd: root,
      config: defaultTestConfig(),
      agents: subagents,
      queueFault: () => {
        faults += 1
        throw new Error('queue exploded')
      },
    })
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(faults).toBe(1)
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    const run = await readRun(root, runId)
    expect(run.failureClass).toBe('queue-internal-error')
    expect(subagents.startCalls).toBe(1)
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string }
    expect(record.verdict).toBe('PASS')
  })

  it('does not start a duplicate target after a fallback', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = new Harness({
      cwd: root,
      config: defaultTestConfig(),
      agents: subagents,
      queueFault: () => {
        throw new Error('queue exploded')
      },
    })
    const first = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    const firstRun = runIdFrom(first)
    const duplicate = await harness.toolText('delegate', {
      rule: 'spec-review',
      change: 'change-a',
    })
    expect(duplicate).toContain('review already pending')
    expect(duplicate).toContain(`run: ${firstRun}`)
    expect(subagents.startCalls).toBe(1)
    pending.releases.shift()?.()
    await harness.waitForRun(firstRun)
  })

  it('returns ERROR when a fallback cannot own the conversation key', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = new Harness({
      cwd: root,
      config: {
        targets: { codex: { provider: 'codex-subagent' } },
        rules: [
          {
            id: 'task-review',
            when: 'spec-task-ready',
            to: 'codex',
            contract: 'review',
            scope: 'task',
            gate: 'strict',
            instruction: 'bundled:review-task',
          },
          {
            id: 'task-review-extra',
            when: 'spec-task-ready',
            to: 'codex',
            contract: 'review',
            scope: 'task',
            gate: 'soft',
            instruction: 'bundled:review-task',
          },
        ],
      },
      agents: subagents,
      queueFault: () => {
        throw new Error('queue exploded')
      },
    })
    const task = taskIdFor('Shared task')
    const first = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task,
    })
    await expect(
      harness.toolText('delegate', {
        rule: 'task-review-extra',
        change: 'change-a',
        task,
      }),
    ).rejects.toThrow(/already active/)
    expect(subagents.startCalls).toBe(1)
    const conflictRecord = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'task-review-extra', 'change-a', 'tasks', `${task}.json`),
        'utf8',
      ),
    ) as { verdict: string }
    expect(conflictRecord.verdict).toBe('ERROR')
    pending.releases.shift()?.()
    await harness.waitForRun(runIdFrom(first))
  })

  it('does not let a same-rule conflict overwrite the incumbent record', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const git = new FakeGit()
    git.files = ['src/engine.ts']
    const harness = new Harness({
      cwd: root,
      config: {
        targets: { codex: { provider: 'codex-subagent' } },
        rules: [
          {
            id: 'task-review',
            when: 'spec-task-ready',
            to: 'codex',
            contract: 'review',
            scope: 'task',
            gate: 'strict',
            instruction: 'bundled:review-task',
          },
        ],
      },
      agents: subagents,
      git,
      queueFault: () => {
        throw new Error('queue exploded')
      },
    })
    const task = taskIdFor('Reviewed task')
    const first = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task,
    })
    const firstRun = runIdFrom(first)
    git.status = 'M src/engine.ts'
    await expect(
      harness.toolText('delegate', { rule: 'task-review', change: 'change-a', task }),
    ).rejects.toThrow(/already active/)

    pending.releases.shift()?.()
    expect(await harness.waitForRun(firstRun)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks', `${task}.json`),
        'utf8',
      ),
    ) as { runId: string; verdict: string }
    expect(record.runId).toBe(firstRun)
    expect(record.verdict).toBe('PASS')

    const runs = await readdir(join(root, '.dsh', 'delegation', 'runs'))
    for (const name of runs) {
      const file = JSON.parse(
        await readFile(join(root, '.dsh', 'delegation', 'runs', name), 'utf8'),
      ) as { id: string; state: string; failureClass: string }
      if (file.id === firstRun) continue
      expect(file.state).toBe('failed')
      expect(file.failureClass).toBe('queue-internal-error')
    }
  })
  it('keeps queue-internal-error evidence when the fallback fails later', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, () => ({
      output: [],
      stopReason: 'completed' as const,
    }))
    const harness = new Harness({
      cwd: root,
      config: defaultTestConfig(),
      agents: subagents,
      queueFault: () => {
        throw new Error('queue exploded')
      },
    })
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const run = await readRun(root, runId)
    expect(run.failureClass).toBe('queue-internal-error')
    expect(String(run.detail)).toContain('queue-internal-error')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('queue-internal-error')
  })

  it('returns an ERROR record when the fallback cannot start', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    subagents.startError = new Error('cannot start')
    const harness = new Harness({
      cwd: root,
      config: defaultTestConfig(),
      agents: subagents,
      queueFault: () => {
        throw new Error('queue exploded')
      },
    })
    await expect(harness.startReview({ rule: 'spec-review', change: 'change-a' })).rejects.toThrow(
      /could not start/,
    )

    const runs = await readdir(join(root, '.dsh', 'delegation', 'runs'))
    expect(runs).toHaveLength(1)
    const run = JSON.parse(
      await readFile(join(root, '.dsh', 'delegation', 'runs', runs[0] as string), 'utf8'),
    ) as { failureClass: string; state: string }
    expect(run.failureClass).toBe('queue-internal-error')
    expect(run.state).toBe('failed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string }
    expect(record.verdict).toBe('ERROR')
  })
})

describe('queue fault during dispatch', () => {
  it('keeps ownership when the pump faults after dispatching a start', async () => {
    const internalFault = vi.fn(async (run: QueueRun) => {
      run.file.failureClass = 'queue-internal-error'
    })
    const hooks = {
      start: vi.fn(async () => undefined),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      internalFault,
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 2,
        maxAttempts: 3,
        baseDelayMs: 5_000,
        maxDelayMs: 60_000,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    const internals = queue as unknown as { pump: () => void }
    const originalPump = internals.pump.bind(queue)
    let inject = true
    internals.pump = () => {
      originalPump()
      if (inject) {
        inject = false
        throw new Error('injected pump fault')
      }
    }
    const run = fakeRun('run-a', 'key-a', 'identity-a')
    const admission = await queue.submit(run)
    expect(admission).toMatchObject({ kind: 'accepted', phase: 'running' })
    expect(hooks.start).toHaveBeenCalledTimes(1)
    expect(queue.owns('run-a')).toBe(true)
    expect(internalFault).toHaveBeenCalledTimes(1)
    expect(run.file.failureClass).toBe('queue-internal-error')
    await queue.complete(run, 'completed')
    queue.dispose()
  })
})

describe('stranded start recovery', () => {
  it('releases a start stranded by a bookkeeping fault and reports internally', async () => {
    let nowCalls = 0
    const internalFault = vi.fn()
    const hooks = {
      start: vi.fn(async () => {
        throw new Error('subagent limit reached (active child limit: 8)')
      }),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
      internalFault,
      now: () => {
        nowCalls += 1
        if (nowCalls === 4) throw new Error('clock fault')
        return new Date('2026-01-01T00:00:00.000Z')
      },
    }
    const queue = new ReviewQueue<QueueRun>(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 2,
        maxAttempts: 3,
        baseDelayMs: 10,
        maxDelayMs: 20,
        waitTimeoutMs: 300_000,
      },
      hooks,
    )
    const run = fakeRun('run-a', 'key-a', 'identity-a')
    await expect(queue.submit(run)).rejects.toThrow(/review queue internal error/)
    expect(internalFault).toHaveBeenCalledTimes(1)
    expect(queue.owns('run-a')).toBe(false)
    expect(queue.summary()).toMatchObject({ active: 0, queued: 0 })
    queue.dispose()
  })
})
