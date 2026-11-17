import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import type { SubagentRunner } from '../src/host/executors.ts'
import { defaultGit } from '../src/host/git.ts'
import {
  type ReviewRecord,
  type ReviewRunInput,
  resolveReviewers,
  reviewDigest,
  type SectionReview,
  sectionReviewDigest,
} from '../src/host/review.ts'
import type { QueueLimits } from '../src/host/review-queue.ts'
import { ReviewScheduler } from '../src/host/review-scheduler.ts'
import {
  createReviewSnapshot,
  discardReviewSnapshot,
  startSnapshotLease,
} from '../src/host/review-snapshot.ts'
import { createRun, type WorkflowRun } from '../src/host/runs.ts'
import { sectionRecordId } from '../src/host/tasks.ts'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-scheduler-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

function definition(): Definition {
  return validateDefinition({
    v: 1,
    id: 'spec-review',
    name: 'Spec review',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'turn' },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
      gate: 'review',
      gateIdentity: 'spec-review',
      legacy: { plugin: 'delegation-rules', signal: 'spec-review' },
    },
    steps: [
      {
        id: 'review',
        title: 'Review the whole spec',
        executor: 'review',
        review: { target: 'codex', instruction: 'review-spec', scope: 'whole', phase: 'spec' },
        evidence: {
          kind: 'record',
          rule: 'spec-review',
          change: '{name}',
          scope: 'whole',
          phase: 'spec',
          verdicts: ['PASS', 'ERROR'],
          digest: 'current',
          path: '.dsh/workflows/records/spec-review/{name}/spec.json',
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
}

function reviewers() {
  const map = resolveReviewers({ codex: { provider: 'codex-subagent' } })
  const found = map.codex
  if (found === undefined) throw new Error('test reviewer missing')
  return { id: 'codex', ...found }
}

function fencedPASS(digest: string): string {
  return `Review.\n\n\`\`\`json\n${JSON.stringify({ digest, verdict: 'PASS', findings: [] })}\n\`\`\``
}

/** A workspace with one change, plus its current whole-spec digest. */
async function reviewWorkspace(): Promise<{ root: string; digest: string }> {
  const root = await workspace()
  const changeDir = join(root, 'openspec', 'changes', 'auth')
  await mkdir(changeDir, { recursive: true })
  await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
  const digest = await currentSpecDigest(root, 'auth')
  if (digest === undefined) throw new Error('test change digest missing')
  return { root, digest }
}

function runFor(def: Definition): WorkflowRun {
  return createRun({
    definition: def.id,
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth' },
    steps: ['review'],
    now: 1_000,
  })
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('condition did not settle in time')
}

describe('review scheduler', () => {
  it('admits a review, settles the run in the background, and writes the record', async () => {
    const { root, digest } = await reviewWorkspace()
    await mkdir(join(root, '.dsh'), { recursive: true })
    const def = definition()
    const persisted: WorkflowRun[] = []
    const scheduler = new ReviewScheduler(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 2,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        waitTimeoutMs: 10_000,
      },
      {
        persistRun: async (_workspace, run) => {
          persisted.push(run)
          return run
        },
        discardSnapshot: async () => undefined,
      },
    )
    const runner: SubagentRunner = {
      run: async () => ({ childId: 'child-1', completed: true, text: fencedPASS(digest) }),
    }
    const run = runFor(def)
    const request = {
      run,
      definition: def,
      step: def.steps[0] as Definition['steps'][number],
      reviewer: reviewers(),
      runner,
      context: { workspace: root, values: { name: 'auth' } },
      change: 'auth',
      prepared: { specDigest: digest },
      timeoutMs: 5_000,
      session: 'session-1',
    }
    const admission = await scheduler.enqueue({
      workspace: root,
      run,
      request,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    expect(admission.kind).toBe('accepted')
    await waitFor(async () => persisted.length === 1)
    expect(persisted[0]?.steps[0]?.state).toBe('done')
    const record = JSON.parse(
      await readFile(join(root, '.dsh/workflows/records/spec-review/auth/spec.json'), 'utf8'),
    ) as ReviewRecord
    expect(record.verdict).toBe('PASS')
    scheduler.dispose()
  })

  it('dedupes a live identity while distinct identities start immediately', async () => {
    const { root, digest } = await reviewWorkspace()
    const def = definition()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const scheduler = new ReviewScheduler(
      // The retired limits are accepted and ignored: three distinct identities
      // start together despite concurrency 1 and maxQueued 1.
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 1,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        waitTimeoutMs: 10_000,
      },
      {
        persistRun: async (_workspace, run) => run,
        discardSnapshot: async () => undefined,
      },
    )
    const runner: SubagentRunner = {
      run: async () => {
        calls += 1
        await gate
        return { childId: 'child-1', completed: true, text: fencedPASS(digest) }
      },
    }
    const run = runFor(def)
    const request = {
      run,
      definition: def,
      step: def.steps[0] as Definition['steps'][number],
      reviewer: reviewers(),
      runner,
      context: { workspace: root, values: { name: 'auth' } },
      change: 'auth',
      prepared: { specDigest: digest },
      timeoutMs: 5_000,
      session: 'session-1',
    }
    const first = await scheduler.enqueue({
      workspace: root,
      run,
      request,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    expect(first.kind).toBe('accepted')
    const duplicate = await scheduler.enqueue({
      workspace: root,
      run,
      request,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    expect(duplicate.kind).toBe('duplicate')
    for (const [index, change] of ['other', 'third'].entries()) {
      const otherRun = createRun({
        definition: def.id,
        trigger: 'turn.stopping',
        session: `session-${String(index + 2)}`,
        workspace: '/workspace',
        context: { name: change },
        steps: ['review'],
        now: 1_000,
      })
      const admission = await scheduler.enqueue({
        workspace: root,
        run: otherRun,
        request: {
          ...request,
          run: otherRun,
          context: { workspace: root, values: { name: change } },
          change,
        },
        rule: 'spec-review',
        change,
        digest,
      })
      expect(admission).toEqual({ kind: 'accepted', phase: 'running' })
    }
    // Every distinct identity started; no admission was queued or refused.
    expect(calls).toBe(3)
    expect(scheduler.summary()).toMatchObject({ active: 3 })
    release?.()
    await waitFor(async () => scheduler.summary().active === 0)
    scheduler.dispose()
  })

  it('reports a live section run as covering each of its recorded tasks', async () => {
    const { root, digest } = await reviewWorkspace()
    const def = focusedTaskDefinition()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = new ReviewScheduler(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 2,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        waitTimeoutMs: 10_000,
      },
      {
        persistRun: async (_workspace, run) => run,
        discardSnapshot: async () => undefined,
      },
    )
    const section: SectionReview = {
      key: '1',
      title: '1. Engine',
      recordId: sectionRecordId('1'),
      covered: [
        { id: 'a'.repeat(16), number: '1.1', text: 'First task' },
        { id: 'b'.repeat(16), number: '1.2', text: 'Second task' },
      ],
      unchecked: [],
    }
    const run = createRun({
      definition: def.id,
      trigger: 'fs.change',
      session: 'session-1',
      workspace: root,
      context: {
        name: 'auth',
        taskId: section.recordId,
        section: section.key,
        sectionTitle: section.title,
        taskIds: section.covered.map((task) => task.id),
      },
      steps: ['review'],
      now: 1_000,
    })
    const digestOf = sectionReviewDigest(section, digest)
    const request: ReviewRunInput = {
      run,
      definition: def,
      step: def.steps[0] as Definition['steps'][number],
      reviewer: reviewers(),
      runner: {
        run: async () => {
          await gate
          return { childId: 'child-1', completed: true, text: fencedPASS(digestOf) }
        },
      },
      context: { workspace: root, values: { name: 'auth' } },
      change: 'auth',
      prepared: { specDigest: digest, section },
      timeoutMs: 5_000,
      session: 'session-1',
    }
    const admission = await scheduler.enqueue({
      workspace: root,
      run,
      request,
      rule: 'task-review',
      change: 'auth',
      taskId: section.recordId,
      digest: digestOf,
    })
    expect(admission.kind).toBe('accepted')
    // A per-task request for a covered task is not a new review identity, but
    // the coverage check sees the section run already reviewing it.
    expect(scheduler.liveCovering(root, 'auth', [section.covered[0]?.id as string])?.id).toBe(
      run.id,
    )
    expect(scheduler.liveCovering(root, 'auth', ['f'.repeat(16)])).toBeUndefined()
    expect(
      scheduler.liveCovering(root, 'other', [section.covered[0]?.id as string]),
    ).toBeUndefined()
    release?.()
    await waitFor(async () => scheduler.summary().active === 0)
    scheduler.dispose()
  })

  it('refuses a task review covered by an already-admitted section review', async () => {
    const { root, digest } = await reviewWorkspace()
    const def = focusedTaskDefinition()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = new ReviewScheduler(
      {
        enabled: true,
        concurrency: 2,
        maxQueued: 2,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        waitTimeoutMs: 10_000,
      },
      {
        persistRun: async (_workspace, run) => run,
        discardSnapshot: async () => undefined,
      },
    )
    const [firstTask, secondTask] = ['a'.repeat(16), 'b'.repeat(16)]
    const section: SectionReview = {
      key: '1',
      title: '1. Engine',
      recordId: sectionRecordId('1'),
      covered: [
        { id: firstTask, number: '1.1', text: 'First task' },
        { id: secondTask, number: '1.2', text: 'Second task' },
      ],
      unchecked: [],
    }
    const sectionRun = createRun({
      definition: def.id,
      trigger: 'fs.change',
      session: 'session-1',
      workspace: root,
      context: {
        name: 'auth',
        taskId: section.recordId,
        section: section.key,
        sectionTitle: section.title,
        taskIds: section.covered.map((task) => task.id),
      },
      steps: ['review'],
      now: 1_000,
    })
    const sectionDigest = sectionReviewDigest(section, digest)
    const sectionAdmission = await scheduler.enqueue({
      workspace: root,
      run: sectionRun,
      request: {
        run: sectionRun,
        definition: def,
        step: def.steps[0] as Definition['steps'][number],
        reviewer: reviewers(),
        runner: {
          run: async () => {
            await gate
            return { childId: 'child-1', completed: true, text: fencedPASS(sectionDigest) }
          },
        },
        context: { workspace: root, values: { name: 'auth' } },
        change: 'auth',
        prepared: { specDigest: digest, section },
        timeoutMs: 5_000,
        session: 'session-1',
      },
      rule: 'task-review',
      change: 'auth',
      taskId: section.recordId,
      digest: sectionDigest,
    })
    expect(sectionAdmission.kind).toBe('accepted')
    // The section already reviews the first task; a per-task admission for it
    // must not start a second reviewer.
    const taskRun = createRun({
      definition: def.id,
      trigger: 'fs.change',
      session: 'session-2',
      workspace: root,
      context: { name: 'auth', taskId: firstTask },
      steps: ['review'],
      now: 1_100,
    })
    const duplicate = await scheduler.enqueue({
      workspace: root,
      run: taskRun,
      request: {
        run: taskRun,
        definition: def,
        step: def.steps[0] as Definition['steps'][number],
        reviewer: reviewers(),
        runner: {
          run: async () => {
            await gate
            return {
              childId: 'child-2',
              completed: true,
              text: fencedPASS(reviewDigest({ scope: 'task', specDigest: digest })),
            }
          },
        },
        context: { workspace: root, values: { name: 'auth', taskId: firstTask } },
        change: 'auth',
        task: { id: firstTask, number: '1.1', text: 'First task' },
        prepared: { specDigest: digest },
        timeoutMs: 5_000,
        session: 'session-1',
      },
      rule: 'task-review',
      change: 'auth',
      taskId: firstTask,
      digest: reviewDigest({ scope: 'task', specDigest: digest }),
    })
    expect(duplicate).toEqual({ kind: 'duplicate', runId: sectionRun.id })
    expect(scheduler.summary().active).toBe(1)
    release?.()
    await waitFor(async () => scheduler.summary().active === 0)
    scheduler.dispose()
  })

  it('cancels a queued review when its run is fenced before it starts', async () => {
    const { root, digest } = await reviewWorkspace()
    const def = definition()
    const persisted: WorkflowRun[] = []
    let releaseActive: (() => void) | undefined
    const activeGate = new Promise<void>((resolve) => {
      releaseActive = resolve
    })
    let activeRunCalls = 0
    const fencedRunCalls: string[] = []
    const scheduler = new ReviewScheduler(
      {
        enabled: true,
        concurrency: 1,
        maxQueued: 2,
        maxAttempts: 1,
        baseDelayMs: 0,
        maxDelayMs: 0,
        waitTimeoutMs: 10_000,
      },
      {
        persistRun: async (_workspace, run) => {
          persisted.push(run)
          return run
        },
        discardSnapshot: async () => undefined,
      },
    )
    const activeRunner: SubagentRunner = {
      run: async () => {
        activeRunCalls += 1
        await activeGate
        return { childId: 'child-1', completed: true, text: fencedPASS(digest) }
      },
    }
    const activeRun = runFor(def)
    const request = {
      run: activeRun,
      definition: def,
      step: def.steps[0] as Definition['steps'][number],
      reviewer: reviewers(),
      runner: activeRunner,
      context: { workspace: root, values: { name: 'auth' } },
      change: 'auth',
      prepared: { specDigest: digest },
      timeoutMs: 5_000,
      session: 'session-1',
    }
    const active = await scheduler.enqueue({
      workspace: root,
      run: activeRun,
      request,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    expect(active.kind).toBe('accepted')
    const fencedRun = createRun({
      definition: def.id,
      trigger: 'turn.stopping',
      session: 'session-2',
      workspace: '/workspace',
      context: { name: 'auth' },
      steps: ['review'],
      now: 2_000,
    })
    const fencedDigest = 'b'.repeat(64)
    const queued = await scheduler.enqueue({
      workspace: root,
      run: fencedRun,
      request: {
        ...request,
        run: fencedRun,
        runner: {
          run: async () => {
            fencedRunCalls.push('started')
            return { childId: 'child-2', completed: true, text: fencedPASS(fencedDigest) }
          },
        },
        prepared: { specDigest: fencedDigest },
        session: 'session-2',
      },
      rule: 'spec-review',
      change: 'auth',
      digest: fencedDigest,
    })
    expect(queued).toEqual({ kind: 'accepted', phase: 'queued' })
    scheduler.fence(fencedRun.id)
    await waitFor(async () => scheduler.liveRunById(fencedRun.id) === undefined)
    expect(fencedRunCalls).toEqual([])
    expect(persisted.some((run) => run.id === fencedRun.id)).toBe(false)
    releaseActive?.()
    await waitFor(async () => persisted.length === 1)
    expect(persisted[0]?.id).toBe(activeRun.id)
    expect(activeRunCalls).toBe(1)
    scheduler.dispose()
  })
})

it('retries a transient review start before settling', async () => {
  const { root, digest } = await reviewWorkspace()
  const def = definition()
  let calls = 0
  const persisted: WorkflowRun[] = []
  const attemptsSeen: Array<[number, string | undefined]> = []
  const scheduler = new ReviewScheduler(
    {
      enabled: true,
      concurrency: 1,
      maxQueued: 2,
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      waitTimeoutMs: 10_000,
    },
    {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async () => undefined,
      persistReviewAttempts: async (_workspace, _runId, _stepId, attempts, failureClass) => {
        attemptsSeen.push([attempts, failureClass])
      },
    },
  )
  const runner: SubagentRunner = {
    run: async () => {
      calls += 1
      if (calls === 1) throw new Error('active child limit reached')
      return { childId: 'child-1', completed: true, text: fencedPASS(digest) }
    },
  }
  const run = runFor(def)
  const request = {
    run,
    definition: def,
    step: def.steps[0] as Definition['steps'][number],
    reviewer: reviewers(),
    runner,
    context: { workspace: root, values: { name: 'auth' } },
    change: 'auth',
    prepared: { specDigest: digest },
    timeoutMs: 5_000,
    session: 'session-1',
  }
  await scheduler.enqueue({
    workspace: root,
    run,
    request,
    rule: 'spec-review',
    change: 'auth',
    digest,
  })
  await waitFor(async () => persisted.length === 1)
  expect(calls).toBe(2)
  expect(persisted[0]?.steps[0]?.state).toBe('done')
  // The retry's attempt facts reach the host while it is active, and the settled
  // record carries the final attempt count.
  expect(attemptsSeen.some(([count]) => count === 1)).toBe(true)
  expect(attemptsSeen.some(([, failureClass]) => failureClass === 'child-limit')).toBe(true)
  expect(attemptsSeen.at(-1)?.[0]).toBe(2)
  const record = JSON.parse(
    await readFile(
      join(root, '.dsh', 'workflows', 'records', 'spec-review', 'auth', 'spec.json'),
      'utf8',
    ),
  ) as Record<string, unknown>
  expect(record.attempts).toBe(2)
  scheduler.dispose()
})

it('reports the live run before a snapshot and clears it after settle', async () => {
  const { root, digest } = await reviewWorkspace()
  const def = definition()
  const persisted: WorkflowRun[] = []
  const scheduler = new ReviewScheduler(
    {
      enabled: true,
      concurrency: 1,
      maxQueued: 2,
      maxAttempts: 2,
      baseDelayMs: 0,
      maxDelayMs: 0,
      waitTimeoutMs: 10_000,
    },
    {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async () => undefined,
    },
  )
  const runner: SubagentRunner = {
    run: async () => ({ childId: 'child-1', completed: true, text: fencedPASS(digest) }),
  }
  const run = runFor(def)
  const request = {
    run,
    definition: def,
    step: def.steps[0] as Definition['steps'][number],
    reviewer: reviewers(),
    runner,
    context: { workspace: root, values: { name: 'auth' } },
    change: 'auth',
    prepared: { specDigest: digest },
    timeoutMs: 5_000,
    session: 'session-1',
  }
  await scheduler.enqueue({
    workspace: root,
    run,
    request,
    rule: 'spec-review',
    change: 'auth',
    digest,
  })
  const identity = { workspace: root, rule: 'spec-review', change: 'auth' }
  expect(scheduler.liveRun(identity)?.id).toBe(run.id)
  await waitFor(async () => persisted.length === 1)
  expect(scheduler.liveRun(identity)).toBeUndefined()
  scheduler.dispose()
})

it('stops transient retries at maxAttempts', async () => {
  const { root, digest } = await reviewWorkspace()
  const def = definition()
  let calls = 0
  const persisted: WorkflowRun[] = []
  const scheduler = new ReviewScheduler(
    {
      enabled: true,
      concurrency: 1,
      maxQueued: 2,
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      waitTimeoutMs: 10_000,
    },
    {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async () => undefined,
    },
  )
  const runner: SubagentRunner = {
    run: async () => {
      calls += 1
      throw new Error('active child limit reached')
    },
  }
  const run = runFor(def)
  const request = {
    run,
    definition: def,
    step: def.steps[0] as Definition['steps'][number],
    reviewer: reviewers(),
    runner,
    context: { workspace: root, values: { name: 'auth' } },
    change: 'auth',
    prepared: { specDigest: digest },
    timeoutMs: 5_000,
    session: 'session-1',
  }
  await scheduler.enqueue({
    workspace: root,
    run,
    request,
    rule: 'spec-review',
    change: 'auth',
    digest,
  })
  await waitFor(async () => persisted.length === 1)
  expect(calls).toBe(1)
  scheduler.dispose()
})

it('rechecks the live guard after teardown and refuses a PASS', async () => {
  const { root, digest } = await reviewWorkspace()
  const def = definition()
  let changed = false
  const persisted: WorkflowRun[] = []
  const scheduler = new ReviewScheduler(
    {
      enabled: true,
      concurrency: 1,
      maxQueued: 2,
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      waitTimeoutMs: 10_000,
    },
    {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async () => undefined,
    },
  )
  const runner: SubagentRunner = {
    run: async () => ({ childId: 'child-1', completed: true, text: fencedPASS(digest) }),
    waitForTeardown: async () => {
      changed = true
    },
  }
  const run = runFor(def)
  const request = {
    run,
    definition: def,
    step: def.steps[0] as Definition['steps'][number],
    reviewer: reviewers(),
    runner,
    context: { workspace: root, values: { name: 'auth' } },
    change: 'auth',
    prepared: {
      specDigest: digest,
      liveGuard: async () => (changed ? 'changed: src/engine.ts' : undefined),
    },
    timeoutMs: 5_000,
    session: 'session-1',
  }
  await scheduler.enqueue({
    workspace: root,
    run,
    request,
    rule: 'spec-review',
    change: 'auth',
    digest,
  })
  await waitFor(async () => persisted.length === 1)
  const record = JSON.parse(
    await readFile(join(root, '.dsh/workflows/records/spec-review/auth/spec.json'), 'utf8'),
  ) as ReviewRecord
  expect(record.verdict).toBe('ERROR')
  scheduler.dispose()
})

it('admits distinct whole-scope phases separately', async () => {
  const { root, digest } = await reviewWorkspace()
  const def = definition()
  const persisted: WorkflowRun[] = []
  const scheduler = new ReviewScheduler(
    {
      enabled: true,
      concurrency: 2,
      maxQueued: 2,
      maxAttempts: 1,
      baseDelayMs: 0,
      maxDelayMs: 0,
      waitTimeoutMs: 10_000,
    },
    {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async () => undefined,
    },
  )
  const runner: SubagentRunner = {
    run: async () => ({ childId: 'child-1', completed: true, text: fencedPASS(digest) }),
  }
  const requestFor = (run: WorkflowRun) => ({
    run,
    definition: def,
    step: def.steps[0] as Definition['steps'][number],
    reviewer: reviewers(),
    runner,
    context: { workspace: root, values: { name: 'auth' } },
    change: 'auth',
    prepared: { specDigest: digest },
    timeoutMs: 5_000,
    session: 'session-1',
  })
  const specRun = runFor(def)
  const integrationRun = runFor(def)
  await scheduler.enqueue({
    workspace: root,
    run: specRun,
    request: requestFor(specRun),
    rule: 'spec-review',
    change: 'auth',
    phase: 'spec',
    digest,
  })
  await scheduler.enqueue({
    workspace: root,
    run: integrationRun,
    request: requestFor(integrationRun),
    rule: 'spec-review',
    change: 'auth',
    phase: 'integration',
    digest,
  })
  await waitFor(async () => persisted.length === 2)
  expect(persisted.length).toBe(2)
  scheduler.dispose()
})
describe('review snapshot', () => {
  it('builds a frozen checkout, copies the change, and discards it', async () => {
    const root = await workspace()
    await writeFile(join(root, '.gitignore'), '.dsh/\n', 'utf8')
    await mkdir(join(root, 'openspec', 'changes', 'auth'), { recursive: true })
    await writeFile(
      join(root, 'openspec', 'changes', 'auth', 'proposal.md'),
      '# Proposal\n',
      'utf8',
    )
    await defaultGit(['init'], root)
    await defaultGit(['config', 'user.name', 'test'], root)
    await defaultGit(['config', 'user.email', 'test@localhost'], root)
    await defaultGit(['add', '-A'], root)
    await defaultGit(['commit', '-m', 'init'], root)
    const snapshot = await createReviewSnapshot(
      root,
      { dir: join(root, 'openspec', 'changes', 'auth') },
      'run-1',
      defaultGit,
      new AbortController().signal,
    )
    expect(snapshot).toBeDefined()
    if (snapshot === undefined) return
    expect(existsSync(join(snapshot.worktree, 'openspec', 'changes', 'auth', 'proposal.md'))).toBe(
      true,
    )
    expect(snapshot.specDigest).toHaveLength(64)
    await discardReviewSnapshot(root, 'run-1', defaultGit)
    expect(existsSync(snapshot.worktree)).toBe(false)
  })
})

function limitsFor(overrides: Partial<QueueLimits> = {}): QueueLimits {
  return {
    enabled: true,
    concurrency: 1,
    maxQueued: 2,
    maxAttempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
    waitTimeoutMs: 10_000,
    ...overrides,
  }
}

function requestFor(
  root: string,
  digest: string,
  overrides: Partial<ReviewRunInput> = {},
): ReviewRunInput {
  const def = definition()
  const base: ReviewRunInput = {
    run: runFor(def),
    definition: def,
    step: def.steps[0] as Definition['steps'][number],
    reviewer: reviewers(),
    runner: {
      run: async () => ({ childId: 'child-1', completed: true, text: fencedPASS(digest) }),
    },
    context: { workspace: root, values: { name: 'auth' } },
    change: 'auth',
    prepared: { specDigest: digest },
    timeoutMs: 5_000,
    session: 'session-1',
  }
  return { ...base, ...overrides }
}

function recordPath(root: string, change = 'auth'): string {
  return join(root, '.dsh/workflows/records/spec-review', change, 'spec.json')
}

describe('review scheduler retries and publication', () => {
  it('publishes nothing on an intermediate retry and only the settled verdict', async () => {
    const { root, digest } = await reviewWorkspace()
    await mkdir(join(root, '.dsh'), { recursive: true })
    const persisted: WorkflowRun[] = []
    let calls = 0
    const scheduler = new ReviewScheduler(
      limitsFor({ maxAttempts: 2, baseDelayMs: 150, maxDelayMs: 150 }),
      {
        persistRun: async (_workspace, run) => {
          persisted.push(run)
          return run
        },
        discardSnapshot: async () => undefined,
      },
    )
    const runner: SubagentRunner = {
      run: async () => {
        calls += 1
        if (calls === 1) throw new Error('active child limit reached')
        return { childId: 'child-1', completed: true, text: fencedPASS(digest) }
      },
    }
    const request = requestFor(root, digest, { runner })
    const admission = await scheduler.enqueue({
      workspace: root,
      run: request.run,
      request,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    expect(admission.kind).toBe('accepted')
    await waitFor(async () => calls === 1)
    await new Promise((resolve) => setTimeout(resolve, 60))
    // The retrying attempt publishes neither an ERROR nor a verdict.
    expect(existsSync(recordPath(root))).toBe(false)
    expect(persisted).toEqual([])
    await waitFor(async () => persisted.length === 1)
    expect(calls).toBe(2)
    const record = JSON.parse(await readFile(recordPath(root), 'utf8')) as ReviewRecord
    expect(record.verdict).toBe('PASS')
    expect(persisted[0]?.steps[0]?.state).toBe('done')
    scheduler.dispose()
  })

  it('settles a permanent permission failure without retrying and keeps its diagnostic', async () => {
    const { root, digest } = await reviewWorkspace()
    await mkdir(join(root, '.dsh'), { recursive: true })
    const persisted: WorkflowRun[] = []
    let calls = 0
    const scheduler = new ReviewScheduler(
      limitsFor({ maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 }),
      {
        persistRun: async (_workspace, run) => {
          persisted.push(run)
          return run
        },
        discardSnapshot: async () => undefined,
      },
    )
    const runner: SubagentRunner = {
      run: async () => {
        calls += 1
        throw new Error('permission denied: reviewer is not authorized for this workspace')
      },
    }
    const request = requestFor(root, digest, { runner })
    await scheduler.enqueue({
      workspace: root,
      run: request.run,
      request,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    await waitFor(async () => persisted.length === 1)
    expect(calls).toBe(1)
    const record = JSON.parse(await readFile(recordPath(root), 'utf8')) as ReviewRecord
    expect(record.verdict).toBe('ERROR')
    expect(record.failureClass).toBe('permission')
    expect(record.error).toContain('permission denied')
    scheduler.dispose()
  })
})

describe('review scheduler admission', () => {
  it('keeps a shared-key follower waiting past the retired wait timeout', async () => {
    const { root, digest } = await reviewWorkspace()
    const persisted: WorkflowRun[] = []
    let releaseFirst: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const scheduler = new ReviewScheduler(
      // A profile may still carry the retired wait limit; it must not settle
      // the follower while the shared unit thread is busy.
      limitsFor({
        maxAttempts: 1,
        baseDelayMs: 1_000,
        maxDelayMs: 1_000,
        waitTimeoutMs: 20,
        concurrency: 1,
        maxQueued: 1,
      }),
      {
        persistRun: async (_workspace, run) => {
          persisted.push(run)
          return run
        },
        discardSnapshot: async () => undefined,
      },
    )
    const first = requestFor(root, digest, {
      runner: {
        run: async () => {
          await gate
          return { childId: 'child-1', completed: true, text: fencedPASS(digest) }
        },
      },
    })
    await scheduler.enqueue({
      workspace: root,
      run: first.run,
      request: first,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    const secondDigest = 'b'.repeat(64)
    const second = requestFor(root, secondDigest)
    const admission = await scheduler.enqueue({
      workspace: root,
      run: second.run,
      request: second,
      rule: 'spec-review',
      change: 'auth',
      digest: secondDigest,
    })
    expect(admission).toEqual({ kind: 'accepted', phase: 'queued' })
    await new Promise((resolve) => setTimeout(resolve, 60))
    // No admission timeout: the follower still waits and nothing settled.
    expect(persisted).toEqual([])
    releaseFirst?.()
    await waitFor(async () => persisted.length === 2, 5_000)
    expect(persisted.map((run) => run.id)).toEqual([first.run.id, second.run.id])
    scheduler.dispose()
  })
})

describe('review scheduler quarantine', () => {
  it('retains the key, live identity, and snapshot until teardown is confirmed', async () => {
    const { root, digest } = await reviewWorkspace()
    const persisted: WorkflowRun[] = []
    const discarded: string[] = []
    const settled: string[] = []
    let teardownConfirmed = false
    let teardownCalls = 0
    let secondCalls = 0
    let releaseSecond: (() => void) | undefined
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const scheduler = new ReviewScheduler(
      limitsFor({ maxAttempts: 1, baseDelayMs: 10, maxDelayMs: 20 }),
      {
        persistRun: async (_workspace, run) => {
          persisted.push(run)
          return run
        },
        discardSnapshot: async (_workspace, runId) => {
          discarded.push(runId)
        },
        onSettled: (status) => {
          settled.push(`${status.runId}:${status.state}`)
        },
      },
    )
    const hanging = (): Promise<{ childId: string; completed: boolean }> =>
      new Promise(() => undefined)
    const runner: SubagentRunner = {
      run: hanging,
      waitForTeardown: async () => {
        teardownCalls += 1
        if (!teardownConfirmed) throw new Error('teardown unconfirmed')
      },
    }
    const first = requestFor(root, digest, { runner, timeoutMs: 25 })
    await scheduler.enqueue({
      workspace: root,
      run: first.run,
      request: first,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    await waitFor(async () => persisted.length === 1 && settled.length === 1, 5_000)
    const record = JSON.parse(await readFile(recordPath(root), 'utf8')) as ReviewRecord
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('could not be confirmed cancelled')
    expect(settled).toEqual([`${first.run.id}:failed`])
    // The quarantined run keeps its live key and both snapshots.
    expect(
      scheduler.liveRun({
        workspace: root,
        rule: 'spec-review',
        change: 'auth',
        digest,
        reviewer: 'codex',
      })?.id,
    ).toBe(first.run.id)
    expect(discarded).toEqual([])
    // A same-thread demand waits behind the quarantined key instead of starting.
    const secondDigest = 'b'.repeat(64)
    const second = requestFor(root, secondDigest, {
      runner: {
        run: async () => {
          secondCalls += 1
          await secondGate
          return { childId: 'child-2', completed: true, text: fencedPASS(secondDigest) }
        },
      },
    })
    const secondRun = createRun({
      definition: 'spec-review',
      trigger: 'turn.stopping',
      session: 'session-2',
      workspace: '/workspace',
      context: { name: 'auth' },
      steps: ['review'],
      now: 1_000,
    })
    const admission = await scheduler.enqueue({
      workspace: root,
      run: secondRun,
      request: { ...second, run: secondRun },
      rule: 'spec-review',
      change: 'auth',
      digest: secondDigest,
    })
    expect(admission.kind).toBe('accepted')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(secondCalls).toBe(0)
    teardownConfirmed = true
    await waitFor(async () => discarded.includes(first.run.id), 5_000)
    await waitFor(async () => secondCalls === 1, 5_000)
    expect(teardownCalls).toBeGreaterThan(1)
    expect(
      scheduler.liveRun({
        workspace: root,
        rule: 'spec-review',
        change: 'auth',
        digest,
        reviewer: 'codex',
      }),
    ).toBeUndefined()
    releaseSecond?.()
    await waitFor(async () => persisted.some((run) => run.id === secondRun.id))
    scheduler.dispose()
  })
})

describe('review scheduler live identity', () => {
  it('does not conflate a different digest or reviewer with a live run', async () => {
    const { root, digest } = await reviewWorkspace()
    const map = resolveReviewers({
      codex: { provider: 'codex-subagent' },
      other: { provider: 'codex-subagent' },
    })
    const other = map.other
    if (other === undefined) throw new Error('test reviewer missing')
    const scheduler = new ReviewScheduler(limitsFor({ concurrency: 2, maxAttempts: 1 }), {
      persistRun: async (_workspace, run) => run,
      discardSnapshot: async () => undefined,
    })
    const pending = (): Promise<{ childId: string; completed: boolean }> =>
      new Promise(() => undefined)
    const first = requestFor(root, digest, { runner: { run: pending } })
    await scheduler.enqueue({
      workspace: root,
      run: first.run,
      request: first,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    const sameIdentity = {
      workspace: root,
      rule: 'spec-review',
      change: 'auth',
      digest,
      reviewer: 'codex',
    }
    expect(scheduler.liveRun(sameIdentity)?.id).toBe(first.run.id)
    expect(scheduler.liveRun({ ...sameIdentity, digest: 'b'.repeat(64) })).toBeUndefined()
    expect(scheduler.liveRun({ ...sameIdentity, reviewer: 'other' })).toBeUndefined()
    const second = requestFor(root, digest, { runner: { run: pending } })
    const otherRun = createRun({
      definition: 'spec-review',
      trigger: 'turn.stopping',
      session: 'session-2',
      workspace: '/workspace',
      context: { name: 'auth' },
      steps: ['review'],
      now: 1_000,
    })
    const accepted = await scheduler.enqueue({
      workspace: root,
      run: otherRun,
      request: { ...second, run: otherRun, reviewer: { id: 'other', ...other } },
      rule: 'spec-review',
      change: 'auth',
      digest: 'b'.repeat(64),
    })
    expect(accepted.kind).toBe('accepted')
    scheduler.dispose()
  })
})

describe('review scheduler queued re-preparation', () => {
  it('re-checks a queued entry and starts on the replaced identity', async () => {
    const { root, digest } = await reviewWorkspace()
    const persisted: WorkflowRun[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const prompts: string[] = []
    const scheduler = new ReviewScheduler(limitsFor({ maxAttempts: 1, waitTimeoutMs: 10_000 }), {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async () => undefined,
    })
    const first = requestFor(root, digest, {
      runner: {
        run: async () => {
          await firstGate
          return { childId: 'child-1', completed: true, text: fencedPASS(digest) }
        },
      },
    })
    await scheduler.enqueue({
      workspace: root,
      run: first.run,
      request: first,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    const queuedRun = createRun({
      definition: 'spec-review',
      trigger: 'turn.stopping',
      session: 'session-2',
      workspace: '/workspace',
      context: { name: 'auth' },
      steps: ['review'],
      now: 1_000,
    })
    const queuedDigest = 'b'.repeat(64)
    const replacedDigest = 'c'.repeat(64)
    const queued = requestFor(root, queuedDigest, {
      run: queuedRun,
      renderPrompt: (prompt) => prompt.digest,
      runner: {
        run: async (request) => {
          prompts.push(request.prompt)
          return { childId: 'child-2', completed: true, text: fencedPASS(replacedDigest) }
        },
      },
    })
    const preparings: boolean[] = []
    const admission = await scheduler.enqueue({
      workspace: root,
      run: queuedRun,
      request: queued,
      rule: 'spec-review',
      change: 'auth',
      digest: queuedDigest,
      reprepare: async (already) => {
        preparings.push(already)
        return {
          kind: 'replaced',
          prepared: { specDigest: replacedDigest },
          digest: replacedDigest,
          liveDigest: replacedDigest,
        }
      },
    })
    expect(admission.kind).toBe('accepted')
    releaseFirst?.()
    await waitFor(async () => prompts.length === 1)
    expect(preparings).toEqual([false])
    expect(prompts[0]).toBe(replacedDigest)
    await waitFor(async () => persisted.length === 2)
    const record = JSON.parse(await readFile(recordPath(root), 'utf8')) as ReviewRecord
    expect(record.digest).toBe(replacedDigest)
    scheduler.dispose()
  })

  it('settles a second change after the one re-preparation as a permanent failure', async () => {
    const { root, digest } = await reviewWorkspace()
    const persisted: WorkflowRun[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const scheduler = new ReviewScheduler(limitsFor({ maxAttempts: 2 }), {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async () => undefined,
    })
    const first = requestFor(root, digest, {
      runner: {
        run: async () => {
          await firstGate
          return { childId: 'child-1', completed: true, text: fencedPASS(digest) }
        },
      },
    })
    await scheduler.enqueue({
      workspace: root,
      run: first.run,
      request: first,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    const queuedRun = createRun({
      definition: 'spec-review',
      trigger: 'turn.stopping',
      session: 'session-2',
      workspace: '/workspace',
      context: { name: 'auth' },
      steps: ['review'],
      now: 1_000,
    })
    const queuedDigest = 'b'.repeat(64)
    let attempts = 0
    const queued = requestFor(root, queuedDigest, {
      run: queuedRun,
      runner: {
        run: async () => {
          attempts += 1
          throw new Error('active child limit reached')
        },
      },
    })
    const preparings: boolean[] = []
    await scheduler.enqueue({
      workspace: root,
      run: queuedRun,
      request: queued,
      rule: 'spec-review',
      change: 'auth',
      digest: queuedDigest,
      reprepare: async (already) => {
        preparings.push(already)
        if (already) {
          throw new Error(
            'reviewed inputs changed again while the review waited in the queue; a review re-prepares only once',
          )
        }
        return {
          kind: 'replaced',
          prepared: { specDigest: 'c'.repeat(64) },
          digest: 'c'.repeat(64),
          liveDigest: 'c'.repeat(64),
        }
      },
    })
    releaseFirst?.()
    await waitFor(async () => persisted.length === 2, 5_000)
    expect(attempts).toBe(1)
    expect(preparings).toEqual([false, true])
    const record = JSON.parse(await readFile(recordPath(root), 'utf8')) as ReviewRecord
    expect(record.verdict).toBe('ERROR')
    expect(record.failureClass).toBe('reviewed-inputs-changed')
    expect(record.error).toContain('re-prepares only once')
    scheduler.dispose()
  })
})

const TASK_ID = '0123456789abcdef'

/** A task-scope definition, so a PASS also writes the portable approval. */
function focusedTaskDefinition(): Definition {
  return validateDefinition({
    v: 1,
    id: 'task-review',
    name: 'Task review',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'turn' },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
      gate: 'review',
      gateIdentity: 'task-review',
      legacy: { plugin: 'delegation-rules', signal: 'task-review' },
    },
    steps: [
      {
        id: 'review',
        title: 'Review the checked task',
        executor: 'review',
        review: { target: 'codex', instruction: 'review-task', scope: 'task' },
        evidence: {
          kind: 'record',
          rule: 'task-review',
          change: '{name}',
          scope: 'task',
          task: '{taskId}',
          verdicts: ['PASS', 'ERROR'],
          path: `.dsh/workflows/records/task-review/{name}/tasks/{taskId}.json`,
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
}

function taskRequestFor(
  root: string,
  specDigest: string,
  overrides: Partial<ReviewRunInput> = {},
): ReviewRunInput {
  const def = focusedTaskDefinition()
  const digest = reviewDigest({ scope: 'task', specDigest })
  const base: ReviewRunInput = {
    run: runFor(def),
    definition: def,
    step: def.steps[0] as Definition['steps'][number],
    reviewer: reviewers(),
    runner: {
      run: async () => ({ childId: 'child-1', completed: true, text: fencedPASS(digest) }),
    },
    context: { workspace: root, values: { name: 'auth', taskId: TASK_ID } },
    change: 'auth',
    task: { id: TASK_ID, number: '1.1', text: 'Task' },
    prepared: { specDigest },
    timeoutMs: 5_000,
    session: 'session-1',
  }
  return { ...base, ...overrides }
}

function taskRecordPath(root: string): string {
  return join(root, '.dsh/workflows/records/task-review/auth/tasks', `${TASK_ID}.json`)
}

describe('review scheduler disposal', () => {
  it('removes queued snapshots and releases an active snapshot after teardown', async () => {
    const { root, digest } = await reviewWorkspace()
    const persisted: WorkflowRun[] = []
    let releaseFirst: (() => void) | undefined
    let firstStarted = false
    let teardownConfirmed = false
    let teardownCalls = 0
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const scheduler = new ReviewScheduler(limitsFor({ maxAttempts: 1 }), {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async (targetWorkspace, runId) =>
        discardReviewSnapshot(targetWorkspace, runId, defaultGit),
    })
    const first = requestFor(root, digest)
    const firstSnapshot = join(root, '.dsh', 'workflows', 'snapshots', first.run.id)
    await mkdir(firstSnapshot, { recursive: true })
    await writeFile(join(firstSnapshot, 'a.txt'), 'a\n', 'utf8')
    await startSnapshotLease(root, first.run.id, 10)
    const firstRequest: ReviewRunInput = {
      ...first,
      runner: {
        run: async () => {
          firstStarted = true
          await gate
          return { childId: 'child-a', completed: true, text: fencedPASS(digest) }
        },
        waitForTeardown: async () => {
          teardownCalls += 1
          if (!teardownConfirmed) throw new Error('the reviewer child is still alive')
        },
      },
    }
    await scheduler.enqueue({
      workspace: root,
      run: firstRequest.run,
      request: firstRequest,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    await waitFor(async () => firstStarted)
    const second = requestFor(root, 'b'.repeat(64))
    const secondSnapshot = join(root, '.dsh', 'workflows', 'snapshots', second.run.id)
    await mkdir(secondSnapshot, { recursive: true })
    await writeFile(join(secondSnapshot, 'b.txt'), 'b\n', 'utf8')
    await startSnapshotLease(root, second.run.id, 10)
    const secondRequest: ReviewRunInput = {
      ...second,
      prepared: { specDigest: 'b'.repeat(64), reviewCwd: secondSnapshot },
    }
    await scheduler.enqueue({
      workspace: root,
      run: second.run,
      request: secondRequest,
      rule: 'spec-review',
      change: 'auth',
      digest: 'b'.repeat(64),
    })
    await waitFor(async () => existsSync(`${secondSnapshot}.lease`))
    scheduler.dispose()
    // A queued entry never started a reviewer, so its checkout goes at once.
    await waitFor(async () => !existsSync(secondSnapshot) && !existsSync(`${secondSnapshot}.lease`))
    // The active reviewer may still be reading its checkout: keep it leased.
    expect(existsSync(firstSnapshot)).toBe(true)
    expect(existsSync(`${firstSnapshot}.lease`)).toBe(true)
    expect(
      scheduler.liveRun({ workspace: root, rule: 'spec-review', change: 'auth', digest }),
    ).toBeUndefined()
    releaseFirst?.()
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(persisted).toEqual([])
    expect(existsSync(recordPath(root))).toBe(false)
    expect(existsSync(firstSnapshot)).toBe(true)
    teardownConfirmed = true
    await waitFor(
      async () => !existsSync(firstSnapshot) && !existsSync(`${firstSnapshot}.lease`),
      5_000,
    )
    expect(teardownCalls).toBeGreaterThan(1)
    await new Promise((resolve) => setTimeout(resolve, 40))
    // The stopped lease is not re-created by its refresh interval.
    expect(existsSync(`${firstSnapshot}.lease`)).toBe(false)
  })
})

describe('review scheduler queued identity collision', () => {
  it('persists a failed non-advancing step without replacing the incumbent record', async () => {
    const { root, digest } = await reviewWorkspace()
    const persisted: WorkflowRun[] = []
    let releaseFirst: (() => void) | undefined
    let firstStarted = false
    let collisionStarts = 0
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const scheduler = new ReviewScheduler(limitsFor({ maxAttempts: 1, maxQueued: 3 }), {
      persistRun: async (_workspace, run) => {
        persisted.push(run)
        return run
      },
      discardSnapshot: async () => undefined,
    })
    const first = requestFor(root, digest, {
      runner: {
        run: async () => {
          firstStarted = true
          await gate
          return { childId: 'child-a', completed: true, text: fencedPASS(digest) }
        },
      },
    })
    await scheduler.enqueue({
      workspace: root,
      run: first.run,
      request: first,
      rule: 'spec-review',
      change: 'auth',
      digest,
    })
    await waitFor(async () => firstStarted)
    const queued = requestFor(root, 'b'.repeat(64), {
      runner: {
        run: async () => {
          collisionStarts += 1
          throw new Error('the discarded entry must not start a reviewer')
        },
      },
    })
    const collisionDigest = 'c'.repeat(64)
    let reprepareCalls = 0
    await scheduler.enqueue({
      workspace: root,
      run: queued.run,
      request: queued,
      rule: 'spec-review',
      change: 'auth',
      digest: 'b'.repeat(64),
      reprepare: async () => {
        reprepareCalls += 1
        return {
          kind: 'replaced',
          prepared: { specDigest: collisionDigest },
          digest: collisionDigest,
          liveDigest: collisionDigest,
        }
      },
    })
    // The incumbent holding the replacement identity waits in the queue.
    let releaseIncumbent: (() => void) | undefined
    const incumbentGate = new Promise<void>((resolve) => {
      releaseIncumbent = resolve
    })
    const incumbent = requestFor(root, collisionDigest, {
      runner: {
        run: async () => {
          await incumbentGate
          return { childId: 'child-c', completed: true, text: fencedPASS(collisionDigest) }
        },
      },
    })
    await scheduler.enqueue({
      workspace: root,
      run: incumbent.run,
      request: incumbent,
      rule: 'spec-review',
      change: 'auth',
      digest: collisionDigest,
    })
    releaseFirst?.()
    await waitFor(async () => persisted.some((run) => run.id === queued.run.id))
    const settledQueued = persisted.find((run) => run.id === queued.run.id)
    expect(settledQueued?.steps[0]?.state).toBe('failed')
    expect(settledQueued?.steps[0]?.reason).toContain(
      'live successor already holds this review identity',
    )
    expect(reprepareCalls).toBe(1)
    expect(collisionStarts).toBe(0)
    // The incumbent's PASS record is unchanged by the discarded entry.
    const record = JSON.parse(await readFile(recordPath(root), 'utf8')) as ReviewRecord
    expect(record.runId).toBe(first.run.id)
    expect(record.verdict).toBe('PASS')
    releaseIncumbent?.()
    await waitFor(async () => persisted.some((run) => run.id === incumbent.run.id))
    scheduler.dispose()
  })
})

/** Write a prior FINDINGS record so the next attempt takes the focused path. */
async function priorTaskFindings(root: string, digest: string): Promise<string> {
  const path = taskRecordPath(root)
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(
    path,
    `${JSON.stringify(
      {
        definition: 'task-review',
        rule: 'task-review',
        change: 'auth',
        phase: 'task',
        scope: 'task',
        taskId: TASK_ID,
        digest,
        verdict: 'FINDINGS',
        findings: [{ severity: 'P1', class: 'missing-test', title: 't', evidence: 'e', fix: 'f' }],
        reviewedTree: 'a'.repeat(40),
        target: { provider: 'codex-subagent' },
        time: '2026-11-14T00:00:00.000Z',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
  return path
}

/** A gated git seam: preparation reaches it and waits until released. */
function gatedGit(): {
  entered: Promise<void>
  release: () => void
  runGit: (args: readonly string[]) => Promise<Buffer>
} {
  let enter!: () => void
  let release!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return {
    entered,
    release: () => release(),
    runGit: async (args) => {
      if (args[0] === 'diff') {
        enter()
        await gate
      }
      return Buffer.from('')
    },
  }
}

describe('review scheduler disposal during preparation', () => {
  it('starts no reviewer and discards the snapshot when disposal lands in preparation', async () => {
    const root = await workspace()
    const specDigest = 'a'.repeat(64)
    const priorDigest = reviewDigest({ scope: 'task', specDigest, tree: 'c'.repeat(40) })
    const recordPath = await priorTaskFindings(root, priorDigest)
    const git = gatedGit()
    let runnerCalls = 0
    const discarded: string[] = []
    const scheduler = new ReviewScheduler(limitsFor({ maxAttempts: 1, waitTimeoutMs: 10_000 }), {
      persistRun: async (_workspace, run) => run,
      discardSnapshot: async (_workspace, runId) => {
        discarded.push(runId)
      },
    })
    const runner: SubagentRunner = {
      run: async () => {
        runnerCalls += 1
        return { childId: 'child-1', completed: true, text: fencedPASS(priorDigest) }
      },
      waitForTeardown: async () => undefined,
    }
    const request = taskRequestFor(root, specDigest, {
      prepared: { specDigest, tree: 'b'.repeat(40) },
      runGit: git.runGit,
      runner,
    })
    const run = request.run
    const pending = scheduler.enqueue({
      workspace: root,
      run,
      request,
      rule: 'task-review',
      change: 'auth',
      taskId: TASK_ID,
      digest: priorDigest,
    })
    await git.entered
    scheduler.dispose()
    git.release()
    const admission = await pending
    expect(admission.kind).toBe('accepted')
    await waitFor(async () => discarded.includes(run.id))
    expect(runnerCalls).toBe(0)
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as ReviewRecord
    expect(record.verdict).toBe('FINDINGS')
  })

  it('starts no reviewer when the run is fenced during preparation', async () => {
    const root = await workspace()
    const specDigest = 'a'.repeat(64)
    const priorDigest = reviewDigest({ scope: 'task', specDigest, tree: 'c'.repeat(40) })
    const recordPath = await priorTaskFindings(root, priorDigest)
    const git = gatedGit()
    let runnerCalls = 0
    const scheduler = new ReviewScheduler(limitsFor({ maxAttempts: 1, waitTimeoutMs: 10_000 }), {
      persistRun: async (_workspace, run) => run,
      discardSnapshot: async () => undefined,
    })
    const runner: SubagentRunner = {
      run: async () => {
        runnerCalls += 1
        return { childId: 'child-1', completed: true, text: fencedPASS(priorDigest) }
      },
    }
    const request = taskRequestFor(root, specDigest, {
      prepared: { specDigest, tree: 'b'.repeat(40) },
      runGit: git.runGit,
      runner,
    })
    const run = request.run
    const pending = scheduler.enqueue({
      workspace: root,
      run,
      request,
      rule: 'task-review',
      change: 'auth',
      taskId: TASK_ID,
      digest: priorDigest,
    })
    await git.entered
    scheduler.fence(run.id)
    git.release()
    const admission = await pending
    expect(admission.kind).toBe('accepted')
    await waitFor(async () => scheduler.liveRunById(run.id) === undefined, 5_000)
    expect(runnerCalls).toBe(0)
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as ReviewRecord
    expect(record.verdict).toBe('FINDINGS')
    scheduler.dispose()
  })
})
