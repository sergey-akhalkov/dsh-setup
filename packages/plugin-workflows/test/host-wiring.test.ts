import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const parityMock = vi.hoisted(() => ({
  active: false,
  report: undefined as unknown,
  error: undefined as string | undefined,
  path: undefined as string | undefined,
}))
vi.mock('../src/host/parity.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/host/parity.ts')>()
  return {
    ...actual,
    readParityReport: (file?: string) =>
      parityMock.active
        ? parityMock.report === undefined
          ? { error: parityMock.error ?? 'missing' }
          : { report: parityMock.report }
        : actual.readParityReport(file),
    shippedParityReportPath: () => parityMock.path ?? actual.shippedParityReportPath(),
  }
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, definitionEventsOf, inject } from '../src/host/index.ts'
import { definitionsRegistry } from '../src/host/registry.ts'

// The real profile installs the OpenSpec plugin beside the engine; these host
// tests register its read-only contribution the same way the plugin does.
const OPENSPEC_WORKFLOW_ASSETS = join(
  fileURLToPath(new URL('..', import.meta.url)),
  '..',
  'plugin-openspec',
  'assets',
  'workflows',
)
definitionsRegistry.register({
  source: '@dsh-setup/plugin-openspec',
  definitions: [
    JSON.parse(readFileSync(join(OPENSPEC_WORKFLOW_ASSETS, 'change-intake.json'), 'utf8')),
  ],
  triggers: (
    JSON.parse(readFileSync(join(OPENSPEC_WORKFLOW_ASSETS, 'triggers.json'), 'utf8')) as {
      triggers: unknown[]
    }
  ).triggers,
})

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
  pauseNextWrite: undefined as Promise<void> | undefined,
  pauseFor: undefined as ((path: string) => boolean) | undefined,
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
    writeFile: (async (...args: Parameters<typeof actual.writeFile>) => {
      const target = String(args[0]).replaceAll('\\', '/')
      const inRunStore = target.includes('/workflows/runs/') && target.endsWith('.tmp')
      if (
        inRunStore &&
        runStoreFaults.pauseNextWrite !== undefined &&
        (runStoreFaults.pauseFor === undefined || runStoreFaults.pauseFor(target))
      ) {
        const wait = runStoreFaults.pauseNextWrite
        runStoreFaults.pauseNextWrite = undefined
        await wait
      }
      if (runStoreFaults.writeFile !== undefined && inRunStore) {
        return reject(runStoreFaults.writeFile)
      }
      return actual.writeFile(...args)
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
  runStoreFaults.pauseNextWrite = undefined
  runStoreFaults.pauseFor = undefined
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
    readonly workspaces?: Readonly<Record<string, string>>
    readonly automation?: boolean
    readonly delegateBarrier?: Promise<void>
  } = {},
): {
  readonly ctx: Record<string, unknown>
  readonly agent: Record<string, unknown>
  readonly commands: Array<Record<string, unknown>>
  readonly toolDefinitions: Array<Record<string, unknown>>
  readonly promptContributions: Array<{
    name: string
    text: (context?: { scope?: unknown }) => string
    interpolate?: boolean
  }>
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
  const provided = new Map<string, unknown>()
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
  const toolDefinitions: Array<Record<string, unknown>> = []
  const promptContributions: Array<{
    name: string
    text: (context?: { scope?: unknown }) => string
    interpolate?: boolean
  }> = []
  const tools: Record<string, unknown> = {
    get: (name: string) =>
      ['delegate', 'task_progress', 'delegation_status', 'work_checkpoint'].includes(name)
        ? { name }
        : undefined,
    register: (definition: unknown) => {
      toolDefinitions.push(definition as Record<string, unknown>)
      return () => {}
    },
  }
  if (options.toolExecute === true) {
    tools.execute = async (input: {
      calls: ReadonlyArray<{ type: 'tool-call'; id: string; name: string; arguments: string }>
    }) => {
      const results: Array<{ callId: string; result: Record<string, unknown> }> = []
      for (const call of input.calls) {
        // The host executor takes model-shaped tool-call blocks, so a decoded
        // object or a missing `type` is a contract violation, not a call.
        if (call.type !== 'tool-call' || typeof call.arguments !== 'string') {
          throw new Error('the tool batch is not a model-shaped tool-call block')
        }
        const args = JSON.parse(call.arguments) as Record<string, unknown>
        toolExecutions.push({ id: call.id, name: call.name, arguments: args })
        // Route the host's own dispatch through the real pre-execute gate so an
        // unowned call would be refused exactly as in the live pipeline.
        let decision: { kind?: string; reason?: string } | undefined
        for (const listener of listeners.get('tools/pre-execute') ?? []) {
          decision = (await listener(
            {
              agent,
              callId: call.id,
              name: call.name,
              arguments: args,
            },
            async () => ({ kind: 'continue' }),
          )) as { kind?: string; reason?: string } | undefined
        }
        const denied = decision?.kind === 'deny'
        if (!denied && call.name === 'delegate' && options.delegateBarrier !== undefined) {
          await options.delegateBarrier
        }
        const command = typeof args.command === 'string' ? args.command : ''
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
            : call.name === 'delegate'
              ? { isError: false, value: { text: 'rule "task-review" review started' } }
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
    systemPrompt: {
      context: (contribution: { name: string; text: () => string }) => {
        promptContributions.push(contribution)
        return () => {}
      },
    },
    get(name: string): unknown {
      if (name === 'agents') return { get: () => agent, list: () => [agent] }
      if (name === 'workingDirectory') {
        return {
          get: (session?: { id?: string } | string) => {
            const id = typeof session === 'string' ? session : session?.id
            return id !== undefined && options.workspaces?.[id] !== undefined
              ? options.workspaces[id]
              : workspace
          },
        }
      }
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
      // The migrated profile: the workflow-owned legacy gates are off while the
      // spec-review, progress, and lane signals stay enabled.
      if (name === 'delegationRulesStatus') return { workflowOwned: false, specReview: true }
      if (name === 'goalContinuityStatus') return { automation: options.automation ?? false }
      if (name === 'verificationGateStatus') return { steering: false }
      if (name === 'userQuestions' && options.userQuestions === true) {
        return {
          ask: async (request: { questions: Array<{ id: string }>; agent?: unknown }) => {
            // The live service scopes the answerer by the live agent; without it
            // no answerer accepts the question.
            if (request.agent === undefined) {
              throw new Error('no user-questions answerer accepted the request')
            }
            return {
              answers: request.questions.map((question) => ({
                id: question.id,
                selected: [options.answer ?? 'yes'],
              })),
            }
          },
        }
      }
      if (name === 'systemPrompt') {
        return {
          context: (contribution: {
            name: string
            text: (context?: { scope?: unknown }) => string
            interpolate?: boolean
          }) => {
            promptContributions.push(contribution)
            return () => {}
          },
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
    commands,
    toolDefinitions,
    promptContributions,
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

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 10000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the host did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('engine host wiring', () => {
  it('declares the system-prompt service it reads', () => {
    expect(inject).toEqual(
      expect.arrayContaining(['agents', 'workingDirectory', 'fs', 'connection', 'systemPrompt']),
    )
  })

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

  it('advertises free-form arguments so the composer keeps the command open', async () => {
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { description?: string; input?: { hint?: string } }
      | undefined
    expect(command).toBeDefined()
    expect(command?.description).toContain('adopt')
    const hint = command?.input?.hint
    expect(typeof hint).toBe('string')
    expect(hint).toContain('adopt <name>')
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
    const { sessionRuns: shortTurnViews } = await import('../src/host/projection.ts')
    expect(
      (await shortTurnViews(workspace, 'session-1')).filter((view) => view.source === 'workflow'),
    ).toHaveLength(0)

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
      (entry) => entry.definition.id === 'retro',
    )
    expect(blockedRetro?.steps[0]?.state).toBe('open')
    const { sessionRuns } = await import('../src/host/projection.ts')
    const view = (await sessionRuns(workspace, 'session-1')).find(
      (entry) => entry.id === `workflow:${blockedRetro?.id ?? ''}`,
    )
    expect(view).toBeDefined()
    expect(view?.steps[0]?.state).toBe('open')
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
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'checkpoint-call',
        name: 'work_checkpoint',
        arguments: {},
      },
      { isError: false, content: [{ type: 'text', text: 'checkpoint recorded' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let retroRun: { id: string } | undefined
    await waitFor(async () => {
      retroRun = (await runs.listAuthenticatedRuns(workspace, auth)).find(
        (entry) => entry.definition.id === 'retro',
      )
      return retroRun !== undefined
    })
    await waitFor(async () => {
      const stored = await runs.readAuthenticatedRun(workspace, retroRun?.id ?? '', auth)
      return stored?.steps[0]?.state === 'done'
    })
    expect(host.steers).toHaveLength(0)
  })
  it('keeps the run open while the checkpoint remedy is unexecuted', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
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
    for (const [index, name] of ['read', 'read', 'read', 'read', 'write'].entries()) {
      await host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId: `call-${String(index)}`,
          name,
          arguments: name === 'write' ? { file_path: 'src/app.ts' } : {},
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'checkpoint-call',
        name: 'work_checkpoint',
        arguments: {},
      },
      { isError: false, content: [{ type: 'text', text: 'checkpoint recorded' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let retroRun: { id: string; context: Record<string, unknown> } | undefined
    await waitFor(async () => {
      retroRun = (await runs.listAuthenticatedRuns(workspace, auth)).find(
        (entry) => entry.definition.id === 'retro',
      ) as typeof retroRun
      return retroRun !== undefined
    })
    const checkpoint = String(retroRun?.context.checkpoint ?? '')
    await mkdir(dirname(join(workspace, checkpoint)), { recursive: true })
    await writeFile(
      join(workspace, checkpoint),
      JSON.stringify({
        checkpoint: 'checkpoint-1-aaaaaaaa',
        outcome: 'continue',
        turn: 1,
        lanes: [],
        next: 'fix the guard',
        bottleneck: {
          id: 'guard',
          owner: 'lead',
          action: 'lead_action',
          blockingLanes: ['edit'],
          targets: ['src/unexecuted.ts'],
        },
      }),
      'utf8',
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const settled = await runs.readAuthenticatedRun(workspace, retroRun?.id ?? '', auth)
    expect(settled?.status).toBe('running')
    expect(settled?.steps[0]?.state).toBe('open')
    expect(host.steers.length).toBeGreaterThan(0)
  })
  it('reopens the checkpoint obligation when a completed turn checkpoint goes stale', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const emitStep = async (step: number): Promise<void> => {
      await host.emit(
        'agent/pre-step',
        {
          agent: host.agent,
          turn: 1,
          step,
          messages: [],
          signal: new AbortController().signal,
          modelSelection: { provider: 'p', model: 'm' },
        },
        async () => ({ kind: 'continue' }),
      )
    }
    await emitStep(1)
    for (const [index, name] of ['read', 'read', 'read', 'read', 'write'].entries()) {
      await host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId: `call-${String(index)}`,
          name,
          arguments: name === 'write' ? { file_path: 'src/app.ts' } : {},
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }
    await host.emit(
      'tools/result',
      { agent: host.agent, callId: 'checkpoint-call', name: 'work_checkpoint', arguments: {} },
      { isError: false, content: [{ type: 'text', text: 'checkpoint recorded' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let retroRun: { id: string; context: Record<string, unknown> } | undefined
    await waitFor(async () => {
      retroRun = (await runs.listAuthenticatedRuns(workspace, auth)).find(
        (entry) => entry.definition.id === 'retro',
      ) as typeof retroRun
      return retroRun !== undefined
    })
    await mkdir(dirname(join(workspace, String(retroRun?.context.checkpoint))), { recursive: true })
    await writeFile(
      join(workspace, String(retroRun?.context.checkpoint)),
      JSON.stringify({
        checkpoint: 'checkpoint-1-aaaaaaaa',
        outcome: 'done',
        turn: 1,
        lanes: [],
        next: 'continue',
      }),
      'utf8',
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(async () => {
      const stored = await runs.readAuthenticatedRun(workspace, retroRun?.id ?? '', auth)
      return stored?.status === 'completed'
    })
    const before = host.steers.length
    for (let step = 2; step <= 42; step += 1) await emitStep(step)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.steers.length).toBeGreaterThan(before)
    // The per-session budget persists: three refusals then one UNCHECKED notice.
    for (let close = 0; close < 4; close += 1) {
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    }
    const staleSteers = host.steers
      .slice(before)
      .map((message) =>
        ((message as { content?: Array<{ text?: string }> }).content ?? [])
          .map((block) => block.text ?? '')
          .join(''),
      )
    expect(staleSteers.filter((text) => text.includes('UNCHECKED')).length).toBe(1)
    expect(staleSteers.length).toBeLessThanOrEqual(4)
  })
})

describe('verify auto-start', () => {
  it('starts the owned verify run on a code-writing turn and steers', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never, { verify: { commands: ['pnpm check'] } })
    await new Promise((resolve) => setTimeout(resolve, 100))
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
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'src/app.ts' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let verifyRun: { id: string } | undefined
    await waitFor(async () => {
      verifyRun = (await runs.listAuthenticatedRuns(workspace, auth)).find(
        (entry) => entry.definition.id === 'verify',
      )
      return verifyRun !== undefined
    })
    expect(verifyRun?.id).toBeDefined()
    expect(host.steers).toHaveLength(1)
  })

  it('reopens verification when a later write follows a successful check', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never, { verify: { commands: ['pnpm check'] } })
    await new Promise((resolve) => setTimeout(resolve, 100))
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
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'src/app.ts' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    // The real host observation path: a DSH tool result with content and the
    // canonical foreground value the shell tool returns.
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'check-1',
        name: 'pwsh',
        arguments: { command: 'pnpm check' },
      },
      {
        isError: false,
        content: [{ type: 'text', text: 'ok' }],
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
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await waitFor(async () => {
      const verify = (await runs.listAuthenticatedRuns(workspace, auth)).find(
        (entry) => entry.definition.id === 'verify',
      )
      return verify?.status === 'completed'
    })
    const before = host.steers.length
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'write-2',
        name: 'write',
        arguments: { file_path: '.tmp/../src/app.ts' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.steers.length).toBeGreaterThan(before)
    const reopened = (await runs.listAuthenticatedRuns(workspace, auth)).find(
      (entry) => entry.definition.id === 'verify',
    )
    expect(reopened?.status).not.toBe('completed')
  })
})

describe('checkpoint rollback', () => {
  it('does not steer the workflow checkpoint after automation is re-enabled', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const checkpoint = '.dsh/work-checkpoints/84097828fc31a8c8/1.json'
    await mkdir(dirname(join(workspace, checkpoint)), { recursive: true })
    await writeFile(
      join(workspace, checkpoint),
      JSON.stringify({
        checkpoint: 'checkpoint-1-aaaaaaaa',
        outcome: 'done',
        turn: 1,
        lanes: [],
        next: 'continue',
      }),
      'utf8',
    )
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await runs.writeRun(
      workspace,
      runs.createRun({
        definition: 'retro',
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { checkpoint },
        steps: ['checkpoint', 'verify'],
        dedupeKey: 'retro\u0000turn\u0000session-1\u00001',
        now: 1_000,
      }),
      auth,
    )
    const host = fakeHost(workspace, { automation: true })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
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
    expect(host.steers).toHaveLength(0)
  })
})

describe('verify command contract', () => {
  it('does not accept an unconfigured rtk-prefixed invocation', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never, { verify: { commands: ['rtk pnpm check'] } })
    await new Promise((resolve) => setTimeout(resolve, 100))
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
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'src/app.ts' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    const shell = (callId: string, command: string) =>
      host.emit(
        'tools/result',
        { agent: host.agent, callId, name: 'pwsh', arguments: { command } },
        {
          isError: false,
          content: [{ type: 'text', text: 'ok' }],
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
    await shell('check-1', 'pnpm check')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.steers.length).toBeGreaterThan(0)
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const verify = (await runs.listAuthenticatedRuns(workspace, auth)).find(
      (entry) => entry.definition.id === 'verify',
    )
    expect(verify?.status).not.toBe('completed')
    await shell('check-2', 'rtk pnpm check')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const settled = (await runs.listAuthenticatedRuns(workspace, auth)).find(
      (entry) => entry.definition.id === 'verify',
    )
    expect(settled?.status).toBe('completed')
  })
})

describe('parity report refusal at runtime', () => {
  const runReport = async (variant?: {
    report?: unknown
    error?: string
    path?: string
    external?: string
  }): Promise<string[]> => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    parityMock.active = variant !== undefined
    parityMock.report = variant?.report
    parityMock.error = variant?.error
    parityMock.path = variant?.path
    if (variant?.external !== undefined) {
      process.env.DSH_WORKFLOWS_PARITY_REPORT = variant.external
    }
    try {
      const workspace = await tempWorkspace()
      const host = fakeHost(workspace)
      apply(host.ctx as never)
      await new Promise((resolve) => setTimeout(resolve, 100))
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
      for (const [index, name] of ['read', 'read', 'read', 'write'].entries()) {
        await host.emit(
          'tools/result',
          {
            agent: host.agent,
            callId: 'call-' + String(index),
            name,
            arguments: name === 'write' ? { file_path: 'src/app.ts' } : {},
          },
          { isError: false, content: [{ type: 'text', text: 'ok' }] },
        )
      }
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await new Promise((resolve) => setTimeout(resolve, 200))
      const runs = await import('../src/host/runs.ts')
      const { HostAuth } = await import('../src/host/host-auth.ts')
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      return (await runs.listAuthenticatedRuns(workspace, auth)).map((entry) => entry.definition.id)
    } finally {
      parityMock.active = false
      parityMock.report = undefined
      parityMock.error = undefined
      parityMock.path = undefined
      delete process.env.DSH_WORKFLOWS_PARITY_REPORT
    }
  }

  it('refuses the bound definitions for a missing, failed, or hash-mismatched report', async () => {
    const real = fileURLToPath(
      new URL('../assets/parity/retire-legacy-gates.json', import.meta.url),
    )
    const report = JSON.parse(await readFile(real, 'utf8')) as Record<string, unknown>
    const directory = await mkdtemp(join(tmpdir(), 'parity-refusal-'))
    const missing = join(directory, 'missing.json')
    const failed = join(directory, 'failed.json')
    const mismatch = join(directory, 'mismatch.json')
    const failedReport = structuredClone(report) as { gates: Record<string, { status: string }> }
    for (const gate of Object.values(failedReport.gates)) gate.status = 'fail'
    const mismatchReport = structuredClone(report) as { templates: Record<string, string> }
    for (const key of Object.keys(mismatchReport.templates)) {
      mismatchReport.templates[key] = 'sha256-' + 'a'.repeat(64)
    }
    await writeFile(failed, JSON.stringify(failedReport), 'utf8')
    await writeFile(mismatch, JSON.stringify(mismatchReport), 'utf8')
    const valid = join(directory, 'valid.json')
    await writeFile(valid, JSON.stringify(report), 'utf8')
    for (const variant of [
      { error: 'missing', path: missing },
      { report: failedReport, path: failed },
      { report: mismatchReport, path: mismatch },
    ]) {
      const definitions = await runReport(variant)
      expect(definitions).not.toContain('verify')
      expect(definitions).not.toContain('retro')
    }
    // An external report override cannot rescue a missing packaged report: the
    // production loader only reads the packaged path.
    const rescued = await runReport({ error: 'missing', path: missing, external: valid })
    expect(rescued).not.toContain('verify')
    expect(rescued).not.toContain('retro')
  })

  it('loads with the shipped report and honors profile maxBlocks 129', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const definitions = await runReport(undefined)
    expect(definitions).toContain('verify')
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never, { verify: { commands: ['pnpm check'], maxBlocks: 129 } })
    await new Promise((resolve) => setTimeout(resolve, 100))
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
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'src/app.ts' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.steers).toHaveLength(1)
    for (let close = 0; close < 140; close += 1) {
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    }
    const settled = host.steers.length
    expect(settled).toBeLessThanOrEqual(130)
    for (let close = 0; close < 2; close += 1) {
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    }
    expect(host.steers.length).toBe(settled)
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
        (entry) => entry.definition.id === 'retro',
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

  it('repeated non-applicable turns consume no run capacity', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never, { maxRuns: 1 })
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
      results: ReadonlyArray<{ name: string; args: Record<string, unknown> }>,
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
          { isError: false, content: [{ type: 'text', text: 'ok' }] },
        )
      }
      await host.emit('agent/turn-stopping', { agent: host.agent, turn })
    }
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const retroRuns = async (): Promise<Array<{ id: string }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth)).filter(
        (entry) => entry.definition.id === 'retro',
      )

    // Short, read-only, and written question-ending turns are all not-applicable.
    await emitTurn(1, [{ name: 'read', args: {} }])
    await emitTurn(
      2,
      Array.from({ length: 5 }, () => ({ name: 'read', args: {} })),
    )
    await emitTurn(3, [
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'write', args: { file_path: 'src/app.ts' } },
      { name: 'ask_user_question', args: {} },
    ])
    await waitFor(
      async () => (await retroRows()).filter((row) => row.reason === 'not-applicable').length >= 3,
    )
    expect(await retroRuns()).toHaveLength(0)

    // The single maxRuns slot is still free for a real applicable turn.
    await emitTurn(4, [
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'write', args: { file_path: 'src/app.ts' } },
    ])
    await waitFor(async () => (await retroRows()).some((row) => row.reason === 'run-created'))
    expect(await retroRuns()).toHaveLength(1)
  })

  it('creates no retro run for a subagent turn', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never, { maxRuns: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const child = {
      ...host.agent,
      id: 'child-1',
      session: {
        id: 'child-1',
        header: { origin: 'subagent', delegationDepth: 1, parentSession: 'session-1' },
      },
    }
    await host.emit('agent/created', { agent: child })
    const childJournal = join(workspace, '.dsh', 'workflows', 'events', 'child-1.jsonl')
    const childRows = async (): Promise<Array<Record<string, unknown>>> =>
      (await readFile(childJournal, 'utf8').catch(() => ''))
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
    const turn = async (
      agent: Record<string, unknown>,
      number: number,
      results: ReadonlyArray<{ name: string; args: Record<string, unknown> }>,
    ): Promise<void> => {
      await host.emit(
        'agent/pre-step',
        {
          agent,
          turn: number,
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
            agent,
            callId: `call-${String(number)}-${String(index)}`,
            name: result.name,
            arguments: result.args,
          },
          { isError: false, content: [{ type: 'text', text: 'ok' }] },
        )
      }
      await host.emit('agent/turn-stopping', { agent, turn: number })
    }
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const retroRuns = async (): Promise<Array<{ id: string }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth)).filter(
        (entry) => entry.definition.id === 'retro',
      )

    // A subagent turn that would otherwise be applicable creates no run.
    await turn(child, 1, [
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'write', args: { file_path: 'src/app.ts' } },
    ])
    await waitFor(async () => (await childRows()).some((row) => row.reason === 'not-applicable'))
    expect(await retroRuns()).toHaveLength(0)

    // The free capacity slot still admits a root turn.
    await turn(host.agent, 2, [
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'write', args: { file_path: 'src/app.ts' } },
    ])
    await waitFor(async () => (await retroRuns()).length === 1)
  })
})

describe('task-review runtime from a tasks.md change', () => {
  it('names the change and the task and starts the owned review', async () => {
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
      await mkdir(join(workspace, '.dsh', 'delegation', 'task-review', 'auth', 'tasks'), {
        recursive: true,
      })
      await writeFile(
        join(workspace, '.dsh', 'delegation', 'task-review', 'auth', 'tasks', `${taskId}.json`),
        `${JSON.stringify({ rule: 'task-review', change: 'auth', phase: 'task', scope: 'task', taskId, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
        'utf8',
      )
    }
    const host = fakeHost(workspace, { toolExecute: true })
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
        .filter((entry) => entry.definition.id === 'task-review')
        .map((entry) => ({ id: entry.id, context: entry.context }))
    await waitFor(async () => (await taskRuns()).length === 2)
    const created = await taskRuns()
    expect(created.map((run) => run.context.taskId).sort()).toEqual([...taskIds].sort())
    expect(created.every((run) => run.context.name === 'auth')).toBe(true)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    for (const run of created) {
      const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
      expect(settled?.steps.every((step) => step.state === 'done')).toBe(true)
      expect(settled?.status).toBe('completed')
    }
    const { sessionRuns } = await import('../src/host/projection.ts')
    const views = await sessionRuns(workspace, 'session-1')
    for (const run of created) {
      const view = views.find((entry) => entry.id === `workflow:${run.id}`)
      expect(view).toBeDefined()
      expect(view?.steps.every((step) => step.state === 'done')).toBe(true)
    }
    // Each matching record settles its run; the engine never dispatches
    // delegate again, and a second close changes nothing.
    const delegateCalls = (): number =>
      host.toolExecutions.filter((entry) => entry.name === 'delegate').length
    expect(delegateCalls()).toBe(0)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    expect(delegateCalls()).toBe(0)

    // An edit that checks nothing starts no second observational run.
    await writeFile(join(changeDir, 'tasks.md'), '# Notes\n\n- [x] 1.1 Task\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await rows()).some((row) => row.reason === 'run-suppressed'))
    expect(await taskRuns()).toHaveLength(2)
  })

  it('suppresses a second run for a task a live run already covers', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const taskId = taskIdOf('Task')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const existing = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth', taskId },
      steps: ['start-review', 'await-review', 'complete-review'],
      now: 1_000,
    })
    await runs.writeRun(workspace, existing, auth)
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    host.fireFs()
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
    await waitFor(async () =>
      (await rows()).some(
        (row) => row.reason === 'run-suppressed' && String(row.detail).includes('already covers'),
      ),
    )
    const reviewRuns = (await runs.listAuthenticatedRuns(workspace, auth)).filter(
      (entry) => entry.definition.id === 'task-review',
    )
    expect(reviewRuns.map((entry) => entry.id)).toEqual([existing.id])
  })

  it('starts one run when two newly checked tasks share the same text', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(
      join(changeDir, 'tasks.md'),
      '- [ ] 1.1 Run tests\n- [ ] 2.1 Run tests\n',
      'utf8',
    )
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await writeFile(
      join(changeDir, 'tasks.md'),
      '- [x] 1.1 Run tests\n- [x] 2.1 Run tests\n',
      'utf8',
    )
    host.fireFs()
    const reviewRuns = async (): Promise<number> =>
      (await runs.listAuthenticatedRuns(workspace, auth)).filter(
        (entry) => entry.definition.id === 'task-review',
      ).length
    await waitFor(async () => (await reviewRuns()) >= 1)
    // Give a second start the chance to appear before asserting the dedupe.
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await reviewRuns()).toBe(1)
  })

  it('resumes a failed task-review run and dispatches the review again', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const taskId = taskIdOf('Task')
    const host = fakeHost(workspace, { toolExecute: true })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let run = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth', taskId },
      steps: ['start-review', 'await-review', 'complete-review'],
      now: 1_000,
    })
    run = runs.settleStep(run, 'start-review', 'failed', {
      at: 1_001,
      reason: 'the tool call failed: tool call aborted',
      attempts: 3,
      evidence: { kind: 'tool', callId: 'owned-previous', detail: 'failed' },
    })
    run = runs.setRunStatus(run, 'failed', 1_002, 'the review dispatch failed 3 time(s)')
    await runs.writeRun(workspace, run, auth)
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    const resumed = await tool?.execute({ action: 'resume', runId: run.id }, { agent: host.agent })
    expect(resumed?.text).toContain('resumed')
    const afterResume = await runs.readAuthenticatedRun(workspace, run.id, auth)
    const reopened = afterResume?.steps.find((entry) => entry.id === 'start-review')
    expect(reopened?.state).toBe('open')
    expect(reopened?.attempts).toBe(0)
    expect(reopened?.evidence).toBeUndefined()
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.toolExecutions.filter((entry) => entry.name === 'delegate').length).toBe(1)
    const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.steps.find((entry) => entry.id === 'start-review')?.state).toBe('done')
  })

  it('starts a fresh run after a superseded watcher run and a restored task', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
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
    const reviewRuns = async (): Promise<Array<{ id: string; status: string }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth))
        .filter((entry) => entry.definition.id === 'task-review')
        .map((entry) => ({ id: entry.id, status: entry.status }))
    // A real watcher tick starts the run and consumes its trigger key.
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length === 1)
    const first = (await reviewRuns())[0]
    expect(first).toBeDefined()
    // Unchecking the task supersedes the run at the turn close.
    const beforeUncheck = (await rows()).length
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await rows()).length > beforeUncheck)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await reviewRuns()).find((entry) => entry.id === first?.id)?.status === 'cancelled',
    )
    // Restoring the identical bytes must start a fresh run.
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length === 2)
    const restored = (await reviewRuns()).filter((entry) => entry.id !== first?.id)
    expect(restored).toHaveLength(1)
    expect(restored[0]?.status).toBe('running')
  })

  it('clears a superseded dedupe key even when an earlier run refuses the close', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 A\n- [ ] 1.2 B\n', 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
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
    const reviewRuns = async (): Promise<
      Array<{ id: string; status: string; context: Record<string, unknown> }>
    > =>
      (await runs.listAuthenticatedRuns(workspace, auth))
        .filter((entry) => entry.definition.id === 'task-review')
        .map((entry) => ({ id: entry.id, status: entry.status, context: entry.context }))
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length === 2)
    const runB = (await reviewRuns()).find((entry) => entry.context.taskId === taskIdOf('B'))
    expect(runB).toBeDefined()
    const beforeUncheck = (await rows()).length
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [ ] 1.2 B\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await rows()).length > beforeUncheck)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    // The earlier run A refuses the close; B is still superseded and forgotten.
    await waitFor(
      async () =>
        (await runs.listAuthenticatedRuns(workspace, auth)).find((entry) => entry.id === runB?.id)
          ?.status === 'cancelled',
    )
    expect(host.steers.length).toBeGreaterThan(0)
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length === 3)
    const restored = (await reviewRuns()).filter(
      (entry) => entry.id !== runB?.id && entry.context.taskId === taskIdOf('B'),
    )
    expect(restored).toHaveLength(1)
    expect(restored[0]?.status).toBe('running')
  })

  it('rejects a stale advance that would overwrite a resumed run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const taskId = taskIdOf('Task')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = fakeHost(workspace, { toolExecute: true, delegateBarrier: barrier })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    let run = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth', taskId },
      steps: ['start-review', 'await-review', 'complete-review'],
      now: 1_000,
    })
    run = runs.setRunStatus(run, 'blocked', 1_001)
    await runs.writeRun(workspace, run, auth)
    const closing = host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(() => host.toolExecutions.some((entry) => entry.name === 'delegate'))
    await host.emit('agent/disposed', { agent: host.agent })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, run.id, auth))?.status === 'interrupted',
    )
    await host.emit('agent/created', { agent: host.agent })
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    await tool?.execute({ action: 'resume', runId: run.id }, { agent: host.agent })
    release()
    await closing
    // The resumed state survives the in-flight advance's stale persistence.
    const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.status).toBe('running')
    expect(settled?.steps.find((step) => step.id === 'start-review')?.state).toBe('open')
  })

  it('keeps a resumed earlier run when a later dispatch is pending', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = fakeHost(workspace, { toolExecute: true, delegateBarrier: barrier })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const makeRun = (
      taskId: string,
      now: number,
      started: boolean,
    ): ReturnType<typeof runs.createRun> => {
      let entry = runs.createRun({
        definition: 'task-review',
        trigger: 'fs.change',
        session: 'session-1',
        workspace,
        context: { name: 'auth', taskId },
        steps: ['start-review', 'await-review', 'complete-review'],
        now,
      })
      if (started) entry = runs.settleStep(entry, 'start-review', 'done', { at: now + 1 })
      return entry
    }
    const runA = makeRun(taskIdOf('A'), 1_000, true)
    const runB = makeRun(taskIdOf('B'), 1_100, false)
    await runs.writeRun(workspace, runA, auth)
    await runs.writeRun(workspace, runB, auth)
    const closing = host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(() => host.toolExecutions.some((entry) => entry.name === 'delegate'))
    await host.emit('agent/disposed', { agent: host.agent })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, runA.id, auth))?.status === 'interrupted',
    )
    await host.emit('agent/created', { agent: host.agent })
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    await tool?.execute({ action: 'resume', runId: runA.id }, { agent: host.agent })
    release()
    await closing
    const settledA = await runs.readAuthenticatedRun(workspace, runA.id, auth)
    expect(settledA?.status).toBe('running')
    expect(settledA?.steps.find((step) => step.id === 'await-review')?.state).toBe('open')
    // The gate's cached write for the earlier run must not land after the resume.
    expect(settledA?.turnBlocks).toBeUndefined()
  })

  it('keeps a resumed later run when an earlier dispatch is pending', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const host = fakeHost(workspace, { toolExecute: true, delegateBarrier: barrier })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const makeRun = (
      taskId: string,
      now: number,
      failed: boolean,
    ): ReturnType<typeof runs.createRun> => {
      let entry = runs.createRun({
        definition: 'task-review',
        trigger: 'fs.change',
        session: 'session-1',
        workspace,
        context: { name: 'auth', taskId },
        steps: ['start-review', 'await-review', 'complete-review'],
        now,
      })
      if (failed) {
        entry = runs.settleStep(entry, 'start-review', 'failed', {
          at: now + 1,
          reason: 'tool call aborted',
          attempts: 2,
        })
      }
      return runs.setRunStatus(entry, 'blocked', now + 2)
    }
    const runA = makeRun(taskIdOf('A'), 1_000, false)
    const runB = makeRun(taskIdOf('B'), 1_100, true)
    await runs.writeRun(workspace, runA, auth)
    await runs.writeRun(workspace, runB, auth)
    const closing = host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(() => host.toolExecutions.some((entry) => entry.name === 'delegate'))
    await host.emit('agent/disposed', { agent: host.agent })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, runB.id, auth))?.status === 'interrupted',
    )
    await host.emit('agent/created', { agent: host.agent })
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    await tool?.execute({ action: 'resume', runId: runB.id }, { agent: host.agent })
    release()
    await closing
    const settledB = await runs.readAuthenticatedRun(workspace, runB.id, auth)
    expect(settledB?.status).toBe('running')
    const step = settledB?.steps.find((entry) => entry.id === 'start-review')
    expect(step?.state).toBe('open')
    expect(step?.attempts).toBe(0)
  })

  it('does not let a delayed disposal overwrite a resumed run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const makeRun = (taskId: string, now: number): ReturnType<typeof runs.createRun> =>
      runs.setRunStatus(
        runs.createRun({
          definition: 'task-review',
          trigger: 'fs.change',
          session: 'session-1',
          workspace,
          context: { name: 'auth', taskId },
          steps: ['start-review', 'await-review', 'complete-review'],
          now,
        }),
        'blocked',
        now + 1,
      )
    const runA = makeRun(taskIdOf('A'), 1_000)
    const runB = makeRun(taskIdOf('B'), 1_100)
    await runs.writeRun(workspace, runA, auth)
    await runs.writeRun(workspace, runB, auth)
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    runStoreFaults.pauseNextWrite = barrier
    void host.emit('agent/disposed', { agent: host.agent })
    await waitFor(() => runStoreFaults.pauseNextWrite === undefined, 90000)
    await host.emit('agent/created', { agent: host.agent })
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    await tool?.execute({ action: 'resume', runId: runB.id }, { agent: host.agent })
    release()
    // The delayed disposal batch must not overwrite the resumed run; the
    // disposal's own interruption is covered by the session-disposal test.
    const settledB = await runs.readAuthenticatedRun(workspace, runB.id, auth)
    expect(settledB?.status).toBe('running')
    expect(settledB?.steps.find((entry) => entry.id === 'start-review')?.state).toBe('open')
  }, 90000)
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

  it('does not start a run for a shadow or session-filtered trigger', async () => {
    // Two local definitions that match a non-intake command: the shadow one
    // evaluates but acts on nothing, and the session-filtered one never sees
    // this session. Neither declares the intake gate.
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const shadow = {
      v: 1,
      id: 'shadow-watch',
      name: 'Shadow watch',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'shell', command: 'acme watch {name}' },
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
    const filtered = {
      ...shadow,
      id: 'filtered-watch',
      name: 'Filtered watch',
      trigger: { ...shadow.trigger, mode: 'active', match: { session: 'another-session' } },
    }
    for (const [file, definition] of [
      ['shadow.json', shadow],
      ['filtered.json', filtered],
    ] as const) {
      await writeFile(join(workspace, file), `${JSON.stringify(definition, null, 2)}\n`, 'utf8')
      await installDefinition(workspace, join(workspace, file), auth)
    }
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const call = async (callId: string, command: string): Promise<unknown> =>
      host.emit(
        'tools/pre-execute',
        { agent: host.agent, callId, name: 'pwsh', arguments: { command } },
        async () => ({ kind: 'continue' }),
      )
    expect((await call('call-shadow', 'acme watch auth')) as { kind?: string }).toMatchObject({
      kind: 'continue',
    })
    await waitFor(async () =>
      (await journalRows(workspace)).some((entry) =>
        Array.isArray(entry.triggers)
          ? (entry.triggers as Array<Record<string, unknown>>).some(
              (row) => row.id === 'definition:shadow-watch' && row.reason === 'would-fire',
            )
          : false,
      ),
    )
    await call('call-shadow-2', 'acme watch auth')
    await waitFor(async () =>
      (await journalRows(workspace)).some((entry) =>
        Array.isArray(entry.triggers)
          ? (entry.triggers as Array<Record<string, unknown>>).some(
              (row) => row.id === 'definition:shadow-watch' && row.reason === 'dedupe',
            )
          : false,
      ),
    )
    await call('call-filtered', 'acme watch auth')
    const runs = await readdir(join(workspace, '.dsh', 'workflows', 'runs')).catch(() => [])
    expect(runs.filter((entry) => entry.endsWith('.json'))).toHaveLength(0)
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

  function customGated(id: string, command: string): Record<string, unknown> {
    return {
      v: 1,
      id,
      name: id,
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'shell', command },
        mode: 'active',
        dedupe: 'name',
      },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
        allowTools: ['shell'],
        gate: 'intake',
      },
      steps: [
        {
          id: 'requirements',
          title: 'Requirements',
          executor: 'main',
          prompt: 'Write the requirements.',
          evidence: { kind: 'file', path: '.dsh/workflows/drafts/{name}/requirements.md' },
          next: 'create-change',
          blockTurnClose: true,
        },
        {
          id: 'create-change',
          title: 'Create',
          executor: 'tool',
          tool: { name: 'shell', command },
          evidence: { kind: 'tool', name: 'shell' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
  }

  it('runs a differently named gated definition through the public registry service', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const service = (host.ctx.get as (name: string) => unknown)('workflowsDefinitions') as
      | { register(contribution: unknown): () => void }
      | undefined
    expect(service).toBeDefined()
    const dispose = service?.register({
      source: '@acme/plugin',
      definitions: [customGated('custom-intake', 'acme intake {name}')],
      triggers: [],
    })
    try {
      const call = async (callId: string): Promise<{ kind?: string; reason?: string }> =>
        (await host.emit(
          'tools/pre-execute',
          {
            agent: host.agent,
            callId,
            name: 'pwsh',
            arguments: { command: 'acme intake auth' },
          },
          async () => ({ kind: 'continue' }),
        )) as { kind?: string; reason?: string }
      const first = await call('call-custom-1')
      expect(first.kind).toBe('deny')
      const runs = await import('../src/host/runs.ts')
      const auth = (await import('../src/host/host-auth.ts')).HostAuth.fromKey(
        Buffer.from(KEY, 'hex'),
      )
      const stored = await runs.listAuthenticatedRuns(workspace, auth)
      const run = stored.find((entry) => entry.definition.id === 'custom-intake')
      expect(run?.context.name).toBe('auth')
      if (run === undefined) return

      const repeated = await call('call-custom-2')
      expect(repeated.kind).toBe('deny')
      expect(repeated.reason).toContain('already in progress')

      await runs.writeRun(workspace, runs.setRunStatus(run, 'interrupted', 2_000), auth)
      const resumed = await call('call-custom-3')
      expect(resumed.kind).toBe('deny')
      expect(resumed.reason).toContain('resumed')
      expect(resumed.reason).toContain(run.id)

      let completed = runs.setRunStatus(run, 'running', 2_100)
      for (const step of completed.steps) {
        completed = runs.settleStep(completed, step.id, 'done', { at: 2_200 })
      }
      completed = runs.setRunStatus(completed, 'completed', 2_300)
      await runs.writeRun(workspace, completed, auth)
      // An allow continues the command and creates no second run.
      const allowed = await call('call-custom-4')
      expect(allowed.kind).toBe('continue')
      const storedAfter = await runs.listAuthenticatedRuns(workspace, auth)
      expect(storedAfter.filter((entry) => entry.definition.id === 'custom-intake')).toHaveLength(1)
    } finally {
      dispose?.()
    }
  })

  it('keeps an earlier gate denial when a later gated definition is completed', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const service = (host.ctx.get as (name: string) => unknown)('workflowsDefinitions') as
      | { register(contribution: unknown): () => void }
      | undefined
    expect(service).toBeDefined()
    const dispose = service?.register({
      source: '@acme/plugin',
      definitions: [
        customGated('intake-a', 'acme policy {name}'),
        customGated('intake-b', 'acme policy {name}'),
      ],
      triggers: [],
    })
    try {
      const call = async (callId: string): Promise<{ kind?: string; reason?: string }> =>
        (await host.emit(
          'tools/pre-execute',
          {
            agent: host.agent,
            callId,
            name: 'pwsh',
            arguments: { command: 'acme policy auth' },
          },
          async () => ({ kind: 'continue' }),
        )) as { kind?: string; reason?: string }
      expect((await call('call-policy-1')).kind).toBe('deny')
      const runs = await import('../src/host/runs.ts')
      const auth = (await import('../src/host/host-auth.ts')).HostAuth.fromKey(
        Buffer.from(KEY, 'hex'),
      )
      const stored = await runs.listAuthenticatedRuns(workspace, auth)
      const later = stored.find((entry) => entry.definition.id === 'intake-b')
      if (later === undefined) throw new Error('the later gated run was not created')
      let completed = runs.setRunStatus(later, 'running', 2_100)
      for (const step of completed.steps) {
        completed = runs.settleStep(completed, step.id, 'done', { at: 2_200 })
      }
      completed = runs.setRunStatus(completed, 'completed', 2_300)
      await runs.writeRun(workspace, completed, auth)

      // The first definition's run is still running, so its gate must deny even
      // though the later definition's completed run would allow the call.
      const decision = await call('call-policy-2')
      expect(decision.kind).toBe('deny')
      expect(decision.reason).toContain('already in progress')
    } finally {
      dispose?.()
    }
  })

  it('applies the intake gate to rtk and pnpm exec prefixed calls', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const call = async (callId: string, command: string): Promise<{ kind?: string }> =>
      (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId,
          name: 'pwsh',
          arguments: { command },
        },
        async () => ({ kind: 'continue' }),
      )) as { kind?: string }
    for (const [callId, command] of [
      ['call-rtk', 'rtk openspec new change auth-rtk'],
      ['call-pnpm', 'pnpm exec openspec new change auth-pnpm'],
      ['call-tab', 'openspec\tnew change auth-tab'],
    ] as const) {
      const decision = await call(callId, command)
      expect(decision.kind).toBe('deny')
      expect((decision as { reason?: string }).reason).toContain('intake run')
    }
    const runs = await import('node:fs/promises').then(async ({ readdir }) =>
      (await readdir(join(workspace, '.dsh', 'workflows', 'runs'))).filter((entry) =>
        entry.endsWith('.json'),
      ),
    )
    expect(runs).toHaveLength(3)
  })

  it('loads a contribution registered after the workspace definitions were cached', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    // The first call loads and caches this workspace's definitions.
    await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'call-before-contribution',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => ({ kind: 'continue' }),
    )
    const definition = {
      v: 1,
      id: 'acme-deploy',
      name: 'Acme deploy',
      version: 1,
      trigger: {
        kind: 'tool.pre-execute',
        match: { tool: 'shell', command: 'acme deploy {name}' },
        mode: 'active',
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
    const dispose = definitionsRegistry.register({
      source: '@acme/plugin',
      definitions: [definition],
      triggers: [],
    })
    try {
      await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: 'call-after-contribution',
          name: 'pwsh',
          arguments: { command: 'acme deploy auth' },
        },
        async () => ({ kind: 'continue' }),
      )
      await waitFor(async () =>
        (await journalRows(workspace)).some((entry) =>
          Array.isArray(entry.triggers)
            ? (entry.triggers as Array<Record<string, unknown>>).some(
                (row) => row.id === 'definition:acme-deploy' && row.reason === 'run-created',
              )
            : false,
        ),
      )
      const rows = await journalRows(workspace)
      expect(
        rows.some((entry) =>
          Array.isArray(entry.triggers)
            ? (entry.triggers as Array<Record<string, unknown>>).some(
                (row) => row.id === 'definition:acme-deploy' && row.reason === 'run-created',
              )
            : false,
        ),
      ).toBe(true)
    } finally {
      dispose()
    }
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
      [{ checkpointApplicability: { stepInterval: 0 } }, /stepInterval/u],
      [{ checkpointApplicability: { stepInterval: 10_001 } }, /stepInterval/u],
      [{ checkpointApplicability: { stepInterval: 1.5 } }, /stepInterval/u],
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
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
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
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
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
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
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
    expect(all.filter((entry) => entry.definition.id === 'change-intake')).toHaveLength(1)
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

it('carries a raw filesystem path into the definition event without extracting a name', () => {
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
    path: 'openspec/changes/auth/tasks.md',
  })
  expect(events[0]?.name).toBeUndefined()
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
        (run) => run.definition.id === 'change-intake',
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
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
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

describe('/workflows command starts and resumes work', () => {
  it('names the tab, steers the pending step for run and resume, and advances at turn close', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const definition = {
      v: 1,
      id: 'demo',
      name: 'Demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    await writeFile(join(workspace, 'demo.json'), `${JSON.stringify(definition)}\n`, 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await installDefinition(workspace, join(workspace, 'demo.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    if (command === undefined) return
    const invoke = (rawInput: string): Promise<{ kind?: string; text?: string }> =>
      command.handler({
        agent: host.agent,
        commandId: 'cmd-start',
        rawInput,
        attachments: [],
        signal: new AbortController().signal,
      })

    const display = await invoke('')
    expect(display.kind).toBe('success')
    expect(display.text).toContain('Workflows tab')
    expect(display.text).toContain('Workflow design')
    expect(host.steers).toHaveLength(0)

    const started = await invoke(' run demo')
    expect(started.kind).toBe('success')
    expect(host.steers).toHaveLength(1)
    expect(JSON.stringify(host.steers[0])).toContain('Observe')
    const run = (await runs.listAuthenticatedRuns(workspace, auth)).find(
      (entry) => entry.definition.id === 'demo',
    )
    expect(run).toBeDefined()
    await writeFile(join(workspace, 'out.md'), 'evidence\n', 'utf8')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const completed = await runs.readAuthenticatedRun(workspace, run?.id ?? '', auth)
    expect(completed?.status).toBe('completed')

    // Resume after a restart continues the persisted interrupted run.
    const base = runs.createRun({
      definition: 'demo',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['observe'],
      id: 'run-resume-demo',
      now: 2_000,
    })
    await runs.writeRun(workspace, runs.setRunStatus(base, 'interrupted', 2_100), auth)
    const restarted = fakeHost(workspace)
    apply(restarted.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const restartedCommand = restarted.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(restartedCommand).toBeDefined()
    if (restartedCommand === undefined)
      throw new Error('the restarted host has no workflows command')
    const invokeResume = () =>
      restartedCommand.handler({
        agent: restarted.agent,
        commandId: 'cmd-resume',
        rawInput: ' resume run-resume-demo',
        attachments: [],
        signal: new AbortController().signal,
      })
    // The restarted host finishes asynchronous journal recovery after apply; a
    // command issued before it settles must become usable on retry.
    let resumed = await invokeResume()
    for (let attempt = 0; resumed.kind !== 'success' && attempt < 10; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      resumed = await invokeResume()
    }
    expect(resumed.kind, resumed.text).toBe('success')
    expect(restarted.steers).toHaveLength(1)
    await restarted.emit('agent/turn-stopping', { agent: restarted.agent, turn: 1 })
    const resumedRun = await runs.readAuthenticatedRun(workspace, 'run-resume-demo', auth)
    expect(resumedRun?.status).toBe('completed')
  })

  it('does not steer a deferred pending step on resume', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
    expect(intake).toBeDefined()
    if (intake === undefined) return
    const base = runs.createRun({
      definition: 'change-intake',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: intake.steps.map((step) => step.id),
      id: 'run-resume-deferred',
      now: 3_000,
    })
    const withDone = {
      ...base,
      steps: base.steps.map((step) =>
        step.id === 'spec-review' || step.id === 'approval'
          ? step
          : { ...step, state: 'done' as const },
      ),
    }
    await runs.writeRun(workspace, runs.setRunStatus(withDone, 'interrupted', 3_100), auth)
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    const resumed = await command?.handler({
      agent: host.agent,
      commandId: 'cmd-resume-deferred',
      rawInput: ' resume run-resume-deferred',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(resumed?.kind).toBe('success')
    expect(host.steers).toHaveLength(0)
    const stored = await runs.readAuthenticatedRun(workspace, 'run-resume-deferred', auth)
    expect(stored?.steps.find((step) => step.id === 'spec-review')?.state).toBe('open')
  })

  it('steers the branch pending step, not the array-first step', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const branch = {
      v: 1,
      id: 'branch-demo',
      name: 'Branch demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
      },
      steps: [
        {
          id: 'join',
          title: 'Join',
          executor: 'main',
          prompt: 'Join step.',
          evidence: { kind: 'file', path: 'join.md' },
          next: 'end',
          blockTurnClose: true,
        },
        {
          id: 'yes',
          title: 'Yes branch',
          executor: 'main',
          prompt: 'Yes step.',
          evidence: { kind: 'file', path: 'yes.md' },
          next: 'join',
          blockTurnClose: true,
        },
      ],
    }
    await writeFile(join(workspace, 'branch.json'), `${JSON.stringify(branch)}\n`, 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await installDefinition(workspace, join(workspace, 'branch.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const runs = await import('../src/host/runs.ts')
    const base = runs.createRun({
      definition: 'branch-demo',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['join', 'yes'],
      id: 'run-branch',
      now: 4_000,
    })
    const run = {
      ...base,
      branchPath: ['yes', 'join'],
      steps: base.steps.map((step) =>
        step.id === 'join'
          ? { ...step, state: 'open' as const }
          : step.id === 'yes'
            ? { ...step, state: 'blocked' as const }
            : step,
      ),
    }
    await runs.writeRun(workspace, runs.setRunStatus(run, 'interrupted', 4_100), auth)
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    const resumed = await command?.handler({
      agent: host.agent,
      commandId: 'cmd-resume-branch',
      rawInput: ' resume run-branch',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(resumed?.kind).toBe('success')
    expect(host.steers).toHaveLength(1)
    const steered = JSON.stringify(host.steers[0])
    expect(steered).toContain('Yes step.')
    expect(steered).not.toContain('Join step.')
  })

  it('resumes a step whose previous steer budget is exhausted', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const budget = {
      v: 1,
      id: 'budget-demo',
      name: 'Budget demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    await writeFile(join(workspace, 'budget.json'), `${JSON.stringify(budget)}\n`, 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await installDefinition(workspace, join(workspace, 'budget.json'), auth)
    const runs = await import('../src/host/runs.ts')
    const base = runs.createRun({
      definition: 'budget-demo',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['observe'],
      id: 'run-budget',
      now: 5_000,
    })
    const exhausted = {
      ...base,
      steps: base.steps.map((step) => ({ ...step, state: 'blocked' as const, attempts: 3 })),
    }
    await runs.writeRun(workspace, runs.setRunStatus(exhausted, 'interrupted', 5_100), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    const resumed = await command?.handler({
      agent: host.agent,
      commandId: 'cmd-resume-budget',
      rawInput: ' resume run-budget',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(resumed?.kind).toBe('success')
    expect(host.steers).toHaveLength(1)
    await writeFile(join(workspace, 'out.md'), 'evidence\n', 'utf8')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const completed = await runs.readAuthenticatedRun(workspace, 'run-budget', auth)
    expect(completed?.status).toBe('completed')
  })

  it('installs a definition and runs it without a restart', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const late = {
      v: 1,
      id: 'late-demo',
      name: 'Late demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    await writeFile(join(workspace, 'late-demo.json'), `${JSON.stringify(late)}\n`, 'utf8')
    const host = fakeHost(workspace, { userQuestions: true })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    if (command === undefined) return
    const installed = await command.handler({
      agent: host.agent,
      commandId: 'cmd-install',
      rawInput: ` install ${join(workspace, 'late-demo.json')}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(installed.kind).toBe('success')
    const started = await command.handler({
      agent: host.agent,
      commandId: 'cmd-run-late',
      rawInput: ' run late-demo',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(started.kind).toBe('success')
    expect(started.text).toContain('step "observe"')
  })
})

describe('active-runs prompt context', () => {
  it('tracks starts, completions, cancellations, and an empty workspace', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const demo = {
      v: 1,
      id: 'demo',
      name: 'Demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    await writeFile(join(workspace, 'demo.json'), `${JSON.stringify(demo)}\n`, 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await installDefinition(workspace, join(workspace, 'demo.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const contribution = host.promptContributions.find(
      (entry) => entry.name === 'workflows-active-runs',
    )
    expect(contribution).toBeDefined()
    expect(contribution?.text()).toBe('')
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    if (command === undefined || contribution === undefined) return
    const invoke = (rawInput: string): Promise<{ kind?: string; text?: string }> =>
      command.handler({
        agent: host.agent,
        commandId: `cmd-${rawInput.trim()}`,
        rawInput,
        attachments: [],
        signal: new AbortController().signal,
      })
    const runs = await import('../src/host/runs.ts')

    await invoke(' run demo')
    await waitFor(() => contribution.text().includes('demo'))
    await writeFile(join(workspace, 'out.md'), 'evidence\n', 'utf8')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(() => contribution.text() === '')

    await invoke(' run demo')
    await waitFor(() => contribution.text().includes('demo'))
    const second = (await runs.listAuthenticatedRuns(workspace, auth))
      .filter((entry) => entry.definition.id === 'demo')
      .at(-1)
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    await tool?.execute({ action: 'cancel', runId: second?.id }, { agent: host.agent })
    await waitFor(() => contribution.text() === '')

    // Another workspace must render no section, even while this one has a run.
    await invoke(' run demo')
    await waitFor(() => contribution.text().includes('demo'))
    const other = await tempWorkspace()
    await writeFile(join(other, 'demo.json'), `${JSON.stringify(demo)}\n`, 'utf8')
    await installDefinition(other, join(other, 'demo.json'), auth)
    const otherHost = fakeHost(other)
    apply(otherHost.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const otherContribution = otherHost.promptContributions.find(
      (entry) => entry.name === 'workflows-active-runs',
    )
    expect(otherContribution).toBeDefined()
    expect(otherContribution?.text()).toBe('')
  })

  it('keeps two workspaces separate in one plugin instance', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspaceA = await tempWorkspace()
    const workspaceB = await tempWorkspace()
    const demo = {
      v: 1,
      id: 'demo',
      name: 'Demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    for (const workspace of [workspaceA, workspaceB]) {
      await writeFile(join(workspace, 'demo.json'), `${JSON.stringify(demo)}\n`, 'utf8')
      await installDefinition(workspace, join(workspace, 'demo.json'), auth)
    }
    const host = fakeHost(workspaceA, { workspaces: { 'session-2': workspaceB } })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 120))
    const contribution = host.promptContributions.find(
      (entry) => entry.name === 'workflows-active-runs',
    )
    expect(contribution).toBeDefined()
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | {
          handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }>
        }
      | undefined
    expect(command).toBeDefined()
    if (contribution === undefined || command === undefined) return
    const otherAgent = {
      ...host.agent,
      id: 'session-2',
      session: { id: 'session-2', header: { origin: 'root' } },
    }
    await host.emit('agent/created', { agent: otherAgent })
    const start = (agent: Record<string, unknown>, id: string): Promise<{ kind?: string }> =>
      command.handler({
        agent,
        commandId: `cmd-${id}`,
        rawInput: ' run demo',
        attachments: [],
        signal: new AbortController().signal,
      })
    await start(host.agent, 'a')
    await start(otherAgent, 'b')
    const runs = await import('../src/host/runs.ts')
    const runA = (await runs.listAuthenticatedRuns(workspaceA, auth)).find(
      (entry) => entry.definition.id === 'demo',
    )
    const runB = (await runs.listAuthenticatedRuns(workspaceB, auth)).find(
      (entry) => entry.definition.id === 'demo',
    )
    expect(runA).toBeDefined()
    expect(runB).toBeDefined()
    await waitFor(
      () =>
        contribution.text({ scope: 'session-1' }).includes(runA?.id ?? 'missing') &&
        contribution.text({ scope: 'session-2' }).includes(runB?.id ?? 'missing'),
    )
    const textA = contribution.text({ scope: 'session-1' })
    const textB = contribution.text({ scope: 'session-2' })
    expect(textA).not.toContain(runB?.id ?? 'missing')
    expect(textB).not.toContain(runA?.id ?? 'missing')
  })

  it('lists only the requesting session runs when both share one workspace', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const demo = {
      v: 1,
      id: 'demo',
      name: 'Demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    await writeFile(join(workspace, 'demo.json'), `${JSON.stringify(demo)}\n`, 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await installDefinition(workspace, join(workspace, 'demo.json'), auth)
    const host = fakeHost(workspace, { workspaces: { 'session-2': workspace } })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const contribution = host.promptContributions.find(
      (entry) => entry.name === 'workflows-active-runs',
    )
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | {
          handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }>
        }
      | undefined
    if (contribution === undefined || command === undefined) return
    const otherAgent = {
      ...host.agent,
      id: 'session-2',
      session: { id: 'session-2', header: { origin: 'root' } },
    }
    await host.emit('agent/created', { agent: otherAgent })
    const start = (agent: Record<string, unknown>, id: string): Promise<{ kind?: string }> =>
      command.handler({
        agent,
        commandId: `cmd-${id}`,
        rawInput: ' run demo',
        attachments: [],
        signal: new AbortController().signal,
      })
    await start(host.agent, 'a')
    await start(otherAgent, 'b')
    const runs = await import('../src/host/runs.ts')
    const all = await runs.listAuthenticatedRuns(workspace, auth)
    const runA = all.find(
      (entry) => entry.definition.id === 'demo' && entry.session === 'session-1',
    )
    const runB = all.find(
      (entry) => entry.definition.id === 'demo' && entry.session === 'session-2',
    )
    expect(runA).toBeDefined()
    expect(runB).toBeDefined()
    await waitFor(
      () =>
        contribution.text({ scope: 'session-1' }).includes(runA?.id ?? 'missing') &&
        contribution.text({ scope: 'session-2' }).includes(runB?.id ?? 'missing'),
    )
    expect(contribution.text({ scope: 'session-1' })).not.toContain(runB?.id ?? 'missing')
    expect(contribution.text({ scope: 'session-2' })).not.toContain(runA?.id ?? 'missing')
  })

  it('disposes one session without interrupting another live session run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const demo = {
      v: 1,
      id: 'demo',
      name: 'Demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    await writeFile(join(workspace, 'demo.json'), `${JSON.stringify(demo)}\n`, 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await installDefinition(workspace, join(workspace, 'demo.json'), auth)
    const host = fakeHost(workspace, { workspaces: { 'session-2': workspace } })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    if (command === undefined) return
    const otherAgent = {
      ...host.agent,
      id: 'session-2',
      session: { id: 'session-2', header: { origin: 'root' } },
    }
    await host.emit('agent/created', { agent: otherAgent })
    const start = (agent: Record<string, unknown>, id: string): Promise<{ kind?: string }> =>
      command.handler({
        agent,
        commandId: `cmd-${id}`,
        rawInput: ' run demo',
        attachments: [],
        signal: new AbortController().signal,
      })
    await start(host.agent, 'a')
    await start(otherAgent, 'b')
    const runs = await import('../src/host/runs.ts')
    const all = await runs.listAuthenticatedRuns(workspace, auth)
    const runA = all.find(
      (entry) => entry.definition.id === 'demo' && entry.session === 'session-1',
    )
    const runB = all.find(
      (entry) => entry.definition.id === 'demo' && entry.session === 'session-2',
    )
    expect(runA).toBeDefined()
    expect(runB).toBeDefined()
    await host.emit('agent/disposed', { agent: host.agent })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, runA?.id ?? 'missing', auth))?.status ===
        'interrupted',
    )
    await writeFile(join(workspace, 'out.md'), 'evidence\n', 'utf8')
    await host.emit('agent/turn-stopping', { agent: otherAgent, turn: 1 })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, runB?.id ?? 'missing', auth))?.status ===
        'completed',
    )
    const settledA = await runs.readAuthenticatedRun(workspace, runA?.id ?? 'missing', auth)
    expect(settledA?.status).toBe('interrupted')
  })

  it('shows recovered and automatically started runs before turn close', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const base = runs.createRun({
      definition: 'change-intake',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: ['requirements'],
      id: 'run-recovered',
      now: 6_000,
    })
    const recovered = {
      ...base,
      steps: base.steps.map((step) => ({ ...step, state: 'open' as const })),
    }
    await runs.writeRun(workspace, runs.setRunStatus(recovered, 'interrupted', 6_100), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const contribution = host.promptContributions.find(
      (entry) => entry.name === 'workflows-active-runs',
    )
    expect(contribution).toBeDefined()
    await waitFor(
      () => contribution?.text({ scope: 'session-1' }).includes('run-recovered') === true,
    )
    await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'call-auto',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => ({ kind: 'continue' }),
    )
    await waitFor(
      () => contribution?.text({ scope: 'session-1' }).includes('change-intake') === true,
    )
  })
})

describe('task-review terminal coverage', () => {
  it('refuses a final tick without a portable PASS after dispatch exhaustion', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const taskId = taskIdOf('Task')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let run = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth', taskId },
      steps: ['start-review', 'await-review', 'complete-review'],
      now: 1_000,
    })
    run = runs.settleStep(run, 'start-review', 'failed', {
      at: 1_001,
      reason: 'the review dispatch failed 3 time(s)',
      attempts: 3,
    })
    run = runs.setRunStatus(run, 'failed', 1_002, 'the review dispatch failed 3 time(s)')
    await runs.writeRun(workspace, run, auth)
    const steerText = (): string =>
      host.steers
        .map((message) =>
          ((message as { content?: Array<{ text?: string }> }).content ?? [])
            .map((block) => block.text ?? '')
            .join(''),
        )
        .join('\n')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(() => steerText().includes('completion of change'))
    expect(steerText()).toContain('task-review PASS')
    const firstCount = host.steers.length
    // The failed-dispatch branch is skipped, but the coverage still refuses
    // the later close: a terminal run does not exempt the final tick.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    await waitFor(() => host.steers.length > firstCount)
  })
})

describe('session disposal', () => {
  it('marks the session runs interrupted so no other session inherits them', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const demo = {
      v: 1,
      id: 'demo',
      name: 'Demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    await writeFile(join(workspace, 'demo.json'), `${JSON.stringify(demo)}\n`, 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await installDefinition(workspace, join(workspace, 'demo.json'), auth)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | {
          handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }>
        }
      | undefined
    if (command === undefined) return
    await command.handler({
      agent: host.agent,
      commandId: 'cmd-run',
      rawInput: ' run demo',
      attachments: [],
      signal: new AbortController().signal,
    })
    const runs = await import('../src/host/runs.ts')
    const started = (await runs.listAuthenticatedRuns(workspace, auth)).find(
      (entry) => entry.definition.id === 'demo',
    )
    expect(started).toBeDefined()
    await host.emit('agent/disposed', { agent: host.agent })
    await waitFor(
      async () =>
        (await runs.listAuthenticatedRuns(workspace, auth)).find(
          (entry) => entry.id === started?.id,
        )?.status === 'interrupted',
    )
    const after = (await runs.listAuthenticatedRuns(workspace, auth)).find(
      (entry) => entry.id === started?.id,
    )
    expect(after?.reason).toContain('session ended')
    expect(after?.steps.every((step) => step.state === 'open')).toBe(true)
    const runId = started?.id ?? 'missing'
    // A recreated session agent resumes the run instead of re-interrupting it.
    await host.emit('agent/created', { agent: host.agent })
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    const resumed = await tool?.execute({ action: 'resume', runId }, { agent: host.agent })
    expect(resumed?.text).toContain('resumed')
    await writeFile(join(workspace, 'out.md'), 'evidence\n', 'utf8')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await runs.listAuthenticatedRuns(workspace, auth)).find((entry) => entry.id === runId)
          ?.status === 'completed',
    )
    const completed = (await runs.listAuthenticatedRuns(workspace, auth)).find(
      (entry) => entry.id === runId,
    )
    expect(completed?.status).toBe('completed')
  })

  it('rejects an intake completion that races a disposal and issues no receipt', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const steps = [
      'requirements',
      'architecture',
      'interface',
      'create-change',
      'spec',
      'spec-review',
      'approval',
    ]
    let run = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps,
      now: 1_000,
    })
    for (const step of steps) {
      run = runs.settleStep(run, step, 'done', {
        at: 1_001,
        ...(step === 'spec-review'
          ? {
              evidence: {
                kind: 'record',
                path: '.dsh/delegation/spec-review/auth/spec.json',
                digest: 'a'.repeat(64),
              },
            }
          : {}),
      })
    }
    await runs.writeRun(workspace, run, auth)
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    runStoreFaults.pauseFor = (path) => path.includes(run.id)
    runStoreFaults.pauseNextWrite = barrier
    const closing = host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(() => runStoreFaults.pauseNextWrite === undefined, 90000)
    await host.emit('agent/disposed', { agent: host.agent })
    // A recreated agent clears the fence; the captured session generation must
    // still reject the in-flight completion.
    await host.emit('agent/created', { agent: host.agent })
    release()
    await closing
    const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
    // The stale completion must not land: either the disposal interrupted the
    // run or the completion was rejected. A completed run or a receipt would be
    // the bug this guards.
    expect(settled?.status).not.toBe('completed')
    await expect(
      readFile(join(workspace, '.dsh', 'workflows', 'receipts', 'auth.json'), 'utf8'),
    ).rejects.toThrow()
  }, 90000)

  it('keeps an explicit cancel terminal when a disposal overlaps it', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let run = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth', taskId: '0123456789abcdef' },
      steps: ['start-review', 'await-review', 'complete-review'],
      now: 1_000,
    })
    run = runs.setRunStatus(run, 'blocked', 1_001)
    await runs.writeRun(workspace, run, auth)
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    runStoreFaults.pauseNextWrite = barrier
    void host.emit('agent/disposed', { agent: host.agent })
    await waitFor(() => runStoreFaults.pauseNextWrite === undefined, 90000)
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    const cancelling = tool?.execute({ action: 'cancel', runId: run.id }, { agent: host.agent })
    release()
    await cancelling
    const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.status).toBe('cancelled')
  }, 90000)

  it('starts a fresh run for a restored task even when another task key was seen', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 A\n- [ ] 1.2 B\n', 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const reviewRuns = async (): Promise<
      Array<{ id: string; status: string; context: Record<string, unknown> }>
    > =>
      (await runs.listAuthenticatedRuns(workspace, auth))
        .filter((entry) => entry.definition.id === 'task-review')
        .map((entry) => ({ id: entry.id, status: entry.status, context: entry.context }))
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [ ] 1.2 B\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length === 1)
    const runA = (await reviewRuns()).find((entry) => entry.context.taskId === taskIdOf('A'))
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length === 2)
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    host.fireFs()
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, runA?.id ?? 'missing', auth))?.status ===
        'cancelled',
    )
    // Let the watcher flush the uncheck window before restoring the same bytes.
    await new Promise((resolve) => setTimeout(resolve, 500))
    // The restored file matches the earlier both-checked content key, but the
    // newly checked task A must still reach the per-task live-run guard.
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length >= 3)
    const restored = (await reviewRuns()).filter(
      (entry) => entry.id !== runA?.id && entry.context.taskId === taskIdOf('A'),
    )
    expect(restored).toHaveLength(1)
    expect(restored[0]?.status).toBe('running')
  })

  it('starts a fresh run after tasks.md was deleted and restored', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const reviewRuns = async (): Promise<
      Array<{ id: string; status: string; context: Record<string, unknown> }>
    > =>
      (await runs.listAuthenticatedRuns(workspace, auth))
        .filter((entry) => entry.definition.id === 'task-review')
        .map((entry) => ({ id: entry.id, status: entry.status, context: entry.context }))
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length === 1)
    const first = (await reviewRuns())[0]
    // Delete without delivering the watcher notification: only the close-time
    // supersession can reset the checked-task baseline.
    await rm(join(changeDir, 'tasks.md'), { force: true })
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, first?.id ?? 'missing', auth))?.status ===
        'cancelled',
    )
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length === 2)
    const restored = (await reviewRuns()).find(
      (entry) => entry.id !== first?.id && entry.context.taskId === taskIdOf('Task'),
    )
    expect(restored).toBeDefined()
    expect(restored?.status).toBe('running')
  })

  it('keeps an interrupted run when a disposal races the tool resume', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let run = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth', taskId: '0123456789abcdef' },
      steps: ['start-review', 'await-review'],
      now: 1_000,
    })
    run = runs.setRunStatus(run, 'interrupted', 1_001)
    await runs.writeRun(workspace, run, auth)
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    runStoreFaults.pauseFor = (path) => path.includes(run.id)
    runStoreFaults.pauseNextWrite = barrier
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    const resuming = tool?.execute({ action: 'resume', runId: run.id }, { agent: host.agent }).then(
      () => 'ok',
      (error: unknown) => error,
    )
    await waitFor(() => runStoreFaults.pauseNextWrite === undefined)
    await host.emit('agent/disposed', { agent: host.agent })
    release()
    expect(await resuming).toBeInstanceOf(Error)
    const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.status).toBe('interrupted')
    expect(settled?.steps.find((step) => step.id === 'start-review')?.state).toBe('open')
  }, 90000)

  it('keeps an interrupted run when a disposal races the command resume', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let run = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth', taskId: '0123456789abcdef' },
      steps: ['start-review', 'await-review'],
      now: 1_000,
    })
    run = runs.setRunStatus(run, 'interrupted', 1_001)
    await runs.writeRun(workspace, run, auth)
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    if (command === undefined) return
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    runStoreFaults.pauseFor = (path) => path.includes(run.id)
    runStoreFaults.pauseNextWrite = barrier
    const resuming = command.handler({
      agent: host.agent,
      commandId: 'cmd-resume',
      rawInput: ` resume ${run.id}`,
      attachments: [],
      signal: new AbortController().signal,
    })
    await waitFor(() => runStoreFaults.pauseNextWrite === undefined)
    await host.emit('agent/disposed', { agent: host.agent })
    release()
    const result = await resuming
    expect(result.kind).toBe('error')
    const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.status).toBe('interrupted')
    expect(settled?.steps.find((step) => step.id === 'start-review')?.state).toBe('open')
  }, 90000)

  it('keeps an intake resumed through the pre-execute gate running', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const run = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: [
        'requirements',
        'architecture',
        'interface',
        'create-change',
        'spec',
        'spec-review',
        'approval',
      ],
      now: 1_000,
    })
    await runs.writeRun(workspace, run, auth)
    await host.emit('agent/disposed', { agent: host.agent })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, run.id, auth))?.status === 'interrupted',
    )
    await host.emit('agent/created', { agent: host.agent })
    await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'call-intake',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => ({ kind: 'continue' }),
    )
    const resumed = await runs.readAuthenticatedRun(workspace, run.id, auth)
    expect(resumed?.status).toBe('running')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const advanced = await runs.readAuthenticatedRun(workspace, run.id, auth)
    expect(advanced?.status).toBe('running')
  })
})

describe('workflows tool live wiring', () => {
  it('registers the seven actions and verifies observed evidence through the real tool', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          parameters?: { properties?: { action?: { enum?: string[] } } }
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    expect(tool).toBeDefined()
    expect(tool?.parameters?.properties?.action?.enum).toEqual([
      'list',
      'start',
      'resume',
      'status',
      'evidence',
      'cancel',
      'adopt',
    ])
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
    expect(intake).toBeDefined()
    if (intake === undefined || tool === undefined) return
    const base = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: intake.steps.map((step) => step.id),
      id: 'run-tool-evidence',
      now: 1_000,
    })
    const run = {
      ...base,
      steps: base.steps.map((step) => {
        if (step.id === 'spec') return { ...step, requestedAt: 1_000 }
        if (step.id === 'approval') {
          return { ...step, state: 'done' as const, evidence: { kind: 'human', answer: 'yes' } }
        }
        return step
      }),
    }
    await runs.writeRun(workspace, run, auth)
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    for (const [file, text] of [
      ['.openspec.yaml', 'version: 1\n'],
      ['proposal.md', '# proposal\n'],
      ['design.md', '# design\n'],
      ['tasks.md', '- [ ] 1.1 Task\n'],
      ['specs/auth/spec.md', '# spec\n'],
    ] as const) {
      await mkdir(dirname(join(changeDir, file)), { recursive: true })
      await writeFile(join(changeDir, file), text, 'utf8')
    }
    const shell = async (callId: string, command: string): Promise<unknown> =>
      host.emit(
        'tools/result',
        { agent: host.agent, callId, name: 'pwsh', arguments: { command } },
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
    await shell('call-create', 'openspec new change auth')
    await shell('call-validate', 'openspec validate auth --strict')
    const evidence = (stepId: string, kind: string, ref: string): Promise<{ text: string }> =>
      tool.execute(
        { action: 'evidence', runId: 'run-tool-evidence', stepId, evidence: { kind, ref } },
        { agent: host.agent },
      )
    expect((await evidence('create-change', 'all', 'call-create')).text).toContain('verified')
    expect((await evidence('spec', 'all', 'call-validate')).text).toContain('verified')
    expect((await evidence('approval', 'human', 'yes')).text).toContain('verified')
    await expect(evidence('create-change', 'all', 'other-call')).rejects.toThrow(
      /not the host-verified evidence/u,
    )
  })
})

describe('unapproved active definitions', () => {
  it('starts runs only for the approved definition after reload', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { validateDefinition } = await import('../src/host/definitions.ts')
    const raw = {
      v: 1,
      id: 'active-demo',
      name: 'Active demo',
      version: 1,
      trigger: {
        kind: 'fs.change',
        match: { path: 'openspec/changes/**' },
        mode: 'active',
        dedupe: 'path+content-hash',
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
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
        },
      ],
    }
    // The fixture itself must be valid, or the zero-run check proves nothing.
    expect(validateDefinition(raw).id).toBe('active-demo')
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const changeDirFor = async (workspace: string): Promise<string> => {
      const changeDir = join(workspace, 'openspec', 'changes', 'auth')
      await mkdir(changeDir, { recursive: true })
      await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
      return changeDir
    }
    const fireChange = async (
      _workspace: string,
      host: ReturnType<typeof fakeHost>,
      changeDir: string,
    ): Promise<void> => {
      const applyHost = (): void => {
        apply(host.ctx as never)
      }
      applyHost()
      await new Promise((resolve) => setTimeout(resolve, 150))
      await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
      host.fireFs()
    }

    // A raw local file without an approval is never loaded.
    const unapproved = await tempWorkspace()
    await mkdir(join(unapproved, '.dsh', 'workflows', 'definitions'), { recursive: true })
    await writeFile(
      join(unapproved, '.dsh', 'workflows', 'definitions', 'active-demo.json'),
      JSON.stringify(raw),
      'utf8',
    )
    const unapprovedChange = await changeDirFor(unapproved)
    const unapprovedHost = fakeHost(unapproved)
    await fireChange(unapproved, unapprovedHost, unapprovedChange)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(
      (await runs.listAuthenticatedRuns(unapproved, auth)).filter(
        (entry) => entry.definition.id === 'active-demo',
      ),
    ).toHaveLength(0)

    // The same definition, installed and approved, starts a run for the event.
    const approved = await tempWorkspace()
    const source = join(approved, 'active-demo.json')
    await writeFile(source, JSON.stringify(raw), 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    await installDefinition(approved, source, auth)
    const approvedChange = await changeDirFor(approved)
    const approvedHost = fakeHost(approved)
    await fireChange(approved, approvedHost, approvedChange)
    await waitFor(async () =>
      (await runs.listAuthenticatedRuns(approved, auth)).some(
        (entry) => entry.definition.id === 'active-demo',
      ),
    )
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

describe('user-clicked archive authorization', () => {
  /** Write a complete change with a current whole-spec PASS and optional portable coverage. */
  async function completeChange(
    workspace: string,
    options: { readonly portable?: boolean } = {},
  ): Promise<void> {
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    for (const file of ['proposal.md', 'design.md']) {
      await writeFile(join(change, file), '# artifact\n', 'utf8')
    }
    await writeFile(join(change, 'tasks.md'), '- [x] 1.1 Complete work\n', 'utf8')
    await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# spec\n', 'utf8')
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const digest = await currentSpecDigest(workspace, 'auth')
    const record = join(workspace, '.dsh', 'delegation', 'spec-review', 'auth')
    await mkdir(record, { recursive: true })
    await writeFile(
      join(record, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    if (options.portable !== true) return
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const id = taskIdOf('Complete work')
    await mkdir(join(change, 'reviews'), { recursive: true })
    await writeFile(
      join(change, 'reviews', `${id}.json`),
      `${JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId: id, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], target: { provider: 'codex-subagent' }, time: '2026-11-08T00:00:00.000Z' })}\n`,
      'utf8',
    )
  }

  type Gate = {
    authorizeAndCheck(
      workspace: string,
      change: string,
    ): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>
  }

  function serviceOf(host: ReturnType<typeof fakeHost>): Gate {
    const service = (host.ctx.get as (name: string) => unknown)('workflowsArchiveGate') as
      | Gate
      | undefined
    if (service === undefined) throw new Error('the archive gate service was not provided')
    return service
  }

  it('writes the host-signed receipt for a verified click and returns ok', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    await completeChange(workspace, { portable: true })
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    const result = await serviceOf(host).authorizeAndCheck(workspace, 'auth')
    expect(result).toEqual({ ok: true })
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const receipts = await import('../src/host/receipts.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    expect(await receipts.readReceipt(workspace, 'auth', auth)).toMatchObject({
      kind: 'adoption',
      change: 'auth',
    })
  })

  it('refuses a click without the current PASS record or with an open run step', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const receipts = await import('../src/host/receipts.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))

    const missing = await tempWorkspace()
    await completeChange(missing)
    await rm(join(missing, '.dsh', 'delegation', 'spec-review', 'auth', 'spec.json'))
    const missingHost = fakeHost(missing)
    apply(missingHost.ctx as never)
    const missingResult = await serviceOf(missingHost).authorizeAndCheck(missing, 'auth')
    expect(missingResult.ok).toBe(false)
    if (missingResult.ok) return
    expect(missingResult.reason).toMatch(/cannot be adopted|whole-spec/u)
    expect(await receipts.readReceipt(missing, 'auth', auth)).toBeUndefined()

    const blocked = await tempWorkspace()
    await completeChange(blocked, { portable: true })
    const runs = await import('../src/host/runs.ts')
    await runs.writeRun(
      blocked,
      runs.createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace: blocked,
        context: { name: 'auth' },
        steps: ['requirements', 'spec'],
        id: 'run-open-click',
        now: 2_000,
      }),
      auth,
    )
    const blockedHost = fakeHost(blocked)
    apply(blockedHost.ctx as never)
    const blockedResult = await serviceOf(blockedHost).authorizeAndCheck(blocked, 'auth')
    expect(blockedResult.ok).toBe(false)
    if (blockedResult.ok) return
    expect(blockedResult.reason).toMatch(/run "run-open-click" step "requirements" is open/u)
    // The click receipt is written before the gate refuses; it binds the digest.
    expect(await receipts.readReceipt(blocked, 'auth', auth)).toMatchObject({ kind: 'adoption' })
  })

  it('refuses a click when a checked task has no portable PASS', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    await completeChange(workspace)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    const result = await serviceOf(host).authorizeAndCheck(workspace, 'auth')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/portable task-review PASS/u)
  })

  it('enforces the marker rule on a clicked archive while the shipped rule is deferred', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { authorizeUserArchive } = await import('../src/host/archive-authorization.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const marker = `${JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' })}\n`

    // No definitions are passed: the shipped rule is treated as deferred and
    // the marker alone turns the portable check on.
    const workspace = await tempWorkspace()
    await completeChange(workspace)
    await writeFile(join(workspace, 'openspec', 'review-approval.json'), marker, 'utf8')
    const refused = await authorizeUserArchive(workspace, 'auth', auth, [])
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.reason).toMatch(/portable task-review PASS/u)

    const id = taskIdOf('Complete work')
    await mkdir(join(workspace, 'openspec', 'changes', 'auth', 'reviews'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'auth', 'reviews', `${id}.json`),
      `${JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId: id, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], target: { provider: 'codex-subagent' }, time: '2026-11-08T00:00:00.000Z' })}\n`,
      'utf8',
    )
    expect(await authorizeUserArchive(workspace, 'auth', auth, [])).toEqual({ ok: true })

    // A marker with the archive gate off does not add the check.
    const off = await tempWorkspace()
    await completeChange(off)
    await writeFile(
      join(off, 'openspec', 'review-approval.json'),
      `${JSON.stringify({ version: 1, archiveGate: false, taskRule: 'task-review' })}\n`,
      'utf8',
    )
    expect(await authorizeUserArchive(off, 'auth', auth, [])).toEqual({ ok: true })

    // A malformed marker refuses instead of silently skipping the check.
    const malformed = await tempWorkspace()
    await completeChange(malformed)
    await writeFile(join(malformed, 'openspec', 'review-approval.json'), '{ not json', 'utf8')
    const invalid = await authorizeUserArchive(malformed, 'auth', auth, [])
    expect(invalid.ok).toBe(false)
    if (invalid.ok) return
    expect(invalid.reason).toMatch(/review-approval\.json/u)
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

describe('archive separator bypass', () => {
  it('refuses an archive invocation behind a shell separator or a cd compound', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    for (const command of [
      'cd foo; openspec archive auth',
      'git status && openspec archive auth',
      'cd foo || openspec archive auth',
      'cd foo\nopenspec archive auth',
      'cd foo;rtk openspec archive auth',
      'git status; openspec "archive" auth',
      'git status; & "openspec" archive auth',
      'Write-Output "it\'s ready"; openspec archive auth',
      'git status; pnpm exec openspec archive auth',
      'pnpm exec openspec archive auth; git status',
    ]) {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: 'archive-separator',
          name: 'pwsh',
          arguments: { command },
        },
        async () => {
          nextCalled = true
          return { kind: 'continue' }
        },
      )) as { kind?: string; reason?: string } | undefined
      expect(decision?.kind, command).toBe('deny')
      expect(decision?.reason, command).toMatch(/could not be parsed safely/u)
      expect(nextCalled, command).toBe(false)
    }
  })

  it('allows a benign compound command without an archive invocation', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    for (const command of [
      'cd foo && git status',
      'cd .; mv docs/a.md docs/b.md',
      'cd openspec/changes; mv auth auth-copy',
      'git status; git mv docs/archive docs/history',
      'Write-Output archive; mv docs/a.md docs/b.md',
      'git status -- openspec/changes/archive; git mv docs/a.md docs/b.md',
      'git status; Write-Output "Run openspec archive auth after review"',
      'git status; Write-Output "Run; openspec archive auth after review"',
    ]) {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: 'benign-compound',
          name: 'pwsh',
          arguments: { command },
        },
        async () => {
          nextCalled = true
          return { kind: 'continue' }
        },
      )) as { kind?: string } | undefined
      expect(decision?.kind, command).toBe('continue')
      expect(nextCalled, command).toBe(true)
    }
  })

  it('refuses an unparseable archive move with a quoted or compound destination', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    for (const [index, command] of [
      'cd .; mv openspec/changes/y openspec/changes/archive; pwd',
      'git status; git mv openspec/changes/auth "openspec/changes/archive"',
      'git status; mv openspec/changes/auth openspec/changes/archive; git status',
      'git status; Move-Item openspec/changes/auth "openspec/changes/archive"',
    ].entries()) {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: `archive-move-bypass-${String(index)}`,
          name: 'pwsh',
          arguments: { command },
        },
        async () => {
          nextCalled = true
          return { kind: 'continue' }
        },
      )) as { kind?: string; reason?: string } | undefined
      expect(decision?.kind, command).toBe('deny')
      expect(decision?.reason, command).toMatch(/the archive move could not be parsed safely/u)
      expect(nextCalled, command).toBe(false)
    }
    // From a shell workdir of openspec/changes, a move into a relative
    // `archive/<name>` descendant is still an archive move.
    for (const [index, command] of [
      'git status; mv auth archive/2026-11-11-auth',
      'git status; mv auth "archive/2026-11-11-auth"',
      'git status; mv auth ./archive/2026-11-11-auth',
      'git status; Move-Item auth ".\\archive\\2026-11-11-auth"',
    ].entries()) {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: `archive-relative-bypass-${String(index)}`,
          name: 'pwsh',
          arguments: { command, workdir: 'openspec/changes' },
        },
        async () => {
          nextCalled = true
          return { kind: 'continue' }
        },
      )) as { kind?: string; reason?: string } | undefined
      expect(decision?.kind, command).toBe('deny')
      expect(decision?.reason, command).toMatch(/the archive move could not be parsed safely/u)
      expect(nextCalled, command).toBe(false)
    }
    // A destination that reaches the archive directory through a different
    // workdir (or a `..` step) is still an archive move.
    for (const [index, [command, workdir]] of [
      ['git status; mv changes/auth changes/archive/2026-11-11-auth', 'openspec'],
      ['git status; mv auth ../changes/archive/2026-11-11-auth', 'openspec/changes'],
    ].entries()) {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: `archive-updir-bypass-${String(index)}`,
          name: 'pwsh',
          arguments: { command, workdir },
        },
        async () => {
          nextCalled = true
          return { kind: 'continue' }
        },
      )) as { kind?: string; reason?: string } | undefined
      expect(decision?.kind, command).toBe('deny')
      expect(decision?.reason, command).toMatch(/the archive move could not be parsed safely/u)
      expect(nextCalled, command).toBe(false)
    }
    // A `cd` inside the compound command, and a `.` segment in the destination,
    // are normalized to the same archive directory.
    for (const [index, command] of [
      'cd openspec/changes; mv auth archive/',
      'git status; mv openspec/changes/auth openspec/changes/./archive/',
      'git status; Move-Item openspec/changes/auth openspec/changes/ARCHIVE',
      'cd missing-directory || mv openspec/changes/auth openspec/changes/archive',
      'git status; Move-Item -Destination:openspec/changes/archive -Path openspec/changes/auth',
      'cd missing-directory; cd openspec/changes; mv auth archive/',
      'git status; Move-Item\topenspec/changes/auth openspec/changes/archive',
      'cd openspec/changes; (Move-Item -Path auth -Destination:archive)',
      'git status; Move-Item openspec/changes/auth openspec/changes/archive > $null',
      'git status; ( Move-Item openspec/changes/auth openspec/changes/archive )',
      'git status; Move-Item openspec/changes/auth openspec/changes/archive > $null 2>&1',
      'git status; ( Move-Item openspec/changes/auth openspec/changes/archive ) > $null',
      'git status; & Move-Item openspec\\changes\\auth "openspec\\changes\\archive"',
      'cd -Path openspec/changes; Move-Item auth archive',
      'git status; & "Move-Item" openspec/changes/auth "openspec/changes/archive"',
      'cd -LiteralPath:openspec/changes; Move-Item auth archive',
      'git status; git "mv" openspec/changes/auth "openspec/changes/archive"',
      'git status; Move-Item -LiteralPath openspec/changes/auth -Destination "openspec/changes/archive" -InformationVariable moveLog',
      'git status; mv -t openspec/changes/archive/ openspec/changes/auth',
      'git status; mv --target-directory=openspec/changes/archive/ openspec/changes/auth',
      'git status; git mv openspec/changes/auth -f openspec/changes/archive/',
    ].entries()) {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: `archive-cd-bypass-${String(index)}`,
          name: 'pwsh',
          arguments: { command },
        },
        async () => {
          nextCalled = true
          return { kind: 'continue' }
        },
      )) as { kind?: string; reason?: string } | undefined
      expect(decision?.kind, command).toBe('deny')
      expect(decision?.reason, command).toMatch(/the archive move could not be parsed safely/u)
      expect(nextCalled, command).toBe(false)
    }
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
