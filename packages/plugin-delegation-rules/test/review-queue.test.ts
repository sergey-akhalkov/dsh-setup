import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type QueueRun, ReviewQueue } from '../src/host/review-queue.js'
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

    pending.releases.shift()?.()
    expect(await harness.waitForRun(firstRun)).toContain('state=completed')
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
    const hooks = {
      start: vi.fn(async () => undefined),
      persist: vi.fn(),
      fail: vi.fn(async () => undefined),
      timeout: vi.fn(async () => undefined),
      settled: vi.fn(),
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
})

describe('review queue cancellation', () => {
  it('settles a queued run discarded without starting a target', async () => {
    const hooks = {
      start: vi.fn(async () => undefined),
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
