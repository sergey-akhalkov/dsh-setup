import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { apply as applyDelegation } from '../../plugin-delegation-rules/src/host/index.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { writeInvolvement } from '../src/host/involvement.ts'
import { listAuthenticatedRuns } from '../src/host/runs.ts'
import { taskIdOf } from '../src/host/tasks.ts'

/**
 * The composed Release A profile: the delegation row and the workflows row are
 * mounted from the generated setup patch on one host, the three shipped review
 * triggers fire for one change, and the result is exactly one native reviewer
 * per review identity with no legacy steer and no second review.
 */

type Listener = (...args: unknown[]) => unknown

interface PatchRow {
  id?: string
  disabled?: boolean
  config?: Record<string, unknown>
}

interface Activation {
  readonly rule: string
  readonly prompt: string
}

interface Steer {
  readonly kind: string
  readonly text: string
}

interface FakeHost {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  readonly watch: Array<() => void>
  readonly activations: Activation[]
  readonly steers: Steer[]
  emit(name: string, ...args: unknown[]): Promise<unknown>
}

const KEY = 'c'.repeat(64)
const SESSION = 'session-1'
const CHANGE = 'auth'
const TASK_TEXT = 'Review the composed profile'
const TASK_ID = taskIdOf(TASK_TEXT)
const NATIVE_HEADER = '## Native review'
const REPO = join(import.meta.dirname, '..', '..', '..')
const TEMP_DIRECTORIES: string[] = []

afterEach(async () => {
  delete process.env.DSH_WORKFLOWS_HOST_KEY
  for (const directory of TEMP_DIRECTORIES.splice(0)) {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  }
})

const UNCHECKED_TASKS = `# Tasks

## 1. Compose the profile (lane 1, owns \`packages/plugin-workflows/**\`)

- [ ] 1.1 ${TASK_TEXT}
`

const CHECKED_TASKS = UNCHECKED_TASKS.replace('- [ ] 1.1', '- [x] 1.1')

/** The composed config of one setup row: its last patch entry with a config. */
async function composedConfig(id: string): Promise<Record<string, unknown>> {
  const text = await readFile(join(REPO, 'packages', 'setup', 'cordis.patch.yml'), 'utf8')
  const parsed = parse(text) as Array<{ insert?: PatchRow[] } | PatchRow>
  const rows = parsed.flatMap((entry) => ('insert' in entry ? (entry.insert ?? []) : []))
  const overrides = parsed.filter((entry): entry is PatchRow => !('insert' in entry))
  const last = [...rows, ...overrides]
    .filter((row) => row.id === id)
    .filter((row) => row.config !== undefined)
    .at(-1)
  if (last?.config === undefined) throw new Error(`row "${id}" has no composed config`)
  return last.config
}

function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const started = Date.now()
  return (async () => {
    while (!(await check())) {
      if (Date.now() - started > timeoutMs) throw new Error('the composed profile did not settle')
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  })()
}

async function readJson(path: string): Promise<Record<string, unknown> | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** A git workspace whose change starts with the unchecked task. */
async function gitWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-composed-'))
  TEMP_DIRECTORIES.push(directory)
  await writeFile(join(directory, '.gitignore'), '.dsh/\n', 'utf8')
  const change = join(directory, 'openspec', 'changes', CHANGE)
  await mkdir(join(change, 'specs', 'auth'), { recursive: true })
  await writeFile(join(change, 'proposal.md'), '# Proposal\n\nWhy.\n', 'utf8')
  await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# Spec\n\nA requirement.\n', 'utf8')
  await writeFile(join(change, 'tasks.md'), UNCHECKED_TASKS, 'utf8')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: directory, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.name', 'composed-profile')
  git('config', 'user.email', 'composed-profile@example.test')
  git('add', '-A')
  git('commit', '-m', 'init')
  return directory
}

/**
 * One host context carrying both runtimes' services: the delegation plugin
 * reads its direct properties, the workflows plugin its `get` services.
 */
function fakeHost(workspace: string): FakeHost {
  const listeners = new Map<string, Listener[]>()
  const provided = new Map<string, unknown>()
  const watch: Array<() => void> = []
  const activations: Activation[] = []
  const steers: Steer[] = []
  const tools = new Map<string, { name: string }>()
  const toolsService = {
    register(definition: { name: string }) {
      tools.set(definition.name, definition)
      return () => undefined
    },
    get(name: string) {
      return tools.get(name)
    },
  }
  const subagents = {
    getProvider(provider: string) {
      return provider === 'codex-subagent'
        ? { name: provider, capabilities: { agentOptions: true } }
        : undefined
    },
    async startActivation(spec: { prompt: ReadonlyArray<{ readonly text: string }> }) {
      const prompt = spec.prompt.map((block) => block.text).join('\n')
      const digest = /- Digest: ([a-f0-9]{64})/u.exec(prompt)?.[1] ?? ''
      const rule = /- Rule: ([a-z0-9-]+)/u.exec(prompt)?.[1] ?? ''
      activations.push({ rule, prompt })
      return {
        childId: `child-${String(activations.length)}`,
        result: Promise.resolve({
          output: [
            {
              type: 'text' as const,
              text: `\`\`\`json\n${JSON.stringify({ digest, verdict: 'PASS', findings: [] })}\n\`\`\``,
            },
          ],
          stopReason: 'completed',
        }),
        dispose: async () => undefined,
      }
    },
  }
  const agent = {
    id: SESSION,
    session: { id: SESSION, header: { origin: 'root' } },
    ctx: { on: () => () => undefined },
    steer(message: {
      readonly content?: ReadonlyArray<{ readonly text?: string }>
      readonly source?: { readonly kind?: string }
    }) {
      steers.push({
        kind: message.source?.kind ?? '',
        text: (message.content ?? []).map((block) => block.text ?? '').join('\n'),
      })
    },
    inject: () => undefined,
  }
  const services: Record<string, unknown> = {
    agents: { get: (id: string) => (id === SESSION ? agent : undefined), list: () => [agent] },
    workingDirectory: { get: () => workspace },
    fs: {
      resolve: async (path: string) => ({ targetKey: path }),
      watch: async (_target: unknown, changed: (error?: Error) => void) => {
        watch.push(() => changed())
        return async () => undefined
      },
    },
    connection: { fetch: { register: () => () => undefined } },
    subagents,
    tools: toolsService,
  }
  const ctx: Record<string, unknown> = {
    subagents,
    workingDirectory: services.workingDirectory,
    tools: toolsService,
    skills: { registerProvider: () => () => undefined },
    get(name: string) {
      return provided.has(name) ? provided.get(name) : services[name]
    },
    provide(name: string, value: unknown) {
      provided.set(name, value)
      return () => provided.delete(name)
    },
    on(name: string, listener: Listener) {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => undefined
    },
    effect(work: () => unknown) {
      const dispose = work()
      return () => {
        if (typeof dispose === 'function') (dispose as () => void)()
      }
    },
  }
  const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
    let result: unknown
    for (const listener of [...(listeners.get(name) ?? [])]) result = await listener(...args)
    return result
  }
  return { ctx, agent, watch, activations, steers, emit }
}

function closeTurn(host: FakeHost, turn: number): Promise<unknown> {
  return host.emit('agent/turn-stopping', {
    agent: host.agent,
    turn,
    signal: new AbortController().signal,
  })
}

describe('composed Release A profile', () => {
  it('runs each review trigger once natively and never steers through the dormant legacy row', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace()
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    // The composed rows are the dormant Release A pair, not a synthetic fixture.
    expect(delegation.gates).toEqual({
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: false,
      laneFanout: false,
    })
    expect(workflows.reviewers).toMatchObject({
      codex: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
    })
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const change = join(workspace, 'openspec', 'changes', CHANGE)
    const host = fakeHost(workspace)
    // Mount in the composed row order: the delegation row, then the workflows row.
    applyDelegation(host.ctx as never, delegation as never)
    apply(host.ctx as never, workflows as never)

    // The change-tree watcher snapshots before it watches; wait for its baseline
    // so the later tasks.md edit is a real trigger event.
    await waitFor(() => host.watch.length > 0)
    // Auth is requested asynchronously at load; a close with no involvement and
    // no progress settles it before the fs trigger can create a run.
    await closeTurn(host, 1)
    expect(host.activations).toEqual([])

    // The session is involved in the change, then the final task is checked and
    // delivered through the shipped fs.change task-review trigger.
    // Seed the legacy runtime's own involvement store too, so its review
    // branches actually evaluate this change (and stay silent with the
    // switches off) instead of being skipped for lack of involvement.
    const legacyName = createHash('sha256').update(SESSION).digest('hex').slice(0, 16)
    const legacyDir = join(workspace, '.dsh', 'delegation', 'sessions')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(
      join(legacyDir, `${legacyName}.json`),
      JSON.stringify({
        session: SESSION,
        changes: {
          [CHANGE]: {
            created: true,
            specChanged: true,
            tasks: [TASK_ID],
            completed: true,
          },
        },
      }),
      'utf8',
    )
    await writeInvolvement(workspace, SESSION, [CHANGE])
    await writeFile(join(change, 'tasks.md'), CHECKED_TASKS, 'utf8')
    for (const changed of [...host.watch]) changed()
    await waitFor(async () =>
      (await listAuthenticatedRuns(workspace, auth)).some(
        (run) => run.definition.id === 'task-review',
      ),
    )

    // The next close starts the spec and integration triggers and advances the
    // task-review run: all three reviews go through the native executor.
    await closeTurn(host, 2)
    const specRecord = join('.dsh', 'workflows', 'records', 'spec-review', CHANGE, 'spec.json')
    const taskRecord = join(
      '.dsh',
      'workflows',
      'records',
      'task-review',
      CHANGE,
      'tasks',
      `${TASK_ID}.json`,
    )
    const integrationRecord = join(
      '.dsh',
      'workflows',
      'records',
      'integration-review',
      CHANGE,
      'integration.json',
    )
    await waitFor(async () => {
      for (const path of [specRecord, taskRecord, integrationRecord]) {
        if ((await readJson(join(workspace, path)))?.verdict !== 'PASS') return false
      }
      return true
    })
    await waitFor(async () => {
      const runs = (await listAuthenticatedRuns(workspace, auth)).filter((run) =>
        ['spec-review', 'task-review', 'integration-review'].includes(run.definition.id),
      )
      return (
        runs.length === 3 &&
        runs.every((run) => run.steps.some((step) => step.id === 'review' && step.state === 'done'))
      )
    })

    // Repeat the same close once every review settled: no run re-arms, every
    // run completes, and no reviewer starts a second time.
    await closeTurn(host, 2)
    await waitFor(async () => {
      const runs = (await listAuthenticatedRuns(workspace, auth)).filter((run) =>
        ['spec-review', 'task-review', 'integration-review'].includes(run.definition.id),
      )
      return runs.length === 3 && runs.every((run) => run.status === 'completed')
    })

    const native = host.activations.filter((activation) =>
      activation.prompt.includes(NATIVE_HEADER),
    )
    expect(native.map((activation) => activation.rule).sort()).toEqual([
      'integration-review',
      'spec-review',
      'task-review',
    ])
    // A legacy review would have started with the delegation prompt instead.
    expect(
      host.activations.filter((activation) => !activation.prompt.includes(NATIVE_HEADER)),
    ).toEqual([])
    expect(host.activations).toHaveLength(3)
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
    // The approval the task review published is the portable one.
    expect((await readJson(join(change, 'reviews', `${TASK_ID}.json`)))?.verdict).toBe('PASS')
  })
})
