import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createAgent,
  defaultTestConfig,
  FakeSubagents,
  Harness,
  makeWorkspace,
  passResponder,
  type RunRecord,
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

  it('passes the target model and reasoning effort in the subagent start request', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: true })
    const harness = harnessFor(
      root,
      {
        targets: {
          'codex-astra': {
            provider: 'codex-subagent',
            model: 'astra',
            reasoningEffort: 'xhigh',
          },
        },
        rules: [
          {
            id: 'research',
            when: 'manual',
            to: 'codex-astra',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
        ],
      },
      subagents,
    )
    await harness.callTool('delegate', { rule: 'research' })
    expect(subagents.runs[0]?.agentOptions).toEqual({
      model: 'astra',
      reasoningEffort: 'xhigh',
    })
  })

  it('passes an effort-only target and leaves the model to the provider default', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: true })
    const harness = harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent', reasoningEffort: 'xhigh' } },
        rules: [
          {
            id: 'research',
            when: 'manual',
            to: 'codex',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
        ],
      },
      subagents,
    )
    await harness.callTool('delegate', { rule: 'research' })
    expect(subagents.runs[0]?.agentOptions).toEqual({ reasoningEffort: 'xhigh' })
    expect(subagents.runs[0]?.agentOptions).not.toHaveProperty('model')
  })

  it('sends no agent options when the target selects none, even without the capability', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: false })
    const harness = harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent' } },
        rules: [
          {
            id: 'research',
            when: 'manual',
            to: 'codex',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
        ],
      },
      subagents,
    )
    await harness.callTool('delegate', { rule: 'research' })
    expect(subagents.runs[0]?.agentOptions).toBeUndefined()
  })

  it('merges agentOptions under the explicit target model and effort', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: true })
    const harness = harnessFor(
      root,
      {
        targets: {
          codex: {
            provider: 'codex-subagent',
            model: 'astra',
            reasoningEffort: 'xhigh',
            agentOptions: { provider: 'codex-route', model: 'ignored', maxTokens: 4096 },
          },
        },
        rules: [
          {
            id: 'research',
            when: 'manual',
            to: 'codex',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
        ],
      },
      subagents,
    )
    await harness.callTool('delegate', { rule: 'research' })
    expect(subagents.runs[0]?.agentOptions).toEqual({
      provider: 'codex-route',
      model: 'astra',
      reasoningEffort: 'xhigh',
      maxTokens: 4096,
    })
  })

  it('rejects an unsupported reasoning effort with the capability diagnostic', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('spawn', { agentOptions: false })
    const harness = harnessFor(
      root,
      {
        targets: { dsh: { provider: 'spawn', reasoningEffort: 'xhigh' } },
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
      /target "dsh" requests model\/agent options.*does not support them/,
    )
    expect(subagents.startCalls).toBe(0)
  })

  it('reports a provider start rejection with the target id, provider, and next action', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: true })
    subagents.startError = new Error(
      'subagent-codex: unsupported Codex target option "maxTokens" (allowed: model, reasoningEffort)',
    )
    const harness = harnessFor(
      root,
      {
        ...defaultTestConfig(),
        targets: {
          codex: { provider: 'codex-subagent', agentOptions: { maxTokens: 4096 } },
        },
      },
      subagents,
    )
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    ).rejects.toThrow(
      /rule "spec-review": target "codex" on provider "codex-subagent" could not start: .*unsupported Codex target option "maxTokens".*check targets\.codex options against provider "codex-subagent"/,
    )
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string }
    expect(record.verdict).toBe('ERROR')
  })

  it('records the resolved model and effort as target identity', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: true })
    const harness = harnessFor(
      root,
      {
        ...defaultTestConfig(),
        targets: {
          codex: { provider: 'codex-subagent', model: 'astra', reasoningEffort: 'xhigh' },
        },
      },
      subagents,
    )
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    expect(subagents.runs[0]?.agentOptions).toEqual({
      model: 'astra',
      reasoningEffort: 'xhigh',
    })
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { target: Record<string, unknown>; runId: string }
    expect(record.target).toEqual({
      provider: 'codex-subagent',
      model: 'astra',
      reasoningEffort: 'xhigh',
    })
    expect(record.runId).toBe(runId)
  })
})

describe('review records', () => {
  it('starts a background run, returns a handle, writes PASS, and reuses it', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: false })
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(runId).toMatch(/^run-/)
    expect(await harness.waitForRun(runId)).toContain('state=completed')
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
      runId,
    })
    expect(String(record.digest)).toMatch(/^[0-9a-f]{64}$/)
    expect(typeof record.time).toBe('string')
    expect(JSON.stringify(record)).not.toContain(root)

    const second = text(
      await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    expect(second).toContain('reused record')
    expect(subagents.startCalls).toBe(1)

    await writeFile(
      join(root, 'openspec', 'changes', 'change-a', 'specs', 'capability', 'spec.md'),
      '# Spec\n\nChanged.\n',
    )
    const rerun = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(rerun)).toContain('state=completed')
    expect(subagents.startCalls).toBe(2)
  })

  it('ignores a checkbox-only tasks.md edit in the whole-spec digest', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task' }])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    await harness.waitForRun(runId)
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
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; findings: Array<{ severity: string; evidence: string }> }
    expect(record.verdict).toBe('FINDINGS')
    expect(record.findings[0]?.severity).toBe('P0')
    const rendered = text(
      await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    expect(rendered).toContain('reused record')
    expect(rendered).toContain('P0 Missing failure path')
    expect(rendered).not.toContain('secret.ts')
    expect(rendered).not.toContain('ABCDEFGH12345678')
    expect(subagents.startCalls).toBe(1)
  })

  it('writes an ERROR record and failed state when the verdict is malformed', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.respond = () => ({
      output: [{ type: 'text', text: 'Everything looks fine.' }],
      stopReason: 'completed',
    })
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('no fenced JSON verdict')
  })

  it('writes an ERROR record and failed state when the target run fails', async () => {
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
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('model transport failed')
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
    const failedRun = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    await harness.waitForRun(failedRun)
    const directory = join(root, '.dsh', 'delegation', 'spec-review', 'change-a')
    expect(await readdir(directory)).toEqual(['spec.json'])
    subagents.respond = passResponder
    const retryRun = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(retryRun)).toContain('state=completed')
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
      const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
      expect(await harness.waitForRun(runId)).toContain('state=failed')
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
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string; error: string }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('did not finish within 5 ms')
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
    const handle = await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' })
    const runId = runIdFrom(handle)
    expect(handle).toMatch(/task id: [0-9a-f]{16}/)
    const taskId = /task id: ([0-9a-f]{16})/.exec(handle)?.[1] as string
    expect(await harness.waitForRun(runId)).toContain('state=completed')
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
    const reused = await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' })
    expect(reused).toContain('reused record')
    expect(subagents.startCalls).toBe(1)

    // Changing the task text changes its id and requires a new review.
    await writeFile(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [x] 1.1 First task restated\n\n- [ ] 1.2 Second task\n',
    )
    const rerun = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(await harness.waitForRun(rerun)).toContain('state=completed')
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
    const firstRun = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(await harness.waitForRun(firstRun)).toContain('state=completed')
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
    const fixedRun = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(await harness.waitForRun(fixedRun)).toContain('state=completed')
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
          dsh: { provider: 'spawn', model: 'deepseek-flash', reasoningEffort: 'max' },
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
    expect(status).toContain(
      '- dsh: provider=spawn model=deepseek-flash reasoningEffort=max (available)',
    )
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

describe('thread-scoped ownership', () => {
  const owner = (): ReturnType<typeof createAgent> => createAgent('thread-a')
  const foreign = (): ReturnType<typeof createAgent> => createAgent('thread-b')

  async function ownerOf(root: string): Promise<string | undefined> {
    const name = createHash('sha256').update('change-a').digest('hex').slice(0, 16)
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

  it('refuses a foreign review before starting a target and names the owner', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    await harness.callTool('delegation_status', {}, owner())
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }, foreign()),
    ).rejects.toThrow(
      /change "change-a" is owned by thread "thread-a"; run this review in that thread.*reset the owner/,
    )
    expect(subagents.startCalls).toBe(0)
  })

  it('writes the owning session into the record and reports owner/current in status', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' }, owner())
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { session?: string }
    expect(record.session).toBe('thread-a')

    const ownerStatus = text(await harness.callTool('delegation_status', {}, owner()))
    expect(ownerStatus).toContain('owner=thread-a (current thread)')
    const foreignStatus = text(await harness.callTool('delegation_status', {}, foreign()))
    expect(foreignStatus).toContain('owner=thread-a (foreign thread)')
    expect(subagents.startCalls).toBe(1)
  })

  it('keeps a legacy record without a session field readable and reusable', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const path = join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json')
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' }, owner())
    await harness.waitForRun(runId)
    const legacy = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    delete legacy.session
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    const reused = text(
      await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }, owner()),
    )
    expect(reused).toContain('reused record')
    expect(reused).not.toContain('session:')
    expect(subagents.startCalls).toBe(1)
  })

  it('keeps task_progress notes and answer runs available in a foreign thread', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task' }])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(
      root,
      {
        ...defaultTestConfig(),
        rules: [
          ...(defaultTestConfig().rules ?? []),
          {
            id: 'research',
            when: 'manual',
            to: 'codex',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
        ],
      },
      subagents,
    )
    await harness.callTool('delegation_status', {}, owner())
    const note = text(
      await harness.callTool(
        'task_progress',
        { task: '1.1 Open task', status: 'in-progress', reason: 'midway' },
        foreign(),
      ),
    )
    expect(note).toContain('progress note written')
    expect(await ownerOf(root)).toBe('thread-a')

    const answer = text(
      await harness.callTool('delegate', { rule: 'research', change: 'change-a' }, foreign()),
    )
    expect(answer).toContain('does not satisfy a strict review rule')
    expect(subagents.startCalls).toBe(1)
    expect(await ownerOf(root)).toBe('thread-a')
  })

  it('keeps a patch delegation available in a foreign thread without changing the owner', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    subagents.addProvider('codex-subagent-write', {}, () => ({
      output: [{ type: 'text', text: 'Root cause fixed. Ran pnpm test: 12 passed.' }],
      stopReason: 'completed',
    }))
    const harness = harnessFor(
      root,
      {
        ...defaultTestConfig(),
        rules: [
          ...(defaultTestConfig().rules ?? []),
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
    await harness.callTool('delegation_status', {}, owner())
    expect(await ownerOf(root)).toBe('thread-a')
    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine.ts b/packages/engine.ts'

    const patch = text(
      await harness.callTool(
        'delegate',
        { rule: 'bug-fix', objective: 'fix the crash', change: 'change-a' },
        foreign(),
      ),
    )
    expect(patch).toContain('isolated worktree .dsh/delegation/worktrees/')
    expect(patch).toContain('packages/engine.ts')
    expect(patch).toContain('Nothing was applied to the session worktree')
    expect(subagents.startCalls).toBe(1)
    expect(subagents.runs[0]?.cwd).toContain(join('.dsh', 'delegation', 'worktrees'))
    expect(await ownerOf(root)).toBe('thread-a')

    // A patch run must not unblock a foreign review of the same change.
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }, foreign()),
    ).rejects.toThrow(/owned by thread "thread-a"/)
    expect(subagents.startCalls).toBe(1)
  })
})

describe('settlement observer', () => {
  it('notifies once after the run settles, never while it is running', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    let release: (() => void) | undefined
    subagents.addProvider(
      'codex-subagent',
      {},
      (run) =>
        new Promise((resolve) => {
          release = () => resolve(passResponder(run))
        }),
    )
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(harness.settledRuns).toEqual([])
    release?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    expect(harness.settledRuns).toEqual([{ runId, state: 'completed' }])
  })

  it('reports a failed run once', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, () => ({
      output: [],
      stopReason: 'error',
      diagnostic: 'target unavailable',
    }))
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    expect(harness.settledRuns).toEqual([{ runId, state: 'failed' }])
  })

  it('keeps records, status, and the gate working when the observer is omitted', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await writeChange(root, 'change-b', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, passResponder)
    const seed = harnessFor(root, defaultTestConfig(), subagents)
    const seedRun = await seed.startReview({ rule: 'spec-review', change: 'change-a' })
    await seed.waitForRun(seedRun)

    const harness = new Harness({
      cwd: root,
      config: defaultTestConfig(),
      agents: subagents,
      observeSettlements: false,
    })
    await harness.preStep(1)
    const reused = text(
      await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }),
    )
    expect(reused).toContain('reused record')

    subagents.startError = new Error('target unavailable')
    await expect(
      harness.callTool('delegate', { rule: 'spec-review', change: 'change-b' }),
    ).rejects.toThrow(/could not start: target unavailable/)
    const failed = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-b', 'spec.json'),
        'utf8',
      ),
    ) as { verdict: string }
    expect(failed.verdict).toBe('ERROR')
    expect(harness.settledRuns).toEqual([])

    const status = await harness.toolText('delegation_status', {})
    expect(status).toContain(`run ${seedRun}`)
    expect(status).toMatch(/run run-.*: .*state=failed/)
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })
})

describe('asynchronous review runs', () => {
  function deferred() {
    const releases: Array<() => void> = []
    return {
      responder: (run: RunRecord): Promise<ReturnType<typeof passResponder>> =>
        new Promise((resolve) => {
          releases.push(() => resolve(passResponder(run)))
        }),
      releases,
    }
  }

  async function specRecord(root: string): Promise<Record<string, unknown>> {
    return JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as Record<string, unknown>
  }

  it('starts a review in the background and lets the turn continue', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task' }])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const handle = await harness.toolText('delegate', {
      rule: 'spec-review',
      change: 'change-a',
    })
    const runId = runIdFrom(handle)
    expect(handle).toContain('review started')
    expect(handle).toContain('record: .dsh/delegation/spec-review/change-a/spec.json')
    expect(handle).toContain('The run continues in the background; the turn can continue.')
    expect(subagents.startCalls).toBe(1)
    await expect(
      readFile(join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json')),
    ).rejects.toThrow()

    // The turn is not blocked: another tool call works while the run is pending.
    const status = await harness.toolText('delegation_status', {})
    expect(status).toMatch(new RegExp(`run ${runId}: .*state=running`))
    const note = await harness.toolText('task_progress', {
      task: '1.1 Open task',
      status: 'in-progress',
      reason: 'while the review runs',
    })
    expect(note).toContain('progress note written')

    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    expect(await specRecord(root)).toMatchObject({ verdict: 'PASS', runId })

    // Run state is durable scratch: a fresh engine still reports the completed run.
    const restarted = harnessFor(root, defaultTestConfig())
    const restartedStatus = await restarted.toolText('delegation_status', {})
    expect(restartedStatus).toMatch(new RegExp(`run ${runId}: .*state=completed`))
  })

  it('returns the existing handle for a duplicate pending identity and starts nothing', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const first = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    const runId = runIdFrom(first)
    const duplicate = await harness.toolText('delegate', {
      rule: 'spec-review',
      change: 'change-a',
    })
    expect(duplicate).toContain('review already pending')
    expect(duplicate).toContain(`run: ${runId}`)
    expect(subagents.startCalls).toBe(1)
    pending.releases.shift()?.()
    await harness.waitForRun(runId)
  })

  it('queues different rules on the same task, serializes them, and writes both records', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Shared task', checked: true }])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(
      root,
      {
        ...defaultTestConfig(),
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
          {
            id: 'task-review-extra',
            when: 'spec-task-ready',
            to: 'codex',
            contract: 'review',
            scope: 'task',
            gate: 'soft',
            instruction: 'bundled:review-task',
          },
        ],
      },
      subagents,
    )
    const first = await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' })
    const firstRun = runIdFrom(first)
    const taskId = /task id: ([0-9a-f]{16})/.exec(first)?.[1] as string
    const second = await harness.toolText('delegate', {
      rule: 'task-review-extra',
      change: 'change-a',
      task: taskId,
    })
    const secondRun = runIdFrom(second)
    expect(secondRun).not.toBe(firstRun)
    expect(second).toContain('review queued')
    expect(subagents.startCalls).toBe(1)
    expect(harness.settledRuns).toEqual([])
    const queuedStatus = await harness.toolText('delegation_status', {})
    expect(queuedStatus).toMatch(new RegExp(`run ${firstRun}: .*state=running`))
    expect(queuedStatus).toMatch(new RegExp(`run ${secondRun}: .*state=queued`))

    pending.releases.shift()?.()
    await harness.waitForRun(firstRun)
    expect(harness.settledRuns).toEqual([{ runId: firstRun, state: 'completed' }])
    await subagents.waitForStarts(2)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(secondRun)).toContain('state=completed')
    expect(harness.settledRuns).toEqual([
      { runId: firstRun, state: 'completed' },
      { runId: secondRun, state: 'completed' },
    ])
    expect(
      await readFile(
        join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks', `${taskId}.json`),
        'utf8',
      ),
    ).toContain('"verdict": "PASS"')
    expect(
      await readFile(
        join(
          root,
          '.dsh',
          'delegation',
          'task-review-extra',
          'change-a',
          'tasks',
          `${taskId}.json`,
        ),
        'utf8',
      ),
    ).toContain('"verdict": "PASS"')
  })

  it('discards a late completion that cannot replace the authoritative record', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const firstSubagents = new FakeSubagents()
    const secondSubagents = new FakeSubagents()
    const firstPending = deferred()
    const secondPending = deferred()
    firstSubagents.addProvider('codex-subagent', {}, firstPending.responder)
    secondSubagents.addProvider('codex-subagent', {}, secondPending.responder)
    const first = harnessFor(root, defaultTestConfig(), firstSubagents)
    const second = harnessFor(root, defaultTestConfig(), secondSubagents)
    const firstRun = await first.startReview({ rule: 'spec-review', change: 'change-a' })
    const secondRun = await second.startReview({ rule: 'spec-review', change: 'change-a' })

    firstPending.releases.shift()?.()
    expect(await first.waitForRun(firstRun)).toContain('state=completed')
    const authoritative = await specRecord(root)
    expect(authoritative.runId).toBe(firstRun)

    secondPending.releases.shift()?.()
    expect(await second.waitForRun(secondRun)).toContain('state=discarded')
    const record = await specRecord(root)
    expect(record.runId).toBe(firstRun)
    expect(record.verdict).toBe('PASS')
  })

  it('reviews an explicit task, rejects unknown/unchecked tasks, and runs different tasks in parallel', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [
      { number: '1.1', text: 'First task', checked: true },
      { number: '1.2', text: 'Second task', checked: true },
      { number: '1.3', text: 'Unchecked task' },
    ])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent' } },
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
        ],
      },
      subagents,
    )
    await expect(
      harness.callTool('delegate', {
        rule: 'spec-review',
        change: 'change-a',
        task: '1.1 First task',
      }),
    ).rejects.toThrow(/reviews the whole scope; omit task/)
    await expect(
      harness.callTool('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task: '9.9 Ghost task',
      }),
    ).rejects.toThrow(/was not found.*allowed checked tasks/)
    await expect(
      harness.callTool('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task: '1.3 Unchecked task',
      }),
    ).rejects.toThrow(/is not checked.*Allowed checked tasks/)
    expect(subagents.startCalls).toBe(0)

    const first = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task: '1.1 First task',
    })
    const second = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task: '1.2 Second task',
    })
    expect(subagents.startCalls).toBe(2)
    for (const release of pending.releases) release()
    await harness.waitForRun(runIdFrom(first))
    await harness.waitForRun(runIdFrom(second))
    const tasksDir = join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks')
    const records = (await readdir(tasksDir)).filter((name) => name.endsWith('.json'))
    expect(records).toHaveLength(2)
    const taskIds = new Set(
      await Promise.all(
        records.map(async (name) => {
          const record = JSON.parse(await readFile(join(tasksDir, name), 'utf8')) as {
            taskId: string
          }
          return record.taskId
        }),
      ),
    )
    expect(taskIds.size).toBe(2)
  })

  it('publishes no PASS when a reviewed file is edited and restored during the run', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src', 'engine.ts')
    await writeFile(file, 'original content\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(
      root,
      {
        targets: { codex: { provider: 'codex-subagent' } },
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
      },
      subagents,
    )
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(subagents.startCalls).toBe(1)
    // Edit, read, restore: content ends identical and a digest re-check would pass.
    await writeFile(file, 'temporary edit\n', 'utf8')
    expect(await readFile(file, 'utf8')).toBe('temporary edit\n')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(file, 'original content\n', 'utf8')
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const tasksDir = join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks')
    const [recordName] = await readdir(tasksDir)
    const record = JSON.parse(await readFile(join(tasksDir, recordName as string), 'utf8')) as {
      verdict: string
      error: string
    }
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('reviewed inputs changed during the run')
  })
})
