import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultTestConfig,
  FakeSubagents,
  Harness,
  makeWorkspace,
  passResponder,
  type RunRecord,
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

function findingsResponder(verdict: 'PASS' | 'FINDINGS', severity: 'P0' | 'P1' = 'P0') {
  return (run: RunRecord) => {
    const digest = /- Digest: ([0-9a-f]{64})/.exec(run.prompt)?.[1] ?? '0'.repeat(64)
    if (verdict === 'PASS') {
      return {
        output: [
          {
            type: 'text' as const,
            text: `\`\`\`json\n${JSON.stringify({ digest, verdict: 'PASS', findings: [] })}\n\`\`\``,
          },
        ],
        stopReason: 'completed' as const,
      }
    }
    const winPath = ['C:', 'Users', 'owner', 'secret.ts'].join('\\')
    const token = `sk-${'ABCDEFGH12345678'}`
    const body = {
      digest,
      verdict: 'FINDINGS',
      findings: [
        {
          severity,
          title: 'Missing failure path',
          evidence: `evidence in ${winPath} with ${token}`,
          fix: 'document the failure path',
        },
      ],
    }
    return {
      output: [{ type: 'text' as const, text: `\`\`\`json\n${JSON.stringify(body)}\n\`\`\`` }],
      stopReason: 'completed' as const,
    }
  }
}

function text(value: unknown): string {
  expect(value).toHaveProperty('text')
  return (value as { text: string }).text
}

function harnessFor(
  root: string,
  config = defaultTestConfig(),
  subagents = new FakeSubagents(),
): Harness {
  return new Harness({ cwd: root, config, agents: subagents })
}

describe('target resolution', () => {
  it('runs the same answer rule through a non-Codex DSH provider and model', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('spawn', { agentOptions: true }, () => ({
      output: [{ type: 'text', text: 'Use the shared helper; evidence: `src/engine.ts:10`.' }],
      stopReason: 'completed',
    }))
    const harness = harnessFor(
      root,
      {
        targets: { dsh: { provider: 'spawn', model: 'deepseek-flash' } },
        rules: [
          {
            id: 'research',
            when: 'manual',
            to: 'dsh',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
        ],
      },
      subagents,
    )
    const answer = await harness.callTool('delegate', {
      rule: 'research',
      objective: 'Which helper?',
    })
    expect(text(answer)).toContain('Use the shared helper')
    expect(subagents.runs[0]?.provider).toBe('spawn')
    expect(subagents.runs[0]?.agentOptions).toEqual({ model: 'deepseek-flash' })
    expect(subagents.list()).not.toContain('codex-subagent')
    const source = await readFile(join(packageDir, 'lib', 'index.js'), 'utf8')
    expect(source).not.toMatch(/codex/i)
  })

  it('reports a missing provider with the target id, provider, and next action', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const harness = harnessFor(root)
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    ).rejects.toThrow(
      /target "codex" names provider "codex-subagent", which is not registered.*install or enable that provider/,
    )
  })

  it('rejects model options a provider does not support instead of ignoring them', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('spawn', { agentOptions: false })
    const harness = harnessFor(
      root,
      {
        targets: { dsh: { provider: 'spawn', model: 'deepseek-flash' } },
        rules: [
          {
            id: 'research',
            when: 'manual',
            to: 'dsh',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
        ],
      },
      subagents,
    )
    await expect(harness.callTool('delegate', { rule: 'research' })).rejects.toThrow(
      /does not support them; remove model\/reasoningEffort\/agentOptions/,
    )
    expect(subagents.startCalls).toBe(0)
  })
})

describe('review records', () => {
  it('writes a PASS record, refuses a text claim, and reuses the record', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: false })
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const first = await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
    expect(text(first)).toMatch(/rule "spec-review" PASS/)
    expect(subagents.startCalls).toBe(1)
    const recordPath = join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json')
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
    expect(record).toMatchObject({
      rule: 'spec-review',
      change: 'change-a',
      scope: 'whole',
      phase: 'spec',
      verdict: 'PASS',
      findings: [],
      target: { provider: 'codex-subagent' },
    })
    expect(String(record.digest)).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof record.time).toBe('string')
    expect(JSON.stringify(record)).not.toContain(root)

    const second = await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
    expect(text(second)).toContain('reused record')
    expect(subagents.startCalls).toBe(1)

    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'specs', 'capability', 'spec.md'),
      '# Spec\n\nChanged.\n',
    )
    await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
    expect(subagents.startCalls).toBe(2)
  })

  it('ignores a checkbox-only tasks.md edit in the whole-spec digest', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'tasks.md'),
      '# Tasks\n\n- [x] 1.1 First task\n',
    )
    const reused = await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
    expect(text(reused)).toContain('reused record')
    expect(subagents.startCalls).toBe(1)
  })

  it('returns blocking findings, redacts machine paths and secrets, and records FINDINGS', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, findingsResponder('FINDINGS', 'P0'))
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const result = await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
    const rendered = text(result)
    expect(rendered).toContain('P0 Missing failure path')
    expect(rendered).toContain('evidence:')
    expect(rendered).not.toContain('secret.ts')
    expect(rendered).not.toContain('ABCDEFGH12345678')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; findings: Array<{ severity: string }> }
    expect(record.verdict).toBe('FINDINGS')
    expect(record.findings[0]?.severity).toBe('P0')
    const again = await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' })
    expect(text(again)).toContain('reused record')
    expect(subagents.startCalls).toBe(1)
  })

  it('writes an ERROR record when the verdict is malformed and never a PASS', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.respond = () => ({
      output: [{ type: 'text', text: 'Everything looks fine.' }],
      stopReason: 'completed',
    })
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    ).rejects.toThrow(/no usable verdict.*no fenced JSON verdict/)
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string }
    expect(record.verdict).toBe('ERROR')
  })

  it('writes an ERROR record when the target run fails', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.respond = () => ({
      output: [],
      stopReason: 'error',
      diagnostic: 'model transport failed',
    })
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    ).rejects.toThrow(/ERROR record was written.*model transport failed/)
  })

  it('retries an ERROR record after the cause is fixed and leaves no temporary files', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.respond = () => ({
      output: [],
      stopReason: 'error',
      diagnostic: 'temporary failure',
    })
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    ).rejects.toThrow()
    const directory = join(root, '.dsh', 'delegation', 'spec-review', 'change-a')
    expect(await readdir(directory)).toEqual(['spec.json'])
    subagents.respond = passResponder
    const retried = text(
      await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    expect(retried).toMatch(/rule "spec-review" PASS/)
    expect(subagents.startCalls).toBe(2)
    expect(await readdir(directory)).toEqual(['spec.json'])
  })

  it('treats an invalid severity or a mismatched digest as a malformed verdict', async () => {
    const variants: Array<(run: RunRecord) => string> = [
      (run) => {
        const digest = /- Digest: ([0-9a-f]{64})/.exec(run.prompt)?.[1] ?? ''
        return JSON.stringify({
          digest,
          verdict: 'FINDINGS',
          findings: [{ severity: 'P2', title: 'minor', evidence: 'x', fix: 'y' }],
        })
      },
      () => JSON.stringify({ digest: 'f'.repeat(64), verdict: 'PASS', findings: [] }),
    ]
    for (const variant of variants) {
      const root = await workspace()
      await writeChange(root, 'change-a', [])
      const subagents = new FakeSubagents()
      subagents.addProvider('codex-subagent', {}, (run) => ({
        output: [{ type: 'text', text: `\`\`\`json\n${variant(run)}\n\`\`\`` }],
        stopReason: 'completed',
      }))
      const harness = harnessFor(root, defaultTestConfig(), subagents)
      await expect(
        harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
      ).rejects.toThrow(/no usable verdict/)
      const record = JSON.parse(
        await readFile(
          join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
          'utf8',
        ),
      ) as { verdict: string }
      expect(record.verdict).toBe('ERROR')
    }
  })

  it('times out a slow target with an ERROR record and a clear next action', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, () => new Promise(() => undefined))
    const harness = harnessFor(root, defaultTestConfig({ timeouts: { review: 5 } }), subagents)
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    ).rejects.toThrow(/did not finish within 5 ms; widen timeouts\.review/)
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string }
    expect(record.verdict).toBe('ERROR')
  })
})

describe('task-scoped reviews', () => {
  const taskConfig = defaultTestConfig({
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
      { id: 'task-progress', when: 'implementation-work', contract: 'note', gate: 'strict' },
    ],
  })

  it('keys the record by the normalized task text and keeps it historical', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [
      { number: '1.1', text: 'First task', checked: true },
      { number: '1.2', text: 'Second task' },
    ])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, taskConfig, subagents)
    const result = await text(
      await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    expect(result).toMatch(/task id: [0-9a-f]{16}/)
    const taskId = /task id: ([0-9a-f]{16})/.exec(result)?.[1] as string
    const recordPath = join(
      root,
      '.dsh',
      'delegation',
      'task-review',
      'change-a',
      'tasks',
      `${taskId}.json`,
    )
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as {
      taskId: string
      scope: string
      digest: string
    }
    expect(record.taskId).toBe(taskId)
    expect(record.scope).toBe('task')
    expect(record.digest).toMatch(/^[0-9a-f]{64}$/)

    // A later task changing the worktree does not invalidate the historical record.
    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine.ts b/packages/engine.ts'
    const reused = await text(
      await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    expect(reused).toContain('reused record')
    expect(subagents.startCalls).toBe(1)

    // Changing the task text changes its id and requires a new review.
    await writeFile(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [x] 1.1 First task restated\n\n- [ ] 1.2 Second task\n',
    )
    const rerun = await text(
      await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    expect(rerun).not.toContain('reused record')
    expect(subagents.startCalls).toBe(2)
  })

  it('re-runs FINDINGS after the worktree changes and reuses them while it does not', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task', checked: true }])
    const subagents = new FakeSubagents()
    let runs = 0
    subagents.addProvider('codex-subagent', {}, (run) => {
      runs += 1
      return runs === 1 ? findingsResponder('FINDINGS', 'P1')(run) : findingsResponder('PASS')(run)
    })
    const harness = harnessFor(root, taskConfig, subagents)
    const first = text(
      await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    expect(first).toContain('FINDINGS')
    expect(subagents.startCalls).toBe(1)

    const reused = text(
      await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    expect(reused).toContain('reused record')
    expect(subagents.startCalls).toBe(1)

    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine.ts b/packages/engine.ts'
    const fixed = text(
      await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    expect(fixed).toContain('PASS')
    expect(subagents.startCalls).toBe(2)
  })
})

describe('task progress notes', () => {
  it('writes an in-progress note with the worktree digest without starting a model', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '2.1', text: 'Do the thing' }])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    harness.git.status = ' M packages/a.ts\0'
    harness.git.diff = 'M package'
    const result = text(
      await harness.callTool('task_progress', {
        task: '2.1  Do   the thing',
        status: 'in-progress',
        reason: 'halfway through the refactor',
      }),
    )
    expect(result).toContain('progress note written')
    expect(result).toContain('No model was run')
    expect(subagents.startCalls).toBe(0)
    const note = JSON.parse(
      await readFile(join(root, '.dsh', 'delegation', 'task-progress', 'change-a.json'), 'utf8'),
    ) as Record<string, unknown>
    expect(note).toMatchObject({ status: 'in-progress', reason: 'halfway through the refactor' })
    expect(String(note.taskId)).toMatch(/^[0-9a-f]{16}$/)
    expect(String(note.worktreeDigest)).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof note.time).toBe('string')

    const active = text(await harness.callTool('delegation_status', {}))
    expect(active).toContain('progress note: in-progress')
    expect(active).toContain('active')

    harness.git.diff = 'M package changed again'
    const stale = text(await harness.callTool('delegation_status', {}))
    expect(stale).toContain('stale (worktree changed)')
  })

  it('hashes untracked file bytes into the worktree digest', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task' }])
    const harness = harnessFor(root, {
      targets: { codex: { provider: 'codex-subagent' } },
      rules: [
        { id: 'task-progress', when: 'implementation-work', contract: 'note', gate: 'strict' },
      ],
    })
    await mkdir(join(root, 'src'), { recursive: true })
    harness.git.status = '?? src/untracked.ts\0'
    await writeFile(join(root, 'src', 'untracked.ts'), 'first content')
    await harness.callTool('task_progress', {
      task: '1.1 Open task',
      status: 'in-progress',
      reason: 'x',
    })
    const first = JSON.parse(
      await readFile(join(root, '.dsh', 'delegation', 'task-progress', 'change-a.json'), 'utf8'),
    ) as { worktreeDigest: string }
    await writeFile(join(root, 'src', 'untracked.ts'), 'second content')
    await harness.callTool('task_progress', {
      task: '1.1 Open task',
      status: 'in-progress',
      reason: 'x',
    })
    const second = JSON.parse(
      await readFile(join(root, '.dsh', 'delegation', 'task-progress', 'change-a.json'), 'utf8'),
    ) as { worktreeDigest: string }
    expect(first.worktreeDigest).not.toBe(second.worktreeDigest)
  })

  it('rejects a checked task, an unknown task, and never writes a PASS', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [
      { number: '1.1', text: 'Already done', checked: true },
      { number: '1.2', text: 'Still open' },
    ])
    const harness = harnessFor(root)
    await expect(
      harness.callTool('task_progress', {
        task: '1.1 Already done',
        status: 'blocked',
        reason: 'x',
      }),
    ).rejects.toThrow(/is checked; a completed task needs its task-review PASS\/ERROR/)
    await expect(
      harness.callTool('task_progress', { task: 'not a task', status: 'blocked', reason: 'x' }),
    ).rejects.toThrow(/was not found in any active change/)
    await expect(
      harness.callTool('task_progress', { task: '1.2 Still open', status: 'stuck', reason: 'x' }),
    ).rejects.toThrow(/status must be "in-progress" or "blocked"/)
    expect(harness.subagents.startCalls).toBe(0)
  })
})

describe('patch contract', () => {
  it('runs a write target in an isolated worktree and returns the diff without merging', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent-write', { agentOptions: false }, () => ({
      output: [{ type: 'text', text: 'Root cause fixed. Ran pnpm test: 12 passed.' }],
      stopReason: 'completed',
    }))
    const harness = harnessFor(
      root,
      {
        targets: { 'codex-write': { provider: 'codex-subagent-write', write: true } },
        rules: [
          {
            id: 'bug-fix',
            when: 'manual',
            to: 'codex-write',
            contract: 'patch',
            gate: 'none',
            instruction: 'bundled:fix',
            isolation: 'worktree',
          },
        ],
      },
      subagents,
    )
    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine.ts b/packages/engine.ts'
    const result = text(
      await harness.callTool('delegate', { rule: 'bug-fix', objective: 'fix the crash' }),
    )
    expect(result).toContain('isolated worktree .dsh/delegation/worktrees/')
    expect(result).toContain('packages/engine.ts')
    expect(result).toContain('12 passed')
    expect(result).toContain('Nothing was applied to the session worktree')
    const worktreeCall = harness.git.calls.find((call) => call[0] === 'worktree')
    expect(worktreeCall?.slice(0, 3)).toEqual(['worktree', 'add', '--detach'])
    expect(harness.subagents.runs[0]?.cwd).toContain(join('.dsh', 'delegation', 'worktrees'))
    expect(
      harness.git.calls.some((call) =>
        ['merge', 'apply', 'checkout', 'reset'].includes(call[0] ?? ''),
      ),
    ).toBe(false)
  })

  it('requires an objective and a write-capable target before any run', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent-write')
    const harness = harnessFor(
      root,
      {
        targets: { 'codex-write': { provider: 'codex-subagent-write', write: true } },
        rules: [
          {
            id: 'bug-fix',
            when: 'manual',
            to: 'codex-write',
            contract: 'patch',
            gate: 'none',
            instruction: 'bundled:fix',
            isolation: 'worktree',
          },
        ],
      },
      subagents,
    )
    await expect(harness.callTool('delegate', { rule: 'bug-fix' })).rejects.toThrow(
      /needs objective:/,
    )
    expect(subagents.startCalls).toBe(0)
  })
})

describe('tools and status', () => {
  it('registers the three tools, the rule enum, and no always-on prompt section', async () => {
    const root = await workspace()
    const harness = harnessFor(root)
    expect([...harness.tools.keys()].sort()).toEqual([
      'delegate',
      'delegation_status',
      'task_progress',
    ])
    const delegate = harness.tools.get('delegate')
    const parameters = delegate?.parameters as { properties: { rule: { enum: string[] } } }
    expect(parameters.properties.rule.enum).toEqual(['spec-review', 'task-review', 'task-progress'])
    expect(harness.events.has('agent/turn-stopping')).toBe(true)
    expect(harness.events.has('agent/pre-step')).toBe(true)
    expect(harness.events.has('tools/result')).toBe(true)
    const source = await readFile(join(packageDir, 'lib', 'index.js'), 'utf8')
    expect(source).not.toContain('systemPrompt')
  })

  it('rejects an unknown rule with the allowed ids and routes note rules to task_progress', async () => {
    const root = await workspace()
    const harness = harnessFor(root)
    await expect(harness.callTool('delegate', { rule: 'nope' })).rejects.toThrow(
      /unknown rule "nope"; configured rules: spec-review, task-review, task-progress/,
    )
    await expect(harness.callTool('delegate', { rule: 'task-progress' })).rejects.toThrow(
      /use task_progress\(task, status, reason\)/,
    )
    const empty = new Harness({ cwd: root, config: {} })
    await expect(empty.callTool('delegate', { rule: 'nope' })).rejects.toThrow(
      /\(none configured\)/,
    )
  })

  it('reports providers, targets, rules, records, notes, and missing-target diagnostics', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task' }])
    const subagents = new FakeSubagents()
    subagents.addProvider('spawn', { agentOptions: true })
    const harness = harnessFor(
      root,
      {
        targets: {
          dsh: { provider: 'spawn', model: 'deepseek-flash' },
          broken: { provider: 'missing-provider' },
        },
        rules: [
          {
            id: 'spec-review',
            when: 'spec-ready',
            to: 'dsh',
            contract: 'review',
            phase: 'spec',
            scope: 'whole',
            gate: 'strict',
            instruction: 'bundled:review-spec',
          },
          { id: 'task-progress', when: 'implementation-work', contract: 'note', gate: 'strict' },
        ],
      },
      subagents,
    )
    const status = text(await harness.callTool('delegation_status', {}))
    expect(status).toContain('Registered subagent providers:')
    expect(status).toContain('- spawn: agentOptions')
    expect(status).toContain('- dsh: provider=spawn model=deepseek-flash (available)')
    expect(status).toContain('MISSING provider "missing-provider"')
    expect(status).toContain('- spec-review: when=spec-ready contract=review gate=strict')
    expect(status).toContain('change-a (review-ready)')
    expect(status).toContain('spec-review: missing')
    expect(status).toContain('progress note: none')
  })

  it('reports a malformed record instead of trusting it', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const directory = join(root, '.dsh', 'delegation', 'spec-review', 'change-a')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'spec.json'), '{ not json')
    const status = text(await harness.callTool('delegation_status', {}))
    expect(status).toContain('spec-review: malformed')
  })

  it('serves one on-demand skill candidate whose description matches its asset frontmatter', async () => {
    const root = await workspace()
    const harness = harnessFor(root)
    expect(harness.skillProviders).toHaveLength(1)
    const provider = harness.skillProviders[0]
    const candidates = (await provider?.list()) ?? []
    expect(candidates.map((candidate) => candidate.name)).toEqual(['delegation-rules'])
    const candidate = candidates[0]
    expect(candidate?.provider).toBe('dsh-setup-delegation-rules')
    expect(candidate?.rank).toBe(600)
    const asset = await readFile(join(packageDir, 'assets', 'delegation-rules', 'SKILL.md'), 'utf8')
    const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(asset)?.[1] ?? ''
    const description = (/^description:\s*>\s*\n([\s\S]*)$/m.exec(frontmatter)?.[1] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .join(' ')
    expect((candidate?.description ?? '').split(/\s+/).join(' ')).toBe(
      description.split(/\s+/).join(' '),
    )
    const definition = await provider?.get(candidate as never, {})
    expect(definition?.content.startsWith(asset)).toBe(true)
    expect(definition?.content).toContain('first-party guidance')
  })
})

describe('failures and replies', () => {
  it('reports a failed answer, keeps the turn closable, and records the consultation attempt', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.respond = () => ({
      output: [],
      stopReason: 'error',
      diagnostic: 'target unavailable',
    })
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent' } },
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
        failureStreak: 2,
      },
      subagents,
    )
    await harness.preStep(1)
    await harness.toolResult(true)
    await harness.toolResult(true)
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent).join('\n')).toContain('failed tool calls')
    await expect(harness.callTool('delegate', { rule: 'blocker' })).rejects.toThrow(
      /target unavailable/,
    )
    const steersBefore = steerTexts(harness.agent).length
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(steersBefore)
  })
})
