import { createHash } from 'node:crypto'
import { appendFile, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Harness as DelegationHarness,
  defaultTestConfig,
  FakeSubagents,
  makeWorkspace,
  runIdFrom,
  writeChange,
} from '../../plugin-delegation-rules/test/helpers.ts'
import { CheckpointHarness } from '../../plugin-goal-continuity/test/checkpoint-harness.ts'
import {
  DELEGATION_DIR,
  delegationObservations,
  hashSession,
  type RunView,
  sessionRuns,
  WORKFLOW_EVENTS_DIR,
  workspaceRuns,
} from '../src/host/projection.ts'

const fixtures = fileURLToPath(new URL('./fixtures', import.meta.url))
const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-projection-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

async function install(workspace: string, relative: string, fixture: string): Promise<string> {
  const target = join(workspace, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await copyFile(join(fixtures, fixture), target)
  return target
}

async function writeRaw(workspace: string, relative: string, text: string): Promise<string> {
  const target = join(workspace, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, text, 'utf8')
  return target
}

async function writeJson(workspace: string, relative: string, value: unknown): Promise<string> {
  const target = join(workspace, relative)
  await mkdir(join(target, '..'), { recursive: true })
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return target
}

async function journalLine(
  workspace: string,
  session: string,
  summary: string,
  at: number,
): Promise<void> {
  const directory = join(workspace, WORKFLOW_EVENTS_DIR)
  await mkdir(directory, { recursive: true })
  const line = JSON.stringify({
    v: 1,
    at,
    session,
    kind: 'tools/result',
    subject: 'delegate',
    callId: 'call-1',
    ok: true,
    summary,
    bytes: summary.length,
    truncated: false,
  })
  await appendFile(join(directory, `${session}.jsonl`), `${line}\n`, { encoding: 'utf8' })
}

async function fileHash(file: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true })
    }),
  )
})

function checkpointRun(runs: readonly RunView[]): RunView | undefined {
  return runs.find((run) => run.source === 'checkpoint')
}

describe('checkpoint projection', () => {
  it('projects the requesting session and ignores another session hash', async () => {
    const workspace = await tempWorkspace()
    // Compute the producer directory independently of the adapter's helper.
    const producerHash = createHash('sha256').update('session-1').digest('hex').slice(0, 16)
    await install(workspace, `${'.dsh/work-checkpoints'}/${producerHash}/2.json`, 'checkpoint.json')
    await install(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-2')}/2.json`,
      'checkpoint.json',
    )
    const runs = await sessionRuns(workspace, 'session-1')
    const checkpoint = checkpointRun(runs)
    expect(checkpoint?.session).toBe('session-1')
    expect(checkpoint?.attribution).toBe('local')
    expect(checkpoint?.title).toBe('Checkpoint turn 2')
    expect(checkpoint?.steps.map((step) => step.id)).toEqual([
      'outcome',
      'lane:lane-a',
      'bottleneck',
      'next',
    ])
    expect(checkpoint?.steps.find((step) => step.id === 'bottleneck')?.state).toBe('lead_action')
    expect(checkpoint?.steps.find((step) => step.id === 'bottleneck')?.evidence).toBe(
      'packages/plugin-workflows',
    )
    expect(checkpoint?.steps.find((step) => step.id === 'next')?.evidence).toBe(
      'finish the projection test',
    )
    expect(checkpoint?.steps.find((step) => step.id === 'outcome')?.state).toBe('continue')
    expect(checkpoint?.steps.find((step) => step.id === 'lane:lane-a')?.state).toBe('running')
    expect(checkpoint?.status).toBe('running')
    expect(checkpoint?.steps.find((step) => step.id === 'lane:lane-a')?.evidence).toBe(
      'packages/plugin-workflows',
    )
    expect(checkpoint?.record).toContain(hashSession('session-1'))
    const other = await sessionRuns(workspace, 'session-2')
    expect(checkpointRun(other)?.session).toBe('session-2')
  })

  it('maps a done checkpoint to a done run with done outcome and lane states', async () => {
    const workspace = await tempWorkspace()
    await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/5.json`,
      JSON.stringify({
        version: 2,
        checkpoint: 'checkpoint-5-done',
        revision: 2,
        turn: 5,
        outcome: 'done',
        verified: ['all lanes done'],
        lanes: [
          {
            id: 'lane-a',
            owner: 'lead',
            scope: ['packages/plugin-workflows'],
            state: 'done',
            blockedBy: [],
          },
        ],
        laneAges: [{ id: 'lane-a', checkpoints: 2 }],
        bottleneck: {
          id: 'lane-a',
          owner: 'lead',
          action: 'lead_action',
          blockingLanes: [],
          targets: ['packages/plugin-workflows'],
        },
        bottleneckKey: 'lane-a:lead_action:packages/plugin-workflows',
        derivedRemaining: [],
        parallelComputed: false,
        next: 'archive the change',
        time: '2026-11-07T10:20:00.000Z',
        session: '[REDACTED]',
      }),
    )
    const run = checkpointRun(await sessionRuns(workspace, 'session-1'))
    expect(run?.status).toBe('done')
    expect(run?.steps.find((step) => step.id === 'outcome')?.state).toBe('done')
    expect(run?.steps.find((step) => step.id === 'lane:lane-a')?.state).toBe('done')
  })

  it('projects a checkpoint written by the real goal-continuity producer', async () => {
    const { harness, cleanup } = await CheckpointHarness.create({
      sessionId: 'producer-session',
    })
    try {
      harness.turnStart(1)
      const written = await harness.checkpoint({
        outcome: 'continue',
        verified: ['the producer harness wrote a record'],
        lanes: [
          {
            id: 'lane-a',
            owner: 'lead',
            scope: ['packages/plugin-workflows'],
            state: 'running',
            blockedBy: [],
          },
        ],
        bottleneck: {
          id: 'lane-a',
          owner: 'lead',
          action: 'lead_action',
          targets: ['packages/plugin-workflows'],
        },
        next: 'finish the producer-backed test',
      })
      expect(written.text).toContain('recorded')
      const producerHash = createHash('sha256')
        .update('producer-session')
        .digest('hex')
        .slice(0, 16)
      expect(written.text).toContain(producerHash)

      const runs = await sessionRuns(harness.workspace, harness.sessionId)
      const run = checkpointRun(runs)
      expect(run?.session).toBe('producer-session')
      expect(run?.attribution).toBe('local')
      expect(run?.status).toBe('running')
      expect(run?.steps.find((step) => step.id === 'outcome')?.state).toBe('continue')
      expect(run?.steps.find((step) => step.id === 'lane:lane-a')?.state).toBe('running')
      expect(run?.steps.find((step) => step.id === 'bottleneck')?.state).toBe('lead_action')
      expect(run?.steps.find((step) => step.id === 'next')?.evidence).toBe(
        'finish the producer-backed test',
      )
      expect(await sessionRuns(harness.workspace, 'foreign-session')).toEqual([])
    } finally {
      await cleanup()
    }
  })

  it('returns an empty state for a missing directory and an error row for a malformed file', async () => {
    const empty = await tempWorkspace()
    expect(await sessionRuns(empty, 'session-1')).toEqual([])

    const workspace = await tempWorkspace()
    const record = await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/1.json`,
      '{ broken json',
    )
    const runs = await sessionRuns(workspace, 'session-1')
    const error = runs.find((run) => run.source === 'checkpoint')
    expect(error?.error).toContain('.dsh/work-checkpoints')
    expect(error?.error).toContain('JSON')
    expect(error?.id).toBe('checkpoint:1')
    expect(record).toContain('1.json')

    const invalidOutcome = await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/3.json`,
      JSON.stringify({ outcome: 42, turn: 3, lanes: [], next: 'x' }),
    )
    const invalidRuns = await sessionRuns(workspace, 'session-1')
    expect(invalidRuns.find((run) => run.id === 'checkpoint:3')?.error).toContain(
      'missing or invalid outcome, turn, lanes, or next',
    )
    expect(invalidOutcome).toContain('3.json')

    await writeRaw(workspace, `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/4.json`, '{}')
    const emptyRuns = await sessionRuns(workspace, 'session-1')
    expect(emptyRuns.find((run) => run.id === 'checkpoint:4')?.error).toContain(
      'missing or invalid outcome, turn, lanes, or next',
    )

    await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/6.json`,
      JSON.stringify({ outcome: 'continue', turn: 6, lanes: [null], next: 'x' }),
    )
    await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/7.json`,
      JSON.stringify({ outcome: 'continue', turn: 7, lanes: [], next: 'x' }),
    )
    const malformedRuns = await sessionRuns(workspace, 'session-1')
    expect(malformedRuns.find((run) => run.id === 'checkpoint:6')?.error).toContain(
      'missing or invalid outcome, turn, lanes, or next',
    )
    expect(malformedRuns.find((run) => run.id === 'checkpoint:7')?.error).toContain(
      'missing or invalid bottleneck',
    )

    const baseBottleneck = {
      id: 'lane-a',
      owner: 'lead',
      action: 'lead_action',
      targets: ['packages/plugin-workflows'],
    }
    await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/8.json`,
      JSON.stringify({
        outcome: 'continue',
        turn: 8,
        lanes: [],
        bottleneck: { ...baseBottleneck, action: 'not-a-remedy' },
        next: 'x',
      }),
    )
    await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/9.json`,
      JSON.stringify({
        outcome: 'continue',
        turn: 9,
        lanes: [],
        bottleneck: { ...baseBottleneck, targets: 42 },
        next: 'x',
      }),
    )
    await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/10.json`,
      JSON.stringify({
        outcome: 'continue',
        turn: 10,
        lanes: [],
        bottleneck: { id: 'lane-a', owner: 'lead', action: 'lead_action' },
        next: 'x',
      }),
    )
    const invalidBottlenecks = await sessionRuns(workspace, 'session-1')
    for (const turn of [8, 9, 10]) {
      expect(
        invalidBottlenecks.find((run) => run.id === `checkpoint:${String(turn)}`)?.error,
      ).toContain('missing or invalid bottleneck')
    }
  })
})

describe('delegation and review projection', () => {
  it('joins only a record whose runId matches and never attributes from the record path', async () => {
    const workspace = await tempWorkspace()
    await install(
      workspace,
      `${DELEGATION_DIR}/runs/run-pending.json`,
      'delegation-run-pending.json',
    )
    await install(
      workspace,
      `${DELEGATION_DIR}/runs/run-settled.json`,
      'delegation-run-settled.json',
    )
    await install(
      workspace,
      `${DELEGATION_DIR}/task-review/add-workflow-observability/tasks/abc124.json`,
      'delegation-record.json',
    )
    const runs = await workspaceRuns(workspace)
    const pending = runs.find((run) => run.id === 'delegation:run-mw6abcde-1234abcd')
    expect(pending?.status).toBe('running')
    expect(pending?.attribution).toBe('unattributed')
    expect(pending?.steps.map((step) => step.id)).toEqual(['rule', 'change', 'state'])
    const settled = runs.find((run) => run.id === 'delegation:run-mw6abcde-1234abce')
    expect(settled?.status).toBe('done')
    expect(settled?.attribution).toBe('local')
    expect(settled?.session).toBe('session-1')
    expect(settled?.steps.map((step) => step.id)).toContain('record')
    expect(settled?.steps.find((step) => step.id === 'record')?.state).toBe('PASS')
  })

  it('keeps a run unattributed when its record path holds another runId', async () => {
    const workspace = await tempWorkspace()
    await install(
      workspace,
      `${DELEGATION_DIR}/runs/run-settled.json`,
      'delegation-run-settled.json',
    )
    await install(
      workspace,
      `${DELEGATION_DIR}/task-review/add-workflow-observability/tasks/abc124.json`,
      'delegation-record-other.json',
    )
    const run = (await workspaceRuns(workspace)).find(
      (candidate) => candidate.id === 'delegation:run-mw6abcde-1234abce',
    )
    expect(run?.attribution).toBe('unattributed')
    expect(run?.steps.map((step) => step.id)).not.toContain('record')
  })

  it('projects runs and records written by the real delegation harness', async () => {
    const created = await makeWorkspace()
    try {
      await writeChange(created.root, 'change-a', [
        { number: '1.1', text: 'Do the thing', checked: true },
      ])
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent')
      subagents.addProvider('codex-subagent-write')
      const harness = new DelegationHarness({
        cwd: created.root,
        config: defaultTestConfig(),
        agents: subagents,
      })
      const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
      await harness.waitForRun(runId)
      const run = (await workspaceRuns(created.root)).find(
        (candidate) => candidate.id === `delegation:${runId}`,
      )
      expect(run?.status).toBe('done')
      expect(run?.attribution).toBe('local')
      expect(run?.session).toBeTruthy()
      expect(run?.steps.find((step) => step.id === 'record')?.state).toBe('PASS')
      expect(run?.steps.find((step) => step.id === 'target')?.evidence).toContain('codex-subagent')

      const handle = await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' })
      const taskRun = runIdFrom(handle)
      await harness.waitForRun(taskRun)
      const portable = (await workspaceRuns(created.root)).find(
        (candidate) => candidate.source === 'review' && candidate.attribution === 'portable',
      )
      expect(portable).toBeDefined()
      expect(portable?.session).toBeTruthy()
      expect(portable?.status).toBe('done')
    } finally {
      await created.cleanup()
    }
  })

  it('shows malformed and incomplete delegation records as error rows naming the file', async () => {
    const workspace = await tempWorkspace()
    await writeRaw(workspace, `${DELEGATION_DIR}/runs/run-bad.json`, '{ broken json')
    await install(
      workspace,
      `${DELEGATION_DIR}/runs/run-missing.json`,
      'delegation-run-missing.json',
    )
    const runs = await workspaceRuns(workspace)
    const malformed = runs.find((run) => run.id === 'delegation:run-bad')
    expect(malformed?.error).toContain('.dsh/delegation/runs/run-bad.json')
    const missing = runs.find((run) => run.id === 'delegation:run-missing')
    expect(missing?.error).toContain('state')

    await writeRaw(
      workspace,
      `${DELEGATION_DIR}/runs/run-no-id.json`,
      JSON.stringify({ rule: 'task-review', change: 'x', state: 'completed' }),
    )
    await writeRaw(
      workspace,
      `${DELEGATION_DIR}/task-review/change-x/tasks/bad.json`,
      '{ broken local record',
    )
    await writeRaw(
      workspace,
      `${DELEGATION_DIR}/task-review/change-x/tasks/incomplete.json`,
      JSON.stringify({ runId: 'run-x', session: 'session-1' }),
    )
    const second = await workspaceRuns(workspace)
    expect(second.find((run) => run.id === 'delegation:run-no-id')?.error).toContain('field "id"')
    const localFailures = second.filter((run) => run.id.startsWith('local-review:'))
    expect(
      localFailures.some((run) => run.error?.includes('bad.json') && run.error.includes('JSON')),
    ).toBe(true)
    expect(
      localFailures.some(
        (run) =>
          run.error?.includes('incomplete.json') && run.error.includes('missing or invalid field'),
      ),
    ).toBe(true)
  })

  it('joins a valid FINDINGS record and rejects incomplete local records', async () => {
    const workspace = await tempWorkspace()
    const run = (id: string, record: string): Record<string, unknown> => ({
      id,
      rule: 'task-review',
      change: 'add-workflow-observability',
      key: 'k',
      identity: 'i',
      state: 'completed',
      record,
      startedAt: '2026-11-07T10:05:00.000Z',
    })
    await writeJson(
      workspace,
      `${DELEGATION_DIR}/runs/run-findings.json`,
      run('run-mw6abcde-aaaaaaaa', '.dsh/delegation/task-review/x/tasks/a.json'),
    )
    await writeJson(
      workspace,
      `${DELEGATION_DIR}/runs/run-incomplete.json`,
      run('run-mw6abcde-bbbbbbbb', '.dsh/delegation/task-review/x/tasks/b.json'),
    )
    await writeJson(workspace, `${DELEGATION_DIR}/task-review/x/tasks/a.json`, {
      rule: 'task-review',
      change: 'add-workflow-observability',
      phase: 'task',
      scope: 'task',
      taskId: '0123456789abcdef',
      digest: `${'a'.repeat(64)}`,
      verdict: 'FINDINGS',
      findings: [{ severity: 'P1', title: 't', evidence: 'e', fix: 'f' }],
      target: { provider: 'codex-subagent' },
      session: 'session-1',
      runId: 'run-mw6abcde-aaaaaaaa',
      time: '2026-11-07T10:10:00.000Z',
    })
    await writeJson(workspace, `${DELEGATION_DIR}/task-review/x/tasks/b.json`, {
      runId: 'run-mw6abcde-bbbbbbbb',
      session: 'session-1',
    })
    const runs = await workspaceRuns(workspace)
    const findings = runs.find((candidate) => candidate.id === 'delegation:run-mw6abcde-aaaaaaaa')
    expect(findings?.attribution).toBe('local')
    expect(findings?.steps.find((step) => step.id === 'record')?.state).toBe('FINDINGS')
    expect(findings?.steps.find((step) => step.id === 'target')?.evidence).toContain(
      'codex-subagent',
    )
    const incomplete = runs.find((candidate) => candidate.id === 'delegation:run-mw6abcde-bbbbbbbb')
    expect(incomplete?.attribution).toBe('unattributed')
    expect(incomplete?.steps.map((step) => step.id)).not.toContain('record')
    expect(
      runs.some(
        (candidate) =>
          candidate.id.startsWith('local-review:') &&
          candidate.error?.includes('missing or invalid field'),
      ),
    ).toBe(true)

    // A snapshot checkout is ordinary scratch, not a review record.
    await writeJson(workspace, `${DELEGATION_DIR}/snapshots/run-example/package.json`, {
      name: 'checkout',
    })
    const withSnapshot = await workspaceRuns(workspace)
    expect(
      withSnapshot.some(
        (candidate) =>
          candidate.id.startsWith('local-review:') && candidate.id.includes('snapshots'),
      ),
    ).toBe(false)

    // Invalid scopes and empty finding text cannot enrich or attribute a run.
    await writeJson(workspace, `${DELEGATION_DIR}/task-review/x/tasks/c.json`, {
      rule: 'task-review',
      change: 'add-workflow-observability',
      phase: 'task',
      scope: 'invalid',
      taskId: '0123456789abcdef',
      digest: `${'a'.repeat(64)}`,
      verdict: 'PASS',
      findings: [],
      target: { provider: 'codex-subagent' },
      session: 'session-1',
      runId: 'run-mw6abcde-bbbbbbbb',
      time: '2026-11-07T10:10:00.000Z',
    })
    await writeJson(workspace, `${DELEGATION_DIR}/task-review/x/tasks/d.json`, {
      rule: 'task-review',
      change: 'add-workflow-observability',
      phase: 'task',
      scope: 'task',
      taskId: '0123456789abcdef',
      digest: `${'a'.repeat(64)}`,
      verdict: 'FINDINGS',
      findings: [{ severity: 'P1', title: ' ', evidence: '', fix: '' }],
      target: { provider: 'codex-subagent' },
      session: 'session-1',
      runId: 'run-mw6abcde-bbbbbbbb',
      time: '2026-11-07T10:10:00.000Z',
    })
    const invalidScopes = await workspaceRuns(workspace)
    expect(
      invalidScopes.filter(
        (candidate) =>
          candidate.id.startsWith('local-review:') && candidate.error?.includes('scope'),
      ).length,
    ).toBeGreaterThan(0)
    expect(
      invalidScopes.filter(
        (candidate) =>
          candidate.id.startsWith('local-review:') && candidate.error?.includes('findings'),
      ).length,
    ).toBeGreaterThan(0)
  })

  it('rejects an incomplete portable approval', async () => {
    const workspace = await tempWorkspace()
    await writeJson(
      workspace,
      'openspec/changes/add-workflow-observability/reviews/incomplete.json',
      {
        change: 'add-workflow-observability',
        taskId: '0123456789abcdef',
        digest: `${'a'.repeat(64)}`,
        verdict: 'PASS',
      },
    )
    const runs = await workspaceRuns(workspace)
    const error = runs.find(
      (candidate) => candidate.id === 'review:add-workflow-observability/incomplete',
    )
    expect(error?.error).toContain('missing or invalid field')
    expect(
      runs.some((candidate) => candidate.source === 'review' && candidate.status === 'done'),
    ).toBe(false)

    await writeJson(
      workspace,
      'openspec/changes/add-workflow-observability/reviews/whole-scope.json',
      {
        rule: 'task-review',
        change: 'add-workflow-observability',
        scope: 'whole',
        taskId: '0123456789abcdef',
        digest: `${'a'.repeat(64)}`,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-07T10:12:00.000Z',
      },
    )
    const withWhole = await workspaceRuns(workspace)
    expect(
      withWhole.find(
        (candidate) => candidate.id === 'review:add-workflow-observability/whole-scope',
      )?.error,
    ).toContain('"scope" must be "task"')

    await writeJson(
      workspace,
      'openspec/changes/add-workflow-observability/reviews/secret-target.json',
      {
        rule: 'task-review',
        change: 'add-workflow-observability',
        scope: 'task',
        taskId: '0123456789abcdef',
        digest: `${'a'.repeat(64)}`,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent', model: '{"password":"SYNTHETIC-SECRET"}' },
        time: '2026-11-07T10:12:00.000Z',
      },
    )
    const secretTarget = (await workspaceRuns(workspace)).find(
      (candidate) => candidate.id === 'review:add-workflow-observability/0123456789abcdef',
    )
    expect(secretTarget?.steps.find((step) => step.id === 'target')?.evidence).not.toContain(
      'SYNTHETIC-SECRET',
    )
  })

  it('attributes a portable review only through a matching local record', async () => {
    const workspace = await tempWorkspace()
    await install(
      workspace,
      'openspec/changes/add-workflow-observability/reviews/abc123.json',
      'portable-review.json',
    )
    const unattributed = (await workspaceRuns(workspace)).find(
      (run) => run.id === 'review:add-workflow-observability/0123456789abcdef',
    )
    expect(unattributed?.attribution).toBe('unattributed')
    expect(await sessionRuns(workspace, 'session-1')).toEqual([])

    await writeJson(
      workspace,
      `${DELEGATION_DIR}/task-review/add-workflow-observability/tasks/abc123.json`,
      {
        rule: 'task-review',
        change: 'add-workflow-observability',
        phase: 'task',
        scope: 'task',
        taskId: '0123456789abcdef',
        digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        session: 'session-1',
        runId: 'run-mw6abcde-99999999',
        time: '2026-11-07T10:12:00.000Z',
      },
    )
    const attributed = (await workspaceRuns(workspace)).find(
      (run) => run.id === 'review:add-workflow-observability/0123456789abcdef',
    )
    expect(attributed?.attribution).toBe('portable')
    expect(attributed?.session).toBe('session-1')
    expect((await sessionRuns(workspace, 'session-1')).some((run) => run.source === 'review')).toBe(
      true,
    )
  })

  it('never modifies or deletes a record it projects', async () => {
    const workspace = await tempWorkspace()
    const files = [
      await install(
        workspace,
        `${DELEGATION_DIR}/runs/run-settled.json`,
        'delegation-run-settled.json',
      ),
      await install(
        workspace,
        `${DELEGATION_DIR}/task-review/add-workflow-observability/tasks/abc124.json`,
        'delegation-record.json',
      ),
      await install(
        workspace,
        'openspec/changes/add-workflow-observability/reviews/abc123.json',
        'portable-review.json',
      ),
      await install(
        workspace,
        `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/2.json`,
        'checkpoint.json',
      ),
    ]
    const before = await Promise.all(files.map(fileHash))
    await workspaceRuns(workspace)
    await sessionRuns(workspace, 'session-1')
    const after = await Promise.all(files.map(fileHash))
    expect(after).toEqual(before)
  })
})

describe('merged session timeline', () => {
  it('orders checkpoint, delegation, and review and scopes attribution correctly', async () => {
    const workspace = await tempWorkspace()
    await install(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/2.json`,
      'checkpoint.json',
    )
    await install(
      workspace,
      `${DELEGATION_DIR}/runs/run-settled.json`,
      'delegation-run-settled.json',
    )
    await install(
      workspace,
      'openspec/changes/add-workflow-observability/reviews/abc123.json',
      'portable-review.json',
    )
    await writeJson(
      workspace,
      `${DELEGATION_DIR}/task-review/add-workflow-observability/tasks/abc123.json`,
      {
        rule: 'task-review',
        change: 'add-workflow-observability',
        phase: 'task',
        scope: 'task',
        taskId: '0123456789abcdef',
        digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        session: 'session-1',
        runId: 'run-mw6abcde-99999999',
        time: '2026-11-07T10:12:00.000Z',
      },
    )
    await journalLine(
      workspace,
      'session-1',
      'delegate review started; run: run-mw6abcde-1234abce',
      1_762_510_000_000,
    )
    await journalLine(
      workspace,
      'session-2',
      'delegate review already pending; run: run-mw6abcde-1234abce',
      1_762_510_100_000,
    )
    const observations = await delegationObservations(workspace)
    expect(observations.get('run-mw6abcde-1234abce')).toBe('session-1')

    const runs = await sessionRuns(workspace, 'session-1')
    expect(runs.map((run) => run.source)).toEqual(['checkpoint', 'delegation', 'review'])
    expect(runs.map((run) => run.attribution)).toEqual(['local', 'local', 'portable'])
    const delegation = runs.find((run) => run.source === 'delegation')
    expect(delegation?.session).toBe('session-1')
    expect(delegation?.steps.map((step) => step.id)).not.toContain('record')

    const sessionTwo = await sessionRuns(workspace, 'session-2')
    expect(sessionTwo).toEqual([])
  })

  it('excludes an unobserved run from the session timeline but keeps it in the workspace list', async () => {
    const workspace = await tempWorkspace()
    await install(
      workspace,
      `${DELEGATION_DIR}/runs/run-pending.json`,
      'delegation-run-pending.json',
    )
    expect(await sessionRuns(workspace, 'session-1')).toEqual([])
    const runs = await workspaceRuns(workspace)
    expect(runs.find((run) => run.source === 'delegation')?.attribution).toBe('unattributed')
  })

  it('redacts credential-shaped run details without changing the source file', async () => {
    const workspace = await tempWorkspace()
    const file = await writeJson(workspace, `${DELEGATION_DIR}/runs/run-secret.json`, {
      id: 'run-mw6abcde-cccccccc',
      rule: 'task-review',
      change: 'add-workflow-observability',
      key: 'k',
      identity: 'i',
      state: 'failed',
      record: '.dsh/delegation/task-review/x/tasks/x.json',
      startedAt: '2026-11-07T10:05:00.000Z',
      detail: 'Authorization: Bearer synthetic-review-credential; Basic dXNlcjpwYXNzd29yZA==',
    })
    const before = await fileHash(file)
    const run = (await workspaceRuns(workspace)).find(
      (candidate) => candidate.id === 'delegation:run-mw6abcde-cccccccc',
    )
    expect(run?.error).not.toContain('synthetic-review-credential')
    expect(run?.error).not.toContain('dXNlcjpwYXNzd29yZA==')
    expect(run?.error).toContain('REDACTED')
    expect(await fileHash(file)).toBe(before)

    for (const [name, detail] of [
      ['digest', 'failed: Digest username="u", nonce="n", response="SYNTHETIC-SECRET"'],
      ['structured', '{"password":{"value":"SYNTHETIC-SECRET"}}'],
    ] as const) {
      const detailFile = await writeJson(workspace, `${DELEGATION_DIR}/runs/run-${name}.json`, {
        id: `run-mw6abcde-${name === 'digest' ? 'dddddddd' : 'eeeeeeee'}`,
        rule: 'task-review',
        change: 'add-workflow-observability',
        key: 'k',
        identity: 'i',
        state: 'failed',
        record: '.dsh/delegation/task-review/x/tasks/x.json',
        startedAt: '2026-11-07T10:05:00.000Z',
        detail,
      })
      const hash = await fileHash(detailFile)
      const failed = (await workspaceRuns(workspace)).find(
        (candidate) =>
          candidate.id === `delegation:run-mw6abcde-${name === 'digest' ? 'dddddddd' : 'eeeeeeee'}`,
      )
      expect(failed?.error).not.toContain('SYNTHETIC-SECRET')
      expect(await fileHash(detailFile)).toBe(hash)
    }
  })

  it('orders the timeline by time and uses the id as a stable tie-breaker', async () => {
    const workspace = await tempWorkspace()
    await writeRaw(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/2.json`,
      JSON.stringify({
        version: 2,
        checkpoint: 'checkpoint-2-late',
        revision: 1,
        turn: 2,
        outcome: 'continue',
        verified: [],
        lanes: [],
        laneAges: [],
        bottleneck: {
          id: 'lane-a',
          owner: 'lead',
          action: 'lead_action',
          targets: ['packages/plugin-workflows'],
        },
        bottleneckKey: 'e2d946de2649d514',
        derivedRemaining: [],
        parallelComputed: false,
        next: 'x',
        time: '2026-11-07T10:08:00.000Z',
        session: '[REDACTED]',
      }),
    )
    await install(
      workspace,
      `${DELEGATION_DIR}/runs/run-settled.json`,
      'delegation-run-settled.json',
    )
    await journalLine(
      workspace,
      'session-1',
      'delegate review started; run: run-mw6abcde-1234abce',
      1000,
    )
    await install(
      workspace,
      'openspec/changes/add-workflow-observability/reviews/abc123.json',
      'portable-review.json',
    )
    await writeJson(
      workspace,
      `${DELEGATION_DIR}/task-review/add-workflow-observability/tasks/abc123.json`,
      {
        rule: 'task-review',
        change: 'add-workflow-observability',
        phase: 'task',
        scope: 'task',
        taskId: '0123456789abcdef',
        digest: `${'a'.repeat(64)}`,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        session: 'session-1',
        runId: 'run-mw6abcde-99999999',
        time: '2026-11-07T10:12:00.000Z',
      },
    )
    const runs = await sessionRuns(workspace, 'session-1')
    // Delegation (10:05) must precede the checkpoint (10:08), then the review.
    expect(runs.map((run) => run.source)).toEqual(['delegation', 'checkpoint', 'review'])

    const sameTime = await tempWorkspace()
    for (const id of ['run-mw6abcde-bbbbbbbb', 'run-mw6abcde-aaaaaaaa']) {
      await writeJson(sameTime, `${DELEGATION_DIR}/runs/${id}.json`, {
        id,
        rule: 'task-review',
        change: 'add-workflow-observability',
        key: 'k',
        identity: 'i',
        state: 'running',
        record: `.dsh/delegation/task-review/x/tasks/${id}.json`,
        startedAt: '2026-11-07T10:05:00.000Z',
      })
    }
    await journalLine(
      sameTime,
      'session-1',
      'delegate review started; run: run-mw6abcde-bbbbbbbb',
      1000,
    )
    await journalLine(
      sameTime,
      'session-1',
      'delegate review started; run: run-mw6abcde-aaaaaaaa',
      1000,
    )
    const tied = (await sessionRuns(sameTime, 'session-1')).map((run) => run.id)
    expect(tied).toEqual(['delegation:run-mw6abcde-aaaaaaaa', 'delegation:run-mw6abcde-bbbbbbbb'])
  })

  it('attributes a run from an observation in a rotated journal file', async () => {
    const workspace = await tempWorkspace()
    await install(
      workspace,
      `${DELEGATION_DIR}/runs/run-settled.json`,
      'delegation-run-settled.json',
    )
    const line = JSON.stringify({
      v: 1,
      at: 1000,
      session: 'session-1',
      kind: 'tools/result',
      subject: 'delegate',
      callId: 'call-1',
      ok: true,
      summary: 'delegate review started; run: run-mw6abcde-1234abce',
      bytes: 50,
      truncated: false,
    })
    await mkdir(join(workspace, WORKFLOW_EVENTS_DIR), { recursive: true })
    await writeFile(join(workspace, WORKFLOW_EVENTS_DIR, 'session-1.jsonl.1'), `${line}\n`, 'utf8')
    const runs = await sessionRuns(workspace, 'session-1')
    expect(runs.some((run) => run.id === 'delegation:run-mw6abcde-1234abce')).toBe(true)
  })

  it('reads only the requesting workspace', async () => {
    const one = await tempWorkspace()
    const two = await tempWorkspace()
    await install(
      one,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/2.json`,
      'checkpoint.json',
    )
    expect(await sessionRuns(one, 'session-1')).toHaveLength(1)
    expect(await sessionRuns(two, 'session-1')).toEqual([])
  })
})
