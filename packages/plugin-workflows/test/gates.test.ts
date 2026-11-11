import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseArchiveCommand } from '../src/host/command-parse.ts'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import {
  authorizationWriteDecision,
  evaluateArchiveGate,
  evaluateIntakeGate,
  evaluateTurnClose,
  selectBlockingStep,
} from '../src/host/gates.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { issueAdoptionReceipt, listReceipts } from '../src/host/receipts.ts'
import {
  createRun,
  DAY_MS,
  listAuthenticatedRuns,
  pruneRuns,
  runPath,
  runsDirectory,
  setRunStatus,
  settleStep,
  type WorkflowRun,
  writeRun,
} from '../src/host/runs.ts'
import type { SteerTarget } from '../src/host/steer.ts'
import { contributedIntake } from './intake-definition.ts'

const ORIGINAL_SETTINGS = {
  allowModelStart: false,
  risk: 'low',
  gateOwnership: 'own',
  maxBlocks: 2,
  allowIntent: false,
}

function blockingDefinition(): Definition {
  return validateDefinition({
    v: 1,
    id: 'blocking-demo',
    name: 'Blocking demo',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: ORIGINAL_SETTINGS,
    steps: [
      {
        id: 'requirements',
        title: 'Requirements',
        executor: 'main',
        prompt: 'Write the requirements.',
        evidence: { kind: 'file', path: '.dsh/workflows/drafts/{name}/requirements.md' },
        next: 'architecture',
        blockTurnClose: true,
      },
      {
        id: 'architecture',
        title: 'Architecture',
        executor: 'main',
        prompt: 'Write the architecture.',
        evidence: { kind: 'file', path: '.dsh/workflows/drafts/{name}/architecture.md' },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
}

function deferredDefinition(): Definition {
  return validateDefinition({
    v: 1,
    id: 'deferred-demo',
    name: 'Deferred demo',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: ORIGINAL_SETTINGS,
    steps: [
      {
        id: 'spec-review',
        title: 'Spec review',
        executor: 'main',
        prompt: 'Wait for the legacy review.',
        ownership: 'defer',
        legacy: { plugin: 'delegation-rules', signal: 'spec-review' },
        evidence: { kind: 'file', path: 'review.json' },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
}

const evidenceContext = { workspace: '/workspace', values: { name: 'auth' } }
const installed: ReadonlySet<string> = new Set(['delegation-rules', 'goal-continuity'])

class FakeAgent implements SteerTarget {
  readonly messages: string[] = []
  throwOnSteer = false
  steer(message: string): void {
    if (this.throwOnSteer) throw new Error('the agent could not be steered')
    this.messages.push(message)
  }
}

function runFor(definition: Definition): WorkflowRun {
  return createRun({
    definition: definition.id,
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth' },
    steps: definition.steps.map((step) => step.id),
    now: 1_000,
  })
}

describe('turn-close gate', () => {
  it('allows the close when no owned blocking step is open', () => {
    const definition = blockingDefinition()
    const afterFirst = settleStep(runFor(definition), 'requirements', 'done', { at: 1_100 })
    expect(selectBlockingStep(afterFirst, definition, installed)?.id).toBe('architecture')
    const run = settleStep(afterFirst, 'architecture', 'done', { at: 1_200 })
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: new FakeAgent(),
      evidenceContext,
      turn: 1,
      maxBlocks: 2,
      installedLegacy: installed,
    })
    expect(outcome).toMatchObject({ kind: 'allow' })
    expect(selectBlockingStep(run, definition, installed)).toBeUndefined()
  })

  it('selects the first open blocking step and steers the root agent', () => {
    const definition = blockingDefinition()
    const run = runFor(definition)
    const agent = new FakeAgent()
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent,
      evidenceContext,
      turn: 1,
      maxBlocks: 2,
      installedLegacy: installed,
    })
    expect(outcome.kind).toBe('refuse')
    if (outcome.kind !== 'refuse') return
    expect(outcome.stepId).toBe('requirements')
    expect(outcome.text).toContain('Requirements')
    expect(outcome.run.turnBlocks).toBe(1)
    expect(agent.messages).toEqual([outcome.text])
    expect(selectBlockingStep(run, definition, installed)?.id).toBe('requirements')
  })

  it('caps the refusals with a visible violation and restores the budget on a new turn', () => {
    const definition = blockingDefinition()
    const agent = new FakeAgent()
    let run = runFor(definition)
    for (const attempt of [1, 2]) {
      const outcome = evaluateTurnClose({
        run,
        definition,
        agent,
        evidenceContext,
        turn: 1,
        maxBlocks: 2,
        installedLegacy: installed,
        now: 2_000 + attempt,
      })
      expect(outcome.kind).toBe('refuse')
      run = outcome.run
    }
    const capped = evaluateTurnClose({
      run,
      definition,
      agent,
      evidenceContext,
      turn: 1,
      maxBlocks: 2,
      installedLegacy: installed,
      now: 3_000,
    })
    expect(capped.kind).toBe('violation')
    if (capped.kind !== 'violation') return
    expect(capped.detail).toContain('VIOLATION')
    expect(capped.run.violations[0]).toMatchObject({
      stepId: 'requirements',
      at: 3_000,
      reason: expect.stringContaining('never as a pass'),
    })
    expect(capped.run.turnBlocks).toBe(2)
    expect(agent.messages).toHaveLength(2)
    expect(capped.run.steps[0]?.state).toBe('open')
    // The next turn starts a fresh maxBlocks budget and the obligation steers
    // again instead of being suppressed by the capped turn.
    const nextTurn = evaluateTurnClose({
      run: capped.run,
      definition,
      agent,
      evidenceContext,
      turn: 2,
      maxBlocks: 2,
      installedLegacy: installed,
      now: 4_000,
    })
    expect(nextTurn.kind).toBe('refuse')
    expect(agent.messages).toHaveLength(3)
  })

  it('restores the request budget on a new turn after a capped turn', () => {
    const definition = blockingDefinition()
    const agent = new FakeAgent()
    let run = runFor(definition)
    for (const attempt of [1, 2]) {
      const outcome = evaluateTurnClose({
        run,
        definition,
        agent,
        evidenceContext,
        turn: 1,
        maxBlocks: 2,
        installedLegacy: installed,
        now: 2_000 + attempt,
      })
      expect(outcome.kind).toBe('refuse')
      run = outcome.run
    }
    // Turn 1 stopped steering at its request bound, but turn 2 is fresh and
    // steers again instead of becoming a violation.
    const nextTurn = evaluateTurnClose({
      run,
      definition,
      agent,
      evidenceContext,
      turn: 2,
      maxBlocks: 2,
      installedLegacy: installed,
      now: 3_000,
    })
    expect(nextTurn.kind).toBe('refuse')
    expect(agent.messages).toHaveLength(3)
  })

  it('never steers a deferred step and skips a subagent turn', () => {
    const definition = deferredDefinition()
    const agent = new FakeAgent()
    const allowed = evaluateTurnClose({
      run: runFor(definition),
      definition,
      agent,
      evidenceContext,
      turn: 1,
      maxBlocks: 2,
      installedLegacy: installed,
    })
    expect(allowed).toMatchObject({ kind: 'allow' })
    expect(agent.messages).toEqual([])
    const subagentDefinition = blockingDefinition()
    const subagent = evaluateTurnClose({
      run: runFor(subagentDefinition),
      definition: subagentDefinition,
      agent,
      evidenceContext,
      turn: 1,
      maxBlocks: 2,
      origin: 'subagent',
      installedLegacy: installed,
    })
    expect(subagent).toMatchObject({ kind: 'allow' })
    expect(agent.messages).toEqual([])
  })

  it('fails open and reports an internal steering error', () => {
    const definition = blockingDefinition()
    const agent = new FakeAgent()
    agent.throwOnSteer = true
    const errors: unknown[] = []
    const outcome = evaluateTurnClose({
      run: runFor(definition),
      definition,
      agent,
      evidenceContext,
      turn: 1,
      maxBlocks: 2,
      installedLegacy: installed,
      onError: (error) => errors.push(error),
    })
    expect(outcome).toMatchObject({ kind: 'allow' })
    expect(errors).toHaveLength(1)
    expect(outcome.run.violations).toHaveLength(1)
    expect(outcome.run.steps[0]?.state).toBe('open')
  })
})

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-gates-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

function gateAuth(): HostAuth {
  return HostAuth.fromKey('test-gates-host-key-0123456789')
}

const DIGEST = 'a'.repeat(64)

function intakeRunFor(workspace: string, name = 'auth', id?: string): WorkflowRun {
  return createRun({
    definition: 'change-intake',
    trigger: 'tool.pre-execute',
    session: 'session-1',
    workspace,
    context: { name },
    steps: ['requirements', 'create-change', 'spec', 'approval'],
    now: 1_000,
    ...(id === undefined ? {} : { id }),
  })
}

function intakeDefinition(): Definition {
  return contributedIntake()
}

function callbacks(): {
  readonly starts: string[]
  readonly resumes: string[]
  readonly startRun: (definition: Definition, name: string) => Promise<{ runId: string }>
  readonly resumeRun: (runId: string) => Promise<{ stepId: string }>
} {
  const starts: string[] = []
  const resumes: string[] = []
  return {
    starts,
    resumes,
    startRun: async (_definition, name) => {
      starts.push(name)
      return { runId: 'run-started' }
    },
    resumeRun: async (runId) => {
      resumes.push(runId)
      return { stepId: 'spec' }
    },
  }
}

function gateInput(
  workspace: string,
  runs: readonly WorkflowRun[],
  receipts: Awaited<ReturnType<typeof listReceipts>>,
  overrides: Partial<Parameters<typeof evaluateIntakeGate>[0]> = {},
): Parameters<typeof evaluateIntakeGate>[0] {
  return {
    name: 'auth',
    session: 'session-1',
    workspace,
    definition: intakeDefinition(),
    runs,
    receipts,
    ownedCallIds: new Set<string>(),
    changeExists: false,
    startRun: callbacks().startRun,
    resumeRun: callbacks().resumeRun,
    ...overrides,
  }
}

describe('pre-execute intake gate', () => {
  it('allows a completed authenticated intake without starting a second run', async () => {
    const workspace = await tempWorkspace()
    const run = setRunStatus(intakeRunFor(workspace), 'completed', 2_000)
    await writeRun(workspace, run, gateAuth())
    const runs = await listAuthenticatedRuns(workspace, gateAuth())
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, runs, [], {
        startRun: recorder.startRun,
        resumeRun: recorder.resumeRun,
      }),
    )
    expect(decision).toMatchObject({ kind: 'allow' })
    expect(recorder.starts).toEqual([])
    expect(recorder.resumes).toEqual([])
  })

  it('allows an authenticated adoption receipt without a run', async () => {
    const workspace = await tempWorkspace()
    await issueAdoptionReceipt(workspace, 'auth', DIGEST, gateAuth(), 2_000)
    const receipts = await listReceipts(workspace, gateAuth())
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, [], receipts, {
        startRun: recorder.startRun,
        resumeRun: recorder.resumeRun,
      }),
    )
    expect(decision).toMatchObject({ kind: 'allow' })
    expect(recorder.starts).toEqual([])
  })

  it('resumes the session intake even when another session is running', async () => {
    const workspace = await tempWorkspace()
    const interrupted = setRunStatus(
      createRun({
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
          'approval',
          'complete',
        ],
        id: 'run-session-one',
      }),
      'interrupted',
      2_000,
    )
    const foreign = createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-2',
      workspace,
      context: { name: 'auth' },
      steps: [
        'requirements',
        'architecture',
        'interface',
        'create-change',
        'spec',
        'approval',
        'complete',
      ],
      id: 'run-session-two',
    })
    let resumed = 0
    let started = 0
    const decision = await evaluateIntakeGate(
      gateInput(workspace, [interrupted, foreign], [], {
        session: 'session-1',
        startRun: async () => {
          started += 1
          return { runId: 'run-new' }
        },
        resumeRun: async () => {
          resumed += 1
          return { stepId: 'requirements' }
        },
      }),
    )
    expect(decision).toMatchObject({ kind: 'deny', action: 'resumed', runId: 'run-session-one' })
    expect(resumed).toBe(1)
    expect(started).toBe(0)
  })

  it('allows an owned create-change call', async () => {
    const workspace = await tempWorkspace()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, [], [], {
        callId: 'owned-call-1',
        ownedCallIds: new Set(['owned-call-1']),
      }),
    )
    expect(decision).toMatchObject({ kind: 'allow' })
  })

  it('resumes a resumable intake and refuses the call before redirecting to adoption', async () => {
    const workspace = await tempWorkspace()
    let run = intakeRunFor(workspace)
    run = settleStep(run, 'requirements', 'done', { at: 1_100 })
    run = settleStep(run, 'create-change', 'done', { at: 1_200 })
    run = setRunStatus(run, 'interrupted', 1_300)
    await writeRun(workspace, run, gateAuth())
    const runs = await listAuthenticatedRuns(workspace, gateAuth())
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, runs, [], {
        changeExists: true,
        startRun: recorder.startRun,
        resumeRun: recorder.resumeRun,
      }),
    )
    expect(decision).toMatchObject({ kind: 'deny', action: 'resumed', stepId: 'spec' })
    expect(recorder.resumes).toEqual([run.id])
    expect(recorder.starts).toEqual([])
  })

  it('redirects an existing change directory without a resumable run to adoption', async () => {
    const workspace = await tempWorkspace()
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, [], [], {
        changeExists: true,
        startRun: recorder.startRun,
        resumeRun: recorder.resumeRun,
      }),
    )
    expect(decision).toMatchObject({ kind: 'deny', action: 'adopt' })
    if (decision.kind === 'deny') expect(decision.reason).toContain('/workflows adopt auth')
    expect(recorder.starts).toEqual([])
  })

  it('starts one intake run and refuses the call otherwise', async () => {
    const workspace = await tempWorkspace()
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, [], [], {
        startRun: recorder.startRun,
        resumeRun: recorder.resumeRun,
      }),
    )
    expect(decision).toMatchObject({ kind: 'deny', action: 'started', stepId: 'requirements' })
    expect(recorder.starts).toEqual(['auth'])
  })

  it('refuses a fabricated completed run because it is not authenticated', async () => {
    const workspace = await tempWorkspace()
    const fabricated = setRunStatus(
      intakeRunFor(workspace, 'auth', 'run-fabricated'),
      'completed',
      2_000,
    )
    await mkdir(runsDirectory(workspace), { recursive: true })
    await writeFile(
      runPath(workspace, fabricated.id),
      `${JSON.stringify(fabricated, null, 2)}\n`,
      'utf8',
    )
    expect(await listAuthenticatedRuns(workspace, gateAuth())).toEqual([])
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, await listAuthenticatedRuns(workspace, gateAuth()), [], {
        startRun: recorder.startRun,
        resumeRun: recorder.resumeRun,
      }),
    )
    expect(decision).toMatchObject({ kind: 'deny', action: 'started' })
    expect(recorder.starts).toEqual(['auth'])
  })
})

describe('archive gate', () => {
  function completedIntakeFor(workspace: string, id: string): WorkflowRun {
    let run = intakeRunFor(workspace, 'auth', id)
    for (const step of ['requirements', 'create-change', 'spec', 'approval']) {
      run = settleStep(run, step, 'done', { at: 1_100 })
    }
    return setRunStatus(run, 'completed', 2_000)
  }

  function archivedOk(): { ok: true; evidence: { kind: 'record'; path: string; digest: string } } {
    return {
      ok: true,
      evidence: {
        kind: 'record',
        path: '.dsh/delegation/spec-review/auth/spec.json',
        digest: DIGEST,
      },
    }
  }

  function stale(): {
    ok: false
    failure: { reason: 'record-mismatch'; path: string; detail: string }
  } {
    return {
      ok: false,
      failure: {
        reason: 'record-mismatch',
        path: '.dsh/delegation/spec-review/auth/spec.json',
        detail: 'the whole-spec record is stale for the current change artifacts',
      },
    }
  }

  it('refuses while a related run has an open required step', async () => {
    const workspace = await tempWorkspace()
    const run = intakeRunFor(workspace)
    await writeRun(workspace, run, gateAuth())
    const runs = await listAuthenticatedRuns(workspace, gateAuth())
    const decision = evaluateArchiveGate({
      change: 'auth',
      runs,
      receipts: [],
      specRecord: archivedOk(),
    })
    expect(decision).toMatchObject({ kind: 'deny' })
    if (decision.kind === 'deny') {
      expect(decision.reason).toContain(run.id)
      expect(decision.reason).toContain('requirements')
    }
  })

  it('refuses with no authenticated intake and with a stale record', async () => {
    const workspace = await tempWorkspace()
    expect(
      evaluateArchiveGate({ change: 'auth', runs: [], receipts: [], specRecord: archivedOk() }),
    ).toMatchObject({ kind: 'deny' })
    const completed = completedIntakeFor(workspace, 'run-complete')
    await writeRun(workspace, completed, gateAuth())
    const runs = await listAuthenticatedRuns(workspace, gateAuth())
    const staleDecision = evaluateArchiveGate({
      change: 'auth',
      runs,
      receipts: [],
      specRecord: stale(),
    })
    expect(staleDecision).toMatchObject({ kind: 'deny' })
    if (staleDecision.kind === 'deny') expect(staleDecision.reason).toContain('stale')
  })

  it('refuses a forged receipt and a forged run after reload', async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, '.dsh', 'workflows', 'receipts'), { recursive: true })
    await writeFile(
      join(workspace, '.dsh', 'workflows', 'receipts', 'auth.json'),
      `${JSON.stringify({ v: 1, kind: 'adoption', change: 'auth', digest: DIGEST, issuedAt: 1, workspaceKey: workspace, signature: 'f'.repeat(64) })}\n`,
      'utf8',
    )
    expect(await listReceipts(workspace, gateAuth())).toEqual([])
    expect(
      evaluateArchiveGate({
        change: 'auth',
        runs: [],
        receipts: await listReceipts(workspace, gateAuth()),
        specRecord: archivedOk(),
      }),
    ).toMatchObject({ kind: 'deny' })
    const fabricated = setRunStatus(intakeRunFor(workspace, 'auth', 'run-fake'), 'completed', 3_000)
    await mkdir(runsDirectory(workspace), { recursive: true })
    await writeFile(
      runPath(workspace, fabricated.id),
      `${JSON.stringify(fabricated, null, 2)}\n`,
      'utf8',
    )
    expect(await listAuthenticatedRuns(workspace, gateAuth())).toEqual([])
    const forgedRun = evaluateArchiveGate({
      change: 'auth',
      runs: await listAuthenticatedRuns(workspace, gateAuth()),
      receipts: [],
      specRecord: archivedOk(),
    })
    expect(forgedRun).toMatchObject({ kind: 'deny' })
    if (forgedRun.kind === 'deny') expect(forgedRun.reason).toContain('no authenticated completed')
  })

  it('allows with a completed run or a receipt and the current PASS record, not a text claim', async () => {
    const workspace = await tempWorkspace()
    const completed = completedIntakeFor(workspace, 'run-ok')
    await writeRun(workspace, completed, gateAuth())
    const allowed = evaluateArchiveGate({
      change: 'auth',
      runs: await listAuthenticatedRuns(workspace, gateAuth()),
      receipts: [],
      specRecord: {
        ok: true,
        evidence: {
          kind: 'record',
          path: '.dsh/delegation/spec-review/auth/spec.json',
          digest: DIGEST,
        },
      },
    })
    expect(allowed.kind).toBe('allow')
    await issueAdoptionReceipt(workspace, 'auth', DIGEST, gateAuth(), 3_000)
    const receiptAllowed = evaluateArchiveGate({
      change: 'auth',
      runs: [],
      receipts: await listReceipts(workspace, gateAuth()),
      specRecord: archivedOk(),
    })
    expect(receiptAllowed.kind).toBe('allow')
    expect(
      evaluateArchiveGate({ change: 'auth', runs: [], receipts: [], specRecord: archivedOk() }),
    ).toMatchObject({ kind: 'deny' })
  })

  it('accepts the three move forms and still requires the evidence', async () => {
    const workspace = await tempWorkspace()
    await issueAdoptionReceipt(workspace, 'auth', DIGEST, gateAuth(), 2_000)
    const receipts = await listReceipts(workspace, gateAuth())
    for (const command of [
      'mv openspec/changes/auth openspec/changes/archive',
      'git mv openspec/changes/auth openspec/changes/archive/auth',
      'Move-Item -Path openspec/changes/auth -Destination openspec/changes/archive/',
    ]) {
      const parsed = parseArchiveCommand(command)
      expect(parsed?.change).toBe('auth')
      const decision = evaluateArchiveGate({
        change: parsed?.change ?? '',
        runs: [],
        receipts,
        specRecord: archivedOk(),
      })
      expect(decision.kind, command).toBe('allow')
      expect(
        evaluateArchiveGate({
          change: parsed?.change ?? '',
          runs: [],
          receipts: [],
          specRecord: archivedOk(),
        }).kind,
        command,
      ).toBe('deny')
    }
  })

  it('allows after pruning when the authenticated receipt and PASS record remain', async () => {
    const workspace = await tempWorkspace()
    const completed = completedIntakeFor(workspace, 'run-prune')
    await writeRun(workspace, completed, gateAuth())
    const receipt = await issueAdoptionReceipt(workspace, 'auth', DIGEST, gateAuth(), 3_000)
    const old = Date.now() - 40 * DAY_MS
    await utimes(runPath(workspace, completed.id), new Date(old), new Date(old))
    await pruneRuns(workspace, { auth: gateAuth(), retentionMs: 30 * DAY_MS })
    expect(await listAuthenticatedRuns(workspace, gateAuth())).toEqual([])
    expect(await listReceipts(workspace, gateAuth())).toEqual([receipt])
    const decision = evaluateArchiveGate({
      change: 'auth',
      runs: await listAuthenticatedRuns(workspace, gateAuth()),
      receipts: await listReceipts(workspace, gateAuth()),
      specRecord: archivedOk(),
    })
    expect(decision.kind).toBe('allow')
  })
})

describe('authorization write guard', () => {
  function decision(path: string, callId?: string): ReturnType<typeof authorizationWriteDecision> {
    return authorizationWriteDecision({
      workspace: '/workspace',
      exec: { name: 'write', arguments: { path } },
      ownedCallIds: new Set(['owned-host-call']),
      ...(callId === undefined ? {} : { callId }),
    })
  }

  it('refuses a model write to a definition, the approval store, and a receipt', () => {
    for (const path of [
      '.dsh/workflows/definitions/mine.json',
      '.dsh/workflows/approved.json',
      '.dsh/workflows/receipts/auth.json',
      '.dsh/workflows/runs/run-1.json',
      '.dsh/workflows/definitions/../definitions/mine.json',
    ]) {
      expect(decision(path), path).toMatchObject({ kind: 'deny' })
    }
    expect(
      authorizationWriteDecision({
        workspace: '/workspace',
        exec: { name: 'edit', arguments: { file_path: '.dsh/workflows/approved.json' } },
        ownedCallIds: new Set(),
      }),
    ).toMatchObject({ kind: 'deny' })
  })

  it('refuses an absolute target inside the workspace through write and edit', () => {
    for (const path of [
      resolve('/workspace', '.dsh/workflows/definitions/mine.json'),
      resolve('/workspace', '.dsh/workflows/approved.json'),
      resolve('/workspace', '.dsh/workflows/receipts/auth.json'),
      resolve('/workspace', '.dsh/workflows/runs/run-1.json'),
    ]) {
      for (const tool of ['write', 'edit']) {
        expect(
          authorizationWriteDecision({
            workspace: '/workspace',
            exec: { name: tool, arguments: { file_path: path } },
            ownedCallIds: new Set(),
          }),
          `${tool} ${path}`,
        ).toMatchObject({ kind: 'deny' })
      }
    }
  })

  it.skipIf(process.platform !== 'win32')('refuses mixed-case protected paths on Windows', () => {
    for (const path of [
      '.DSH/WORKFLOWS/definitions/mine.json',
      '.DSH/WORKFLOWS/APPROVED.json',
      '.Dsh/Workflows/Receipts/auth.json',
      '.dsh/WORKFLOWS/RUNS/run-1.json',
    ]) {
      expect(decision(path), path).toMatchObject({ kind: 'deny' })
    }
    expect(decision('.DSH/WORKFLOWS/APPROVED.json', 'owned-host-call')).toEqual({ kind: 'allow' })
  })

  it.skipIf(process.platform !== 'win32')(
    'refuses Windows drive-relative and namespace aliases',
    () => {
      const winDrive = String.fromCharCode(68)
      const aliases = (suffix: string): string[] => [
        `${winDrive}:.dsh/workflows/${suffix}`,
        `\\\\?\\${winDrive}:\\workspace\\.dsh\\workflows\\${suffix}`,
        `//?/${winDrive}:/workspace/.dsh/workflows/${suffix}`,
        `\\\\server\\share\\.dsh/workflows/${suffix}`,
      ]
      for (const path of [
        ...aliases('definitions/mine.json'),
        ...aliases('approved.json'),
        ...aliases('receipts/auth.json'),
        ...aliases('runs/run-1.json'),
      ]) {
        for (const tool of ['write', 'edit']) {
          expect(
            authorizationWriteDecision({
              workspace: '/workspace',
              exec: { name: tool, arguments: { path } },
              ownedCallIds: new Set(),
            }),
            `${tool} ${path}`,
          ).toMatchObject({ kind: 'deny' })
        }
      }
    },
  )

  it.skipIf(process.platform !== 'win32')('refuses NTFS stream aliases in protected paths', () => {
    const aliases = (suffix: string): string[] => [
      `.dsh::$INDEX_ALLOCATION/workflows/${suffix}`,
      `.dsh:$I30:$INDEX_ALLOCATION/workflows/${suffix}`,
    ]
    for (const path of [
      ...aliases('definitions/mine.json'),
      ...aliases('approved.json'),
      ...aliases('receipts/auth.json'),
      ...aliases('runs/run-1.json'),
    ]) {
      for (const tool of ['write', 'edit']) {
        expect(
          authorizationWriteDecision({
            workspace: '/workspace',
            exec: { name: tool, arguments: { path } },
            ownedCallIds: new Set(),
          }),
          `${tool} ${path}`,
        ).toMatchObject({ kind: 'deny' })
      }
    }
  })

  it.skipIf(process.platform !== 'win32')('refuses trailing dot and space aliases', () => {
    for (const path of [
      '.dsh./workflows/approved.json',
      '.dsh/workflows/approved.json.',
      '.dsh /workflows/approved.json',
      '.dsh/workflows/receipts/auth.json.',
    ]) {
      expect(decision(path), path).toMatchObject({ kind: 'deny' })
    }
  })

  it('refuses conflicting path and file_path arguments that hide a protected target', () => {
    for (const tool of ['write', 'edit']) {
      for (const protectedPath of [
        '.dsh/workflows/definitions/mine.json',
        '.dsh/workflows/approved.json',
        '.dsh/workflows/receipts/auth.json',
      ]) {
        expect(
          authorizationWriteDecision({
            workspace: '/workspace',
            exec: { name: tool, arguments: { path: 'src/app.ts', file_path: protectedPath } },
            ownedCallIds: new Set(),
          }),
          `${tool} ${protectedPath}`,
        ).toMatchObject({ kind: 'deny' })
        expect(
          authorizationWriteDecision({
            workspace: '/workspace',
            exec: { name: tool, arguments: { path: '', file_path: protectedPath } },
            ownedCallIds: new Set(),
          }),
          `${tool} empty path ${protectedPath}`,
        ).toMatchObject({ kind: 'deny' })
      }
    }
  })

  it.skipIf(process.platform !== 'win32')('refuses 8.3 short-name aliases', () => {
    for (const path of [
      'DSH~1/workflows/approved.json',
      '.dsh/WORKFL~1/approved.json',
      '.dsh/workflows/approved.json',
    ]) {
      expect(
        authorizationWriteDecision({
          workspace: '/workspace',
          exec: { name: 'write', arguments: { file_path: path } },
          ownedCallIds: new Set(),
        }),
        path,
      ).toMatchObject({ kind: 'deny' })
    }
  })

  it('refuses dot-prefixed paths with repeated separators', () => {
    for (const tool of ['write', 'edit']) {
      for (const path of [
        './/.dsh/workflows/definitions/mine.json',
        './.dsh/workflows/approved.json',
        './//.dsh/workflows/receipts/auth.json',
      ]) {
        expect(
          authorizationWriteDecision({
            workspace: '/workspace',
            exec: { name: tool, arguments: { path } },
            ownedCallIds: new Set(),
          }),
          `${tool} ${path}`,
        ).toMatchObject({ kind: 'deny' })
      }
    }
  })

  it('allows the host-owned install/receipt call and leaves another path untouched', () => {
    expect(decision('.dsh/workflows/receipts/auth.json', 'owned-host-call')).toEqual({
      kind: 'allow',
    })
    expect(decision('src/app.ts')).toBeUndefined()
    expect(decision('../outside.json')).toMatchObject({ kind: 'deny' })
    expect(
      authorizationWriteDecision({
        workspace: '/workspace',
        exec: { name: 'read', arguments: { path: '.dsh/workflows/approved.json' } },
        ownedCallIds: new Set(),
      }),
    ).toBeUndefined()
  })
})

it('refuses a contract too large for the resolved steer', () => {
  const definition = validateDefinition({
    v: 1,
    id: 'oversized-demo',
    name: 'Oversized',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: ORIGINAL_SETTINGS,
    steps: [
      {
        id: 'requirements',
        title: 'Requirements',
        executor: 'main',
        prompt: 'Write the requirements.',
        evidence: {
          kind: 'all',
          items: Array.from({ length: 18 }, (_, index) => ({
            kind: 'file',
            path: `.dsh/workflows/drafts/{name}/part-${String(index)}.md`,
          })),
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
  const run = runFor(definition)
  const agent = new FakeAgent()
  const outcome = evaluateTurnClose({
    run,
    definition,
    agent,
    evidenceContext: { workspace: '/workspace', values: { name: 'a'.repeat(64) } },
    turn: 1,
    installedLegacy: new Set<string>(),
    maxBlocks: 3,
  })
  expect(outcome.kind).toBe('allow')
  expect(agent.messages).toHaveLength(0)
  expect(outcome.run.violations).toHaveLength(1)
  expect(outcome.run.turnBlocks ?? 0).toBe(0)
  expect(outcome.run.steps[0]?.requestedAt).toBeUndefined()
})
it('steers on every stop in one turn and resets attempts after a violation', () => {
  const definition = blockingDefinition()
  const agent = new FakeAgent()
  let run = runFor(definition)
  for (const _ of [1, 2]) {
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent,
      evidenceContext,
      turn: 1,
      maxBlocks: 2,
      installedLegacy: installed,
      now: 2_000,
    })
    expect(outcome.kind).toBe('refuse')
    run = outcome.run
  }
  expect(agent.messages).toHaveLength(2)
  expect(run.steps[0]?.attempts).toBe(2)
  const capped = evaluateTurnClose({
    run,
    definition,
    agent,
    evidenceContext,
    turn: 1,
    maxBlocks: 2,
    installedLegacy: installed,
    now: 2_100,
  })
  expect(capped.kind).toBe('violation')
  expect(capped.run.steps[0]?.attempts).toBe(0)
  const nextTurn = evaluateTurnClose({
    run: capped.run,
    definition,
    agent,
    evidenceContext,
    turn: 2,
    maxBlocks: 2,
    installedLegacy: installed,
    now: 3_000,
  })
  expect(nextTurn.kind).toBe('refuse')
  expect(agent.messages).toHaveLength(3)
})

it('blocks an archive while a filesystem-triggered review run is open', async () => {
  const workspace = await tempWorkspace()
  let intake = intakeRunFor(workspace, 'auth', 'run-review-intake')
  for (const step of ['requirements', 'create-change', 'spec', 'approval']) {
    intake = settleStep(intake, step, 'done', { at: 1_100 })
  }
  intake = setRunStatus(intake, 'completed', 2_000)
  await writeRun(workspace, intake, gateAuth())
  const runs = await listAuthenticatedRuns(workspace, gateAuth())
  const review = createRun({
    definition: 'task-review',
    trigger: 'fs.change',
    session: 'session-1',
    workspace,
    context: { name: 'auth' },
    steps: ['read-review'],
    id: 'run-review-open',
  })
  const specRecord = {
    ok: true as const,
    evidence: {
      kind: 'record' as const,
      path: '.dsh/delegation/spec-review/auth/spec.json',
      digest: DIGEST,
    },
  }
  const blocked = evaluateArchiveGate({
    change: 'auth',
    runs: [...runs, review],
    receipts: [],
    specRecord,
  })
  expect(blocked).toMatchObject({ kind: 'deny' })
  if (blocked.kind === 'deny') {
    expect(blocked.reason).toContain('run-review-open')
    expect(blocked.reason).toContain('read-review')
  }
  const allowed = evaluateArchiveGate({
    change: 'auth',
    runs: [
      ...runs,
      setRunStatus(settleStep(review, 'read-review', 'done', { at: 3_500 }), 'completed', 4_000),
    ],
    receipts: [],
    specRecord,
  })
  expect(allowed.kind).toBe('allow')
})

it('ignores cancelled intake leftovers when a valid intake exists', async () => {
  const workspace = await tempWorkspace()
  let completed = intakeRunFor(workspace, 'auth', 'run-valid')
  for (const step of ['requirements', 'create-change', 'spec', 'approval']) {
    completed = settleStep(completed, step, 'done', { at: 1_100 })
  }
  completed = setRunStatus(completed, 'completed', 2_000)
  const cancelled = setRunStatus(
    intakeRunFor(workspace, 'auth', 'run-cancelled'),
    'cancelled',
    2_100,
  )
  const specRecord = {
    ok: true as const,
    evidence: {
      kind: 'record' as const,
      path: '.dsh/delegation/spec-review/auth/spec.json',
      digest: DIGEST,
    },
  }
  const allowed = evaluateArchiveGate({
    change: 'auth',
    runs: [completed, cancelled],
    receipts: [],
    specRecord,
  })
  expect(allowed.kind).toBe('allow')
  const denied = evaluateArchiveGate({
    change: 'auth',
    runs: [cancelled],
    receipts: [],
    specRecord,
  })
  expect(denied).toMatchObject({ kind: 'deny' })
})

it('keeps archival blocked while a required review step failed', async () => {
  const workspace = await tempWorkspace()
  let intake = intakeRunFor(workspace, 'auth', 'run-failed-review-intake')
  for (const step of ['requirements', 'create-change', 'spec', 'approval']) {
    intake = settleStep(intake, step, 'done', { at: 1_100 })
  }
  intake = setRunStatus(intake, 'completed', 2_000)
  await writeRun(workspace, intake, gateAuth())
  const review = settleStep(
    createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: ['read-review'],
      id: 'run-review-failed',
    }),
    'read-review',
    'failed',
    { at: 3_000, reason: 'the review child did not complete' },
  )
  const specRecord = {
    ok: true as const,
    evidence: {
      kind: 'record' as const,
      path: '.dsh/delegation/spec-review/auth/spec.json',
      digest: DIGEST,
    },
  }
  const decision = evaluateArchiveGate({
    change: 'auth',
    runs: [...(await listAuthenticatedRuns(workspace, gateAuth())), review],
    receipts: [],
    specRecord,
  })
  expect(decision).toMatchObject({ kind: 'deny' })
  if (decision.kind === 'deny') expect(decision.reason).toContain('run-review-failed')
})
it('pruning cannot turn a failed review denial into an allowance', async () => {
  const workspace = await tempWorkspace()
  let intake = intakeRunFor(workspace, 'auth', 'run-prune-intake')
  for (const step of ['requirements', 'create-change', 'spec', 'approval']) {
    intake = settleStep(intake, step, 'done', { at: 1_100 })
  }
  intake = setRunStatus(intake, 'completed', 2_000)
  await writeRun(workspace, intake, gateAuth())
  let review = createRun({
    definition: 'task-review',
    trigger: 'fs.change',
    session: 'session-1',
    workspace,
    context: { name: 'auth' },
    steps: ['read-review', 'follow-up'],
    id: 'run-prune-review',
  })
  review = settleStep(review, 'read-review', 'failed', { at: 3_000, reason: 'the review failed' })
  review = setRunStatus(review, 'failed', 3_100)
  await writeRun(workspace, review, gateAuth())
  const nowValue = 50 * DAY_MS
  await utimes(runPath(workspace, review.id), new Date(nowValue), new Date(nowValue))
  await pruneRuns(workspace, {
    auth: gateAuth(),
    now: nowValue,
    retentionMs: 30 * DAY_MS,
  })
  const runs = await listAuthenticatedRuns(workspace, gateAuth())
  expect(runs.map((run) => run.id)).toContain(review.id)
  const decision = evaluateArchiveGate({
    change: 'auth',
    runs,
    receipts: [],
    specRecord: {
      ok: true,
      evidence: {
        kind: 'record',
        path: '.dsh/delegation/spec-review/auth/spec.json',
        digest: DIGEST,
      },
    },
  })
  expect(decision).toMatchObject({ kind: 'deny' })
})

it('denies archival when a run file failed authentication', () => {
  const decision = evaluateArchiveGate({
    change: 'auth',
    runs: [],
    receipts: [],
    tamperedRuns: true,
    specRecord: {
      ok: true,
      evidence: {
        kind: 'record',
        path: '.dsh/delegation/spec-review/auth/spec.json',
        digest: DIGEST,
      },
    },
  })
  expect(decision).toMatchObject({ kind: 'deny' })
  if (decision.kind === 'deny') expect(decision.reason).toContain('authentication')
})

describe('declared intake gate under another definition id', () => {
  function renamed(): Definition {
    const base = intakeDefinition()
    return {
      ...base,
      id: 'custom-intake',
      settings: { ...base.settings, gate: 'intake' },
    }
  }

  async function runFor(
    workspace: string,
    status: 'running' | 'interrupted' | 'completed',
    id: string,
  ): Promise<WorkflowRun> {
    const definition = renamed()
    const run = createRun({
      definition: definition.id,
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth' },
      steps: definition.steps.map((step) => step.id),
      id,
    })
    const settled = status === 'running' ? run : setRunStatus(run, status, 2_000)
    await writeRun(workspace, settled, gateAuth())
    return settled
  }

  it('finds a running run by the selected id without starting a duplicate', async () => {
    const workspace = await tempWorkspace()
    const definition = renamed()
    const running = await runFor(workspace, 'running', 'run-custom-running')
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, await listAuthenticatedRuns(workspace, gateAuth()), [], {
        definition,
        startRun: recorder.startRun,
        resumeRun: recorder.resumeRun,
      }),
    )
    expect(decision).toMatchObject({ kind: 'deny', action: 'resumed', runId: running.id })
    expect(recorder.starts).toEqual([])
  })

  it('resumes an interrupted run by the selected id instead of redirecting to adoption', async () => {
    const workspace = await tempWorkspace()
    const definition = renamed()
    const interrupted = await runFor(workspace, 'interrupted', 'run-custom-interrupted')
    let resumed = 0
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, await listAuthenticatedRuns(workspace, gateAuth()), [], {
        definition,
        changeExists: true,
        startRun: recorder.startRun,
        resumeRun: async () => {
          resumed += 1
          return { stepId: 'requirements' }
        },
      }),
    )
    expect(decision).toMatchObject({ kind: 'deny', action: 'resumed', runId: interrupted.id })
    expect(resumed).toBe(1)
    expect(recorder.starts).toEqual([])
  })

  it('allows a completed run by the selected id without restarting intake', async () => {
    const workspace = await tempWorkspace()
    const definition = renamed()
    const completed = await runFor(workspace, 'completed', 'run-custom-completed')
    const recorder = callbacks()
    const decision = await evaluateIntakeGate(
      gateInput(workspace, await listAuthenticatedRuns(workspace, gateAuth()), [], {
        definition,
        startRun: recorder.startRun,
        resumeRun: recorder.resumeRun,
      }),
    )
    expect(decision).toMatchObject({ kind: 'allow', runId: completed.id })
    expect(recorder.starts).toEqual([])
  })
})
