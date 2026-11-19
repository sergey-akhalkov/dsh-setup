import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { createRun, readAuthenticatedRun, settleStep, writeRun } from '../src/host/runs.ts'
import { sectionRecordId, taskIdOf } from '../src/host/tasks.ts'

/**
 * Startup recovery regression: the shipped task-review's completion step settles
 * from its portable coverage check when the owner session is gone and the review
 * step was already done before the crash, so the run becomes completed.
 */

type Listener = (...args: unknown[]) => unknown

const KEY = 'a'.repeat(64)
const TASK_TEXT = 'Only task'
const TASK_ID = taskIdOf(TASK_TEXT)
const CRASHED_SESSION = 'session-crashed'
const TEMP_DIRECTORIES: string[] = []

afterEach(async () => {
  delete process.env.DSH_WORKFLOWS_HOST_KEY
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-completion-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

/** A git workspace whose one checked task already has a portable PASS. */
async function approvedWorkspace(): Promise<string> {
  const workspace = await tempWorkspace()
  await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
  const changeDir = join(workspace, 'openspec', 'changes', 'auth')
  await mkdir(join(changeDir, 'specs', 'auth'), { recursive: true })
  await mkdir(join(changeDir, 'reviews'), { recursive: true })
  await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
  await writeFile(join(changeDir, 'design.md'), '# Design\n', 'utf8')
  await writeFile(
    join(changeDir, 'tasks.md'),
    '# Tasks\n\n## 1. Engine\n\n- [x] 1.1 Only task\n',
    'utf8',
  )
  await writeFile(join(changeDir, 'specs', 'auth', 'spec.md'), '# Spec\n', 'utf8')
  // The committed subset `portableApprovalOf` writes; coverage never compares
  // the digest, so a fixed 64-hex value satisfies the portable schema.
  await writeFile(
    join(changeDir, 'reviews', `${TASK_ID}.json`),
    `${JSON.stringify({
      rule: 'task-review',
      change: 'auth',
      scope: 'task',
      taskId: TASK_ID,
      digest: 'a'.repeat(64),
      verdict: 'PASS',
      findings: [],
      target: { provider: 'codex-subagent' },
      time: '2026-11-19T09:00:00.000Z',
    })}\n`,
    'utf8',
  )
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.name', 'recovery')
  git('config', 'user.email', 'recovery@example.test')
  git('add', '-A')
  git('commit', '-m', 'init')
  return workspace
}

/** The run a crash left behind: the review done, the completion step open. */
async function crashedRun(workspace: string): Promise<string> {
  const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
  const run = createRun({
    definition: 'task-review',
    trigger: 'fs.change',
    session: CRASHED_SESSION,
    workspace,
    context: {
      name: 'auth',
      taskId: TASK_ID,
      section: '1',
      sectionTitle: '1. Engine',
      taskIds: [TASK_ID],
    },
    steps: ['review', 'complete-review'],
    now: 1_000,
  })
  await writeRun(workspace, run, auth)
  await writeRun(workspace, settleStep(run, 'review', 'done', { at: 1_100 }), auth)
  return run.id
}

function fakeHost(
  workspace: string,
  services: Record<string, unknown> = {},
): {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  readonly emit: (name: string, payload: unknown) => Promise<void>
} {
  const listeners = new Map<string, Listener[]>()
  const provided = new Map<string, unknown>(Object.entries(services))
  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: { origin: 'root' as const } },
    ctx: { on: () => () => {} },
    steer: () => {},
    inbox: { remove: () => true },
    inject: () => {},
  }
  const tools: Record<string, unknown> = {
    get: (name: string) =>
      ['delegate', 'task_progress', 'delegation_status', 'work_checkpoint'].includes(name)
        ? { name }
        : undefined,
    register: () => () => {},
  }
  const ctx: Record<string, unknown> = {
    systemPrompt: { context: () => () => {} },
    get(name: string): unknown {
      if (name === 'agents') return { get: () => agent, list: () => [agent] }
      if (name === 'workingDirectory') return { get: () => workspace }
      if (name === 'fs') {
        return {
          resolve: async (path: unknown) => ({ targetKey: String(path) }),
          watch: async () => async () => {},
        }
      }
      if (name === 'connection') return { fetch: { register: () => () => {} } }
      if (name === 'tools') return tools
      if (name === 'delegationRulesStatus') {
        return { workflowOwned: false, specReview: true, taskProgress: true, laneFanout: true }
      }
      if (name === 'goalContinuityStatus') return { automation: false }
      if (name === 'verificationGateStatus') return { steering: false }
      if (name === 'commands') return { register: () => () => {} }
      if (provided.has(name)) return provided.get(name)
      return undefined
    },
    provide(name: string, value: unknown): void {
      provided.set(name, value)
    },
    on(name: string, listener: Listener): () => void {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {}
    },
    effect(callback: () => () => void): () => void {
      callback()
      return () => {}
    },
  }
  return {
    ctx,
    agent,
    emit: async (name: string, payload: unknown): Promise<void> => {
      for (const listener of listeners.get(name) ?? []) await listener(payload)
    },
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the host did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('task review completion recovery', () => {
  it('settles complete-review from portable coverage after a crash with the owner session gone', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await approvedWorkspace()
    const runId = await crashedRun(workspace)
    const activations: string[] = []
    apply(
      fakeHost(workspace, {
        subagents: {
          getProvider: () => ({ capabilities: { agentOptions: false } }),
          startActivation: async () => {
            activations.push('started')
            throw new Error('recovery must not start a reviewer')
          },
        },
      }).ctx as never,
      { reviewers: { codex: { provider: 'codex-subagent' } } },
    )
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const current = async (): Promise<string | undefined> =>
      (await readAuthenticatedRun(workspace, runId, auth))?.status
    // Startup recovery settles the run from the evidence; no event or live owner
    // session of the crashed run fires here.
    await waitFor(async () => {
      const status = await current()
      return status !== undefined && status !== 'running'
    })
    const settled = await readAuthenticatedRun(workspace, runId, auth)
    expect(settled?.status).toBe('completed')
    expect(settled?.session).toBe(CRASHED_SESSION)
    expect(settled?.steps.map((step) => step.state)).toEqual(['done', 'done'])
    const completion = settled?.steps.find((step) => step.id === 'complete-review')
    expect(completion?.evidence).toMatchObject({ kind: 'check', callId: 'task-review-coverage' })
    expect(activations).toEqual([])
  })

  it('recovers the review step from the portable approval when the record was never written', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await approvedWorkspace()
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // The crash fell between the portable approval write and the local record
    // write: the approval exists, the record does not, and the review step is
    // still open.
    const run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: CRASHED_SESSION,
      workspace,
      context: {
        name: 'auth',
        taskId: TASK_ID,
        section: '1',
        sectionTitle: '1. Engine',
        taskIds: [TASK_ID],
      },
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    await writeRun(workspace, run, auth)
    apply(fakeHost(workspace).ctx as never, {
      reviewers: { codex: { provider: 'codex-subagent' } },
    })
    await waitFor(async () => {
      const status = (await readAuthenticatedRun(workspace, run.id, auth))?.status
      return status !== undefined && status !== 'running'
    })
    const settled = await readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.status).toBe('completed')
    expect(settled?.steps.map((step) => step.state)).toEqual(['done', 'done'])
    expect(settled?.steps.find((step) => step.id === 'review')?.evidence).toMatchObject({
      kind: 'record',
      path: `openspec/changes/auth/reviews/${TASK_ID}.json`,
    })
  })

  it('recovers a section review from the approvals of every covered task', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
    await mkdir(join(changeDir, 'specs', 'auth'), { recursive: true })
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
    await writeFile(join(changeDir, 'design.md'), '# Design\n', 'utf8')
    await writeFile(
      join(changeDir, 'tasks.md'),
      '# Tasks\n\n## 1. Engine\n\n- [x] 1.1 First task\n- [x] 1.2 Second task\n',
      'utf8',
    )
    await writeFile(join(changeDir, 'specs', 'auth', 'spec.md'), '# Spec\n', 'utf8')
    const covered = [taskIdOf('First task'), taskIdOf('Second task')]
    for (const [index, id] of covered.entries()) {
      await writeFile(
        join(changeDir, 'reviews', `${id}.json`),
        `${JSON.stringify({
          rule: 'task-review',
          change: 'auth',
          scope: 'task',
          taskId: id,
          digest: 'a'.repeat(64),
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: `2026-11-19T09:0${index}:00.000Z`,
        })}\n`,
        'utf8',
      )
    }
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'recovery')
    git('config', 'user.email', 'recovery@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: CRASHED_SESSION,
      workspace,
      context: {
        name: 'auth',
        taskId: sectionRecordId('1'),
        section: '1',
        sectionTitle: '1. Engine',
        taskIds: covered,
      },
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    await writeRun(workspace, run, auth)
    apply(fakeHost(workspace).ctx as never, {
      reviewers: { codex: { provider: 'codex-subagent' } },
    })
    await waitFor(async () => {
      const status = (await readAuthenticatedRun(workspace, run.id, auth))?.status
      return status !== undefined && status !== 'running'
    })
    const settled = await readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.status).toBe('completed')
    expect(settled?.steps.map((step) => step.state)).toEqual(['done', 'done'])
  })

  it('reclaims a recovered run when a later session supplies the missing approval', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
    await mkdir(join(changeDir, 'specs', 'auth'), { recursive: true })
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
    await writeFile(join(changeDir, 'design.md'), '# Design\n', 'utf8')
    await writeFile(
      join(changeDir, 'tasks.md'),
      '# Tasks\n\n## 1. Engine\n\n- [x] 1.1 Lane A task\n\n## 2. Surface\n\n- [x] 2.1 Lane B task\n',
      'utf8',
    )
    await writeFile(join(changeDir, 'specs', 'auth', 'spec.md'), '# Spec\n', 'utf8')
    const laneA = taskIdOf('Lane A task')
    const laneB = taskIdOf('Lane B task')
    const approval = (id: string, minute: string): string =>
      `${JSON.stringify({
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        taskId: id,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: `2026-11-19T09:${minute}:00.000Z`,
      })}\n`
    // Only lane A's approval exists at the crash; lane B arrives later.
    await writeFile(join(changeDir, 'reviews', `${laneA}.json`), approval(laneA, '01'), 'utf8')
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'recovery')
    git('config', 'user.email', 'recovery@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: CRASHED_SESSION,
      workspace,
      context: {
        name: 'auth',
        taskId: sectionRecordId('1'),
        section: '1',
        sectionTitle: '1. Engine',
        taskIds: [laneA],
      },
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    await writeRun(workspace, run, auth)
    const activations: string[] = []
    const host = fakeHost(workspace, {
      subagents: {
        getProvider: () => ({ capabilities: { agentOptions: false } }),
        startActivation: async () => {
          activations.push('started')
          throw new Error('reclaim must not start a reviewer')
        },
      },
    })
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    // The review step settles from lane A's approval; lane B's missing approval
    // keeps the completion step open, so the recovered run is running.
    await waitFor(async () => {
      const current = await readAuthenticatedRun(workspace, run.id, auth)
      return (
        current?.status === 'running' &&
        current.steps.find((step) => step.id === 'review')?.state === 'done'
      )
    })
    await writeFile(join(changeDir, 'reviews', `${laneB}.json`), approval(laneB, '02'), 'utf8')
    const closing = {
      ...host.agent,
      id: 'session-2',
      session: { id: 'session-2', header: { origin: 'root' } },
    }
    await host.emit('agent/turn-stopping', { agent: closing, turn: 1 })
    const settled = await readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.status).toBe('completed')
    expect(settled?.steps.map((step) => step.state)).toEqual(['done', 'done'])
    expect(settled?.session).toBe(CRASHED_SESSION)
    expect(activations).toEqual([])
  })

  it('reclaims an interrupted run whose review was done before the crash', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
    await mkdir(join(changeDir, 'specs', 'auth'), { recursive: true })
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
    await writeFile(join(changeDir, 'design.md'), '# Design\n', 'utf8')
    await writeFile(
      join(changeDir, 'tasks.md'),
      '# Tasks\n\n## 1. Engine\n\n- [x] 1.1 Lane A task\n\n## 2. Surface\n\n- [x] 2.1 Lane B task\n',
      'utf8',
    )
    await writeFile(join(changeDir, 'specs', 'auth', 'spec.md'), '# Spec\n', 'utf8')
    const laneA = taskIdOf('Lane A task')
    const laneB = taskIdOf('Lane B task')
    const approval = (id: string, minute: string): string =>
      `${JSON.stringify({
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        taskId: id,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: `2026-11-19T09:${minute}:00.000Z`,
      })}\n`
    await writeFile(join(changeDir, 'reviews', `${laneA}.json`), approval(laneA, '01'), 'utf8')
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'recovery')
    git('config', 'user.email', 'recovery@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: CRASHED_SESSION,
      workspace,
      context: {
        name: 'auth',
        taskId: sectionRecordId('1'),
        section: '1',
        sectionTitle: '1. Engine',
        taskIds: [laneA],
      },
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    // The review finished before the crash; only completion stayed pending.
    await writeRun(workspace, settleStep(run, 'review', 'done', { at: 1_100 }), auth)
    const host = fakeHost(workspace, {
      subagents: {
        getProvider: () => ({ capabilities: { agentOptions: false } }),
        startActivation: async () => {
          throw new Error('reclaim must not start a reviewer')
        },
      },
    })
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    await waitFor(async () => {
      const status = (await readAuthenticatedRun(workspace, run.id, auth))?.status
      return status === 'interrupted'
    })
    await writeFile(join(changeDir, 'reviews', `${laneB}.json`), approval(laneB, '02'), 'utf8')
    // The original session continues; an interrupted run is skipped by normal
    // advancement, so only the evidence-based reclaim can settle it.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const settled = await readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.status).toBe('completed')
    expect(settled?.steps.map((step) => step.state)).toEqual(['done', 'done'])
    expect(settled?.session).toBe(CRASHED_SESSION)
  })
})
