import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDefinition } from '../src/host/definitions.ts'
import { SOFT_SETTLEMENT } from '../src/host/gates.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { definitionsRegistry } from '../src/host/registry.ts'
import { createRun, readAuthenticatedRun, writeRun } from '../src/host/runs.ts'
import { taskIdOf } from '../src/host/tasks.ts'

/**
 * Host-level regression for the native review executor: a frozen task snapshot
 * whose copied tasks.md no longer carries the selected task checked starts no
 * reviewer and releases the snapshot and its lease.
 */

type Listener = (...args: unknown[]) => unknown

const KEY = 'a'.repeat(64)
const SNAPSHOTS = join('.dsh', 'workflows', 'snapshots')
const TASK_ID = taskIdOf('Task')

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
  const directory = await mkdtemp(join(tmpdir(), 'workflows-review-host-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

function reviewDefinition(): ReturnType<typeof validateDefinition> {
  return validateDefinition({
    v: 1,
    id: 'native-task-review',
    name: 'Native task review',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
      gate: 'review',
      gateIdentity: 'native-task-review',
    },
    steps: [
      {
        id: 'review',
        title: 'Review the checked task',
        executor: 'review',
        review: { target: 'codex', instruction: 'review-task', scope: 'task' },
        evidence: {
          kind: 'record',
          rule: 'native-task-review',
          change: '{name}',
          scope: 'task',
          task: '{taskId}',
          verdicts: ['PASS', 'ERROR'],
          path: '.dsh/workflows/records/native-task-review/{name}/tasks/{taskId}.json',
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
}

/** A git-backed change whose only task is present but unchecked in the snapshot. */
async function gitWorkspace(): Promise<string> {
  const workspace = await tempWorkspace()
  await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
  const changeDir = join(workspace, 'openspec', 'changes', 'auth')
  await mkdir(changeDir, { recursive: true })
  await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
  await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.name', 'review-host')
  git('config', 'user.email', 'review-host@example.test')
  git('add', '-A')
  git('commit', '-m', 'init')
  return workspace
}

interface DelayedReviewHost {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  /** The digest echoed by each started reviewer's prompt. */
  readonly digests: string[]
  /** Release one pending reviewer activation. */
  readonly releases: Array<() => void>
  /** Resolves when a released activation is disposed, i.e. teardown is confirmed. */
  readonly disposed: Promise<void>
  emit(name: string, ...args: unknown[]): Promise<unknown>
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the host did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** A fake host whose reviewer activations stay pending until each is released. */
function delayedReviewHost(workspace: string, verdict: 'PASS' | 'FINDINGS'): DelayedReviewHost {
  const listeners = new Map<string, Listener[]>()
  const digests: string[] = []
  const releases: Array<() => void> = []
  let confirmDispose: (() => void) | undefined
  const disposed = new Promise<void>((resolve) => {
    confirmDispose = resolve
  })
  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: { origin: 'root' } },
    ctx: { on: () => () => {} },
    steer: () => {},
    inject: () => {},
  }
  const ctx = {
    get(name: string): unknown {
      if (name === 'agents') return { get: () => agent, list: () => [agent] }
      if (name === 'workingDirectory') return { get: () => workspace }
      if (name === 'fs') {
        return {
          resolve: async (path: string) => ({ targetKey: path }),
          watch: async () => async () => {},
        }
      }
      if (name === 'connection') {
        return { fetch: { register: () => () => {} } }
      }
      if (name === 'subagents') {
        return {
          getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
          startActivation: async (spec: { prompt: { text: string }[] }) => {
            const instruction = spec.prompt.map((block) => block.text).join('\n')
            const digest = /- Digest: ([a-f0-9]{64})/u.exec(instruction)?.[1] ?? ''
            digests.push(digest)
            const pending = new Promise<void>((resolve) => {
              releases.push(resolve)
            })
            const findings =
              verdict === 'FINDINGS'
                ? [
                    {
                      severity: 'P0',
                      class: 'state-persistence',
                      title: 'late verdict',
                      evidence: 'the review ran after the settlement',
                      fix: 'fence the queued reviewer',
                    },
                  ]
                : []
            return {
              childId: `child-${digests.length}`,
              result: pending.then(() => ({
                output: [
                  {
                    type: 'text',
                    text: `\`\`\`json\n${JSON.stringify({ digest, verdict, findings })}\n\`\`\``,
                  },
                ],
                stopReason: 'completed',
              })),
              dispose: async () => {
                confirmDispose?.()
              },
            }
          },
        }
      }
      if (name === 'systemPrompt') return { context: () => () => {} }
      return undefined
    },
    provide: () => {},
    on(name: string, listener: Listener): () => void {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => {}
    },
    effect: () => () => {},
  }
  const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
    let result: unknown
    for (const listener of listeners.get(name) ?? []) result = await listener(...args)
    return result
  }
  return { ctx, agent, digests, releases, disposed, emit }
}

describe('native review host admission', () => {
  it('starts no reviewer for an unchecked frozen task and removes its snapshot lease', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const definition = reviewDefinition()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [definition],
    })
    const listeners = new Map<string, Listener[]>()
    let activationCalls = 0
    const agent = {
      id: 'session-1',
      session: { id: 'session-1', header: { origin: 'root' } },
      ctx: { on: () => () => {} },
      steer: () => {},
      inject: () => {},
    }
    const add = (name: string, listener: Listener): void => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
    }
    const ctx = {
      get(name: string): unknown {
        if (name === 'agents') return { get: () => agent, list: () => [agent] }
        if (name === 'workingDirectory') return { get: () => workspace }
        if (name === 'fs') {
          return {
            resolve: async (path: string) => ({ targetKey: path }),
            watch: async () => async () => {},
          }
        }
        if (name === 'connection') {
          return {
            fetch: {
              register: () => () => {},
            },
          }
        }
        if (name === 'subagents') {
          return {
            getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
            startActivation: async () => {
              activationCalls += 1
              throw new Error('an unchecked frozen task must not start a reviewer')
            },
          }
        }
        if (name === 'systemPrompt') return { context: () => () => {} }
        return undefined
      },
      provide: () => {},
      on(name: string, listener: Listener): () => void {
        add(name, listener)
        return () => {}
      },
      effect: () => () => {},
    }
    const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
      let result: unknown
      for (const listener of listeners.get(name) ?? []) result = await listener(...args)
      return result
    }
    try {
      apply(ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const run = createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth', taskId: TASK_ID },
        steps: ['review'],
        now: 1_000,
      })
      await writeRun(workspace, run, auth)
      await emit('agent/turn-stopping', { agent, turn: 1 })
      const settled = await readAuthenticatedRun(workspace, run.id, auth)
      expect(settled?.steps[0]?.state).toBe('failed')
      expect(settled?.steps[0]?.reason).toContain('changed or became unchecked')
      // The rejected frozen task starts no reviewer.
      expect(activationCalls).toBe(0)
      // Its checkout and lease are gone, not left renewing.
      const snapshots = await readdir(join(workspace, SNAPSHOTS)).catch(() => [] as string[])
      expect(snapshots).toEqual([])
    } finally {
      unregister()
    }
  })

  it('admits whole-scope phases separately through the host', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const definitions = ['spec', 'integration'].map((phase) =>
      validateDefinition({
        v: 1,
        id: `phase-${phase}`,
        name: `Phase ${phase}`,
        version: 1,
        trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
        settings: {
          allowModelStart: true,
          risk: 'low',
          gateOwnership: 'own',
          maxBlocks: 3,
          allowIntent: false,
          gate: 'review',
          gateIdentity: 'phase-review',
        },
        steps: [
          {
            id: 'review',
            title: 'Whole review',
            executor: 'review',
            review: {
              target: 'codex',
              instruction: phase === 'spec' ? 'review-spec' : 'review-integration',
              scope: 'whole',
              phase,
            },
            evidence: {
              kind: 'record',
              rule: 'phase-review',
              change: '{name}',
              scope: 'whole',
              verdicts: ['PASS', 'ERROR'],
              digest: 'current',
              path: `.dsh/workflows/records/phase-${phase}/{name}/${phase}.json`,
            },
            next: 'end',
            blockTurnClose: true,
          },
        ],
      }),
    )
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions,
    })
    const host = delayedReviewHost(workspace, 'PASS')
    const { emit, agent } = host
    try {
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      for (const definition of definitions) {
        const run = createRun({
          definition: definition.id,
          trigger: 'turn.stopping',
          session: 'session-1',
          workspace,
          context: { name: 'auth' },
          steps: ['review'],
          now: 1_000,
        })
        await writeRun(workspace, run, auth)
      }
      await emit('agent/turn-stopping', { agent, turn: 1 })
      // Both admissions must start before either result arrives; with the host
      // phase omitted the second dedupes and only one activation starts.
      await waitFor(() => host.releases.length >= 2)
      expect(host.releases).toHaveLength(2)
      for (const release of host.releases) release()
      const records = await Promise.all(
        definitions.map(async (definition) => {
          const path = join(
            workspace,
            '.dsh/workflows/records',
            definition.id,
            'auth',
            `${definition.steps[0]?.review?.phase ?? ''}.json`,
          )
          for (let attempt = 0; attempt < 250; attempt += 1) {
            const text = await readFile(path, 'utf8').catch(() => undefined)
            if (text !== undefined) return JSON.parse(text) as { verdict: string }
            await new Promise((resolve) => setTimeout(resolve, 20))
          }
          throw new Error(`no record for ${definition.id}`)
        }),
      )
      expect(records.map((record) => record.verdict)).toEqual(['PASS', 'PASS'])
    } finally {
      unregister()
    }
  })

  it.each(['FINDINGS', 'PASS'] as const)(
    'fences a delayed %s reviewer after the completed-soft settlement',
    async (verdict) => {
      process.env.DSH_WORKFLOWS_HOST_KEY = KEY
      const workspace = await gitWorkspace()
      const definition = validateDefinition({
        v: 1,
        id: 'native-integration-review',
        name: 'Native integration review',
        version: 1,
        trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
        settings: {
          allowModelStart: true,
          risk: 'low',
          gateOwnership: 'own',
          maxBlocks: 1,
          allowIntent: false,
          gate: 'review',
          gateIdentity: 'native-integration-review',
        },
        steps: [
          {
            id: 'review',
            title: 'Review the worktree',
            executor: 'review',
            review: {
              target: 'codex',
              instruction: 'review-integration',
              scope: 'whole',
              phase: 'integration',
            },
            evidence: {
              kind: 'record',
              rule: 'native-integration-review',
              change: '{name}',
              scope: 'whole',
              phase: 'integration',
              verdicts: ['PASS', 'ERROR'],
              digest: 'current-worktree',
              path: '.dsh/workflows/records/native-integration-review/{name}/integration.json',
            },
            next: 'end',
            blockTurnClose: true,
            nonCritical: true,
          },
        ],
      })
      const unregister = definitionsRegistry.register({
        source: 'workflows-test',
        definitions: [definition],
      })
      const host = delayedReviewHost(workspace, verdict)
      try {
        apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
        const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
        const run = createRun({
          definition: definition.id,
          trigger: 'turn.stopping',
          session: 'session-1',
          workspace,
          context: { name: 'auth' },
          steps: ['review'],
          now: 1_000,
        })
        await writeRun(workspace, run, auth)
        // The first close refuses once and starts the delayed reviewer.
        await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
        await waitFor(() => host.digests.length === 1)
        // The second close exhausts maxBlocks: the optional step settles
        // completed-soft with one violation and no open required step.
        await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
        const settled = await readAuthenticatedRun(workspace, run.id, auth)
        expect(settled?.status).toBe('completed')
        expect(settled?.reason).toBe(SOFT_SETTLEMENT)
        expect(settled?.steps[0]?.state).toBe('cancelled')
        expect(settled?.violations).toHaveLength(1)
        expect(
          settled?.steps.some((step) => step.state === 'open' || step.state === 'blocked'),
        ).toBe(false)
        // The late verdict is fenced: it publishes no record and never restores
        // the settled run or its blocking step.
        host.releases[0]?.()
        await host.disposed
        await new Promise((resolve) => setTimeout(resolve, 100))
        const after = await readAuthenticatedRun(workspace, run.id, auth)
        expect(after).toEqual(settled)
        expect(after?.violations).toHaveLength(1)
        expect(after?.steps[0]?.state).toBe('cancelled')
        expect(
          await readFile(
            join(
              workspace,
              '.dsh/workflows/records/native-integration-review/auth/integration.json',
            ),
            'utf8',
          ).catch(() => undefined),
        ).toBeUndefined()
      } finally {
        unregister()
      }
    },
  )
})
