import { readFileSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type BundleConfigLike,
  createAgent,
  type FakeAgent,
  FakeSubagents,
  Harness,
  makeWorkspace,
  passResponder,
  runIdFrom,
  steerTexts,
  taskIdFor,
  writeChange,
} from './helpers.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const cleanups: Array<() => Promise<void>> = []

async function workspace(): Promise<string> {
  const created = await makeWorkspace()
  cleanups.push(created.cleanup)
  return created.root
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const codexTargets = {
  codex: { provider: 'codex-subagent' },
  'codex-write': { provider: 'codex-subagent-write', write: true },
}

function specOnly(gate: 'strict' | 'soft' | 'none' = 'strict'): BundleConfigLike {
  return {
    targets: codexTargets,
    rules: [
      {
        id: 'spec-review',
        when: 'spec-ready',
        to: 'codex',
        contract: 'review',
        phase: 'spec',
        scope: 'whole',
        gate,
        instruction: 'bundled:review-spec',
      },
    ],
  }
}

function taskOnly(): BundleConfigLike {
  return {
    targets: codexTargets,
    rules: [
      {
        id: 'task-review',
        when: 'spec-task-ready',
        to: 'codex',
        contract: 'review',
        scope: 'task',
        gate: 'strict',
        instruction: 'bundled:review-task',
      },
    ],
  }
}

function workOnly(): BundleConfigLike {
  return {
    targets: codexTargets,
    rules: [{ id: 'task-progress', when: 'implementation-work', contract: 'note', gate: 'strict' }],
  }
}

function workAndReview(): BundleConfigLike {
  return {
    targets: codexTargets,
    rules: [...(taskOnly().rules ?? []), ...(workOnly().rules ?? [])],
  }
}

function integrationOnly(gate: 'strict' | 'soft' | 'none'): BundleConfigLike {
  return {
    targets: codexTargets,
    rules: [
      {
        id: 'integration-review',
        when: 'implementation-complete',
        to: 'codex',
        contract: 'review',
        phase: 'integration',
        scope: 'whole',
        gate,
        instruction: 'bundled:review-integration',
      },
    ],
  }
}

function registered(): FakeSubagents {
  const subagents = new FakeSubagents()
  subagents.addProvider('codex-subagent', { agentOptions: false })
  subagents.addProvider('codex-subagent-write', { agentOptions: false })
  return subagents
}

function harnessFor(root: string, config: BundleConfigLike, subagents = registered()): Harness {
  return new Harness({ cwd: root, config, agents: subagents })
}

function combinedSteers(agent: FakeAgent): string {
  return steerTexts(agent).join('\n\n')
}

describe('strict whole-spec gate', () => {
  it('refuses a close, steers with rule/digest/record/call, and allows it after PASS', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const subagents = registered()
    const harness = harnessFor(root, specOnly(), subagents)
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    await harness.turnStopping(1)
    const first = combinedSteers(harness.agent)
    expect(first).toContain('rule "spec-review"')
    expect(first).toContain('record at .dsh/delegation/spec-review/change-a/spec.json')
    expect(first).toContain('Run: delegate(rule: "spec-review", change: "change-a")')
    expect(first).toMatch(/spec digest [0-9a-f]{12}/)
    expect(subagents.startCalls).toBe(0)

    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    await harness.waitForRun(run)
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(1)
  })

  it('accepts a matching ERROR record with the failure visible', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const subagents = registered()
    subagents.respond = () => ({
      output: [],
      stopReason: 'error',
      diagnostic: 'target unavailable',
    })
    const harness = harnessFor(root, specOnly(), subagents)
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=failed')
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('points a pending review at its run instead of starting another', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const subagents = registered()
    const releases: Array<() => void> = []
    subagents.respond = (run) =>
      new Promise((resolve) => {
        releases.push(() => resolve(passResponder(run)))
      })
    const harness = harnessFor(root, specOnly(), subagents)
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    const run = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    await harness.turnStopping(1)
    const message = combinedSteers(harness.agent)
    expect(message).toContain(`review run ${run} is running`)
    expect(message).toContain(`delegation_status (run ${run})`)
    expect(message).not.toContain('Run: delegate(rule: "spec-review"')
    expect(steerTexts(harness.agent)).toHaveLength(1)

    releases.shift()?.()
    await harness.waitForRun(run)
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(1)
  })

  it('ignores a stale whole-spec record', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, specOnly())
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    await harness.waitForRun(run)
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'specs', 'capability', 'spec.md'),
      '# Changed\n',
    )
    await harness.turnStopping(1)
    expect(combinedSteers(harness.agent)).toContain('is stale')
  })

  it('evaluates every involved change and ignores archived changes', async () => {
    const root = await workspace()
    const dirA = await writeChange(root, 'change-a', [])
    const dirB = await writeChange(root, 'change-b', [])
    await mkdir(join(root, 'openspec', 'changes', 'archive', 'old-change'), { recursive: true })
    const harness = harnessFor(root, specOnly())
    await harness.preStep(1)
    for (const dir of [dirA, dirB]) {
      await harness.writeResult(
        join(dir, 'proposal.md'),
        '# Proposal\n\nWhy.\n',
        '# Proposal\n\nWhy changed.\n',
      )
    }
    await harness.turnStopping(1)
    const message = combinedSteers(harness.agent)
    expect(message).toContain('change "change-a"')
    expect(message).toContain('change "change-b"')
    expect(message).not.toContain('old-change')
  })

  it('finds the OpenSpec root from a nested working directory', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const nested = join(root, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const harness = new Harness({ cwd: nested, config: specOnly(), agents: registered() })
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    await harness.turnStopping(1)
    expect(combinedSteers(harness.agent)).toContain('change "change-a"')
  })

  it('has no requirement without an OpenSpec root', async () => {
    const root = await workspace()
    const harness = harnessFor(root, specOnly())
    await harness.preStep(1)
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('turns a git failure into an issue instead of throwing', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, specOnly())
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    harness.git.fail = true
    await expect(harness.turnStopping(1)).resolves.toBeUndefined()
    expect(combinedSteers(harness.agent)).toContain('could not be computed')
  })
})

describe('task review gate', () => {
  it('requires a record for every checked task and finds unresolved findings', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const subagents = registered()
    const harness = harnessFor(root, taskOnly(), subagents)
    await harness.preStep(1)
    const checked = '# Tasks\n\n- [x] 1.1 First task\n'
    await harness.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 First task\n',
      checked,
      harness.agent,
      'edit',
    )
    await writeFile(join(dir, 'tasks.md'), checked)
    await harness.turnStopping(1)
    expect(combinedSteers(harness.agent)).toContain('checked task "1.1 First task"')
    expect(combinedSteers(harness.agent)).toContain('requires its task-scoped review')

    subagents.respond = (run) => {
      const digest = /- Digest: ([0-9a-f]{64})/.exec(run.prompt)?.[1] ?? '0'.repeat(64)
      return {
        output: [
          {
            type: 'text',
            text: `\`\`\`json\n${JSON.stringify({ digest, verdict: 'FINDINGS', findings: [{ severity: 'P1', title: 'gap', evidence: 'x', fix: 'y' }] })}\n\`\`\``,
          },
        ],
        stopReason: 'completed',
      }
    }
    const findingsRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    await harness.waitForRun(findingsRun)
    await harness.turnStopping(1)
    expect(combinedSteers(harness.agent)).toContain('unresolved findings')
  })

  it('keeps a task PASS historical after a later worktree change', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    const checked = '# Tasks\n\n- [x] 1.1 First task\n'
    await harness.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 First task\n',
      checked,
      harness.agent,
      'edit',
    )
    await writeFile(join(dir, 'tasks.md'), checked)
    const taskRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    await harness.waitForRun(taskRun)
    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine.ts b/packages/engine.ts'
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })
})

describe('implementation-work gate', () => {
  it('steers when a code-changing turn has neither a ticked-and-reviewed task nor a note', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const harness = harnessFor(root, workOnly())
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'M engine'
    await harness.turnStopping(1)
    const message = combinedSteers(harness.agent)
    expect(message).toContain('changed implementation files')
    expect(message).toContain('task_progress(task: "1.1 First task"')
  })

  it('allows a ticked-and-reviewed task and a matching progress note', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const harness = harnessFor(root, workAndReview())
    await harness.preStep(1)
    const checked = '# Tasks\n\n- [x] 1.1 First task\n'
    await harness.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 First task\n',
      checked,
      harness.agent,
      'edit',
    )
    await writeFile(join(dir, 'tasks.md'), checked)
    const tickRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    await harness.waitForRun(tickRun)
    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'M engine'
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)

    const root2 = await workspace()
    await writeChange(root2, 'change-b', [{ number: '2.1', text: 'Second task' }])
    const harness2 = harnessFor(root2, workOnly())
    await harness2.preStep(1)
    harness2.git.status = ' M packages/engine.ts\0'
    harness2.git.diff = 'M engine'
    await harness2.callTool('task_progress', {
      task: '2.1 Second task',
      status: 'in-progress',
      reason: 'midway',
    })
    await harness2.turnStopping(1)
    expect(steerTexts(harness2.agent)).toHaveLength(0)
  })

  it('does not require a tick for a docs-only turn and makes a note stale after worktree changes', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const harness = harnessFor(root, workOnly())
    await harness.preStep(1)
    harness.git.status = ' M docs/guide.md\0'
    harness.git.diff = 'M docs'
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)

    harness.git.status = ' M packages/engine.ts\0'
    await harness.callTool('task_progress', {
      task: '1.1 First task',
      status: 'in-progress',
      reason: 'midway',
    })
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
    harness.git.diff = 'M engine again'
    await harness.turnStopping(1)
    expect(combinedSteers(harness.agent)).toContain('changed implementation files')
  })

  it('refuses a checked task without a review even when a note exists', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [
      { number: '1.1', text: 'Finished task' },
      { number: '1.2', text: 'Open task' },
    ])
    const harness = harnessFor(root, workAndReview())
    await harness.preStep(1)
    const after = '# Tasks\n\n- [x] 1.1 Finished task\n- [ ] 1.2 Open task\n'
    await harness.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 Finished task\n- [ ] 1.2 Open task\n',
      after,
      harness.agent,
      'edit',
    )
    await writeFile(join(dir, 'tasks.md'), after)
    await harness.callTool('task_progress', {
      task: '1.2 Open task',
      status: 'in-progress',
      reason: 'midway',
    })
    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'M engine'
    await harness.turnStopping(1)
    const message = combinedSteers(harness.agent)
    expect(message).toContain('checked task "1.1 Finished task"')
    expect(message).toContain('requires its task-scoped review')
  })
})

describe('integration review gate', () => {
  async function completeTask(root: string, harness: Harness): Promise<void> {
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'Done' }])
    const checked = '# Tasks\n\n- [x] 1.1 Done\n'
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 Done\n',
      checked,
      harness.agent,
      'edit',
    )
    await writeFile(join(dir, 'tasks.md'), checked)
  }

  it('steers once for a soft rule, never for none, and repeatedly for strict', async () => {
    const softRoot = await workspace()
    const soft = harnessFor(softRoot, integrationOnly('soft'))
    await completeTask(softRoot, soft)
    await soft.turnStopping(1)
    expect(combinedSteers(soft.agent)).toContain('Soft hint')
    expect(combinedSteers(soft.agent)).toContain('integration review')
    const afterFirst = steerTexts(soft.agent).length
    await soft.turnStopping(1)
    expect(steerTexts(soft.agent)).toHaveLength(afterFirst)
    const softRun = runIdFrom(
      await soft.toolText('delegate', { rule: 'integration-review', change: 'change-a' }),
    )
    await soft.waitForRun(softRun)
    await soft.turnStopping(1)
    expect(steerTexts(soft.agent)).toHaveLength(afterFirst)

    const noneRoot = await workspace()
    const none = harnessFor(noneRoot, integrationOnly('none'))
    await completeTask(noneRoot, none)
    await none.turnStopping(1)
    expect(steerTexts(none.agent)).toHaveLength(0)

    const strictRoot = await workspace()
    const strict = harnessFor(strictRoot, integrationOnly('strict'))
    await completeTask(strictRoot, strict)
    await strict.turnStopping(1)
    const strictFirst = steerTexts(strict.agent).length
    expect(strictFirst).toBeGreaterThan(0)
    await strict.turnStopping(1)
    expect(steerTexts(strict.agent).length).toBeGreaterThan(strictFirst)
    const strictRun = runIdFrom(
      await strict.toolText('delegate', { rule: 'integration-review', change: 'change-a' }),
    )
    await strict.waitForRun(strictRun)
    await strict.turnStopping(1)
  })
})

describe('failure-streak gate', () => {
  const blockerConfig = (failureStreak = 3): BundleConfigLike => ({
    targets: codexTargets,
    rules: [
      {
        id: 'blocker',
        when: 'failure-streak',
        to: 'codex',
        contract: 'answer',
        gate: 'soft',
        instruction: 'bundled:consult',
      },
    ],
    failureStreak,
  })

  it('steers once per streak, resets on success and turn change, and records the consultation', async () => {
    const root = await workspace()
    const subagents = registered()
    const harness = harnessFor(root, blockerConfig(), subagents)
    await harness.preStep(1)
    await harness.toolResult(true)
    await harness.toolResult(true)
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
    await harness.toolResult(true)
    await harness.turnStopping(1)
    expect(combinedSteers(harness.agent)).toContain('consecutive failed tool calls')
    const steers = steerTexts(harness.agent).length
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(steers)

    await harness.callTool('delegate', { rule: 'blocker' })
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(steers)

    const root2 = await workspace()
    const reset = harnessFor(root2, blockerConfig(), registered())
    await reset.preStep(1)
    await reset.toolResult(true)
    await reset.toolResult(true)
    await reset.toolResult(false)
    await reset.toolResult(true)
    await reset.toolResult(true)
    await reset.turnStopping(1)
    expect(steerTexts(reset.agent)).toHaveLength(0)

    const root3 = await workspace()
    const turns = harnessFor(root3, blockerConfig(), registered())
    await turns.preStep(1)
    await turns.toolResult(true)
    await turns.toolResult(true)
    await turns.toolResult(true)
    await turns.preStep(2)
    await turns.turnStopping(2)
    expect(steerTexts(turns.agent)).toHaveLength(0)
  })
})

function specAndTask(): BundleConfigLike {
  return {
    targets: codexTargets,
    rules: [...(specOnly().rules ?? []), ...(taskOnly().rules ?? [])],
  }
}

async function writePartialChange(root: string, name: string): Promise<string> {
  const dir = join(root, 'openspec', 'changes', name)
  await mkdir(join(dir, 'specs', 'capability'), { recursive: true })
  await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy.\n', 'utf8')
  await writeFile(join(dir, 'design.md'), '# Design\n\nDecisions.\n', 'utf8')
  await writeFile(join(dir, 'specs', 'capability', 'spec.md'), '# Spec\n', 'utf8')
  return dir
}

describe('session-scoped triggers', () => {
  const first = (): FakeAgent => createAgent('thread-a')
  const second = (): FakeAgent => createAgent('thread-b')

  it('does not steer a fresh session on old checked tasks and creates no involvement', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Old task', checked: true }])
    const harness = harnessFor(root, specAndTask())
    const agent = first()
    await harness.preStep(1, agent)
    await harness.turnStopping(1, agent)
    expect(steerTexts(agent)).toHaveLength(0)
    expect(await harness.readInvolvement('thread-a')).toBeUndefined()
  })

  it('gates only the checked task each overlapping session attributed', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [
      { number: '1.1', text: 'First task' },
      { number: '1.2', text: 'Second task' },
    ])
    const harness = harnessFor(root, taskOnly())
    const a = first()
    const b = second()
    await harness.preStep(1, a)
    await harness.preStep(1, b)
    const before = '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n'
    const afterA = '# Tasks\n\n- [x] 1.1 First task\n- [ ] 1.2 Second task\n'
    const afterB = '# Tasks\n\n- [x] 1.1 First task\n- [x] 1.2 Second task\n'
    await harness.writeResult(join(dir, 'tasks.md'), before, afterA, a, 'edit')
    await writeFile(join(dir, 'tasks.md'), afterA)
    await harness.writeResult(join(dir, 'tasks.md'), afterA, afterB, b, 'edit')
    await writeFile(join(dir, 'tasks.md'), afterB)
    await harness.turnStopping(1, a)
    await harness.turnStopping(1, b)
    const firstId = taskIdFor('First task')
    const secondId = taskIdFor('Second task')
    expect((await harness.readInvolvement('thread-a'))?.changes['change-a']?.tasks).toEqual([
      firstId,
    ])
    expect((await harness.readInvolvement('thread-b'))?.changes['change-a']?.tasks).toEqual([
      secondId,
    ])

    const messageA = combinedSteers(a)
    expect(messageA).toContain('checked task "1.1 First task"')
    expect(messageA).not.toContain('1.2 Second task')
    expect(messageA).toContain(`task: "${firstId}"`)
    const messageB = combinedSteers(b)
    expect(messageB).toContain('checked task "1.2 Second task"')
    expect(messageB).not.toContain('1.1 First task')

    const run = await harness.startReview(
      { rule: 'task-review', change: 'change-a', task: firstId },
      a,
    )
    await harness.waitForRun(run, a)
    await harness.turnStopping(1, a)
    expect(steerTexts(a)).toHaveLength(1)
  })

  it('records a creation command as created and spec-changed without importing foreign ticks', async () => {
    const root = await workspace()
    const harness = harnessFor(root, specAndTask())
    const agent = first()
    await harness.preStep(1, agent)
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Foreign task', checked: true }])
    await harness.shellResult('openspec new change change-a', agent)
    await harness.turnStopping(1, agent)
    expect(await harness.readInvolvement('thread-a')).toEqual({
      session: 'thread-a',
      changes: {
        'change-a': { created: true, specChanged: true, tasks: [], completed: false },
      },
    })
    const message = combinedSteers(agent)
    expect(message).toContain('whole-spec review')
    expect(message).not.toContain('Foreign task')
  })

  it('marks a checkbox-only tick as a task only and a substantive edit as spec-changed', async () => {
    const tickRoot = await workspace()
    const tickDir = await writeChange(tickRoot, 'change-a', [{ number: '1.1', text: 'First task' }])
    const tickHarness = harnessFor(tickRoot, specAndTask())
    const ticker = first()
    await tickHarness.preStep(1, ticker)
    await tickHarness.writeResult(
      join(tickDir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 First task\n',
      '# Tasks\n\n- [x] 1.1 First task\n',
      ticker,
      'edit',
    )
    await writeFile(join(tickDir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n')
    await tickHarness.turnStopping(1, ticker)
    expect(await tickHarness.readInvolvement('thread-a')).toEqual({
      session: 'thread-a',
      changes: {
        'change-a': {
          created: false,
          specChanged: false,
          tasks: [taskIdFor('First task')],
          completed: true,
        },
      },
    })
    expect(combinedSteers(ticker)).toContain('requires its task-scoped review')
    expect(combinedSteers(ticker)).not.toContain('whole-spec review')

    const editRoot = await workspace()
    const editDir = await writeChange(editRoot, 'change-a', [{ number: '1.1', text: 'First task' }])
    const editHarness = harnessFor(editRoot, specAndTask())
    const editor = first()
    await editHarness.preStep(1, editor)
    await editHarness.writeResult(
      join(editDir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 First task\n',
      '# Tasks\n\n- [ ] 1.1 First task restated\n',
      editor,
      'edit',
    )
    await writeFile(join(editDir, 'tasks.md'), '# Tasks\n\n- [ ] 1.1 First task restated\n')
    await editHarness.turnStopping(1, editor)
    expect((await editHarness.readInvolvement('thread-a'))?.changes['change-a']?.specChanged).toBe(
      true,
    )
    expect(combinedSteers(editor)).toContain('whole-spec review')
  })

  it('does not mark a checkbox writer spec-changed when another session edits proposal.md', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const harness = harnessFor(root, specAndTask())
    const a = first()
    const b = second()
    await harness.preStep(1, a)
    await harness.preStep(1, b)
    await harness.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 First task\n',
      '# Tasks\n\n- [x] 1.1 First task\n',
      a,
      'edit',
    )
    await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n')
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy, restated.\n',
      b,
      'edit',
    )
    await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy, restated.\n')
    await harness.turnStopping(1, b)
    await harness.turnStopping(1, a)
    expect((await harness.readInvolvement('thread-a'))?.changes['change-a']?.specChanged).toBe(
      false,
    )
    expect(combinedSteers(a)).not.toContain('whole-spec review')
    expect(combinedSteers(a)).toContain('requires its task-scoped review')
  })

  it('attributes a newly supplied tasks.md to an existing partial change', async () => {
    const root = await workspace()
    const dir = await writePartialChange(root, 'change-a')
    const harness = harnessFor(root, specAndTask())
    const agent = first()
    await harness.preStep(1, agent)
    await harness.writeResult(
      join(dir, 'tasks.md'),
      null,
      '# Tasks\n\n- [x] 1.1 First task\n',
      agent,
    )
    await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n')
    await harness.turnStopping(1, agent)
    expect(await harness.readInvolvement('thread-a')).toEqual({
      session: 'thread-a',
      changes: {
        'change-a': {
          created: false,
          specChanged: true,
          tasks: [taskIdFor('First task')],
          completed: true,
        },
      },
    })
    expect(combinedSteers(agent)).toContain('whole-spec review')
    expect(combinedSteers(agent)).toContain('requires its task-scoped review')
  })

  it('attributes nothing without a pre-step baseline', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, specAndTask())
    const agent = first()
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
      agent,
      'edit',
    )
    await harness.turnStopping(1, agent)
    expect(steerTexts(agent)).toHaveLength(0)
    expect(await harness.readInvolvement('thread-a')).toBeUndefined()
  })

  it('keeps a foreign missing tasks.md out of another session gate and progress notes', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Readable task' }])
    const foreignDir = await writeChange(root, 'change-b', [])
    await rm(join(foreignDir, 'tasks.md'))
    const harness = harnessFor(root, workAndReview())
    const a = first()
    const b = second()
    await harness.preStep(1, a)
    await harness.preStep(1, b)
    await harness.shellResult(
      'Set-Content openspec/changes/change-b/proposal.md "edited by another session"',
      b,
    )
    await harness.turnStopping(1, b)
    const messageB = combinedSteers(b)
    expect(messageB).toContain('change "change-b"')
    expect(messageB).toContain('tasks.md is missing or unreadable')
    expect(messageB).not.toContain('worktree digest could not be computed')

    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'M engine'
    const note = await harness.toolText(
      'task_progress',
      { task: '1.1 Readable task', status: 'in-progress', reason: 'midway' },
      a,
    )
    expect(note).toContain('progress note written')
    await harness.turnStopping(1, a)
    expect(combinedSteers(a)).not.toContain('change-b')
    expect(combinedSteers(a)).not.toContain('tasks.md')
    expect(combinedSteers(a)).not.toContain('worktree digest could not be computed')
  })

  it('suggests the session task id instead of an earlier foreign checked task', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [
      { number: '1.1', text: 'First task' },
      { number: '1.2', text: 'Second task' },
    ])
    const harness = harnessFor(root, taskOnly())
    const a = first()
    const b = second()
    await harness.preStep(1, a)
    await harness.preStep(1, b)
    const before = '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n'
    const afterB = '# Tasks\n\n- [x] 1.1 First task\n- [ ] 1.2 Second task\n'
    const afterA = '# Tasks\n\n- [x] 1.1 First task\n- [x] 1.2 Second task\n'
    await harness.writeResult(join(dir, 'tasks.md'), before, afterB, b, 'edit')
    await writeFile(join(dir, 'tasks.md'), afterB)
    await harness.writeResult(join(dir, 'tasks.md'), afterB, afterA, a, 'edit')
    await writeFile(join(dir, 'tasks.md'), afterA)
    const secondId = taskIdFor('Second task')
    await harness.turnStopping(1, a)
    const message = combinedSteers(a)
    expect(message).toContain(
      `delegate(rule: "task-review", change: "change-a", task: "${secondId}")`,
    )
    expect(message).not.toContain('1.1 First task')
    const run = await harness.startReview(
      { rule: 'task-review', change: 'change-a', task: secondId },
      a,
    )
    await harness.waitForRun(run, a)
    await harness.turnStopping(1, a)
    expect(steerTexts(a)).toHaveLength(1)
    expect(
      await readFile(
        join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks', `${secondId}.json`),
        'utf8',
      ),
    ).toContain('"verdict": "PASS"')
  })

  it('requires the integration review only from the session that completed the list', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'Done' }])
    const harness = harnessFor(root, integrationOnly('strict'))
    const a = first()
    const b = second()
    await harness.preStep(1, a)
    await harness.preStep(1, b)
    await harness.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 Done\n',
      '# Tasks\n\n- [x] 1.1 Done\n',
      a,
      'edit',
    )
    await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Done\n')
    await harness.turnStopping(1, a)
    expect(combinedSteers(a)).toContain('integration review')
    await harness.turnStopping(1, b)
    expect(steerTexts(b)).toHaveLength(0)
    expect((await harness.readInvolvement('thread-a'))?.changes['change-a']?.completed).toBe(true)
    expect(await harness.readInvolvement('thread-b')).toBeUndefined()
  })

  it('does not mark the first of two overlapping final ticks as completed', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [
      { number: '1.1', text: 'First task' },
      { number: '1.2', text: 'Final task' },
    ])
    const harness = harnessFor(root, integrationOnly('strict'))
    const a = first()
    const b = second()
    await harness.preStep(1, a)
    await harness.preStep(1, b)
    const before = '# Tasks\n\n- [ ] 1.1 First task\n- [ ] 1.2 Final task\n'
    const afterA = '# Tasks\n\n- [x] 1.1 First task\n- [ ] 1.2 Final task\n'
    const afterB = '# Tasks\n\n- [x] 1.1 First task\n- [x] 1.2 Final task\n'
    await harness.writeResult(join(dir, 'tasks.md'), before, afterA, a, 'edit')
    await harness.writeResult(join(dir, 'tasks.md'), afterA, afterB, b, 'edit')
    await writeFile(join(dir, 'tasks.md'), afterB)
    await harness.turnStopping(1, a)
    await harness.turnStopping(1, b)
    expect((await harness.readInvolvement('thread-a'))?.changes['change-a']?.completed).toBe(false)
    expect((await harness.readInvolvement('thread-b'))?.changes['change-a']?.completed).toBe(true)
  })

  it('does not treat a change named constructor as involved for a fresh session', async () => {
    const root = await workspace()
    await writeChange(root, 'constructor', [{ number: '1.1', text: 'Checked task', checked: true }])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('keeps completion when the final task was ticked and explicitly reviewed first', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'Done' }])
    const harness = harnessFor(root, {
      targets: codexTargets,
      rules: [...(taskOnly().rules ?? []), ...(integrationOnly('strict').rules ?? [])],
    })
    const agent = first()
    await harness.preStep(1, agent)
    await harness.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 Done\n',
      '# Tasks\n\n- [x] 1.1 Done\n',
      agent,
      'edit',
    )
    await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Done\n')
    const review = runIdFrom(
      await harness.toolText(
        'delegate',
        { rule: 'task-review', change: 'change-a', task: '1.1 Done' },
        agent,
      ),
    )
    await harness.waitForRun(review)
    await harness.turnStopping(1, agent)
    expect((await harness.readInvolvement('thread-a'))?.changes['change-a']?.completed).toBe(true)
    expect(combinedSteers(agent)).toContain('integration review')
  })

  it('persists involvement and a task review across engine recreation', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const firstEngine = harnessFor(root, taskOnly())
    await firstEngine.preStep(1)
    await firstEngine.writeResult(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [ ] 1.1 First task\n',
      '# Tasks\n\n- [x] 1.1 First task\n',
      firstEngine.agent,
    )
    await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n')
    await firstEngine.turnStopping(1)
    expect(steerTexts(firstEngine.agent)).toHaveLength(1)
    const run = await firstEngine.startReview(
      { rule: 'task-review', change: 'change-a' },
      firstEngine.agent,
    )
    await firstEngine.waitForRun(run)

    const secondEngine = harnessFor(root, taskOnly())
    await secondEngine.preStep(2)
    await secondEngine.turnStopping(2)
    expect(steerTexts(secondEngine.agent)).toHaveLength(0)
    const other = second()
    await secondEngine.preStep(2, other)
    await secondEngine.turnStopping(2, other)
    expect(steerTexts(other)).toHaveLength(0)
    expect(await secondEngine.readInvolvement('thread-b')).toBeUndefined()
  })
})

describe('session involvement files', () => {
  it('treats reads, searches, status, openspec queries, and an unrecognized tool as observation', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, specOnly())
    await harness.preStep(1)
    const proposal = join(dir, 'proposal.md')
    await harness.toolOutcome('read', { file_path: proposal }, { content: '# Proposal' })
    await harness.toolOutcome('grep', { pattern: 'proposal', path: dir }, { matches: [] })
    await harness.toolOutcome('glob', { pattern: 'openspec/**/*.md' }, { files: [] })
    await harness.toolOutcome('delegation_status', {}, { text: 'status' })
    await harness.toolOutcome('run_code', { code: 'await tools.read({ file_path: "x" })' }, {})
    await harness.toolOutcome('pwsh', { command: 'openspec list' }, { output: 'change-a' })
    await harness.toolOutcome('pwsh', { command: 'openspec show change-a' }, { output: '' })
    await harness.toolOutcome(
      'pwsh',
      { command: 'openspec status --change change-a' },
      { output: '' },
    )
    await harness.toolOutcome('pwsh', { command: 'openspec validate change-a' }, { output: '' })
    await harness.toolOutcome('unrecognized-tool', { file_path: proposal }, {})
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('attributes a shell tasks.md write to the change but not to task ids', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult(
      'Set-Content openspec/changes/change-a/tasks.md "- [x] 1.1 First task"',
    )
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toEqual({
      session: 'agent-1',
      changes: {
        'change-a': { created: false, specChanged: false, tasks: [], completed: false },
      },
    })
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('does not attribute a shell read redirected outside the change tree', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult('Get-Content openspec/changes/change-a/proposal.md > .tmp/copy.md')
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('does not attribute a shell command that exited nonzero', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.toolOutcome(
      'pwsh',
      { command: 'Set-Content openspec/changes/change-a/proposal.md "failed"' },
      { output: 'denied', exitCode: 1 },
    )
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('does not attribute copies or values that only mention a change path', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult('Copy-Item openspec/changes/change-a/proposal.md proposal-copy.md')
    await harness.shellResult('Set-Content scratch.txt "openspec/changes/change-a/proposal.md"')
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('does not attribute a write to another workspace with a local namesake change', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const other = join(root, 'other-project', 'openspec', 'changes', 'change-a')
    await mkdir(other, { recursive: true })
    const path = join(other, 'proposal.md')
    await writeFile(path, '# Proposal\n')
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.writeResult(path, '# Proposal\n', '# Proposal changed\n', harness.agent, 'edit')
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('ignores write verbs inside quoted command data', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult(
      "Write-Output 'Set-Content openspec/changes/change-a/proposal.md hello'",
    )
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('treats a write switch as a switch and keeps the real destination', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult(
      'Set-Content -Force scratch.txt "openspec/changes/change-a/proposal.md"',
    )
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('uses the shell workdir for resolution and rejects another workspace', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const other = join(root, 'other-project')
    await mkdir(join(other, 'openspec', 'changes', 'change-a'), { recursive: true })
    await writeFile(join(other, 'openspec', 'changes', 'change-a', 'proposal.md'), '# Other\n')
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.toolOutcome(
      'pwsh',
      { command: 'Set-Content openspec/changes/change-a/proposal.md hello', workdir: other },
      { output: '', exitCode: 0 },
      harness.agent,
      false,
    )
    await harness.toolOutcome(
      'pwsh',
      { command: 'openspec new change other-copy', workdir: other },
      { output: '', exitCode: 0 },
      harness.agent,
      false,
    )
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('preserves quoted destinations without attributing source paths', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult('Copy-Item openspec/changes/change-a/proposal.md "proposal-copy.md"')
    await harness.shellResult('Set-Content "scratch.txt" openspec/changes/change-a/proposal.md')
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('ignores write verbs in argument text and skipped branches', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult(
      'Write-Output Set-Content openspec/changes/change-a/proposal.md hello',
    )
    await harness.shellResult(
      'if ($false) { Set-Content openspec/changes/change-a/proposal.md hello }',
    )
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('ignores compound branches and quoted redirection operators', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult(
      'Write-Output ok || Set-Content openspec/changes/change-a/proposal.md hello',
    )
    await harness.shellResult(
      'if ($false) { Write-Output ok; Set-Content openspec/changes/change-a/proposal.md hello }',
    )
    await harness.shellResult('Write-Output ">" openspec/changes/change-a/proposal.md')
    await harness.shellResult("'Set-Content' openspec/changes/change-a/proposal.md hello")
    await harness.shellResult(
      'Copy-Item scratch-source.txt scratch-destination.txt\nWrite-Output openspec/changes/change-a/proposal.md',
    )
    await harness.shellResult('Set-Content -WhatIf openspec/changes/change-a/proposal.md hello')
    await harness.shellResult(
      'Set-Content -WhatIf:$true openspec/changes/change-a/proposal.md hello',
    )
    await harness.turnStopping(1)
    expect(await harness.readInvolvement()).toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('attributes a colon-form named destination', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.shellResult(
      'Set-Content -Path:openspec/changes/change-a/proposal.md -Value hello',
    )
    await harness.turnStopping(1)
    expect((await harness.readInvolvement())?.changes['change-a']?.specChanged).toBe(true)
  })

  it('round-trips under a hashed filename', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task' }])
    const harness = harnessFor(root, taskOnly())
    await harness.callTool('task_progress', {
      task: '1.1 Open task',
      status: 'in-progress',
      reason: 'midway',
    })
    expect(harness.involvementPath()).toMatch(/sessions[\\/][0-9a-f]{16}\.json$/)
    const value = await harness.readInvolvement()
    expect(value?.session).toBe('agent-1')
    expect(value?.changes['change-a']).toMatchObject({ created: false, specChanged: false })
  })

  it('treats a missing file as empty and a malformed file as empty with a status warning', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Old task', checked: true }])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
    await mkdir(join(root, '.dsh', 'delegation', 'sessions'), { recursive: true })
    await writeFile(harness.involvementPath(), '{ not json')
    const status = await harness.toolText('delegation_status', {})
    expect(status).toContain('session involvement')
    expect(status).toContain('malformed')
    expect(status).toContain('this session: not involved')
    await harness.preStep(2)
    await expect(harness.turnStopping(2)).resolves.toBeUndefined()
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })
})

describe('gate safety', () => {
  it('never starts a target run from the turn-stopping listener', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    const subagents = registered()
    const harness = harnessFor(root, specOnly(), subagents)
    await harness.preStep(1)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).length).toBeGreaterThan(0)
    expect(subagents.startCalls).toBe(0)
  })

  it('keeps target and subagent calls out of the evaluation and listener source', () => {
    const source = readFileSync(join(packageDir, 'src', 'host', 'index.ts'), 'utf8')
    const evaluateStart = source.indexOf('async function evaluateGate')
    const evaluateEnd = source.indexOf('interface GateWiring', evaluateStart)
    expect(evaluateStart).toBeGreaterThan(0)
    const evaluation = source.slice(evaluateStart, evaluateEnd)
    expect(evaluation).not.toMatch(/startActivation|services\.subagents|runTarget/)
    const attachStart = source.indexOf('function attachGate')
    const attachEnd = source.indexOf('function toolOutput', attachStart)
    const listener = source.slice(attachStart, attachEnd)
    expect(attachStart).toBeGreaterThan(0)
    expect(listener).not.toMatch(/startActivation|services\.subagents|runTarget/)
  })

  it('captures the pre-step baseline from all active changes, not from owners', () => {
    const source = readFileSync(join(packageDir, 'src', 'host', 'index.ts'), 'utf8')
    const start = source.indexOf('function attachGate')
    const end = source.indexOf('function toolOutput', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const listener = source.slice(start, end)
    expect(listener).toMatch(/captureSnapshot\(cwd, changes/)
    expect(listener).not.toContain('ownedActiveChanges(')
    expect(source).not.toContain('ownersDirectory')
  })

  it('skips delegated subagent turns', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, specOnly())
    const child = createAgent('child-1', 'subagent')
    await harness.turnStopping(1, child)
    expect(steerTexts(child)).toHaveLength(0)
  })

  it('never throws into the turn when evaluation fails', async () => {
    const root = await workspace()
    const harness = harnessFor(root, specOnly())
    const broken = {
      id: 'agent-broken',
      session: {
        get header(): never {
          throw new Error('session header is unavailable')
        },
      },
      steer: createAgent('broken').steer,
    } as unknown as FakeAgent
    await expect(harness.turnStopping(1, broken)).resolves.toBeUndefined()
    expect(steerTexts(broken).join('\n')).toContain('could not evaluate this turn')
  })
})
