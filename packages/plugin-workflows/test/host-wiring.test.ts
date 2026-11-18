import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
import { auditActive } from '../../../scripts/reviews-check.ts'
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
  recordWriteFile: undefined as string | undefined,
  pauseNextWrite: undefined as Promise<void> | undefined,
  pauseFor: undefined as ((path: string) => boolean) | undefined,
  pauseNextRead: undefined as Promise<void> | undefined,
  pauseReadFor: undefined as ((path: string) => boolean) | undefined,
  onReadPaused: undefined as (() => void) | undefined,
  /** A test-only pause inside a record target's path resolution. */
  pauseNextTarget: undefined as Promise<void> | undefined,
  pauseTargetFor: undefined as ((path: string) => boolean) | undefined,
  onTargetPaused: undefined as (() => void) | undefined,
  /** The message a synchronous run-store write throws; `undefined` passes through. */
  syncWriteFile: undefined as string | undefined,
}))

// `writeRunSync` persists a run with the synchronous fs API, so the async
// run-store faults above cannot reach an observational start; this seam makes
// that real failure path testable.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    writeFileSync: ((...args: Parameters<typeof actual.writeFileSync>) => {
      const target = String(args[0]).replaceAll('\\', '/')
      if (
        runStoreFaults.syncWriteFile !== undefined &&
        target.includes('/workflows/runs/') &&
        target.endsWith('.tmp')
      ) {
        throw new Error(runStoreFaults.syncWriteFile)
      }
      return actual.writeFileSync(...args)
    }) as typeof actual.writeFileSync,
  }
})

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
    lstat: (async (...args: Parameters<typeof actual.lstat>) => {
      const target = String(args[0]).replaceAll('\\', '/')
      if (
        runStoreFaults.pauseNextTarget !== undefined &&
        (runStoreFaults.pauseTargetFor === undefined || runStoreFaults.pauseTargetFor(target))
      ) {
        const wait = runStoreFaults.pauseNextTarget
        runStoreFaults.pauseNextTarget = undefined
        runStoreFaults.onTargetPaused?.()
        await wait
      }
      return actual.lstat(...args)
    }) as typeof actual.lstat,
    readFile: (async (...args: Parameters<typeof actual.readFile>) => {
      const target = String(args[0]).replaceAll('\\', '/')
      if (
        runStoreFaults.pauseNextRead !== undefined &&
        (runStoreFaults.pauseReadFor === undefined || runStoreFaults.pauseReadFor(target))
      ) {
        const wait = runStoreFaults.pauseNextRead
        runStoreFaults.pauseNextRead = undefined
        runStoreFaults.onReadPaused?.()
        await wait
      }
      return actual.readFile(...args)
    }) as typeof actual.readFile,
    writeFile: (async (...args: Parameters<typeof actual.writeFile>) => {
      const target = String(args[0]).replaceAll('\\', '/')
      if (runStoreFaults.recordWriteFile !== undefined && target.includes('/workflows/records/')) {
        return reject(runStoreFaults.recordWriteFile)
      }
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
  parityMock.active = false
  parityMock.report = undefined
  parityMock.error = undefined
  parityMock.path = undefined
  runStoreFaults.readdir = undefined
  runStoreFaults.stat = undefined
  runStoreFaults.writeFile = undefined
  runStoreFaults.recordWriteFile = undefined
  runStoreFaults.pauseNextWrite = undefined
  runStoreFaults.pauseFor = undefined
  runStoreFaults.pauseNextRead = undefined
  runStoreFaults.pauseReadFor = undefined
  runStoreFaults.onReadPaused = undefined
  runStoreFaults.pauseNextTarget = undefined
  runStoreFaults.pauseTargetFor = undefined
  runStoreFaults.onTargetPaused = undefined
  runStoreFaults.syncWriteFile = undefined
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
    /** Default true: the retained whole-spec signal; false restores the owned step. */
    readonly specReview?: boolean
    /** Default true: the retained progress/lane signals; false restores the engine gates. */
    readonly taskProgress?: boolean
    readonly laneFanout?: boolean
    /** Default false: the task-review rule is owned by the engine. */
    readonly workflowOwned?: boolean
    readonly delegateBarrier?: Promise<void>
    readonly subagents?: unknown
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
  /** Message ids the gates removed from the inbox on a stop. */
  readonly removed: readonly string[]
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
  const removed: string[] = []
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
    inbox: {
      remove: (id: unknown) => {
        removed.push(String(id))
        return true
      },
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
      // spec-review, progress, and lane signals follow their switches.
      if (name === 'delegationRulesStatus') {
        return {
          workflowOwned: options.workflowOwned ?? false,
          specReview: options.specReview ?? true,
          taskProgress: options.taskProgress ?? true,
          laneFanout: options.laneFanout ?? true,
        }
      }
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
      if (name === 'subagents') return options.subagents
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
    removed,
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
    const failedReport = structuredClone(report) as {
      gates: Record<string, { status: string }>
      retained: Record<string, { replayed: number; status: string }>
    }
    for (const gate of Object.values(failedReport.gates)) gate.status = 'fail'
    for (const retained of Object.values(failedReport.retained)) retained.status = 'failed'
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
      expect(definitions).not.toContain('spec-review')
      expect(definitions).not.toContain('integration-review')
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
  it('counts only successful writes and started workers', async () => {
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

    // Three reads plus a started worker is a worker: one run.
    await emitTurn(2, [
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'read', args: {} },
      { name: 'subagent', args: {}, text: 'worker started' },
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
    // The records appear after the units started, so each run settles its review
    // step from the matching record instead of dispatching a reviewer.
    for (const taskId of taskIds) {
      await writeFile(
        join(changeDir, 'reviews', `${taskId}.json`),
        `${JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
        'utf8',
      )
      await mkdir(join(workspace, '.dsh', 'workflows', 'records', 'task-review', 'auth', 'tasks'), {
        recursive: true,
      })
      await writeFile(
        join(
          workspace,
          '.dsh',
          'workflows',
          'records',
          'task-review',
          'auth',
          'tasks',
          `${taskId}.json`,
        ),
        `${JSON.stringify({ rule: 'task-review', change: 'auth', phase: 'task', scope: 'task', taskId, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
        'utf8',
      )
    }
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

  it('keeps one review for repeated task text across two sections', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    const plan = (box: string): string =>
      `# Tasks\n\n## 1. Engine\n\n- [${box}] 1.1 Run tests\n- [${box}] 1.2 Implement engine\n\n## 2. Docs\n\n- [${box}] 2.1 Run tests\n`
    await writeFile(join(changeDir, 'tasks.md'), plan(' '), 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await writeFile(join(changeDir, 'tasks.md'), plan('x'), 'utf8')
    host.fireFs()
    const reviewRuns = async (): Promise<Array<{ id: string; context: Record<string, unknown> }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth))
        .filter((entry) => entry.definition.id === 'task-review')
        .map((entry) => ({ id: entry.id, context: entry.context }))
    await waitFor(async () => (await reviewRuns()).length >= 1)
    // Give the overlapping per-task start the chance to appear.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const created = await reviewRuns()
    // The section unit covers both engine tasks; the docs task has the same
    // text, so its task id is already covered by that section run.
    expect(created).toHaveLength(1)
    expect(created[0]?.context.section).toBe('1')
    expect(created[0]?.context.taskIds).toHaveLength(2)
  })

  it('delivers every due lane unit with its covered tasks and live run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    // Six due lanes with ten checked tasks and one live run per lane: the
    // delivered status must name every lane's covered tasks, missing tasks, and
    // live run, beyond the old 1200-character delivery bound.
    const counts = [12, 12, 12, 12, 12, 12]
    const sections = counts.map((count, index) => {
      const n = index + 1
      const tasks = Array.from(
        { length: count },
        (_, task) =>
          `- [x] ${String(n)}.${String(task + 1)} Work of lane ${String(n)} task ${String(task + 1)}`,
      )
      return `## ${String(n)}. Lane ${String(n)} (lane ${String(n)}, owns \`packages/plugin-workflows/src/host/lane-${String(n)}.ts\`)\n\n${tasks.join('\n')}\n`
    })
    await writeFile(join(changeDir, 'tasks.md'), `# Tasks\n\n${sections.join('\n')}`, 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const command = host.commands.find((entry) => entry.name === 'workflows') as
      | { handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }> }
      | undefined
    expect(command).toBeDefined()
    const status = async (): Promise<string> =>
      (
        await command?.handler({
          agent: host.agent,
          commandId: 'cmd-status',
          rawInput: ' status',
          attachments: [],
          signal: new AbortController().signal,
        })
      )?.text ?? ''
    const due = await status()
    for (let n = 1; n <= 6; n += 1) {
      expect(due).toContain(`change "auth" section "${String(n)}": covered ${String(n)}.1`)
    }
    // One live run per lane covers its whole checked task set.
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const live = new Map<number, string>()
    for (let n = 1; n <= 6; n += 1) {
      const count = counts[n - 1] ?? 1
      const created = runs.createRun({
        definition: 'task-review',
        trigger: 'fs.change',
        session: 'session-1',
        workspace,
        context: {
          name: 'auth',
          taskId: `section-${String(n)}`,
          section: String(n),
          sectionTitle: `${String(n)}. Lane ${String(n)}`,
          taskIds: Array.from({ length: count }, (_, task) =>
            taskIdOf(`Work of lane ${String(n)} task ${String(task + 1)}`),
          ),
        },
        steps: ['review', 'complete-review'],
        now: 1_000,
      })
      await runs.writeRun(workspace, created, auth)
      live.set(n, created.id)
    }
    const delivered = await status()
    expect(delivered.length).toBeGreaterThan(1200)
    for (let n = 1; n <= 6; n += 1) {
      expect(delivered).toContain(`section "${String(n)}": covered ${String(n)}.1`)
      expect(delivered).toContain(`live run "${live.get(n) ?? ''}" covers it`)
    }
  })

  it('starts one section run for two missing tasks and no per-task run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    const plan = (box: string): string =>
      `# Tasks\n\n## 1. Engine (lane 1, owns \`src/**\`)\n\n- [${box}] 1.1 First task\n- [${box}] 1.2 Second task\n`
    await writeFile(join(changeDir, 'tasks.md'), plan(' '), 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const runs = await import('../src/host/runs.ts')
    const { sectionRecordId, taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const taskIds = [taskIdOf('First task'), taskIdOf('Second task')]
    const reviewRuns = async (): Promise<Array<{ id: string; context: Record<string, unknown> }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth))
        .filter((entry) => entry.definition.id === 'task-review')
        .map((entry) => ({ id: entry.id, context: entry.context }))
    await writeFile(join(changeDir, 'tasks.md'), plan('x'), 'utf8')
    host.fireFs()
    await waitFor(async () => (await reviewRuns()).length >= 1)
    // Give a per-task start the chance to appear before asserting the one unit.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const created = await reviewRuns()
    expect(created).toHaveLength(1)
    expect(created[0]?.context).toMatchObject({
      name: 'auth',
      taskId: sectionRecordId('1'),
      section: '1',
      taskIds,
    })
    // The section record evidence path resolves to the section record id: with
    // no configured reviewer the step publishes its ERROR record there.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const recordPath = join(
      workspace,
      '.dsh',
      'workflows',
      'records',
      'task-review',
      'auth',
      'tasks',
      `${sectionRecordId('1')}.json`,
    )
    await waitFor(
      async () => (await readFile(recordPath, 'utf8').catch(() => undefined)) !== undefined,
    )
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
    expect(record).toMatchObject({
      rule: 'task-review',
      change: 'auth',
      scope: 'task',
      taskId: sectionRecordId('1'),
      section: '1',
      taskIds,
    })
    expect(record.verdict).toBe('ERROR')
  })

  it('starts the expanded lane unit when a pending section run covers part of it', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    const plan = (box: string): string =>
      `# Tasks\n\n## 1. Engine\n\n- [${box}] 1.1 First task\n- [${box}] 1.2 Second task\n- [${box}] 1.3 Third task\n`
    await writeFile(join(changeDir, 'tasks.md'), plan(' '), 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { sectionRecordId, taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const [first, second, third] = ['First task', 'Second task', 'Third task'].map(taskIdOf)
    // A section run covering the first two tasks was prepared before the third
    // was ticked: the expanded lane is due, starts on the same unit key, and the
    // provider serializes it behind the live predecessor's thread.
    const pending = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: {
        name: 'auth',
        taskId: sectionRecordId('1'),
        section: '1',
        sectionTitle: '1. Engine',
        taskIds: [first, second],
      },
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    await runs.writeRun(workspace, pending, auth)
    await writeFile(join(changeDir, 'tasks.md'), plan('x'), 'utf8')
    host.fireFs()
    const reviewRuns = async (): Promise<Array<{ id: string; context: Record<string, unknown> }>> =>
      (await runs.listAuthenticatedRuns(workspace, auth))
        .filter((entry) => entry.definition.id === 'task-review')
        .map((entry) => ({ id: entry.id, context: entry.context }))
    await waitFor(async () => (await reviewRuns()).some((run) => run.id !== pending.id))
    // Give a per-task start the chance to appear before asserting the lane unit.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const created = (await reviewRuns()).filter((run) => run.id !== pending.id)
    expect(created).toHaveLength(1)
    expect(created[0]?.context).toMatchObject({
      name: 'auth',
      taskId: sectionRecordId('1'),
      section: '1',
      taskIds: [first, second, third],
    })
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
      steps: ['review', 'complete-review'],
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

  it('resumes a failed task-review run and starts the native review again', async () => {
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
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    run = runs.settleStep(run, 'review', 'failed', {
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
    const reopened = afterResume?.steps.find((entry) => entry.id === 'review')
    expect(reopened?.state).toBe('open')
    expect(reopened?.attempts).toBe(0)
    expect(reopened?.evidence).toBeUndefined()
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.toolExecutions.filter((entry) => entry.name === 'delegate').length).toBe(0)
    const settled = await runs.readAuthenticatedRun(workspace, run.id, auth)
    expect(settled?.steps.find((entry) => entry.id === 'review')?.state).toBe('done')
    // The missing reviewer is an ERROR record, recorded at the native store and
    // never a PASS; the run then waits on the portable coverage step.
    const record = JSON.parse(
      await readFile(
        join(
          workspace,
          '.dsh',
          'workflows',
          'records',
          'task-review',
          'auth',
          'tasks',
          `${taskId}.json`,
        ),
        'utf8',
      ),
    ) as { verdict: string; failureClass: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.failureClass).toBe('config')
    expect(settled?.steps.find((entry) => entry.id === 'complete-review')?.state).toBe('open')
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

  it('clears a superseded dedupe key when an earlier run owns the close', async () => {
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
    // Run A closes from its ERROR record without a steer; B is still superseded
    // and forgotten, so the restored identical bytes start a fresh run.
    await waitFor(
      async () =>
        (await runs.listAuthenticatedRuns(workspace, auth)).find((entry) => entry.id === runB?.id)
          ?.status === 'cancelled',
    )
    const runA = (await reviewRuns()).find((entry) => entry.context.taskId === taskIdOf('A'))
    expect(runA?.status).toBe('completed')
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    host.fireFs()
    // The cleared key and baseline start a fresh run for the restored task.
    // A's ERROR record is not coverage either, so the same restore starts its
    // next round too; only a PASS clears a task.
    await waitFor(async () => (await reviewRuns()).length === 4)
    const restored = (await reviewRuns()).filter(
      (entry) => entry.id !== runA?.id && entry.id !== runB?.id,
    )
    expect(restored.map((entry) => entry.context.taskId).sort()).toEqual(
      [taskIdOf('A'), taskIdOf('B')].sort(),
    )
    expect(restored.every((entry) => entry.status === 'running')).toBe(true)
  })

  // A tool step that waits in the advance before any run write: the disposal
  // and resume race the stale persistence without deadlocking the run lock.
  function fenceDefinition(): Record<string, unknown> {
    return {
      v: 1,
      id: 'fence-probe',
      name: 'Fence probe',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'turn' },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
        allowTools: ['delegate'],
      },
      steps: [
        {
          id: 'dispatch',
          title: 'Dispatch the probe',
          executor: 'tool',
          tool: { name: 'delegate', args: { rule: 'probe' } },
          evidence: { kind: 'tool', name: 'delegate' },
          next: 'confirm',
          blockTurnClose: true,
        },
        {
          id: 'confirm',
          title: 'Confirm the probe',
          executor: 'main',
          prompt: 'Write out.md.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
  }

  function fenceRun(
    runs: typeof import('../src/host/runs.ts'),
    workspace: string,
    now: number,
    steps: readonly { readonly id: string; readonly state?: 'done' | 'failed' }[] = [],
  ): ReturnType<typeof import('../src/host/runs.ts').createRun> {
    let entry = runs.createRun({
      definition: 'fence-probe',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: {},
      steps: ['dispatch', 'confirm'],
      now,
    })
    for (const step of steps) {
      if (step.state === 'done') entry = runs.settleStep(entry, step.id, 'done', { at: now + 1 })
      if (step.state === 'failed') {
        entry = runs.settleStep(entry, step.id, 'failed', {
          at: now + 1,
          reason: 'tool call aborted',
          attempts: 2,
        })
      }
    }
    return entry
  }

  it('rejects a stale advance that would overwrite a resumed run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const unregister = definitionsRegistry.register({
      source: '@dsh-setup/test-fencing',
      definitions: [fenceDefinition()],
    })
    try {
      const host = fakeHost(workspace, { toolExecute: true, delegateBarrier: barrier })
      apply(host.ctx as never)
      await new Promise((resolve) => setTimeout(resolve, 200))
      const run = fenceRun(runs, workspace, 1_000)
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
      expect(settled?.steps.find((step) => step.id === 'dispatch')?.state).toBe('open')
    } finally {
      unregister()
      release()
    }
  })

  it('keeps a resumed earlier run when a later dispatch is pending', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const unregister = definitionsRegistry.register({
      source: '@dsh-setup/test-fencing',
      definitions: [fenceDefinition()],
    })
    try {
      const host = fakeHost(workspace, { toolExecute: true, delegateBarrier: barrier })
      apply(host.ctx as never)
      await new Promise((resolve) => setTimeout(resolve, 200))
      const runA = fenceRun(runs, workspace, 1_000, [{ id: 'dispatch', state: 'done' }])
      const runB = fenceRun(runs, workspace, 1_100)
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
      expect(settledA?.steps.find((step) => step.id === 'confirm')?.state).toBe('open')
      // The gate's cached write for the earlier run must not land after the resume.
      expect(settledA?.turnBlocks).toBeUndefined()
    } finally {
      unregister()
      release()
    }
  })

  it('keeps a resumed later run when an earlier dispatch is pending', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let release: () => void = () => undefined
    const barrier = new Promise<void>((resolve) => {
      release = resolve
    })
    const unregister = definitionsRegistry.register({
      source: '@dsh-setup/test-fencing',
      definitions: [fenceDefinition()],
    })
    try {
      const host = fakeHost(workspace, { toolExecute: true, delegateBarrier: barrier })
      apply(host.ctx as never)
      await new Promise((resolve) => setTimeout(resolve, 200))
      const runA = fenceRun(runs, workspace, 1_000)
      const runB = fenceRun(runs, workspace, 1_100, [{ id: 'dispatch', state: 'failed' }])
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
      const step = settledB?.steps.find((entry) => entry.id === 'dispatch')
      expect(step?.state).toBe('open')
      expect(step?.attempts).toBe(0)
    } finally {
      unregister()
      release()
    }
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
          steps: ['review', 'complete-review'],
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
    expect(settledB?.steps.find((entry) => entry.id === 'review')?.state).toBe('open')
  }, 90000)
})

describe('turn-close lane dispatch', () => {
  /** Two lane sections whose checked tasks have no current PASS. */
  const LANE_PLAN = `# Tasks

## 1. Engine (lane 1, owns \`src/**\`)

- [x] 1.1 First engine task
- [x] 1.2 Second engine task

## 2. Docs (lane 2, owns \`docs/**\`)

- [x] 2.1 Doc task
`

  async function laneWorkspace(): Promise<string> {
    const workspace = await tempWorkspace()
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(change, { recursive: true })
    await writeFile(join(change, 'proposal.md'), '# Proposal\n', 'utf8')
    await writeFile(join(change, 'tasks.md'), LANE_PLAN, 'utf8')
    return workspace
  }

  /** A successful change-artifact write; the close gates attribute the change. */
  async function establishInvolvement(host: ReturnType<typeof fakeHost>): Promise<void> {
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'involved-write',
        name: 'write',
        arguments: { file_path: 'openspec/changes/auth/design.md' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
  }

  async function taskRuns(
    workspace: string,
  ): Promise<
    Array<{ id: string; status: string; dedupeKey?: string; context: Record<string, unknown> }>
  > {
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    return (await runs.listAuthenticatedRuns(workspace, auth))
      .filter((entry) => entry.definition.id === 'task-review')
      .map((entry) => ({
        id: entry.id,
        status: entry.status,
        ...(entry.dedupeKey === undefined ? {} : { dedupeKey: entry.dedupeKey }),
        context: entry.context,
      }))
  }

  it('starts every due lane unit in one close without a tasks.md change', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await establishInvolvement(host)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    // No fs.change ever fired: the gate itself starts both lanes in one pass.
    await waitFor(async () => (await taskRuns(workspace)).length === 2)
    const created = await taskRuns(workspace)
    expect(created.map((run) => run.context.section).sort()).toEqual(['1', '2'])
    const engine = created.find((run) => run.context.section === '1')
    expect(engine?.context.taskIds).toEqual([
      taskIdOf('First engine task'),
      taskIdOf('Second engine task'),
    ])
    // A gate start bypasses the trigger's dedupe key instead of consuming it.
    expect(created.every((run) => run.dedupeKey === undefined)).toBe(true)
  })

  it('suppresses a unit a live run already covers', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { sectionRecordId, taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const pending = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: {
        name: 'auth',
        taskId: sectionRecordId('1'),
        section: '1',
        sectionTitle: '1. Engine (lane 1, owns `src/**`)',
        taskIds: [taskIdOf('First engine task'), taskIdOf('Second engine task')],
      },
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    await runs.writeRun(workspace, pending, auth)
    await establishInvolvement(host)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(async () => (await taskRuns(workspace)).length === 2)
    const created = (await taskRuns(workspace)).filter((run) => run.id !== pending.id)
    expect(created).toHaveLength(1)
    expect(created[0]?.context.section).toBe('2')
  })

  it('starts the next round for a unit a code fix left due', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(change, { recursive: true })
    await writeFile(join(change, 'proposal.md'), '# Proposal\n', 'utf8')
    await writeFile(
      join(change, 'tasks.md'),
      '# Tasks\n\n## 1. Engine (lane 1, owns `src/**`)\n\n- [x] 1.1 First engine task\n',
      'utf8',
    )
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { sectionRecordId, taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // A transport failure exhausted the previous round: the unit stays due, the
    // run is terminal and not live, and no tasks.md change marks the next round.
    let failed = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: {
        name: 'auth',
        taskId: sectionRecordId('1'),
        section: '1',
        sectionTitle: '1. Engine (lane 1, owns `src/**`)',
        taskIds: [taskIdOf('First engine task')],
      },
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    failed = runs.settleStep(failed, 'review', 'failed', {
      at: 1_001,
      reason: 'the review dispatch failed 3 time(s)',
      attempts: 3,
    })
    failed = runs.setRunStatus(failed, 'failed', 1_002, 'the review dispatch failed 3 time(s)')
    await runs.writeRun(workspace, failed, auth)
    await establishInvolvement(host)
    // The next turn only edits implementation files, never tasks.md; the due
    // lane must still start its round at that close.
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'code-fix',
        name: 'write',
        arguments: { file_path: 'src/engine.ts' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    await waitFor(async () => (await taskRuns(workspace)).length === 2)
    const created = (await taskRuns(workspace)).filter((run) => run.id !== failed.id)
    expect(created).toHaveLength(1)
    expect(created[0]?.context.section).toBe('1')
    expect(created[0]?.status).toBe('running')
  })

  it('starts the next round for a unit whose settled run belongs to an idle session', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { sectionRecordId, taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // A previous session settled FINDINGS on section 1 and is now idle: its
    // blocked step carries no live review, so it must not cover the lane for
    // this session's close.
    const settled = runs.settleStep(
      runs.createRun({
        definition: 'task-review',
        trigger: 'fs.change',
        session: 'session-2',
        workspace,
        context: {
          name: 'auth',
          taskId: sectionRecordId('1'),
          section: '1',
          sectionTitle: '1. Engine (lane 1, owns `src/**`)',
          taskIds: [taskIdOf('First engine task'), taskIdOf('Second engine task')],
        },
        steps: ['review', 'complete-review'],
        now: 1_000,
      }),
      'review',
      'blocked',
      { at: 1_001, reason: 'the review returned FINDINGS' },
    )
    await runs.writeRun(workspace, runs.setRunStatus(settled, 'blocked', 1_002), auth)
    await establishInvolvement(host)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await taskRuns(workspace)).some(
          (run) => run.id !== settled.id && run.context.section === '1',
        ),
      5_000,
    )
    const started = (await taskRuns(workspace)).find(
      (run) => run.id !== settled.id && run.context.section === '1',
    )
    expect(started?.status).toBe('running')
  })

  it('does not let an unstarted foreign open review suppress dispatch', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { sectionRecordId, taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // A foreign run whose review step is merely persisted open, with no live
    // reviewer: it must not cover the lane for this session's close.
    const foreign = runs.setRunStatus(
      runs.createRun({
        definition: 'task-review',
        trigger: 'fs.change',
        session: 'session-2',
        workspace,
        context: {
          name: 'auth',
          taskId: sectionRecordId('1'),
          section: '1',
          sectionTitle: '1. Engine (lane 1, owns `src/**`)',
          taskIds: [taskIdOf('First engine task'), taskIdOf('Second engine task')],
        },
        steps: ['review', 'complete-review'],
        now: 1_000,
      }),
      'running',
      1_001,
    )
    await runs.writeRun(workspace, foreign, auth)
    await establishInvolvement(host)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await taskRuns(workspace)).some(
          (run) => run.id !== foreign.id && run.context.section === '1',
        ),
      5_000,
    )
  })

  it('starts the full section run when a live run covers only a missing task', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const first = taskIdOf('First engine task')
    const second = taskIdOf('Second engine task')
    // 1.1 is approved; 1.2 is missing. The live run names only 1.2, so it does
    // not cover the section unit, whose single run must cover both tasks.
    await mkdir(join(workspace, '.dsh', 'workflows', 'records', 'task-review', 'auth', 'tasks'), {
      recursive: true,
    })
    await writeFile(
      join(
        workspace,
        '.dsh',
        'workflows',
        'records',
        'task-review',
        'auth',
        'tasks',
        `${first}.json`,
      ),
      `${JSON.stringify({ rule: 'task-review', change: 'auth', phase: 'task', scope: 'task', taskId: first, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    const partial = runs.setRunStatus(
      runs.createRun({
        definition: 'task-review',
        trigger: 'fs.change',
        session: 'session-1',
        workspace,
        context: { name: 'auth', taskId: second },
        steps: ['review', 'complete-review'],
        now: 1_000,
      }),
      'running',
      1_001,
    )
    await runs.writeRun(workspace, partial, auth)
    await establishInvolvement(host)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await taskRuns(workspace)).some(
          (run) => run.id !== partial.id && run.context.section === '1',
        ),
      5_000,
    )
    const started = (await taskRuns(workspace)).find(
      (run) => run.id !== partial.id && run.context.section === '1',
    )
    expect((started?.context.taskIds as string[] | undefined)?.sort()).toEqual(
      [first, second].sort(),
    )
  })

  it('starts the section run when only split per-task runs are live', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // Two per-task runs cover the section's tasks separately. An ordinary
    // section dispatches one run over all of them, so neither run covers it and
    // the union must not suppress the section start.
    for (const [id, taskId] of [
      ['run-split-a', taskIdOf('First engine task')],
      ['run-split-b', taskIdOf('Second engine task')],
    ] as const) {
      const run = runs.setRunStatus(
        runs.createRun({
          definition: 'task-review',
          trigger: 'fs.change',
          session: 'session-1',
          workspace,
          context: { name: 'auth', taskId },
          steps: ['review', 'complete-review'],
          id,
          now: 1_000,
        }),
        'running',
        1_001,
      )
      await runs.writeRun(workspace, run, auth)
    }
    await establishInvolvement(host)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await taskRuns(workspace)).some(
          (run) =>
            run.id !== 'run-split-a' && run.id !== 'run-split-b' && run.context.section === '1',
        ),
      5_000,
    )
  })

  it('abandons an aborted close without a steer or a review start', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await establishInvolvement(host)
    const controller = new AbortController()
    controller.abort()
    await host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    // Give a dispatch the chance to appear before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await taskRuns(workspace)).toHaveLength(0)
    expect(host.steers).toHaveLength(0)
  })

  it('revokes a submitted gate message when the turn aborts', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await establishInvolvement(host)
    const controller = new AbortController()
    await host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    // The refused close steers; a user stop then revokes exactly those messages
    // from the inbox, so no queued gate input resumes the stopped turn.
    await waitFor(async () => host.steers.length > 0)
    const submitted = host.steers.length
    controller.abort()
    expect(host.removed).toHaveLength(submitted)
  })

  it('recognizes the per-task fallback runs of an oversized section on the next close', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    // The section identity is over the 4096-byte run-context limit, so the
    // dispatch falls back to one run per checked task. The next close must see
    // the union of those live runs as the lane: no duplicate run starts.
    const title = `1. ${'Lane '.repeat(900)}`
    await writeFile(
      join(changeDir, 'tasks.md'),
      `# Tasks\n\n## ${title}\n\n- [x] 1.1 First task\n- [x] 1.2 Second task\n`,
      'utf8',
    )
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'lane')
    git('config', 'user.email', 'lane@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    const activations: string[] = []
    const runtime = {
      getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
      startActivation: async (spec: { prompt: { text: string }[] }) => {
        activations.push(spec.prompt.map((block) => block.text).join('\n'))
        return {
          childId: `child-${String(activations.length)}`,
          result: new Promise(() => undefined),
          dispose: async () => undefined,
        }
      },
    }
    const host = fakeHost(workspace, { subagents: runtime })
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await establishInvolvement(host)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const { taskIdOf } = await import('../src/host/tasks.ts')
    await waitFor(async () => (await taskRuns(workspace)).length === 2)
    const fallback = await taskRuns(workspace)
    expect(fallback.every((run) => run.context.section === undefined)).toBe(true)
    expect(fallback.map((run) => run.context.taskId).sort()).toEqual(
      [taskIdOf('First task'), taskIdOf('Second task')].sort(),
    )
    await new Promise((resolve) => setTimeout(resolve, 500))
    await waitFor(async () => activations.length >= 2, 10_000)
    // The second close sees the complete lane through the fallback runs and
    // waits for them instead of starting another 2 runs.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    expect(await taskRuns(workspace)).toHaveLength(2)
    expect(activations.filter((text) => text.includes('review:auth:task:')).length).toBe(2)
  })

  it('dispatches and persists no review when the stop lands during the advance', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'lane')
    git('config', 'user.email', 'lane@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    const activations: string[] = []
    const runtime = {
      getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
      startActivation: async (spec: { prompt: { text: string }[] }) => {
        activations.push(spec.prompt.map((block) => block.text).join('\n'))
        return {
          childId: `child-${String(activations.length)}`,
          result: new Promise(() => undefined),
          dispose: async () => undefined,
        }
      },
    }
    const host = fakeHost(workspace, { subagents: runtime })
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await establishInvolvement(host)
    // Hold the advance inside a frozen-snapshot artifact read, after the
    // checkout and its lease exist, abort the turn there, and let it continue:
    // the round must not record, start, or persist, and the abandoned snapshot
    // must be released instead of leaking to the stale sweep.
    let releaseRead: () => void = () => undefined
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let paused = (): void => undefined
    const pausedGate = new Promise<void>((resolve) => {
      paused = resolve
    })
    runStoreFaults.pauseNextRead = readGate
    runStoreFaults.onReadPaused = () => paused()
    runStoreFaults.pauseReadFor = (path) =>
      path.includes('/.dsh/workflows/snapshots/') && path.endsWith('/proposal.md')
    const controller = new AbortController()
    const closing = host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    await pausedGate
    const snapshots = join(workspace, '.dsh', 'workflows', 'snapshots')
    const scratch = join(workspace, '.dsh', 'workflows', 'scratch')
    // A frozen copy is read only after its checkout and lease were prepared.
    const prepared = await readdir(snapshots)
    expect(prepared.some((entry) => entry.endsWith('.lease'))).toBe(true)
    expect(prepared.some((entry) => !entry.endsWith('.lease'))).toBe(true)
    expect((await readdir(scratch)).length).toBeGreaterThan(0)
    controller.abort()
    releaseRead()
    await closing
    expect(activations).toHaveLength(0)
    expect(host.steers).toHaveLength(0)
    expect(
      await readdir(join(workspace, '.dsh', 'workflows', 'records'), { recursive: true }).catch(
        () => [],
      ),
    ).toHaveLength(0)
    // The checkout, its scratch index, and its lease are gone; a stopped lease
    // renewal must not recreate them afterwards.
    expect(await readdir(snapshots).catch(() => [])).toHaveLength(0)
    expect(await readdir(scratch).catch(() => [])).toHaveLength(0)
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(await readdir(snapshots).catch(() => [])).toHaveLength(0)
    expect(await readdir(scratch).catch(() => [])).toHaveLength(0)
  })

  it('starts no review when the stop lands during the close condition evaluation', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await laneWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    await establishInvolvement(host)
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    // The involvement record is queued ahead of the close and evaluates its own
    // condition context; wait for its journal entry so the pause below lands in
    // the close's evaluation, not in that earlier record.
    await waitFor(async () =>
      (await readFile(journalFile, 'utf8').catch(() => '')).includes('"tools/result"'),
    )
    let releaseRead: () => void = () => undefined
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let paused = (): void => undefined
    const pausedGate = new Promise<void>((resolve) => {
      paused = resolve
    })
    let pausedPath: string | undefined
    runStoreFaults.pauseNextRead = readGate
    runStoreFaults.onReadPaused = () => paused()
    // The first conditional definition evaluated for the close reads the
    // change's tasks.md; at that point the stop signal is still live.
    runStoreFaults.pauseReadFor = (path) => {
      if (!path.includes('/openspec/changes/auth/tasks.md')) return false
      pausedPath = path
      return true
    }
    const controller = new AbortController()
    const closing = host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    await pausedGate
    // Both conditional review definitions match this involved, completed plan.
    // Abort while their condition context is mid-read, then let evaluation run.
    expect(pausedPath).toContain('/openspec/changes/auth/tasks.md')
    controller.abort()
    releaseRead()
    // The close's evaluation resumes after the stopped signal and returns
    // before it can start, persist, or dispatch any review run.
    await closing
    // Give a dispatch the chance to appear before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 200))
    // No review definition may create a run, and the abandoned close steers
    // nothing for a review it never started.
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    expect(
      (await runs.listAuthenticatedRuns(workspace, auth)).filter((entry) =>
        ['task-review', 'spec-review', 'integration-review'].includes(entry.definition.id),
      ),
    ).toHaveLength(0)
    expect(host.steers).toHaveLength(0)
  })

  it('leaves deferred runs open when the stop lands during the not-applicable completion read', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // Two observational runs a reload left open. A close whose turn wrote no
    // code and asked for no checkpoint classifies both definitions as
    // not-applicable, so the completion loop owns them.
    const retro = runs.createRun({
      definition: 'retro',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['checkpoint', 'verify'],
      id: 'run-seeded-retro',
      now: 1_000,
    })
    const verify = runs.setRunStatus(
      runs.settleStep(
        runs.createRun({
          definition: 'verify',
          trigger: 'turn.stopping',
          session: 'session-1',
          workspace,
          steps: ['check'],
          id: 'run-seeded-verify',
          now: 1_100,
        }),
        'check',
        'blocked',
        { at: 1_101, reason: 'the verification is waiting' },
      ),
      'blocked',
      1_101,
    )
    await runs.writeRun(workspace, retro, auth)
    await runs.writeRun(workspace, verify, auth)
    let releaseRead: () => void = () => undefined
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let paused = (): void => undefined
    const pausedGate = new Promise<void>((resolve) => {
      paused = resolve
    })
    // The close's own record reads both seeded runs twice before the
    // not-applicable completion: once to seed trigger identities and once for
    // the stable snapshot. The fifth store read is the completion's
    // authenticated re-read inside the run lock.
    let storeReads = 0
    let pausedPath: string | undefined
    runStoreFaults.pauseNextRead = readGate
    runStoreFaults.onReadPaused = () => paused()
    runStoreFaults.pauseReadFor = (path) => {
      if (!path.includes('/.dsh/workflows/runs/') || !path.endsWith('.json')) return false
      storeReads += 1
      if (storeReads !== 5) return false
      pausedPath = path
      return true
    }
    const controller = new AbortController()
    const closing = host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    await pausedGate
    expect(storeReads).toBe(5)
    expect(pausedPath).toContain('/.dsh/workflows/runs/')
    expect([retro.id, verify.id].some((id) => pausedPath?.endsWith(`/${id}.json`))).toBe(true)
    // The stop lands after the completion read was issued but before it settles.
    controller.abort()
    releaseRead()
    await closing
    // Give a stray completion write the chance to appear before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const persistedRetro = await runs.readAuthenticatedRun(workspace, retro.id, auth)
    expect(persistedRetro?.status).toBe('running')
    expect(persistedRetro?.updatedAt).toBe(1_000)
    expect(persistedRetro?.steps.map((step) => step.state)).toEqual(['open', 'open'])
    const persistedVerify = await runs.readAuthenticatedRun(workspace, verify.id, auth)
    expect(persistedVerify?.status).toBe('blocked')
    expect(persistedVerify?.updatedAt).toBe(1_101)
    expect(persistedVerify?.steps.map((step) => step.state)).toEqual(['blocked'])
    // Neither run was classified not-applicable and no review started or steered.
    expect(
      [persistedRetro, persistedVerify]
        .flatMap((run) => run?.steps ?? [])
        .some((step) => step.state === 'cancelled' || step.reason === 'not-applicable'),
    ).toBe(false)
    const persistedRuns = await runs.listAuthenticatedRuns(workspace, auth)
    expect(persistedRuns.map((run) => run.id).sort()).toEqual([retro.id, verify.id].sort())
    expect(
      persistedRuns.filter((run) =>
        ['task-review', 'spec-review', 'integration-review'].includes(run.definition.id),
      ),
    ).toHaveLength(0)
    expect(host.steers).toHaveLength(0)
  })

  it('keeps the durable run unchanged when the stop lands during the run-file preparation', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // Seed the observation after the close's own store snapshot, while its
    // stop-attempt record is paused, so the close's advance owns the run and
    // reaches persistRun's not-applicable write.
    let releaseRecord: () => void = () => undefined
    const recordGate = new Promise<void>((resolve) => {
      releaseRecord = resolve
    })
    let recordPaused = (): void => undefined
    const recordPausedGate = new Promise<void>((resolve) => {
      recordPaused = resolve
    })
    runStoreFaults.pauseNextRead = recordGate
    runStoreFaults.onReadPaused = () => recordPaused()
    runStoreFaults.pauseReadFor = (path) => path.includes('/.dsh/workflows/involvement/')
    const controller = new AbortController()
    const closing = host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    await recordPausedGate
    const seeded = runs.createRun({
      definition: 'verify',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['check'],
      id: 'run-write-cancel',
      now: 1_000,
    })
    await runs.writeRun(workspace, seeded, auth)
    // Hold the writer after the temporary run file exists and before its rename.
    let releaseWrite: () => void = () => undefined
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve
    })
    runStoreFaults.pauseNextWrite = writeGate
    runStoreFaults.pauseFor = (path) => path.includes('run-write-cancel.json')
    releaseRecord()
    await waitFor(() => runStoreFaults.pauseNextWrite === undefined, 90_000)
    // The stop lands after the temporary file was written; the rename must not land.
    controller.abort()
    releaseWrite()
    await closing
    // Give a stray write the chance to appear before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const persisted = await runs.readAuthenticatedRun(workspace, seeded.id, auth)
    expect(persisted?.status).toBe('running')
    expect(persisted?.updatedAt).toBe(1_000)
    expect(persisted?.steps.map((step) => step.state)).toEqual(['open'])
    expect(persisted?.steps.some((step) => step.reason === 'not-applicable')).toBe(false)
    expect(persisted?.violations).toEqual([])
  })

  it('leaves a pending run open when the stop lands inside the advance-run not-applicable write', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // The close's queued stop-attempt record completes every deferred run its own
    // store snapshot lists. Seeding the run only after that snapshot, while the
    // record is paused on its involvement read, leaves the run to the close's
    // advance, whose not-applicable branch re-reads it inside persistRun.
    let releaseRecord: () => void = () => undefined
    const recordGate = new Promise<void>((resolve) => {
      releaseRecord = resolve
    })
    let recordPaused = (): void => undefined
    const recordPausedGate = new Promise<void>((resolve) => {
      recordPaused = resolve
    })
    runStoreFaults.pauseNextRead = recordGate
    runStoreFaults.onReadPaused = () => recordPaused()
    runStoreFaults.pauseReadFor = (path) => path.includes('/.dsh/workflows/involvement/')
    let releaseAdvance: () => void = () => undefined
    const advanceGate = new Promise<void>((resolve) => {
      releaseAdvance = resolve
    })
    let advancePaused = (): void => undefined
    const advancePausedGate = new Promise<void>((resolve) => {
      advancePaused = resolve
    })
    const controller = new AbortController()
    const closing = host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    await recordPausedGate
    const seeded = runs.createRun({
      definition: 'verify',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['check'],
      id: 'run-advance-cancel',
      now: 1_000,
    })
    await runs.writeRun(workspace, seeded, auth)
    // The close's snapshot is the first read of the seeded file; the advance's
    // persistRun re-read after the code-write applicability branch is the second.
    let seededReads = 0
    let pausedPath: string | undefined
    runStoreFaults.pauseNextRead = advanceGate
    runStoreFaults.onReadPaused = () => advancePaused()
    runStoreFaults.pauseReadFor = (path) => {
      if (!path.endsWith('/runs/run-advance-cancel.json')) return false
      seededReads += 1
      if (seededReads !== 2) return false
      pausedPath = path
      return true
    }
    releaseRecord()
    await advancePausedGate
    expect(pausedPath).toContain('/.dsh/workflows/runs/run-advance-cancel.json')
    // The stop lands after persistRun entered the run lock and issued its read.
    controller.abort()
    releaseAdvance()
    await closing
    // Give a stray completion write the chance to appear before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const persisted = await runs.readAuthenticatedRun(workspace, seeded.id, auth)
    expect(persisted?.status).toBe('running')
    expect(persisted?.updatedAt).toBe(1_000)
    expect(persisted?.steps.map((step) => step.state)).toEqual(['open'])
    expect(persisted?.steps.some((step) => step.reason === 'not-applicable')).toBe(false)
    expect(persisted?.violations).toEqual([])
    const persistedRuns = await runs.listAuthenticatedRuns(workspace, auth)
    expect(persistedRuns.map((run) => run.id)).toEqual([seeded.id])
  })

  it('leaves a completed verify run closed when the stop lands inside the turn-close reopen write', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never, { verify: { commands: ['pnpm check'] } })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const step = (): Promise<unknown> =>
      host.emit(
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
    const write = (callId: string): Promise<unknown> =>
      host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId,
          name: 'write',
          arguments: { file_path: 'src/app.ts' },
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    const shell = (callId: string): Promise<unknown> =>
      host.emit(
        'tools/result',
        { agent: host.agent, callId, name: 'pwsh', arguments: { command: 'pnpm check' } },
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
    await step()
    await write('write-1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    await shell('check-1')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    let verifyId: string | undefined
    await waitFor(async () => {
      verifyId = (await runs.listAuthenticatedRuns(workspace, auth)).find(
        (entry) => entry.definition.id === 'verify',
      )?.id
      return verifyId !== undefined
    })
    await waitFor(async () => {
      const stored = await runs.readAuthenticatedRun(workspace, verifyId ?? '', auth)
      return stored?.status === 'completed'
    })
    const runId = String(verifyId ?? '')
    const before = await runs.readAuthenticatedRun(workspace, runId, auth)
    expect(before?.status).toBe('completed')
    // Let the first close's refresh and every asynchronous start settle, then
    // write code again so the next close reopens this completed verification.
    await new Promise((resolve) => setTimeout(resolve, 200))
    await write('write-2')
    // The tool result queues its own observation record, which reads every run
    // once its evaluation starts; wait for its journal row so only the next
    // close's reads are counted below.
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    await waitFor(async () =>
      (await readFile(journalFile, 'utf8').catch(() => '')).includes('"callId":"write-2"'),
    )
    // The reopen's persistRun re-read is the third read of the completed run:
    // the stop-attempt record's snapshot, the close's snapshot, then the write.
    let runReads = 0
    let pausedPath: string | undefined
    let releaseRead: () => void = () => undefined
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    let paused = (): void => undefined
    const pausedGate = new Promise<void>((resolve) => {
      paused = resolve
    })
    runStoreFaults.pauseNextRead = readGate
    runStoreFaults.onReadPaused = () => paused()
    runStoreFaults.pauseReadFor = (path) => {
      if (!path.endsWith(`/runs/${runId}.json`)) return false
      runReads += 1
      if (runReads !== 3) return false
      pausedPath = path
      return true
    }
    const controller = new AbortController()
    const closing = host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    await pausedGate
    expect(runReads).toBe(3)
    expect(pausedPath).toContain('/.dsh/workflows/runs/')
    // The stop lands after the reopen's persistRun entered the run lock and
    // issued its read.
    controller.abort()
    releaseRead()
    await closing
    // Give a stray reopen write the chance to appear before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 200))
    const persisted = await runs.readAuthenticatedRun(workspace, runId, auth)
    expect(persisted?.status).toBe('completed')
    expect(persisted?.updatedAt).toBe(before?.updatedAt)
    expect(persisted?.steps).toEqual(before?.steps)
    expect(persisted?.turnBlocks).toBeUndefined()
    expect(persisted?.violations).toEqual([])
    const persistedRuns = await runs.listAuthenticatedRuns(workspace, auth)
    expect(persistedRuns.map((run) => run.id)).toEqual([runId])
  })

  it('names a failed lane start in the whole-scope refusal and starts the lane on the next close', async () => {
    const workspace = await gitGateWorkspace(`# Tasks

## 1. Engine (lane 1, owns \`src/**\`)

- [x] 1.1 First engine task
- [x] 1.2 Second engine task
- [ ] 1.3 Later engine task

## 2. Docs (lane 2, owns \`docs/**\`)

- [x] 2.1 Doc task
`)
    const host = await engineGateHost(workspace)
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // A settled non-PASS whole-scope attempt refuses the close. The canonical
    // current PASS keeps the spec-review trigger out of this fixture.
    const attempted = runs.createRun({
      definition: 'spec-review',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: ['review'],
      id: 'run-whole-scope-error',
      now: 1_000,
    })
    await runs.writeRun(
      workspace,
      runs.settleStep(attempted, 'review', 'done', {
        at: 1_100,
        evidence: {
          kind: 'record',
          path: '.dsh/workflows/records/spec-review/auth/attempt.json',
        },
      }),
      auth,
    )
    const recordDir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'attempt.json'),
      `${JSON.stringify({ verdict: 'ERROR' })}\n`,
      'utf8',
    )
    // The due lane start's own run write fails, so its start returns not-ok
    // while the whole-scope review step is what refuses the close.
    runStoreFaults.syncWriteFile = 'simulated run-store write failure'
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const refusal = steered(host)
    expect(refusal).toContain('last settled on a ERROR record')
    expect(refusal).toContain('simulated run-store write failure')
    expect(await taskRuns(workspace)).toHaveLength(0)
    // The next close retries the unit once the write fault is gone.
    runStoreFaults.syncWriteFile = undefined
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    await waitFor(async () => (await taskRuns(workspace)).length === 2)
    expect((await taskRuns(workspace)).map((run) => run.context.section).sort()).toEqual(['1', '2'])
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

  it('accepts a retired review queue wait without enforcing it', async () => {
    // waitTimeoutMs, concurrency, and maxQueued are accepted and ignored: a
    // legacy value no longer fails the load.
    const host = fakeHost(await tempWorkspace())
    expect(() =>
      apply(host.ctx as never, {
        reviewQueue: { waitTimeoutMs: 1_000, concurrency: 1, maxQueued: 1 },
        timeouts: { review: 600_000 },
      }),
    ).not.toThrow()
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
    // The boot recovery interrupts runs a previous process left behind; the fixture needs live slots.
    for (const entry of await runs.listAuthenticatedRuns(workspace, auth)) {
      if (entry.status === 'interrupted') {
        await runs.writeRun(workspace, runs.setRunStatus(entry, 'running', 2_000), auth)
      }
    }
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

  /** A review-gate definition on any trigger; its start is exempt from `maxRuns`. */
  function reviewDefinition(id: string, trigger: Record<string, unknown>): Record<string, unknown> {
    return {
      v: 1,
      id,
      name: id,
      version: 1,
      trigger,
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: true,
        gate: 'review',
        gateIdentity: id,
      },
      steps: [
        {
          id: 'review',
          title: 'Review',
          executor: 'review',
          review: { target: 'codex', instruction: 'review-task', scope: 'task' },
          evidence: {
            kind: 'record',
            rule: id,
            change: '{name}',
            scope: 'task',
            task: '{taskId}',
            verdicts: ['PASS', 'ERROR'],
            path: `.dsh/workflows/records/${id}/{name}/tasks/{taskId}.json`,
          },
          next: 'end',
          blockTurnClose: true,
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
    // The boot recovery interrupts runs a previous process left behind; the fixture needs live slots.
    for (const entry of await runs.listAuthenticatedRuns(workspace, auth)) {
      if (entry.status === 'interrupted') {
        await runs.writeRun(workspace, runs.setRunStatus(entry, 'running', 2_000), auth)
      }
    }
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

  it('starts a review at the run limit and still suppresses a non-review run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 Task\n', 'utf8')
    await installWatch(workspace, 'review-capacity-watch')
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // Fill the generic run limit before either start is attempted.
    for (let index = 0; index < 20; index += 1) {
      await runs.writeRun(
        workspace,
        runs.createRun({
          definition: 'change-intake',
          trigger: 'tool.pre-execute',
          session: 'session-1',
          workspace,
          steps: ['requirements'],
          id: `run-full-${String(index)}`,
        }),
        auth,
      )
    }
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    // The boot recovery interrupts runs a previous process left behind; the fixture needs live slots.
    for (const entry of await runs.listAuthenticatedRuns(workspace, auth)) {
      if (entry.status === 'interrupted') {
        await runs.writeRun(workspace, runs.setRunStatus(entry, 'running', 2_000), auth)
      }
    }
    // The plan change reaches the review trigger at capacity.
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n', 'utf8')
    host.fireFs()
    await waitFor(async () =>
      (await runs.listAuthenticatedRuns(workspace, auth)).some(
        (run) => run.definition.id === 'task-review',
      ),
    )
    // A non-review trigger at the same capacity is still refused.
    await host.emit(
      'tools/pre-execute',
      { agent: host.agent, callId: 'review-capacity-call', name: 'read', arguments: {} },
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
              row.id === 'definition:review-capacity-watch' &&
              row.reason === 'run-suppressed' &&
              String(row.detail).includes('run limit'),
          ),
      )
    })
    const reviewRuns = (await runs.listAuthenticatedRuns(workspace, auth)).filter(
      (run) => run.definition.id === 'task-review',
    )
    expect(reviewRuns).toHaveLength(1)
  })

  it('starts a review through the intent trigger at the run limit and still refuses a non-review intent', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const plain = {
      v: 1,
      id: 'intent-plain',
      name: 'Intent plain',
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
    // An active intent starts only from a user-confirmed definition.
    for (const [id, definition] of [
      [
        'intent-review',
        reviewDefinition('intent-review', {
          kind: 'intent',
          match: { intent: 'new-change', classifier: 'heuristic-v1' },
          mode: 'active',
          dedupe: 'turn',
        }),
      ],
      ['intent-plain', plain],
    ] as const) {
      const path = join(workspace, `${id}.json`)
      await writeFile(path, `${JSON.stringify(definition, null, 2)}\n`, 'utf8')
      await installDefinition(workspace, path, auth)
    }
    // One open run reaches the configured limit before the intent is classified.
    await runs.writeRun(
      workspace,
      runs.createRun({
        definition: 'change-intake',
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        steps: ['requirements'],
        id: 'run-intent-limit',
      }),
      auth,
    )
    const host = fakeHost(workspace)
    apply(host.ctx as never, {
      maxRuns: 1,
      allowIntent: true,
      reviewers: { codex: { provider: 'codex-subagent' } },
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    // The boot recovery interrupts runs a previous process left behind; the fixture needs live slots.
    for (const entry of await runs.listAuthenticatedRuns(workspace, auth)) {
      if (entry.status === 'interrupted') {
        await runs.writeRun(workspace, runs.setRunStatus(entry, 'running', 2_000), auth)
      }
    }
    await host.emit(
      'agent/pre-step',
      {
        agent: host.agent,
        turn: 3,
        step: 2,
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Please start a new change for auth' }],
          },
        ],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    const intentRows = async (): Promise<Array<Record<string, unknown>>> => {
      const entries = (await readFile(file, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      const entry = entries.find((row) => row.kind === 'intent')
      return Array.isArray(entry?.triggers)
        ? (entry.triggers as Array<Record<string, unknown>>)
        : []
    }
    await waitFor(async () =>
      (await intentRows()).some(
        (row) => row.id === 'definition:intent-review' && row.reason === 'run-created',
      ),
    )
    expect(await intentRows()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'definition:intent-review', reason: 'run-created' }),
        expect.objectContaining({
          id: 'definition:intent-plain',
          reason: 'run-suppressed',
          detail: expect.stringContaining('run limit'),
        }),
      ]),
    )
    const stored = await runs.listAuthenticatedRuns(workspace, auth)
    expect(stored.filter((run) => run.definition.id === 'intent-review')).toHaveLength(1)
    expect(stored.some((run) => run.definition.id === 'intent-plain')).toBe(false)
  })

  it('starts a review through the pre-execute trigger at the run limit and still suppresses a non-review run', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [
        reviewDefinition('pre-execute-review', {
          kind: 'tool.pre-execute',
          match: { tool: 'read' },
          mode: 'active',
          dedupe: 'callId',
        }),
        watchDefinition('pre-execute-plain'),
      ],
    })
    try {
      const runs = await import('../src/host/runs.ts')
      const { HostAuth } = await import('../src/host/host-auth.ts')
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      // One open run reaches the configured limit before the tool call arrives.
      await runs.writeRun(
        workspace,
        runs.createRun({
          definition: 'change-intake',
          trigger: 'tool.pre-execute',
          session: 'session-1',
          workspace,
          steps: ['requirements'],
          id: 'run-pre-execute-limit',
        }),
        auth,
      )
      const host = fakeHost(workspace)
      apply(host.ctx as never, {
        maxRuns: 1,
        reviewers: { codex: { provider: 'codex-subagent' } },
      })
      await new Promise((resolve) => setTimeout(resolve, 100))
      await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: 'review-pre-execute-call',
          name: 'read',
          arguments: {},
        },
        async () => ({ kind: 'continue' }),
      )
      const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
      const triggerRows = async (): Promise<Array<Record<string, unknown>>> => {
        const entries = (await readFile(file, 'utf8').catch(() => ''))
          .trim()
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>)
        const entry = entries.find((row) => row.kind === 'tools/pre-execute')
        return Array.isArray(entry?.triggers)
          ? (entry.triggers as Array<Record<string, unknown>>)
          : []
      }
      await waitFor(async () =>
        (await triggerRows()).some(
          (row) => row.id === 'definition:pre-execute-review' && row.reason === 'run-created',
        ),
      )
      expect(await triggerRows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'definition:pre-execute-review',
            reason: 'run-created',
          }),
          expect.objectContaining({
            id: 'definition:pre-execute-plain',
            reason: 'run-suppressed',
            detail: expect.stringContaining('run limit'),
          }),
        ]),
      )
      const stored = await runs.listAuthenticatedRuns(workspace, auth)
      expect(stored.filter((run) => run.definition.id === 'pre-execute-review')).toHaveLength(1)
      expect(stored.some((run) => run.definition.id === 'pre-execute-plain')).toBe(false)
    } finally {
      unregister()
    }
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

describe('owned review at runtime', () => {
  it('keeps a review ERROR due and refuses the close until a round passes', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    // The spec-review signal is off, so the intake owns its step.
    const host = fakeHost(workspace, { specReview: false })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
    expect(intake).toBeDefined()
    if (intake === undefined) return
    expect(intake.steps.find((step) => step.id === 'spec-review')?.executor).toBe('review')

    // A current legacy PASS exists before the owned step runs; it must not be
    // read as the step's evidence.
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      await writeFile(join(change, file), '# artifact\n', 'utf8')
    }
    await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# spec\n', 'utf8')
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const digest = await currentSpecDigest(workspace, 'auth')
    expect(digest).toBeDefined()
    const legacy = join(workspace, '.dsh', 'delegation', 'spec-review', 'auth')
    await mkdir(legacy, { recursive: true })
    await writeFile(
      join(legacy, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )

    let run = runs.createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: intake.steps.map((step) => step.id),
      id: 'run-owned-review',
      now: 1_000,
    })
    for (const step of ['requirements', 'architecture', 'interface', 'create-change', 'spec']) {
      run = runs.settleStep(run, step, 'done', { at: 1_100 })
    }
    await runs.writeRun(workspace, run, auth)
    const recordPath = join(
      workspace,
      '.dsh',
      'workflows',
      'records',
      'spec-review',
      'auth',
      'spec.json',
    )
    const steerText = (): string =>
      host.steers
        .map((message) =>
          ((message as { content?: Array<{ text?: string }> }).content ?? [])
            .map((block) => block.text ?? '')
            .join(''),
        )
        .join('\n')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const stored = await runs.readAuthenticatedRun(workspace, 'run-owned-review', auth)
    const review = stored?.steps.find((step) => step.id === 'spec-review')
    // The unconfigured reviewer writes the engine's own ERROR record; the
    // legacy PASS is ignored, and the ERROR never completes the PASS-only step.
    // The unit stays due: the close is refused and the steer names the next
    // round, with no approval and no completion.
    expect(review?.state).toBe('failed')
    expect(review?.reason).toContain('ERROR')
    expect(review?.reason).toContain('retries the review')
    expect(review?.evidence?.path).toBe('.dsh/workflows/records/spec-review/auth/spec.json')
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
    expect(record).toMatchObject({
      definition: 'spec-review',
      rule: 'spec-review',
      change: 'auth',
      phase: 'spec',
      scope: 'whole',
      verdict: 'ERROR',
      digest,
    })
    // Approval and completion stay unavailable.
    expect(stored?.steps.find((step) => step.id === 'approval')?.state).not.toBe('done')
    expect(stored?.status).not.toBe('completed')
    expect(host.steers).toHaveLength(1)
    expect(steerText()).toContain('spec-review')
    expect(stored?.steps.find((step) => step.id === 'spec-review')?.at).toBeDefined()
    const firstAt = review?.at ?? 0

    // The next close starts the next round and refuses again.
    await new Promise((resolve) => setTimeout(resolve, 20))
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    const retried = await runs.readAuthenticatedRun(workspace, 'run-owned-review', auth)
    const retriedReview = retried?.steps.find((step) => step.id === 'spec-review')
    expect(retriedReview?.state).toBe('failed')
    expect(retriedReview?.at ?? 0).toBeGreaterThan(firstAt)
    expect(host.steers).toHaveLength(2)
  })

  it('blocks the close when a failed review leaves no record to read', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace, { specReview: false })
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
      id: 'run-unreadable-artifacts',
      now: 1_000,
    })
    for (const step of ['requirements', 'architecture', 'interface', 'create-change', 'spec']) {
      run = runs.settleStep(run, step, 'done', { at: 1_100 })
    }
    await runs.writeRun(workspace, run, auth)
    const steerText = (): string =>
      host.steers
        .map((message) =>
          ((message as { content?: Array<{ text?: string }> }).content ?? [])
            .map((block) => block.text ?? '')
            .join(''),
        )
        .join('\n')
    // No `openspec/changes/auth/` directory: the review cannot compute the
    // current digest and settles failed without writing a record.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const stored = await runs.readAuthenticatedRun(workspace, 'run-unreadable-artifacts', auth)
    const review = stored?.steps.find((step) => step.id === 'spec-review')
    expect(review?.state).toBe('failed')
    expect(review?.reason).toContain('unreadable')
    expect(review?.evidence).toBeUndefined()
    // A recordless failure is not provisional evidence: the close is refused
    // and its cause is steered instead of allowed silently.
    expect(host.steers).toHaveLength(1)
    expect(steerText()).toContain('spec-review')
    expect(steerText()).toContain('unreadable')
  })

  it('publishes no ERROR record when the stop lands during its target resolution', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace, { specReview: false })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
    expect(intake).toBeDefined()
    if (intake === undefined) return
    // Readable artifacts, so the review reaches the unconfigured reviewer whose
    // ERROR record resolves a target under .dsh/workflows/records/.
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
      id: 'run-target-cancel',
      now: 1_000,
    })
    for (const step of ['requirements', 'architecture', 'interface', 'create-change', 'spec']) {
      run = runs.settleStep(run, step, 'done', { at: 1_100 })
    }
    await runs.writeRun(workspace, run, auth)
    const recordPath = join(
      workspace,
      '.dsh',
      'workflows',
      'records',
      'spec-review',
      'auth',
      'spec.json',
    )
    let releaseTarget: () => void = () => undefined
    const targetGate = new Promise<void>((resolve) => {
      releaseTarget = resolve
    })
    let targetPaused = (): void => undefined
    const targetPausedGate = new Promise<void>((resolve) => {
      targetPaused = resolve
    })
    runStoreFaults.pauseNextTarget = targetGate
    runStoreFaults.onTargetPaused = () => targetPaused()
    runStoreFaults.pauseTargetFor = (path) => path.includes('/.dsh/workflows/records')
    const controller = new AbortController()
    const closing = host.emit('agent/turn-stopping', {
      agent: host.agent,
      turn: 1,
      signal: controller.signal,
    })
    await targetPausedGate
    // The stop lands after the ERROR writer entered target resolution but before
    // the record could be published; nothing may be written or settled.
    controller.abort()
    releaseTarget()
    await closing
    // Give a stray publication the chance to appear before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(await readFile(recordPath, 'utf8').catch(() => undefined)).toBeUndefined()
    const stored = await runs.readAuthenticatedRun(workspace, 'run-target-cancel', auth)
    expect(stored?.status).toBe('running')
    expect(stored?.updatedAt).toBe(1_100)
    expect(stored?.steps.find((step) => step.id === 'spec-review')?.state).toBe('open')
    expect(host.steers).toHaveLength(0)
  })

  it('blocks the close when the ERROR record cannot be published', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace, { specReview: false })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
    expect(intake).toBeDefined()
    if (intake === undefined) return
    // Readable artifacts, so the review reaches the unconfigured reviewer and
    // its ERROR publication is the only failure.
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
      id: 'run-unpublished-error',
      now: 1_000,
    })
    for (const step of ['requirements', 'architecture', 'interface', 'create-change', 'spec']) {
      run = runs.settleStep(run, step, 'done', { at: 1_100 })
    }
    await runs.writeRun(workspace, run, auth)
    const steerText = (): string =>
      host.steers
        .map((message) =>
          ((message as { content?: Array<{ text?: string }> }).content ?? [])
            .map((block) => block.text ?? '')
            .join(''),
        )
        .join('\n')
    runStoreFaults.recordWriteFile = 'EACCES'
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const stored = await runs.readAuthenticatedRun(workspace, 'run-unpublished-error', auth)
    const review = stored?.steps.find((step) => step.id === 'spec-review')
    expect(review?.state).toBe('failed')
    expect(review?.reason).toContain('could not be written')
    expect(review?.evidence).toBeUndefined()
    expect(host.steers).toHaveLength(1)
    expect(steerText()).toContain('could not be written')
    // The retry cannot publish either, so the failure keeps blocking the close;
    // the bounded violation is the only way past it.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    expect(host.steers).toHaveLength(2)
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
    const host = fakeHost(workspace, { toolExecute: true, userQuestions: true, specReview: false })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const runs = await import('../src/host/runs.ts')
    const receipts = await import('../src/host/receipts.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const intake = definitionsRegistry.installed('change-intake')?.definition
    expect(intake).toBeDefined()
    if (intake === undefined) return
    // The whole-spec review completes from the canonical native PASS record.
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
    if (digest === undefined) throw new Error('the auth change artifacts are unreadable')
    const recordDir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'spec.json'),
      `${JSON.stringify({ definition: 'spec-review', rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
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
        path: '.dsh/workflows/records/spec-review/auth/spec.json',
        digest,
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
    const host = fakeHost(workspace, { toolExecute: true, userQuestions: true, specReview: false })
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
    const fresh = fakeHost(workspace, {
      toolExecute: true,
      userQuestions: true,
      specReview: false,
    })
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

    // 4. Artifacts, a canonical strict-validation result, and a current native
    //    whole-spec PASS complete spec and let the owned review reuse it.
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
    expect(digest).toBeDefined()
    const recordDir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'spec.json'),
      `${JSON.stringify({ definition: 'spec-review', rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
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
    const completed = await runs.readAuthenticatedRun(workspace, created?.id ?? '', auth)
    expect(completed?.status).toBe('completed')
    expect(await receipts.readReceipt(workspace, 'auth', auth)).toMatchObject({
      kind: 'intake',
      change: 'auth',
    })

    // 5. A repeated creation is allowed and starts no second run.
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
    const host = fakeHost(workspace, { userQuestions: true, answer: 'no', specReview: false })
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
    const recordDir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'spec.json'),
      `${JSON.stringify({ definition: 'spec-review', rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
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
    const recordDir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
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
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    run = runs.settleStep(run, 'review', 'failed', {
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
    const host = fakeHost(workspace, { specReview: false })
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 200))
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    // A current canonical PASS is what lets this run reach the completion commit.
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
    if (digest === undefined) throw new Error('the auth change artifacts are unreadable')
    const recordDir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(recordDir, { recursive: true })
    await writeFile(
      join(recordDir, 'spec.json'),
      `${JSON.stringify({ definition: 'spec-review', rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
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
                path: '.dsh/workflows/records/spec-review/auth/spec.json',
                digest,
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
      steps: ['review', 'complete-review'],
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
    const journalFile = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    const fsEvents = async (): Promise<number> =>
      (await readFile(journalFile, 'utf8').catch(() => ''))
        .trim()
        .split('\n')
        .filter((line) => line !== '')
        .filter((line) => {
          try {
            return (JSON.parse(line) as { kind?: string }).kind === 'fs.change'
          } catch {
            return false
          }
        }).length
    await writeFile(join(changeDir, 'tasks.md'), '- [ ] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    host.fireFs()
    // Let the uncheck delta land before the close resets the baseline.
    await waitFor(async () => (await fsEvents()) === 3)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(workspace, runA?.id ?? 'missing', auth))?.status ===
        'cancelled',
    )
    // The restored file matches the earlier both-checked content key, but the
    // newly checked task A must still reach the per-task live-run guard.
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 A\n- [x] 1.2 B\n', 'utf8')
    host.fireFs()
    await waitFor(async () =>
      (await reviewRuns()).some(
        (entry) => entry.id !== runA?.id && entry.context.taskId === taskIdOf('A'),
      ),
    )
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
      steps: ['review', 'complete-review'],
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
    expect(settled?.steps.find((step) => step.id === 'review')?.state).toBe('open')
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
      steps: ['review', 'complete-review'],
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
    expect(settled?.steps.find((step) => step.id === 'review')?.state).toBe('open')
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
  it('registers the eight actions and verifies observed evidence through the real tool', async () => {
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
      'note',
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
    const record = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
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
    const record = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
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

  it('refuses a click without the current PASS record', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const receipts = await import('../src/host/receipts.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))

    const missing = await tempWorkspace()
    await completeChange(missing)
    await rm(join(missing, '.dsh', 'workflows', 'records', 'spec-review', 'auth', 'spec.json'))
    const missingHost = fakeHost(missing)
    apply(missingHost.ctx as never)
    const missingResult = await serviceOf(missingHost).authorizeAndCheck(missing, 'auth')
    expect(missingResult.ok).toBe(false)
    if (missingResult.ok) return
    expect(missingResult.reason).toMatch(/cannot be adopted|whole-spec/u)
    expect(await receipts.readReceipt(missing, 'auth', auth)).toBeUndefined()
  })

  it('a click authorizes despite an open run step', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const receipts = await import('../src/host/receipts.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
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
    expect(blockedResult).toEqual({ ok: true })
    expect(await receipts.readReceipt(blocked, 'auth', auth)).toMatchObject({ kind: 'adoption' })
  })

  it('a click is the final authorization even without a portable task PASS', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    await completeChange(workspace)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    const result = await serviceOf(host).authorizeAndCheck(workspace, 'auth')
    expect(result).toEqual({ ok: true })
  })

  it('a click ignores the legacy marker and never needs definitions', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { authorizeUserArchive } = await import('../src/host/archive-authorization.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const marker = `${JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' })}\n`

    const workspace = await tempWorkspace()
    await completeChange(workspace)
    await writeFile(join(workspace, 'openspec', 'review-approval.json'), marker, 'utf8')
    expect(await authorizeUserArchive(workspace, 'auth', auth)).toEqual({ ok: true })

    const malformed = await tempWorkspace()
    await completeChange(malformed)
    await writeFile(join(malformed, 'openspec', 'review-approval.json'), '{ not json', 'utf8')
    expect(await authorizeUserArchive(malformed, 'auth', auth)).toEqual({ ok: true })
  })
  /** A spec-less change with the marker and a current whole-spec PASS record. */
  async function specLessChange(workspace: string): Promise<void> {
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(change, { recursive: true })
    for (const file of ['proposal.md', 'design.md']) {
      await writeFile(join(change, file), '# artifact\n', 'utf8')
    }
    await writeFile(join(change, 'tasks.md'), '- [ ] 1.1 Open work\n', 'utf8')
    await writeFile(
      join(change, '.openspec.yaml'),
      'schema: spec-driven\nskip_specs: true\n',
      'utf8',
    )
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const digest = await currentSpecDigest(workspace, 'auth')
    const record = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(record, { recursive: true })
    await writeFile(
      join(record, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
  }

  it('writes the host-signed receipt for a spec-less click with the marker', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    await specLessChange(workspace)
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    expect(await serviceOf(host).authorizeAndCheck(workspace, 'auth')).toEqual({ ok: true })
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const receipts = await import('../src/host/receipts.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    expect(await receipts.readReceipt(workspace, 'auth', auth)).toMatchObject({
      kind: 'adoption',
      change: 'auth',
    })
  })

  it('refuses a spec-less click whose marker is missing and names the marker', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    await specLessChange(workspace)
    await rm(join(workspace, 'openspec', 'changes', 'auth', '.openspec.yaml'))
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    const result = await serviceOf(host).authorizeAndCheck(workspace, 'auth')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain('skip_specs: true')
  })
})

describe('spec-less archive move', () => {
  it('allows a Move-Item archive with the marker and refuses it after removal', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(change, { recursive: true })
    for (const file of ['proposal.md', 'design.md']) {
      await writeFile(join(change, file), '# artifact\n', 'utf8')
    }
    await writeFile(join(change, 'tasks.md'), '- [ ] 1.1 Open work\n', 'utf8')
    await writeFile(
      join(change, '.openspec.yaml'),
      'schema: spec-driven\nskip_specs: true\n',
      'utf8',
    )
    const { currentSpecDigest } = await import('../src/host/evidence.ts')
    const digest = (await currentSpecDigest(workspace, 'auth')) as string
    const record = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(record, { recursive: true })
    await writeFile(
      join(record, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const receipts = await import('../src/host/receipts.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    await receipts.issueAdoptionReceipt(workspace, 'auth', digest, auth, 3_000)

    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const archive = async (
      callId: string,
      command: string,
    ): Promise<{ kind?: string; reason?: string } | undefined> => {
      return (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId,
          name: 'pwsh',
          arguments: { command },
        },
        async () => ({ kind: 'continue' }),
      )) as { kind?: string; reason?: string } | undefined
    }

    const allowed = await archive(
      'spec-less-move',
      'Move-Item openspec/changes/auth openspec/changes/archive',
    )
    expect(allowed?.kind).not.toBe('deny')

    await rm(join(change, '.openspec.yaml'))
    const denied = await archive(
      'spec-less-move-removed',
      'mv openspec/changes/auth openspec/changes/archive',
    )
    expect(denied?.kind).toBe('deny')
    expect(denied?.reason).toContain('skip_specs: true')
  })
})

describe('workflows start action selectors', () => {
  it('resolves the printed task and section selectors and refuses invalid ones', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    await writeFile(
      join(change, 'tasks.md'),
      '# Tasks\n\n## 1. Engine (owns `src/**`)\n\n- [x] 1.1 First task\n- [ ] 1.2 Second task\n',
      'utf8',
    )
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | { execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }> }
      | undefined
    if (tool === undefined) throw new Error('the workflows tool is missing')
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const start = (args: Record<string, unknown>) => tool.execute(args, { agent: host.agent })
    const started = await start({
      action: 'start',
      definitionId: 'task-review',
      change: 'auth',
      task: 'First task',
    })
    expect(started.text).toContain('started')
    let stored = await runs.listAuthenticatedRuns(workspace, auth)
    expect(stored.find((run) => run.definition.id === 'task-review')?.context).toMatchObject({
      name: 'auth',
      taskId: taskIdOf('First task'),
    })
    await start({
      action: 'start',
      definitionId: 'task-review',
      change: 'auth',
      section: '1',
    })
    stored = await runs.listAuthenticatedRuns(workspace, auth)
    const sectionRun = stored.filter((run) => run.definition.id === 'task-review').at(-1)
    expect(sectionRun?.context).toMatchObject({ name: 'auth', section: '1' })
    expect(sectionRun?.context.taskIds).toContain(taskIdOf('First task'))
    await expect(
      start({ action: 'start', definitionId: 'task-review', change: 'auth', task: 'Missing' }),
    ).rejects.toThrow(/was not found/u)
    await expect(
      start({ action: 'start', definitionId: 'task-review', change: 'auth', task: 'Second task' }),
    ).rejects.toThrow(/not checked/u)
    await expect(
      start({ action: 'start', definitionId: 'task-review', task: 'First task' }),
    ).rejects.toThrow(/needs the change/u)
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
      'Write-Output "a`""; openspec archive auth',
      "git status; # don't forget\nopenspec archive auth",
      'git status; Write-Output $(openspec archive auth)',
      'git status; Write-Output "$(openspec archive auth)"',
      'git status; Write-Output "$(Get-Date; openspec archive auth)"',
      'git status; Write-Output "$(Write-Output (Get-Date -Format yyyy); openspec archive auth)"',
      'git status; openspec `\r\narchive auth',
      'Write-Output (openspec archive auth)',
      'Write-Output @(openspec archive auth)',
      'git status; openspec 2>$null archive auth',
      'git status; openspec 2>&1 archive auth',
      'cd .; openspec 2>"log;file.txt" archive auth',
      'git status; openspec "archive"2>$null auth',
      'git status; openspec *> $null archive auth',
      'git status; <# comment #> openspec archive auth',
      'cd .; openspec <# ; #> archive auth',
      'bash -c "openspec archive auth"',
      'pwsh -Command "openspec archive auth"',
      "iex 'openspec archive auth'",
      'git status; $result = openspec archive auth',
      'git status; iex "git status; openspec archive auth"',
      'git status; pwsh -Command "git status; openspec archive auth"',
      "Write-Output @'\nit's\n'@\nopenspec archive auth",
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
      'git status; git mv docs/notes docs/history',
      'git status; <# comment #> git status',
      'git status; Write-Output "a`"b"; done',
      "git status; # don't forget\ngit status",
      'git status; Write-Output "$(git status)"',
      'git status; mv docs/a.md docs/b.md -ErrorAction Stop',
      'git status; mv docs/a.md docs/b.md *> "log file.txt"',
      "Write-Output @'\nit's\n'@",
      'git status; Move-Item docs/a.md "archive2">$null',
      'git status; git mv docs/a.md openspec/changes/archive2',
      'git status; mv docs/a.md docs/tmp/../archive',
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

  it('refuses a compound command that mentions an archive only as text or a source', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    for (const [index, command] of [
      'git status -- openspec/changes/archive; git mv docs/a.md docs/b.md',
      'git status; Write-Output "Run; openspec archive auth after review"',
      'git status; Write-Output "openspec archive auth"',
      'git status; Write-Output "Example commands:\nMove-Item openspec/changes/auth openspec/changes/archive\n"',
      'git status "x"#; openspec archive auth',
      'git status; git mv openspec/changes/archive/2026-11-11-auth openspec/changes/auth',
      'git status; Move-Item -Destination openspec/changes/auth openspec/changes/archive/2026-11-11-auth',
      'git status; mv -t openspec/changes openspec/changes/archive/2026-11-11-auth',
      'Write-Output archive; mv docs/a.md docs/b.md',
    ].entries()) {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: `archive-mention-${String(index)}`,
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

  it('refuses a bash escaped-quote or substitution compound archive', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    for (const [index, command] of [
      'echo "a\\""; openspec archive auth',
      'echo `openspec archive auth`',
      'open\\spec archive auth',
      'git status; mv openspec/changes/auth \\\n"openspec/changes/archive"',
    ].entries()) {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: `archive-bash-bypass-${String(index)}`,
          name: 'bash',
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
      'git status; git mv openspec/changes/auth --force openspec/changes/archive/',
      'git status; git mv openspec/changes/auth --verbose openspec/changes/archive/',
      'git status; git mv openspec/changes/auth -- openspec/changes/archive/',
      'git status; Move-Item openspec/changes/auth openspec/changes/archive > "log file.txt"',
      'git status; Move-Item openspec/changes/auth "openspec/changes/archive" -ErrorAction Stop',
      'git status; Move-Item openspec/changes/auth "openspec/changes/archive" *> "log file.txt"',
      'git status; Move-Item openspec/changes/auth "openspec/changes/archive"> "log file.txt"',
      "git status; # don't forget\nMove-Item openspec/changes/auth openspec/changes/archive",
      'git status; Write-Output "$(Move-Item openspec/changes/auth "openspec/changes/archive")"',
      'git status; (Move-Item openspec/changes/auth "openspec/changes/archive") > $null',
      'git status; Move-Item openspec/changes/auth `\n"openspec/changes/archive"',
      'git status; Move-Item openspec/changes/auth `\r\n"openspec/changes/archive"',
      'git status; Write-Output "$((Get-Date); Move-Item openspec/changes/auth \'openspec/changes/archive\')"',
      'pushd openspec/changes; mv auth archive/2026-11-11-auth',
      'Set-Location openspec/changes; mv auth archive/2026-11-11-auth',
      'git status; <# comment #> Move-Item openspec/changes/auth "openspec/changes/archive"',
      'git status; Move-Item openspec/changes/auth ("openspec/changes/archive")',
      'cd openspec/changes; Move-Item auth <# ; #> archive',
      'git status; $null = Move-Item openspec/changes/auth openspec/changes/archive',
      'git status; Move-Item openspec/changes/auth "openspec/changes/archive" -InformationVariable moveLog',
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
      'git status; Move-Item auth archive/2026-11-11-auth -ErrorAction Stop',
      'git status; Move-Item auth archive/2026-11-11-auth > log.txt',
      'git status; mv auth ar"chive"/2026-11-11-auth',
      'git status; Move-Item auth "archive"> log.txt',
      'git status; Move-Item auth "archive">log.txt',
      'cd openspec/changes; Move-Item auth 2>"log;file.txt" archive',
      'cd openspec/changes; Move-Item auth -Destination:("archive"); pwd',
      'git status; Move-Item auth ./archive',
      'git status; Move-Item auth .\\archive',
      'cd .; Move-Item auth "archive"|Out-Null',
      'cd .; Move-Item auth ./archive; pwd',
      'git status; Move-Item auth ../changes/archive',
      'git status; Move-Item auth ..\\changes\\archive',
      'cd .; Move-Item auth ././archive',
      'cd openspec/changes; Move-Item auth "archive"2>$null',
      'git status; Move-Item auth auth/../archive',
      'git status; & "Move-Item"2>$null auth archive',
      'git status; Move-Item auth "../changes/./archive"',
      'git status; Move-Item auth "..\\changes\\.\\archive"',
      'git status; Move-Item auth .//archive',
      'git status; Move-Item auth .\\\\archive',
      'git status; Move-Item auth changes//archive',
      'git status; Move-Item auth auth//../archive',
      'git status; Move-Item auth auth/..//archive',
      'git status; Move-Item auth auth\\\\..\\\\archive',
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

/** The conditional and unconditional definitions the turn-close wiring tests register. */
const CONDITION_WIRING_DEFINITIONS: readonly unknown[] = [
  {
    v: 1,
    id: 'conditional-review',
    name: 'Conditional review',
    version: 1,
    trigger: {
      kind: 'turn.stopping',
      match: {},
      mode: 'active',
      dedupe: 'turn',
      condition: { '==': [{ var: 'session.involved' }, true] },
    },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'confirm',
        title: 'Confirm the change',
        executor: 'main',
        prompt: 'Confirm the change artifacts.',
        evidence: {
          kind: 'file',
          path: 'openspec/changes/{name}/proposal.md',
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  },
  {
    v: 1,
    id: 'unconditional-review',
    name: 'Unconditional review',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'none' },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'confirm',
        title: 'Confirm the change',
        executor: 'main',
        prompt: 'Confirm the change artifacts.',
        evidence: {
          kind: 'file',
          path: 'openspec/changes/{name}/proposal.md',
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  },
]

describe('turn-close condition wiring', () => {
  async function conditionRows(
    workspace: string,
    id = 'definition:conditional-review',
  ): Promise<Array<Record<string, unknown>>> {
    const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
    return (await readFile(file, 'utf8').catch(() => ''))
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
      .filter((row) => row.id === id)
  }

  it("starts a run only after the session's own write establishes involvement", async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, 'openspec', 'changes', 'auth'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'auth', 'proposal.md'),
      '# Proposal\n',
      'utf8',
    )
    const dispose = definitionsRegistry.register({
      source: '@acme/conditional',
      definitions: CONDITION_WIRING_DEFINITIONS,
      triggers: [],
    })
    try {
      const host = fakeHost(workspace)
      apply(host.ctx as never)
      await new Promise((resolve) => setTimeout(resolve, 300))
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      await waitFor(async () =>
        (await conditionRows(workspace)).some((row) => row.reason === 'condition-false'),
      )
      expect((await conditionRows(workspace)).some((row) => row.reason === 'run-created')).toBe(
        false,
      )
      await host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId: 'spec-write',
          name: 'write',
          arguments: { file_path: 'openspec/changes/auth/design.md' },
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
      await waitFor(async () =>
        (await conditionRows(workspace)).some((row) => row.reason === 'run-created'),
      )
      // A session involved in two changes evaluates each change at the close.
      await mkdir(join(workspace, 'openspec', 'changes', 'billing'), { recursive: true })
      await writeFile(
        join(workspace, 'openspec', 'changes', 'billing', 'proposal.md'),
        '# Proposal\\n',
        'utf8',
      )
      await host.emit(
        'tools/result',
        {
          agent: host.agent,
          callId: 'billing-write',
          name: 'write',
          arguments: { file_path: 'openspec/changes/billing/design.md' },
        },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 3 })
      await waitFor(
        async () =>
          (await conditionRows(workspace)).filter((row) => row.reason === 'run-created').length >=
          2,
      )
      expect(
        (await conditionRows(workspace)).filter((row) => row.reason === 'run-created').length,
      ).toBeGreaterThanOrEqual(2)
      // The unconditional definition starts once per event, not once per change.
      expect(
        (await conditionRows(workspace, 'definition:unconditional-review')).filter(
          (row) => row.reason === 'run-created',
        ).length,
      ).toBe(3)
    } finally {
      dispose?.()
    }
  })

  it('records error rows for the shipped conditional definitions when a lane owner is a path input', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const DRIVE = ['C', ':'].join('')
    const workspace = await tempWorkspace()
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
    await writeFile(
      join(changeDir, 'tasks.md'),
      `# Tasks\n\n## 1. Lane (lane 1, owns \`${DRIVE}/private/**\`)\n\n- [ ] 1.1 Do it\n`,
      'utf8',
    )
    const lastTurnStopping = async (): Promise<Array<Record<string, unknown>>> => {
      const file = join(workspace, '.dsh', 'workflows', 'events', 'session-1.jsonl')
      const lines = (await readFile(file, 'utf8').catch(() => '')).trim().split('\n')
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]
        if (line === undefined) continue
        try {
          const entry = JSON.parse(line) as {
            kind?: string
            triggers?: Array<Record<string, unknown>>
          }
          if (entry.kind === 'agent/turn-stopping') return entry.triggers ?? []
        } catch {
          // A partial line is not the entry this helper looks for.
        }
      }
      return []
    }
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 300))
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'lane-owner-write',
        name: 'write',
        arguments: { file_path: 'openspec/changes/auth/design.md' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(async () =>
      (await lastTurnStopping()).some(
        (row) => row.id === 'definition:spec-review' && row.reason === 'error',
      ),
    )
    const rows = await lastTurnStopping()
    for (const id of ['definition:spec-review', 'definition:integration-review']) {
      const matches = rows.filter((row) => row.id === id)
      expect(
        matches.some((row) => row.reason === 'error'),
        id,
      ).toBe(true)
      expect(
        matches.some((row) => row.reason === 'run-created'),
        id,
      ).toBe(false)
    }
    // The unconditional definition is still evaluated in the same turn-close entry.
    expect(rows.filter((row) => row.id === 'definition:task-review')).toHaveLength(1)
    const health = JSON.parse(
      await readFile(join(workspace, '.dsh', 'workflows', 'health.json'), 'utf8'),
    ) as { lastError?: string }
    expect(health.lastError).toContain('condition context contains a filesystem path')
  })
})

// ---------------------------------------------------------------------------
// engine-owned gates: note evidence, lane assignment, and the goal guard
// ---------------------------------------------------------------------------

const GATE_PLAN = `# Tasks

## 1. Engine (lane 1, owns \`src/engine/**\`)

- [ ] 1.1 Engine task

## 2. Docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Doc task
`

function steered(host: ReturnType<typeof fakeHost>): string {
  return host.steers
    .map((message) => {
      const entry = message as { content?: Array<{ text?: string }> }
      return (entry.content ?? []).map((block) => block.text ?? '').join('')
    })
    .join('\n')
}

async function gitGateWorkspace(plan = GATE_PLAN): Promise<string> {
  const directory = await tempWorkspace()
  const change = join(directory, 'openspec', 'changes', 'auth')
  await mkdir(change, { recursive: true })
  await writeFile(join(change, 'proposal.md'), '# Proposal\n\nWhy.\n', 'utf8')
  await writeFile(join(change, 'tasks.md'), plan, 'utf8')
  await writeFile(join(directory, '.gitignore'), 'node_modules/\n', 'utf8')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: directory, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.name', 'engine-gates')
  git('config', 'user.email', 'engine-gates@example.test')
  git('add', '-A')
  git('commit', '-m', 'init')
  return directory
}

/** A current whole-spec PASS record for the `auth` fixture change. */
async function seedSpecPass(workspace: string): Promise<void> {
  const { currentSpecDigest, reviewDigest } = await import('../src/host/evidence.ts')
  const specDigest = await currentSpecDigest(workspace, 'auth')
  if (specDigest === undefined) return
  const dir = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'spec.json'),
    `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest: reviewDigest({ scope: 'whole', specDigest }), findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
    'utf8',
  )
}

async function engineGateHost(
  workspace: string,
  options: Parameters<typeof fakeHost>[1] = {},
  config?: Parameters<typeof apply>[1],
): Promise<ReturnType<typeof fakeHost>> {
  process.env.DSH_WORKFLOWS_HOST_KEY = KEY
  const host = fakeHost(workspace, options)
  apply(host.ctx as never, config)
  await new Promise((resolve) => setTimeout(resolve, 100))
  // A current whole-spec PASS keeps the spec-review trigger out of these gate
  // fixtures: a reviewer-less host would settle it as a config ERROR and the
  // failed review step would refuse the close before the lane gate steers.
  await seedSpecPass(workspace)
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

async function gateWrite(
  host: ReturnType<typeof fakeHost>,
  path: string,
  name = 'write',
): Promise<void> {
  await host.emit(
    'tools/result',
    { agent: host.agent, callId: `call-${path}`, name, arguments: { file_path: path } },
    { isError: false, content: [{ type: 'text', text: 'ok' }] },
  )
}

/** The canonical foreground result a successful shell tool returns. */
function gateShellResult(workspace: string): Record<string, unknown> {
  return {
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
  }
}

describe('engine-owned gates', () => {
  it('reports an unassigned non-serial lane with the exact worker call', async () => {
    const workspace = await gitGateWorkspace()
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
    const host = await engineGateHost(workspace, {
      taskProgress: true,
      laneFanout: false,
      workflowOwned: false,
    })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await gateWrite(host, 'src/app.ts')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const text = steered(host)
    expect(text).toContain('lane assignment is missing in change "auth"')
    expect(text).toContain('lane-tag: auth#1')
    expect(text).toContain('workflows { action: "note"')
    expect(text).toContain('git add -A :/; git add -f ":(top)openspec/changes/auth"')
    expect(text).toContain('git commit -m "lane checkpoint before fan-out"')
    expect(text).toContain('git worktree add ../wt-auth-1 -b lane-auth-1')
    expect(text).toContain('Do not tick tasks.md')
    expect(text.indexOf('lane checkpoint before fan-out')).toBeLessThan(text.indexOf('subagent('))
  })

  it('accepts a tagged worker start for the reported lane', async () => {
    const workspace = await gitGateWorkspace()
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
    const host = await engineGateHost(workspace, { taskProgress: true, laneFanout: false })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await gateWrite(host, 'src/app.ts')
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'worker-1',
        name: 'subagent',
        arguments: { prompt: 'lane-tag: auth#1. Implement lane 1.' },
      },
      { isError: false, content: [{ type: 'text', text: 'started' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const text = steered(host)
    expect(text).toContain('Lane: 2. Docs')
    expect(text).not.toContain('Lane: 1. Engine')
  })

  it('accepts a lane tag that starts a new line in the worker prompt', async () => {
    const workspace = await gitGateWorkspace()
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
    const host = await engineGateHost(workspace, { taskProgress: true, laneFanout: false })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await gateWrite(host, 'src/app.ts')
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'worker-1',
        name: 'subagent',
        arguments: { prompt: 'Context\nlane-tag: auth#1. Implement lane 1.' },
      },
      { isError: false, content: [{ type: 'text', text: 'started' }] },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const text = steered(host)
    expect(text).toContain('Lane: 2. Docs')
    expect(text).not.toContain('Lane: 1. Engine')
  })

  it('lets the note action decide one lane serial for the workflow gate', async () => {
    const workspace = await gitGateWorkspace()
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: false })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await gateWrite(host, 'src/app.ts')
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | { execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }> }
      | undefined
    expect(tool).toBeDefined()
    const output = await tool?.execute(
      {
        action: 'note',
        change: 'auth',
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'docs stay serial',
      },
      { agent: host.agent },
    )
    expect(output?.text).toContain('progress note written')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const text = steered(host)
    expect(text).toContain('Lane: 1. Engine')
    expect(text).not.toContain('Lane: 2. Docs')
    const note = JSON.parse(
      await readFile(join(workspace, '.dsh', 'workflows', 'notes', 'auth.json'), 'utf8'),
    ) as { lane?: string; worktreeDigest?: string }
    expect(note.lane).toBe('2. Docs (lane 2, owns `docs/**`)')
    expect(note.worktreeDigest).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('counts a shell-only implementation edit for both gates', async () => {
    const workspace = await gitGateWorkspace()
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: false })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    // No write/edit observation: the file changes on disk, as a pwsh edit leaves it.
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'engine.ts'), 'export const engine = 1\n', 'utf8')
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'shell-edit',
        name: 'pwsh',
        arguments: { command: 'Set-Content -Path src/engine.ts -Value "export const engine = 1"' },
      },
      gateShellResult(workspace),
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const text = steered(host)
    expect(text).toContain('changed implementation files in change "auth"')
    expect(text).toContain('lane assignment is missing in change "auth"')
  })

  it('counts a shell edit that is committed before the close', async () => {
    const workspace = await gitGateWorkspace()
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: true })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    // The edit and its commit both come from the shell: no write/edit
    // observation is recorded and the status is clean at the close.
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'engine.ts'), 'export const engine = 1\n', 'utf8')
    execFileSync('git', ['add', 'src/engine.ts'], { cwd: workspace, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'shell edit'], { cwd: workspace, stdio: 'ignore' })
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'shell-edit',
        name: 'pwsh',
        arguments: {
          command:
            'Set-Content -Path src/engine.ts -Value 1; git add src/engine.ts; git commit -m edit',
        },
      },
      gateShellResult(workspace),
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(steered(host)).toContain('changed implementation files in change "auth"')
    // The committed change still needs a current note like any other code change.
    const progressSteers = (): number =>
      host.steers.filter((message) => JSON.stringify(message).includes('task-progress')).length
    const refusals = progressSteers()
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | { execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }> }
      | undefined
    await tool?.execute(
      {
        action: 'note',
        change: 'auth',
        task: '1.1 Engine task',
        status: 'in-progress',
        reason: 'engine gate regression',
      },
      { agent: host.agent },
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(progressSteers()).toBe(refusals)
  })

  it('keeps earlier serial-lane decisions after a later serial note', async () => {
    const workspace = await gitGateWorkspace()
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: false })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await gateWrite(host, 'src/app.ts')
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | { execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }> }
      | undefined
    const note = (task: string): Promise<{ text: string }> | undefined =>
      tool?.execute(
        { action: 'note', change: 'auth', task, status: 'in-progress', reason: 'serial' },
        { agent: host.agent },
      )
    await note('2.1 Doc task')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(steered(host)).toContain('Lane: 1. Engine')
    const refusals = host.steers.length
    // The later note replaces the note file; the earlier serial decision stays.
    await note('1.1 Engine task')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.steers.length).toBe(refusals)
    expect(steered(host)).not.toContain('Lane: 2. Docs')
  })

  it('keeps a tagged worker assignment after the tool buffer evicts it', async () => {
    const workspace = await gitGateWorkspace()
    // Keep the unrelated checkpoint run out of this lane test: it also needs a
    // worker start, so its applicability would otherwise mask the gate refusal.
    const host = await engineGateHost(
      workspace,
      { taskProgress: false, laneFanout: false },
      { checkpointApplicability: { minToolCalls: 1000 } },
    )
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'worker-1',
        name: 'subagent',
        arguments: { prompt: 'lane-tag: auth#1. Implement lane 1.' },
      },
      { isError: false, content: [{ type: 'text', text: 'started' }] },
    )
    for (let index = 0; index < 100; index += 1) {
      await host.emit(
        'tools/result',
        { agent: host.agent, callId: `read-${String(index)}`, name: 'read', arguments: {} },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }
    // The tagged observation is evicted. THIS write stays in the buffer, so
    // attribution still names the change; the shell edit is its code change.
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'engine.ts'), 'export const engine = 1\n', 'utf8')
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'shell-edit',
        name: 'pwsh',
        arguments: { command: 'Set-Content -Path src/engine.ts -Value x' },
      },
      gateShellResult(workspace),
    )
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const text = steered(host)
    expect(text).toContain('Lane: 2. Docs')
    expect(text).not.toContain('Lane: 1. Engine')
  })

  it('does not gate implementation work after an involved change is archived', async () => {
    const workspace = await gitGateWorkspace()
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: false })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    // Archiving moves the change out of the active tree; its tasks.md is gone.
    const archive = join(workspace, 'openspec', 'changes', 'archive')
    await mkdir(archive, { recursive: true })
    await rename(join(workspace, 'openspec', 'changes', 'auth'), join(archive, '2026-11-16-auth'))
    await gateWrite(host, 'src/app.ts')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(steered(host)).not.toContain('change "auth"')
  })

  it('keeps a reviewed final tick after the observation buffer evicts it', async () => {
    const plan = '# Tasks\n\n- [ ] 1.1 First task\n'
    const workspace = await gitGateWorkspace(plan)
    // Keep the unrelated checkpoint run out of this close.
    const host = await engineGateHost(
      workspace,
      { taskProgress: false, laneFanout: true },
      { checkpointApplicability: { minToolCalls: 1000 } },
    )
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'tick-1',
        name: 'edit',
        arguments: { file_path: 'openspec/changes/auth/tasks.md' },
      },
      {
        isError: false,
        content: [{ type: 'text', text: 'ok' }],
        value: { before: plan, after: plan.replace('- [ ] 1.1', '- [x] 1.1') },
      },
    )
    const taskId = createHash('sha256').update('First task').digest('hex').slice(0, 16)
    // The ticked task is still checked in the live plan at the close.
    await writeFile(
      join(workspace, 'openspec', 'changes', 'auth', 'tasks.md'),
      plan.replace('- [ ] 1.1', '- [x] 1.1'),
      'utf8',
    )
    const record = join(workspace, '.dsh', 'workflows', 'records', 'task-review', 'auth', 'tasks')
    await mkdir(record, { recursive: true })
    await writeFile(
      join(record, `${taskId}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: 'auth',
        phase: 'task',
        scope: 'task',
        taskId,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-16T00:00:00.000Z',
      }),
      'utf8',
    )
    for (let index = 0; index < 100; index += 1) {
      await host.emit(
        'tools/result',
        { agent: host.agent, callId: `read-${String(index)}`, name: 'read', arguments: {} },
        { isError: false, content: [{ type: 'text', text: 'ok' }] },
      )
    }
    // The tick left the buffer after 100 results; the change write and the code
    // write keep this turn attributed and code-changing.
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await gateWrite(host, 'src/app.ts')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(steered(host)).not.toContain('rule "task-progress"')
  })

  it('does not reassign a renamed lane from an old worker tag', async () => {
    const workspace = await gitGateWorkspace()
    const host = await engineGateHost(workspace, { taskProgress: true, laneFanout: false })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'worker-1',
        name: 'subagent',
        arguments: { prompt: 'lane-tag: auth#1. Implement lane 1.' },
      },
      { isError: false, content: [{ type: 'text', text: 'started' }] },
    )
    // The captured lane title no longer exists; the old numeric tag must not
    // describe the replacement lane.
    await writeFile(
      join(workspace, 'openspec', 'changes', 'auth', 'tasks.md'),
      GATE_PLAN.replace('1. Engine', '1. Runtime').replace('1.1 Engine task', '1.1 Runtime task'),
      'utf8',
    )
    await seedSpecPass(workspace)
    await gateWrite(host, 'src/app.ts')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const text = steered(host)
    expect(text).toContain('Lane: 1. Runtime')
    expect(text).not.toContain('Lane: 1. Engine')
  })

  it('does not reassign a reordered lane from an old worker tag', async () => {
    const workspace = await gitGateWorkspace()
    const host = await engineGateHost(workspace, { taskProgress: true, laneFanout: false })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'worker-1',
        name: 'subagent',
        arguments: { prompt: 'lane-tag: auth#1. Implement lane 1.' },
      },
      { isError: false, content: [{ type: 'text', text: 'started' }] },
    )
    // The engine lane moved to position 2; the old tag's position 1 is now
    // another lane, which must stay unassigned.
    await writeFile(
      join(workspace, 'openspec', 'changes', 'auth', 'tasks.md'),
      [
        '# Tasks',
        '',
        '## 2. Docs (lane 2, owns `docs/**`)',
        '',
        '- [ ] 2.1 Doc task',
        '',
        '## 1. Engine (lane 1, owns `src/engine/**`)',
        '',
        '- [ ] 1.1 Engine task',
        '',
      ].join('\n'),
      'utf8',
    )
    await seedSpecPass(workspace)
    await gateWrite(host, 'src/app.ts')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const text = steered(host)
    expect(text).toContain('Lane: 2. Docs')
    expect(text).not.toContain('Lane: 1. Engine')
  })

  it('refuses a stale note and accepts a fresh one', async () => {
    const workspace = await gitGateWorkspace(`# Tasks\n\n- [ ] 1.1 First task\n`)
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: true })
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await gateWrite(host, 'src/app.ts')
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | { execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }> }
      | undefined
    const note = {
      action: 'note',
      change: 'auth',
      task: '1.1 First task',
      status: 'in-progress',
      reason: 'still open',
    }
    await tool?.execute(note, { agent: host.agent })
    // The worktree moves after the note: the recorded digest is now stale.
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 2\n', 'utf8')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const refused = steered(host)
    expect(refused).toContain('changed implementation files in change "auth"')
    expect(refused).toContain('stale')
    const refusals = host.steers.length
    await tool?.execute(note, { agent: host.agent })
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.steers.length).toBe(refusals)
  })

  it('attributes a note to its session so a note-only turn still refuses a stale close', async () => {
    const workspace = await gitGateWorkspace(`# Tasks\n\n- [ ] 1.1 First task\n`)
    // No other change write: only the note can attribute this change to the session.
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: true })
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | { execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }> }
      | undefined
    const note = {
      action: 'note',
      change: 'auth',
      task: '1.1 First task',
      status: 'in-progress',
      reason: 'still open',
    }
    await tool?.execute(note, { agent: host.agent })
    // The implementation changes after the note, so the note is stale.
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const refused = steered(host)
    expect(refused).toContain('changed implementation files in change "auth"')
    expect(refused).toContain('stale')
    const refusals = host.steers.length
    await tool?.execute(note, { agent: host.agent })
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(host.steers.length).toBe(refusals)
  })

  it('refuses an owned gate whose retained parity replay is not certified', async () => {
    const workspace = await gitGateWorkspace(`# Tasks\n\n- [ ] 1.1 First task\n`)
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'app.ts'), 'export const app = 1\n', 'utf8')
    const real = JSON.parse(
      readFileSync(
        fileURLToPath(new URL('../assets/parity/retire-legacy-gates.json', import.meta.url)),
        'utf8',
      ),
    ) as { retained: Record<string, unknown> }
    parityMock.active = true
    parityMock.report = {
      ...real,
      retained: {
        ...real.retained,
        'task-progress': { cases: 4, replayed: 3, status: 'failed' },
      },
    }
    try {
      const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: true })
      await gateWrite(host, 'openspec/changes/auth/proposal.md')
      await gateWrite(host, 'src/app.ts')
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      const refused = steered(host)
      expect(refused).toContain('rule "task-progress"')
      expect(refused).toContain('did not replay')
      expect(refused).toContain('fix the parity report')
    } finally {
      parityMock.active = false
      parityMock.report = undefined
      parityMock.error = undefined
      parityMock.path = undefined
    }
  })

  it('refuses goal completion without a portable PASS and allows it with one', async () => {
    const workspace = await tempWorkspace()
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(change, { recursive: true })
    await writeFile(join(change, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n', 'utf8')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const complete = async (): Promise<{
      decision?: { kind?: string; reason?: string }
      nextCalled: boolean
    }> => {
      let nextCalled = false
      const decision = (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId: 'goal-1',
          name: 'update_goal',
          arguments: { action: 'complete' },
        },
        async () => {
          nextCalled = true
          return { kind: 'continue' }
        },
      )) as { kind?: string; reason?: string } | undefined
      return { ...(decision === undefined ? {} : { decision }), nextCalled }
    }
    const refused = await complete()
    expect(refused.nextCalled).toBe(false)
    expect(refused.decision?.kind).toBe('deny')
    expect(refused.decision?.reason).toContain('goal completion refused')
    expect(refused.decision?.reason).toContain('no portable task-review PASS')
    const taskId = createHash('sha256').update('First task').digest('hex').slice(0, 16)
    await mkdir(join(change, 'reviews'), { recursive: true })
    await writeFile(
      join(change, 'reviews', `${taskId}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: 'auth',
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
    const allowed = await complete()
    expect(allowed.nextCalled).toBe(true)
    expect(allowed.decision?.kind).toBe('continue')
  })
})

describe('archived change involvement', () => {
  interface RecordedRun {
    readonly id: string
    readonly definition: { readonly id: string }
  }

  /** The whole-spec review rounds the host recorded, archived ones included. */
  async function specReviewRuns(workspace: string): Promise<RecordedRun[]> {
    const directory = join(workspace, '.dsh', 'workflows', 'runs')
    const files = (await readdir(directory).catch(() => [])).filter((name) =>
      name.endsWith('.json'),
    )
    const runs = await Promise.all(
      files.map(
        async (name) => JSON.parse(await readFile(join(directory, name), 'utf8')) as RecordedRun,
      ),
    )
    return runs.filter((run) => run.definition.id === 'spec-review')
  }

  /** Move the fixture change out of the active tree the way an archive does. */
  async function archiveFixture(workspace: string): Promise<void> {
    const directory = join(workspace, 'openspec', 'changes', 'archive')
    await mkdir(directory, { recursive: true })
    await rename(join(workspace, 'openspec', 'changes', 'auth'), join(directory, '2026-11-18-auth'))
  }

  /** The undated archive layout a supported `git mv` produces. */
  async function archiveFixtureUndated(workspace: string): Promise<void> {
    const directory = join(workspace, 'openspec', 'changes', 'archive')
    await mkdir(directory, { recursive: true })
    await rename(join(workspace, 'openspec', 'changes', 'auth'), join(directory, 'auth'))
  }

  /** A host whose close starts the whole-spec round: no seeded PASS record. */
  async function reviewGateHost(workspace: string): Promise<ReturnType<typeof fakeHost>> {
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: false })
    await rm(join(workspace, '.dsh', 'workflows', 'records', 'spec-review'), {
      recursive: true,
      force: true,
    })
    return host
  }

  it('starts no review round for a stored involvement that names an archived change', async () => {
    const workspace = await gitGateWorkspace()
    // A durable record from an earlier host still names the change.
    await mkdir(join(workspace, '.dsh', 'workflows', 'involvement'), { recursive: true })
    await writeFile(
      join(workspace, '.dsh', 'workflows', 'involvement', 'session-1.json'),
      `${JSON.stringify({ changes: ['auth'], at: 1 })}\n`,
      'utf8',
    )
    await archiveFixture(workspace)
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: false })
    const steers = host.steers.length
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    expect(await specReviewRuns(workspace)).toEqual([])
    expect(host.steers.length).toBe(steers)
  })

  it('does not hold the close for a failed review run of a change archived after its round', async () => {
    const workspace = await gitGateWorkspace()
    const host = await reviewGateHost(workspace)
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(async () => (await specReviewRuns(workspace)).length === 1)
    // The failed round holds the close while the change is still active.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    expect(steered(host)).toContain('due review unit(s) have no live review')
    const rounds = (await specReviewRuns(workspace)).length
    await archiveFixture(workspace)
    const steers = host.steers.length
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 3 })
    expect(host.steers.length).toBe(steers)
    expect((await specReviewRuns(workspace)).length).toBe(rounds)
  })

  for (const [layout, move] of [
    ['dated', archiveFixture],
    ['undated', archiveFixtureUndated],
  ] as const) {
    it(`settles an archived change review run cancelled (${layout} archive)`, async () => {
      const workspace = await gitGateWorkspace()
      const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: false })
      const runs = await import('../src/host/runs.ts')
      const { HostAuth } = await import('../src/host/host-auth.ts')
      const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
      const definition = definitionsRegistry.installed('spec-review')?.definition
      expect(definition).toBeDefined()
      if (definition === undefined) return
      const run = runs.createRun({
        definition: 'spec-review',
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { name: 'auth' },
        steps: definition.steps.map((step) => step.id),
        id: `run-archived-review-${layout}`,
        now: 1_000,
      })
      await runs.writeRun(workspace, run, auth)
      await move(workspace)
      const stored = join(
        workspace,
        '.dsh',
        'workflows',
        'runs',
        `run-archived-review-${layout}.json`,
      )
      const steers = host.steers.length
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
      // The archived run is settled cancelled once instead of being reviewed:
      // no failed attempt, no refusal, no second round, and no rewrite later.
      const settled = JSON.parse(await readFile(stored, 'utf8')) as {
        status: string
        reason?: string
      }
      expect(settled.status).toBe('cancelled')
      expect(settled.reason).toContain('archived')
      expect(host.steers.length).toBe(steers)
      expect((await specReviewRuns(workspace)).length).toBe(1)
      const after = await readFile(stored, 'utf8')
      await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
      expect(await readFile(stored, 'utf8')).toBe(after)
    })
  }

  it('leaves a terminal archived review run unchanged', async () => {
    const workspace = await gitGateWorkspace()
    const host = await engineGateHost(workspace, { taskProgress: false, laneFanout: false })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = definitionsRegistry.installed('task-review')?.definition
    expect(definition).toBeDefined()
    if (definition === undefined) return
    const run = runs.createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth', taskId: '1111111111111111' },
      steps: definition.steps.map((step) => step.id),
      id: 'run-archived-terminal',
      now: 1_000,
    })
    await runs.writeRun(workspace, runs.setRunStatus(run, 'failed', 2_000), auth)
    await archiveFixture(workspace)
    const stored = join(workspace, '.dsh', 'workflows', 'runs', 'run-archived-terminal.json')
    const before = await readFile(stored, 'utf8')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    // Only an unresolved run settles cancelled; a terminal task-review run is
    // still eligible for the gate walk and must keep its history.
    expect(await readFile(stored, 'utf8')).toBe(before)
  })

  it('reads one identity per archive entry', async () => {
    const workspace = await gitGateWorkspace()
    const directory = join(workspace, 'openspec', 'changes', 'archive')
    await mkdir(join(directory, '2026-11-18-auth'), { recursive: true })
    await mkdir(join(directory, 'billing'), { recursive: true })
    const { archivedChangeNames } = await import('../src/host/engine-gates.ts')
    const archived = await archivedChangeNames(workspace)
    expect(archived.has('auth')).toBe(true)
    expect(archived.has('billing')).toBe(true)
    // A date-prefixed entry is the dated layout only: a missing change whose
    // name merely spells that string keeps its refusal.
    await mkdir(join(directory, '2026-01-01-keep'), { recursive: true })
    const withAmbiguous = await archivedChangeNames(workspace)
    expect(withAmbiguous.has('keep')).toBe(true)
    expect(withAmbiguous.has('2026-01-01-keep')).toBe(false)
  })

  it('releases the admission slot of a settled archived review', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await gitGateWorkspace()
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const host = fakeHost(workspace)
    apply(host.ctx as never, { maxRuns: 1 })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const definition = definitionsRegistry.installed('spec-review')?.definition
    expect(definition).toBeDefined()
    if (definition === undefined) return
    const run = runs.createRun({
      definition: 'spec-review',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: definition.steps.map((step) => step.id),
      id: 'run-archived-slot',
      now: 1_000,
    })
    await runs.writeRun(workspace, run, auth)
    await archiveFixture(workspace)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    // The settled run no longer occupies the single slot: the unrelated intake
    // starts instead of being refused by the run limit.
    const decision = (await host.emit(
      'tools/pre-execute',
      {
        agent: host.agent,
        callId: 'intake-beta',
        name: 'pwsh',
        arguments: { command: 'openspec new change beta' },
      },
      async () => ({ kind: 'continue' }),
    )) as { kind?: string; reason?: string }
    expect(decision.kind).toBe('deny')
    expect(decision.reason ?? '').not.toContain('run limit')
    const started = (await runs.listAuthenticatedRuns(workspace, auth)).filter(
      (entry) => entry.definition.id === 'change-intake' && entry.context.name === 'beta',
    )
    expect(started).toHaveLength(1)
  })

  it('keeps starting the round for an active involved change', async () => {
    const workspace = await gitGateWorkspace()
    const host = await reviewGateHost(workspace)
    await gateWrite(host, 'openspec/changes/auth/proposal.md')
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    await waitFor(async () => (await specReviewRuns(workspace)).length === 1)
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 2 })
    expect(steered(host)).toContain('due review unit(s) have no live review')
  })
})

describe('public review start through the workflows tool', () => {
  const TASK = 'Task'

  async function reviewWorkspace(): Promise<{ dir: string; taskId: string }> {
    const dir = await tempWorkspace()
    const change = join(dir, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    await writeFile(join(dir, '.gitignore'), '.dsh/\n', 'utf8')
    await writeFile(join(change, 'proposal.md'), '# Proposal\n', 'utf8')
    await writeFile(join(change, 'design.md'), '# Design\n', 'utf8')
    await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# Spec\n', 'utf8')
    await writeFile(join(change, 'tasks.md'), `- [x] 1.1 ${TASK}\n`, 'utf8')
    await mkdir(join(dir, 'openspec'), { recursive: true })
    await writeFile(
      join(dir, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true }),
      'utf8',
    )
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'review')
    git('config', 'user.email', 'review@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    return { dir, taskId: taskIdOf(TASK) }
  }

  function reviewerStub(failFirst = false): {
    runtime: unknown
    releases: Array<() => void>
    state: { fail: boolean }
  } {
    const releases: Array<() => void> = []
    const state = { fail: failFirst }
    const runtime = {
      getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
      startActivation: async (spec: { prompt: { text: string }[] }) => {
        if (state.fail) {
          throw Object.assign(new Error('the review config is invalid'), { name: 'ConfigError' })
        }
        const instruction = spec.prompt.map((block) => block.text).join('\n')
        const digest = /- Digest: ([a-f0-9]{64})/u.exec(instruction)?.[1] ?? ''
        const pending = new Promise<void>((resolve) => {
          releases.push(resolve)
        })
        return {
          childId: `child-${releases.length}`,
          result: pending.then(() => ({
            output: [
              {
                type: 'text',
                text: `\`\`\`json\n${JSON.stringify({ digest, verdict: 'PASS', findings: [] })}\n\`\`\``,
              },
            ],
            stopReason: 'completed',
          })),
          dispose: async () => {},
        }
      },
    }
    return { runtime, releases, state }
  }

  async function runStart(
    host: ReturnType<typeof fakeHost>,
    args: Record<string, unknown>,
  ): Promise<string> {
    const tool = host.toolDefinitions.find((entry) => entry.name === 'workflows') as
      | {
          execute: (args: unknown, exec: { agent: unknown }) => Promise<{ text: string }>
        }
      | undefined
    if (tool === undefined) throw new Error('the workflows tool is missing')
    const started = await tool.execute(args, { agent: host.agent })
    return started.text
  }

  async function start(
    host: ReturnType<typeof fakeHost>,
    definitionId: string,
    taskId: string,
  ): Promise<string> {
    return runStart(host, { action: 'start', definitionId, change: 'auth', task: taskId })
  }

  async function approvalFor(dir: string, taskId: string): Promise<Record<string, unknown>> {
    const file = join(dir, 'openspec', 'changes', 'auth', 'reviews', `${taskId}.json`)
    await waitFor(async () => (await readFile(file, 'utf8').catch(() => '')) !== '')
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  }

  it('executes the printed shipped task-review call and audits the runtime approval', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { dir, taskId } = await reviewWorkspace()
    const stub = reviewerStub()
    const host = fakeHost(dir, { subagents: stub.runtime })
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    const text = await start(host, 'task-review', taskId)
    expect(text).toContain('started at step "review"')
    await waitFor(() => stub.releases.length > 0)
    stub.releases.shift()?.()
    const record = await approvalFor(dir, taskId)
    expect(record.rule).toBe('task-review')
    expect(record.verdict).toBe('PASS')
    const audit = await auditActive(dir, 'auth')
    expect(audit.ok, audit.lines.join('\n')).toBe(true)
  })

  it('publishes an approval the audit accepts for a non-default taskRule', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { dir, taskId } = await reviewWorkspace()
    await writeFile(
      join(dir, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'focused-rereview' }),
      'utf8',
    )
    const unregister = definitionsRegistry.register({
      source: 'workflows-test',
      definitions: [
        {
          v: 1,
          id: 'focused-rereview',
          name: 'Focused re-review',
          version: 1,
          trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
          settings: {
            allowModelStart: true,
            risk: 'low',
            gateOwnership: 'own',
            maxBlocks: 3,
            allowIntent: false,
            gate: 'review',
            gateIdentity: 'focused-rereview',
          },
          steps: [
            {
              id: 'review',
              title: 'Review the checked task',
              executor: 'review',
              review: { target: 'codex', instruction: 'review-task', scope: 'task' },
              evidence: {
                kind: 'record',
                rule: 'focused-rereview',
                change: '{name}',
                scope: 'task',
                task: '{taskId}',
                verdicts: ['PASS', 'ERROR'],
                path: '.dsh/workflows/records/focused-rereview/{name}/tasks/{taskId}.json',
              },
              next: 'end',
              blockTurnClose: true,
            },
          ],
        },
      ],
    })
    try {
      const stub = reviewerStub()
      const host = fakeHost(dir, { subagents: stub.runtime })
      apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
      const text = await start(host, 'focused-rereview', taskId)
      expect(text).toContain('started at step "review"')
      await waitFor(() => stub.releases.length > 0)
      stub.releases.shift()?.()
      const record = await approvalFor(dir, taskId)
      expect(record.rule).toBe('focused-rereview')
      const audit = await auditActive(dir, 'auth')
      expect(audit.ok).toBe(true)
    } finally {
      unregister()
    }
  })
  async function sectionWorkspace(tasks: string): Promise<string> {
    const dir = await tempWorkspace()
    const change = join(dir, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    await writeFile(join(dir, '.gitignore'), '.dsh/\n', 'utf8')
    await writeFile(join(change, 'proposal.md'), '# Proposal\n', 'utf8')
    await writeFile(join(change, 'design.md'), '# Design\n', 'utf8')
    await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# Spec\n', 'utf8')
    await writeFile(join(change, 'tasks.md'), `# Tasks\n\n## 1. Engine\n\n${tasks}`, 'utf8')
    await mkdir(join(dir, 'openspec'), { recursive: true })
    await writeFile(
      join(dir, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true }),
      'utf8',
    )
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'review')
    git('config', 'user.email', 'review@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    return dir
  }

  it('reuses a blocked task review for a section that it fully covers', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const dir = await sectionWorkspace('- [x] 1.1 Task\n')
    const stub = reviewerStub()
    const host = fakeHost(dir, { subagents: stub.runtime })
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    const first = await runStart(host, {
      action: 'start',
      definitionId: 'task-review',
      change: 'auth',
      task: 'Task',
    })
    await waitFor(() => stub.releases.length > 0)
    const second = await runStart(host, {
      action: 'start',
      definitionId: 'task-review',
      change: 'auth',
      section: '1',
    })
    const firstId = /run (\S+) started/u.exec(first)?.[1] ?? ''
    expect(second).toContain(firstId)
    expect(stub.releases.length).toBe(1)
    stub.releases.shift()?.()
  })

  it('refuses a section start that only partially overlaps a live task review', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const dir = await sectionWorkspace('- [x] 1.1 Task\n- [x] 1.2 Second\n')
    const stub = reviewerStub()
    const host = fakeHost(dir, { subagents: stub.runtime })
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    await runStart(host, {
      action: 'start',
      definitionId: 'task-review',
      change: 'auth',
      task: 'Task',
    })
    await waitFor(() => stub.releases.length > 0)
    await expect(
      runStart(host, {
        action: 'start',
        definitionId: 'task-review',
        change: 'auth',
        section: '1',
      }),
    ).rejects.toThrow(/overlaps|does not cover/u)
    expect(stub.releases.length).toBe(1)
    stub.releases.shift()?.()
  })

  it('allows a waiting close with eight live reviews and submits no steer', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const dir = await tempWorkspace()
    const change = join(dir, 'openspec', 'changes', 'auth')
    await mkdir(change, { recursive: true })
    await writeFile(join(dir, '.gitignore'), '.dsh/\n', 'utf8')
    await writeFile(join(change, 'proposal.md'), '# Proposal\n', 'utf8')
    const sections = [1, 2, 3, 4, 5, 6, 7, 8].map(
      (n) => `## ${String(n)}. Lane ${String(n)}\n\n- [x] ${String(n)}.1 Task ${String(n)}\n`,
    )
    await writeFile(join(change, 'tasks.md'), `# Tasks\n\n${sections.join('\n')}`, 'utf8')
    await mkdir(join(dir, 'openspec'), { recursive: true })
    await writeFile(
      join(dir, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true }),
      'utf8',
    )
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'review')
    git('config', 'user.email', 'review@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    const stub = reviewerStub()
    const host = fakeHost(dir, { subagents: stub.runtime })
    apply(host.ctx as never, { reviewers: { codex: { provider: 'codex-subagent' } } })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'involved-write',
        name: 'write',
        arguments: { file_path: 'openspec/changes/auth/design.md' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    const before = host.steers.length
    // The close itself starts every due lane, then waits for their verdicts: a
    // waiting close submits nothing and starts no step.
    await host.emit('agent/turn-stopping', { agent: host.agent, turn: 1 })
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const all = await runs.listAuthenticatedRuns(dir, auth)
    const lanes = all.filter((entry) => entry.definition.id === 'task-review')
    expect(lanes).toHaveLength(8)
    for (const lane of lanes) {
      expect(lane.status).toBe('blocked')
      expect(lane.steps.find((step) => step.id === 'review')?.state).toBe('open')
    }
    await waitFor(() => stub.releases.length >= 8, 10_000)
    // The waiting close is silent: eight live reviews, no steer, no step.
    expect(host.steers.length).toBe(before)
  })

  it('keeps a retry attempt and its failure class through the lifecycle write and after settlement', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { dir, taskId } = await reviewWorkspace()
    const runtime = {
      getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
      startActivation: async () => {
        throw new Error('the provider active child limit is reached')
      },
    }
    const host = fakeHost(dir, { subagents: runtime })
    apply(host.ctx as never, {
      reviewers: { codex: { provider: 'codex-subagent' } },
      reviewQueue: { enabled: true, maxAttempts: 2, baseDelayMs: 400, maxDelayMs: 400 },
    })
    await start(host, 'task-review', taskId)
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const runId = (await runs.listAuthenticatedRuns(dir, auth)).find(
      (entry) => entry.definition.id === 'task-review',
    )?.id
    if (runId === undefined) throw new Error('the review run is missing')
    // During the retry backoff the persisted review step keeps the attempt and
    // its failure class instead of the pre-admission lifecycle write erasing it.
    await waitFor(async () => {
      const stored = await runs.readAuthenticatedRun(dir, runId, auth)
      const step = stored?.steps.find((entry) => entry.id === 'review')
      return step?.attempts === 1 && step?.failureClass === 'child-limit'
    }, 5_000)
    // After the second attempt exhausts the transport retries, the facts stay
    // visible on the settled step and in its record.
    const recordPath = join(
      dir,
      '.dsh',
      'workflows',
      'records',
      'task-review',
      'auth',
      'tasks',
      `${taskId}.json`,
    )
    await waitFor(async () => (await readFile(recordPath, 'utf8').catch(() => '')) !== '', 10_000)
    const stored = await runs.readAuthenticatedRun(dir, runId, auth)
    const step = stored?.steps.find((entry) => entry.id === 'review')
    expect(step?.attempts).toBe(2)
    // A contract-settled (done) step never inherits the old retry class; a
    // failed or blocked attempt keeps the class for its refusal diagnostic.
    if (step?.state === 'done') expect(step.failureClass).toBeUndefined()
    else expect(step?.failureClass).toBe('child-limit')
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
    expect(record.attempts).toBe(2)
    expect(record.failureClass).toBe('child-limit')
  })

  it('clears the retry failure class and keeps the count when the retry passes', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const { dir, taskId } = await reviewWorkspace()
    let calls = 0
    const runtime = {
      getProvider: (provider: string) => (provider === 'codex-subagent' ? {} : undefined),
      startActivation: async (spec: { prompt: Array<{ text: string }> }) => {
        calls += 1
        if (calls === 1) throw new Error('the provider active child limit is reached')
        const instruction = spec.prompt.map((block) => block.text).join('\n')
        const digest = /- Digest: ([a-f0-9]{64})/u.exec(instruction)?.[1] ?? ''
        return {
          childId: 'child-2',
          result: Promise.resolve({
            output: [
              {
                type: 'text',
                text: `\`\`\`json\n${JSON.stringify({ digest, verdict: 'PASS', findings: [] })}\n\`\`\``,
              },
            ],
            stopReason: 'completed',
          }),
          dispose: async () => undefined,
        }
      },
    }
    const host = fakeHost(dir, { subagents: runtime })
    apply(host.ctx as never, {
      reviewers: { codex: { provider: 'codex-subagent' } },
      reviewQueue: { enabled: true, maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 100 },
    })
    await start(host, 'task-review', taskId)
    const runs = await import('../src/host/runs.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const runId = (await runs.listAuthenticatedRuns(dir, auth)).find(
      (entry) => entry.definition.id === 'task-review',
    )?.id
    if (runId === undefined) throw new Error('the review run is missing')
    const recordPath = join(
      dir,
      '.dsh',
      'workflows',
      'records',
      'task-review',
      'auth',
      'tasks',
      `${taskId}.json`,
    )
    await waitFor(
      async () =>
        (await runs.readAuthenticatedRun(dir, runId, auth))?.steps.find(
          (step) => step.id === 'review',
        )?.state === 'done',
      10_000,
    )
    const stored = await runs.readAuthenticatedRun(dir, runId, auth)
    const step = stored?.steps.find((entry) => entry.id === 'review')
    // The successful settlement keeps the final attempt count and must not
    // restore the earlier retry's failure class.
    expect(step?.attempts).toBe(2)
    expect(step?.failureClass).toBeUndefined()
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
    expect(record.verdict).toBe('PASS')
    expect(record.failureClass).toBeUndefined()
  })

  it('fails a review loud and discards its snapshot when the review queue is off', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const dir = await sectionWorkspace('- [x] 1.1 Task\n')
    const stub = reviewerStub()
    const host = fakeHost(dir, { subagents: stub.runtime })
    apply(host.ctx as never, {
      reviewers: { codex: { provider: 'codex-subagent' } },
      reviewQueue: { enabled: false },
    })
    await runStart(host, {
      action: 'start',
      definitionId: 'task-review',
      change: 'auth',
      section: '1',
    })
    const { sectionRecordId } = await import('../src/host/tasks.ts')
    const recordPath = join(
      dir,
      '.dsh',
      'workflows',
      'records',
      'task-review',
      'auth',
      'tasks',
      `${sectionRecordId('1')}.json`,
    )
    await waitFor(async () => (await readFile(recordPath, 'utf8').catch(() => '')) !== '')
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
    expect(record).toMatchObject({ verdict: 'ERROR', failureClass: 'config' })
    expect(String(record.error)).toContain('reviewQueue')
    expect(stub.releases).toHaveLength(0)
    const { readdir } = await import('node:fs/promises')
    const snapshots = await readdir(join(dir, '.dsh', 'workflows', 'snapshots')).catch(() => [])
    expect(snapshots).toHaveLength(0)
  })
})

describe('agent archive integration review requirement', () => {
  it('refuses a missing or stale integration PASS and allows a current one', async () => {
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const change = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(change, 'specs', 'auth'), { recursive: true })
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'src', 'engine.ts'), 'export const engine = 1\n', 'utf8')
    await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
    for (const file of ['proposal.md', 'design.md']) {
      await writeFile(join(change, file), '# artifact\n', 'utf8')
    }
    await writeFile(join(change, 'specs', 'auth', 'spec.md'), '# spec\n', 'utf8')
    await writeFile(join(change, 'tasks.md'), '- [x] 1.1 Complete work\n', 'utf8')
    const { currentSpecDigest, reviewDigest } = await import('../src/host/evidence.ts')
    const { defaultGit } = await import('../src/host/git.ts')
    const { reviewInputTree } = await import('../src/host/review-snapshot.ts')
    const { taskIdOf } = await import('../src/host/tasks.ts')
    const { HostAuth } = await import('../src/host/host-auth.ts')
    const receipts = await import('../src/host/receipts.ts')
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const specDigest = await currentSpecDigest(workspace, 'auth')
    expect(specDigest).toBeDefined()
    // Otherwise valid authorization: a current whole-spec PASS, an adoption
    // receipt, and the portable coverage the archive audit requires.
    const specRecord = join(workspace, '.dsh', 'workflows', 'records', 'spec-review', 'auth')
    await mkdir(specRecord, { recursive: true })
    await writeFile(
      join(specRecord, 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest: specDigest, findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    await receipts.issueAdoptionReceipt(workspace, 'auth', specDigest as string, auth, 3_000)
    const taskId = taskIdOf('Complete work')
    await mkdir(join(change, 'reviews'), { recursive: true })
    await writeFile(
      join(change, 'reviews', `${taskId}.json`),
      `${JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId, digest: 'a'.repeat(64), verdict: 'PASS', findings: [], target: { provider: 'codex-subagent' }, time: '2026-11-08T00:00:00.000Z' })}\n`,
      'utf8',
    )
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'archive-test')
    git('config', 'user.email', 'archive-test@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    const host = fakeHost(workspace)
    apply(host.ctx as never)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const archive = async (
      callId: string,
    ): Promise<{ kind?: string; reason?: string } | undefined> =>
      (await host.emit(
        'tools/pre-execute',
        {
          agent: host.agent,
          callId,
          name: 'pwsh',
          arguments: { command: 'openspec archive auth' },
        },
        async () => ({ kind: 'continue' }),
      )) as { kind?: string; reason?: string } | undefined
    // The production listener refuses the agent archive without an integration
    // record, and names the required review.
    const missing = await archive('archive-missing-integration')
    expect(missing?.kind).toBe('deny')
    expect(missing?.reason).toContain('integration-review')
    const integrationRecord = join(
      workspace,
      '.dsh',
      'workflows',
      'records',
      'integration-review',
      'auth',
    )
    await mkdir(integrationRecord, { recursive: true })
    const tree = await reviewInputTree(
      workspace,
      { dir: change },
      defaultGit,
      AbortSignal.timeout(10_000),
    )
    await writeFile(
      join(integrationRecord, 'integration.json'),
      `${JSON.stringify({ rule: 'integration-review', change: 'auth', phase: 'integration', scope: 'whole', verdict: 'PASS', digest: reviewDigest({ scope: 'whole', specDigest: specDigest as string, tree }), findings: [], time: '2026-11-08T00:00:00.000Z', target: { provider: 'codex-subagent' } })}\n`,
      'utf8',
    )
    const allowed = await archive('archive-current-integration')
    if (allowed?.kind === 'deny') throw new Error(`current integration denied: ${allowed.reason}`)
    expect(allowed?.kind).not.toBe('deny')
    // A code-only change moves the frozen content tree: the same PASS is stale
    // and the agent archive is refused again.
    await writeFile(join(workspace, 'src', 'engine.ts'), 'export const engine = 2\n', 'utf8')
    const stale = await archive('archive-stale-integration')
    expect(stale?.kind).toBe('deny')
    expect(stale?.reason).toContain('integration-review')
  })
})
