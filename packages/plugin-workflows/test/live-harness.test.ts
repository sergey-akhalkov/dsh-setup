import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadShippedDefinitions, validateDefinition } from '../src/host/definitions.ts'
import { writeDraft } from '../src/host/drafts.ts'
import { currentSpecDigest } from '../src/host/evidence.ts'
import { runSubagentStep } from '../src/host/executors.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { hashSession } from '../src/host/projection.ts'
import { listReceipts } from '../src/host/receipts.ts'
import { cancelRun, recoverRuns, resumeRun } from '../src/host/resume.ts'
import {
  createRun,
  DAY_MS,
  listAuthenticatedRuns,
  pruneRuns,
  readAuthenticatedRun,
  runPath,
  writeRun,
} from '../src/host/runs.ts'

/**
 * Automated live-session proxy for task 7.3. It drives the real plugin entry
 * with a live-session-shaped host, a real journal, a producer checkpoint, a
 * delegate result, and a review record, then reads the same Fetch routes the
 * Workflows view calls. Opening the actual Web view needs an installed profile
 * and is recorded as the remaining manual step in the change.
 */

type Listener = (...args: unknown[]) => unknown

interface Route {
  readonly path: string
  readonly methods: readonly string[]
  readonly requestBody: string
  fetch(request: Request): Promise<Response>
}

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-live-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const started = Date.now()
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('the live proxy did not settle in time')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

describe('live-session proxy', () => {
  it('shows a checkpoint, a delegate run, and a review in the session timeline', async () => {
    const workspace = await tempWorkspace()
    const listeners = new Map<string, Listener[]>()
    const routes: Route[] = []
    const add = (name: string, listener: Listener): void => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
    }
    const agent = {
      id: 'session-live',
      session: { id: 'session-live', header: { origin: 'root' } },
      ctx: {
        on(name: string, listener: Listener): () => void {
          add(name, listener)
          return () => {}
        },
      },
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
          return {
            fetch: {
              register: (route: Route) => {
                routes.push(route)
                return () => {}
              },
            },
          }
        }
        return undefined
      },
      on(name: string, listener: Listener): () => void {
        add(name, listener)
        return () => {}
      },
      effect: (callback: () => () => void) => {
        callback()
        return () => {}
      },
    }
    const emit = (name: string, ...args: unknown[]): unknown => {
      let result: unknown
      for (const listener of listeners.get(name) ?? []) result = listener(...args)
      return result
    }

    apply(ctx as never)
    await emit(
      'agent/pre-step',
      {
        agent,
        turn: 1,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
        modelSelection: { provider: 'p', model: 'm' },
      },
      async () => ({ kind: 'continue' }),
    )

    // A producer checkpoint for this session (the hashed directory is the
    // producer's own layout; the directory name is never read as a session id).
    const checkpointDirectory = join(
      workspace,
      '.dsh',
      'work-checkpoints',
      hashSession('session-live'),
    )
    await mkdir(checkpointDirectory, { recursive: true })
    await writeFile(
      join(checkpointDirectory, '1.json'),
      JSON.stringify({
        version: 2,
        checkpoint: 'checkpoint-1-abc',
        revision: 1,
        turn: 1,
        outcome: 'continue',
        verified: ['the proxy test passes'],
        lanes: [],
        laneAges: [],
        derivedRemaining: [],
        parallelComputed: false,
        next: 'finish',
        time: '2026-11-07T10:00:00.000Z',
      }),
      'utf8',
    )

    // A delegate result observed in the live session; the projection uses the
    // run handle for attribution.
    emit(
      'tools/result',
      { agent, callId: 'call-delegate', name: 'delegate', arguments: {} },
      {
        isError: false,
        content: [
          {
            type: 'text',
            text: 'rule "task-review" review started\nrun: run-mw6live-1234abcd\nstate: running',
          },
        ],
      },
    )
    const runDirectory = join(workspace, '.dsh', 'delegation', 'runs')
    await mkdir(runDirectory, { recursive: true })
    await writeFile(
      join(runDirectory, 'run-mw6live-1234abcd.json'),
      JSON.stringify({
        id: 'run-mw6live-1234abcd',
        rule: 'task-review',
        change: 'add-workflow-observability',
        key: 'k',
        identity: 'i',
        state: 'completed',
        record: '.dsh/delegation/task-review/add-workflow-observability/tasks/x.json',
        startedAt: '2026-11-07T10:05:00.000Z',
      }),
      'utf8',
    )

    const route = (path: string): Route => {
      const found = routes.find((candidate) => candidate.path === path)
      if (found === undefined) throw new Error(`no route ${path}`)
      return found
    }
    const read = async (path: string): Promise<Record<string, unknown>> => {
      const response = await route(path).fetch(
        new Request(`http://localhost${path}?session=session-live`),
      )
      expect(response.status).toBe(200)
      return (await response.json()) as Record<string, unknown>
    }

    await waitFor(async () => {
      const runs = (await read('/api/workflows/runs')) as { runs?: unknown[] }
      return (runs.runs?.length ?? 0) >= 2
    })
    const runs = (await read('/api/workflows/runs')) as {
      runs: Array<{ source: string; attribution: string }>
    }
    expect(runs.runs.map((entry) => entry.source)).toEqual(['checkpoint', 'delegation'])
    for (const entry of runs.runs) expect(entry.attribution).toBe('local')

    const triggers = (await read('/api/workflows/triggers')) as {
      triggers: Array<{ id: string; last?: { reason: string } }>
    }
    expect(
      triggers.triggers.find((trigger) => trigger.id === 'delegate-result')?.last?.reason,
    ).toBe('would-fire')

    const events = (await read('/api/workflows/events')) as {
      events: Array<{ kind: string; triggers?: Array<{ id: string; reason: string }> }>
    }
    const delegate = events.events.find((event) => event.kind === 'tools/result')
    expect(
      delegate?.triggers?.find((evaluation) => evaluation.id === 'delegate-result')?.reason,
    ).toBe('would-fire')

    const health = (await read('/api/workflows/health')) as { state: string; listenerCount: number }
    expect(health.listenerCount).toBeGreaterThanOrEqual(5)
    expect(['waiting', 'healthy']).toContain(health.state)
  })
})

describe('obligation engine live proxy', () => {
  it('drives the intake through the host, caps a close, resumes after restart, adopts, and archives after pruning', async () => {
    const KEY = 'a'.repeat(64)
    process.env.DSH_WORKFLOWS_HOST_KEY = KEY
    const workspace = await tempWorkspace()
    const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
    const definition = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
    if (definition === undefined) throw new Error('the change-intake definition is missing')
    const listeners = new Map<string, Listener[]>()
    const routes: Route[] = []
    const commands: Array<{
      name: string
      handler: (invocation: unknown) => Promise<{ kind?: string; text?: string }>
    }> = []
    const steers: string[] = []
    const add = (name: string, listener: Listener): void => {
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
    }
    const agent = {
      id: 'session-live',
      session: { id: 'session-live', header: { origin: 'root' } },
      ctx: { on: () => () => {} },
      steer: (message: { content?: Array<{ text?: string }> }) => {
        const text = message?.content?.[0]?.text
        if (typeof text === 'string') steers.push(text)
      },
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
          return {
            fetch: {
              register: (entry: Route) => {
                routes.push(entry)
                return () => {}
              },
            },
          }
        }
        if (name === 'commands') {
          return {
            register: (command: unknown) => {
              commands.push(command as never)
              return () => {}
            },
          }
        }
        if (name === 'userQuestions') {
          return {
            ask: async (request: { questions: Array<{ id: string }> }) => ({
              answers: request.questions.map((question) => ({
                id: question.id,
                selected: ['yes'],
              })),
            }),
          }
        }
        if (name === 'subagents') {
          return {
            startActivation: async (spec: { provider: string }) => ({
              childId: `child-${spec.provider}`,
              result: Promise.resolve({
                stopReason: 'completed',
                output: [{ type: 'text', text: 'the child completed' }],
                structured: { verdict: 'PASS' },
              }),
              dispose: async () => {},
            }),
          }
        }
        if (name === 'tools') {
          return {
            get: (tool: string) =>
              ['delegate', 'task_progress', 'delegation_status', 'work_checkpoint'].includes(tool)
                ? { name: tool }
                : undefined,
            register: () => () => {},
          }
        }
        return undefined
      },
      on(name: string, listener: Listener): () => void {
        add(name, listener)
        return () => {}
      },
      effect: (callback: () => () => void) => {
        callback()
        return () => {}
      },
    }
    const emit = async (name: string, ...args: unknown[]): Promise<unknown> => {
      let result: unknown
      for (const listener of listeners.get(name) ?? []) result = await listener(...args)
      return result
    }
    const route = (path: string): Route => {
      const found = routes.find((entry) => entry.path === path)
      if (found === undefined) throw new Error(`no route ${path}`)
      return found
    }
    const read = async (path: string): Promise<Record<string, unknown>> => {
      const response = await route(path).fetch(
        new Request(`http://localhost${path}?session=session-live`),
      )
      expect(response.status).toBe(200)
      return (await response.json()) as Record<string, unknown>
    }
    const runViews = async (): Promise<
      Array<{
        id: string
        title: string
        source: string
        session?: string
        steps: Array<{ id: string; title: string; state: string }>
      }>
    > => {
      const body = (await read('/api/workflows/runs')) as {
        runs: Array<{
          id: string
          title: string
          source: string
          session?: string
          steps: Array<{ id: string; title: string; state: string }>
        }>
      }
      return body.runs
    }
    const preStep = async (turn: number): Promise<void> => {
      await emit(
        'agent/pre-step',
        {
          agent,
          turn,
          step: 1,
          messages: [],
          signal: new AbortController().signal,
          modelSelection: { provider: 'p', model: 'm' },
        },
        async () => ({ kind: 'continue' }),
      )
    }
    const turnStop = async (turn: number): Promise<void> => {
      await emit('agent/turn-stopping', { agent, turn })
    }

    const subagentDemo = {
      v: 1,
      id: 'subagent-demo',
      name: 'Subagent demo',
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
          id: 'review',
          title: 'Child review',
          executor: 'subagent',
          prompt: 'Review the change.',
          subagent: { provider: 'spawn', schema: { type: 'object', required: ['verdict'] } },
          evidence: { kind: 'file', path: '.dsh/review.json' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    }
    const subagentSource = join(workspace, 'subagent-demo.json')
    await writeFile(subagentSource, JSON.stringify(subagentDemo), 'utf8')
    const { installDefinition } = await import('../src/host/approval-store.ts')
    await installDefinition(workspace, subagentSource, auth)
    apply(ctx as never)
    await preStep(1)

    // 1. A host-driven subagent run dispatches through the subagents service.
    const subagentCommand = commands.find((entry) => entry.name === 'workflows')
    expect(subagentCommand).toBeDefined()
    const subagentStarted = await subagentCommand?.handler({
      agent,
      commandId: 'cmd-subagent',
      rawInput: ' run subagent-demo',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(subagentStarted?.kind).toBe('success')
    await turnStop(2)
    const subagentView = (await runViews()).find((entry) => entry.title.startsWith('subagent-demo'))
    expect(subagentView?.steps.find((step) => step.id === 'review')).toMatchObject({
      state: 'done',
    })
    // 2. The registered pre-execute hook starts the intake and refuses the call.
    const started = (await emit(
      'tools/pre-execute',
      {
        agent,
        callId: 'call-new',
        name: 'pwsh',
        arguments: { command: 'openspec new change auth' },
      },
      async () => ({ kind: 'continue' }),
    )) as { kind?: string; stepId?: string }
    expect(started).toMatchObject({ kind: 'deny' })
    const { readdir } = await import('node:fs/promises')
    const runFiles = await readdir(join(workspace, '.dsh', 'workflows', 'runs'))
    expect(runFiles.length).toBeGreaterThan(0)
    const { readFile } = await import('node:fs/promises')
    const rawRun = JSON.parse(
      await readFile(join(workspace, '.dsh', 'workflows', 'runs', runFiles[0] as string), 'utf8'),
    ) as { session?: unknown }
    expect(rawRun.session).toBe('session-live')
    const debugBody = (await read('/api/workflows/runs')) as {
      runs: Array<{ id: string; source: string; session?: string }>
    }
    expect(debugBody.runs.map((entry) => entry.source)).toContain('workflow')
    await waitFor(async () =>
      (await runViews()).some((entry) => entry.title.startsWith('change-intake')),
    )
    const intake = (await runViews()).find((entry) => entry.title.startsWith('change-intake'))
    expect(intake).toBeDefined()
    const runId = String(intake?.id).replace(/^workflow:/u, '')
    expect(intake?.steps.find((step) => step.id === 'requirements')?.state).toBe('open')

    // 2. The open requirements step refuses the close until the per-turn cap,
    // then the close is recorded as one visible violation in the run view.
    for (const _ of [1, 2, 3, 4]) await turnStop(3)
    expect(steers.length).toBeGreaterThan(0)
    await waitFor(async () =>
      (await runViews()).some(
        (entry) =>
          entry.id === `workflow:${runId}` &&
          entry.steps.some((step) => step.title === 'VIOLATION'),
      ),
    )
    const blockedView = (await runViews()).find((entry) => entry.id === `workflow:${runId}`)
    expect(blockedView?.steps.some((step) => step.title === 'VIOLATION')).toBe(true)

    // 3. Main steps complete with files through the real turn close.
    for (const [turn, file] of [
      [7, 'requirements.md'],
      [8, 'architecture.md'],
      [9, 'interface.md'],
    ] as const) {
      await writeDraft(workspace, 'auth', file, 'x'.repeat(200))
      await turnStop(turn)
    }
    await waitFor(async () =>
      (await runViews()).some(
        (entry) =>
          entry.id === `workflow:${runId}` &&
          entry.steps.find((step) => step.id === 'interface')?.state === 'done',
      ),
    )

    // 4. A subagent step records a schema-validated child result.
    const childDefinition = validateDefinition({
      v: 1,
      id: 'child-demo',
      name: 'Child demo',
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
          id: 'review',
          title: 'Child review',
          executor: 'subagent',
          prompt: 'Review {name}.',
          subagent: { provider: 'spawn', schema: { type: 'object', required: ['verdict'] } },
          evidence: { kind: 'file', path: '.dsh/review.json' },
          next: 'end',
        },
      ],
    })
    const child = await runSubagentStep({
      run: createRun({
        definition: 'child-demo',
        trigger: 'turn.stopping',
        session: 'session-live',
        workspace,
        steps: ['review'],
        now: 1_200,
      }),
      definition: childDefinition,
      step: childDefinition.steps[0] as (typeof childDefinition.steps)[number],
      runner: {
        run: async () => ({ childId: 'child-live', completed: true, result: { verdict: 'PASS' } }),
      },
      evidenceContext: { workspace, values: { name: 'auth' } },
    })
    expect(child.steps[0]).toMatchObject({ state: 'done', evidence: { callId: 'child-live' } })

    // 5. A restart recovers the persisted run and resume keeps completed progress.
    const before = await listAuthenticatedRuns(workspace, auth)
    const persisted = before.find((entry) => entry.id === runId)
    expect(persisted).toBeDefined()
    expect(persisted?.steps.find((step) => step.id === 'requirements')?.state).toBe('done')
    const recovery = await recoverRuns(workspace, auth)
    expect(recovery.recovered).toContain(runId)
    expect(
      (await listAuthenticatedRuns(workspace, auth)).find((entry) => entry.id === runId)?.status,
    ).toBe('interrupted')
    const resumed = await resumeRun(workspace, runId, auth, 2_100)
    expect(resumed.stepId).toBe('create-change')
    const after = await listAuthenticatedRuns(workspace, auth)
    expect(after.filter((entry) => entry.definition.id === 'change-intake')).toHaveLength(1)
    expect(
      after.find((entry) => entry.id === runId)?.steps.find((step) => step.id === 'requirements')
        ?.state,
    ).toBe('done')

    // 6. A pre-existing change is adopted through the registered command.
    await mkdir(join(workspace, 'openspec', 'changes', 'legacy', 'specs', 'legacy'), {
      recursive: true,
    })
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      await writeFile(
        join(workspace, 'openspec', 'changes', 'legacy', file),
        '# artifact\n',
        'utf8',
      )
    }
    await writeFile(
      join(workspace, 'openspec', 'changes', 'legacy', 'specs', 'legacy', 'spec.md'),
      '# spec\n',
      'utf8',
    )
    const digest = (await currentSpecDigest(workspace, 'legacy')) as string
    await mkdir(join(workspace, '.dsh', 'delegation', 'spec-review', 'legacy'), { recursive: true })
    await writeFile(
      join(workspace, '.dsh', 'delegation', 'spec-review', 'legacy', 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'legacy', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-07T00:00:00.000Z', target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' } })}\n`,
      'utf8',
    )
    const command = commands.find((entry) => entry.name === 'workflows')
    expect(command).toBeDefined()
    const adopted = await command?.handler({
      agent,
      commandId: 'cmd-adopt',
      rawInput: ' adopt legacy',
      attachments: [],
      signal: new AbortController().signal,
    })
    expect(adopted?.kind).toBe('success')
    expect(
      (await listReceipts(workspace, auth)).some((receipt) => receipt.change === 'legacy'),
    ).toBe(true)

    // 7. Pruning run history keeps the receipt and the archive dispatch allows.
    await cancelRun(workspace, runId, auth, 2_200)
    const old = Date.now() - 40 * DAY_MS
    const cancelled = await readAuthenticatedRun(workspace, runId, auth)
    if (cancelled !== undefined) {
      await writeRun(
        workspace,
        {
          ...cancelled,
          createdAt: old,
          updatedAt: old,
          steps: cancelled.steps.map((step) => ({ ...step, state: 'cancelled' as const })),
        },
        auth,
      )
    }
    await utimes(runPath(workspace, runId), new Date(old), new Date(old))
    await pruneRuns(workspace, { auth, retentionMs: 30 * DAY_MS })
    expect(
      (await listAuthenticatedRuns(workspace, auth)).find((entry) => entry.id === runId),
    ).toBeUndefined()
    expect(
      (await listReceipts(workspace, auth)).some((receipt) => receipt.change === 'legacy'),
    ).toBe(true)
    const archiveDecision = (await emit(
      'tools/pre-execute',
      {
        agent,
        callId: 'call-archive',
        name: 'pwsh',
        arguments: { command: 'openspec archive legacy' },
      },
      async () => ({ kind: 'continue' }),
    )) as { kind?: string }
    expect(archiveDecision.kind).not.toBe('deny')
  })
})
