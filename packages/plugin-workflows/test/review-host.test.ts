import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { validateDefinition } from '../src/host/definitions.ts'
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
})
