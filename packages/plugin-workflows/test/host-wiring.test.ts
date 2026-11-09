import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadApprovedDefinitions } from '../src/host/approval-store.ts'
import { apply, definitionEventsOf } from '../src/host/index.ts'

/**
 * Host-level regression for the engine wiring: a `tools/pre-execute` call for
 * `openspec new change` must be refused with a started intake run and the
 * evaluation must land in the change-1 journal with its reason and run id.
 */

const TEMP_DIRECTORIES: string[] = []
const KEY = 'a'.repeat(64)

/** A test-only fault for the run-store reads; `undefined` passes through. */
const runStoreFaults = vi.hoisted(() => ({
  readdir: undefined as string | undefined,
  stat: undefined as string | undefined,
  writeFile: undefined as string | undefined,
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const reject = (code: string): Promise<never> =>
    Promise.reject(Object.assign(new Error('simulated run-store failure'), { code }))
  const inRunStore = (value: unknown): boolean =>
    String(value).replaceAll('\\', '/').includes('/workflows/runs')
  const fault = <T extends (...args: never[]) => unknown>(
    fn: T,
    code: () => string | undefined,
  ): T =>
    ((...args: never[]) => {
      const failure = code()
      return failure !== undefined && inRunStore(args[0]) ? reject(failure) : fn(...args)
    }) as T
  return {
    ...actual,
    readdir: fault(actual.readdir, () => runStoreFaults.readdir),
    stat: fault(actual.stat, () => runStoreFaults.stat),
    writeFile: ((...args: Parameters<typeof actual.writeFile>) => {
      const target = String(args[0]).replaceAll('\\', '/')
      return runStoreFaults.writeFile !== undefined &&
        target.includes('/workflows/runs/') &&
        target.endsWith('.tmp')
        ? reject(runStoreFaults.writeFile)
        : actual.writeFile(...args)
    }) as typeof actual.writeFile,
  }
})

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-wiring-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  delete process.env.DSH_WORKFLOWS_HOST_KEY
  runStoreFaults.readdir = undefined
  runStoreFaults.stat = undefined
  runStoreFaults.writeFile = undefined
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

type Listener = (...args: unknown[]) => unknown

function fakeHost(
  workspace: string,
  options: {
    readonly toolExecute?: boolean
    readonly userQuestions?: boolean
    readonly answer?: string
  } = {},
): {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  readonly commands: Array<Record<string, unknown>>
  readonly steers: readonly unknown[]
  readonly toolExecutions: Array<{
    readonly id: string
    readonly name: string
    readonly arguments: Record<string, unknown>
  }>
  emit(name: string, ...args: unknown[]): Promise<unknown>
  fireFs(error?: Error): void
} {
  const listeners = new Map<string, Listener[]>()
  const fsWatchers: Array<(error?: Error) => void> = []
  const steers: unknown[] = []
  const toolExecutions: Array<{
    id: string
    name: string
    arguments: Record<string, unknown>
  }> = []
  const agent = {
    id: 'session-1',
    session: { id: 'session-1', header: { origin: 'root' as const } },
    ctx: { on: () => () => {} },
    steer: (message: unknown) => {
      steers.push(message)
    },
    inject: () => {},
  }
  const commands: Array<Record<string, unknown>> = []
  const tools: Record<string, unknown> = {
    get: (name: string) =>
      ['delegate', 'task_progress', 'delegation_status', 'work_checkpoint'].includes(name)
        ? { name }
        : undefined,
    register: () => () => {},
  }
  if (options.toolExecute === true) {
    tools.execute = async (input: {
      calls: ReadonlyArray<{ id: string; name: string; arguments: Record<string, unknown> }>
    }) => {
      const results: Array<{ callId: string; result: Record<string, unknown> }> = []
      for (const call of input.calls) {
        toolExecutions.push({ id: call.id, name: call.name, arguments: call.arguments })
        // Route the host's own dispatch through the real pre-execute gate so an
        // unowned call would be refused exactly as in the live pipeline.
        let decision: { kind?: string; reason?: string } | undefined
        for (const listener of listeners.get('tools/pre-execute') ?? []) {
          decision = (await listener(
            {
              agent,
              callId: call.id,
              name: call.name,
              arguments: call.arguments,
            },
            async () => ({ kind: 'continue' }),
          )) as { kind?: string; reason?: string } | undefined
        }
        const denied = decision?.kind === 'deny'
        const command = typeof call.arguments.command === 'string' ? call.arguments.command : ''
        if (!denied && command.startsWith('openspec new change ')) {
          const name = command.slice('openspec new change '.length)
          const change = join(workspace, 'openspec', 'changes', name)
          await mkdir(change, { recursive: true })
          await writeFile(join(change, '.openspec.yaml'), 'version: 1\n', 'utf8')
        }
        results.push({
          callId: call.id,
          result: denied
            ? {
                isError: true,
                content: [{ type: 'text', text: decision?.reason ?? 'denied' }],
              }
            : {
                isError: false,
                value: {
                  kind: 'foreground',
                  cwd: workspace,
                  exitCode: 0,
                  signal: null,
                  timedOut: false,
                  aborted: false,
                  timeoutMs: 120_000,
                  stdout: { text: '', truncated: false },
                  stderr: { text: '', truncated: false },
                },
              },
        })
      }
      return { results }
    }
  }
  const ctx = {
    get(name: string): unknown {
      if (name === 'agents') return { get: () => agent, list: () => [agent] }
      if (name === 'workingDirectory') return { get: () => workspace }
      if (name === 'fs') {
        return {
          resolve: async (path: unknown) => ({ targetKey: String(path) }),
          watch: async (_target: unknown, changed: (error?: Error) => void) => {
            fsWatchers.push(changed)
            return async () => {}
          },
        }
      }
      if (name === 'connection') return { fetch: { register: () => () => {} } }
      if (name === 'tools') return tools
      if (name === 'userQuestions' && options.userQuestions === true) {
        return {
          ask: async (request: { questions: Array<{ id: string }> }) => ({
            answers: request.questions.map((question) => ({
              id: question.id,
              selected: [options.answer ?? 'yes'],
            })),
          }),
        }
      }
      if (name === 'commands') {
        return {
          register: (definition: Record<string, unknown>) => {
            commands.push(definition)
            return () => {}
          },
        }
      }
      return undefined
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
    commands,
    steers,
    toolExecutions,
    fireFs(error) {
      for (const changed of fsWatchers) changed(error)
    },
    async emit(name, ...args): Promise<unknown> {
      let result: unknown
      for (const listener of listeners.get(name) ?? []) result = await listener(...args)
      return result
    },
  }
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the host did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('engine host wiring', () => {
  it('records a pre-execute evaluation with run-created and the run id', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    let nextCalled = false
    const decision = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'call-1',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string; reason?: string } | undefined
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () =>
      (await readFile(journalFile, 'utf8').catch(() => '')).includes('definition:change-intake'),
    )
    const raw = await readFile(journalFile, 'utf8')
    const record = raw
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.kind === 'tools/pre-execute') as
      | { readonly triggers?: Array<Record<string, unknown>> }
      | undefined
    expect(
      record?.triggers?.find((entry) => entry.id === 'definition:change-intake'),
    ).toMatchObject({
      matched: true,
      reason: 'run-created',
    })
    const created = record?.triggers?.find((entry) => entry.id === 'definition:change-intake')
    expect(typeof created?.runId).toBe('string')
    // The first call is refused with the started run and the first step; the
    // evaluated intake trigger is not a second run.
    expect(nextCalled).toBe(false)
    expect(decision?.kind).toBe('deny')
    expect(decision?.reason).toContain('requirements')
  })
})

describe('definition event normalization', () => {
  it('carries the review verdict and content hash into the review event', async () => {
    const workspace = await tempWorkspace()
    const path = 'openspec/changes/auth/reviews/0123456789abcdef.json'
    await import('node:fs/promises').then(async ({ mkdir, writeFile }) => {
      await mkdir(join(workspace, 'openspec', 'changes', 'auth', 'reviews'), { recursive: true })
      await writeFile(
        join(workspace, path),
        `${JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId: '0123456789abcdef', verdict: 'PASS', digest: 'a'.repeat(64), findings: [], time: '2026-11-08T00:00:00.000Z' })}\n`,
        'utf8',
      )
    })
    const { definitionEventsOf } = await import('../src/host/index.ts')
    const events = definitionEventsOf(
      {
        at: 1,
        session: 'session-1',
        turn: 2,
        kind: 'fs.change',
        subject: path,
        summary: 'x',
        bytes: 1,
        truncated: false,
      },
      { kind: 'fs.change', subject: path, change: 'modified', hash: 'abc' },
      workspace,
    )
    const review = events.find((event) => event.kind === 'review.record')
    expect(review).toMatchObject({ verdict: 'PASS', hash: 'abc', workspace })
  })
})

describe('retro applicability through the journal path', () => {
  it('records not-applicable for a short turn and creates an observational run for an applicable turn', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    const readJournal = async (): Promise<Array<Record<string, unknown>>> =>
      (await readFile(journalFile, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    const retroRows = async (): Promise<Array<Record<string, unknown>>> =>
      (await readJournal()).flatMap((entry) =>
        Array.isArray(entry.triggers)
          ? (entry.triggers as Array<Record<string, unknown>>).filter(
              (row) => row.id === 'definition:retro',
            )
          : [],
      )

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
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(async () => (await retroRows()).some((row) => row.reason === 'not-applicable'))
    expect((await retroRows()).some((row) => row.reason === 'run-created')).toBe(false)

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
    for (const name of ['read', 'read', 'read', 'read', 'write']) {
      await host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId: `call-${name}`,
          name,
          arguments: name === 'write' ? { file_path: 'src/app.ts' } : {},
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    await waitFor(async () => (await retroRows()).some((row) => row.reason === 'run-created'))
    expect((await retroRows()).some((row) => row.reason === 'run-created')).toBe(true)

    // A later short turn completes the existing observational run and makes it
    // pruneable instead of leaving it blocked forever.
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // No checkpoint record for this turn: the run and its step stay blocked.
    const blockedRetro = (await runs.listAuthenticatedRuns(workspace, auth)).find(
      (entry) => entry.definition === 'retro',
    )
    expect(blockedRetro?.steps[0]?.state).toBe('blocked')
    const runId = String(
      (await retroRows()).find((row) => row.reason === 'run-created')?.runId ?? '',
    )
    expect(runId).not.toBe('')
    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 3,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 3 })
    await new Promise((resolve) => setTimeout(resolve, 200))
    console.log(
      'DEBUG-RETRO',
      JSON.stringify(await retroRows()),
      JSON.stringify(await runs.readAuthenticatedRun(workspace, runId, auth)),
    )
    await waitFor(async () => {
      const stored = await runs.readAuthenticatedRun(workspace, runId, auth)
      return stored?.status === 'completed'
    })
    const terminal = await runs.readAuthenticatedRun(workspace, runId, auth)
    expect(terminal?.reason).toBe('not-applicable')
  })
})

describe('retro fresh checkpoint', () => {
  it('reads the checkpoint for an applicable turn and never steers', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const { createHash } = await import('node:crypto')
    const sessionKey = createHash('sha256').update('session-1').digest('hex').slice(0, 16)
    const checkpointDir = join(workspace, '.dsh', 'work-checkpoints', sessionKey)
    await mkdir(checkpointDir, { recursive: true })
    await writeFile(
      join(checkpointDir, '2.json'),
      `${JSON.stringify({ outcome: 'done', turn: 2, lanes: [], next: 'continue' })}\n`,
      'utf8',
    )
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
    for (const name of ['read', 'read', 'read', 'read', 'write']) {
      await host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId: `call-${name}`,
          name,
          arguments: name === 'write' ? { file_path: 'src/app.ts' } : {},
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let retroRun: { id: string } | undefined
    await waitFor(async () => {
      retroRun = (await runs.listAuthenticatedRuns(workspace, auth)).find(
        (entry) => entry.definition === 'retro',
      )
      return retroRun !== undefined
    })
    await waitFor(async () => {
      const stored = await runs.readAuthenticatedRun(workspace, retroRun?.id ?? '', auth)
      return stored?.steps[0]?.state === 'done'
    })
    expect(host.steers).toHaveLength(0)
  })
})

describe('retro applicability evidence', () => {
  it('counts only successful writes and started delegates', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    const retroRows = async (): Promise<Array<Record<string, unknown>>> =>
      (await readFile(journalFile, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .flatMap((line) => {
          try {
            const entry = JSON.parse(line) as { triggers?: Array<Record<string, unknown>> }
            return entry.triggers ?? []
          } catch {
            return []
          }
        })
        .filter((row) => row.id === 'definition:retro')
    const emitTurn = async (
      turn: number,
      results: ReadonlyArray<{
        name: string
        args: Record<string, unknown>
        isError?: boolean
        text?: string
      }>,
    ): Promise<void> => {
      await host.emit(
        'agent/pre-step',
        {
          agent: host.agent,
          turn,
          step: 1,
          messages: [],
          signal: new AbortController().signal,
          modelSelection: { provider: 'p', model: 'm' },
        },
        async () => ({ kind: 'continue' }),
      )
      for (const [index, result] of results.entries()) {
        await host.emit(
          'tools/result',
          {
            agent: host.agent,
            callId: `call-${String(turn)}-${String(index)}`,
            name: result.name,
            arguments: result.args,
          },
          {
            isError: result.isError === true,
            content: [{ type: 'text', text: result.text ?? 'ok' }],
          },
        )
      }
      await host.emit('agent/turn-stopping', { agent: host.agent, turn })
    }
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const retroRuns = async (): Promise<Array<{ id: string }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth)).filter(
        (entry) => entry.definition === 'retro',
      )

    // Three reads plus a failed write is not a write: no run.
    await emitTurn(1, [
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'write', args: { file_path: 'src/app.ts' }, isError: true },
    ])
    await waitFor(async () => (await retroRows()).some((row) => row.reason === 'not-applicable'))
    expect(await retroRuns()).toHaveLength(0)

    // Three reads plus a started delegate is a worker: one run.
    await emitTurn(2, [
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'delegate', args: {}, text: 'rule "task-review" review started' },
    ])
    await waitFor(async () => (await retroRows()).some((row) => row.reason === 'run-created'))
    expect(await retroRuns()).toHaveLength(1)
  })
})

describe('task-review runtime from a tasks.md change', () => {
  it('names the change and the task from the path and checked delta and never steers', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    // The archive collection and an incomplete change precede the real change;
    // neither may stop the baseline seeding for auth.
    await mkdir(join(workspace, 'openspec', 'changes', 'archive'), { recursive: true })
    await mkdir(join(workspace, 'openspec', 'changes', 'aaa-incomplete'), { recursive: true })
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n- [ ] 1.2 Second task\n', 'utf8')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const taskIds = [taskIdOf('Task'), taskIdOf('Second task')]
    for (const taskId of taskIds) {
      await writeFile(
        join(changeDir, 'reviews', `${taskId}.json`),
        `${JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
        'utf8',
      )
    }
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    const rows = async (): Promise<Array<Record<string, unknown>>> =>
      (await readFile(journalFile, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .flatMap((line) => {
          try {
            const entry = JSON.parse(line) as { triggers?: Array<Record<string, unknown>> }
            return entry.triggers ?? []
          } catch {
            return []
          }
        })
        .filter((row) => row.id === 'definition:task-review')

    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n- [x] 1.2 Second task\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await rows()).some((row) => row.reason === 'run-created'))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const taskRuns = async (): Promise<Array<{ id: string; context: Record<string, unknown> }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth))
        .filter((entry) => entry.definition === 'task-review')
        .map((entry) => ({ id: entry.id, context: entry.context }))
    await waitFor(async () => (await taskRuns()).length === 2)
    const created = await taskRuns()
    expect(created.map((run) => run.context.taskId).sort()).toEqual([...taskIds].sort())
    expect(created.every((run) => run.context.name === 'auth')).toBe(true)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    for (const run of created) {
      const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
      expect(settled?.steps[0]?.state).toBe('done')
    }
    expect(host.steers).toHaveLength(0)

    // An edit that checks nothing starts no second observational run.
    await writeFile(join(changeDir, 'tasks.md'), '# Notes\n\n- [x] 1.1 Task\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await rows()).some((row) => row.reason === 'run-suppressed'))
    expect(await taskRuns()).toHaveLength(2)
  })
})

describe('pre-execute trigger gates', () => {
  async function journalRows(workspace: string): Promise<Array<Record<string, unknown>>> {
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    return (await readFile(file, 'utf8').catch(() => ''))
      .trim()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  }

  function intakeRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
    return rows.flatMap((entry) =>
      Array.isArray(entry.triggers)
        ? (entry.triggers as Array<Record<string, unknown>>).filter(
            (row) => row.id === 'definition:change-intake',
          )
        : [],
    )
  }

  it('does not create an intake run for a shadow or session-filtered trigger', async () => {
    // A shadow local override of change-intake and a session-filtered local
    // definition are installed through the host path before the plugin loads.
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const shadow = {
      v: 1,
      id: 'change-intake',
      name: 'Shadow intake override',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'shell', command: 'openspec new change <name>' },
        mode: 'shadow',
        dedupe: 'name',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'only',
          title: 'Only',
          executor: 'main',
          prompt: 'Do.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(join(workspace, 'shadow.json'), `${JSON.stringify(shadow, null, 2)}\n`, 'utf8')
    })
    await installDefinition(workspace, join(workspace, 'shadow.json'), auth)
    // A session-filtered active definition for the same command.
    const filtered = {
      ...shadow,
      id: 'filtered-intake',
      name: 'Filtered intake',
      trigger: { ...shadow.trigger, mode: 'active', match: { session: 'another-session' } },
      steps: shadow.steps.map((step) => ({ ...step, id: 'filtered-only' })),
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(
        join(workspace, 'filtered.json'),
        `${JSON.stringify(filtered, null, 2)}\n`,
        'utf8',
      )
    })
    await installDefinition(workspace, join(workspace, 'filtered.json'), auth)
    const loaded = await loadApprovedDefinitions(workspace, { auth })
    expect(loaded.definitions.find((entry) => entry.id === 'change-intake')?.trigger.mode).toBe(
      'shadow',
    )
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    let nextCalled = false
    await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'call-shadow',
        name: 'pwsh',
        arguments: { command: 'openspec new change shadow-auth' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )
    await waitFor(async () => (await journalRows(workspace)).length > 0)
    const rows = await journalRows(workspace)
    expect(nextCalled).toBe(true)
    expect(intakeRows(rows).some((row) => row.reason === 'would-fire')).toBe(true)
    await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'call-shadow-2',
        name: 'pwsh',
        arguments: { command: 'openspec new change shadow-auth' },
      },
      async () => ({ kind: 'continue' }),
    )
    await waitFor(async () =>
      intakeRows(await journalRows(workspace)).some((row) => row.reason === 'dedupe'),
    )
    expect(intakeRows(await journalRows(workspace)).some((row) => row.reason === 'dedupe')).toBe(
      true,
    )
    expect(intakeRows(rows).some((row) => row.reason === 'run-created')).toBe(false)
  })

  it('refuses a second call while the intake run is in progress and starts no second run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const call = async (callId: string): Promise<unknown> =>
      host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId,
          name: 'pwsh',
          arguments: { command: 'openspec new change auth' },
        },
        async () => ({ kind: 'continue' }),
      )
    const first = (await call('call-1')) as { kind?: string }
    const second = (await call('call-2')) as { kind?: string; reason?: string }
    expect(first.kind).toBe('deny')
    expect(second.kind).toBe('deny')
    expect(second.reason).toContain('already in progress')
    const runs = await import('node:fs/promises').then(async ({ readdir }) =>
      (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
        name.endsWith('.json'),
      ),
    )
    expect(runs).toHaveLength(1)
  })

  it('evaluates a non-intake pre-execute trigger and starts its run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const readDefinition = {
      v: 1,
      id: 'read-watch',
      name: 'Read watch',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'read' },
        mode: 'active',
        dedupe: 'callId',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(
        join(workspace, 'read.json'),
        `${JSON.stringify(readDefinition, null, 2)}\n`,
        'utf8',
      )
    })
    await installDefinition(workspace, join(workspace, 'read.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    let nextCalled = false
    for (const callId of ['call-read-1', 'call-read-2', 'call-read-2']) {
      await host.emit(
        'tools/pre-execute',
        { agent: host.agent, callId, name: 'read', arguments: { path: 'a.md' } },
        async () => {
          nextCalled = true
          return { kind: 'continue' }
        },
      )
    }
    await waitFor(async () =>
      (await journalRows(workspace)).some((entry) =>
        Array.isArray(entry.triggers)
          ? (entry.triggers as Array<Record<string, unknown>>).some(
              (row) => row.id === 'definition:read-watch' && row.reason === 'run-created',
            )
          : false,
      ),
    )
    expect(nextCalled).toBe(true)
    const rows = await journalRows(workspace)
    const runs = rows.flatMap((entry) =>
      Array.isArray(entry.triggers)
        ? (entry.triggers as Array<Record<string, unknown>>).filter(
            (row) => row.id === 'definition:read-watch',
          )
        : [],
    )
    expect(runs.filter((row) => row.reason === 'run-created')).toHaveLength(2)
    expect(runs.some((row) => row.reason === 'dedupe')).toBe(true)
  })

  it('does not consume the dedupe key when the run write fails', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'read-retry',
      name: 'Read retry',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'read' },
        mode: 'active',
        dedupe: 'callId',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(join(workspace, 'retry.json'), `${JSON.stringify(definition, null, 2)}\n`, 'utf8')
    })
    await installDefinition(workspace, join(workspace, 'retry.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const emit = async (): Promise<void> => {
      await host.emit(
        'tools/pre-execute',
        { agent: host.agent, callId: 'call-retry', name: 'read', arguments: {} },
        async () => ({ kind: 'continue' }),
      )
    }
    // A failed run write leaves the dedupe key unconsumed.
    runStoreFaults.writeFile = 'EACCES'
    await emit()
    await waitFor(async () => (await journalRows(workspace)).length > 0)
    const first = (await journalRows(workspace)).flatMap((entry) =>
      Array.isArray(entry.triggers)
        ? (entry.triggers as Array<Record<string, unknown>>).filter(
            (row) => row.id === 'definition:read-retry',
          )
        : [],
    )
    expect(first.some((row) => row.reason === 'run-suppressed')).toBe(true)
    runStoreFaults.writeFile = undefined
    await emit()
    await waitFor(async () => {
      const rows = (await journalRows(workspace)).flatMap((entry) =>
        Array.isArray(entry.triggers)
          ? (entry.triggers as Array<Record<string, unknown>>).filter(
              (row) => row.id === 'definition:read-retry',
            )
          : [],
      )
      return rows.some((row) => row.reason === 'run-created')
    })
  })
})

describe('concurrent pre-execute evaluation', () => {
  it('creates one run for two concurrent matching calls with one dedupe key', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'turn-watch',
      name: 'Turn watch',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'read' },
        mode: 'active',
        dedupe: 'turn',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(join(workspace, 'turn.json'), `${JSON.stringify(definition, null, 2)}\n`, 'utf8')
    })
    await installDefinition(workspace, join(workspace, 'turn.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 5,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    const call = async (callId: string): Promise<unknown> =>
      host.emit(
        'tools/pre-execute',
        { agent: host.agent, callId, name: 'read', arguments: {} },
        async () => ({ kind: 'continue' }),
      )
    await Promise.all([call('call-a'), call('call-b')])
    const { readdir } = await import('node:fs/promises')
    const runs = (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
      name.endsWith('.json'),
    )
    expect(runs).toHaveLength(1)
  })
})

describe('startup event capture', () => {
  it('evaluates an event received while the definitions are still loading', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    // No wait: the definitions are still loading when this event arrives.
    await host.emit(
      'tools/result',
      { agent: host.agent, callId: 'early-call', name: 'delegate', arguments: {} },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () =>
      (await readFile(file, 'utf8').catch(() => '')).includes('definition:'),
    )
    const rows = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { readonly triggers?: Array<{ readonly id?: unknown }> })
    expect(
      rows.some(
        (entry) =>
          Array.isArray(entry.triggers) &&
          entry.triggers.some((row) => String(row.id).startsWith('definition:')),
      ),
    ).toBe(true)
  })
})

describe('repeat under concurrency', () => {
  it('creates a run for every concurrent matching event when repeat is true', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'repeat-watch',
      name: 'Repeat watch',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'read' },
        mode: 'active',
        dedupe: 'turn',
        repeat: true,
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(
        join(workspace, 'repeat.json'),
        `${JSON.stringify(definition, null, 2)}\n`,
        'utf8',
      )
    })
    await installDefinition(workspace, join(workspace, 'repeat.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 7,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    const call = async (callId: string): Promise<unknown> =>
      host.emit(
        'tools/pre-execute',
        { agent: host.agent, callId, name: 'read', arguments: {} },
        async () => ({ kind: 'continue' }),
      )
    await Promise.all([call('repeat-a'), call('repeat-b')])
    const { readdir } = await import('node:fs/promises')
    const runs = (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
      name.endsWith('.json'),
    )
    expect(runs).toHaveLength(2)
  })
})

describe('startup active events', () => {
  it('signs and creates the run for an event received before the key is ready', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'early-active',
      name: 'Early active',
      version: 1,
      trigger: { kind: 'tool.result', match: { tool: 'read' }, mode: 'active', dedupe: 'callId' },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(join(workspace, 'early.json'), `${JSON.stringify(definition, null, 2)}\n`, 'utf8')
    })
    await installDefinition(workspace, join(workspace, 'early.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    // No delay: the definitions and the host key are still loading.
    await host.emit(
      'tools/result',
      { agent: host.agent, callId: 'early-read', name: 'read', arguments: {} },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () => {
      const rows = (await readFile(file, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { readonly triggers?: Array<Record<string, unknown>> })
      return rows.some((entry) =>
        Array.isArray(entry.triggers)
          ? entry.triggers.some(
              (row) => row.id === 'definition:early-active' && row.reason === 'run-created',
            )
          : false,
      )
    })
    const { readdir } = await import('node:fs/promises')
    const runs = (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
      name.endsWith('.json'),
    )
    expect(runs).toHaveLength(1)
  })
})

describe('pre-execute without a host key', () => {
  it('still journals the evaluation and refuses a matching active intake', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = 'not-hex'
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    let nextCalled = false
    const decision = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'no-key-call',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string; reason?: string } | undefined
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () =>
      (await readFile(file, 'utf8').catch(() => '')).includes('definition:'),
    )
    const rows = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { readonly triggers?: Array<Record<string, unknown>> })
    const intake = rows
      .flatMap((entry) =>
        Array.isArray(entry.triggers)
          ? (entry.triggers as Array<Record<string, unknown>>).filter(
              (row) => row.id === 'definition:change-intake',
            )
          : [],
      )
      .find((row) => row.reason === 'run-suppressed')
    expect(intake).toBeDefined()
    expect(String(intake?.detail)).toContain('host key is unavailable')
    expect(nextCalled).toBe(false)
    expect(decision?.kind).toBe('deny')
    expect(decision?.reason).toContain('host key is unavailable')
  })
})

describe('dedupe after reload', () => {
  it('does not create a second run for a replayed trigger identity', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'reload-watch',
      name: 'Reload watch',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'read' },
        mode: 'active',
        dedupe: 'callId',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(
        join(workspace, 'reload.json'),
        `${JSON.stringify(definition, null, 2)}\n`,
        'utf8',
      )
    })
    await installDefinition(workspace, join(workspace, 'reload.json'), auth)
    const first = fakeHost(workspace)
    apply(first.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await first.emit(
      'tools/pre-execute',
      {
        agent: first.agent,
        callId: 'replay-call',
        name: 'read',
        arguments: {},
      },
      async () => ({ kind: 'continue' }),
    )
    const runsDirectory = join(workspace, '.dsh', 'workflows', 'runs')
    await waitFor(async () => {
      const { readdir } = await import('node:fs/promises')
      return (await readdir(runsDirectory).catch(() => [])).some((name) => name.endsWith('.json'))
    })
    const second = fakeHost(workspace)
    apply(second.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const replay = async (): Promise<unknown> =>
      second.emit(
        'tools/pre-execute',
        {
          agent: second.agent,
          callId: 'replay-call',
          name: 'read',
          arguments: {},
        },
        async () => ({ kind: 'continue' }),
      )
    await Promise.all([replay(), replay()])
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () => {
      const rows = (await readFile(file, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { readonly triggers?: Array<Record<string, unknown>> })
      return rows.some((entry) =>
        Array.isArray(entry.triggers)
          ? entry.triggers.some(
              (row) => row.id === 'definition:reload-watch' && row.reason === 'dedupe',
            )
          : false,
      )
    })
    const { readdir } = await import('node:fs/promises')
    const runs = (await readdir(runsDirectory)).filter((name) => name.endsWith('.json'))
    expect(runs).toHaveLength(1)
  })
})

describe('intent production path', () => {
  it('classifies a user message and starts a confirmed active intent run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'intent-watch',
      name: 'Intent watch',
      version: 1,
      trigger: {
        kind: 'intent',
        match: { intent: 'new-change', classifier: 'heuristic-v1' },
        mode: 'active',
        dedupe: 'turn',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: true,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(
        join(workspace, 'intent.json'),
        `${JSON.stringify(definition, null, 2)}\n`,
        'utf8',
      )
    })
    await installDefinition(workspace, join(workspace, 'intent.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never, { allowIntent: true })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 3,
        step: 2,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Please start a new change for auth' }] },
        ],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () => {
      const rows = (await readFile(file, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      return rows.some(
        (entry) =>
          entry.kind === 'intent' &&
          Array.isArray(entry.triggers) &&
          (entry.triggers as Array<Record<string, unknown>>).some(
            (row) => row.id === 'definition:intent-watch' && row.reason === 'run-created',
          ),
      )
    })
    const { readdir } = await import('node:fs/promises')
    const runs = (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
      name.endsWith('.json'),
    )
    expect(runs).toHaveLength(1)
  })
})

describe('intent engine opt-in', () => {
  it('keeps an approved opted-in intent shadow when the engine allowIntent is false', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'intent-off',
      name: 'Intent off',
      version: 1,
      trigger: {
        kind: 'intent',
        match: { intent: 'new-change' },
        mode: 'active',
        dedupe: 'turn',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: true,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(
        join(workspace, 'intent-off.json'),
        `${JSON.stringify(definition, null, 2)}\n`,
        'utf8',
      )
    })
    await installDefinition(workspace, join(workspace, 'intent-off.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 4,
        step: 2,
        messages: [
          { role: 'user', content: [{ type: 'text', text: 'Please start a new change for auth' }] },
        ],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () => {
      const rows = (await readFile(file, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      return rows.some(
        (entry) =>
          entry.kind === 'intent' &&
          Array.isArray(entry.triggers) &&
          (entry.triggers as Array<Record<string, unknown>>).some(
            (row) => row.id === 'definition:intent-off' && row.reason === 'would-fire',
          ),
      )
    })
    const { readdir } = await import('node:fs/promises')
    const runs = await readdir(join(workspace, '.dsh', 'workflows', 'runs')).catch(() => [])
    expect(runs.filter((name) => name.endsWith('.json'))).toHaveLength(0)
  })

  it('refuses a non-boolean engine allowIntent', async () => {
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    expect(() => apply(host.ctx as never, { allowIntent: 'yes' } as never)).toThrow(
      /allowIntent must be a boolean/u,
    )
  })

  it('validates checkpointApplicability and applies the defaults and an override', async () => {
    const defaults = await tempWorkspace()
    const defaultHost = fakeHost(defaults)
    expect(() => apply(defaultHost.ctx as never, {})).not.toThrow()
    for (const [config, field] of [
      [{ checkpointApplicability: { minToolCalls: 0 } }, /minToolCalls/u],
      [{ checkpointApplicability: { minToolCalls: 1001 } }, /minToolCalls/u],
      [{ checkpointApplicability: { minToolCalls: '4' } }, /minToolCalls/u],
      [{ checkpointApplicability: { requireWrite: 'yes' } }, /requireWrite/u],
      [{ checkpointApplicability: { unknown: true } }, /unknown field/u],
      [{ checkpointApplicability: 'on' }, /must be an object/u],
    ] as const) {
      const workspace = await tempWorkspace()
      const host = fakeHost(workspace)
      expect(() => apply(host.ctx as never, config as never), JSON.stringify(config)).toThrow(field)
    }

    // An explicit override changes applicability: five calls with a write are
    // below minToolCalls 10 and start no retro run.
    const override = await tempWorkspace()
    const overrideHost = fakeHost(override)
    apply(overrideHost.ctx as never, { checkpointApplicability: { minToolCalls: 10 } })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const journalFile = join(override, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    const retroRows = async (): Promise<Array<Record<string, unknown>>> =>
      (await readFile(journalFile, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .flatMap((line) => {
          try {
            const entry = JSON.parse(line) as { triggers?: Array<Record<string, unknown>> }
            return entry.triggers ?? []
          } catch {
            return []
          }
        })
        .filter((row) => row.id === 'definition:retro')
    await overrideHost.emit(
      'agent/pre-step',
      {
        agent: overrideHost.agent,
        turn: 1,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    for (let index = 0; index < 5; index += 1) {
      await overrideHost.emit(
        'tools/result',
        {
          agent: overrideHost.agent,
          callId: `call-${String(index)}`,
          name: index === 0 ? 'write' : 'read',
          arguments: index === 0 ? { file_path: 'src/app.ts' } : {},
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }
    await overrideHost.emit('agent/turn-stopping', { agent: overrideHost.agent, turn: 1 })
    await waitFor(async () => (await retroRows()).some((row) => row.reason === 'not-applicable'))
    expect((await retroRows()).some((row) => row.reason === 'run-created')).toBe(false)
  })
})

describe('retention at boot', () => {
  it('prunes an expired terminal run and keeps an interrupted run resumable', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const base = (id: string) =>
      runs.createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        steps: ['requirements'],
        id,
      })
    const done = runs.setRunStatus(
      runs.settleStep(base('run-old-donex'), 'requirements', 'done', { at: 1_000 }),
      'completed',
      1_000,
    )
    await runs.writeRun(workspace, done, auth)
    const interrupted = runs.setRunStatus(base('run-old-intx'), 'interrupted', 1_100)
    await runs.writeRun(workspace, interrupted, auth)
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
    const { readdir, utimes } = await import('node:fs/promises')
    await utimes(runs.runPath(workspace, done.id), old, old)
    await utimes(runs.runPath(workspace, interrupted.id), old, old)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    const directory = join(workspace, '.dsh', 'workflows', 'runs')
    await waitFor(async () => {
      const listed = await readdir(directory).catch((): string[] => [])
      return !listed.includes('run-old-donex.json')
    })
    expect(await readdir(directory)).toContain('run-old-intx.json')
    const kept = await runs.readAuthenticatedRun(workspace, 'run-old-intx', auth)
    expect(kept?.status).toBe('interrupted')
  })
})

describe('startup recovery guard', () => {
  it('does not interrupt a live run when another agent is created', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const live = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      steps: ['requirements'],
      id: 'run-live-x',
    })
    await runs.writeRun(workspace, live, auth)
    await host.emit('agent/created', { agent: host.agent, source: 'fresh' })
    await new Promise((resolve) => setTimeout(resolve, 50))
    const reloaded = await runs.readAuthenticatedRun(workspace, 'run-live-x', auth)
    expect(reloaded?.status).toBe('running')
  })
})

describe('recovery and resume ordering', () => {
  it('does not let startup recovery overwrite a resumed run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    for (let index = 0; index < 40; index += 1) {
      const blocked = runs.setRunStatus(
        runs.createRun({
          definition: 'change-intake',
          trigger: 'tool.pre-execute',
          session: 'session-1',
          workspace,
          steps: ['requirements', 'spec'],
          id: `run-blocked-${String(index)}`,
        }),
        'blocked',
        1_000,
      )
      await runs.writeRun(workspace, blocked, auth)
    }
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<unknown> }
      | undefined
    expect(command).toBeDefined()
    await command?.handler({
      agent: host.agent,
      arguments: 'resume run-blocked-0',
    })
    const resumed = await runs.readAuthenticatedRun(workspace, 'run-blocked-0', auth)
    expect(resumed?.status).toBe('running')
  })
})

describe('one main step per session', () => {
  it('steers only the first of two eligible runs in a turn', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    for (const id of ['run-two-a', 'run-two-b']) {
      const run = runs.createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        steps: ['requirements', 'spec'],
        id,
      })
      await runs.writeRun(workspace, run, auth)
    }
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    await waitFor(async () => host.steers.length > 0)
    expect(host.steers).toHaveLength(1)
  })
})

describe('run admission at capacity', () => {
  it('suppresses a new run when open runs reach maxRuns', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'capacity-watch',
      name: 'Capacity watch',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'read' },
        mode: 'active',
        dedupe: 'callId',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(
        join(workspace, 'capacity.json'),
        `${JSON.stringify(definition, null, 2)}\n`,
        'utf8',
      )
    })
    await installDefinition(workspace, join(workspace, 'capacity.json'), auth)
    for (let index = 0; index < 20; index += 1) {
      const run = runs.createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        steps: ['requirements'],
        id: `run-cap-${String(index)}`,
      })
      await runs.writeRun(workspace, run, auth)
    }
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit(
      'tools/pre-execute',
      { agent: host.agent, callId: 'capacity-call', name: 'read', arguments: {} },
      async () => ({ kind: 'continue' }),
    )
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () => {
      const rows = (await readFile(file, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      return rows.some(
        (entry) =>
          Array.isArray(entry.triggers) &&
          (entry.triggers as Array<Record<string, unknown>>).some(
            (row) =>
              row.id === 'definition:capacity-watch' &&
              row.reason === 'run-suppressed' &&
              String(row.detail).includes('run limit'),
          ),
      )
    })
    const { readdir } = await import('node:fs/promises')
    const files = (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
      name.endsWith('.json'),
    )
    expect(files).toHaveLength(20)
  })
})

describe('configured maxRuns', () => {
  function watchDefinition(id: string): Record<string, unknown> {
    return {
      v: 1,
      id,
      name: id,
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'read' },
        mode: 'active',
        dedupe: 'callId',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
  }

  async function installWatch(workspace: string, id: string): Promise<void> {
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const { writeFile: write } = await import('node:fs/promises')
    await write(
      join(workspace, `${id}.json`),
      `${JSON.stringify(watchDefinition(id), null, 2)}\n`,
      'utf8',
    )
    await installDefinition(workspace, join(workspace, `${id}.json`), auth)
  }

  it('refuses a second open run when maxRuns is configured to one', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    await installWatch(workspace, 'one-watch')
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const first = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      steps: ['requirements'],
      id: 'run-only-one',
    })
    await runs.writeRun(workspace, first, auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never, { maxRuns: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit(
      'tools/pre-execute',
      { agent: host.agent, callId: 'over-limit', name: 'read', arguments: {} },
      async () => ({ kind: 'continue' }),
    )
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () => {
      const rows = (await readFile(file, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      return rows.some(
        (entry) =>
          Array.isArray(entry.triggers) &&
          (entry.triggers as Array<Record<string, unknown>>).some(
            (row) =>
              row.id === 'definition:one-watch' &&
              row.reason === 'run-suppressed' &&
              String(row.detail).includes('run limit'),
          ),
      )
    })
    const { readdir } = await import('node:fs/promises')
    const files = (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
      name.endsWith('.json'),
    )
    expect(files).toHaveLength(1)
  })

  it('refuses an invalid configured maxRuns', async () => {
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    expect(() => apply(host.ctx as never, { maxRuns: 0 })).toThrow(
      /maxRuns must be a positive integer/u,
    )
  })
})

describe('multiple matching definitions at capacity', () => {
  it('admits only one run when one slot remains', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    for (const id of ['multi-a', 'multi-b']) {
      const definition = {
        v: 1,
        id,
        name: id,
        version: 1,
        trigger: { kind: 'tool.result', match: { tool: 'read' }, mode: 'active', dedupe: 'callId' },
        settings: {
          allowModelStart: false,
          risk: 'low',
          gateOwnership: 'own',
          maxBlocks: 3,
          allowIntent: false,
        },
        steps: [
          {
            id: 'observe',
            title: 'Observe',
            executor: 'main',
            prompt: 'Observe.',
            evidence: { kind: 'file', path: 'out.md' },
            next: 'end',
          },
        ],
      }
      await import('node:fs/promises').then(async ({ writeFile: write }) => {
        await write(
          join(workspace, `${id}.json`),
          `${JSON.stringify(definition, null, 2)}\n`,
          'utf8',
        )
      })
      await installDefinition(workspace, join(workspace, `${id}.json`), auth)
    }
    const host = fakeHost(workspace)
    apply(host.ctx as never, { maxRuns: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await host.emit(
      'tools/result',
      { agent: host.agent, callId: 'multi-call', name: 'read', arguments: {} },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () => {
      const rows = (await readFile(file, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      return rows.some(
        (entry) =>
          Array.isArray(entry.triggers) &&
          (entry.triggers as Array<Record<string, unknown>>).some(
            (row) => row.reason === 'run-suppressed' && String(row.detail).includes('run limit'),
          ),
      )
    })
    const { readdir } = await import('node:fs/promises')
    const files = (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
      name.endsWith('.json'),
    )
    expect(files).toHaveLength(1)
  })
})

describe('capacity does not block existing intake state', () => {
  it('admits a completed intake at full capacity', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const completed = runs.setRunStatus(
      runs.createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-old',
        workspace,
        context: { name: 'auth' },
        steps: ['requirements'],
        id: 'run-completed-auth',
      }),
      'completed',
      1_000,
    )
    await runs.writeRun(workspace, completed, auth)
    const open = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'other' },
      steps: ['requirements'],
      id: 'run-open-slot',
    })
    await runs.writeRun(workspace, open, auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never, { maxRuns: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    let nextCalled = false
    await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'completed-admit',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )
    expect(nextCalled).toBe(true)
    const { readdir } = await import('node:fs/promises')
    const files = (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((name) =>
      name.endsWith('.json'),
    )
    expect(files).toHaveLength(2)
  })
})

describe('concurrent session admission', () => {
  it('admits only one run when two sessions compete for one slot', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = {
      v: 1,
      id: 'session-watch',
      name: 'Session watch',
      version: 1,
      trigger: { kind: 'tool.result', match: { tool: 'read' }, mode: 'active', dedupe: 'callId' },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'observe',
          title: 'Observe',
          executor: 'main',
          prompt: 'Observe.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    await import('node:fs/promises').then(async ({ writeFile: write }) => {
      await write(
        join(workspace, 'session-watch.json'),
        `${JSON.stringify(definition, null, 2)}\n`,
        'utf8',
      )
    })
    await installDefinition(workspace, join(workspace, 'session-watch.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never, { maxRuns: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const secondAgent = {
      id: 'session-2',
      session: { id: 'session-2', header: { origin: 'root' as const } },
      ctx: { on: () => () => {} },
      steer: () => {},
      inject: () => {},
    }
    await Promise.all([
      host.emit(
        'tools/result',
        { agent: host.agent, callId: 'call-a', name: 'read', arguments: {} },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      ),
      host.emit(
        'tools/result',
        { agent: secondAgent, callId: 'call-b', name: 'read', arguments: {} },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      ),
    ])
    const { readdir } = await import('node:fs/promises')
    const runsDirectory = join(workspace, '.dsh', 'workflows', 'runs')
    await waitFor(async () => (await readdir(runsDirectory).catch(() => [])).length > 0)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const files = (await readdir(runsDirectory)).filter((name) => name.endsWith('.json'))
    expect(files).toHaveLength(1)
  })
})

describe('concurrent command starts', () => {
  it('creates only one run for two concurrent command starts at capacity', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never, { maxRuns: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<unknown> }
      | undefined
    expect(command).toBeDefined()
    await Promise.all([
      command?.handler({ agent: host.agent, arguments: 'run change-intake' }),
      command?.handler({ agent: host.agent, arguments: 'run change-intake' }),
    ])
    const { readdir } = await import('node:fs/promises')
    const runsDirectory = join(workspace, '.dsh', 'workflows', 'runs')
    await waitFor(async () => (await readdir(runsDirectory).catch(() => [])).length > 0)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const files = (await readdir(runsDirectory)).filter((name) => name.endsWith('.json'))
    expect(files).toHaveLength(1)
  })
})

describe('main-step ownership across turns', () => {
  it('keeps the current owner when an older run appears', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const base = (id: string, at: number) =>
      runs.createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        steps: ['requirements', 'spec'],
        id,
        now: at,
      })
    await runs.writeRun(workspace, base('run-owner-b', 2_000), auth)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(async () => host.steers.length === 1)
    await runs.writeRun(workspace, base('run-owner-a', 1_000), auth)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    await waitFor(async () => host.steers.length === 2)
    const older = await runs.readAuthenticatedRun(workspace, 'run-owner-a', auth)
    const owner = await runs.readAuthenticatedRun(workspace, 'run-owner-b', auth)
    expect(older?.steps.find((step) => step.id === 'requirements')?.requestedAt).toBeUndefined()
    expect(owner?.steps.find((step) => step.id === 'requirements')?.requestedAt).toBeDefined()
  })
})

describe('deferred step at runtime', () => {
  it('reads the legacy review record and never steers past a pending deferred step', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const { loadShippedDefinitions } = await import('../src/host/definitions.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
    expect(intake).toBeDefined()
    if (intake === undefined) return
    let run = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: intake.steps.map((step) => step.id),
      id: 'run-deferred-review',
      now: 1_000,
    })
    for (const step of ['requirements', 'architecture', 'interface', 'create-change', 'spec']) {
      run = runs.settleStep(run, step, 'done', { at: 1_100 })
    }
    await runs.writeRun(workspace, run, auth)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const blocked = await runs.readAuthenticatedRun(workspace, 'run-deferred-review', auth)
    expect(blocked?.steps.find((step) => step.id === 'spec-review')?.state).toBe('blocked')
    expect(blocked?.status).toBe('blocked')
    expect(host.steers).toHaveLength(0)

    // A current whole-spec PASS record lets the deferred step complete; only
    // then may the next owned step (approval) steer.
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      await writeFile(join(change, file), '# artifact\n', 'utf8')
    }
    await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# spec\n', 'utf8')
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const digest = await currentSpecDigest(workspace, 'auth')
    expect(digest).toBeDefined()
    const record = join(workspace, '.dsh', 'delegation', 'spec-review', 'auth')
    await mkdir(record, { recursive: true })
    await writeFile(
      join(record, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    const reviewed = await runs.readAuthenticatedRun(workspace, 'run-deferred-review', auth)
    expect(reviewed?.steps.find((step) => step.id === 'spec-review')?.state).toBe('done')
    await waitFor(async () => host.steers.length === 1)
  })
})

describe('intake runtime', () => {
  it('keeps spec open on a canonical shell exit 1 and passes on a later zero exit', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const { loadShippedDefinitions } = await import('../src/host/definitions.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
    expect(intake).toBeDefined()
    if (intake === undefined) return
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      await writeFile(join(change, file), '# artifact\n', 'utf8')
    }
    await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# spec\n', 'utf8')
    let run = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: intake.steps.map((step) => step.id),
      id: 'run-spec-check',
      now: 1_000,
    })
    for (const step of ['requirements', 'architecture', 'interface', 'create-change']) {
      run = runs.settleStep(run, step, 'done', { at: 1_100 })
    }
    run = runs.requestStep(run, 'spec', 1_200)
    await runs.writeRun(workspace, run, auth)
    const outside = await tempWorkspace()
    const canonical = (
      callId: string,
      overrides: Record<string, unknown>,
      isError = false,
    ): Promise<unknown> =>
      host.emit(
        'tools/result',
        {
          agent: host.agent,
          name: 'pwsh',
          callId,
          arguments: { command: 'openspec validate auth --strict' },
        },
        {
          isError,
          content: [],
          value: {
            kind: 'foreground',
            cwd: workspace,
            exitCode: 0,
            signal: null,
            timedOut: false,
            aborted: false,
            timeoutMs: 120_000,
            stdout: { text: '', truncated: false },
            stderr: { text: '', truncated: false },
            ...overrides,
          },
        },
      )
    const specState = async (): Promise<string | undefined> =>
      (await runs.readAuthenticatedRun(workspace, 'run-spec-check', auth))?.steps.find(
        (step) => step.id === 'spec',
      )?.state
    await canonical('check-fail', { exitCode: 1 })
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(await specState()).toBe('open')
    await canonical('check-external', { cwd: outside })
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    expect(await specState()).toBe('open')
    await canonical('check-background', { kind: 'background' })
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 3 })
    expect(await specState()).toBe('open')
    await canonical('check-aborted', { aborted: true })
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 4 })
    expect(await specState()).toBe('open')
    await canonical('check-runner-failed', { sandbox: { denied: false, runnerFailed: true } })
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 5 })
    expect(await specState()).toBe('open')
    await canonical('check-error', {}, true)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 6 })
    expect(await specState()).toBe('open')
    await canonical('check-pass', {})
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 7 })
    expect(await specState()).toBe('done')
  })

  it('dispatches create-change through the tool service and completes approval with a receipt', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace, { toolExecute: true, userQuestions: true })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const receipts = await import('../src/host/receipts.ts')
    const { loadShippedDefinitions } = await import('../src/host/definitions.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
    expect(intake).toBeDefined()
    if (intake === undefined) return
    let run = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: intake.steps.map((step) => step.id),
      id: 'run-intake-runtime',
      now: 1_000,
    })
    for (const step of ['requirements', 'architecture', 'interface', 'spec']) {
      run = runs.settleStep(run, step, 'done', { at: 1_100 })
    }
    run = runs.settleStep(run, 'spec-review', 'done', {
      at: 1_100,
      evidence: {
        kind: 'record',
        path: '.dsh/delegation/spec-review/auth/spec.json',
        digest: 'a'.repeat(64),
      },
    })
    run = runs.requestStep(run, 'create-change', 1_200)
    await runs.writeRun(workspace, run, auth)

    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })

    const completed = await runs.readAuthenticatedRun(workspace, 'run-intake-runtime', auth)
    expect(completed?.status).toBe('completed')
    expect(completed?.steps.every((step) => step.state === 'done')).toBe(true)
    const hostShell = process.platform === 'win32' ? 'pwsh' : 'bash'
    expect(host.toolExecutions).toHaveLength(1)
    expect(host.toolExecutions[0]).toMatchObject({
      name: hostShell,
      arguments: { command: 'openspec new change auth' },
    })
    expect(await receipts.readReceipt(workspace, 'auth', auth)).toMatchObject({
      kind: 'intake',
      change: 'auth',
    })
    const all = await runs.listAuthenticatedRuns(workspace, auth)
    expect(all.filter((entry) => entry.definition === 'change-intake')).toHaveLength(1)
  })
})

describe('archive workdir evidence root', () => {
  it('denies an archive whose shell workdir is outside the session workspace', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    let nextCalled = false
    const decision = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'archive-outside',
        name: 'pwsh',
        arguments: { command: 'openspec archive auth', workdir: outside },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string; reason?: string } | undefined
    expect(decision?.kind).toBe('deny')
    expect(decision?.reason).toMatch(/outside the session workspace/u)
    expect(nextCalled).toBe(false)
  })
})

it('denies a dot-relative archive move without evidence', async () => {
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  const workspace = await tempWorkspace()
  const host = fakeHost(workspace)
  apply(host.ctx as never)
  await new Promise((resolve) => setTimeout(resolve, 100))
  let nextCalled = false
  const decision = (await host.emit(
    'tools/pre-execute',
    {
      agent: host.agent,
      callId: 'move-dot',
      name: 'pwsh',
      arguments: { command: 'mv ./openspec/changes/auth ./openspec/changes/archive/' },
    },
    async () => {
      nextCalled = true
      return { kind: 'continue' }
    },
  )) as { kind?: string; reason?: string } | undefined
  expect(decision?.kind).toBe('deny')
  expect(nextCalled).toBe(false)
})

it('carries a filesystem change name into the definition event', () => {
  const events = definitionEventsOf(
    {
      at: 1,
      session: 'session-1',
      kind: 'fs.change',
      subject: 'openspec/changes/auth/tasks.md',
      summary: 'changed',
      bytes: 7,
      truncated: false,
    } as never,
    {
      kind: 'fs.change',
      subject: 'openspec/changes/auth/tasks.md',
      change: 'modified',
    } as never,
    '/workspace',
  )
  expect(events[0]).toMatchObject({
    kind: 'fs.change',
    name: 'auth',
    path: 'openspec/changes/auth/tasks.md',
  })
})

it('denies a move from the changes subdirectory without evidence', async () => {
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  const workspace = await tempWorkspace()
  const host = fakeHost(workspace)
  apply(host.ctx as never)
  await new Promise((resolve) => setTimeout(resolve, 100))
  let nextCalled = false
  const decision = (await host.emit(
    'tools/pre-execute',
    {
      agent: host.agent,
      callId: 'move-subdir',
      name: 'pwsh',
      arguments: { command: 'mv auth archive/', workdir: 'openspec/changes' },
    },
    async () => {
      nextCalled = true
      return { kind: 'continue' }
    },
  )) as { kind?: string } | undefined
  expect(decision?.kind).toBe('deny')
  expect(nextCalled).toBe(false)
})

it('denies parent-relative moves without evidence', async () => {
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  const workspace = await tempWorkspace()
  const host = fakeHost(workspace)
  apply(host.ctx as never)
  await new Promise((resolve) => setTimeout(resolve, 100))
  let nextCalled = false
  const decision = (await host.emit(
    'tools/pre-execute',
    {
      agent: host.agent,
      callId: 'move-parent',
      name: 'pwsh',
      arguments: {
        command: 'mv ../openspec/changes/auth ../openspec/changes/archive/',
        workdir: 'docs',
      },
    },
    async () => {
      nextCalled = true
      return { kind: 'continue' }
    },
  )) as { kind?: string } | undefined
  expect(decision?.kind).toBe('deny')
  expect(nextCalled).toBe(false)
})

it.skipIf(process.platform !== 'win32')(
  'denies a Windows-cased archive move without evidence',
  async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    let nextCalled = false
    const decision = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'move-cased',
        name: 'pwsh',
        arguments: { command: 'mv openspec/changes/auth openspec/changes/ARCHIVE/' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string } | undefined
    expect(decision?.kind).toBe('deny')
    expect(nextCalled).toBe(false)
  },
)
describe('intake end-to-end in a fake host', () => {
  it('runs a refused creation through drafts, dispatch, validation, review, approval, and receipt', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace, { toolExecute: true, userQuestions: true })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const receipts = await import('../src/host/receipts.ts')
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const pre = (callId: string): Promise<unknown> =>
      host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId,
          name: 'pwsh',
          arguments: { command: 'openspec new change auth' },
        },
        async () => ({ kind: 'continue' }),
      )
    const turnStop = (turn: number): Promise<unknown> =>
      host.emit('agent/turn-stopping', { agent: host.agent, turn })
    const intakeRuns = async (): Promise<Array<{ id: string; status: string }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth)).filter(
        (run) => run.definition === 'change-intake',
      )
    const draft = async (file: string, text: string): Promise<void> => {
      const directory = join(workspace, '.dsh', 'workflows', 'drafts', 'auth')
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, file), text, 'utf8')
    }
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')

    // 1. The creation command is refused and the intake run starts.
    const refused = (await pre('create-1')) as { kind?: string; reason?: string }
    expect(refused?.kind).toBe('deny')
    expect(await intakeRuns()).toHaveLength(1)

    // 2. The drafts advance the three main steps.
    await draft('requirements.md', 'x'.repeat(220))
    await turnStop(1)
    await draft('architecture.md', '# architecture\n')
    await turnStop(2)
    await draft('interface.md', '# interface\n')
    await turnStop(3)
    const created = (await intakeRuns())[0]
    expect(created).toBeDefined()
    const afterCreate = await runs.readAuthenticatedRun(workspace, created?.id ?? '', auth)
    expect(afterCreate?.steps.find((step) => step.id === 'create-change')?.state).toBe('done')
    expect(host.toolExecutions.map((call) => call.arguments.command)).toContain(
      'openspec new change auth',
    )
    expect(await readdir(changeDir)).toContain('.openspec.yaml')

    // 3. A fresh host recovers the persisted run; a restart resumes at spec
    //    without recreating the directory, adopting, or dispatching again.
    const metadata = await readFile(join(changeDir, '.openspec.yaml'), 'utf8')
    const fresh = fakeHost(workspace, { toolExecute: true, userQuestions: true })
    apply(fresh.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const resumed = (await fresh.emit(
      'tools/pre-execute',
      {
        agent: fresh.agent,
        callId: 'create-restart',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => ({ kind: 'continue' }),
    )) as { kind?: string; reason?: string }
    expect(resumed?.kind).toBe('deny')
    expect(resumed?.reason).toContain('spec')
    expect(fresh.toolExecutions).toHaveLength(0)
    expect(await readFile(join(changeDir, '.openspec.yaml'), 'utf8')).toBe(metadata)
    expect(await intakeRuns()).toHaveLength(1)

    // 4. Artifacts and a canonical strict-validation result complete spec.
    for (const [file, text] of [
      ['proposal.md', '# proposal\n'],
      ['design.md', '# design\n'],
      ['tasks.md', '- [ ] 1.1 Task\n'],
      ['specs/auth/spec.md', '# spec\n'],
    ] as const) {
      await mkdir(dirname(join(changeDir, file)), { recursive: true })
      await writeFile(join(changeDir, file), text, 'utf8')
    }
    await fresh.emit(
      'tools/result',
      {
        agent: fresh.agent,
        name: 'pwsh',
        callId: 'validate-e2e',
        arguments: { command: 'openspec validate auth --strict' },
      },
      {
        isError: false,
        content: [],
        value: {
          kind: 'foreground',
          cwd: workspace,
          exitCode: 0,
          signal: null,
          timedOut: false,
          aborted: false,
          timeoutMs: 120_000,
          stdout: { text: '', truncated: false },
          stderr: { text: '', truncated: false },
        },
      },
    )
    await fresh.emit('agent/turn-stopping', { agent: fresh.agent, turn: 4 })

    // 5. The current whole-spec PASS record completes the deferred review.
    const digest = await currentSpecDigest(workspace, 'auth')
    expect(digest).toBeDefined()
    const recordDir = join(workspace, '.dsh', 'delegation', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    await fresh.emit('agent/turn-stopping', { agent: fresh.agent, turn: 5 })
    const completed = await runs.readAuthenticatedRun(workspace, created?.id ?? '', auth)
    expect(completed?.status).toBe('completed')
    expect(await receipts.readReceipt(workspace, 'auth', auth)).toMatchObject({
      kind: 'intake',
      change: 'auth',
    })

    // 6. A repeated creation is allowed and starts no second run.
    const repeated = (await fresh.emit(
      'tools/pre-execute',
      {
        agent: fresh.agent,
        callId: 'create-2',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => ({ kind: 'continue' }),
    )) as { kind?: string }
    expect(repeated?.kind).toBe('continue')
    expect(await intakeRuns()).toHaveLength(1)
  })

  it('leaves a no answer open without a receipt', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace, { userQuestions: true, answer: 'no' })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const receipts = await import('../src/host/receipts.ts')
    const { loadShippedDefinitions } = await import('../src/host/definitions.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
    expect(intake).toBeDefined()
    if (intake === undefined) return
    let run = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: intake.steps.map((step) => step.id),
      id: 'run-intake-no',
      now: 1_000,
    })
    for (const step of ['requirements', 'architecture', 'interface', 'create-change', 'spec']) {
      run = runs.settleStep(run, step, 'done', { at: 1_100 })
    }
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    for (const [file, text] of [
      ['proposal.md', '# proposal\n'],
      ['design.md', '# design\n'],
      ['tasks.md', '- [ ] 1.1 Task\n'],
      ['specs/auth/spec.md', '# spec\n'],
    ] as const) {
      await mkdir(dirname(join(changeDir, file)), { recursive: true })
      await writeFile(join(changeDir, file), text, 'utf8')
    }
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const digest = await currentSpecDigest(workspace, 'auth')
    expect(digest).toBeDefined()
    const recordDir = join(workspace, '.dsh', 'delegation', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    await runs.writeRun(workspace, run, auth)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const stored = await runs.readAuthenticatedRun(workspace, 'run-intake-no', auth)
    expect(stored?.status).not.toBe('completed')
    const approval = stored?.steps.find((step) => step.id === 'approval')
    expect(approval?.state).not.toBe('done')
    expect(approval?.reason).toContain('no')
    expect(await receipts.readReceipt(workspace, 'auth', auth)).toBeUndefined()
  })
})

describe('/workflows adopt from the real command invocation', () => {
  it('adopts an existing change from CommandInvocation.rawInput', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace, { userQuestions: true })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const receipts = await import('../src/host/receipts.ts')
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    for (const [file, text] of [
      ['proposal.md', '# proposal\n'],
      ['design.md', '# design\n'],
      ['tasks.md', '- [ ] 1.1 Task\n'],
      ['specs/auth/spec.md', '# spec\n'],
    ] as const) {
      await mkdir(dirname(join(changeDir, file)), { recursive: true })
      await writeFile(join(changeDir, file), text, 'utf8')
    }
    const digest = await currentSpecDigest(workspace, 'auth')
    const recordDir = join(workspace, '.dsh', 'delegation', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    const result = await command?.handler({
      agent: host.agent,
      commandId: 'cmd-1',
      rawInput: ' adopt auth',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(result?.kind).toBe('success')
    expect(result?.text).toContain('adopted')
    expect(await receipts.readReceipt(workspace, 'auth', auth)).toMatchObject({
      kind: 'adoption',
      change: 'auth',
    })
    expect(await readdir(changeDir)).toContain('proposal.md')
  })
})

describe('archive gate on an unreadable run store', () => {
  it('refuses the archive when the run listing or stat fails and issues no authorization', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    // A pre-existing change with a current whole-spec PASS, an adoption
    // receipt, and an open run: an empty run store would otherwise allow it.
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      await writeFile(join(change, file), '# artifact\n', 'utf8')
    }
    await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# spec\n', 'utf8')
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const digest = await currentSpecDigest(workspace, 'auth')
    expect(digest).toBeDefined()
    const record = join(workspace, '.dsh', 'delegation', 'spec-review', 'auth')
    await mkdir(record, { recursive: true })
    await writeFile(
      join(record, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    const runs = await import('../src/host/runs.ts')
    const receipts = await import('../src/host/receipts.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await receipts.issueAdoptionReceipt(workspace, 'auth', digest as string, auth, 3_000)
    await runs.writeRun(
      workspace,
      runs.createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: ['requirements', 'approval'],
        id: 'run-store-fault',
        now: 2_000,
      }),
      auth,
    )
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))

    const archive = async (
      callId: string,
    ): Promise<{ kind?: string; reason?: string } | undefined> => {
      return (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId,
          name: 'pwsh',
          arguments: { command: 'openspec archive auth' },
        },
        async () => ({ kind: 'continue' }),
      )) as { kind?: string; reason?: string } | undefined
    }

    // The open run is the only blocker, so the normal archive is refused on it.
    const baseline = await archive('archive-baseline')
    expect(baseline?.kind).toBe('deny')
    expect(baseline?.reason).toContain('run-store-fault')
    const runBytes = await readFile(runs.runPath(workspace, 'run-store-fault'), 'utf8')

    runStoreFaults.readdir = 'EACCES'
    await expect(runs.storedRuns(workspace)).rejects.toThrow(/simulated run-store failure/u)
    const listing = await archive('archive-listing-fault')
    expect(listing?.kind).toBe('deny')
    expect(listing?.reason).toMatch(/pre-execute gate failed internally/u)
    runStoreFaults.readdir = undefined

    runStoreFaults.stat = 'EPERM'
    await expect(runs.storedRuns(workspace)).rejects.toThrow(/simulated run-store failure/u)
    const stat = await archive('archive-stat-fault')
    expect(stat?.kind).toBe('deny')
    expect(stat?.reason).toMatch(/pre-execute gate failed internally/u)
    runStoreFaults.stat = undefined

    // Neither refusal issued an authorization or changed the run store.
    expect(await receipts.listReceipts(workspace, auth)).toHaveLength(1)
    expect(await readFile(runs.runPath(workspace, 'run-store-fault'), 'utf8')).toBe(runBytes)
    const recovered = await runs.readAuthenticatedRun(workspace, 'run-store-fault', auth)
    expect(recovered?.status).not.toBe('completed')
  })
})

describe('archive target root', () => {
  it('denies a nested OpenSpec project and an explicit store', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, 'project', 'openspec', 'changes', 'auth'), { recursive: true })
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    let nextCalled = false
    const nested = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'archive-nested',
        name: 'pwsh',
        arguments: { command: 'openspec archive auth', workdir: 'project' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string; reason?: string } | undefined
    expect(nested?.kind).toBe('deny')
    expect(nested?.reason).toMatch(/nested OpenSpec project/u)
    expect(nextCalled).toBe(false)
    nextCalled = false
    const store = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'archive-store',
        name: 'pwsh',
        arguments: { command: 'openspec archive auth --store=team' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string; reason?: string } | undefined
    expect(store?.kind).toBe('deny')
    expect(store?.reason).toMatch(/store/u)
    expect(nextCalled).toBe(false)
  })
})
describe('unrelated moves', () => {
  it('does not deny a move whose filename merely contains archive', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    let nextCalled = false
    await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'move-notes',
        name: 'pwsh',
        arguments: { command: 'git mv docs/archive-notes.md docs/release-notes.md' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )
    expect(nextCalled).toBe(true)
  })
})
it.skipIf(process.platform !== 'win32')(
  'denies an uppercase archive name without evidence',
  async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    let nextCalled = false
    const decision = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'archive-uppercase',
        name: 'pwsh',
        arguments: { command: 'openspec archive AUTH --yes --no-validate --skip-specs' },
      },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string } | undefined
    expect(decision?.kind).toBe('deny')
    expect(nextCalled).toBe(false)
  },
)

it('denies casing and tab variants of the archive command without evidence', async () => {
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  const workspace = await tempWorkspace()
  const host = fakeHost(workspace)
  apply(host.ctx as never)
  await new Promise((resolve) => setTimeout(resolve, 100))
  for (const command of ['OpenSpec archive auth --yes', 'openspec\tarchive auth --yes']) {
    let nextCalled = false
    const decision = (await host.emit(
      'tools/pre-execute',
      { agent: host.agent, callId: 'archive-variant', name: 'pwsh', arguments: { command } },
      async () => {
        nextCalled = true
        return { kind: 'continue' }
      },
    )) as { kind?: string } | undefined
    expect(decision?.kind, command).toBe('deny')
    expect(nextCalled, command).toBe(false)
  }
})
