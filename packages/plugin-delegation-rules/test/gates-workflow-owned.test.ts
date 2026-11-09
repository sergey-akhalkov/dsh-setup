import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type BundleConfigLike,
  defaultTestConfig,
  FakeSubagents,
  Harness,
  makeWorkspace,
  runIdFrom,
  steerTexts,
  taskIdFor,
  writeChange,
} from './helpers.js'

/**
 * The gate-only `gates.workflowOwned` switch: only the task-review turn-stopping
 * rule and the archive gate stop; the review runtime, the whole-spec rule, and
 * the retained progress and lane gates keep working. A flip restores them.
 */

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const plan = `# Tasks

## 1. Engine (lane 1, owns \`packages/engine/**\`)

- [x] 1.1 First task

## 2. Docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Doc task
`

function configWith(workflowOwned: boolean): BundleConfigLike {
  return defaultTestConfig({
    gates: { workflowOwned },
    rules: [
      {
        id: 'spec-review',
        when: 'spec-ready',
        to: 'codex',
        contract: 'review',
        phase: 'spec',
        scope: 'whole',
        gate: 'strict',
        instruction: 'bundled:review-spec',
      },
      {
        id: 'task-review',
        when: 'spec-task-ready',
        to: 'codex',
        contract: 'review',
        scope: 'task',
        gate: 'strict',
        instruction: 'bundled:review-task',
      },
      { id: 'task-progress', when: 'implementation-work', contract: 'note', gate: 'strict' },
      { id: 'lane-fanout', when: 'lane-assignment', contract: 'note', gate: 'strict' },
      { id: 'lane-boundary', when: 'lane-boundary', contract: 'note', gate: 'strict' },
    ],
  })
}

const planUnchecked = plan.replace('- [x] 1.1 First task', '- [ ] 1.1 First task')
const planAll = plan.replace('- [ ] 2.1 Doc task', '- [x] 2.1 Doc task')

async function fixture(workflowOwned: boolean) {
  const workspace = await makeWorkspace()
  cleanups.push(workspace.cleanup)
  const dir = await writeChange(workspace.root, 'change-a', [])
  await writeFile(join(dir, 'tasks.md'), planUnchecked, 'utf8')
  const agents = new FakeSubagents()
  agents.addProvider('codex-subagent')
  const harness = new Harness({ cwd: workspace.root, config: configWith(workflowOwned), agents })
  return { root: workspace.root, dir, agents, harness }
}

/** Every file under one directory, keyed by relative path, for no-rewrite checks. */
async function snapshotFiles(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const walk = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) await walk(path)
      else files.set(relative(directory, path), await readFile(path))
    }
  }
  await walk(directory)
  return files
}

describe('delegation.gates.workflowOwned: false', () => {
  it('stops the task-review and archive gates but keeps the spec-review rule', async () => {
    const { root, dir, harness } = await fixture(false)
    expect(harness.provided.get('delegationRulesStatus')).toEqual({
      workflowOwned: false,
      specReview: true,
      taskReview: true,
    })
    await mkdir(join(root, 'src'), { recursive: true })
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    await harness.writeResult(join(dir, 'tasks.md'), planUnchecked, planAll)
    await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy changed.\n', 'utf8')
    await writeFile(join(dir, 'tasks.md'), planAll, 'utf8')
    await harness.turnStopping(1)
    const steer = steerTexts(harness.agent).join('\n')
    expect(steer).toContain('whole-spec review')
    // Checked tasks without a record, including the completed list, are silent.
    expect(steer).not.toContain('requires its task-scoped review')
    expect(steer).not.toContain('fully checked')

    // An unapproved checked task is archived because the workflow owns the guard.
    await writeFile(
      join(root, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    const decision = await harness.preExecute('pwsh', {
      command: 'openspec archive change-a',
    })
    expect(decision.kind).toBe('allow')
    expect(decision.nextCalled).toBe(true)
  })

  it('keeps the review runtime, the queue, and the records', async () => {
    const { root, dir, harness } = await fixture(false)
    await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
    const run = runIdFrom(
      await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task: taskIdFor('First task'),
      }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(
          root,
          '.dsh',
          'delegation',
          'task-review',
          'change-a',
          'tasks',
          `${taskIdFor('First task')}.json`,
        ),
        'utf8',
      ),
    ) as { verdict: string }
    expect(record.verdict).toBe('PASS')
  })

  it('keeps the task-progress gate steering, including a stale note', async () => {
    const { dir, harness } = await fixture(false)
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    harness.git.status = ' M packages/engine/src/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine/src/engine.ts b/packages/engine/src/engine.ts'
    const noted = await harness.toolText('task_progress', {
      task: '2.1 Doc task',
      status: 'in-progress',
      reason: 'writing the docs',
    })
    expect(noted).toContain('progress note written')
    // A matched note satisfies the progress rule before the worktree moves on.
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).join('\n')).not.toContain('rule "task-progress"')

    // A later write makes the same note stale and the progress rule steers again.
    harness.git.status = ' M packages/engine/src/engine.ts\0 M docs/a.md\0'
    harness.git.diff = 'diff --git a/docs/a.md b/docs/a.md'
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).join('\n')).toContain('rule "task-progress"')
  })

  it('keeps the lane-boundary gate steering', async () => {
    const boundary = `# Tasks

## 1. Code (owns \`src/**\`)

- [ ] 1.1 First code

## 2. Docs (owns \`docs/a.md\`)

- [ ] 2.1 Write docs
`
    const { dir, harness } = await fixture(false)
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'tasks.md'),
      boundary,
      boundary.replace('- [ ] 1.1 First code', '- [x] 1.1 First code'),
    )
    await writeFile(
      join(dir, 'tasks.md'),
      boundary.replace('- [ ] 1.1 First code', '- [x] 1.1 First code'),
      'utf8',
    )
    await harness.turnStopping(1)
    const message = steerTexts(harness.agent).join('\n')
    expect(message).toContain('rule "lane-boundary"')
    expect(message).toContain('is complete')
  })

  it('reports an inert task-review rule as not steering', async () => {
    const { root } = await fixture(false)
    const none = new Harness({
      cwd: root,
      config: {
        ...defaultTestConfig(),
        gates: { workflowOwned: false },
        rules: [
          {
            id: 'spec-review',
            when: 'spec-ready',
            to: 'codex',
            contract: 'review',
            phase: 'spec',
            scope: 'whole',
            gate: 'none',
            instruction: 'bundled:review-spec',
          },
        ],
      },
      agents: providers(),
    })
    expect(none.provided.get('delegationRulesStatus')).toMatchObject({
      specReview: false,
      taskReview: false,
    })
    const empty = new Harness({
      cwd: root,
      config: { ...defaultTestConfig(), gates: { workflowOwned: false }, rules: [] },
      agents: providers(),
    })
    expect(empty.provided.get('delegationRulesStatus')).toMatchObject({ taskReview: false })
  })

  it('reports the real spec-review signal state for per-signal ownership', async () => {
    const without = await fixture(false)
    const noRule = new Harness({
      cwd: without.root,
      config: {
        ...defaultTestConfig(),
        rules: [
          {
            id: 'spec-review',
            when: 'spec-ready',
            to: 'codex',
            contract: 'review',
            phase: 'spec',
            scope: 'whole',
            gate: 'none',
            instruction: 'bundled:review-spec',
          },
        ],
        gates: { workflowOwned: false },
      },
      agents: providers(),
    })
    expect(noRule.provided.get('delegationRulesStatus')).toMatchObject({ specReview: false })
    expect(without.harness.provided.get('delegationRulesStatus')).toMatchObject({
      specReview: true,
    })
  })

  it('keeps the lane-assignment gate steering', async () => {
    const { dir, harness } = await fixture(false)
    await harness.preStep(1)
    await harness.writeResult(join(dir, 'tasks.md'), planUnchecked, plan)
    await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).join('\n')).toContain('lane assignment is missing')
  })

  it('toggles true -> false over existing records and notes without rewriting them', async () => {
    const disabled = await fixture(false)
    await writeFile(join(disabled.dir, 'tasks.md'), plan, 'utf8')
    const recordRun = runIdFrom(
      await disabled.harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task: taskIdFor('First task'),
      }),
    )
    await disabled.harness.waitForRun(recordRun)
    await disabled.harness.toolText('task_progress', {
      task: '2.1 Doc task',
      status: 'in-progress',
      reason: 'docs in progress',
    })
    const records = join(disabled.root, '.dsh', 'delegation')
    const before = await snapshotFiles(records)

    // The same workspace under the enabled switch: the archive guard refuses,
    // the existing records and notes are byte-identical, and the note still
    // satisfies the progress gate.
    const second = new Harness({
      cwd: disabled.root,
      config: configWith(true),
      agents: providers(),
    })
    const taskTwo = plan.replace('- [ ] 2.1 Doc task', '- [x] 2.1 Doc task')
    await writeFile(join(disabled.dir, 'tasks.md'), taskTwo, 'utf8')
    await writeFile(
      join(disabled.root, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    const denied = await second.preExecute('pwsh', { command: 'openspec archive change-a' })
    expect(denied.kind).toBe('deny')
    expect(await snapshotFiles(records)).toEqual(before)

    // Rollback: the disabled switch allows the archive and leaves the records.
    const third = new Harness({
      cwd: disabled.root,
      config: configWith(false),
      agents: providers(),
    })
    const allowed = await third.preExecute('pwsh', { command: 'openspec archive change-a' })
    expect(allowed.kind).toBe('allow')
    expect(await snapshotFiles(records)).toEqual(before)
  })
})

function providers(): FakeSubagents {
  const agents = new FakeSubagents()
  agents.addProvider('codex-subagent')
  return agents
}

describe('delegation.gates.workflowOwned: true', () => {
  it('restores the task-review and archive gates', async () => {
    const { root, dir, harness } = await fixture(true)
    await harness.preStep(1)
    await harness.writeResult(join(dir, 'tasks.md'), planUnchecked, plan)
    await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).join('\n')).toContain('requires its task-scoped review')

    await writeFile(
      join(root, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    const decision = await harness.preExecute('pwsh', {
      command: 'openspec archive change-a',
    })
    expect(decision.kind).toBe('deny')
    expect(decision.reason).toContain('archive refused')
  })
})
