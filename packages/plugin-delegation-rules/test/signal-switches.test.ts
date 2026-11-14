import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type BundleConfig,
  type GatesConfig,
  resolveLegacySignals,
  validateConfig,
} from '../src/index.js'
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
 * The five per-signal legacy switches: each false value stops exactly its own
 * steer, the remaining signals keep acting, and the workflow-owned review
 * signal's progress evidence is read from the native record store.
 */

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

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
const IMPLEMENTATION_STATUS = ' M packages/engine/src/engine.ts\0'
const IMPLEMENTATION_DIFF =
  'diff --git a/packages/engine/src/engine.ts b/packages/engine/src/engine.ts'

/** Every switch on except the named one. */
function withOff(off: keyof GatesConfig): GatesConfig {
  return { ...ALL_GATES, [off]: false }
}

function providers(): FakeSubagents {
  const agents = new FakeSubagents()
  agents.addProvider('codex-subagent')
  return agents
}

/** An implementation turn: spec changed, one task ticked, files written, two lanes. */
async function implementationTurn(config: BundleConfig) {
  const workspace = await makeWorkspace()
  cleanups.push(workspace.cleanup)
  const dir = await writeChange(workspace.root, 'change-a', [])
  await writeFile(join(dir, 'tasks.md'), LANE_PLAN, 'utf8')
  const harness = new Harness({ cwd: workspace.root, config, agents: providers() })
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
  return { root: workspace.root, dir, harness }
}

/** A turn that completes the whole task list: integration review and completion both apply. */
async function completeTurn(config: BundleConfig) {
  const workspace = await makeWorkspace()
  cleanups.push(workspace.cleanup)
  const dir = await writeChange(workspace.root, 'change-a', [])
  await writeFile(join(dir, 'tasks.md'), COMPLETE_PLAN, 'utf8')
  const harness = new Harness({ cwd: workspace.root, config, agents: providers() })
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
  return { root: workspace.root, dir, harness }
}

function steer(harness: Harness): string {
  return steerTexts(harness.agent).join('\n')
}

describe('each false switch disables exactly its own steer', () => {
  const cases: Array<[keyof GatesConfig, string]> = [
    ['workflowOwned', 'requires its task-scoped review'],
    ['specReview', 'whole-spec review'],
    ['taskProgress', 'changed implementation files in change'],
    ['laneFanout', 'lane assignment is missing'],
  ]

  it('keeps every other steer active per switch', async () => {
    for (const [off, marker] of cases) {
      const { harness } = await implementationTurn(releaseAConfig({ gates: withOff(off) }))
      await harness.turnStopping(1)
      const text = steer(harness)
      expect(text, off).not.toContain(marker)
      for (const [other, otherMarker] of cases) {
        if (other === off) continue
        expect(text, `${off} keeps ${other}`).toContain(otherMarker)
      }
    }
  })

  it('disables only the integration steer', async () => {
    const enabled = await completeTurn(releaseAConfig({ gates: { ...ALL_GATES } }))
    await enabled.harness.turnStopping(1)
    const enabledText = steer(enabled.harness)
    expect(enabledText).toContain('integration review of change "change-a"')
    expect(enabledText).toContain('whole-spec review')
    expect(enabledText).toContain('requires its task-scoped review')
    expect(enabledText).toContain('changed implementation files in change')

    const disabled = await completeTurn(releaseAConfig({ gates: withOff('integrationReview') }))
    await disabled.harness.turnStopping(1)
    const disabledText = steer(disabled.harness)
    expect(disabledText).not.toContain('integration review of change "change-a"')
    expect(disabledText).toContain('whole-spec review')
    expect(disabledText).toContain('requires its task-scoped review')
    expect(disabledText).toContain('changed implementation files in change')
  })
})

describe('the active review owner supplies the progress evidence', () => {
  const gates: GatesConfig = {
    workflowOwned: false,
    specReview: false,
    integrationReview: false,
    taskProgress: true,
    laneFanout: false,
  }

  function nativeRecord(
    taskId: string,
    verdict: 'PASS' | 'ERROR' = 'PASS',
  ): Record<string, unknown> {
    return {
      definition: 'task-review',
      rule: 'task-review',
      change: 'change-a',
      scope: 'task',
      taskId,
      digest: 'a'.repeat(64),
      worktreeDigest: 'b'.repeat(64),
      verdict,
      findings: [],
      target: { provider: 'codex-subagent', id: 'codex' },
      time: '2026-11-14T10:00:00.000Z',
    }
  }

  function legacyRecord(taskId: string): Record<string, unknown> {
    return {
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
    }
  }

  async function fixture() {
    const turn = await implementationTurn(releaseAConfig({ gates }))
    const taskId = taskIdFor('First task')
    const nativePath = join(
      turn.root,
      '.dsh',
      'workflows',
      'records',
      'task-review',
      'change-a',
      'tasks',
      `${taskId}.json`,
    )
    const legacyPath = join(
      turn.root,
      '.dsh',
      'delegation',
      'task-review',
      'change-a',
      'tasks',
      `${taskId}.json`,
    )
    await mkdir(join(turn.root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks'), {
      recursive: true,
    })
    return { ...turn, taskId, nativePath, legacyPath }
  }

  it('reads only the native store while the workflow owns the review signal', async () => {
    const { harness, taskId, nativePath, legacyPath } = await fixture()
    // A legacy record is the old owner's evidence and must not satisfy the close.
    await writeFile(legacyPath, JSON.stringify(legacyRecord(taskId)), 'utf8')
    await harness.turnStopping(1)
    expect(steer(harness)).toContain('changed implementation files in change')

    // The native executor's record does satisfy it, with no progress note.
    await mkdir(join(nativePath, '..'), { recursive: true })
    await writeFile(nativePath, JSON.stringify(nativeRecord(taskId)), 'utf8')
    harness.agent.steer.mockClear()
    await harness.turnStopping(1)
    expect(steer(harness)).not.toContain('changed implementation files in change')

    // Removing it makes the same close need a note again.
    await rm(nativePath)
    harness.agent.steer.mockClear()
    await harness.turnStopping(1)
    expect(steer(harness)).toContain('changed implementation files in change')
  })
})

describe('per-signal ownership resolution', () => {
  it('resolves a signal only when its switch is on and a covering rule is configured', () => {
    const allOn = validateConfig(releaseAConfig({ gates: { ...ALL_GATES } }))
    expect(resolveLegacySignals(allOn)).toEqual(ALL_GATES)

    const allOff = validateConfig(releaseAConfig())
    expect(resolveLegacySignals(allOff)).toEqual({
      ...ALL_GATES,
      workflowOwned: false,
      specReview: false,
      integrationReview: false,
      taskProgress: false,
      laneFanout: false,
    })

    for (const signal of [
      'specReview',
      'integrationReview',
      'taskProgress',
      'laneFanout',
    ] as const) {
      const enabled = validateConfig(releaseAConfig({ gates: { ...ALL_GATES } }))
      expect(resolveLegacySignals(enabled)[signal], `${signal} enabled`).toBe(true)
      const disabled = validateConfig(releaseAConfig({ gates: withOff(signal) }))
      expect(resolveLegacySignals(disabled)[signal], `${signal} disabled`).toBe(false)
      const uncovered = validateConfig({ gates: { ...ALL_GATES } })
      expect(resolveLegacySignals(uncovered)[signal], `${signal} without a rule`).toBe(false)
    }
    // workflowOwned keeps the switch value; taskReview reports the configured rule.
    expect(resolveLegacySignals(validateConfig({ gates: { ...ALL_GATES } })).workflowOwned).toBe(
      true,
    )
    expect(resolveLegacySignals(validateConfig(releaseAConfig())).workflowOwned).toBe(false)
  })

  it('publishes the split-state input for every signal in both directions', async () => {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    // A switch-on signal with a covering rule steers, so the workflow loader
    // refuses `own`; switch off (or no covering rule) resolves disabled, so it
    // refuses `defer` instead and the shipped definition stays own.
    for (const signal of [
      'specReview',
      'integrationReview',
      'taskProgress',
      'laneFanout',
    ] as const) {
      const enabled = new Harness({
        cwd: workspace.root,
        config: releaseAConfig({ gates: { ...ALL_GATES } }),
        agents: providers(),
      })
      expect(enabled.provided.get('delegationRulesStatus'), `${signal} enabled`).toMatchObject({
        [signal]: true,
      })
      const disabled = new Harness({
        cwd: workspace.root,
        config: releaseAConfig({ gates: withOff(signal) }),
        agents: providers(),
      })
      expect(disabled.provided.get('delegationRulesStatus'), `${signal} disabled`).toMatchObject({
        [signal]: false,
      })
      const uncovered = new Harness({
        cwd: workspace.root,
        config: { gates: { ...ALL_GATES } },
        agents: providers(),
      })
      expect(
        uncovered.provided.get('delegationRulesStatus'),
        `${signal} without a covering rule`,
      ).toMatchObject({ [signal]: false })
    }
    const taskEnabled = new Harness({
      cwd: workspace.root,
      config: releaseAConfig({ gates: { ...ALL_GATES } }),
      agents: providers(),
    })
    expect(taskEnabled.provided.get('delegationRulesStatus')).toMatchObject({
      workflowOwned: true,
      taskReview: true,
    })
    const taskDisabled = new Harness({
      cwd: workspace.root,
      config: releaseAConfig(),
      agents: providers(),
    })
    expect(taskDisabled.provided.get('delegationRulesStatus')).toMatchObject({
      workflowOwned: false,
      taskReview: true,
    })
    const taskUncovered = new Harness({
      cwd: workspace.root,
      config: { gates: { ...ALL_GATES } },
      agents: providers(),
    })
    expect(taskUncovered.provided.get('delegationRulesStatus')).toMatchObject({
      workflowOwned: true,
      taskReview: false,
    })
  })
})

describe('a split state has exactly one runtime per signal', () => {
  function node(): FakeReviewCompat {
    return new FakeReviewCompat()
  }

  const reviewRules: Array<[string, keyof GatesConfig]> = [
    ['spec-review', 'specReview'],
    ['task-review', 'workflowOwned'],
    ['integration-review', 'integrationReview'],
  ]

  it('routes each review rule to the workflows runtime while its signal is owned', async () => {
    for (const [rule, signal] of reviewRules) {
      const workspace = await makeWorkspace()
      cleanups.push(workspace.cleanup)
      const dir = await writeChange(workspace.root, 'change-a', [
        { number: '1.1', text: 'First task', checked: true },
      ])
      await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n', 'utf8')
      const compat = node()
      const harness = new Harness({
        cwd: workspace.root,
        config: releaseAConfig({ gates: { ...ALL_GATES, [signal]: false } }),
        agents: providers(),
        services: { workflowsReviewCompat: compat },
      })
      const text = await harness.toolText('delegate', { rule, change: 'change-a' })
      expect(text, rule).toContain('workflow definition run started')
      expect(compat.delegateCalls, rule).toEqual([{ rule, change: 'change-a' }])
      expect(harness.subagents.runs, rule).toHaveLength(0)
    }
  })

  it('keeps the legacy runtime while each signal is enabled', async () => {
    for (const [rule, signal] of reviewRules) {
      const workspace = await makeWorkspace()
      cleanups.push(workspace.cleanup)
      const dir = await writeChange(workspace.root, 'change-a', [
        { number: '1.1', text: 'First task', checked: true },
      ])
      await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n', 'utf8')
      const compat = node()
      const harness = new Harness({
        cwd: workspace.root,
        config: releaseAConfig({ gates: { ...ALL_GATES, [signal]: true } }),
        agents: providers(),
        services: { workflowsReviewCompat: compat },
      })
      const run = runIdFrom(await harness.toolText('delegate', { rule, change: 'change-a' }))
      expect(await harness.waitForRun(run)).toContain('state=completed')
      expect(compat.delegateCalls, rule).toHaveLength(0)
      expect(harness.subagents.runs.length, rule).toBeGreaterThan(0)
    }
  })

  it('routes the progress note to the progress owner only', async () => {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    const dir = await writeChange(workspace.root, 'change-a', [{ number: '2.1', text: 'Doc task' }])
    await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [ ] 2.1 Doc task\n', 'utf8')
    const compat = node()
    const owned = new Harness({
      cwd: workspace.root,
      config: releaseAConfig({ gates: { ...withOff('taskProgress'), laneFanout: true } }),
      agents: providers(),
      services: { workflowsReviewCompat: compat },
    })
    const output = await owned.toolText('task_progress', {
      task: '2.1 Doc task',
      status: 'in-progress',
      reason: 'docs',
    })
    expect(output).toContain('workflow note written')
    expect(compat.noteCalls).toEqual([
      { change: 'change-a', task: '2.1 Doc task', status: 'in-progress', reason: 'docs' },
    ])
    await expect(
      readFile(
        join(workspace.root, '.dsh', 'delegation', 'task-progress', 'change-a.json'),
        'utf8',
      ),
    ).rejects.toThrow()

    const legacy = new Harness({
      cwd: workspace.root,
      config: releaseAConfig({ gates: { ...withOff('laneFanout'), taskProgress: true } }),
      agents: providers(),
      services: { workflowsReviewCompat: compat },
    })
    await legacy.toolText('task_progress', {
      task: '2.1 Doc task',
      status: 'in-progress',
      reason: 'docs again',
    })
    expect(compat.noteCalls).toHaveLength(1)
    const note = JSON.parse(
      await readFile(
        join(workspace.root, '.dsh', 'delegation', 'task-progress', 'change-a.json'),
        'utf8',
      ),
    ) as { taskId: string }
    expect(note.taskId).toBe(taskIdFor('Doc task'))
  })
})
