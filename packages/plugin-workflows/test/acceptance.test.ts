import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { HostAuth } from '../src/host/host-auth.ts'
import { listAuthenticatedRuns } from '../src/host/runs.ts'
import { taskIdOf } from '../src/host/tasks.ts'
import type { FakeHost } from './composed-harness.ts'
import {
  closeTurn,
  composedConfig,
  KEY,
  openComposed,
  readJson,
  SESSION,
  waitFor,
} from './composed-harness.ts'

/**
 * Task 5.4's local acceptance: the four review/steer scenarios run against the
 * real delegation-rules and workflows plugins composed from the setup patch, in
 * a throwaway `DSH_HOME` and temp workspaces. The browser click-through is
 * reported as not run; the run step evidence, records, and approvals are the
 * verified data, and the throwaway home must stay empty.
 *
 * The shipped composed rows own every signal (all five switches are false).
 */

const CHANGE = 'live-acceptance'
const GATES = {
  workflowOwned: false,
  specReview: false,
  integrationReview: false,
  taskProgress: false,
  laneFanout: false,
}
/** One checked and one unchecked task in two lane-shaped sections. */
const PLAN = `# Tasks

## 1. Acceptance engine (lane 1, owns \`packages/plugin-workflows/test/**\`)

- [x] 1.1 Checked acceptance task

## 2. Acceptance docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Unchecked acceptance task
`
const CHECKED_TEXT = 'Checked acceptance task'
const UNCHECKED_TEXT = 'Unchecked acceptance task'
const CHECKED_ID = taskIdOf(CHECKED_TEXT)
const UNCHECKED_ID = taskIdOf(UNCHECKED_TEXT)
const OWNED = join(import.meta.dirname, '..', '..', '..')
const REPORT = 'acceptance-report.json'

let root = ''
let home = ''
let previousHome: string | undefined
let previousKey: string | undefined
const report: {
  v: number
  mode: string
  dshHome: string
  liveProfileTouched: boolean
  webView: string
  scenarios: Array<Record<string, unknown>>
} = {
  v: 1,
  mode: 'composed-runtime (delegation-rules + workflows from the setup patch)',
  dshHome: '',
  liveProfileTouched: false,
  webView: 'not run: the composed runtime is headless in this test',
  scenarios: [],
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'workflows-acceptance-'))
  home = join(root, 'home')
  await mkdir(home, { recursive: true })
  previousHome = process.env.DSH_HOME
  previousKey = process.env.DSH_WORKFLOWS_HOST_KEY
  process.env.DSH_HOME = home
  report.dshHome = home
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  if (previousKey === undefined) delete process.env.DSH_WORKFLOWS_HOST_KEY
  else process.env.DSH_WORKFLOWS_HOST_KEY = previousKey
  // The throwaway home proves no scenario reached the owner's profile.
  expect(await readdir(home)).toEqual([])
  const written = join(root, REPORT)
  const text = await readFile(written, 'utf8').catch(() => undefined)
  if (text !== undefined) {
    await mkdir(join(OWNED, '.tmp'), { recursive: true })
    await writeFile(join(OWNED, '.tmp', REPORT), text, 'utf8')
  }
  // Windows transiently locks a just-closed workspace (git children and the
  // scanner); retry long enough for the handles to drop instead of failing the
  // suite in cleanup.
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
})

/** One temp git workspace with the fake OpenSpec change. */
async function acceptanceWorkspace(plan = PLAN): Promise<string> {
  const workspace = await mkdtemp(join(root, 'ws-'))
  await writeFile(join(workspace, '.gitignore'), '.dsh/\n', 'utf8')
  const change = join(workspace, 'openspec', 'changes', CHANGE)
  await mkdir(join(change, 'specs', CHANGE), { recursive: true })
  await writeFile(join(change, 'proposal.md'), '# Proposal\n\nWhy.\n', 'utf8')
  await writeFile(join(change, 'design.md'), '# Design\n\nThe decision.\n', 'utf8')
  await writeFile(
    join(change, 'specs', CHANGE, 'spec.md'),
    '# Spec\n\n## Requirement\n\nThe change is reviewed.\n',
    'utf8',
  )
  await writeFile(join(change, 'tasks.md'), plan, 'utf8')
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.name', 'local-acceptance')
  git('config', 'user.email', 'local-acceptance@example.test')
  git('add', '-A')
  git('commit', '-m', 'init')
  return workspace
}

function openAcceptance(workspace: string): Promise<FakeHost> {
  return openComposed(workspace, GATES, { change: CHANGE })
}

function toolText(value: unknown): string {
  return typeof value === 'object' && value !== null && 'text' in value
    ? String((value as { text: unknown }).text)
    : JSON.stringify(value)
}

/**
 * Hold every reviewer so a close sees the open step before its record exists.
 * The fake provider's activation and prompt are real; only the verdict arrives
 * when the returned release callback fires.
 */
function holdReviews(host: FakeHost): () => void {
  const subagents = host.ctx.subagents as {
    startActivation: (spec: unknown) => Promise<{ result: Promise<unknown> }>
  }
  const original = subagents.startActivation
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  subagents.startActivation = async (spec) => {
    const activation = await original.call(subagents, spec)
    const result = activation.result
    activation.result = gate.then(() => result)
    return activation
  }
  return release
}

async function runsFor(workspace: string, definition: string) {
  const auth = HostAuth.fromKey(Buffer.from(KEY, 'hex'))
  return (await listAuthenticatedRuns(workspace, auth)).filter(
    (run) => run.definition.id === definition,
  )
}

/** One close and the workflow gates it steered, copied before the next close. */
async function closeAndSteer(host: FakeHost, turn: number) {
  await closeTurn(host, turn)
  const steers = host.steers.map((steer) => ({ ...steer }))
  host.steers.length = 0
  return steers
}

function reviewStepDone(
  run: { steps: ReadonlyArray<{ id: string; state: string }> } | undefined,
): boolean {
  return run?.steps.some((step) => step.id === 'review' && step.state === 'done') === true
}

/** The workspace evidence the Workflows view shows on the settled review step. */
function reviewEvidence(
  run:
    | { steps: ReadonlyArray<{ id: string; evidence?: { path?: string; ref?: string } }> }
    | undefined,
): string | undefined {
  const step = run?.steps.find((entry) => entry.id === 'review')
  return step?.evidence?.path ?? step?.evidence?.ref
}

const HEX = /^[0-9a-f]{64}$/u

describe('local acceptance', () => {
  it('runs a native task review that writes the local record and the committed approval', async () => {
    const workspace = await acceptanceWorkspace()
    const host = await openAcceptance(workspace)
    // The acceptance drives the shipped composed rows, not a synthetic config.
    const delegation = await composedConfig('dsh-setup-delegation-rules')
    expect(delegation.gates).toEqual(GATES)
    const started = toolText(
      await host.callTool('delegate', {
        rule: 'task-review',
        change: CHANGE,
        task: CHECKED_ID,
      }),
    )
    expect(started).toMatch(/review started/u)
    await closeTurn(host, 1)

    const recordPath = `.dsh/workflows/records/task-review/${CHANGE}/tasks/${CHECKED_ID}.json`
    const approvalPath = `openspec/changes/${CHANGE}/reviews/${CHECKED_ID}.json`
    await waitFor(async () => (await readJson(join(workspace, recordPath)))?.verdict === 'PASS')
    await waitFor(async () => (await readJson(join(workspace, approvalPath)))?.verdict === 'PASS')
    const record = await readJson(join(workspace, recordPath))
    const approval = await readJson(join(workspace, approvalPath))
    expect(record).toMatchObject({
      definition: 'task-review',
      rule: 'task-review',
      change: CHANGE,
      phase: 'task',
      scope: 'task',
      taskId: CHECKED_ID,
      verdict: 'PASS',
      findings: [],
      reviewer: 'codex',
      session: SESSION,
      target: { provider: 'codex-subagent' },
    })
    expect(String(record?.digest)).toMatch(HEX)
    expect(String(record?.worktreeDigest)).toMatch(HEX)
    expect(Number.isNaN(Date.parse(String(record?.time)))).toBe(false)
    // The committed approval is the sanitized portable format, byte-for-byte
    // independent of the session, run, and machine.
    expect(Object.keys(approval ?? {}).sort()).toEqual([
      'change',
      'digest',
      'findings',
      'rule',
      'scope',
      'target',
      'taskId',
      'time',
      'verdict',
      'worktreeDigest',
    ])
    expect(approval).toMatchObject({ rule: 'task-review', change: CHANGE, verdict: 'PASS' })
    expect(approval?.digest).toBe(record?.digest)
    expect(approval?.worktreeDigest).toBe(record?.worktreeDigest)
    // The unchecked task is never approved.
    expect(
      await readJson(join(workspace, `openspec/changes/${CHANGE}/reviews/${UNCHECKED_ID}.json`)),
    ).toBeUndefined()
    await waitFor(async () => reviewStepDone((await runsFor(workspace, 'task-review'))[0]))
    const runs = await runsFor(workspace, 'task-review')
    expect(runs).toHaveLength(1)
    expect(runs[0]?.context).toMatchObject({ name: CHANGE, taskId: CHECKED_ID })
    expect(reviewStepDone(runs[0])).toBe(true)
    expect(runs[0]?.id).toBe(record?.runId)
    expect(reviewEvidence(runs[0])).toBe(recordPath)
    expect(host.activations.filter((activation) => activation.rule === 'task-review')).toHaveLength(
      1,
    )

    report.scenarios.push({
      scenario: 'native task review',
      taskId: CHECKED_ID,
      runId: runs[0]?.id,
      runStatus: runs[0]?.status,
      reviewStep: 'done',
      reviewEvidence: reviewEvidence(runs[0]),
      recordPath,
      approvalPath,
      record: {
        definition: record?.definition,
        rule: record?.rule,
        change: record?.change,
        phase: record?.phase,
        scope: record?.scope,
        taskId: record?.taskId,
        digest: record?.digest,
        worktreeDigest: record?.worktreeDigest,
        verdict: record?.verdict,
        target: record?.target,
        time: record?.time,
      },
      approval: {
        rule: approval?.rule,
        change: approval?.change,
        scope: approval?.scope,
        taskId: approval?.taskId,
        digest: approval?.digest,
        worktreeDigest: approval?.worktreeDigest,
        verdict: approval?.verdict,
        target: approval?.target,
      },
    })
  })

  it('runs a whole-spec review, steers the missing-record close, then allows it', async () => {
    const workspace = await acceptanceWorkspace()
    const host = await openAcceptance(workspace)
    const specRecord = `.dsh/workflows/records/spec-review/${CHANGE}/spec.json`
    // The harness seeds a current whole-spec PASS so other scenarios isolate
    // their gate; this scenario needs the record genuinely missing.
    await rm(join(workspace, specRecord))
    const release = holdReviews(host)
    const refused = await closeAndSteer(host, 1)
    expect(refused).toHaveLength(1)
    expect(refused[0]?.kind).toBe('workflows-gate')
    expect(refused[0]?.text).toContain(
      'Workflow step "Review the whole change spec" (spec-review / review) is open.',
    )
    expect(refused[0]?.text).toContain(specRecord)
    expect(await readJson(join(workspace, specRecord))).toBeUndefined()
    release()
    await waitFor(async () => (await readJson(join(workspace, specRecord)))?.verdict === 'PASS')
    await waitFor(async () => {
      const runs = await runsFor(workspace, 'spec-review')
      return runs.length === 1 && reviewStepDone(runs[0])
    })
    const record = await readJson(join(workspace, specRecord))
    expect(record).toMatchObject({
      definition: 'spec-review',
      rule: 'spec-review',
      change: CHANGE,
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      findings: [],
      reviewer: 'codex',
      target: { provider: 'codex-subagent' },
    })
    expect(String(record?.digest)).toMatch(HEX)
    expect(typeof record?.runId).toBe('string')
    const allowed = await closeAndSteer(host, 1)
    expect(allowed).toEqual([])
    const runs = await runsFor(workspace, 'spec-review')
    expect(reviewEvidence(runs[0])).toBe(specRecord)
    report.scenarios.push({
      scenario: 'whole-spec review',
      runId: runs[0]?.id,
      runStatus: runs[0]?.status,
      reviewStep: 'done',
      reviewEvidence: reviewEvidence(runs[0]),
      recordPath: specRecord,
      steer: refused[0]?.text,
      allowedClose: true,
    })
  })

  it('steers a close with a missing task record, then allows the current record', async () => {
    const workspace = await acceptanceWorkspace()
    const host = await openAcceptance(workspace)
    const recordPath = `.dsh/workflows/records/task-review/${CHANGE}/tasks/${CHECKED_ID}.json`
    const approvalPath = `openspec/changes/${CHANGE}/reviews/${CHECKED_ID}.json`
    const started = toolText(
      await host.callTool('delegate', {
        rule: 'task-review',
        change: CHANGE,
        task: CHECKED_ID,
      }),
    )
    expect(started).toMatch(/review started/u)
    const release = holdReviews(host)
    const refused = await closeAndSteer(host, 1)
    expect(refused).toHaveLength(1)
    expect(refused[0]?.kind).toBe('workflows-gate')
    expect(refused[0]?.text).toContain(
      'Workflow step "Review the checked task" (task-review / review) is open.',
    )
    expect(refused[0]?.text).toContain(recordPath)
    expect(await readJson(join(workspace, recordPath))).toBeUndefined()
    release()
    await waitFor(async () => (await readJson(join(workspace, recordPath)))?.verdict === 'PASS')
    await waitFor(async () => (await readJson(join(workspace, approvalPath)))?.verdict === 'PASS')
    const allowed = await closeAndSteer(host, 1)
    expect(allowed).toEqual([])
    const runs = await runsFor(workspace, 'task-review')
    expect(runs).toHaveLength(1)
    expect(runs[0]?.id).toBe((await readJson(join(workspace, recordPath)))?.runId)
    expect(reviewEvidence(runs[0])).toBe(recordPath)

    report.scenarios.push({
      scenario: 'missing-record close',
      taskId: CHECKED_ID,
      runId: runs[0]?.id,
      reviewStep: 'done',
      reviewEvidence: reviewEvidence(runs[0]),
      recordPath,
      approvalPath,
      steer: refused[0]?.text,
      allowedClose: true,
    })
  })

  it('steers a lane fan-out with the tagged worker call, then the serial note satisfies it', async () => {
    const workspace = await acceptanceWorkspace()
    const host = await openAcceptance(workspace)
    // Settle the turn's own close first: the seeded whole-spec PASS allows it,
    // and the turn's spec trigger is not re-armed after the implementation write.
    expect(await closeAndSteer(host, 1)).toEqual([])
    const file = join(workspace, 'packages', 'plugin-workflows', 'test', 'acceptance-write.ts')
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, 'export const acceptance = 1\n', 'utf8')
    await host.emit(
      'tools/result',
      {
        agent: host.agent,
        callId: 'acceptance-write',
        name: 'write',
        arguments: { file_path: 'packages/plugin-workflows/test/acceptance-write.ts' },
      },
      { isError: false, content: [{ type: 'text', text: 'ok' }] },
    )
    const refused = await closeAndSteer(host, 1)
    expect(refused).toHaveLength(1)
    const steer = refused[0]?.text ?? ''
    expect(refused[0]?.kind).toBe('workflows-gate')
    expect(steer).toContain('lane assignment is missing in change "live-acceptance"')
    // The exact worker call for lane 2, with its lane tag, sibling worktree,
    // branch, and the owned paths.
    expect(steer).toContain(
      'subagent(description: "Lane: 2. Acceptance docs (lane 2, owns `docs/**`)",',
    )
    expect(steer).toContain(`lane-tag: ${CHANGE}#2.`)
    expect(steer).toContain(`git worktree add ../wt-${CHANGE}-2 -b lane-${CHANGE}-2`)
    expect(steer).toContain('Work only inside docs/**.')
    expect(steer).not.toContain('Lane: 1. Acceptance engine')
    const workerCall =
      /subagent\(description: "Lane: 2\. Acceptance docs[^\n]*/u.exec(steer)?.[0] ?? ''
    expect(workerCall).toContain(`lane-tag: ${CHANGE}#2`)
    expect(steer).toContain(
      `workflows { action: "note", change: "${CHANGE}", task: "2.1 ${UNCHECKED_TEXT}", status: "in-progress", reason: "why this lane stays serial" }`,
    )
    // Execute the printed serial-note alternative through the real workflows tool.
    const noted = toolText(
      await host.callTool('workflows', {
        action: 'note',
        change: CHANGE,
        task: `2.1 ${UNCHECKED_TEXT}`,
        status: 'in-progress',
        reason: 'the docs lane stays serial',
      }),
    )
    expect(noted).toContain('progress note written')
    const notePath = `.dsh/workflows/notes/${CHANGE}.json`
    const note = await readJson(join(workspace, notePath))
    expect(note?.lane).toBe('2. Acceptance docs (lane 2, owns `docs/**`)')
    expect(String(note?.worktreeDigest)).toMatch(HEX)
    const allowed = await closeAndSteer(host, 1)
    expect(allowed).toEqual([])

    report.scenarios.push({
      scenario: 'lane fan-out',
      change: CHANGE,
      workerCall,
      notePath,
      serialNoteTask: `2.1 ${UNCHECKED_TEXT}`,
      steer: steer.slice(0, 400),
      allowedClose: true,
    })
  })

  it('writes the compact acceptance report', async () => {
    expect(report.scenarios).toHaveLength(4)
    await writeFile(join(root, REPORT), JSON.stringify(report, null, 2), 'utf8')
    expect(await readdir(home)).toEqual([])
  })
})
