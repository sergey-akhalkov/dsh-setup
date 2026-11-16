import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  codeChangedThisTurn,
  evaluateOwnedLaneGate,
  evaluateOwnedProgressGate,
  pruneLaneDecisions,
  taskReviewEvidence,
} from '../src/host/engine-gates.ts'
import type { GitRunner } from '../src/host/git.ts'
import { notePathFor, readProgressNote, writeProgressNote } from '../src/host/notes.ts'
import { taskIdOf } from '../src/host/tasks.ts'

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

describe('the note action', () => {
  it('persists a digest-bound note that names its lane', async () => {
    const root = await workspace()
    const written = await writeProgressNote(
      root,
      {
        change: 'change-a',
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'docs stay serial',
      },
      { runGit: fakeGit(() => IMPLEMENTATION_STATUS, root), now: 1_000 },
    )
    expect(written.lane).toBe('2. Docs (lane 2, owns `docs/**`)')
    expect(written.text).toContain(notePathFor('workflows', 'change-a'))
    const note = await readProgressNote(root, 'change-a', 'workflows')
    expect(note?.taskId).toBe(taskIdOf('Doc task'))
    expect(note?.worktreeDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(
      JSON.parse(await readFile(join(root, notePathFor('workflows', 'change-a')), 'utf8')),
    ).toMatchObject({ lane: '2. Docs (lane 2, owns `docs/**`)' })
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
    const root = await workspace(`# Tasks\n\n- [ ] 1.1 First task\n`)
    const taskId = taskIdOf('First task')
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
    expect(await taskReviewEvidence(root, 'change-a', taskId, 'workflows')).toBe(true)
    expect(await taskReviewEvidence(root, 'change-a', taskId, 'legacy')).toBe(false)
    const calls = [
      {
        callId: 'tick-1',
        name: 'write',
        arguments: { file_path: 'openspec/changes/change-a/tasks.md' },
        ok: true,
        turn: 1,
        before: '# Tasks\n\n- [ ] 1.1 First task\n',
        after: '# Tasks\n\n- [x] 1.1 First task\n',
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
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.lanes?.map((lane) => lane.title)).toEqual([
      '1. Engine (lane 1, owns `packages/engine/**`)',
      '2. Docs (lane 2, owns `docs/**`)',
    ])
    expect(decision.steer).toContain('lane-tag: change-a#1')
    expect(decision.steer).toContain('workflows { action: "note"')
  })

  it('accepts a tagged worker start for the reported lane', async () => {
    const root = await workspace()
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
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.lanes?.map((lane) => lane.n)).toEqual([2])
  })

  it('lets a serial note decide only its own lane', async () => {
    const root = await workspace()
    await writeProgressNote(
      root,
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial' },
      { runGit: fakeGit(() => IMPLEMENTATION_STATUS, root) },
    )
    const decision = await evaluateOwnedLaneGate({
      workspace: root,
      change: 'change-a',
      calls: implementation,
      turn: 1,
      codeChanged: true,
      noteOwner: 'workflows',
    })
    expect(decision.decision).toBe('refuse')
    expect(decision.lanes?.map((lane) => lane.n)).toEqual([1])
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
    await pruneLaneDecisions(root, 'change-a', decisions)
    expect([...decisions.keys()]).toEqual([
      '1. Engine (lane 1, owns `packages/engine/**`)',
      '2. Docs (lane 2, owns `docs/**`)',
    ])
    // A completed lane is pruned even while its heading stays in the plan.
    const completed = await workspace(PLAN.replace('- [ ] 1.1', '- [x] 1.1'))
    const kept = new Map<string, 'assigned' | 'serial'>([
      ['1. Engine (lane 1, owns `packages/engine/**`)', 'assigned'],
    ])
    await pruneLaneDecisions(completed, 'change-a', kept)
    expect(kept.size).toBe(0)
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
      { owner: 'legacy', runGit, now: 1_000 },
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
    })
    expect(lane.decision).toBe('refuse')
    expect(lane.lanes?.map((entry) => entry.n)).toEqual([1])
  })
})
