import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { apply as applyDelegation } from '../../plugin-delegation-rules/src/host/index.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import { defaultGit, legacyWorktreeDigest } from '../src/host/git.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { readInvolvement, writeInvolvement } from '../src/host/involvement.ts'
import { listAuthenticatedRuns } from '../src/host/runs.ts'
import { sectionRecordId, taskIdOf } from '../src/host/tasks.ts'

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
const OWNED_CONTEXT = 'owned failure output: the retry test failed'
const OWNED_OBJECTIVE = 'owned objective: prove the native review keeps the caller payload'
const LEGACY_CONTEXT = 'legacy failure output: the retry test failed'
const LEGACY_OBJECTIVE = 'legacy objective: prove the legacy review keeps the caller payload'
const REPO = join(import.meta.dirname, '..', '..', '..')
const TEMP_DIRECTORIES: string[] = []

afterEach(async () => {
  delete process.env.DSH_WORKFLOWS_HOST_KEY
  for (const directory of TEMP_DIRECTORIES.splice(0)) {
    // Windows transiently locks a just-closed workspace (git children and the
    // scanner); retry long enough for the handle to drop instead of failing the
    // test in cleanup.
    await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
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
    // The rules and target stay configured for rollback; every switch above is off.
    expect(delegation.targets).toMatchObject({
      codex: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
    })
    expect(delegation.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'spec-review', when: 'spec-ready' }),
        expect.objectContaining({ id: 'task-review', when: 'spec-task-ready' }),
        expect.objectContaining({ id: 'integration-review', when: 'implementation-complete' }),
        expect.objectContaining({ id: 'lane-fanout', when: 'lane-assignment' }),
        expect.objectContaining({
          id: 'implementation-work',
          when: 'implementation-work',
          contract: 'note',
        }),
      ]),
    )
    expect(workflows.reviewers).toMatchObject({
      codex: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
    })
    expect(workflows).toMatchObject({
      reviewQueue: {
        enabled: true,
        concurrency: 2,
        maxQueued: 16,
        maxAttempts: 3,
        baseDelayMs: 5000,
        maxDelayMs: 60000,
        waitTimeoutMs: 300000,
      },
      timeouts: { review: 600000 },
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

const SECOND_TASK_TEXT = 'Second covered task'
const SECOND_TASK_ID = taskIdOf(SECOND_TASK_TEXT)
const UNCHECKED_TASK_ID = taskIdOf('Unchecked follow-up')
const SECTION_RECORD_ID = sectionRecordId('1')
const SECTION_TASKS = `# Tasks

## 1. Compose the profile (lane 1, owns \`packages/plugin-workflows/**\`)

- [x] 1.1 ${TASK_TEXT}
- [x] 1.2 ${SECOND_TASK_TEXT}
- [ ] 1.3 Unchecked follow-up

## 2. Docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Doc task
`

/** The same section with its second task still unchecked. */
const PENDING_SECTION_TASKS = SECTION_TASKS.replace('- [x] 1.2', '- [ ] 1.2')

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

  it('reviews a whole section through the owned definition run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(SECTION_TASKS)
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(workspace)
    applyDelegation(host.ctx as never, delegation as never)
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)
    await writeInvolvement(workspace, SESSION, [CHANGE])
    const change = join(workspace, 'openspec', 'changes', CHANGE)

    // The switch-only section call starts one owned definition run whose
    // context names the section and every checked task it covers.
    const started = toolText(
      await host.callTool('delegate', { rule: 'task-review', change: CHANGE, section: '1' }),
    )
    expect(started).toMatch(/section "1" review started/u)
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const runs = (await listAuthenticatedRuns(workspace, auth)).filter(
      (run) => run.definition.id === 'task-review',
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]?.context).toMatchObject({
      name: CHANGE,
      taskId: SECTION_RECORD_ID,
      section: '1',
      taskIds: [TASK_ID, SECOND_TASK_ID],
    })

    await closeTurn(host, 2)
    const recordPath = join(
      '.dsh',
      'workflows',
      'records',
      'task-review',
      CHANGE,
      'tasks',
      `${SECTION_RECORD_ID}.json`,
    )
    await waitFor(async () => (await readJson(join(workspace, recordPath)))?.verdict === 'PASS')
    const record = await readJson(join(workspace, recordPath))
    expect(record).toMatchObject({ scope: 'task', section: '1', verdict: 'PASS' })
    expect(record?.taskIds).toEqual([TASK_ID, SECOND_TASK_ID])
    // One prompt covers both checked tasks and never the unchecked one's id.
    const activations = host.activations.filter((activation) => activation.rule === 'task-review')
    expect(activations).toHaveLength(1)
    expect(activations[0]?.prompt).toContain(TASK_TEXT)
    expect(activations[0]?.prompt).toContain(SECOND_TASK_TEXT)
    expect(activations[0]?.prompt).not.toContain(UNCHECKED_TASK_ID)
    // One portable approval per covered checked task; none for the unchecked one.
    await waitFor(
      async () =>
        (await readJson(join(change, 'reviews', `${SECOND_TASK_ID}.json`)))?.verdict === 'PASS',
    )
    expect(await readJson(join(change, 'reviews', `${TASK_ID}.json`))).toMatchObject({
      rule: 'task-review',
      change: CHANGE,
      taskId: TASK_ID,
      verdict: 'PASS',
    })
    expect(await readJson(join(change, 'reviews', `${SECOND_TASK_ID}.json`))).toMatchObject({
      rule: 'task-review',
      change: CHANGE,
      taskId: SECOND_TASK_ID,
      verdict: 'PASS',
    })
    expect(await readJson(join(change, 'reviews', `${UNCHECKED_TASK_ID}.json`))).toBeUndefined()
    // The completion coverage step settles from those approvals.
    await closeTurn(host, 3)
    await waitFor(async () => {
      const run = (await listAuthenticatedRuns(workspace, auth)).find(
        (entry) => entry.id === runs[0]?.id,
      )
      return run?.status === 'completed'
    })
  })

  it('starts a distinct section run when a task is checked while one is pending', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(PENDING_SECTION_TASKS)
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(workspace)
    applyDelegation(host.ctx as never, delegation as never)
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const taskReviews = async () =>
      (await listAuthenticatedRuns(workspace, auth)).filter(
        (run) => run.definition.id === 'task-review',
      )

    // The first section run covers the one checked task and stays pending.
    expect(
      toolText(
        await host.callTool('delegate', { rule: 'task-review', change: CHANGE, section: '1' }),
      ),
    ).toMatch(/section "1" review started/u)
    const first = await taskReviews()
    expect(first).toHaveLength(1)
    expect(first[0]?.context).toMatchObject({ section: '1', taskIds: [TASK_ID] })

    // Check another task of the same section while the first run is pending.
    await writeFile(
      join(workspace, 'openspec', 'changes', CHANGE, 'tasks.md'),
      SECTION_TASKS,
      'utf8',
    )
    const started = toolText(
      await host.callTool('delegate', { rule: 'task-review', change: CHANGE, section: '1' }),
    )
    // The old run's coverage misses the newly checked task, so a distinct run
    // covering both tasks starts instead of the stale run being reused.
    expect(started).toMatch(/review started/u)
    const runs = await taskReviews()
    expect(runs).toHaveLength(2)
    expect(runs.find((run) => run.id !== first[0]?.id)?.context).toMatchObject({
      name: CHANGE,
      section: '1',
      taskIds: [TASK_ID, SECOND_TASK_ID],
    })
  })

  it('attributes an explicit owned review so a later implementation edit is refused', async () => {
    const workspace = await gitWorkspace(MIXED_TASKS)
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: false,
        laneFanout: false,
      },
      { seedInvolvement: false },
    )
    const started = toolText(
      await host.callTool('delegate', { rule: 'spec-review', change: CHANGE }),
    )
    expect(started).toMatch(/review started/u)
    // The explicit call is a fresh session's only attribution; both owners
    // filter their gates on it.
    expect(await readInvolvement(workspace, SESSION)).toContain(CHANGE)
    const legacyName = createHash('sha256').update(SESSION).digest('hex').slice(0, 16)
    const legacy = await readJson(
      join(workspace, '.dsh', 'delegation', 'sessions', `${legacyName}.json`),
    )
    expect(Object.keys((legacy?.changes ?? {}) as Record<string, unknown>)).toContain(CHANGE)
    // The next turn changes implementation only; the started review settles on
    // this close, and the owned gates must still refuse the unreviewed edit.
    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 2,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    await implementationWrite(host, workspace)
    await closeTurn(host, 2)
    const gate = host.steers.find((steer) => steer.kind === 'workflows-gate')
    expect(gate?.text).toContain('changed implementation files')
  })

  it('rejects a section identity over the run context limit before starting a run', async () => {
    const workspace = await gitWorkspace(`# Tasks

## 1. Large section (lane 1, owns \`packages/plugin-workflows/**\`)

${Array.from(
  { length: 220 },
  (_, index) => `- [x] 1.${String(index + 1)} Large section task ${String(index + 1)}`,
).join('\n')}
`)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: false,
      laneFanout: false,
    })
    // The covered ids are required run identity, so an oversized section must be
    // refused with the limit instead of starting a run whose context createRun
    // would replace with a truncation marker.
    const refused = (await host.callTool('delegate', {
      rule: 'task-review',
      change: CHANGE,
      section: '1',
    })) as { kind?: string; reason?: string }
    expect(refused.kind).toBe('deny')
    expect(refused.reason).toContain('220 checked tasks')
    expect(refused.reason).toContain('over the 4096-byte context limit')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    expect(
      (await listAuthenticatedRuns(workspace, auth)).filter(
        (run) => run.definition.id === 'task-review',
      ),
    ).toEqual([])
  })

  it('rejects a task selector on an owned whole-scope review before starting a run', async () => {
    const workspace = await gitWorkspace(MIXED_TASKS)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: false,
      laneFanout: false,
    })
    const refused = (await host.callTool('delegate', {
      rule: 'spec-review',
      change: CHANGE,
      task: 'missing-task',
    })) as { kind?: string; reason?: string }
    expect(refused.kind).toBe('deny')
    expect(refused.reason).toContain('rule "spec-review" reviews the whole scope; omit task')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    expect(
      (await listAuthenticatedRuns(workspace, auth)).filter(
        (run) => run.definition.id === 'spec-review',
      ),
    ).toEqual([])
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

  it('carries the caller context and objective into the owned reviewer prompt', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(MIXED_TASKS)
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(workspace)
    applyDelegation(host.ctx as never, delegation as never)
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)

    const started = toolText(
      await host.callTool('delegate', {
        rule: 'task-review',
        change: CHANGE,
        task: TASK_ID,
        context: OWNED_CONTEXT,
        objective: OWNED_OBJECTIVE,
      }),
    )
    expect(started).toMatch(/review started/u)
    // The offered fields persist on the run the next turn advances.
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const runs = (await listAuthenticatedRuns(workspace, auth)).filter(
      (run) => run.definition.id === 'task-review',
    )
    expect(runs).toHaveLength(1)
    expect(runs[0]?.context).toMatchObject({
      name: CHANGE,
      taskId: TASK_ID,
      context: OWNED_CONTEXT,
      objective: OWNED_OBJECTIVE,
    })

    await closeTurn(host, 2)
    await waitFor(() =>
      host.activations.some(
        (activation) =>
          activation.rule === 'task-review' && activation.prompt.includes(NATIVE_HEADER),
      ),
    )
    const prompt =
      host.activations.find(
        (activation) =>
          activation.rule === 'task-review' && activation.prompt.includes(NATIVE_HEADER),
      )?.prompt ?? ''
    expect(prompt).toContain('## Context')
    expect(prompt).toContain(OWNED_CONTEXT)
    expect(prompt).toContain('## Objective')
    expect(prompt).toContain(OWNED_OBJECTIVE)
    const recordPath = join(
      '.dsh',
      'workflows',
      'records',
      'task-review',
      CHANGE,
      'tasks',
      `${TASK_ID}.json`,
    )
    await waitFor(async () => (await readJson(join(workspace, recordPath)))?.verdict === 'PASS')
  })

  it('carries the caller context and objective into the legacy reviewer prompt', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(MIXED_TASKS)
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(workspace)
    applyDelegation(
      host.ctx as never,
      {
        ...delegation,
        gates: { ...(delegation.gates as Record<string, boolean>), workflowOwned: true },
      } as never,
    )
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)

    const before = host.activations.length
    const started = toolText(
      await host.callTool('delegate', {
        rule: 'task-review',
        change: CHANGE,
        task: TASK_ID,
        context: LEGACY_CONTEXT,
        objective: LEGACY_OBJECTIVE,
      }),
    )
    expect(started).toMatch(/review started|run:/u)
    await waitFor(() => host.activations.length > before)
    const prompt = host.activations.at(-1)?.prompt ?? ''
    expect(prompt).not.toContain(NATIVE_HEADER)
    expect(prompt).toContain('## Context')
    expect(prompt).toContain(LEGACY_CONTEXT)
    expect(prompt).toContain('## Objective')
    expect(prompt).toContain(LEGACY_OBJECTIVE)
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

const LANE_PLAN_TICKED = LANE_PLAN.replace('- [ ] 1.1 Engine task', '- [x] 1.1 Engine task')

async function openComposed(
  workspace: string,
  gates: Record<string, boolean>,
  options: {
    seedInvolvement?: boolean
    dropProgressNoteRule?: boolean
    /** The session's directory when it is nested inside the OpenSpec workspace. */
    sessionDir?: string
    /** Extra legacy rules on top of the composed row, such as lane-boundary. */
    extraRules?: Array<Record<string, unknown>>
    /** Turn the composed task-review rule off so the workflows runtime owns it. */
    disableTaskReviewRule?: boolean
  } = {},
): Promise<FakeHost> {
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  const delegation = await composedConfig('dsh-setup-delegation-rules')
  const workflows = await composedConfig('dsh-setup-workflows')
  const host = fakeHost(options.sessionDir ?? workspace)
  // A worker-start tool must be visible for the legacy lane gate to act.
  ;(host.ctx.tools as { register(definition: unknown): unknown }).register({
    name: 'subagent',
    execute: async () => ({ text: 'started' }),
  })
  // A progress switch with no covering note rule cannot steer, so the resolved
  // legacy signal is off even while the raw switch is on.
  const composedRules = options.dropProgressNoteRule
    ? (delegation.rules as Array<Record<string, unknown>>).filter(
        (rule) => !(rule.when === 'implementation-work' && rule.contract === 'note'),
      )
    : (delegation.rules as Array<Record<string, unknown>>)
  const rules = [...composedRules, ...(options.extraRules ?? [])].map((rule) =>
    options.disableTaskReviewRule === true &&
    rule.when === 'spec-task-ready' &&
    rule.contract === 'review' &&
    rule.scope === 'task'
      ? { ...rule, gate: 'none' }
      : rule,
  )
  applyDelegation(host.ctx as never, { ...delegation, rules, gates } as never)
  apply(host.ctx as never, workflows as never)
  await waitFor(() => host.watch.length > 0)
  if (options.seedInvolvement !== false) {
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
  }
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
async function implementationWrite(
  host: FakeHost,
  workspace: string,
  path = 'src/app.ts',
): Promise<void> {
  const file = join(workspace, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, 'export const app = 1\n', 'utf8')
  await host.emit(
    'tools/result',
    {
      agent: host.agent,
      callId: 'impl-write',
      name: 'write',
      arguments: { file_path: path },
    },
    { isError: false, content: [{ type: 'text', text: 'ok' }] },
  )
}

/** One canonical tasks.md write in the turn: the lane completion the boundary reads. */
async function completeLane(
  host: FakeHost,
  workspace: string,
  before: string,
  after: string,
): Promise<void> {
  const file = join(workspace, 'openspec', 'changes', CHANGE, 'tasks.md')
  await host.emit(
    'tools/result',
    { agent: host.agent, callId: 'lane-tick', name: 'write', arguments: { file_path: file } },
    { isError: false, value: { path: file, before, after }, content: [] },
  )
  await writeFile(file, after, 'utf8')
}

/** The native task-review PASS the owned runtime publishes for one checked task. */
async function writeNativeTaskPass(workspace: string, taskId: string): Promise<void> {
  const records = join(workspace, '.dsh', 'workflows', 'records', 'task-review', CHANGE, 'tasks')
  await mkdir(records, { recursive: true })
  await writeFile(
    join(records, `${taskId}.json`),
    JSON.stringify({
      rule: 'task-review',
      change: CHANGE,
      phase: 'task',
      scope: 'task',
      taskId,
      digest: 'a'.repeat(64),
      verdict: 'PASS',
      findings: [],
      target: { provider: 'codex-subagent' },
      time: '2026-11-14T10:00:00.000Z',
    }),
    'utf8',
  )
}

describe('task_progress routes by the resolved legacy signal', () => {
  it('writes the owned note path when the switch is on but no note rule covers it', async () => {
    const workspace = await gitWorkspace(MIXED_TASKS)
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: true,
        laneFanout: false,
      },
      { dropProgressNoteRule: true },
    )
    await implementationWrite(host, workspace)
    const output = toolText(
      await host.callTool('task_progress', {
        task: '1.2 Follow-up task',
        status: 'in-progress',
        reason: 'spans turns',
      }),
    )
    expect(output).toContain('progress note written')
    // The resolved signal is disabled, so the evidence belongs to the workflows
    // store, which is where the owned progress gate reads it.
    expect(
      await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeDefined()
    expect(
      await readJson(join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)),
    ).toBeUndefined()
    await closeTurn(host, 1)
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
    expect(host.steers.filter((steer) => steer.kind === 'workflows-gate')).toEqual([])
  })
})

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

  it('accepts the native PASS while workflowOwned is on and the task-review rule is off', async () => {
    const workspace = await gitWorkspace(UNCHECKED_TASKS)
    const host = await openComposed(
      workspace,
      {
        workflowOwned: true,
        specReview: false,
        integrationReview: false,
        taskProgress: true,
        laneFanout: false,
      },
      { disableTaskReviewRule: true },
    )
    // The disabled rule routes delegate to the workflows runtime, whose PASS is
    // native; the restored gate must read that store even though the raw
    // workflowOwned switch is on.
    await writeNativeTaskPass(workspace, TASK_ID)
    await completeLane(host, workspace, UNCHECKED_TASKS, CHECKED_TASKS)
    await implementationWrite(host, workspace)
    await closeTurn(host, 1)
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
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

/** The taskProgress-only rollback: the legacy progress gate stays, the lane is owned. */
const TASK_PROGRESS_ONLY = {
  workflowOwned: false,
  specReview: false,
  integrationReview: false,
  taskProgress: true,
  laneFanout: false,
}

const LANE_DOCS = '2. Docs (lane 2, owns `docs/**`)'

/** The last task is checked and reviewed while the earlier task stays open. */
const FINAL_PLAN = `# Tasks

## 1. Compose the profile (lane 1, owns \`packages/plugin-workflows/**\`)

- [ ] 1.1 First task
- [ ] 1.2 Final task
`
const FINAL_PLAN_CHECKED = FINAL_PLAN.replace('- [ ] 1.2', '- [x] 1.2')
const FINAL_TASK_TEXT = 'Final task'
const FINAL_TASK_ID = taskIdOf(FINAL_TASK_TEXT)

const PROGRESS_NOTE_CALL = /workflows \{ action: "note", change: "([^"]+)", task: "([^"]+)"/u
const TASK_PROGRESS_CALL = /task_progress\(task: "([^"]+)", status: "in-progress"/u

/** The task one printed serial-note steer names. */
function printedTask(text: string, pattern: RegExp): string {
  const match = pattern.exec(text)
  const task = match?.[2] ?? match?.[1]
  if (task === undefined) throw new Error(`the steer prints no serial note call:\n${text}`)
  return task
}

/**
 * The rollback cases the review requires on the real composed profile: both
 * production runtimes are mounted through the middleware chain, the printed
 * serial-note alternative is executed through the tool the *other* owner
 * printed, and the next close proves both gates accepted the same note.
 */
describe('mixed-ownership rollback through both production runtimes', () => {
  it('accepts the progress-owned task_progress note at the restored legacy lane gate', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: false,
      laneFanout: true,
    })
    // Lane 1 completes in this turn; lane 2 stays unassigned, so the legacy
    // lane gate prints its serial-note alternative while the workflows runtime
    // owns the progress signal.
    await completeLane(host, workspace, LANE_PLAN, LANE_PLAN_TICKED)
    await implementationWrite(host, workspace)
    await closeTurn(host, 1)
    const legacy = host.steers.find((steer) => steer.kind === 'delegation-rules')?.text ?? ''
    expect(legacy).toContain('lane assignment is missing')
    expect(legacy).toContain('task_progress(task: "2.1 Doc task"')
    expect(host.steers.find((steer) => steer.kind === 'workflows-gate')?.text).toContain(
      'changed implementation files',
    )

    // The printed call is the delegation task_progress tool; it routes the note
    // to the owning workflows store and forwards the returned lane to the
    // legacy lane state.
    const output = toolText(
      await host.callTool('task_progress', {
        task: printedTask(legacy, TASK_PROGRESS_CALL),
        status: 'in-progress',
        reason: 'docs stay serial',
      }),
    )
    expect(output).toContain('progress note written')
    const note = await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`))
    expect(note).toMatchObject({ session: SESSION, lane: LANE_DOCS })
    expect(note?.taskId).toBe(taskIdOf('Doc task'))
    expect(
      await readJson(join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)),
    ).toBeUndefined()

    // The restored lane gate accepted its own lane decision; the owned
    // progress gate accepted the same fresh note: no duplicate steer remains.
    host.steers.length = 0
    await closeTurn(host, 1)
    expect(host.steers).toEqual([])
  })

  it('accepts the lane-owned serial notes at the restored legacy progress gate', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(workspace, TASK_PROGRESS_ONLY)
    await completeLane(host, workspace, LANE_PLAN, LANE_PLAN_TICKED)
    await implementationWrite(host, workspace)
    await closeTurn(host, 1)
    const legacy = host.steers.find((steer) => steer.kind === 'delegation-rules')?.text ?? ''
    const owned = host.steers.find((steer) => steer.kind === 'workflows-gate')?.text ?? ''
    expect(legacy).toContain('changed implementation files')
    expect(legacy).toContain('task_progress(task: "2.1 Doc task"')
    expect(owned).toContain('lane assignment is missing')
    expect(owned).toContain('workflows { action: "note"')

    // Both printed calls write the active (legacy) progress store: the owned
    // note action and the legacy progress tool. The owned lane gate reads its
    // session decision from either call.
    const ownedText = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: printedTask(owned, PROGRESS_NOTE_CALL),
        status: 'in-progress',
        reason: 'docs stay serial',
      }),
    )
    expect(ownedText).toContain('delegation/task-progress')
    const legacyText = toolText(
      await host.callTool('task_progress', {
        task: printedTask(legacy, TASK_PROGRESS_CALL),
        status: 'in-progress',
        reason: 'docs stay serial',
      }),
    )
    expect(legacyText).toContain('delegation/task-progress')
    const note = await readJson(
      join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`),
    )
    expect(note?.worktreeDigest).toBe(await legacyWorktreeDigest(workspace, defaultGit))
    expect(note?.taskId).toBe(taskIdOf('Doc task'))
    expect(
      await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeUndefined()

    host.steers.length = 0
    await closeTurn(host, 1)
    expect(host.steers).toEqual([])
  })

  it('accepts the final task native PASS and the mixed serial note at the restored progress gate', async () => {
    const workspace = await gitWorkspace(FINAL_PLAN)
    const host = await openComposed(workspace, TASK_PROGRESS_ONLY)

    // The mixed serial-note path: the owned note action writes the legacy
    // progress store because the legacy switch owns the progress signal.
    await implementationWrite(host, workspace)
    await closeTurn(host, 1)
    expect(host.steers.find((steer) => steer.kind === 'delegation-rules')?.text).toContain(
      'changed implementation files',
    )
    const noteText = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: `1.2 ${FINAL_TASK_TEXT}`,
        status: 'in-progress',
        reason: 'the final task spans turns',
      }),
    )
    expect(noteText).toContain('delegation/task-progress')
    expect(
      (await readJson(join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)))
        ?.worktreeDigest,
    ).toBe(await legacyWorktreeDigest(workspace, defaultGit))
    host.steers.length = 0
    await closeTurn(host, 1)
    expect(host.steers).toEqual([])

    // Next turn: the final task is checked and reviewed natively. The review
    // run goes through the real delegate tool and the close executes it.
    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 2,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    await completeLane(host, workspace, FINAL_PLAN, FINAL_PLAN_CHECKED)
    const started = toolText(
      await host.callTool('delegate', {
        rule: 'task-review',
        change: CHANGE,
        task: FINAL_TASK_ID,
      }),
    )
    expect(started).toMatch(/review started/u)
    await closeTurn(host, 2)
    const recordPath = join(
      '.dsh',
      'workflows',
      'records',
      'task-review',
      CHANGE,
      'tasks',
      `${FINAL_TASK_ID}.json`,
    )
    const approvalPath = join('openspec', 'changes', CHANGE, 'reviews', `${FINAL_TASK_ID}.json`)
    await waitFor(async () => (await readJson(join(workspace, recordPath)))?.verdict === 'PASS')
    await waitFor(async () => (await readJson(join(workspace, approvalPath)))?.verdict === 'PASS')
    const review = host.activations.filter((activation) => activation.rule === 'task-review')
    expect(review).toHaveLength(1)
    expect(review[0]?.prompt).toContain(NATIVE_HEADER)
    // No legacy record: the restored gate must read the native store.
    expect(
      await readJson(
        join(
          workspace,
          '.dsh',
          'delegation',
          'task-review',
          CHANGE,
          'tasks',
          `${FINAL_TASK_ID}.json`,
        ),
      ),
    ).toBeUndefined()

    // The code-changing close after the tick is satisfied by the native PASS.
    host.steers.length = 0
    await implementationWrite(host, workspace, 'src/extra.ts')
    await closeTurn(host, 2)
    expect(host.steers).toEqual([])
  })
})

describe('mixed gate ownership routes one note through both owners', () => {
  it('writes the legacy store with the legacy digest and decides the owned lane', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: true,
      laneFanout: false,
    })
    await implementationWrite(host, workspace)
    const output = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'docs stay serial',
      }),
    )
    expect(output).toContain('delegation/task-progress')
    // The retained progress gate reads its own store and its HEAD-less format,
    // so a note routed there must record that digest.
    const note = await readJson(
      join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`),
    )
    expect(note?.worktreeDigest).toBe(await legacyWorktreeDigest(workspace, defaultGit))
    expect(
      await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeUndefined()
    await closeTurn(host, 1)
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
    // The owned lane gate takes the note's serial decision; only lane 1 is open.
    const lane = host.steers.find((steer) => steer.kind === 'workflows-gate')
    expect(lane?.text).toContain('Lane: 1. Engine')
    expect(lane?.text).not.toContain('Lane: 2. Docs')
  })

  it('updates the legacy lane decision from a progress-owned note', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: false,
      laneFanout: true,
    })
    await implementationWrite(host, workspace)
    const output = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: '1.1 Engine task',
        status: 'in-progress',
        reason: 'engine stays serial',
      }),
    )
    expect(output).toContain('progress note written')
    expect(
      await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeDefined()
    expect(
      await readJson(join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)),
    ).toBeUndefined()
    await closeTurn(host, 1)
    // The retained lane gate only knows the serial decision the note recorded.
    const legacy = host.steers.filter((steer) => steer.kind === 'delegation-rules')
    expect(legacy).toHaveLength(1)
    expect(legacy[0]?.text).toContain('Lane: 2. Docs')
    expect(legacy[0]?.text).not.toContain('Lane: 1. Engine')
    // The owned progress gate accepts the fresh workflow note.
    expect(host.steers.filter((steer) => steer.kind === 'workflows-gate')).toEqual([])
  })

  it('escapes a legacy lane boundary from a progress-owned serial note', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: false,
        laneFanout: true,
      },
      {
        extraRules: [
          { id: 'lane-boundary', when: 'lane-boundary', contract: 'note', gate: 'strict' },
        ],
      },
    )
    // Completing lane 1 in this turn makes the boundary refuse until the
    // remaining lane records its serial decision. The note goes to the workflow
    // store, so the legacy escape must read that owner's fresh note.
    await completeLane(host, workspace, LANE_PLAN, LANE_PLAN_TICKED)
    const output = toolText(
      await host.callTool('task_progress', {
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'docs stay serial',
      }),
    )
    expect(output).toContain('progress note written')
    expect(
      await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeDefined()
    expect(
      await readJson(join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)),
    ).toBeUndefined()
    await closeTurn(host, 1)
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
  })

  it('establishes the restored legacy involvement from a progress-owned note', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: false,
        laneFanout: true,
      },
      { seedInvolvement: false },
    )
    await implementationWrite(host, workspace)
    // A fresh session notes lane 1 through the workflows action: the workflow
    // store is not the one the retained gate filters on, so the same note must
    // also attribute the change to the legacy store.
    const output = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: '1.1 Engine task',
        status: 'in-progress',
        reason: 'engine stays serial',
      }),
    )
    expect(output).toContain('progress note written')
    await closeTurn(host, 1)
    const legacy = host.steers.filter((steer) => steer.kind === 'delegation-rules')
    expect(legacy).toHaveLength(1)
    expect(legacy[0]?.text).toContain('Lane: 2. Docs')
    expect(legacy[0]?.text).not.toContain('Lane: 1. Engine')
    expect(host.steers.filter((steer) => steer.kind === 'workflows-gate')).toEqual([])
  })

  it('establishes the restored legacy involvement from the progress-owned task_progress alias', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: false,
        laneFanout: true,
      },
      { seedInvolvement: false },
    )
    await implementationWrite(host, workspace)
    // The alias routes to the workflows note while the lane signal stays legacy;
    // the note must also persist the legacy attribution the lane gate filters on.
    const output = toolText(
      await host.callTool('task_progress', {
        task: '1.1 Engine task',
        status: 'in-progress',
        reason: 'engine stays serial',
      }),
    )
    expect(output).toContain('progress note written')
    expect(
      await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeDefined()
    await closeTurn(host, 1)
    const legacy = host.steers.filter((steer) => steer.kind === 'delegation-rules')
    expect(legacy).toHaveLength(1)
    expect(legacy[0]?.text).toContain('Lane: 2. Docs')
    expect(legacy[0]?.text).not.toContain('Lane: 1. Engine')
    expect(host.steers.filter((steer) => steer.kind === 'workflows-gate')).toEqual([])
  })

  it('attributes a workflow note to the restored progress gate so a later edit is refused', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: true,
        laneFanout: false,
      },
      { seedInvolvement: false },
    )
    // The note writes the restored progress gate's evidence, so it must also
    // establish the involvement that gate filters on; a fresh session has no
    // other attribution and the workflows progress gate is disabled here.
    const output = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: '1.1 Engine task',
        status: 'in-progress',
        reason: 'engine stays serial',
      }),
    )
    expect(output).toContain('progress note written')
    // The edit after the note moves the worktree digest, so the note is stale.
    await implementationWrite(host, workspace)
    await closeTurn(host, 1)
    const legacy = host.steers.filter((steer) => steer.kind === 'delegation-rules')
    expect(legacy).toHaveLength(1)
    expect(legacy[0]?.text).toContain('changed implementation files')
  })

  it('accepts the note the actual legacy task_progress path wrote', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: true,
      laneFanout: false,
    })
    await implementationWrite(host, workspace)
    const output = toolText(
      await host.callTool('task_progress', {
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'docs stay serial',
      }),
    )
    expect(output).toContain('progress note written')
    const note = await readJson(
      join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`),
    )
    expect(note?.worktreeDigest).toBe(await legacyWorktreeDigest(workspace, defaultGit))
    expect(note?.lane).toBeUndefined()
    await closeTurn(host, 1)
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
    // The owned lane gate still reads the title-less legacy note as current.
    const lane = host.steers.find((steer) => steer.kind === 'workflows-gate')
    expect(lane?.text).toContain('Lane: 1. Engine')
    expect(lane?.text).not.toContain('Lane: 2. Docs')
  })

  it('keeps an earlier legacy serial decision after the printed workflow note for another lane', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(workspace, {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: true,
      laneFanout: false,
    })
    await implementationWrite(host, workspace)
    // The actual legacy task_progress path decides lane 1 and writes the only
    // note file; its serial decision must outlive the next note.
    const engine = toolText(
      await host.callTool('task_progress', {
        task: '1.1 Engine task',
        status: 'in-progress',
        reason: 'engine stays serial',
      }),
    )
    expect(engine).toContain('progress note written')
    // The lane gate's printed remedy for lane 2 is the workflows note, which
    // overwrites that file; both lanes stay decided.
    const docs = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'docs stay serial',
      }),
    )
    expect(docs).toContain('progress note written')
    await closeTurn(host, 1)
    expect(host.steers.filter((steer) => steer.kind === 'workflows-gate')).toEqual([])
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
  })

  it('establishes the owned gate involvement from the actual legacy task_progress path', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: true,
        laneFanout: false,
      },
      { seedInvolvement: false },
    )
    await implementationWrite(host, workspace)
    // A fresh session notes lane 1 through the legacy runtime: the legacy store
    // is the only place that would attribute the change, so the workflows gate
    // must learn the involvement from the same legacy call.
    const engine = toolText(
      await host.callTool('task_progress', {
        task: '1.1 Engine task',
        status: 'in-progress',
        reason: 'engine stays serial',
      }),
    )
    expect(engine).toContain('progress note written')
    await closeTurn(host, 1)
    const lane = host.steers.find((steer) => steer.kind === 'workflows-gate')
    expect(lane?.text).toContain('Lane: 2. Docs')
    expect(lane?.text).not.toContain('Lane: 1. Engine')
  })
})

describe('goal-completion ownership', () => {
  /** Register the host-owned `update_goal` tool so callTool can dispatch it. */
  function registerGoalTool(host: FakeHost): void {
    host.tools.set('update_goal', {
      name: 'update_goal',
      execute: async () => ({ text: 'goal updated' }),
    })
  }

  it('refuses goal completion from the workflows listener, not the dormant legacy row', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(CHECKED_TASKS)
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')

    // The legacy row alone no longer dispatches the goal guard.
    const legacyOnly = fakeHost(workspace)
    applyDelegation(legacyOnly.ctx as never, delegation as never)
    registerGoalTool(legacyOnly)
    expect(await legacyOnly.callTool('update_goal', { action: 'complete' })).toMatchObject({
      text: 'goal updated',
    })

    // With both rows mounted, the workflows listener owns the refusal.
    const composed = fakeHost(workspace)
    applyDelegation(composed.ctx as never, delegation as never)
    apply(composed.ctx as never, workflows as never)
    registerGoalTool(composed)
    const refused = (await composed.callTool('update_goal', { action: 'complete' })) as {
      kind?: string
      reason?: string
    }
    expect(refused.kind).toBe('deny')
    expect(refused.reason).toContain('goal completion refused')
    expect(refused.reason).toContain('no portable task-review PASS')

    // The portable PASS the native review publishes satisfies the same guard.
    const reviews = join(workspace, 'openspec', 'changes', CHANGE, 'reviews')
    await mkdir(reviews, { recursive: true })
    await writeFile(
      join(reviews, `${TASK_ID}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: CHANGE,
        scope: 'task',
        taskId: TASK_ID,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-14T10:00:00.000Z',
      }),
      'utf8',
    )
    expect(await composed.callTool('update_goal', { action: 'complete' })).toMatchObject({
      text: 'goal updated',
    })
  })
})

describe('nested session directories route to the OpenSpec workspace', () => {
  it('starts and executes the owned delegate review at the workspace root', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(MIXED_TASKS)
    const nested = join(workspace, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(nested)
    applyDelegation(host.ctx as never, delegation as never)
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)

    // The legacy resolver finds the change from the nested directory; the owned
    // route must resolve the checked task and start the run at the same root.
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

    // The next close advances that root run; the native review reads the root
    // tasks.md and publishes its record and portable approval there.
    await closeTurn(host, 2)
    const recordPath = join(
      '.dsh',
      'workflows',
      'records',
      'task-review',
      CHANGE,
      'tasks',
      `${TASK_ID}.json`,
    )
    await waitFor(async () => (await readJson(join(workspace, recordPath)))?.verdict === 'PASS')
    expect(
      (await readJson(join(workspace, 'openspec', 'changes', CHANGE, 'reviews', `${TASK_ID}.json`)))
        ?.verdict,
    ).toBe('PASS')
    expect(host.activations.filter((entry) => !entry.prompt.includes(NATIVE_HEADER))).toEqual([])
  })

  it('writes the owned progress note at the workspace root', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitWorkspace(MIXED_TASKS)
    const nested = join(workspace, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    const workflows = await composedConfig('dsh-setup-workflows')
    const host = fakeHost(nested)
    applyDelegation(host.ctx as never, delegation as never)
    apply(host.ctx as never, workflows as never)
    await waitFor(() => host.watch.length > 0)

    const output = toolText(
      await host.callTool('task_progress', {
        task: '1.2 Follow-up task',
        status: 'in-progress',
        reason: 'spans turns',
      }),
    )
    expect(output).toContain('progress note written')
    const note = await readJson(join(workspace, '.dsh', 'workflows', 'notes', `${CHANGE}.json`))
    expect(note?.taskId).toBe(taskIdOf('Follow-up task'))
    expect(
      await readJson(join(nested, '.dsh', 'workflows', 'notes', `${CHANGE}.json`)),
    ).toBeUndefined()
  })

  it('accepts a workflows note from a nested session at the restored progress gate', async () => {
    const workspace = await gitWorkspace(LANE_PLAN)
    const nested = join(workspace, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: true,
        laneFanout: false,
      },
      { sessionDir: nested },
    )
    await implementationWrite(host, workspace)
    // The restored progress gate owns the legacy store, and the workflow writer
    // keeps it at the resolved OpenSpec workspace, so a nested session's note
    // must land there for its own gate to accept it.
    const output = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'docs stay serial',
      }),
    )
    expect(output).toContain('delegation/task-progress')
    expect(
      await readJson(join(workspace, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)),
    ).toBeDefined()
    expect(
      await readJson(join(nested, '.dsh', 'delegation', 'task-progress', `${CHANGE}.json`)),
    ).toBeUndefined()
    await closeTurn(host, 1)
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
  })

  it('accepts a reviewed tick from a nested session at the restored progress gate', async () => {
    const workspace = await gitWorkspace(UNCHECKED_TASKS)
    const nested = join(workspace, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const host = await openComposed(
      workspace,
      {
        workflowOwned: false,
        specReview: false,
        integrationReview: false,
        taskProgress: true,
        laneFanout: false,
      },
      { sessionDir: nested },
    )
    // The owned runtime publishes the task PASS at the resolved workspace root;
    // the restored gate must read that store, not the nested session directory.
    await writeNativeTaskPass(workspace, TASK_ID)
    await completeLane(host, workspace, UNCHECKED_TASKS, CHECKED_TASKS)
    await implementationWrite(host, workspace)
    await closeTurn(host, 1)
    expect(host.steers.filter((steer) => steer.kind === 'delegation-rules')).toEqual([])
  })
})
