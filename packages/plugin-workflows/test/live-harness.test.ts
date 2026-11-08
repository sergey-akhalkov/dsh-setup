import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { adoptChange } from '../src/host/adoption.ts'
import { loadShippedDefinitions, validateDefinition } from '../src/host/definitions.ts'
import { writeDraft } from '../src/host/drafts.ts'
import { currentSpecDigest, verifyEvidence } from '../src/host/evidence.ts'
import { OwnedCalls, runSubagentStep } from '../src/host/executors.ts'
import { evaluateArchiveGate, evaluateIntakeGate, evaluateTurnClose } from '../src/host/gates.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { apply } from '../src/host/index.ts'
import { advanceIntake } from '../src/host/intake.ts'
import { engineRuns, hashSession } from '../src/host/projection.ts'
import { listReceipts } from '../src/host/receipts.ts'
import { cancelRun, resumeRun } from '../src/host/resume.ts'
import {
  createRun,
  DAY_MS,
  listAuthenticatedRuns,
  pruneRuns,
  runPath,
  type WorkflowRun,
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
  it('runs the intake, blocks a turn close, resumes, adopts, and archives after pruning', async () => {
    const workspace = await tempWorkspace()
    const auth = HostAuth.fromKey('test-live-obligation-host-key-0123')
    const definition = loadShippedDefinitions().find((entry) => entry.id === 'change-intake')
    if (definition === undefined) throw new Error('the change-intake definition is missing')

    // 1. A creation call with no completed intake starts one run and is refused.
    const startedRuns: WorkflowRun[] = []
    const started = await evaluateIntakeGate({
      name: 'auth',
      session: 'session-live',
      workspace,
      definition,
      runs: [],
      receipts: [],
      ownedCallIds: new Set(),
      changeExists: false,
      startRun: async (entry, name) => {
        const run = createRun({
          definition: entry.id,
          trigger: 'tool.pre-execute',
          session: 'session-live',
          workspace,
          context: { name },
          steps: entry.steps.map((step) => step.id),
          now: 1_000,
          id: 'run-live-intake',
        })
        startedRuns.push(run)
        await writeRun(workspace, run, auth)
        return { runId: run.id }
      },
      resumeRun: async () => ({ stepId: 'spec' }),
    })
    expect(started).toMatchObject({ kind: 'deny', action: 'started', stepId: 'requirements' })
    const viewRuns = await engineRuns(workspace)
    expect(viewRuns.find((run) => run.id === 'workflow:run-live-intake')).toMatchObject({
      source: 'workflow',
      status: 'running',
    })

    // 2. A main step completes only after its draft file exists.
    const owned = new OwnedCalls()
    const advance = (run: WorkflowRun) =>
      advanceIntake({
        run,
        definition,
        values: { name: 'auth' },
        evidenceContext: { workspace, values: { name: 'auth' } },
        owned,
        installedLegacy: new Set(['delegation-rules', 'goal-continuity']),
        readRecord: async () => ({
          ok: true,
          evidence: {
            kind: 'record',
            path: '.dsh/delegation/spec-review/auth/spec.json',
            digest: 'a'.repeat(64),
          },
        }),
        questions: { ask: async () => ({ answer: 'yes' }) },
        now: 1_100,
      })
    let run = await advance(startedRuns[0] as WorkflowRun)
    expect(run.waiting?.stepId).toBe('requirements')
    await writeDraft(workspace, 'auth', 'requirements.md', 'x'.repeat(200))
    run = await advance(run.run)
    expect(run.run.steps.find((step) => step.id === 'requirements')?.state).toBe('done')

    // 3. A subagent step records a schema-validated child result.
    const childRun = createRun({
      definition: 'child-demo',
      trigger: 'turn.stopping',
      session: 'session-live',
      workspace,
      steps: ['review'],
      now: 1_200,
    })
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
      run: childRun,
      definition: childDefinition,
      step: childDefinition.steps[0] as (typeof childDefinition.steps)[number],
      runner: {
        run: async () => ({ childId: 'child-live', completed: true, result: { verdict: 'PASS' } }),
      },
      evidenceContext: { workspace, values: { name: 'auth' } },
    })
    expect(child.steps[0]).toMatchObject({ state: 'done', evidence: { callId: 'child-live' } })

    // 4. A turn close is refused once and then allowed with a visible violation.
    const blockedDefinition = validateDefinition({
      v: 1,
      id: 'block-demo',
      name: 'Block demo',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 1,
        allowIntent: false,
      },
      steps: [
        {
          id: 'requirements',
          title: 'Requirements',
          executor: 'main',
          prompt: 'Write the requirements.',
          evidence: { kind: 'file', path: 'out.md' },
          next: 'end',
          blockTurnClose: true,
        },
      ],
    })
    const blockedRun = createRun({
      definition: 'block-demo',
      trigger: 'turn.stopping',
      session: 'session-live',
      workspace,
      steps: ['requirements'],
      now: 1_300,
    })
    const steered: string[] = []
    const refusal = evaluateTurnClose({
      run: blockedRun,
      definition: blockedDefinition,
      agent: { steer: (text: string) => steered.push(text) },
      evidenceContext: { workspace, values: {} },
      turn: 1,
      maxBlocks: 1,
      installedLegacy: new Set(),
    })
    expect(refusal.kind).toBe('refuse')
    const violation = evaluateTurnClose({
      run: refusal.run,
      definition: blockedDefinition,
      agent: { steer: (text: string) => steered.push(text) },
      evidenceContext: { workspace, values: {} },
      turn: 2,
      maxBlocks: 1,
      installedLegacy: new Set(),
    })
    expect(violation.kind).toBe('violation')
    expect(violation.run.violations).toHaveLength(1)
    expect(steered).toHaveLength(1)

    // 5. A restart marks the run interrupted and resume re-evaluates the pending spec step.
    await writeRun(
      workspace,
      { ...(startedRuns[0] as WorkflowRun), status: 'interrupted', updatedAt: 2_000 },
      auth,
    )
    const resumed = await resumeRun(workspace, 'run-live-intake', auth, 2_100)
    expect(resumed.stepId).toBe('requirements')

    // 6. A pre-existing change is adopted with a host-authenticated receipt.
    await writeDraft(workspace, 'auth', 'requirements.md', 'x'.repeat(200))
    const adoption = await adoptChange({
      workspace,
      change: 'auth',
      auth,
      userStarted: true,
      questions: { ask: async () => ({ answer: 'yes' }) },
      now: 3_000,
    })
    expect(adoption.ok).toBe(false)
    await mkdir(join(workspace, 'openspec', 'changes', 'auth', 'specs', 'auth'), {
      recursive: true,
    })
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      await writeFile(join(workspace, 'openspec', 'changes', 'auth', file), '# artifact\n', 'utf8')
    }
    await writeFile(
      join(workspace, 'openspec', 'changes', 'auth', 'specs', 'auth', 'spec.md'),
      '# spec\n',
      'utf8',
    )
    const digest = (await currentSpecDigest(workspace, 'auth')) as string
    await mkdir(join(workspace, '.dsh', 'delegation', 'spec-review', 'auth'), { recursive: true })
    await writeFile(
      join(workspace, '.dsh', 'delegation', 'spec-review', 'auth', 'spec.json'),
      `${JSON.stringify({ rule: 'spec-review', change: 'auth', phase: 'spec', scope: 'whole', verdict: 'PASS', digest, findings: [], time: '2026-11-07T00:00:00.000Z', target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' } })}\n`,
      'utf8',
    )
    const adopted = await adoptChange({
      workspace,
      change: 'auth',
      auth,
      userStarted: true,
      questions: { ask: async () => ({ answer: 'yes' }) },
      now: 3_100,
    })
    expect(adopted.ok).toBe(true)

    // 7. Pruning the run history keeps the receipt, and the archive remains allowed.
    await cancelRun(workspace, 'run-live-intake', auth, 2_200)
    const old = Date.now() - 40 * DAY_MS
    await utimes(runPath(workspace, 'run-live-intake'), new Date(old), new Date(old))
    await pruneRuns(workspace, { auth, retentionMs: 30 * DAY_MS })
    const archive = evaluateArchiveGate({
      change: 'auth',
      runs: await listAuthenticatedRuns(workspace, auth),
      receipts: await listReceipts(workspace, auth),
      specRecord: await verifyEvidence(
        {
          kind: 'record',
          rule: 'spec-review',
          change: 'auth',
          phase: 'spec',
          scope: 'whole',
          verdict: 'PASS',
          digest: 'current',
        },
        { workspace, values: { name: 'auth' } },
      ),
    })
    expect(archive.kind).toBe('allow')
  })
})
