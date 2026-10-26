import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
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

    await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
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
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    ).rejects.toThrow()
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('ignores a stale whole-spec record', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root, specOnly())
    await harness.preStep(1)
    await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
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
    await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' })
    await harness.turnStopping(1)
    expect(combinedSteers(harness.agent)).toContain('unresolved findings')
  })

  it('keeps a task PASS historical after a later worktree change', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task', checked: true }])
    const harness = harnessFor(root, taskOnly())
    await harness.preStep(1)
    await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' })
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
    await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' })
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
    await soft.callTool('delegate', { rule: 'integration-review', change: 'change-a' })
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
    await strict.callTool('delegate', { rule: 'integration-review', change: 'change-a' })
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
