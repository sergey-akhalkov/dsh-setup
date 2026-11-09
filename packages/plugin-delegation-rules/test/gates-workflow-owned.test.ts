import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
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
    ],
  })
}

const planUnchecked = plan.replace('- [x] 1.1 First task', '- [ ] 1.1 First task')

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

describe('delegation.gates.workflowOwned: false', () => {
  it('stops the task-review and archive gates but keeps the spec-review rule', async () => {
    const { root, dir, harness } = await fixture(false)
    expect(harness.provided.get('delegationRulesStatus')).toEqual({ workflowOwned: false })
    await mkdir(join(root, 'src'), { recursive: true })
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy changed.\n', 'utf8')
    await harness.turnStopping(1)
    const steer = steerTexts(harness.agent).join('\n')
    expect(steer).toContain('whole-spec review')
    expect(steer).not.toContain('requires its task-scoped review')
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

  it('keeps the task-progress gate steering and the switch silent on archive', async () => {
    const { root, dir, harness } = await fixture(false)
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    harness.git.status = ' M packages/engine/src/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine/src/engine.ts b/packages/engine/src/engine.ts'
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).join('\n')).toContain('changed implementation files')

    // The approval marker opts in, but this switch means the legacy guard is off.
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

  it('keeps the lane-assignment gate steering', async () => {
    const { dir, harness } = await fixture(false)
    await harness.preStep(1)
    await harness.writeResult(join(dir, 'tasks.md'), planUnchecked, plan)
    await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).join('\n')).toContain('lane assignment is missing')
  })
})

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
