import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
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
  await writeFile(join(directory, `${session}.jsonl`), `${line}\n`, { encoding: 'utf8' })
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
    await install(
      workspace,
      `${'.dsh/work-checkpoints'}/${hashSession('session-1')}/2.json`,
      'checkpoint.json',
    )
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
    expect(checkpoint?.steps.map((step) => step.id)).toEqual(['outcome', 'lane:lane-a', 'next'])
    expect(checkpoint?.steps.find((step) => step.id === 'lane:lane-a')?.evidence).toBe(
      'packages/plugin-workflows',
    )
    expect(checkpoint?.record).toContain(hashSession('session-1'))
    const other = await sessionRuns(workspace, 'session-2')
    expect(checkpointRun(other)?.session).toBe('session-2')
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
  })

  it('attributes a portable review only through a matching local record', async () => {
    const workspace = await tempWorkspace()
    await install(
      workspace,
      'openspec/changes/add-workflow-observability/reviews/abc123.json',
      'portable-review.json',
    )
    const unattributed = (await workspaceRuns(workspace)).find(
      (run) => run.id === 'review:add-workflow-observability/abc123',
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
        taskId: 'abc123',
        digest: 'digest-abc123',
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        session: 'session-1',
        runId: 'run-mw6abcde-99999999',
        time: '2026-11-07T10:12:00.000Z',
      },
    )
    const attributed = (await workspaceRuns(workspace)).find(
      (run) => run.id === 'review:add-workflow-observability/abc123',
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
        taskId: 'abc123',
        digest: 'digest-abc123',
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
