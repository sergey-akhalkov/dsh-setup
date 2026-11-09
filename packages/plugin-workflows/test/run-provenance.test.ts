import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createWorkflowRoutes, RUNS_ROUTE } from '../src/host/api.ts'
import { loadShippedDefinitions } from '../src/host/definitions.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import { engineRuns } from '../src/host/projection.ts'
import {
  addViolation,
  classifyFailure,
  createRun,
  runsDirectory,
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
    expect(run).toMatchObject({
      definition: 'observed',
      definitionName: 'Observed workflow',
      definitionVersion: 4,
    })
    await writeRun(workspace, run, auth())
    const views = await engineRuns(workspace)
    expect(views[0]?.definition).toEqual({
      id: 'observed',
      name: 'Observed workflow',
      version: 4,
    })
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
})

describe('runs route definition filter', () => {
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
})
