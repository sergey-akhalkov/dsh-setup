import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import type { SubagentRunner } from '../src/host/executors.ts'
import { defaultGit } from '../src/host/git.ts'
import { type ReviewRecord, resolveReviewers } from '../src/host/review.ts'
import { ReviewScheduler } from '../src/host/review-scheduler.ts'
import { createReviewSnapshot, discardReviewSnapshot } from '../src/host/review-snapshot.ts'
import { createRun, type WorkflowRun } from '../src/host/runs.ts'

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

  it('reports a duplicate while the same identity is live and full when the queue is full', async () => {
    const { root, digest } = await reviewWorkspace()
    const def = definition()
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const scheduler = new ReviewScheduler(
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
    const secondRun = createRun({
      definition: def.id,
      trigger: 'turn.stopping',
      session: 'session-2',
      workspace: '/workspace',
      context: { name: 'other' },
      steps: ['review'],
      now: 1_000,
    })
    const queued = await scheduler.enqueue({
      workspace: root,
      run: secondRun,
      request: {
        ...request,
        run: secondRun,
        context: { workspace: root, values: { name: 'other' } },
      },
      rule: 'spec-review',
      change: 'other',
      digest,
    })
    expect(queued.kind).toBe('accepted')
    const thirdRun = createRun({
      definition: def.id,
      trigger: 'turn.stopping',
      session: 'session-3',
      workspace: '/workspace',
      context: { name: 'third' },
      steps: ['review'],
      now: 1_000,
    })
    const full = await scheduler.enqueue({
      workspace: root,
      run: thirdRun,
      request: {
        ...request,
        run: thirdRun,
        context: { workspace: root, values: { name: 'third' } },
      },
      rule: 'spec-review',
      change: 'third',
      digest,
    })
    expect(full.kind).toBe('full')
    release?.()
    scheduler.dispose()
  })
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
