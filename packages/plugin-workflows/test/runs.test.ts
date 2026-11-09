import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { HostAuth } from '../src/host/host-auth.ts'
import {
  issueAdoptionReceipt,
  issueCompletionReceipt,
  listReceipts,
  readReceipt,
  receiptPath,
  receiptsDirectory,
} from '../src/host/receipts.ts'
import {
  cancelRun,
  INTERRUPTED_REASON,
  pendingStep,
  recoverRuns,
  resumeRun,
} from '../src/host/resume.ts'
import {
  activeStep,
  addViolation,
  assertRunSession,
  boundContext,
  createRun,
  DAY_MS,
  hasTamperedRuns,
  listAuthenticatedRuns,
  listRuns,
  openRunCount,
  pruneRuns,
  readAuthenticatedRun,
  requestStep,
  runLimitExceeded,
  runPath,
  runsDirectory,
  sessionRunsFor,
  setRunStatus,
  settleStep,
  storedRuns,
  type WorkflowRun,
  writeRun,
  writeRunSync,
} from '../src/host/runs.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-runs-'))
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
  return HostAuth.fromKey('test-runs-host-key-0123456789')
}

const DIGEST = 'a'.repeat(64)

function intakeRun(workspace: string, name: string, now: number, id?: string): WorkflowRun {
  return createRun({
    definition: 'change-intake',
    trigger: 'tool.pre-execute',
    session: 'session-1',
    workspace,
    context: { name },
    steps: ['requirements', 'approval'],
    now,
    ...(id === undefined ? {} : { id }),
  })
}

async function writeAndComplete(
  workspace: string,
  name: string,
  now: number,
  id?: string,
): Promise<WorkflowRun> {
  let run = intakeRun(workspace, name, now, id)
  run = settleStep(run, 'requirements', 'done', { at: now + 1 })
  run = settleStep(run, 'approval', 'done', { at: now + 2 })
  run = setRunStatus(run, 'completed', now + 3)
  await writeRun(workspace, run, auth())
  return run
}

describe('run store', () => {
  it('writes, signs, reloads, and atomically replaces one run', async () => {
    const workspace = await tempWorkspace()
    const run = intakeRun(workspace, 'auth', 1_000)
    await writeRun(workspace, run, auth())
    expect(await readAuthenticatedRun(workspace, run.id, auth())).toEqual(run)

    const advanced = settleStep(run, 'requirements', 'done', {
      at: 2_000,
      evidence: { kind: 'file', path: '.dsh/workflows/drafts/auth/requirements.md', bytes: 800 },
    })
    await writeRun(workspace, advanced, auth())
    const reloaded = await readAuthenticatedRun(workspace, run.id, auth())
    expect(reloaded?.steps[0]).toMatchObject({ state: 'done', evidence: { bytes: 800 } })
    expect(reloaded?.updatedAt).toBe(2_000)
    const names = await readdir(runsDirectory(workspace))
    expect(names).toEqual([`${run.id}.json`])
  })

  it('refuses an unsigned or modified run for authority', async () => {
    const workspace = await tempWorkspace()
    const run = await writeAndComplete(workspace, 'auth', 1_000)
    // A modified status must not authenticate.
    const file = runPath(workspace, run.id)
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    parsed.status = 'failed'
    await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    expect(await readAuthenticatedRun(workspace, run.id, auth())).toBeUndefined()
    await expect(issueCompletionReceipt(workspace, run.id, DIGEST, auth(), 2_000)).rejects.toThrow(
      /unsigned, modified, or unreadable/u,
    )

    const unsigned = intakeRun(workspace, 'unsigned', 3_000)
    await mkdir(runsDirectory(workspace), { recursive: true })
    await writeFile(
      runPath(workspace, unsigned.id),
      `${JSON.stringify(unsigned, null, 2)}\n`,
      'utf8',
    )
    expect(await readAuthenticatedRun(workspace, unsigned.id, auth())).toBeUndefined()
    await expect(
      issueCompletionReceipt(workspace, unsigned.id, DIGEST, auth(), 4_000),
    ).rejects.toThrow(/unsigned, modified, or unreadable/u)
  })

  it('records evidence, violations, and status transitions in the file', async () => {
    const workspace = await tempWorkspace()
    let run = intakeRun(workspace, 'auth', 1_000)
    run = settleStep(run, 'requirements', 'done', {
      at: 1_100,
      evidence: { kind: 'tool', callId: 'call-1' },
    })
    run = addViolation(run, 'the turn closed with the requirements step open', {
      step: 'requirements',
      at: 1_200,
    })
    run = settleStep(run, 'approval', 'cancelled', { at: 1_300, reason: 'user cancelled' })
    run = setRunStatus(run, 'cancelled', 1_300)
    await writeRun(workspace, run, auth())
    const reloaded = await readAuthenticatedRun(workspace, run.id, auth())
    expect(reloaded?.status).toBe('cancelled')
    expect(reloaded?.violations[0]).toMatchObject({
      stepId: 'requirements',
      at: 1_200,
      reason: 'the turn closed with the requirements step open',
    })
    expect(reloaded?.steps[0]?.evidence).toEqual({ kind: 'tool', callId: 'call-1', ref: 'call-1' })
    expect(reloaded?.steps[1]?.reason).toBe('user cancelled')
  })

  it('prunes expired terminal runs first and keeps open runs and receipts', async () => {
    const workspace = await tempWorkspace()
    const oldCompleted = await writeAndComplete(workspace, 'old-done', 1_000)
    const oldRunning = intakeRun(workspace, 'old-open', 1_100, 'run-old-open-x')
    await writeRun(workspace, oldRunning, auth())
    const oldInterrupted = setRunStatus(
      intakeRun(workspace, 'old-interrupted', 1_150, 'run-old-int-x'),
      'interrupted',
      1_160,
    )
    await writeRun(workspace, oldInterrupted, auth())
    const recentCompleted = await writeAndComplete(workspace, 'recent-done', 2_000)
    const receipt = await issueCompletionReceipt(workspace, oldCompleted.id, DIGEST, auth(), 2_100)
    expect(receipt.signature).toMatch(/^[a-f0-9]{64}$/u)

    const now = 50 * DAY_MS
    await utimes(
      runPath(workspace, oldCompleted.id),
      new Date(now - 40 * DAY_MS),
      new Date(now - 40 * DAY_MS),
    )
    await utimes(
      runPath(workspace, oldRunning.id),
      new Date(now - 40 * DAY_MS),
      new Date(now - 40 * DAY_MS),
    )
    await utimes(
      runPath(workspace, oldInterrupted.id),
      new Date(now - 40 * DAY_MS),
      new Date(now - 40 * DAY_MS),
    )
    const result = await pruneRuns(workspace, { auth: auth(), now, retentionMs: 30 * DAY_MS })
    expect(result.removed).toContain(oldCompleted.id)
    expect(result.removed).not.toContain(oldRunning.id)
    expect(result.removed).not.toContain(oldInterrupted.id)
    const remaining = await listAuthenticatedRuns(workspace, auth())
    expect(remaining.map((run) => run.id)).toEqual(
      expect.arrayContaining([oldRunning.id, oldInterrupted.id, recentCompleted.id]),
    )
    // The receipt is not a run and survives pruning of the run it names.
    expect(await readReceipt(workspace, 'old-done', auth())).toMatchObject({ change: 'old-done' })
  })

  it('enforces the byte cap by removing the oldest terminal runs only', async () => {
    const workspace = await tempWorkspace()
    const first = await writeAndComplete(workspace, 'first', 1_000)
    const second = await writeAndComplete(workspace, 'second', 2_000)
    const open = intakeRun(workspace, 'open', 3_000, 'run-open-x')
    await writeRun(workspace, open, auth())
    const interrupted = setRunStatus(
      intakeRun(workspace, 'interrupted', 2_500, 'run-int-x'),
      'interrupted',
      2_600,
    )
    await writeRun(workspace, interrupted, auth())
    const result = await pruneRuns(workspace, {
      auth: auth(),
      now: 4_000,
      retentionMs: 30 * DAY_MS,
      maxBytes: 2_000,
    })
    expect(result.removed).toContain(first.id)
    expect(result.removed).not.toContain(interrupted.id)
    expect(result.removed).not.toContain(open.id)
    expect(await readAuthenticatedRun(workspace, second.id, auth())).toBeDefined()
    expect(await readAuthenticatedRun(workspace, open.id, auth())).toBeDefined()
  })

  it('refuses a forged or unsigned receipt after a reload', async () => {
    const workspace = await tempWorkspace()
    await mkdir(join(workspace, '.dsh', 'workflows', 'receipts'), { recursive: true })
    const forged = {
      v: 1,
      kind: 'adoption',
      change: 'auth',
      digest: DIGEST,
      issuedAt: 1_000,
      workspaceKey: workspace,
      signature: 'f'.repeat(64),
    }
    await writeFile(receiptPath(workspace, 'auth'), `${JSON.stringify(forged, null, 2)}\n`, 'utf8')
    expect(await readReceipt(workspace, 'auth', auth())).toBeUndefined()
    await writeFile(
      receiptPath(workspace, 'auth'),
      `${JSON.stringify({ ...forged, signature: undefined }, null, 2)}\n`,
      'utf8',
    )
    expect(await readReceipt(workspace, 'auth', auth())).toBeUndefined()
    const valid = await issueAdoptionReceipt(workspace, 'auth', DIGEST, auth(), 2_000)
    expect((await readReceipt(workspace, 'auth', auth()))?.signature).toBe(valid.signature)
    const stored = JSON.parse(await readFile(receiptPath(workspace, 'auth'), 'utf8')) as Record<
      string,
      unknown
    >
    await writeFile(
      receiptPath(workspace, 'auth'),
      `${JSON.stringify({ ...stored, digest: 'b'.repeat(64) }, null, 2)}\n`,
      'utf8',
    )
    expect(await readReceipt(workspace, 'auth', auth())).toBeUndefined()
  })

  it('refuses a receipt for a run that is not a completed change-intake', async () => {
    const workspace = await tempWorkspace()
    const run = intakeRun(workspace, 'auth', 1_000)
    await writeRun(workspace, run, auth())
    await expect(issueCompletionReceipt(workspace, run.id, DIGEST, auth(), 2_000)).rejects.toThrow(
      /not a completed change-intake run/u,
    )
  })
})

describe('startup recovery and resume', () => {
  it('marks each unfinished previous-process run interrupted and never completes it', async () => {
    const workspace = await tempWorkspace()
    const running = intakeRun(workspace, 'running-name', 1_000)
    const blocked = setRunStatus(intakeRun(workspace, 'blocked-name', 1_100), 'blocked', 1_200)
    const completed = await writeAndComplete(workspace, 'done-name', 1_300)
    await writeRun(workspace, running, auth())
    await writeRun(workspace, blocked, auth())

    const result = await recoverRuns(workspace, auth(), 2_000)
    expect(result.recovered).toEqual(expect.arrayContaining([running.id, blocked.id]))
    expect(result.skipped).toContain(completed.id)
    const recovered = await listAuthenticatedRuns(workspace, auth())
    for (const id of [running.id, blocked.id]) {
      const run = recovered.find((entry) => entry.id === id)
      expect(run?.status).toBe('interrupted')
      expect(run?.reason).toBe(INTERRUPTED_REASON)
      expect(run?.steps.every((step) => step.state === 'open')).toBe(true)
    }
    expect(recovered.find((entry) => entry.id === completed.id)?.status).toBe('completed')
  })

  it('resumes an interrupted intake after create-change at spec without recreating anything', async () => {
    const workspace = await tempWorkspace()
    let run = createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: { name: 'auth', draftDir: '.dsh/workflows/drafts/auth' },
      steps: ['requirements', 'create-change', 'spec', 'approval'],
      now: 1_000,
    })
    run = settleStep(run, 'requirements', 'done', { at: 1_100 })
    run = settleStep(run, 'create-change', 'done', { at: 1_200 })
    await writeRun(workspace, run, auth())
    const recovery = await recoverRuns(workspace, auth(), 2_000)
    expect(recovery.recovered).toContain(run.id)

    const resumed = await resumeRun(workspace, run.id, auth(), 3_000)
    expect(resumed.stepId).toBe('spec')
    expect(resumed.run.status).toBe('running')
    expect(pendingStep(resumed.run)).toBe('spec')
    expect(resumed.run.steps.find((step) => step.id === 'create-change')?.state).toBe('done')
    expect(await readdir(join(workspace, 'openspec')).catch(() => undefined)).toBeUndefined()
    expect((await listAuthenticatedRuns(workspace, auth())).length).toBe(1)
  })

  it('cancels a resumed run and refuses a terminal run', async () => {
    const workspace = await tempWorkspace()
    const run = setRunStatus(intakeRun(workspace, 'auth', 1_000), 'blocked', 1_100)
    await writeRun(workspace, run, auth())
    await resumeRun(workspace, run.id, auth(), 2_000)
    const cancelled = await cancelRun(workspace, run.id, auth(), 3_000)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.steps.find((step) => step.id === 'requirements')?.state).toBe('cancelled')
    await expect(cancelRun(workspace, run.id, auth(), 4_000)).rejects.toThrow(
      /is cancelled; it is not cancelable/u,
    )
    const completed = await writeAndComplete(workspace, 'other', 5_000)
    await expect(resumeRun(workspace, completed.id, auth(), 6_000)).rejects.toThrow(
      /only an interrupted or blocked run can be resumed/u,
    )
  })

  it('refuses a fabricated or modified completed run', async () => {
    const workspace = await tempWorkspace()
    const unsigned = setRunStatus(intakeRun(workspace, 'fake', 1_000), 'completed', 1_100)
    await mkdir(runsDirectory(workspace), { recursive: true })
    await writeFile(
      runPath(workspace, unsigned.id),
      `${JSON.stringify(unsigned, null, 2)}\n`,
      'utf8',
    )
    await expect(resumeRun(workspace, unsigned.id, auth(), 2_000)).rejects.toThrow(
      /unsigned, modified, or unreadable/u,
    )
    const signed = await writeAndComplete(workspace, 'real', 3_000)
    const file = runPath(workspace, signed.id)
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    parsed.status = 'interrupted'
    await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
    await expect(resumeRun(workspace, signed.id, auth(), 4_000)).rejects.toThrow(
      /unsigned, modified, or unreadable/u,
    )
  })
})

describe('run limits and scoping', () => {
  it('counts only open runs against maxRuns and scopes a step to its session', async () => {
    const workspace = await tempWorkspace()
    const open = intakeRun(workspace, 'open', 1_000)
    const completed = setRunStatus(intakeRun(workspace, 'done', 1_100), 'completed', 1_200)
    expect(openRunCount([open, completed])).toBe(1)
    expect(runLimitExceeded([open, completed], 1)).toBe(true)
    expect(runLimitExceeded([completed], 1)).toBe(false)
    expect(sessionRunsFor([open, completed], 'session-1')).toEqual([open])
    expect(sessionRunsFor([open], 'session-2')).toEqual([])
    expect(() => assertRunSession(open, 'session-2')).toThrow(
      /belongs to session "session-1".*cannot satisfy/u,
    )
    expect(() => assertRunSession(open, 'session-1')).not.toThrow()
  })

  it('runs one requested step at a time and bounds the context', async () => {
    const workspace = await tempWorkspace()
    let run = intakeRun(workspace, 'auth', 1_000)
    run = requestStep(run, 'requirements', 1_100)
    expect(run.steps.find((step) => step.id === 'requirements')).toMatchObject({
      state: 'open',
      attempts: 1,
    })
    expect(() => requestStep(run, 'approval', 1_200)).toThrow(/one main step runs at a time/u)
    run = requestStep(run, 'requirements', 1_300)
    expect(run.steps.find((step) => step.id === 'requirements')?.attempts).toBe(2)

    const oversized = { name: 'auth', payload: 'x'.repeat(10_000) }
    const bounded = boundContext(oversized, 200)
    expect(bounded.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThan(200)
    const small = { name: 'auth' }
    expect(boundContext(small)).toEqual(small)
    const created = createRun({
      definition: 'change-intake',
      trigger: 'tool.pre-execute',
      session: 'session-1',
      workspace,
      context: oversized,
      steps: ['requirements'],
      now: 2_000,
    })
    expect(created.context.truncated).toBe(true)
  })
})

it('refuses a signed run copied from another workspace', async () => {
  const source = await tempWorkspace()
  const target = await tempWorkspace()
  const run = await writeAndComplete(source, 'auth', 1_000)
  const bytes = await readFile(runPath(source, run.id), 'utf8')
  await mkdir(runsDirectory(target), { recursive: true })
  await writeFile(runPath(target, run.id), bytes, 'utf8')
  expect(await readAuthenticatedRun(target, run.id, auth())).toBeUndefined()
  expect(await listAuthenticatedRuns(target, auth())).toEqual([])
  await expect(issueCompletionReceipt(target, run.id, DIGEST, auth())).rejects.toThrow()
  await expect(resumeRun(target, run.id, auth())).rejects.toThrow()
})

it('treats a missing run directory as an empty store', async () => {
  const workspace = await tempWorkspace()
  expect(await storedRuns(workspace)).toEqual([])
  expect(await listRuns(workspace)).toEqual([])
  expect(await listAuthenticatedRuns(workspace, auth())).toEqual([])
  expect(await hasTamperedRuns(workspace, auth())).toBe(false)
})

it('does not count a failed deletion as pruned', async () => {
  const workspace = await tempWorkspace()
  const first = await writeAndComplete(workspace, 'first', 1_000)
  const second = await writeAndComplete(workspace, 'second', 2_000)
  const firstSize = (await stat(runPath(workspace, first.id))).size
  const result = await pruneRuns(workspace, {
    auth: auth(),
    now: 4_000,
    retentionMs: 30 * DAY_MS,
    maxBytes: firstSize + 10,
    unlink: async (path) => {
      if (path.endsWith(`${first.id}.json`)) {
        throw Object.assign(new Error('denied'), { code: 'EPERM' })
      }
      await unlink(path)
    },
  })
  expect(result.removed).not.toContain(first.id)
  expect(result.removed).toContain(second.id)
  expect(await readAuthenticatedRun(workspace, first.id, auth())).toBeDefined()
})

it('keeps the previous authenticated file when asynchronous replacement fails', async () => {
  const workspace = await tempWorkspace()
  const original = await writeAndComplete(workspace, 'auth', 1_000)
  const updated = setRunStatus(original, 'cancelled', 2_000)
  await expect(
    writeRun(workspace, updated, auth(), {
      rename: async () => {
        throw new Error('rename failed')
      },
    }),
  ).rejects.toThrow(/rename failed/u)
  expect((await readAuthenticatedRun(workspace, original.id, auth()))?.status).toBe('completed')
})

it('keeps the previous authenticated file when synchronous replacement fails', async () => {
  const workspace = await tempWorkspace()
  const original = await writeAndComplete(workspace, 'auth', 1_000)
  const updated = setRunStatus(original, 'cancelled', 2_000)
  expect(() =>
    writeRunSync(workspace, updated, auth(), {
      renameSync: () => {
        throw new Error('rename failed')
      },
    }),
  ).toThrow(/rename failed/u)
  expect((await readAuthenticatedRun(workspace, original.id, auth()))?.status).toBe('completed')
})

it('refuses a receipt copied from another workspace', async () => {
  const source = await tempWorkspace()
  const target = await tempWorkspace()
  const run = await writeAndComplete(source, 'auth', 1_000)
  await issueCompletionReceipt(source, run.id, DIGEST, auth(), 1_100)
  const bytes = await readFile(receiptPath(source, 'auth'), 'utf8')
  await mkdir(receiptsDirectory(target), { recursive: true })
  await writeFile(receiptPath(target, 'auth'), bytes, 'utf8')
  expect(await readReceipt(target, 'auth', auth())).toBeUndefined()
  expect(await listReceipts(target, auth())).toEqual([])
})

it('refuses run writes through a directory link that leaves the workspace', async () => {
  const workspace = await tempWorkspace()
  const external = await tempWorkspace()
  await mkdir(join(workspace, '.dsh', 'workflows'), { recursive: true })
  try {
    await symlink(
      external,
      join(workspace, '.dsh', 'workflows', 'runs'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch {
    return
  }
  const run = intakeRun(workspace, 'auth', 1_000)
  await expect(writeRun(workspace, run, auth())).rejects.toThrow(/escapes the workspace/u)
  expect(() => writeRunSync(workspace, run, auth())).toThrow(/escapes the workspace/u)
  expect(await readdir(external)).toEqual([])
})

it('refuses a receipt write through a directory link that leaves the workspace', async () => {
  const workspace = await tempWorkspace()
  const external = await tempWorkspace()
  await mkdir(join(workspace, '.dsh', 'workflows'), { recursive: true })
  try {
    await symlink(
      external,
      join(workspace, '.dsh', 'workflows', 'receipts'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
  } catch {
    return
  }
  await expect(issueAdoptionReceipt(workspace, 'auth', DIGEST, auth(), 1_000)).rejects.toThrow(
    /escapes the workspace/u,
  )
  expect(await readdir(external)).toEqual([])
})

it('keeps a truncated context under the byte cap even for oversized keys', () => {
  const bounded = boundContext({ ['k'.repeat(10_000)]: 'v' }, 200)
  expect(bounded.truncated).toBe(true)
  expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThanOrEqual(200)
  const multibyte = boundContext({ ['é'.repeat(500)]: 'ü'.repeat(500) }, 200)
  expect(Buffer.byteLength(JSON.stringify(multibyte), 'utf8')).toBeLessThanOrEqual(200)
})

it('refuses a second request while a requested step is blocked', () => {
  const workspace = '/workspace'
  const run = createRun({
    definition: 'change-intake',
    trigger: 'tool.pre-execute',
    session: 'session-1',
    workspace,
    steps: ['requirements', 'spec'],
    id: 'run-blocked-step',
  })
  const first = requestStep(run, 'requirements', 1_100)
  const blocked = settleStep(first, 'requirements', 'blocked', { at: 1_200, reason: 'waiting' })
  expect(() => requestStep(blocked, 'spec', 1_300)).toThrow(/one main step runs at a time/u)
  const done = settleStep(blocked, 'requirements', 'done', { at: 1_400 })
  const second = requestStep(done, 'spec', 1_500)
  expect(activeStep(second)?.id).toBe('spec')
})

it('refuses a foreign-session resume or cancel', async () => {
  const workspace = await tempWorkspace()
  const run = setRunStatus(intakeRun(workspace, 'auth', 1_000), 'interrupted', 1_100)
  await writeRun(workspace, run, auth())
  await expect(resumeRun(workspace, run.id, auth(), 2_000, 'session-other')).rejects.toThrow(
    /belongs to session/u,
  )
  const unchanged = await readAuthenticatedRun(workspace, run.id, auth())
  expect(unchanged?.status).toBe('interrupted')
  const resumed = await resumeRun(workspace, run.id, auth(), 2_000, unchanged?.session)
  expect(resumed.run.status).toBe('running')

  const second = setRunStatus(intakeRun(workspace, 'auth-two', 1_000), 'interrupted', 1_100)
  await writeRun(workspace, second, auth())
  await expect(cancelRun(workspace, second.id, auth(), 2_000, 'session-other')).rejects.toThrow(
    /belongs to session/u,
  )
  expect((await readAuthenticatedRun(workspace, second.id, auth()))?.status).toBe('interrupted')
})

it('retains a failed run whose required step is still unresolved', async () => {
  const workspace = await tempWorkspace()
  const run = setRunStatus(intakeRun(workspace, 'auth', 1_000, 'run-unresolved'), 'failed', 1_100)
  await writeRun(workspace, run, auth())
  const old = 50 * DAY_MS
  await utimes(runPath(workspace, run.id), new Date(old), new Date(old))
  const result = await pruneRuns(workspace, {
    auth: auth(),
    now: old + 40 * DAY_MS,
    retentionMs: 30 * DAY_MS,
  })
  expect(result.removed).not.toContain(run.id)
  expect((await readAuthenticatedRun(workspace, run.id, auth()))?.status).toBe('failed')
})

it('reports a tampered run file', async () => {
  const workspace = await tempWorkspace()
  const run = intakeRun(workspace, 'auth', 1_000, 'run-tamper-check')
  await writeRun(workspace, run, auth())
  expect(await hasTamperedRuns(workspace, auth())).toBe(false)
  const file = runPath(workspace, run.id)
  const parsed = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  parsed.status = 'completed'
  await writeFile(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')
  expect(await hasTamperedRuns(workspace, auth())).toBe(true)
})
