import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { apply as applyDelegation } from '../../plugin-delegation-rules/src/host/index.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
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
  readonly tools: Map<string, ToolLike>
  emit(name: string, ...args: unknown[]): Promise<unknown>
  /** Run one model tool through the real pre-execute middleware chain. */
  callTool(name: string, args: unknown): Promise<unknown>
}

interface ToolLike {
  readonly name: string
  execute(
    args: unknown,
    exec: { agent: unknown; callId: string; signal: AbortSignal },
  ): Promise<unknown>
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
async function gitWorkspace(plan = UNCHECKED_TASKS): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-composed-'))
  TEMP_DIRECTORIES.push(directory)
  await writeFile(join(directory, '.gitignore'), '.dsh/\n', 'utf8')
  const change = join(directory, 'openspec', 'changes', CHANGE)
  await mkdir(join(change, 'specs', 'auth'), { recursive: true })
  await writeFile(join(change, 'proposal.md'), '# Proposal\n\nWhy.\n', 'utf8')
  await writeFile(join(change, 'design.md'), '# Design\n\nThe decision.\n', 'utf8')
  await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# Spec\n\nA requirement.\n', 'utf8')
  await writeFile(join(change, 'tasks.md'), plan, 'utf8')
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
  const tools = new Map<string, ToolLike>()
  const toolsService = {
    register(definition: ToolLike) {
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
  let toolCalls = 0
  const callTool = async (name: string, args: unknown): Promise<unknown> => {
    const tool = tools.get(name)
    if (tool === undefined) throw new Error(`no tool "${name}" is registered`)
    const chain = [...(listeners.get('tools/pre-execute') ?? [])]
    const callId = `composed-call-${String(++toolCalls)}`
    const exec = { agent, callId, name, arguments: args }
    const step = async (index: number): Promise<unknown> => {
      const listener = chain[index]
      if (listener === undefined) {
        return await tool.execute(args, {
          agent,
          callId,
          signal: new AbortController().signal,
        })
      }
      return await listener(exec, () => step(index + 1))
    }
    return await step(0)
  }
  return { ctx, agent, watch, activations, steers, tools, emit, callTool }
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

const MIXED_TASKS = `${UNCHECKED_TASKS.replace('- [ ] 1.1', '- [x] 1.1')}- [ ] 1.2 Follow-up task
`

function toolText(value: unknown): string {
  return typeof value === 'object' && value !== null && 'text' in value
    ? String((value as { text: unknown }).text)
    : JSON.stringify(value)
}

describe('deprecated aliases route by effective owner', () => {
  it('routes delegate and task_progress to the workflows runtime while the signals are owned', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(MIXED_TASKS)
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(workspace)
    applyDelegation(host.ctx as never, delegation as never)
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)

    // `delegate` starts the matching definition run instead of the legacy queue.
    const started = toolText(
      await host.callTool('delegate', { rule: 'task-review', change: CHANGE, task: TASK_ID }),
    )
    expect(started).toMatch(/review started/u)
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const runs = (await listAuthenticatedRuns(workspace, auth)).filter(
      (run) => run.definition.id === 'task-review',
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]?.context).toMatchObject({ name: CHANGE, taskId: TASK_ID })
    expect(host.activations).toHaveLength(0)

    // `task_progress` calls the workflows note action and writes its path.
    const progress = toolText(
      await host.callTool('task_progress', {
        task: '1.2 Follow-up task',
        status: 'in-progress',
        reason: 'spans turns',
      }),
    )
    expect(progress).toContain('progress note written')
    expect(progress).toContain('lane:')
    expect(
      await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeDefined()
    expect(
      await readJson(join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)),
    ).toBeUndefined()

    // `delegation_status` returns the workflows status summary with the one
    // deprecation line printed once.
    const status = toolText(await host.callTool('delegation_status', {}))
    expect(status).toContain('Workflows status')
    expect(status.match(/delegation_status is deprecated; use the workflows tool/gu)).toHaveLength(
      1,
    )
  })

  it('keeps the legacy runtime and the legacy note path while the switches are enabled', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(MIXED_TASKS)
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(workspace)
    applyDelegation(
      host.ctx as never,
      {
        ...delegation,
        gates: {
          ...(delegation.gates as Record<string, boolean>),
          workflowOwned: true,
          taskProgress: true,
        },
      } as never,
    )
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)

    const progress = toolText(
      await host.callTool('task_progress', {
        task: '1.2 Follow-up task',
        status: 'in-progress',
        reason: 'legacy note',
      }),
    )
    expect(progress).toContain('progress note written')
    expect(
      await readJson(join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)),
    ).toBeDefined()
    expect(
      await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeUndefined()

    const before = host.activations.length
    const started = toolText(
      await host.callTool('delegate', { rule: 'task-review', change: CHANGE, task: TASK_ID }),
    )
    expect(started).toMatch(/review started|already pending|run:/u)
    await waitFor(() => host.activations.length > before)
    expect(host.activations.at(-1)?.prompt.includes(NATIVE_HEADER)).toBe(false)
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    expect(
      (await listAuthenticatedRuns(workspace, auth)).filter(
        (run) => run.definition.id === 'task-review',
      ),
    ).toHaveLength(0)
  })

  it('returns the lane the legacy lane gate needs when progress is owned and the lane signal is legacy', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(MIXED_TASKS)
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(workspace)
    applyDelegation(
      host.ctx as never,
      {
        ...delegation,
        gates: { ...(delegation.gates as Record<string, boolean>), laneFanout: true },
      } as never,
    )
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)
    const output = toolText(
      await host.callTool('task_progress', {
        task: '1.2 Follow-up task',
        status: 'in-progress',
        reason: 'serial lane',
      }),
    )
    expect(output).toContain('progress note written')
    const note = await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`))
    expect(note?.lane).toBe('1. Compose the profile (lane 1, owns `packages/plugin-workflows/**`)')
    expect(toolText(await host.callTool('delegation_status', {}))).toContain('Workflows status')
  })
})

const LANE_PLAN = `# Tasks

## 1. Engine (lane 1, owns \`packages/engine/**\`)

- [ ] 1.1 Engine task

## 2. Docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Doc task
`

async function openComposed(workspace: string, gates: Record<string, boolean>): Promise<FakeHost> {
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  const delegation = await composedConfig('dsh-setup-delegation-rules')
  const workflows = await composedConfig('dsh-setup-workflows')
  const host = fakeHost(workspace)
  // A worker-start tool must be visible for the legacy lane gate to act.
  ;(host.ctx.tools as { register(definition: unknown): unknown }).register({
    name: 'subagent',
    execute: async () => ({ text: 'started' }),
  })
  applyDelegation(host.ctx as never, { ...delegation, gates } as never)
  apply(host.ctx as never, workflows as never)
  await waitFor(() => host.watch.length > 0)
  // Both runtimes need the session attributed to the change.
  const legacyName = createHash('sha256').update(SESSION).digest('hex').slice(0, 16)
  await mkdir(join(workspace, '.dsh', 'delegation', 'sessions'), { recursive: true })
  await writeFile(
    join(workspace, '.dsh', 'delegation', 'sessions', `${legacyName}.json`),
    JSON.stringify({
      session: SESSION,
      changes: { [CHANGE]: { created: true, specChanged: true, tasks: [], completed: false } },
    }),
    'utf8',
  )
  await writeInvolvement(workspace, SESSION, [CHANGE])
  // A current whole-spec PASS settles the owned spec-review run on this close
  // so only the two gates under test decide.
  const specDigest = await currentSpecDigest(workspace, CHANGE)
  if (specDigest !== undefined) {
    const records = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', CHANGE)
    await mkdir(records, { recursive: true })
    await writeFile(
      join(records, 'spec.json'),
      JSON.stringify({
        definition: 'spec-review',
        rule: 'spec-review',
        change: CHANGE,
        phase: 'spec',
        scope: 'whole',
        digest: specDigest,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-14T10:00:00.000Z',
      }),
      'utf8',
    )
  }
  await host.emit(
    'agent/pre-step',
    {
      agent: host.agent,
      turn: 1,
      step: 1,
      messages: [],
      signal: new AbortController().signal,
      modelSelection: { provider: 'p', model: 'm' },
    },
    async () => ({ kind: 'continue' }),
  )
  return host
}

/** One implementation write observed by both runtimes. */
async function implementationWrite(host: FakeHost, workspace: string): Promise<void> {
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
  await host.emit(
    'tools/result',
    {
      agent: host.agent,
      callId: 'impl-write',
      name: 'write',
      arguments: { file_path: 'src/app.ts' },
    },
    { isError: false, content: [{ type: 'text', text: 'ok' }] },
  )
}

describe('composed rollback of each engine gate', () => {
  it('restores the legacy progress steer while the owned lane gate keeps steering', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: true,
      laneFanout: false,
    })
    await implementationWrite(host, workspace)
    await closeTurn(host, 1)
    const kinds = host.steers.map((steer) => steer.kind)
    expect(kinds).toContain('delegation-rules')
    expect(kinds).toContain('workflows-gate')
    expect(host.steers.find((steer) => steer.kind === 'delegation-rules')?.text).toContain(
      'changed implementation files',
    )
    expect(host.steers.find((steer) => steer.kind === 'workflows-gate')?.text).toContain(
      'lane assignment is missing',
    )
  })

  it('restores the legacy lane steer while the owned progress gate keeps steering', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: false,
      laneFanout: true,
    })
    await implementationWrite(host, workspace)
    await closeTurn(host, 1)
    const kinds = host.steers.map((steer) => steer.kind)
    expect(kinds).toContain('delegation-rules')
    expect(kinds).toContain('workflows-gate')
    expect(host.steers.find((steer) => steer.kind === 'delegation-rules')?.text).toContain(
      'lane assignment is missing',
    )
    expect(host.steers.find((steer) => steer.kind === 'workflows-gate')?.text).toContain(
      'changed implementation files',
    )
  })
})
