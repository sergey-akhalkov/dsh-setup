import { createHash } from 'node:crypto'
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
    await writeChange(root, 'change-a', [])
    const subagents = registered()
    const harness = harnessFor(root, specOnly(), subagents)
    await harness.preStep(1)
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
    await writeChange(root, 'change-a', [])
    const subagents = registered()
    subagents.respond = () => ({
      output: [],
      stopReason: 'error',
      diagnostic: 'target unavailable',
    })
    const harness = harnessFor(root, specOnly(), subagents)
    await harness.preStep(1)
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=failed')
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('points a pending review at its run instead of starting another', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = registered()
    const releases: Array<() => void> = []
    subagents.respond = (run) =>
      new Promise((resolve) => {
        releases.push(() => resolve(passResponder(run)))
      })
    const harness = harnessFor(root, specOnly(), subagents)
    await harness.preStep(1)
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
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, specOnly())
    await harness.preStep(1)
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

  it('evaluates every active change and ignores archived changes', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    await mkdir(join(root, 'openspec', 'changes', 'archive', 'old-change'), { recursive: true })
    const harness = harnessFor(root, specOnly())
    await harness.preStep(1)
    await harness.turnStopping(1)
    const message = combinedSteers(harness.agent)
    expect(message).toContain('change "change-a"')
    expect(message).toContain('change "change-b"')
    expect(message).not.toContain('old-change')
  })

  it('finds the OpenSpec root from a nested working directory', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const nested = join(root, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const harness = new Harness({ cwd: nested, config: specOnly(), agents: registered() })
    await harness.preStep(1)
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
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, specOnly())
    harness.git.fail = true
    await harness.preStep(1)
    await expect(harness.turnStopping(1)).resolves.toBeUndefined()
    expect(combinedSteers(harness.agent)).toContain('could not be computed')
  })
})

describe('task review gate', () => {
  it('requires a record for every checked task and finds unresolved findings', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task', checked: true }])
    const subagents = registered()
    const harness = harnessFor(root, taskOnly(), subagents)
    await harness.preStep(1)
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
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task', checked: true }])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
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
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const harness = harnessFor(root, workOnly())
    await harness.preStep(1)
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
    await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 First task\n')
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
    await writeChange(root, 'change-a', [
      { number: '1.1', text: 'Finished task', checked: true },
      { number: '1.2', text: 'Open task' },
    ])
    const harness = harnessFor(root, workAndReview())
    await harness.preStep(1)
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
  it('steers once for a soft rule, never for none, and repeatedly for strict', async () => {
    const softRoot = await workspace()
    await writeChange(softRoot, 'change-a', [{ number: '1.1', text: 'Done', checked: true }])
    const soft = harnessFor(softRoot, integrationOnly('soft'))
    await soft.preStep(1)
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
    await writeChange(noneRoot, 'change-a', [{ number: '1.1', text: 'Done', checked: true }])
    const none = harnessFor(noneRoot, integrationOnly('none'))
    await none.preStep(1)
    await none.turnStopping(1)
    expect(steerTexts(none.agent)).toHaveLength(0)

    const strictRoot = await workspace()
    await writeChange(strictRoot, 'change-a', [{ number: '1.1', text: 'Done', checked: true }])
    const strict = harnessFor(strictRoot, integrationOnly('strict'))
    await strict.preStep(1)
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

describe('thread-scoped triggers', () => {
  const owner = (): FakeAgent => createAgent('thread-a')
  const foreign = (): FakeAgent => createAgent('thread-b')

  async function ownerOf(root: string, change = 'change-a'): Promise<string | undefined> {
    const name = createHash('sha256').update(change).digest('hex').slice(0, 16)
    try {
      const value = JSON.parse(
        await readFile(join(root, '.dsh', 'delegation', 'owners', `${name}.json`), 'utf8'),
      ) as { session?: unknown }
      return typeof value.session === 'string' ? value.session : undefined
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  }

  it('steers only the owning thread and persists the owner across engine recreation', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const config = specOnly()
    const first = harnessFor(root, config)
    const firstOwner = owner()
    const firstForeign = foreign()
    await first.preStep(1, firstOwner)
    await first.turnStopping(1, firstOwner)
    expect(combinedSteers(firstOwner)).toContain('rule "spec-review"')
    await first.preStep(1, firstForeign)
    await first.turnStopping(1, firstForeign)
    expect(steerTexts(firstForeign)).toHaveLength(0)
    expect(await ownerOf(root)).toBe('thread-a')

    const second = harnessFor(root, config)
    const secondForeign = foreign()
    await second.preStep(1, secondForeign)
    await second.turnStopping(1, secondForeign)
    expect(steerTexts(secondForeign)).toHaveLength(0)
    const secondOwner = owner()
    await second.preStep(1, secondOwner)
    await second.turnStopping(1, secondOwner)
    expect(combinedSteers(secondOwner)).toContain('rule "spec-review"')
  })

  it('scopes the task review and implementation-work triggers to the owner', async () => {
    const taskRoot = await workspace()
    await writeChange(taskRoot, 'change-a', [
      { number: '1.1', text: 'Checked task', checked: true },
    ])
    const taskHarness = harnessFor(taskRoot, taskOnly())
    const taskOwner = owner()
    const taskForeign = foreign()
    await taskHarness.preStep(1, taskOwner)
    await taskHarness.turnStopping(1, taskOwner)
    expect(combinedSteers(taskOwner)).toContain('checked task "1.1 Checked task"')
    await taskHarness.preStep(1, taskForeign)
    await taskHarness.turnStopping(1, taskForeign)
    expect(steerTexts(taskForeign)).toHaveLength(0)

    const workRoot = await workspace()
    await writeChange(workRoot, 'change-a', [{ number: '1.1', text: 'Open task' }])
    const workHarness = harnessFor(workRoot, workOnly())
    const workOwner = owner()
    const workForeign = foreign()
    // Both baselines must predate the edit, or the foreign no-steer passes vacuously.
    await workHarness.preStep(1, workOwner)
    await workHarness.preStep(1, workForeign)
    workHarness.git.status = ' M packages/engine.ts\0'
    workHarness.git.diff = 'M engine'
    await workHarness.turnStopping(1, workOwner)
    expect(combinedSteers(workOwner)).toContain('changed implementation files')
    await workHarness.turnStopping(1, workForeign)
    expect(steerTexts(workForeign)).toHaveLength(0)
  })

  it('does not let a foreign change artifact error block this thread', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    await rm(join(root, 'openspec', 'changes', 'change-b', 'tasks.md'))
    const harness = harnessFor(root, specOnly())
    const firstAgent = owner()
    const secondAgent = foreign()
    // Delegate claims only the resolved change, so the two threads own one change each.
    const aRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' }, firstAgent),
    )
    // Claim change-b before any status poll: delegation_status observes and would claim it.
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-b' }, secondAgent),
    ).rejects.toThrow(/not review-ready/)
    await harness.waitForRun(aRun, firstAgent)
    expect(await ownerOf(root, 'change-a')).toBe('thread-a')
    expect(await ownerOf(root, 'change-b')).toBe('thread-b')

    await harness.preStep(1, firstAgent)
    await harness.turnStopping(1, firstAgent)
    expect(steerTexts(firstAgent)).toHaveLength(0)
    const message = combinedSteers(firstAgent)
    expect(message).not.toContain('worktree digest could not be computed')
    expect(message).not.toContain('tasks.md')
    const status = await harness.toolText('delegation_status', {}, firstAgent)
    expect(status).toContain('change-b (not review-ready) owner=thread-b (foreign thread)')
    expect(status).toContain('tasks: unreadable')
  })

  it('captures the turn baseline from owned changes only', () => {
    const source = readFileSync(join(packageDir, 'src', 'host', 'index.ts'), 'utf8')
    const start = source.indexOf('function attachGate')
    const end = source.indexOf('function toolOutput', start)
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const listener = source.slice(start, end)
    expect(listener).toContain('ownedActiveChanges(')
    expect(listener).not.toMatch(/captureSnapshot\(cwd, changes/)
  })

  it('reports an owned change with no tasks.md as a per-change problem', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [])
    await rm(join(dir, 'tasks.md'))
    const harness = harnessFor(root, workOnly())
    await harness.preStep(1)
    await harness.turnStopping(1)
    const message = combinedSteers(harness.agent)
    expect(message).toContain('change "change-a"')
    expect(message).toContain('owner agent-1')
    expect(message).toContain('tasks.md is missing or unreadable')
    expect(message).not.toContain('worktree digest could not be computed')
    const status = await harness.toolText('delegation_status', {})
    expect(status).toContain('(not review-ready)')
    expect(status).toContain('tasks: unreadable')
  })

  it('scopes the optional integration review to the owner', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Done', checked: true }])
    const harness = harnessFor(root, integrationOnly('strict'))
    const integrationOwner = owner()
    const integrationForeign = foreign()
    await harness.preStep(1, integrationOwner)
    await harness.turnStopping(1, integrationOwner)
    expect(steerTexts(integrationOwner).length).toBeGreaterThan(0)
    await harness.preStep(1, integrationForeign)
    await harness.turnStopping(1, integrationForeign)
    expect(steerTexts(integrationForeign)).toHaveLength(0)
  })

  it('keeps failure-streak steering thread-local in a foreign thread', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const config: BundleConfigLike = {
      targets: codexTargets,
      rules: [
        ...(specOnly().rules ?? []),
        {
          id: 'blocker',
          when: 'failure-streak',
          to: 'codex',
          contract: 'answer',
          gate: 'soft',
          instruction: 'bundled:consult',
        },
      ],
      failureStreak: 3,
    }
    const harness = harnessFor(root, config)
    const claimer = owner()
    await harness.callTool('delegation_status', {}, claimer)
    const other = foreign()
    await harness.preStep(1, other)
    await harness.toolResult(true, other)
    await harness.toolResult(true, other)
    await harness.toolResult(true, other)
    await harness.turnStopping(1, other)
    const message = combinedSteers(other)
    expect(message).toContain('consecutive failed tool calls')
    expect(message).not.toContain('spec-review')
  })

  it('shares one owner between the workspace root and a nested working directory', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const nested = join(root, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const harness = new Harness({
      cwd: root,
      config: specOnly(),
      agents: registered(),
      cwdByAgent: { 'thread-a': root, 'thread-b': nested },
    })
    const rootThread = createAgent('thread-a')
    const nestedThread = createAgent('thread-b')
    await harness.preStep(1, rootThread)
    await harness.turnStopping(1, rootThread)
    expect(combinedSteers(rootThread)).toContain('rule "spec-review"')
    await harness.preStep(1, nestedThread)
    await harness.turnStopping(1, nestedThread)
    expect(steerTexts(nestedThread)).toHaveLength(0)
    expect(await ownerOf(root)).toBe('thread-a')
    expect(await ownerOf(nested)).toBeUndefined()
  })

  it('keeps one owner when two independent engines race the same claim', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const first = harnessFor(root, specOnly())
    const second = harnessFor(root, specOnly())
    const firstAgent = owner()
    const secondAgent = foreign()
    await Promise.all([first.turnStopping(1, firstAgent), second.turnStopping(1, secondAgent)])
    const winnerId = await ownerOf(root)
    expect(['thread-a', 'thread-b']).toContain(winnerId)
    const winner = winnerId === 'thread-a' ? firstAgent : secondAgent
    const loser = winnerId === 'thread-a' ? secondAgent : firstAgent
    expect(steerTexts(winner).length).toBeGreaterThan(0)
    expect(steerTexts(loser)).toHaveLength(0)

    const winnerSteers = steerTexts(winner).length
    await Promise.all([first.turnStopping(1, firstAgent), second.turnStopping(1, secondAgent)])
    expect(steerTexts(winner).length).toBeGreaterThan(winnerSteers)
    expect(steerTexts(loser)).toHaveLength(0)
  })

  it('preserves concurrent claims for different changes from two engines', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Task A' }])
    await writeChange(root, 'change-b', [{ number: '2.1', text: 'Task B' }])
    const first = harnessFor(root, specOnly())
    const second = harnessFor(root, specOnly())
    const firstAgent = owner()
    const secondAgent = foreign()
    await Promise.all([
      first.callTool(
        'task_progress',
        { task: '1.1 Task A', status: 'in-progress', reason: 'a' },
        firstAgent,
      ),
      second.callTool(
        'task_progress',
        { task: '2.1 Task B', status: 'in-progress', reason: 'b' },
        secondAgent,
      ),
    ])
    expect(await ownerOf(root, 'change-a')).toBe('thread-a')
    expect(await ownerOf(root, 'change-b')).toBe('thread-b')
  })

  it('records an owner for a change named constructor', async () => {
    const root = await workspace()
    await writeChange(root, 'constructor', [])
    const harness = harnessFor(root, specOnly())
    const firstAgent = owner()
    const secondAgent = foreign()
    await harness.preStep(1, firstAgent)
    await harness.turnStopping(1, firstAgent)
    expect(combinedSteers(firstAgent)).toContain('change "constructor"')
    await harness.preStep(1, secondAgent)
    await harness.turnStopping(1, secondAgent)
    expect(steerTexts(secondAgent)).toHaveLength(0)
    expect(await ownerOf(root, 'constructor')).toBe('thread-a')
  })
})

describe('gate safety', () => {
  it('never starts a target run from the turn-stopping listener', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = registered()
    const harness = harnessFor(root, specOnly(), subagents)
    await harness.preStep(1)
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
