import { readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import type { BundleConfig, GatesConfig } from '../src/index.js'
import {
  ALL_GATES,
  FakeReviewCompat,
  FakeSubagents,
  Harness,
  makeWorkspace,
  releaseAConfig,
  runIdFrom,
  steerTexts,
  taskIdFor,
  writeChange,
} from './helpers.js'

/**
 * Rollback from the exact shipped Release A configuration: every legacy switch
 * is off and the rules and target stay configured, so flipping one switch
 * restores that steer; the call the steer prints reaches the restored legacy
 * runtime, writes its state, and satisfies the gate again.
 */

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const IMPLEMENTATION_STATUS = ' M packages/engine/src/engine.ts\0'
const IMPLEMENTATION_DIFF =
  'diff --git a/packages/engine/src/engine.ts b/packages/engine/src/engine.ts'

const LANE_PLAN = `# Tasks

## 1. Engine (lane 1, owns \`packages/engine/**\`)

- [ ] 1.1 First task

## 2. Docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Doc task
`
const LANE_PLAN_TICKED = LANE_PLAN.replace('- [ ] 1.1 First task', '- [x] 1.1 First task')
const COMPLETE_PLAN = `# Tasks

- [ ] 1.1 First task
- [ ] 1.2 Second task
`
const COMPLETE_PLAN_DONE = COMPLETE_PLAN.replaceAll('- [ ]', '- [x]')

function providers(): FakeSubagents {
  const agents = new FakeSubagents()
  agents.addProvider('codex-subagent')
  return agents
}

function oneSwitchOn(signal: keyof GatesConfig): GatesConfig {
  return {
    workflowOwned: false,
    specReview: false,
    integrationReview: false,
    taskProgress: false,
    laneFanout: false,
    [signal]: true,
  }
}

function steer(harness: Harness): string {
  return steerTexts(harness.agent).join('\n')
}

async function workspaceWithPlan(plan: string) {
  const workspace = await makeWorkspace()
  cleanups.push(workspace.cleanup)
  const dir = await writeChange(workspace.root, 'change-a', [])
  await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
  return { root: workspace.root, dir }
}

/** One turn that ticks lane 1's task and records the spec change. */
async function tickLaneOne(root: string, dir: string, config: BundleConfig): Promise<void> {
  const harness = new Harness({ cwd: root, config, agents: providers() })
  await harness.preStep(1)
  harness.git.status = IMPLEMENTATION_STATUS
  harness.git.diff = IMPLEMENTATION_DIFF
  await harness.writeResult(
    join(dir, 'proposal.md'),
    '# Proposal\n\nWhy.\n',
    '# Proposal\n\nWhy changed.\n',
  )
  await harness.writeResult(join(dir, 'tasks.md'), LANE_PLAN, LANE_PLAN_TICKED)
  await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy changed.\n', 'utf8')
  await writeFile(join(dir, 'tasks.md'), LANE_PLAN_TICKED, 'utf8')
  await harness.turnStopping(1)
  expect(steer(harness)).toBe('')
}

/** One turn that completes the whole task list with every Release A switch off. */
async function completeWithEverySwitchOff(root: string, dir: string): Promise<void> {
  const harness = new Harness({ cwd: root, config: releaseAConfig(), agents: providers() })
  await harness.preStep(1)
  harness.git.status = IMPLEMENTATION_STATUS
  harness.git.diff = IMPLEMENTATION_DIFF
  await harness.writeResult(
    join(dir, 'proposal.md'),
    '# Proposal\n\nWhy.\n',
    '# Proposal\n\nWhy changed.\n',
  )
  await harness.writeResult(join(dir, 'tasks.md'), COMPLETE_PLAN, COMPLETE_PLAN_DONE)
  await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy changed.\n', 'utf8')
  await writeFile(join(dir, 'tasks.md'), COMPLETE_PLAN_DONE, 'utf8')
  await harness.turnStopping(1)
  expect(steer(harness)).toBe('')
}

describe('rollback from the shipped Release A configuration', () => {
  it('restores the whole-spec steer and satisfies it through the legacy record', async () => {
    const { root, dir } = await workspaceWithPlan(COMPLETE_PLAN)
    const off = new Harness({ cwd: root, config: releaseAConfig(), agents: providers() })
    await off.preStep(1)
    await off.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy changed.\n', 'utf8')
    await off.turnStopping(1)
    expect(steer(off)).toBe('')

    const on = new Harness({
      cwd: root,
      config: releaseAConfig({ gates: oneSwitchOn('specReview') }),
      agents: providers(),
    })
    await on.preStep(1)
    await on.turnStopping(1)
    const text = steer(on)
    expect(text).toContain('whole-spec review')
    expect(text).toContain('delegate(rule: "spec-review", change: "change-a")')
    expect(on.subagents.runs).toHaveLength(0)

    const run = runIdFrom(
      await on.toolText('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    expect(await on.waitForRun(run)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string }
    expect(record.verdict).toBe('PASS')

    on.agent.steer.mockClear()
    await on.turnStopping(1)
    expect(steer(on)).toBe('')
  })

  it('restores the task-review steer; its legacy PASS satisfies completion and archive', async () => {
    const { root, dir } = await workspaceWithPlan(COMPLETE_PLAN)
    await completeWithEverySwitchOff(root, dir)

    const on = new Harness({
      cwd: root,
      config: releaseAConfig({ gates: oneSwitchOn('workflowOwned') }),
      agents: providers(),
    })
    await on.preStep(1)
    await on.turnStopping(1)
    const text = steer(on)
    expect(text).toContain('requires its task-scoped review')
    expect(text).toContain('fully checked')
    expect(text).toContain('delegate(rule: "task-review", change: "change-a"')

    await writeFile(
      join(root, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    for (const task of ['First task', 'Second task']) {
      const taskId = taskIdFor(task)
      const run = runIdFrom(
        await on.toolText('delegate', { rule: 'task-review', change: 'change-a', task: taskId }),
      )
      expect(await on.waitForRun(run)).toContain('state=completed')
      const approval = JSON.parse(
        await readFile(
          join(root, 'openspec', 'changes', 'change-a', 'reviews', `${taskId}.json`),
          'utf8',
        ),
      ) as { verdict: string; taskId: string }
      expect(approval.verdict).toBe('PASS')
      expect(approval.taskId).toBe(taskId)
    }

    on.agent.steer.mockClear()
    await on.turnStopping(1)
    expect(steer(on)).toBe('')

    const archived = await on.preExecute('pwsh', { command: 'openspec archive change-a' })
    expect(archived.kind).toBe('allow')
    expect(archived.nextCalled).toBe(true)
  })

  it('restores the progress steer and its note satisfies the legacy gate', async () => {
    const { root, dir } = await workspaceWithPlan(LANE_PLAN)
    await tickLaneOne(root, dir, releaseAConfig())

    // Mixed ownership, converse: the progress signal is legacy and the lane
    // gate is native. The printed task_progress call writes the legacy note
    // path the native lane gate reads.
    const on = new Harness({
      cwd: root,
      config: releaseAConfig({ gates: oneSwitchOn('taskProgress') }),
      agents: providers(),
    })
    await on.preStep(1)
    on.git.status = IMPLEMENTATION_STATUS
    on.git.diff = IMPLEMENTATION_DIFF
    await on.turnStopping(1)
    const text = steer(on)
    expect(text).toContain('changed implementation files in change "change-a"')
    expect(text).toContain('task_progress(task: "2.1 Doc task"')
    expect(text).not.toContain('lane assignment is missing')

    await on.toolText('task_progress', {
      task: '2.1 Doc task',
      status: 'in-progress',
      reason: 'docs stay serial',
    })
    const note = JSON.parse(
      await readFile(join(root, '.dsh', 'delegation', 'task-progress', 'change-a.json'), 'utf8'),
    ) as { taskId: string; status: string; worktreeDigest: string; reason: string }
    expect(note.taskId).toBe(taskIdFor('Doc task'))
    expect(note.status).toBe('in-progress')
    expect(note.reason).toBe('docs stay serial')
    expect(note.worktreeDigest).toMatch(/^[0-9a-f]{64}$/u)

    on.agent.steer.mockClear()
    await on.turnStopping(1)
    expect(steer(on)).toBe('')
  })

  it('restores the integration steer and satisfies it through the legacy record', async () => {
    const { root, dir } = await workspaceWithPlan(COMPLETE_PLAN)
    await completeWithEverySwitchOff(root, dir)

    const on = new Harness({
      cwd: root,
      config: releaseAConfig({ gates: oneSwitchOn('integrationReview') }),
      agents: providers(),
    })
    await on.preStep(1)
    on.git.status = IMPLEMENTATION_STATUS
    on.git.diff = IMPLEMENTATION_DIFF
    await on.turnStopping(1)
    const text = steer(on)
    expect(text).toContain('integration review of change "change-a"')
    expect(text).toContain('delegate(rule: "integration-review", change: "change-a")')

    const run = runIdFrom(
      await on.toolText('delegate', { rule: 'integration-review', change: 'change-a' }),
    )
    expect(await on.waitForRun(run)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'integration-review', 'change-a', 'integration.json'),
        'utf8',
      ),
    ) as { verdict: string }
    expect(record.verdict).toBe('PASS')

    on.agent.steer.mockClear()
    await on.turnStopping(1)
    expect(steer(on)).toBe('')
  })

  it('restores the lane-assignment steer and its serial note decides the lane', async () => {
    const { root, dir } = await workspaceWithPlan(LANE_PLAN)
    await tickLaneOne(root, dir, releaseAConfig())

    const on = new Harness({
      cwd: root,
      config: releaseAConfig({ gates: oneSwitchOn('laneFanout') }),
      agents: providers(),
    })
    await on.preStep(1)
    on.git.status = IMPLEMENTATION_STATUS
    on.git.diff = IMPLEMENTATION_DIFF
    await on.turnStopping(1)
    const text = steer(on)
    expect(text).toContain('lane assignment is missing')
    expect(text).toContain('task_progress(task: "2.1 Doc task"')

    // No compat service: the printed serial alternative reaches the legacy note
    // path and decides the lane in the legacy lane state.
    await on.toolText('task_progress', {
      task: '2.1 Doc task',
      status: 'in-progress',
      reason: 'serial lane',
    })
    on.agent.steer.mockClear()
    await on.turnStopping(1)
    expect(steer(on)).toBe('')
  })

  it('satisfies a legacy lane gate from a progress-owned serial note', async () => {
    const { root, dir } = await workspaceWithPlan(LANE_PLAN)
    await tickLaneOne(root, dir, releaseAConfig())

    // Mixed ownership: the progress signal is owned by the workflow and the
    // lane gate is legacy. The note's returned lane decides the legacy lane.
    const compat = new FakeReviewCompat()
    compat.lane = '2. Docs (lane 2, owns `docs/**`)'
    const on = new Harness({
      cwd: root,
      config: releaseAConfig({
        gates: {
          ...ALL_GATES,
          workflowOwned: false,
          specReview: false,
          integrationReview: false,
          taskProgress: false,
          laneFanout: true,
        },
      }),
      agents: providers(),
      services: { workflowsReviewCompat: compat },
    })
    await on.preStep(1)
    on.git.status = IMPLEMENTATION_STATUS
    on.git.diff = IMPLEMENTATION_DIFF
    await on.turnStopping(1)
    expect(steer(on)).toContain('lane assignment is missing')

    await on.toolText('task_progress', {
      task: '2.1 Doc task',
      status: 'in-progress',
      reason: 'serial lane',
    })
    expect(compat.noteCalls).toEqual([
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'serial lane' },
    ])
    await expect(
      readFile(join(root, '.dsh', 'delegation', 'task-progress', 'change-a.json'), 'utf8'),
    ).rejects.toThrow()

    on.agent.steer.mockClear()
    await on.turnStopping(1)
    expect(steer(on)).toBe('')
  })

  it('reads a native PASS for the final task when only the progress switch is on', async () => {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    const taskId = taskIdFor('First task')
    const dir = await writeChange(workspace.root, 'change-a', [
      { number: '1.1', text: 'First task' },
    ])
    const gates: GatesConfig = {
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: true,
      laneFanout: false,
    }
    const nativePath = join(
      workspace.root,
      '.dsh',
      'workflows',
      'records',
      'task-review',
      'change-a',
      'tasks',
      `${taskId}.json`,
    )
    await mkdir(join(nativePath, '..'), { recursive: true })
    await writeFile(
      nativePath,
      JSON.stringify({
        definition: 'task-review',
        rule: 'task-review',
        change: 'change-a',
        phase: 'task',
        scope: 'task',
        taskId,
        digest: 'a'.repeat(64),
        worktreeDigest: 'b'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent', id: 'codex' },
        time: '2026-11-14T10:00:00.000Z',
      }),
      'utf8',
    )

    const harness = new Harness({
      cwd: workspace.root,
      config: releaseAConfig({ gates }),
      agents: providers(),
    })
    await harness.preStep(1)
    harness.git.status = IMPLEMENTATION_STATUS
    harness.git.diff = IMPLEMENTATION_DIFF
    const before = '# Tasks\n\n- [ ] 1.1 First task\n'
    const after = '# Tasks\n\n- [x] 1.1 First task\n'
    await harness.writeResult(join(dir, 'tasks.md'), before, after)
    await writeFile(join(dir, 'tasks.md'), after, 'utf8')
    await harness.turnStopping(1)
    expect(steer(harness)).toBe('')

    // Without the native record the same final tick needs its note.
    await rm(nativePath)
    harness.agent.steer.mockClear()
    await harness.turnStopping(1)
    expect(steer(harness)).toContain('changed implementation files in change "change-a"')

    // A malformed native record does not satisfy the gate either.
    await writeFile(
      nativePath,
      JSON.stringify({
        rule: 'task-review',
        change: 'change-a',
        phase: 'task',
        scope: 'task',
        taskId,
        verdict: 'PASS',
      }),
      'utf8',
    )
    harness.agent.steer.mockClear()
    await harness.turnStopping(1)
    expect(steer(harness)).toContain('changed implementation files in change "change-a"')

    // A record from another reviewer does not satisfy it.
    await mkdir(join(workspace.root, 'openspec'), { recursive: true })
    await writeFile(
      join(workspace.root, 'openspec', 'review-approval.json'),
      JSON.stringify({
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        reviewerProvider: 'other',
      }),
      'utf8',
    )
    await writeFile(
      nativePath,
      JSON.stringify({
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
    harness.agent.steer.mockClear()
    await harness.turnStopping(1)
    expect(steer(harness)).toContain('changed implementation files in change "change-a"')
  })

  it('keeps only the native integration review acting with every switch off', async () => {
    const { root, dir } = await workspaceWithPlan(COMPLETE_PLAN)
    await completeWithEverySwitchOff(root, dir)

    const compat = new FakeReviewCompat()
    const on = new Harness({
      cwd: root,
      config: releaseAConfig(),
      agents: providers(),
      services: { workflowsReviewCompat: compat },
    })
    await on.preStep(1)
    await on.turnStopping(1)
    expect(steer(on)).toBe('')

    await on.toolText('delegate', { rule: 'integration-review', change: 'change-a' })
    expect(compat.delegateCalls).toEqual([{ rule: 'integration-review', change: 'change-a' }])
    await expect(
      readFile(
        join(root, '.dsh', 'delegation', 'integration-review', 'change-a', 'integration.json'),
        'utf8',
      ),
    ).rejects.toThrow()
  })
})

describe('deprecated alias status', () => {
  const DEPRECATION = /delegation_status is deprecated; use the workflows tool/gu

  it('prints the deprecation line exactly once with the workflows status', async () => {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    const compat = new FakeReviewCompat()
    const harness = new Harness({
      cwd: workspace.root,
      config: releaseAConfig(),
      agents: providers(),
      services: { workflowsReviewCompat: compat },
    })
    const text = await harness.toolText('delegation_status', {})
    expect(text).toContain(compat.statusText)
    expect(text.match(DEPRECATION)).toHaveLength(1)

    compat.statusText = `Workflows status.\n\ndelegation_status is deprecated; use the workflows tool`
    const repeated = await harness.toolText('delegation_status', {})
    expect(repeated.match(DEPRECATION)).toHaveLength(1)
  })

  it('keeps the legacy status text without a compat service and without the deprecation line', async () => {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    await writeChange(workspace.root, 'change-a', [])
    const harness = new Harness({
      cwd: workspace.root,
      config: releaseAConfig(),
      agents: providers(),
    })
    const text = await harness.toolText('delegation_status', {})
    expect(text).toContain('Delegation status')
    expect(text).not.toMatch(DEPRECATION)
  })

  it('matches the composed setup row to the Release A fixture', async () => {
    const root = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..')
    const patch = parse(
      readFileSync(join(root, 'packages', 'setup', 'cordis.patch.yml'), 'utf8'),
    ) as Array<
      | { insert?: Array<{ id?: string; config?: Record<string, unknown> }> }
      | { id?: string; config?: Record<string, unknown> }
    >
    const rows = patch.flatMap((entry) => ('insert' in entry ? (entry.insert ?? []) : [entry]))
    const row = rows
      .filter((entry) => entry.id === 'dsh-setup-delegation-rules' && entry.config !== undefined)
      .at(-1)
    const config = releaseAConfig()
    expect(row?.config?.gates).toEqual(config.gates)
    const composedCodex = (row?.config as { targets?: { codex?: { provider?: string } } }).targets
      ?.codex
    expect(composedCodex?.provider).toBe(config.targets.codex.provider)
    // The fixture must carry at least one rule for every composed trigger so a
    // flip has a restored steer to print.
    const triggers = (config.rules ?? []).map((rule) => rule.when)
    for (const rule of row?.config?.rules ?? []) expect(triggers).toContain(rule.when)
  })
})
