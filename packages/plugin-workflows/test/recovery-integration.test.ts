import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { currentSpecDigest, reviewDigest } from '../src/host/evidence.ts'
import { defaultGit } from '../src/host/git.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { reviewInputTree } from '../src/host/review-snapshot.ts'
import { createRun, readAuthenticatedRun, writeRun } from '../src/host/runs.ts'

/**
 * Startup recovery regression: an integration-review run left running by a crash
 * is settled from its authoritative whole-worktree PASS record only when that
 * record still names the current worktree; a stale record leaves it interrupted.
 */

type Listener = (...args: unknown[]) => unknown

const KEY = 'a'.repeat(64)
const RECORD_PATH = join('integration-review', 'auth', 'integration.json')
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
  const directory = await mkdtemp(join(tmpdir(), 'workflows-recovery-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

/** A git-backed change the whole-worktree review can bind to. */
async function gitWorkspace(): Promise<string> {
  const workspace = await tempWorkspace()
  await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
  const changeDir = join(workspace, 'openspec', 'changes', 'auth')
  await mkdir(join(changeDir, 'specs', 'auth'), { recursive: true })
  await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
  await writeFile(join(changeDir, 'design.md'), '# Design\n', 'utf8')
  await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
  await writeFile(join(changeDir, 'specs', 'auth', 'spec.md'), '# Spec\n', 'utf8')
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

/** The digest the host recomputes for a whole-worktree review record. */
async function currentRecordDigest(workspace: string): Promise<{ digest: string; tree: string }> {
  const specDigest = await currentSpecDigest(workspace, 'auth')
  if (specDigest === undefined) throw new Error('the change digest is missing')
  const tree = await reviewInputTree(
    workspace,
    { dir: join(workspace, 'openspec', 'changes', 'auth') },
    defaultGit,
    AbortSignal.timeout(60_000),
  )
  return { digest: reviewDigest({ scope: 'whole', specDigest, tree }), tree }
}

/**
 * Publish the PASS the review executor would have published. The raw git tree is
 * 40 hex here and the record validator needs 64, so `worktreeDigest` carries the
 * executor's sha256 over the tree id instead.
 */
async function publishPass(workspace: string, digest: string, tree: string): Promise<void> {
  const worktreeDigest = createHash('sha256')
    .update('task-review-snapshot-v1\0')
    .update(tree)
    .update('\0')
    .digest('hex')
  const path = join(workspace, '.dsh', 'workflows', 'records', RECORD_PATH)
  await mkdir(join(workspace, '.dsh', 'workflows', 'records', 'integration-review', 'auth'), {
    recursive: true,
  })
  await writeFile(
    path,
    `${JSON.stringify({
      rule: 'integration-review',
      change: 'auth',
      phase: 'integration',
      scope: 'whole',
      verdict: 'PASS',
      digest,
      worktreeDigest,
      findings: [],
      time: '2026-11-19T09:00:00.000Z',
      target: { provider: 'codex-subagent' },
    })}\n`,
    'utf8',
  )
}

/** The run a crashed process left unfinished. */
async function crashedRun(workspace: string): Promise<string> {
  const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
  const run = createRun({
    definition: 'integration-review',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace,
    context: { name: 'auth' },
    steps: ['review'],
    now: 1_000,
  })
  await writeRun(workspace, run, auth)
  return run.id
}

function fakeHost(workspace: string): {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
} {
  const listeners = new Map<string, Listener[]>()
  const provided = new Map<string, unknown>()
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
  return { ctx, agent }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the host did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function recoveredStatus(workspace: string, runId: string): Promise<string | undefined> {
  const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
  return (await readAuthenticatedRun(workspace, runId, auth))?.status
}

describe('integration review recovery', () => {
  it('reconciles a run whose current whole-worktree PASS was published before the crash, not a stale one', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY

    // Workspace A: the published digest names an earlier worktree.
    const staleWorkspace = await gitWorkspace()
    const staleRunId = await crashedRun(staleWorkspace)
    const staleRecord = await currentRecordDigest(staleWorkspace)
    await publishPass(staleWorkspace, 'a'.repeat(64), staleRecord.tree)
    apply(fakeHost(staleWorkspace).ctx as never, {
      reviewers: { codex: { provider: 'codex-subagent' } },
    })
    await waitFor(async () => (await recoveredStatus(staleWorkspace, staleRunId)) === 'interrupted')

    // Workspace B: the record was published just before the crash and is current.
    const currentWorkspace = await gitWorkspace()
    const currentRunId = await crashedRun(currentWorkspace)
    const current = await currentRecordDigest(currentWorkspace)
    await publishPass(currentWorkspace, current.digest, current.tree)
    apply(fakeHost(currentWorkspace).ctx as never, {
      reviewers: { codex: { provider: 'codex-subagent' } },
    })
    await waitFor(
      async () => (await recoveredStatus(currentWorkspace, currentRunId)) === 'completed',
    )
    const settled = await readAuthenticatedRun(
      currentWorkspace,
      currentRunId,
      HostAuth.fromKey(Buffer.from(KEY, 'hex')),
    )
    expect(settled?.steps[0]?.state).toBe('done')
    expect(settled?.steps[0]?.evidence?.kind).toBe('record')
  })
})
