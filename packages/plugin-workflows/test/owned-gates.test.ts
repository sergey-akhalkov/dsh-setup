import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Definition } from '../src/host/definitions.ts'
import {
  codeChangedThisTurn,
  evaluateOwnedLaneGate,
  evaluateOwnedProgressGate,
  goalCompletionRefusal,
  pruneLaneDecisions,
  type ReviewUnit,
  reviewRunSteer,
  reviewUnits,
  reviewUnitText,
  taskReviewEvidence,
} from '../src/host/engine-gates.ts'
import { type GitRunner, legacyWorktreeDigest, worktreeDigest } from '../src/host/git.ts'
import { notePathFor, readProgressNote, writeProgressNote } from '../src/host/notes.ts'
import { taskReviewCompletion } from '../src/host/parity.ts'
import { sectionRecordId, taskIdOf } from '../src/host/tasks.ts'

/**
 * The engine-owned gate evidence surface: the note action writes the persisted
 * evidence, the active review owner's record store supplies a reviewed tick,
 * and the shared parity tables decide. Task 4.5's mixed-ownership coverage
 * calls `writeProgressNote` plus the gate evaluators directly.
 */

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const PLAN = `# Tasks

## 1. Engine (lane 1, owns \`packages/engine/**\`)

- [ ] 1.1 Engine task

## 2. Docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Doc task
`
const IMPLEMENTATION_STATUS = ' M packages/engine/src/engine.ts\0'

/** A git seam whose status the test can change between a note and a close. */
function fakeGit(status: () => string, root: string): GitRunner {
  return async (args) => {
    const [command, sub] = args
    if (command === 'rev-parse' && sub === '--show-toplevel') {
      return Buffer.from(`${root}\n`)
    }
    if (command === 'rev-parse') return Buffer.from('a'.repeat(40))
    if (command === 'status') return Buffer.from(status())
    if (command === 'diff') return Buffer.from('')
    return Buffer.from('')
  }
}

async function workspace(plan = PLAN): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-gates-'))
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  })
  const change = join(root, 'openspec', 'changes', 'change-a')
  await mkdir(change, { recursive: true })
  await writeFile(join(change, 'tasks.md'), plan, 'utf8')
  return root
}

/** The native task-review PASS the progress gate reads for a checked task. */
async function writeTaskPass(root: string, taskId: string): Promise<void> {
  const record = join(root, '.dsh', 'workflows', 'records', 'task-review', 'change-a', 'tasks')
  await mkdir(record, { recursive: true })
  await writeFile(
    join(record, `${taskId}.json`),
    JSON.stringify({
      definition: 'task-review',
      rule: 'task-review',
      change: 'change-a',
      phase: 'task',
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
}

/** The committed portable approval the completion coverage reads. */
async function writePortablePass(root: string, taskId: string): Promise<void> {
  const reviews = join(root, 'openspec', 'changes', 'change-a', 'reviews')
  await mkdir(reviews, { recursive: true })
  await writeFile(
    join(reviews, `${taskId}.json`),
    JSON.stringify({
      rule: 'task-review',
      change: 'change-a',
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
}

/** The single-task plan the reopened/removed close regressions use. */
const FIRST_PLAN = '# Tasks\n\n- [ ] 1.1 First task\n'
const FIRST_CHECKED = '# Tasks\n\n- [x] 1.1 First task\n'

describe('the note action', () => {
  it('persists a digest-bound note that names its lane and writing session', async () => {
    const root = await workspace()
    const written = await writeProgressNote(
      root,
      {
        change: 'change-a',
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'docs stay serial',
      },
      {
        runGit: fakeGit(() => IMPLEMENTATION_STATUS, root),
        now: 1_000,
        session: 'session-1',
      },
    )
    expect(written.lane).toBe('2. Docs (lane 2, owns `docs/**`)')
    expect(written.text).toContain(notePathFor('workflows', 'change-a'))
    const note = await readProgressNote(root, 'change-a', 'workflows')
    expect(note?.taskId).toBe(taskIdOf('Doc task'))
    expect(note?.session).toBe('session-1')
    expect(note?.worktreeDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(
      JSON.parse(await readFile(join(root, notePathFor('workflows', 'change-a')), 'utf8')),
    ).toMatchObject({ lane: '2. Docs (lane 2, owns `docs/**`)', session: 'session-1' })
  })

  it('refuses a checked task and an unknown change', async () => {
    const root = await workspace(PLAN.replace('- [ ] 2.1', '- [x] 2.1'))
    await expect(
      writeProgressNote(
        root,
        { change: 'change-a', task: '2.1 Doc task', status: 'blocked' },
        { runGit: fakeGit(() => IMPLEMENTATION_STATUS, root) },
      ),
    ).rejects.toThrow(/is checked/u)
    await expect(
      writeProgressNote(
        root,
        { change: 'missing', task: '2.1 Doc task', status: 'blocked' },
        { runGit: fakeGit(() => IMPLEMENTATION_STATUS, root) },
      ),
    ).rejects.toThrow(/no readable tasks\.md/u)
  })
})

describe('the goal-complete guard', () => {
  const taskReview = { id: 'task-review' } as unknown as Definition

  it('refuses an unnumbered checked task that the task parser cannot match', async () => {
    const root = await workspace('# Tasks\n\n- [x] Implement feature\n')
    const refusal = await goalCompletionRefusal({
      workspace: root,
      definitions: [taskReview],
      exec: { name: 'update_goal', arguments: { action: 'complete' } },
    })
    expect(refusal).toContain('goal completion refused')
    expect(refusal).toContain('is not a numbered task')
  })
})

describe('the owned work-progress gate', () => {
  it('accepts a current note and refuses it after the worktree moves', async () => {
    const root = await workspace()
    let status = IMPLEMENTATION_STATUS
    const runGit = fakeGit(() => status, root)
    const calls = [
      {
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'packages/engine/src/engine.ts' },
        ok: true,
        at: 1_000,
        turn: 1,
      },
    ]
    expect(codeChangedThisTurn(calls, root, 1)).toBe(true)
    await writeProgressNote(
      root,
      { change: 'change-a', task: '1.1 Engine task', status: 'in-progress', reason: 'spanning' },
      { runGit, now: 1_000 },
    )
    const current = await evaluateOwnedProgressGate({
      workspace: root,
      change: 'change-a',
      calls,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      reviewOwner: 'workflows',
      runGit,
    })
    expect(current.decision).toBe('allow')

    status = ' M packages/engine/src/engine.ts\n M packages/engine/src/other.ts\0'
    const stale = await evaluateOwnedProgressGate({
      workspace: root,
      change: 'change-a',
      calls,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      reviewOwner: 'workflows',
      runGit,
    })
    expect(stale.decision).toBe('refuse')
    expect(stale.reason).toContain('without a reviewed tick or a current note')
    expect(stale.steer).toContain('stale')
    expect(stale.steer).toContain('workflows { action: "note"')
  })

  it('reads a native PASS for a newly checked task from the workflows store', async () => {
    const root = await workspace(FIRST_PLAN)
    const taskId = taskIdOf('First task')
    await writeTaskPass(root, taskId)
    expect(await taskReviewEvidence(root, 'change-a', taskId, 'workflows')).toBe(true)
    expect(await taskReviewEvidence(root, 'change-a', taskId, 'legacy')).toBe(false)
    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'tasks.md'),
      FIRST_CHECKED,
      'utf8',
    )
    const calls = [
      {
        callId: 'tick-1',
        name: 'write',
        arguments: { file_path: 'openspec/changes/change-a/tasks.md' },
        ok: true,
        turn: 1,
        before: FIRST_PLAN,
        after: FIRST_CHECKED,
      },
    ]
    const decision = await evaluateOwnedProgressGate({
      workspace: root,
      change: 'change-a',
      calls,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      reviewOwner: 'workflows',
      runGit: fakeGit(() => IMPLEMENTATION_STATUS, root),
    })
    expect(decision.decision).toBe('allow')
  })

  it('refuses a reviewed tick whose task was reopened before the close', async () => {
    const root = await workspace(FIRST_PLAN)
    const taskId = taskIdOf('First task')
    await writeTaskPass(root, taskId)
    const calls = [
      {
        callId: 'tick-1',
        name: 'write',
        arguments: { file_path: 'openspec/changes/change-a/tasks.md' },
        ok: true,
        turn: 1,
        before: FIRST_PLAN,
        after: FIRST_CHECKED,
      },
      {
        callId: 'reopen-1',
        name: 'write',
        arguments: { file_path: 'openspec/changes/change-a/tasks.md' },
        ok: true,
        turn: 1,
        before: FIRST_CHECKED,
        after: FIRST_PLAN,
      },
    ]
    const decision = await evaluateOwnedProgressGate({
      workspace: root,
      change: 'change-a',
      calls,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      reviewOwner: 'workflows',
      runGit: fakeGit(() => IMPLEMENTATION_STATUS, root),
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.reason).toContain('without a reviewed tick or a current note')
  })

  it('refuses a reviewed tick whose task was removed before the close', async () => {
    const root = await workspace(FIRST_PLAN)
    const taskId = taskIdOf('First task')
    await writeTaskPass(root, taskId)
    const removed = '# Tasks\n'
    await writeFile(join(root, 'openspec', 'changes', 'change-a', 'tasks.md'), removed, 'utf8')
    const calls = [
      {
        callId: 'tick-1',
        name: 'write',
        arguments: { file_path: 'openspec/changes/change-a/tasks.md' },
        ok: true,
        turn: 1,
        before: FIRST_PLAN,
        after: FIRST_CHECKED,
      },
      {
        callId: 'remove-1',
        name: 'write',
        arguments: { file_path: 'openspec/changes/change-a/tasks.md' },
        ok: true,
        turn: 1,
        before: FIRST_CHECKED,
        after: removed,
      },
    ]
    const decision = await evaluateOwnedProgressGate({
      workspace: root,
      change: 'change-a',
      calls,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      reviewOwner: 'workflows',
      runGit: fakeGit(() => IMPLEMENTATION_STATUS, root),
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.reason).toContain('without a reviewed tick or a current note')
  })
})

describe('the owned lane-assignment gate', () => {
  const implementation = [
    {
      callId: 'write-1',
      name: 'write',
      arguments: { file_path: 'packages/engine/src/engine.ts' },
      ok: true,
      turn: 1,
    },
  ]

  it('reports an unassigned non-serial lane with its owned paths', async () => {
    const root = await workspace()
    const decision = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: implementation,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-1',
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.lanes?.map((lane) => lane.title)).toEqual([
      '1. Engine (lane 1, owns `packages/engine/**`)',
      '2. Docs (lane 2, owns `docs/**`)',
    ])
    expect(decision.steer).toContain('lane-tag: change-a#1')
    expect(decision.steer).toContain('workflows { action: "note"')
    expect(decision.steer).toContain('git add -A :/; git add -f ":(top)openspec/changes/change-a"')
    expect(decision.steer).toContain('git commit -m "lane checkpoint before fan-out"')
    expect(decision.steer).toContain('git worktree add ../wt-change-a-1 -b lane-change-a-1')
    expect(decision.steer).toContain('Do not tick tasks.md')
    expect(decision.steer).toContain('Work only inside packages/engine/**')
    const steer = decision.steer ?? ''
    expect(steer.indexOf('lane checkpoint before fan-out')).toBeLessThan(steer.indexOf('subagent('))
  })

  it('accepts the lane identity captured at the worker start', async () => {
    const root = await workspace()
    const decision = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: implementation,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-1',
      decisions: new Map([['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned']]),
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.lanes?.map((lane) => lane.n)).toEqual([2])
  })

  it('does not reinterpret an old numeric tag against a renamed plan', async () => {
    const root = await workspace(PLAN.replace('1. Engine', '1. Runtime'))
    const calls = [
      ...implementation,
      {
        callId: 'worker-1',
        name: 'subagent',
        arguments: { prompt: 'lane-tag: change-a#1. Implement lane 1.' },
        ok: true,
        turn: 1,
      },
    ]
    const decision = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-1',
      decisions: new Map(),
    })
    expect(decision.lanes?.map((lane) => lane.n)).toEqual([1, 2])
  })

  it('lets a serial note decide only its own lane', async () => {
    const root = await workspace()
    await writeProgressNote(
      root,
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial' },
      { runGit: fakeGit(() => IMPLEMENTATION_STATUS, root), session: 'session-1' },
    )
    const decision = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: implementation,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-1',
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.lanes?.map((lane) => lane.n)).toEqual([1])
  })

  it("does not let another session's serial note decide this session's lane", async () => {
    const root = await workspace()
    await writeProgressNote(
      root,
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial' },
      { runGit: fakeGit(() => IMPLEMENTATION_STATUS, root), session: 'session-a' },
    )
    const decisions = new Map<string, 'assigned' | 'serial'>([
      ['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned'],
    ])
    const foreign = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: implementation,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-b',
      decisions,
    })
    expect(foreign.decision).toBe('refuse')
    expect(foreign.lanes?.map((lane) => lane.n)).toEqual([2])
    // The same note still decides its lane for the session that wrote it.
    const own = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: implementation,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-a',
      decisions,
    })
    expect(own.decision).toBe('allow')
  })

  it('refuses an old serial note after its lane is renamed', async () => {
    const root = await workspace()
    const runGit = fakeGit(() => IMPLEMENTATION_STATUS, root)
    await writeProgressNote(
      root,
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial' },
      { runGit, session: 'session-1' },
    )
    const renamed = PLAN.replace('2. Docs', '2. Documentation')
    await writeFile(join(root, 'openspec', 'changes', 'change-a', 'tasks.md'), renamed, 'utf8')
    const decisions = new Map<string, 'assigned' | 'serial'>([
      ['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned'],
    ])
    const refused = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: implementation,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-1',
      decisions,
    })
    expect(refused.decision).toBe('refuse')
    expect(refused.lanes?.map((lane) => lane.n)).toEqual([2])
    // Fresh evidence for the renamed lane decides it again.
    await writeProgressNote(
      root,
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial' },
      { runGit, session: 'session-1' },
    )
    const allowed = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: implementation,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-1',
      decisions,
    })
    expect(allowed.decision).toBe('allow')
  })

  it('fails open on an unreadable plan and on a single-lane plan', async () => {
    const root = await workspace()
    await rm(join(root, 'openspec', 'changes', 'change-a', 'tasks.md'))
    expect(
      (
        await evaluateOwnedLaneGate({
          workspace: root,
          change: 'change-a',
          calls: implementation,
          turn: 1,
          codeChanged: true,
          noteOwner: 'workflows',
          session: 'session-1',
        })
      ).decision,
    ).toBe('allow')
    const single = await workspace(`# Tasks\n\n## 1. Only (owns \`src/**\`)\n\n- [ ] 1.1 Task\n`)
    expect(
      (
        await evaluateOwnedLaneGate({
          workspace: single,
          change: 'change-a',
          calls: implementation,
          turn: 1,
          codeChanged: true,
          noteOwner: 'workflows',
          session: 'session-1',
        })
      ).decision,
    ).toBe('allow')
  })
})

describe('the kept lane decisions', () => {
  it('prunes a completed or removed lane and keeps an actionable one', async () => {
    const root = await workspace()
    const decisions = new Map<string, 'assigned' | 'serial'>([
      ['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned'],
      ['2. Docs (lane 2, owns `docs/**`)', 'serial'],
      ['3. Gone (owns `src/**`)', 'assigned'],
    ])
    await pruneLaneDecisions(root, 'change-a', decisions, {
      owner: 'workflows',
      session: 'session-1',
    })
    expect([...decisions.keys()]).toEqual([
      '1. Engine (lane 1, owns `packages/engine/**`)',
      '2. Docs (lane 2, owns `docs/**`)',
    ])
    // A completed lane is pruned even while its heading stays in the plan.
    const completed = await workspace(PLAN.replace('- [ ] 1.1', '- [x] 1.1'))
    const kept = new Map<string, 'assigned' | 'serial'>([
      ['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned'],
    ])
    await pruneLaneDecisions(completed, 'change-a', kept, {
      owner: 'workflows',
      session: 'session-1',
    })
    expect(kept.size).toBe(0)
  })

  it('invalidates a serial note when its lane completes and is reopened', async () => {
    const root = await workspace()
    const runGit = fakeGit(() => IMPLEMENTATION_STATUS, root)
    const decisions = new Map<string, 'assigned' | 'serial'>([
      ['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned'],
      ['2. Docs (lane 2, owns `docs/**`)', 'serial'],
    ])
    await writeProgressNote(
      root,
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial' },
      { runGit, session: 'session-1' },
    )
    const tasks = join(root, 'openspec', 'changes', 'change-a', 'tasks.md')
    // Completion prunes the serial decision together with its persisted note.
    await writeFile(tasks, PLAN.replace('- [ ] 2.1', '- [x] 2.1'), 'utf8')
    await pruneLaneDecisions(root, 'change-a', decisions, {
      owner: 'workflows',
      session: 'session-1',
    })
    expect(decisions.has('2. Docs (lane 2, owns `docs/**`)')).toBe(false)
    expect(await readProgressNote(root, 'change-a', 'workflows')).toBeUndefined()
    // Reopening the lane does not resurrect the completed lane's old note.
    await writeFile(tasks, PLAN, 'utf8')
    const calls = [
      {
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'packages/engine/src/engine.ts' },
        ok: true,
        turn: 1,
      },
    ]
    const gate = (): ReturnType<typeof evaluateOwnedLaneGate> =>
      evaluateOwnedLaneGate({
        workspace: root,
        change: 'change-a',
        calls,
        turn: 1,
        codeChanged: true,
        noteOwner: 'workflows',
        session: 'session-1',
        decisions,
        runGit,
      })
    const reopened = await gate()
    expect(reopened.decision).toBe('refuse')
    expect(reopened.lanes?.map((lane) => lane.n)).toEqual([2])
    // Fresh evidence written for the reopened lane decides it again.
    await writeProgressNote(
      root,
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial' },
      { runGit, session: 'session-1' },
    )
    expect((await gate()).decision).toBe('allow')
  })

  it('invalidates its own serial note after a reload but keeps another session note', async () => {
    const root = await workspace()
    const runGit = fakeGit(() => IMPLEMENTATION_STATUS, root)
    const tasks = join(root, 'openspec', 'changes', 'change-a', 'tasks.md')
    const laneOne = '1. Engine (lane 1, owns `packages/engine/**`)'
    const noteInput = {
      change: 'change-a',
      task: '2.1 Doc task',
      status: 'in-progress',
      reason: 'serial',
    } as const
    const completed = PLAN.replace('- [ ] 2.1', '- [x] 2.1')
    // Another session's note is that session's evidence: a reloaded session's
    // prune starts with an empty decision map and must leave the note alone.
    await writeProgressNote(root, noteInput, { runGit, session: 'session-2' })
    await writeFile(tasks, completed, 'utf8')
    await pruneLaneDecisions(root, 'change-a', new Map(), {
      owner: 'workflows',
      session: 'session-1',
    })
    expect(await readProgressNote(root, 'change-a', 'workflows')).toBeDefined()
    // The writing session's own completed lane drops its note without a decision.
    await pruneLaneDecisions(root, 'change-a', new Map(), {
      owner: 'workflows',
      session: 'session-2',
    })
    expect(await readProgressNote(root, 'change-a', 'workflows')).toBeUndefined()
    // Reopen, take a fresh serial note, and complete the lane again; the empty
    // map is what a fresh host holds after a reload.
    await writeFile(tasks, PLAN, 'utf8')
    await writeProgressNote(root, noteInput, { runGit, session: 'session-1' })
    await writeFile(tasks, completed, 'utf8')
    await pruneLaneDecisions(root, 'change-a', new Map(), {
      owner: 'workflows',
      session: 'session-1',
    })
    expect(await readProgressNote(root, 'change-a', 'workflows')).toBeUndefined()
    // Reopening the lane does not resurrect the completed lane's stale note.
    await writeFile(tasks, PLAN, 'utf8')
    const calls = [
      {
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'packages/engine/src/engine.ts' },
        ok: true,
        turn: 1,
      },
    ]
    const reopened = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-1',
      decisions: new Map([[laneOne, 'assigned']]),
      runGit,
    })
    expect(reopened.decision).toBe('refuse')
    expect(reopened.lanes?.map((lane) => lane.n)).toEqual([2])
    // A removed lane's persisted note is stale evidence too.
    await writeProgressNote(root, noteInput, { runGit, session: 'session-1' })
    await writeFile(
      tasks,
      '# Tasks\n\n## 1. Engine (lane 1, owns `packages/engine/**`)\n\n- [ ] 1.1 Engine task\n',
      'utf8',
    )
    await pruneLaneDecisions(root, 'change-a', new Map(), {
      owner: 'workflows',
      session: 'session-1',
    })
    expect(await readProgressNote(root, 'change-a', 'workflows')).toBeUndefined()
  })

  it('satisfies a lane from a kept decision after the tool buffer lost the tag', async () => {
    const root = await workspace()
    const decision = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: [],
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
      session: 'session-1',
      decisions: new Map([['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned']]),
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.lanes?.map((lane) => lane.n)).toEqual([2])
  })
})

describe('mixed ownership', () => {
  it('reads the legacy note path when the progress signal is legacy', async () => {
    const root = await workspace()
    const runGit = fakeGit(() => IMPLEMENTATION_STATUS, root)
    await writeProgressNote(
      root,
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial' },
      { owner: 'legacy', runGit, now: 1_000, session: 'session-1' },
    )
    expect(await readProgressNote(root, 'change-a', 'legacy')).toBeDefined()
    expect(await readProgressNote(root, 'change-a', 'workflows')).toBeUndefined()
    const calls = [
      {
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'packages/engine/src/engine.ts' },
        ok: true,
        at: 1_000,
        turn: 1,
      },
    ]
    // The progress signal is legacy but the lane gate is owned: the legacy note
    // satisfies both the note digest and the lane's serial decision.
    expect(
      (
        await evaluateOwnedProgressGate({
          workspace: root,
          change: 'change-a',
          calls,
          turn: 1,
          codeChanged: true,
          noteOwner: 'legacy',
          reviewOwner: 'workflows',
          runGit,
        })
      ).decision,
    ).toBe('allow')
    const lane = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls,
      turn: 1,
      codeChanged: true,
      noteOwner: 'legacy',
      session: 'session-1',
    })
    expect(lane.decision).toBe('refuse')
    expect(lane.lanes?.map((entry) => entry.n)).toEqual([1])
  })

  it('keeps the HEAD binding on workflow notes and the legacy digest on legacy notes', async () => {
    const root = await workspace()
    let head = 'a'.repeat(40)
    const runGit: GitRunner = async (args) => {
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return Buffer.from(`${root}\n`)
      }
      if (args[0] === 'rev-parse') return Buffer.from(`${head}\n`)
      if (args[0] === 'status') return Buffer.from(IMPLEMENTATION_STATUS)
      return Buffer.from('')
    }
    const workflow = await writeProgressNote(
      root,
      { change: 'change-a', task: '1.1 Engine task', status: 'in-progress', reason: 'workflow' },
      { runGit, now: 1_000 },
    )
    const legacy = await writeProgressNote(
      root,
      { change: 'change-a', task: '1.1 Engine task', status: 'in-progress', reason: 'legacy' },
      { runGit, now: 1_000, owner: 'legacy', session: 'session-1' },
    )
    expect(workflow.note.worktreeDigest).toBe(await worktreeDigest(root, runGit))
    expect(legacy.note.worktreeDigest).toBe(await legacyWorktreeDigest(root, runGit))
    // A clean commit moves only the workflow format's HEAD identity.
    head = 'b'.repeat(40)
    expect(await worktreeDigest(root, runGit)).not.toBe(workflow.note.worktreeDigest)
    expect(await legacyWorktreeDigest(root, runGit)).toBe(legacy.note.worktreeDigest)
    const calls = [
      {
        callId: 'write-1',
        name: 'write',
        arguments: { file_path: 'packages/engine/src/engine.ts' },
        ok: true,
        at: 1_000,
        turn: 1,
      },
    ]
    const progress = (
      noteOwner: 'workflows' | 'legacy',
    ): ReturnType<typeof evaluateOwnedProgressGate> =>
      evaluateOwnedProgressGate({
        workspace: root,
        change: 'change-a',
        calls,
        turn: 1,
        codeChanged: true,
        noteOwner,
        reviewOwner: 'workflows',
        runGit,
      })
    expect((await progress('workflows')).decision).toBe('refuse')
    expect((await progress('legacy')).decision).toBe('allow')
  })

  it('accepts a title-less legacy serial note only while its worktree is current', async () => {
    const root = await workspace()
    let status = IMPLEMENTATION_STATUS
    const runGit = fakeGit(() => status, root)
    // The legacy writer records the HEAD-less digest; the note it wrote is
    // current under that same algorithm.
    const digest = await legacyWorktreeDigest(root, runGit)
    expect(digest).toBeDefined()
    const path = join(root, notePathFor('legacy', 'change-a'))
    await mkdir(dirname(path), { recursive: true })
    await writeFile(
      path,
      JSON.stringify({
        taskId: taskIdOf('Doc task'),
        status: 'in-progress',
        reason: 'legacy serial',
        worktreeDigest: digest,
        time: '2026-11-16T00:00:00.000Z',
      }),
      'utf8',
    )
    const decisions = new Map<string, 'assigned' | 'serial'>([
      ['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned'],
    ])
    const gate = (): ReturnType<typeof evaluateOwnedLaneGate> =>
      evaluateOwnedLaneGate({
        workspace: root,
        change: 'change-a',
        calls: [],
        turn: 1,
        codeChanged: true,
        noteOwner: 'legacy',
        session: 'session-1',
        decisions,
        runGit,
      })
    expect((await gate()).decision).toBe('allow')
    // A plan change makes the captured digest stale, so the old serial note is
    // no longer evidence for the renamed lane.
    status = ' M packages/engine/src/engine.ts\n M packages/engine/src/other.ts\0'
    const stale = await gate()
    expect(stale.decision).toBe('refuse')
    expect(stale.lanes?.map((lane) => lane.n)).toEqual([2])
  })
})

/** A section whose checked tasks can be partly approved, plus an off-section lane. */
const SECTIONED_PLAN = `# Tasks

## 1. Engine (lane 1, owns \`packages/engine/**\`)

- [x] 1.1 Engine task
- [x] 1.2 Engine follow-up
- [x] 1.3 Engine cleanup
- [ ] 1.4 Pending engine task

## 2. Docs (lane 2, owns \`docs/**\`)

- [x] 2.1 Doc task
`

/** The same plan with every task checked, for the completion steer. */
const DONE_PLAN = `# Tasks

## 1. Engine (lane 1, owns \`packages/engine/**\`)

- [x] 1.1 Engine task
- [x] 1.2 Engine follow-up

## 2. Docs (lane 2, owns \`docs/**\`)

- [x] 2.1 Doc task
`

/** The first selected unit; selection produced none when this throws. */
async function firstUnit(root: string): Promise<ReviewUnit> {
  const unit = (await reviewUnits(root, 'change-a', 'workflows'))?.[0]
  if (unit === undefined) throw new Error('no review unit was selected')
  return unit
}

describe('the section-first review units', () => {
  it('selects one section unit covering every checked task for two missing records', async () => {
    const root = await workspace(SECTIONED_PLAN)
    await writeTaskPass(root, taskIdOf('Doc task'))
    const units = await reviewUnits(root, 'change-a', 'workflows')
    expect(units).toHaveLength(1)
    expect(units?.[0]?.section).toEqual({
      key: '1',
      title: '1. Engine (lane 1, owns `packages/engine/**`)',
    })
    expect(units?.[0]?.covered.map((task) => task.number)).toEqual(['1.1', '1.2', '1.3'])
    expect(units?.[0]?.missing.map((task) => task.number)).toEqual(['1.1', '1.2', '1.3'])
  })

  it('groups a tab-separated section heading through the shared section parser', async () => {
    const root = await workspace(
      '# Tasks\n\n##\t1. Engine\n\n- [x] 1.1 First task\n- [x] 1.2 Second task\n- [ ] 1.3 Pending\n',
    )
    const units = await reviewUnits(root, 'change-a', 'workflows')
    expect(units).toHaveLength(1)
    expect(units?.[0]?.section).toEqual({ key: '1', title: '1. Engine' })
    expect(units?.[0]?.covered.map((task) => task.number)).toEqual(['1.1', '1.2'])
  })

  it('keeps per-task units when two headings share one section key', async () => {
    const root = await workspace(
      '# Tasks\n\n## 1. Engine\n\n- [x] 1.1 First task\n- [x] 1.2 Second task\n\n## 1. Docs\n\n- [x] 1.3 Third task\n',
    )
    const units = await reviewUnits(root, 'change-a', 'workflows')
    expect(units?.every((unit) => unit.section === undefined)).toBe(true)
    expect(units?.map((unit) => unit.missing.map((task) => task.number))).toEqual([
      ['1.1'],
      ['1.2'],
      ['1.3'],
    ])
  })

  it('keeps the per-task unit for a single missing task', async () => {
    const root = await workspace(SECTIONED_PLAN)
    await writeTaskPass(root, taskIdOf('Engine task'))
    await writeTaskPass(root, taskIdOf('Engine follow-up'))
    await writeTaskPass(root, taskIdOf('Doc task'))
    const units = await reviewUnits(root, 'change-a', 'workflows')
    expect(units?.map((unit) => unit.missing.map((task) => task.number))).toEqual([['1.3']])
    expect(units?.[0]?.section).toBeUndefined()
  })

  it('selects nothing when every checked task has a matching record', async () => {
    const root = await workspace(SECTIONED_PLAN)
    for (const text of ['Engine task', 'Engine follow-up', 'Engine cleanup', 'Doc task']) {
      await writeTaskPass(root, taskIdOf(text))
    }
    expect(await reviewUnits(root, 'change-a', 'workflows')).toEqual([])
  })

  it('keeps the per-task unit for a task outside any section', async () => {
    const root = await workspace(
      '# Tasks\n\n- [x] 0.1 Unsectioned task\n\n## 1. Engine\n\n- [x] 1.1 Engine task\n',
    )
    const units = await reviewUnits(root, 'change-a', 'workflows')
    expect(units?.map((unit) => unit.missing.map((task) => task.number))).toEqual([
      ['1.1'],
      ['0.1'],
    ])
    expect(units?.every((unit) => unit.section === undefined)).toBe(true)
  })

  it('covers an approved task when a section mixes approvals and missing records', async () => {
    const root = await workspace(SECTIONED_PLAN)
    await writeTaskPass(root, taskIdOf('Engine follow-up'))
    await writeTaskPass(root, taskIdOf('Doc task'))
    const units = await reviewUnits(root, 'change-a', 'workflows')
    expect(units).toHaveLength(1)
    expect(units?.[0]?.covered.map((task) => task.number)).toEqual(['1.1', '1.2', '1.3'])
    expect(units?.[0]?.missing.map((task) => task.number)).toEqual(['1.1', '1.3'])
  })
})

describe('the review unit steer', () => {
  it('names the section key, its missing tasks, and the section start action', async () => {
    const root = await workspace(SECTIONED_PLAN)
    const text = reviewUnitText('change-a', await firstUnit(root))
    expect(text).toContain('section "1" (1. Engine')
    expect(text).toContain('missing a task-review PASS/ERROR record: 1.1, 1.2, 1.3')
    expect(text).toContain('delegate(rule: "task-review", change: "change-a", section: "1")')
  })

  it('points the status line at a pending section run instead of a new start', async () => {
    const root = await workspace(SECTIONED_PLAN)
    const unit = await firstUnit(root)
    const text = reviewUnitText('change-a', unit, {
      openRuns: [
        {
          id: 'run-1',
          change: 'change-a',
          context: {
            name: 'change-a',
            taskId: sectionRecordId('1'),
            section: '1',
            sectionTitle: '1. Engine (lane 1, owns `packages/engine/**`)',
            taskIds: unit.covered.map((task) => task.id),
          },
        },
      ],
    })
    expect(text).toContain('the open review run "run-1" covers it')
    expect(text).not.toContain('delegate(')
  })

  it('keeps the per-task form for a single missing task', async () => {
    const root = await workspace('# Tasks\n\n## 1. Engine\n\n- [x] 1.1 Engine task\n')
    const unit = await firstUnit(root)
    expect(unit.section).toBeUndefined()
    const text = reviewUnitText('change-a', unit)
    expect(text).toContain('task "1.1 Engine task"')
    expect(text).toContain(
      `delegate(rule: "task-review", change: "change-a", task: "${taskIdOf('Engine task')}")`,
    )
  })

  it('points a per-task unit at a pending section run that covers it', async () => {
    const root = await workspace('# Tasks\n\n## 1. Engine\n\n- [x] 1.1 Engine task\n')
    const unit = await firstUnit(root)
    const text = reviewUnitText('change-a', unit, {
      openRuns: [
        {
          id: 'run-2',
          change: 'change-a',
          context: {
            name: 'change-a',
            taskId: sectionRecordId('1'),
            section: '1',
            taskIds: [taskIdOf('Engine task')],
          },
        },
      ],
    })
    expect(text).toContain('the open review run "run-2" covers it')
    expect(text).not.toContain('delegate(')
  })

  it('names the run unit while unchecked tasks defer the completion coverage', async () => {
    const root = await workspace(SECTIONED_PLAN)
    await writeTaskPass(root, taskIdOf('Doc task'))
    const text = await reviewRunSteer(root, 'change-a', {
      name: 'change-a',
      taskId: sectionRecordId('1'),
      section: '1',
      sectionTitle: '1. Engine (lane 1, owns `packages/engine/**`)',
      taskIds: [taskIdOf('Engine task'), taskIdOf('Engine follow-up')],
    })
    expect(text).toContain('section "1" (1. Engine')
    expect(text).toContain('missing a task-review PASS/ERROR record: 1.1, 1.2, 1.3')
    expect(text).toContain('delegate(rule: "task-review", change: "change-a", section: "1")')
  })

  it('points the completion steer at a pending section run instead of a new start', async () => {
    const root = await workspace(DONE_PLAN)
    await writePortablePass(root, taskIdOf('Doc task'))
    const completion = taskReviewCompletion(root, 'change-a', {
      openRuns: [
        {
          id: 'run-1',
          change: 'change-a',
          context: {
            name: 'change-a',
            taskId: sectionRecordId('1'),
            section: '1',
            sectionTitle: '1. Engine (lane 1, owns `packages/engine/**`)',
            taskIds: [taskIdOf('Engine task'), taskIdOf('Engine follow-up')],
          },
        },
      ],
    })
    expect(completion?.ok).toBe(false)
    expect(completion?.text).toContain('the open review run "run-1" covers it')
    expect(completion?.text).not.toContain('delegate(')
  })

  it('points a single-task completion gap at the pending run that covers it', async () => {
    const root = await workspace('# Tasks\n\n## 1. Engine\n\n- [x] 1.1 Engine task\n')
    const completion = taskReviewCompletion(root, 'change-a', {
      openRuns: [
        {
          id: 'run-1',
          change: 'change-a',
          context: { name: 'change-a', taskId: taskIdOf('Engine task') },
        },
      ],
    })
    expect(completion?.ok).toBe(false)
    expect(completion?.text).toContain('the open review run "run-1" covers it')
    expect(completion?.text).not.toContain('delegate(')
  })

  it('points an expanded section at the pending runs that cover its tasks', async () => {
    const root = await workspace(
      '# Tasks\n\n## 1. Engine\n\n- [x] 1.1 Engine task\n- [x] 1.2 Engine follow-up\n- [x] 1.3 Engine cleanup\n\n## 2. Docs\n\n- [x] 2.1 Doc task\n',
    )
    await writePortablePass(root, taskIdOf('Doc task'))
    const completion = taskReviewCompletion(root, 'change-a', {
      openRuns: [
        {
          id: 'run-1',
          change: 'change-a',
          context: {
            name: 'change-a',
            taskId: sectionRecordId('1'),
            section: '1',
            sectionTitle: '1. Engine',
            taskIds: [taskIdOf('Engine task'), taskIdOf('Engine follow-up')],
          },
        },
        {
          id: 'run-2',
          change: 'change-a',
          context: { name: 'change-a', taskId: taskIdOf('Engine cleanup') },
        },
      ],
    })
    expect(completion?.ok).toBe(false)
    expect(completion?.text).toContain('the open review runs "run-1", "run-2" cover it')
    expect(completion?.text).not.toContain('delegate(')
  })

  it('keeps the start action inside the bounded steer for a large section', async () => {
    const tasks = Array.from(
      { length: 40 },
      (_, index) => `- [x] 1.${String(index + 1)} Task number ${String(index + 1)}`,
    ).join('\n')
    const root = await workspace(`# Tasks\n\n## 1. Engine\n\n${tasks}\n`)
    const units = await reviewUnits(root, 'change-a', 'workflows')
    const first = units?.[0]
    if (first === undefined) throw new Error('no review unit was selected')
    const text = reviewUnitText('change-a', first)
    expect(text).toContain('delegate(rule: "task-review", change: "change-a", section: "1")')
    expect(text).toContain('and 20 more')
    expect(text.length).toBeLessThan(600)
  })

  it('keeps the delivered completion note inside the steer budget for a long heading', async () => {
    const root = await workspace(
      '# Tasks\n\n## 2. Focused re-review (lane 1, owns `packages/plugin-workflows/src/host/review.ts`, `review-scheduler.ts`, `review-snapshot.ts`, `evidence.ts`, `projection.ts`, `parity.ts`)\n\n- [x] 2.1 First task\n- [x] 2.2 Second task\n- [x] 2.3 Third task\n- [x] 2.4 Fourth task\n',
    )
    const completion = taskReviewCompletion(root, 'change-a')
    expect(completion?.ok).toBe(false)
    expect(completion?.text).toContain('2.1, 2.2, 2.3, 2.4')
    expect(completion?.text).toContain(
      'delegate(rule: "task-review", change: "change-a", section: "2")',
    )
    // The gate bounds the delivered note to 600 characters; the action must survive.
    expect(completion?.text?.length ?? 0).toBeLessThanOrEqual(600)
  })

  it('accepts a section PASS record as evidence for each covered task', async () => {
    const root = await workspace(SECTIONED_PLAN)
    const directory = join(root, '.dsh', 'workflows', 'records', 'task-review', 'change-a', 'tasks')
    await mkdir(directory, { recursive: true })
    const sectionId = sectionRecordId('1')
    await writeFile(
      join(directory, `${sectionId}.json`),
      JSON.stringify({
        definition: 'task-review',
        rule: 'task-review',
        change: 'change-a',
        phase: 'task',
        scope: 'task',
        taskId: sectionId,
        section: '1',
        sectionTitle: '1. Engine (lane 1, owns `packages/engine/**`)',
        taskIds: ['Engine task', 'Engine follow-up', 'Engine cleanup'].map(taskIdOf),
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-14T10:00:00.000Z',
      }),
      'utf8',
    )
    expect(await taskReviewEvidence(root, 'change-a', taskIdOf('Engine task'), 'workflows')).toBe(
      true,
    )
    expect(await taskReviewEvidence(root, 'change-a', taskIdOf('Doc task'), 'workflows')).toBe(
      false,
    )
    // The selection sees the covered section tasks as reviewed.
    const units = await reviewUnits(root, 'change-a', 'workflows')
    expect(units?.some((unit) => unit.missing.some((task) => task.text === 'Engine task'))).toBe(
      false,
    )
  })

  it('carries the section unit into the completion steer', async () => {
    const root = await workspace(DONE_PLAN)
    await writeTaskPass(root, taskIdOf('Doc task'))
    const completion = taskReviewCompletion(root, 'change-a')
    expect(completion?.ok).toBe(false)
    expect(completion?.text).toContain('section "1" (1. Engine')
    expect(completion?.text).toContain('missing a task-review PASS/ERROR record: 1.1, 1.2')
    expect(completion?.text).toContain(
      'delegate(rule: "task-review", change: "change-a", section: "1")',
    )
  })
})
