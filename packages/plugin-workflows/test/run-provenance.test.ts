import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkflowRoutes, RUNS_ROUTE } from '../src/host/api.ts'
import { installDefinition, loadApprovedDefinitions } from '../src/host/approval-store.ts'
import { loadShippedDefinitions } from '../src/host/definitions.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { engineRuns, hashSession } from '../src/host/projection.ts'
import {
  addViolation,
  classifyFailure,
  createRun,
  incrementTurnBlocks,
  readAuthenticatedRun,
  runsDirectory,
  setRunStatus,
  settleStep,
  writeRun,
} from '../src/host/runs.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-provenance-'))
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

function auth(): HostAuth {
  return HostAuth.fromKey('provenance-host-key-0123456789')
}

describe('run provenance record', () => {
  it('records the definition id, name, and version at creation', async () => {
    const workspace = await tempWorkspace()
    const run = createRun({
      definition: 'observed',
      definitionName: 'Observed workflow',
      definitionVersion: 4,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      now: 1_000,
    })
    expect(run.definition).toEqual({ id: 'observed', name: 'Observed workflow', version: 4 })
    expect(run).not.toHaveProperty('definitionName')
    expect(run).not.toHaveProperty('definitionVersion')
    await writeRun(workspace, run, auth())
    const stored = JSON.parse(
      await readFile(join(runsDirectory(workspace), `${run.id}.json`), 'utf8'),
    ) as { definition: unknown; definitionName?: unknown; definitionVersion?: unknown }
    expect(stored.definition).toEqual({ id: 'observed', name: 'Observed workflow', version: 4 })
    expect(stored).not.toHaveProperty('definitionName')
    expect(stored).not.toHaveProperty('definitionVersion')
    const views = await engineRuns(workspace)
    expect(views[0]?.definition).toEqual({
      id: 'observed',
      name: 'Observed workflow',
      version: 4,
    })
  })

  it('normalizes a legacy string record on read without breaking its signature', async () => {
    const workspace = await tempWorkspace()
    const current = createRun({
      definition: { id: 'legacy', name: 'Legacy', version: 1 },
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      now: 1_000,
    })
    const legacy = {
      ...current,
      definition: 'legacy',
      definitionName: 'Old name',
      definitionVersion: 2,
    }
    const directory = runsDirectory(workspace)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, `${current.id}.json`),
      `${JSON.stringify({ ...legacy, signature: auth().sign('workflows/run/v1', legacy) }, null, 2)}\n`,
    )
    const read = await readAuthenticatedRun(workspace, current.id, auth())
    expect(read?.definition).toEqual({ id: 'legacy', name: 'Old name', version: 2 })
    expect(read).not.toHaveProperty('definitionName')
  })

  it('clears a failure class and reason when a blocked step completes', async () => {
    const workspace = await tempWorkspace()
    let run = createRun({
      definition: { id: 'recovery', name: 'Recovery', version: 1 },
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      now: 1_000,
    })
    run = settleStep(run, 'one', 'blocked', {
      at: 1_100,
      reason: 'no answer was recorded',
    })
    expect(run.steps[0]?.failureClass).toBe('no-answer')
    run = settleStep(run, 'one', 'done', {
      at: 1_200,
      evidence: { kind: 'declaration' },
    })
    expect(run.steps[0]?.failureClass).toBeUndefined()
    expect(run.steps[0]?.reason).toBeUndefined()
    await writeRun(workspace, run, auth())
    const view = (await engineRuns(workspace))[0]
    const step = view?.steps.find((entry) => entry.id === 'one')
    expect(step?.failureClass).toBeUndefined()
    expect(step?.reason).toBeUndefined()
  })

  it('maps a legacy violation shape in an old run record', async () => {
    const workspace = await tempWorkspace()
    const current = createRun({
      definition: { id: 'legacy-violation', name: 'Legacy', version: 1 },
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      now: 1_000,
    })
    const legacy = {
      ...current,
      violations: [{ at: 1_100, kind: 'BYPASS', step: 'one', detail: 'the old bypass reason' }],
    }
    const directory = runsDirectory(workspace)
    await mkdir(directory, { recursive: true })
    await writeFile(
      join(directory, `${current.id}.json`),
      `${JSON.stringify({ ...legacy, signature: auth().sign('workflows/run/v1', legacy) }, null, 2)}\n`,
    )
    const views = await engineRuns(workspace)
    expect(views[0]?.violations).toEqual([
      { stepId: 'one', at: 1_100, reason: 'the old bypass reason' },
    ])
  })

  it('keeps the recorded name and version readable after the definition is deleted', async () => {
    const workspace = await tempWorkspace()
    const run = createRun({
      definition: 'short-lived',
      definitionName: 'Short lived',
      definitionVersion: 2,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      now: 1_000,
    })
    await writeRun(workspace, run, auth())
    // No definition file ever exists; the run detail still carries its record.
    const views = await engineRuns(workspace)
    expect(views[0]?.definition).toEqual({ id: 'short-lived', name: 'Short lived', version: 2 })
  })

  it('classifies blocked and failed steps in the producer vocabulary', () => {
    expect(classifyFailure('the file .dsh/x.md does not exist')).toBe('missing-file')
    expect(classifyFailure('the record digest mismatch')).toBe('record-mismatch')
    expect(classifyFailure('the human rejected the answer')).toBe('rejected-answer')
    expect(classifyFailure('no matching answer was observed')).toBe('no-answer')
    expect(classifyFailure('the tool was not observed')).toBe('no-call')
    expect(classifyFailure('the child returned an invalid schema result')).toBe('invalid-result')
    expect(classifyFailure(undefined)).toBe('check-failed')
    // A detail in parentheses is context, never the cause.
    expect(
      classifyFailure('waiting for the legacy gate: no-call (record-mismatch in the detail)'),
    ).toBe('no-call')
    expect(classifyFailure('the user answer "no" is not one of: yes')).toBe('rejected-answer')
    const workspace = '/workspace'
    const run = createRun({
      definition: 'demo',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      now: 1,
    })
    const blocked = settleStep(run, 'one', 'blocked', {
      at: 2,
      reason: 'the evidence file does not exist',
    })
    expect(blocked.steps[0]?.failureClass).toBe('missing-file')
    const explicit = settleStep(run, 'one', 'failed', {
      at: 2,
      reason: 'whatever',
      failureClass: 'executor-failure',
    })
    expect(explicit.steps[0]?.failureClass).toBe('executor-failure')
    const done = settleStep(run, 'one', 'done', { at: 2 })
    expect(done.steps[0]?.failureClass).toBeUndefined()
  })

  it('exposes structured evidence, failure class, and violations on the view', async () => {
    const workspace = await tempWorkspace()
    const run = createRun({
      definition: 'demo',
      definitionName: 'Demo',
      definitionVersion: 1,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one', 'two'],
      now: 1_000,
    })
    let settled = settleStep(run, 'one', 'done', {
      at: 1_100,
      evidence: { kind: 'file', path: '.dsh/workflows/drafts/demo/requirements.md', at: 1_050 },
    })
    settled = settleStep(settled, 'two', 'blocked', {
      at: 1_200,
      reason: 'the evidence call was not observed',
    })
    settled = addViolation(settled, 'the user bypassed the step', {
      kind: 'BYPASS',
      step: 'two',
      at: 1_250,
    })
    await writeRun(workspace, settled, auth())
    // The persisted record carries the structured evidence contract itself.
    expect(settled.steps[0]?.evidence).toMatchObject({
      kind: 'file',
      ref: '.dsh/workflows/drafts/demo/requirements.md',
      at: 1_050,
    })
    const stored = JSON.parse(
      await readFile(join(runsDirectory(workspace), `${settled.id}.json`), 'utf8'),
    ) as { violations: Record<string, unknown>[] }
    expect(stored.violations).toEqual([
      { stepId: 'two', at: 1_250, reason: 'the user bypassed the step' },
    ])
    expect(stored.violations[0]).not.toHaveProperty('kind')
    expect(stored.violations[0]).not.toHaveProperty('detail')
    expect(stored.violations[0]).not.toHaveProperty('step')
    const view = (await engineRuns(workspace))[0]
    const first = view?.steps.find((step) => step.id === 'one')
    expect(first?.evidenceRef).toEqual({
      kind: 'file',
      ref: '.dsh/workflows/drafts/demo/requirements.md',
      at: 1_050,
    })
    expect(first?.evidence).toBe('.dsh/workflows/drafts/demo/requirements.md')
    const second = view?.steps.find((step) => step.id === 'two')
    expect(second?.failureClass).toBe('no-call')
    expect(view?.violations).toEqual([
      { stepId: 'two', at: 1_250, reason: 'the user bypassed the step' },
    ])
  })

  it('composes the title from the recorded definition and subject', async () => {
    const workspace = await tempWorkspace()
    const runs = [
      createRun({
        definition: { id: 'change-intake', name: 'OpenSpec change intake', version: 1 },
        trigger: 'tool.pre-execute',
        session: 'session-1',
        workspace,
        context: { name: 'redesign-workflows-ui' },
        steps: ['requirements'],
        id: 'run-intake',
        now: 1_000,
      }),
      createRun({
        definition: { id: 'retro', name: 'Work checkpoint', version: 1 },
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { checkpoint: `.dsh/work-checkpoints/${hashSession('session-1')}/6.json` },
        steps: ['gate'],
        id: 'run-retro',
        now: 1_000,
      }),
      createRun({
        definition: { id: 'task-review', name: 'Task review', version: 1 },
        trigger: 'fs.change',
        session: 'session-1',
        workspace,
        context: { name: 'auth', taskId: '9090eae78b47a85c' },
        steps: ['review'],
        id: 'run-review',
        now: 1_000,
      }),
      createRun({
        definition: { id: 'retro', name: 'Work checkpoint', version: 1 },
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { checkpoint: '', name: 'fallback-change' },
        steps: ['gate'],
        id: 'run-empty-checkpoint',
        now: 1_000,
      }),
      createRun({
        definition: { id: 'retro', name: 'Work checkpoint', version: 1 },
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        context: { checkpoint: '.dsh/work-checkpoints/abc123/', name: 'fallback-change' },
        steps: ['gate'],
        id: 'run-directory-checkpoint',
        now: 1_000,
      }),
      createRun({
        definition: { id: 'verify', name: 'Verification check', version: 1 },
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        steps: ['checks'],
        id: 'run-verify',
        now: 1_000,
      }),
    ]
    for (const run of runs) await writeRun(workspace, run, auth())
    const views = await engineRuns(workspace)
    const titleOf = (id: string): string | undefined =>
      views.find((view) => view.id === `workflow:${id}`)?.title
    expect(titleOf('run-intake')).toBe('OpenSpec change intake · redesign-workflows-ui')
    expect(titleOf('run-retro')).toBe('Work checkpoint · turn 6')
    // An absent or directory-only checkpoint is not turn 0; the change names it.
    expect(titleOf('run-empty-checkpoint')).toBe('Work checkpoint · fallback-change')
    expect(titleOf('run-directory-checkpoint')).toBe('Work checkpoint · fallback-change')
    // A task review's subject is the task, not the change it belongs to.
    expect(titleOf('run-review')).toBe('Task review · 9090eae7')
    expect(titleOf('run-verify')).toBe('Verification check')
  })

  it('exposes the recorded trigger and derives the terminal time from settled steps', async () => {
    const workspace = await tempWorkspace()
    const running = settleStep(
      createRun({
        definition: 'demo',
        definitionName: 'Demo',
        definitionVersion: 1,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        steps: ['one'],
        id: 'run-running',
        now: 1_000,
      }),
      'one',
      'done',
      { at: 1_100 },
    )
    await writeRun(workspace, running, auth())
    const completed = setRunStatus(
      settleStep(
        createRun({
          definition: 'demo',
          definitionName: 'Demo',
          definitionVersion: 1,
          trigger: 'turn.stopping',
          session: 'session-1',
          workspace,
          steps: ['one'],
          id: 'run-completed',
          now: 2_000,
        }),
        'one',
        'done',
        { at: 2_100 },
      ),
      'completed',
      2_900,
    )
    await writeRun(workspace, completed, auth())
    const empty = setRunStatus(
      createRun({
        definition: 'demo',
        definitionName: 'Demo',
        definitionVersion: 1,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace,
        steps: ['never-settled'],
        id: 'run-empty',
        now: 3_000,
      }),
      'completed',
      3_900,
    )
    await writeRun(workspace, empty, auth())
    const views = await engineRuns(workspace)
    const view = (id: string): (typeof views)[number] | undefined =>
      views.find((entry) => entry.id === `workflow:${id}`)
    expect(view('run-running')?.trigger).toBe('turn.stopping')
    expect(view('run-running')?.endedAt).toBeUndefined()
    // The end time is the latest settlement, never the later update stamp.
    expect(view('run-completed')?.endedAt).toBe(2_100)
    expect(view('run-empty')?.endedAt).toBeUndefined()
  })

  it('keeps a completed retro terminal time after a later turn block and violation', async () => {
    const workspace = await tempWorkspace()
    let run = createRun({
      definition: { id: 'retro', name: 'Work checkpoint', version: 1 },
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: { checkpoint: `.dsh/work-checkpoints/${hashSession('session-1')}/6.json` },
      steps: ['gate'],
      id: 'run-retro-late',
      now: 1_000,
    })
    run = settleStep(run, 'gate', 'done', { at: 1_500 })
    run = setRunStatus(run, 'completed', 1_600)
    run = addViolation(run, 'the turn closed early', { step: 'gate', at: 2_000 })
    run = incrementTurnBlocks(run, 2_500)
    await writeRun(workspace, run, auth())
    const view = (await engineRuns(workspace))[0]
    expect(view?.endedAt).toBe(1_500)
    expect(view?.violations).toHaveLength(1)
    expect(view?.steps.some((step) => step.synthetic === true)).toBe(true)
  })
})

describe('runs route definition filter', () => {
  it('keeps the creation snapshot and settled history after the definition changes and is deleted', async () => {
    const workspace = await tempWorkspace()
    const shipped = loadShippedDefinitions()[0]
    if (shipped === undefined) throw new Error('no shipped definition')
    const stepId = shipped.steps[0]?.id
    if (stepId === undefined) throw new Error('no shipped step')
    const source = async (name: string, value: unknown): Promise<string> => {
      const path = join(workspace, name)
      await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
      return path
    }
    await installDefinition(workspace, await source('v1.json', shipped), auth())
    const installed = (await loadApprovedDefinitions(workspace, { auth: auth() })).definitions.find(
      (definition) => definition.id === shipped.id,
    )
    if (installed === undefined) throw new Error('the shipped definition was not installed')
    let run = createRun({
      definition: installed.id,
      definitionName: installed.name,
      definitionVersion: installed.version,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: {},
      steps: [stepId],
      now: 1_000,
    })
    run = settleStep(run, stepId, 'failed', {
      at: 2_000,
      reason: 'the user answer "no" is not one of: yes',
      evidence: { kind: 'record', ref: 'record-1.json' },
    })
    run = addViolation(run, 'the step bypassed its gate', {
      kind: 'BYPASS',
      step: stepId,
      at: 2_100,
    })
    run = setRunStatus(run, 'failed', 2_200, 'the answer was rejected')
    await writeRun(workspace, run, auth())
    // The definition changes, then disappears; the run keeps its own snapshot.
    await installDefinition(
      workspace,
      await source('v2.json', { ...shipped, name: 'Renamed', version: shipped.version + 1 }),
      auth(),
    )
    await rm(join(workspace, '.dsh', 'workflows', 'definitions', `${shipped.id}.json`))
    const view = (await engineRuns(workspace))[0]
    expect(view?.definition).toEqual({
      id: shipped.id,
      name: shipped.name,
      version: shipped.version,
    })
    const viewStep = view?.steps.find((step) => step.id === stepId)
    expect(viewStep?.evidenceRef).toMatchObject({ kind: 'record', ref: 'record-1.json' })
    expect(viewStep?.failureClass).toBe('rejected-answer')
    expect(view?.violations?.[0]).toMatchObject({
      stepId,
      reason: expect.stringContaining('bypassed'),
    })
  })

  it('filters by definition and source and returns the newest first', async () => {
    const workspace = await tempWorkspace()
    const first = createRun({
      definition: 'alpha',
      definitionName: 'Alpha',
      definitionVersion: 1,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      id: 'run-alpha-old',
      now: 1_000,
    })
    const second = createRun({
      definition: 'alpha',
      definitionName: 'Alpha',
      definitionVersion: 1,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      id: 'run-alpha-new',
      now: 2_000,
    })
    const other = createRun({
      definition: 'beta',
      definitionName: 'Beta',
      definitionVersion: 1,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      steps: ['one'],
      id: 'run-beta',
      now: 1_500,
    })
    for (const run of [first, second, other]) await writeRun(workspace, run, auth())
    // A damaged file is a diagnostic row, never a matching run.
    await mkdir(runsDirectory(workspace), { recursive: true })
    await writeFile(join(runsDirectory(workspace), 'broken.json'), '{not json\n', 'utf8')

    const routes = createWorkflowRoutes({
      agents: { get: () => ({ session: {} }) },
      workingDirectory: { get: () => workspace },
      journal: { read: async () => ({ records: [] }) } as never,
      healthFor: () =>
        ({
          snapshot: () => ({ listenerCount: 5, journalWritable: true, triggerCount: 9 }),
          stateFor: () => 'healthy',
        }) as never,
      triggers: [],
    })
    const runsRoute = routes.find((entry) => entry.path === RUNS_ROUTE)
    const response = await runsRoute?.fetch(
      new Request(
        `http://localhost${RUNS_ROUTE}?session=session-1&source=workflow&definition=alpha&limit=10`,
      ),
    )
    const body = (await response?.json()) as {
      runs: Array<{ id: string; definition?: { id: string } }>
    }
    expect(body.runs.map((run) => run.id)).toEqual([
      'workflow:run-alpha-new',
      'workflow:run-alpha-old',
    ])
    expect(body.runs.every((run) => run.definition?.id === 'alpha')).toBe(true)

    const unfiltered = await runsRoute?.fetch(
      new Request(`http://localhost${RUNS_ROUTE}?session=session-1&limit=10`),
    )
    const unfilteredBody = (await unfiltered?.json()) as { runs: Array<{ id: string }> }
    expect(unfilteredBody.runs.map((run) => run.id)).toEqual(
      expect.arrayContaining(['workflow:run-beta', 'workflow:run-alpha-new']),
    )
    // The projection uses the engine's own definition ids, not the shipped set.
    expect(loadShippedDefinitions().some((entry) => entry.id === 'alpha')).toBe(false)
  })

  it('orders newest first on request and resolves one attributed run', async () => {
    const workspace = await tempWorkspace()
    const write = async (id: string, session: string, now: number): Promise<void> => {
      await writeRun(
        workspace,
        createRun({
          definition: 'demo',
          definitionName: 'Demo',
          definitionVersion: 1,
          trigger: 'turn.stopping',
          session,
          workspace,
          steps: ['one'],
          id,
          now,
        }),
        auth(),
      )
    }
    await write('run-old', 'session-1', 1_000)
    await write('run-mid', 'session-1', 2_000)
    await write('run-new', 'session-1', 3_000)
    await write('run-other', 'session-2', 4_000)
    const routes = createWorkflowRoutes({
      agents: { get: () => ({ session: {} }) },
      workingDirectory: { get: () => workspace },
      journal: { read: async () => ({ records: [] }) } as never,
      healthFor: () =>
        ({
          snapshot: () => ({ listenerCount: 5, journalWritable: true, triggerCount: 9 }),
          stateFor: () => 'healthy',
        }) as never,
      triggers: [],
    })
    const runsRoute = routes.find((entry) => entry.path === RUNS_ROUTE)
    if (runsRoute === undefined) throw new Error('the runs route was not registered')
    const get = async (query: string): Promise<{ runs: Array<{ id: string }>; next?: string }> =>
      (await (
        await runsRoute.fetch(
          new Request(`http://localhost${RUNS_ROUTE}?session=session-1&${query}`),
        )
      ).json()) as { runs: Array<{ id: string }>; next?: string }
    const ascending = ['workflow:run-old', 'workflow:run-mid', 'workflow:run-new']
    expect((await get('limit=10')).runs.map((run) => run.id)).toEqual(ascending)
    expect((await get('limit=10&order=oldest')).runs.map((run) => run.id)).toEqual(ascending)
    const first = await get('limit=2&order=newest')
    expect(first.runs.map((run) => run.id)).toEqual(['workflow:run-new', 'workflow:run-mid'])
    expect(first.next).toBe('2')
    const second = await get(`limit=2&order=newest&cursor=${first.next ?? ''}`)
    expect(second.runs.map((run) => run.id)).toEqual(['workflow:run-old'])
    expect(second.next).toBeUndefined()
    // A definition request is already newest first and is reversed once.
    expect((await get('definition=demo&order=newest&limit=10')).runs.map((run) => run.id)).toEqual(
      [...ascending].reverse(),
    )
    // The lookup is session-scoped and resolved after attribution.
    expect((await get('run=workflow:run-mid')).runs.map((run) => run.id)).toEqual([
      'workflow:run-mid',
    ])
    expect((await get('run=workflow:run-absent')).runs).toEqual([])
    expect((await get('run=workflow:run-other')).runs).toEqual([])
  })
})
