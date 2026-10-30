import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  createReviewSnapshot,
  defaultGit,
  discardReviewSnapshot,
  specDigest,
  startSnapshotLease,
  stopSnapshotLease,
  sweepReviewSnapshots,
} from '../lib/index.js'
import {
  type BundleConfigLike,
  createAgent,
  defaultTestConfig,
  FakeGit,
  FakeSubagents,
  type GitRunner,
  Harness,
  makeWorkspace,
  passResponder,
  type RunRecord,
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
  runGit?: GitRunner,
): Harness {
  return new Harness({
    cwd: root,
    config,
    agents: subagents,
    ...(runGit === undefined ? {} : { runGit }),
  })
}

function taskReviewConfig(): BundleConfigLike {
  return {
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
  }
}

function integrationReviewConfig(): BundleConfigLike {
  return {
    targets: { codex: { provider: 'codex-subagent' } },
    rules: [
      {
        id: 'integration-review',
        when: 'implementation-complete',
        to: 'codex',
        contract: 'review',
        phase: 'integration',
        scope: 'whole',
        gate: 'soft',
        instruction: 'bundled:review-integration',
      },
    ],
  }
}

/** Real git, for the temporary-repository integration case. */
function realGit(): GitRunner {
  return (args, cwd, signal) =>
    new Promise<Buffer>((done, failed) => {
      execFile(
        'git',
        [...args],
        { cwd, signal, encoding: 'buffer', maxBuffer: 16 * 1024 * 1024, windowsHide: true },
        (error, stdout) => {
          if (error !== null) failed(error)
          else done(stdout)
        },
      )
    })
}

async function taskRecord(root: string): Promise<{ verdict: string; error?: string }> {
  const tasksDir = join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks')
  const [name] = await readdir(tasksDir)
  return JSON.parse(await readFile(join(tasksDir, name as string), 'utf8')) as {
    verdict: string
    error?: string
  }
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

  it('runs the shipped worker tiers on the in-process provider with their effort', async () => {
    const root = await workspace()
    const subagents = new FakeSubagents()
    subagents.addProvider('spawn', { agentOptions: true }, () => ({
      output: [{ type: 'text', text: 'Sweep result with evidence.' }],
      stopReason: 'completed',
    }))
    const fragment = parse(readFileSync(join(packageDir, 'cordis.fragment.yml'), 'utf8')) as {
      rows: Array<{ config: BundleConfigLike }>
    }
    const harness = harnessFor(root, fragment.rows[0]?.config, subagents)
    expect(
      await harness.toolText('delegate', { rule: 'worker-fast', objective: 'List callers' }),
    ).toContain('Sweep result')
    await harness.callTool('delegate', { rule: 'worker-deep', objective: 'Explain the bug' })
    expect(subagents.runs.map((run) => run.provider)).toEqual(['spawn', 'spawn'])
    expect(subagents.runs[0]?.agentOptions).toEqual({ reasoningEffort: 'high' })
    expect(subagents.runs[1]?.agentOptions).toEqual({ reasoningEffort: 'max' })
  })

  it('reports an unavailable worker provider with the target next action and no record', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', { agentOptions: false })
    const harness = harnessFor(
      root,
      {
        targets: { 'worker-fast': { provider: 'spawn', reasoningEffort: 'high' } },
        rules: [
          {
            id: 'worker-fast',
            when: 'manual',
            to: 'worker-fast',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
        ],
      },
      subagents,
    )
    await expect(harness.callTool('delegate', { rule: 'worker-fast' })).rejects.toThrow(
      /target "worker-fast" names provider "spawn", which is not registered.*install or enable that provider/,
    )
    expect(subagents.startCalls).toBe(0)
    expect(await readdir(join(root, '.dsh', 'delegation')).catch(() => [] as string[])).toEqual([])
    const status = await harness.toolText('delegation_status', {})
    expect(status).toContain('MISSING provider "spawn"')
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
    expect(await readdir(join(root, '.dsh', 'delegation', 'snapshots'))).toEqual([])
    expect(await readdir(join(root, '.dsh', 'delegation', 'scratch'))).toEqual([])
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
    expect(await readdir(join(root, '.dsh', 'delegation', 'snapshots'))).toEqual([])

    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine.ts b/packages/engine.ts'
    const fixedRun = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(await harness.waitForRun(fixedRun)).toContain('state=completed')
    expect(subagents.startCalls).toBe(2)
  })

  it('reuses unchanged FINDINGS across snapshot times in a real repository', async () => {
    const root = await workspace()
    await defaultGit(['init', '-q'], root)
    await writeFile(join(root, '.gitignore'), '.dsh/\n')
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    await defaultGit(['add', '.gitignore', 'src/engine.ts', 'openspec'], root)
    await defaultGit(
      ['-c', 'user.name=test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'base'],
      root,
    )
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, findingsResponder('FINDINGS', 'P1'))
    const harness = harnessFor(root, taskReviewConfig(), subagents, defaultGit)
    const firstRun = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(await harness.waitForRun(firstRun)).toContain('state=completed')
    expect(subagents.startCalls).toBe(1)
    expect((await taskRecord(root)).verdict).toBe('FINDINGS')

    // A later attempt builds a new snapshot commit with the same content; the
    // digest must not include the timestamp-dependent commit identity.
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const reused = text(
      await harness.callTool('delegate', { rule: 'task-review', change: 'change-a' }),
    )
    expect(reused).toContain('reused record')
    expect(subagents.startCalls).toBe(1)
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

describe('session involvement', () => {
  const owner = (): ReturnType<typeof createAgent> => createAgent('thread-a')
  const foreign = (): ReturnType<typeof createAgent> => createAgent('thread-b')

  it('attributes a first-party write at turn-stopping and reports it in status', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task' }])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const agent = owner()
    await harness.preStep(1, agent)
    await harness.writeResult(
      join(dir, 'proposal.md'),
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
      agent,
      'edit',
    )
    await harness.turnStopping(1, agent)
    expect(await harness.readInvolvement('thread-a')).toEqual({
      session: 'thread-a',
      changes: {
        'change-a': { created: false, specChanged: true, tasks: [], completed: false },
      },
    })
    const status = text(await harness.callTool('delegation_status', {}, agent))
    expect(status).toContain('this session: spec changed / 0 checked task(s)')
    expect(status).toContain('spec-review: missing')
  })

  it('does not attribute a fresh observer of a change with old checked tasks', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Old task', checked: true }])
    const harness = harnessFor(root, defaultTestConfig())
    const agent = owner()
    await harness.preStep(1, agent)
    await harness.turnStopping(1, agent)
    expect(steerTexts(agent)).toHaveLength(0)
    expect(await harness.readInvolvement('thread-a')).toBeUndefined()
    const status = text(await harness.callTool('delegation_status', {}, agent))
    expect(status).toContain('this session: not involved')
  })

  it('starts a review from an uninvolved session, records it, and attributes the change', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const reviewer = foreign()
    const run = await harness.startReview({ rule: 'spec-review', change: 'change-a' }, reviewer)
    expect(await harness.waitForRun(run, reviewer)).toContain('state=completed')
    const record = JSON.parse(
      await readFile(
        join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json'),
        'utf8',
      ),
    ) as { session: string }
    expect(record.session).toBe('thread-b')
    expect(await harness.readInvolvement('thread-b')).toEqual({
      session: 'thread-b',
      changes: {
        'change-a': { created: false, specChanged: false, tasks: [], completed: false },
      },
    })
    expect(await harness.readInvolvement('thread-a')).toBeUndefined()
  })

  it('does not attribute an answer delegate with a change argument or a status poll', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const config = defaultTestConfig({
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
    })
    const harness = harnessFor(root, config, subagents)
    const agent = foreign()
    await harness.callTool('delegation_status', {}, agent)
    expect(await harness.readInvolvement('thread-b')).toBeUndefined()
    const answer = await harness.toolText(
      'delegate',
      { rule: 'research', change: 'change-a' },
      agent,
    )
    expect(answer).toContain('does not satisfy a strict review rule')
    expect(await harness.readInvolvement('thread-b')).toBeUndefined()
  })

  it('attributes an explicit task_progress note from any session', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task' }])
    const harness = harnessFor(root, defaultTestConfig())
    const agent = foreign()
    await harness.callTool('delegation_status', {}, agent)
    expect(await harness.readInvolvement('thread-b')).toBeUndefined()
    const note = await harness.toolText(
      'task_progress',
      { task: '1.1 Open task', status: 'in-progress', reason: 'midway' },
      agent,
    )
    expect(note).toContain('progress note written')
    expect(await harness.readInvolvement('thread-b')).toEqual({
      session: 'thread-b',
      changes: {
        'change-a': { created: false, specChanged: false, tasks: [], completed: false },
      },
    })
  })

  it('preserves both changes under concurrent explicit attribution', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task A' }])
    await writeChange(root, 'change-b', [{ number: '1.1', text: 'Open task B' }])
    const harness = harnessFor(root, defaultTestConfig())
    const agent = createAgent('thread-a')
    await Promise.all([
      harness.toolText(
        'task_progress',
        { task: '1.1 Open task A', status: 'in-progress', reason: 'midway' },
        agent,
      ),
      harness.toolText(
        'task_progress',
        { task: '1.1 Open task B', status: 'in-progress', reason: 'midway' },
        agent,
      ),
    ])
    const involvement = await harness.readInvolvement('thread-a')
    expect(Object.keys(involvement?.changes ?? {}).sort()).toEqual(['change-a', 'change-b'])
  })

  it('ignores legacy owner files', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const legacy = join(root, '.dsh', 'delegation', 'owners')
    await mkdir(legacy, { recursive: true })
    const name = createHash('sha256').update('change-a').digest('hex').slice(0, 16)
    await writeFile(
      join(legacy, `${name}.json`),
      JSON.stringify({ change: 'change-a', session: 'thread-a' }),
    )
    const harness = harnessFor(root, defaultTestConfig())
    const agent = owner()
    await harness.preStep(1, agent)
    await harness.turnStopping(1, agent)
    expect(steerTexts(agent)).toHaveLength(0)
    expect(await harness.readInvolvement('thread-a')).toBeUndefined()
    expect(await harness.toolText('delegation_status', {}, agent)).toContain(
      'this session: not involved',
    )
  })

  it('keeps a legacy record without a session field readable and reusable', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, defaultTestConfig(), subagents)
    const agent = owner()
    const path = join(root, '.dsh', 'delegation', 'spec-review', 'change-a', 'spec.json')
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' }, agent)
    await harness.waitForRun(runId)
    const legacy = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
    delete legacy.session
    await writeFile(path, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8')
    const reused = text(
      await harness.callTool('delegate', { rule: 'spec-review', change: 'change-a' }, agent),
    )
    expect(reused).toContain('reused record')
    expect(reused).not.toContain('session:')
    expect(subagents.startCalls).toBe(1)
  })

  it('keeps task_progress, answer, and patch runs available in any session', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Open task' }])
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
            id: 'research',
            when: 'manual',
            to: 'codex',
            contract: 'answer',
            gate: 'none',
            instruction: 'bundled:research',
          },
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
    const patchAgent = owner()
    const answerAgent = createAgent('thread-c')
    await harness.preStep(1, patchAgent)
    const note = await harness.toolText(
      'task_progress',
      { task: '1.1 Open task', status: 'in-progress', reason: 'midway' },
      patchAgent,
    )
    expect(note).toContain('progress note written')
    expect(await harness.readInvolvement('thread-a')).toBeDefined()

    const answer = await harness.toolText(
      'delegate',
      { rule: 'research', change: 'change-a' },
      answerAgent,
    )
    expect(answer).toContain('does not satisfy a strict review rule')
    expect(await harness.readInvolvement('thread-c')).toBeUndefined()

    harness.git.status = ' M packages/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine.ts b/packages/engine.ts'
    const patch = await harness.toolText(
      'delegate',
      { rule: 'bug-fix', objective: 'fix the crash', change: 'change-a' },
      patchAgent,
    )
    expect(patch).toContain('isolated worktree .dsh/delegation/worktrees/')
    expect(patch).toContain('Nothing was applied to the session worktree')
    expect(subagents.startCalls).toBe(2)
    expect(await harness.readInvolvement('thread-a')).toBeDefined()
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

  /** A controllable FINDINGS responder: no portable record is written. */
  function deferredFindings() {
    const releases: Array<() => void> = []
    return {
      responder: async (run: RunRecord) => {
        await new Promise<void>((resolve) => releases.push(resolve))
        return findingsResponder('FINDINGS', 'P1')(run)
      },
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
    expect((await harness.readInvolvement())?.changes['change-a']?.tasks).toEqual(
      expect.arrayContaining([taskIdFor('First task'), taskIdFor('Second task')]),
    )
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

  it('publishes PASS when a reviewed file is edited and restored during the run', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src', 'engine.ts')
    await writeFile(file, 'original content\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    // The reviewed input set is the git-visible list, so declare the file git exposes.
    harness.git.files = ['src/engine.ts']
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(subagents.startCalls).toBe(1)
    // Edit, read, restore: the live worktree changes, the frozen snapshot does not.
    await writeFile(file, 'temporary edit\n', 'utf8')
    expect(await readFile(file, 'utf8')).toBe('temporary edit\n')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(file, 'original content\n', 'utf8')
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    expect((await taskRecord(root)).verdict).toBe('PASS')
  })

  it('falls back to the live input guard when the snapshot is unavailable', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src', 'engine.ts')
    await writeFile(file, 'original content\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/engine.ts']
    harness.git.failSnapshot = true
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(subagents.startCalls).toBe(1)
    await writeFile(file, 'temporary edit\n', 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 10))
    await writeFile(file, 'original content\n', 'utf8')
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const record = await taskRecord(root)
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('reviewed inputs changed during the run')
    expect(record.error).toContain('finish the writes, then re-run the review')
  })

  it('captures the live signature before hashing the fallback digests', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src', 'engine.ts')
    await writeFile(file, 'original content\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/engine.ts']
    harness.git.failSnapshot = true
    let edited = false
    // The edit lands while the fallback digest is computed, after the input
    // signature; the completion check must catch it.
    harness.git.beforeReturn = async (args) => {
      if (!edited && args[0] === 'status') {
        edited = true
        await writeFile(file, 'changed during digest\n', 'utf8')
      }
    }
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const record = await taskRecord(root)
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('reviewed inputs changed during the run')
  })

  it('discards the fallback review when a tracked input is deleted during the run', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src', 'tracked.ts')
    await writeFile(file, 'tracked content\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/tracked.ts']
    harness.git.failSnapshot = true
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    await rm(file)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    const record = await taskRecord(root)
    expect(record.verdict).toBe('ERROR')
    expect(record.error).toContain('reviewed inputs changed')
    expect(record.error).toContain('src/tracked.ts')
  })

  it('publishes PASS when a tracked input is deleted during the snapshot review', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    const file = join(root, 'src', 'tracked.ts')
    await writeFile(file, 'tracked content\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/tracked.ts']
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    await rm(file)
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    expect((await taskRecord(root)).verdict).toBe('PASS')
  })

  it('publishes PASS when a new untracked file appears during the snapshot review', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'added.ts'), 'export const added = true\n', 'utf8')
    harness.git.files.push('src/added.ts')
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    expect((await taskRecord(root)).verdict).toBe('PASS')
  })

  it('publishes PASS when a gitignored change artifact changes during a task review', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [
      { number: '1.1', text: 'Reviewed task', checked: true },
    ])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    // The change directory is not in the git list: these artifacts are gitignored here.
    harness.git.files = ['src/engine.ts']
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nEdited during the run.\n', 'utf8')
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    expect((await taskRecord(root)).verdict).toBe('PASS')
  })

  it('publishes PASS when a file under a formerly excluded directory changes during the snapshot review', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'node_modules', 'vendor'), { recursive: true })
    const file = join(root, 'node_modules', 'vendor', 'tracked.js')
    await writeFile(file, 'module.exports = 1\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['node_modules/vendor/tracked.js']
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    await writeFile(file, 'module.exports = 2\n', 'utf8')
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    expect((await taskRecord(root)).verdict).toBe('PASS')
  })

  it('runs the reviewer in the snapshot worktree and names the frozen state', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/engine.ts']
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    const run = subagents.runs[0]
    expect(run?.cwd).toContain(join('.dsh', 'delegation', 'snapshots'))
    expect(run?.prompt).toContain('frozen worktree snapshot')
    pending.releases.shift()?.()
    await harness.waitForRun(runId)
  })

  it('removes the snapshot and its lease when the review settles', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/engine.ts']
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    const snapshots = join(root, '.dsh', 'delegation', 'snapshots')
    expect((await readdir(snapshots)).length).toBeGreaterThan(0)
    pending.releases.shift()?.()
    await harness.waitForRun(runId)
    expect(await readdir(snapshots)).toEqual([])
  })

  it('removes the snapshot when the target fails', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent', {}, () => {
      throw new Error('target failed')
    })
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/engine.ts']
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    expect(await readdir(join(root, '.dsh', 'delegation', 'snapshots'))).toEqual([])
    expect(await readdir(join(root, '.dsh', 'delegation', 'scratch'))).toEqual([])
  })

  it('removes the snapshot when the review times out', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, { ...taskReviewConfig(), timeouts: { review: 50 } }, subagents)
    harness.git.files = ['src/engine.ts']
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    expect(await harness.waitForRun(runId)).toContain('state=failed')
    expect(await readdir(join(root, '.dsh', 'delegation', 'snapshots'))).toEqual([])
    expect(await readdir(join(root, '.dsh', 'delegation', 'scratch'))).toEqual([])
  })

  it('removes the snapshot when the target cannot start', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    subagents.startError = new Error('cannot start')
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/engine.ts']
    await expect(harness.startReview({ rule: 'task-review', change: 'change-a' })).rejects.toThrow(
      /could not start/,
    )
    expect(await readdir(join(root, '.dsh', 'delegation', 'snapshots'))).toEqual([])
    expect(await readdir(join(root, '.dsh', 'delegation', 'scratch'))).toEqual([])
  })

  it('removes the snapshot when a late completion is discarded', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const firstAgents = new FakeSubagents()
    const secondAgents = new FakeSubagents()
    const firstPending = deferredFindings()
    const secondPending = deferredFindings()
    firstAgents.addProvider('codex-subagent', {}, firstPending.responder)
    secondAgents.addProvider('codex-subagent', {}, secondPending.responder)
    const firstGit = new FakeGit()
    const secondGit = new FakeGit()
    firstGit.files = ['src/engine.ts']
    secondGit.files = ['src/engine.ts']
    const first = harnessFor(root, taskReviewConfig(), firstAgents, firstGit.run)
    const second = harnessFor(root, taskReviewConfig(), secondAgents, secondGit.run)
    const firstRun = await first.startReview({ rule: 'task-review', change: 'change-a' })
    const secondRun = await second.startReview({ rule: 'task-review', change: 'change-a' })
    firstPending.releases.shift()?.()
    expect(await first.waitForRun(firstRun)).toContain('state=completed')
    secondPending.releases.shift()?.()
    expect(await second.waitForRun(secondRun)).toContain('state=discarded')
    expect(await readdir(join(root, '.dsh', 'delegation', 'snapshots'))).toEqual([])
    expect(await readdir(join(root, '.dsh', 'delegation', 'scratch'))).toEqual([])
  })

  it('writes the lease before the snapshot worktree is created', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    harness.git.files = ['src/engine.ts']
    let leaseBeforeAdd = false
    harness.git.beforeReturn = async (args) => {
      if (args[0] === 'worktree' && args[1] === 'add') {
        const files = await readdir(join(root, '.dsh', 'delegation', 'snapshots'))
        leaseBeforeAdd = files.some((name) => name.endsWith('.lease'))
      }
    }
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    pending.releases.shift()?.()
    await harness.waitForRun(runId)
    expect(leaseBeforeAdd).toBe(true)
  })

  it('fails when the selected task changed in the frozen tasks.md', async () => {
    const root = await workspace()
    const dir = await writeChange(root, 'change-a', [
      { number: '1.1', text: 'First task', checked: true },
    ])
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const harness = harnessFor(root, taskReviewConfig(), subagents)
    let edited = false
    harness.git.beforeReturn = async (args) => {
      // The edit lands after the live pre-check and before the snapshot copy.
      if (!edited && args[0] === 'check-ignore') {
        edited = true
        await writeFile(join(dir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Renamed task\n', 'utf8')
      }
    }
    await expect(harness.startReview({ rule: 'task-review', change: 'change-a' })).rejects.toThrow(
      /changed while the review snapshot was prepared/,
    )
    expect(subagents.startCalls).toBe(0)
  })

  it('publishes PASS and reuses the digest when ignored build output changes', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [])
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'source\n', 'utf8')
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const harness = harnessFor(root, integrationReviewConfig(), subagents)
    harness.git.files = ['src/engine.ts']
    const recordPath = join(
      root,
      '.dsh',
      'delegation',
      'integration-review',
      'change-a',
      'integration.json',
    )
    const runId = await harness.startReview({ rule: 'integration-review', change: 'change-a' })
    // An ignored build/flycheck write is not a reviewed input and must not change the digest.
    await mkdir(join(root, 'target', 'flycheck0'), { recursive: true })
    await writeFile(join(root, 'target', 'flycheck0', 'stderr'), 'build noise\n', 'utf8')
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    const first = JSON.parse(await readFile(recordPath, 'utf8')) as {
      digest: string
      worktreeDigest: string
      verdict: string
    }
    expect(first.verdict).toBe('PASS')
    expect(first.worktreeDigest).toBe(first.digest)

    // Implementation-complete reuse requires a matching digest: the ignored write left it intact.
    const reused = text(
      await harness.callTool('delegate', { rule: 'integration-review', change: 'change-a' }),
    )
    expect(reused).toContain('reused record')
    expect(subagents.startCalls).toBe(1)

    // Control: a visible source change changes the digest and forces a new run.
    harness.git.status = ' M src/engine.ts\0'
    const controlRun = await harness.startReview({
      rule: 'integration-review',
      change: 'change-a',
    })
    pending.releases.shift()?.()
    expect(await harness.waitForRun(controlRun)).toContain('state=completed')
    expect(subagents.startCalls).toBe(2)
    const control = JSON.parse(await readFile(recordPath, 'utf8')) as { digest: string }
    expect(control.digest).not.toBe(first.digest)
  })

  it('keeps ignored build output out of the inputs with a real git repository', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'Reviewed task', checked: true }])
    await writeFile(join(root, '.gitignore'), 'target/\n', 'utf8')
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'fn main() {}\n', 'utf8')
    const git = realGit()
    await git(['init', '-q'], root)
    await git(['config', 'user.name', 'Delegation Test'], root)
    await git(['config', 'user.email', 'delegation@example.com'], root)
    await git(['add', '-A'], root)
    await git(['commit', '-q', '-m', 'init'], root)
    const subagents = new FakeSubagents()
    const pending = deferred()
    subagents.addProvider('codex-subagent', {}, pending.responder)
    const fakeGit = new FakeGit()
    fakeGit.run = git
    const harness = new Harness({
      cwd: root,
      config: taskReviewConfig(),
      agents: subagents,
      git: fakeGit,
    })
    const runId = await harness.startReview({ rule: 'task-review', change: 'change-a' })
    await mkdir(join(root, 'target', 'flycheck0'), { recursive: true })
    await writeFile(join(root, 'target', 'flycheck0', 'stderr'), 'build noise\n', 'utf8')
    await writeFile(join(root, 'target', '.rustc_info.json'), '{"noise":true}\n', 'utf8')
    pending.releases.shift()?.()
    expect(await harness.waitForRun(runId)).toContain('state=completed')
    const record = await taskRecord(root)
    expect(record.verdict).toBe('PASS')
  })
})

async function repository(): Promise<string> {
  const root = await workspace()
  await defaultGit(['init', '-q'], root)
  await defaultGit(['config', 'core.autocrlf', 'false'], root)
  return root
}

function change(name: string, dir: string): { name: string; dir: string; reviewReady: boolean } {
  return { name, dir, reviewReady: true }
}

async function lifecycleFixture(runId: string): Promise<{
  dir: string
  snapshot: NonNullable<Awaited<ReturnType<typeof createReviewSnapshot>>>
}> {
  const dir = await repository()
  await writeFile(join(dir, '.gitignore'), '.dsh/\n')
  const changeDir = join(dir, 'openspec', 'changes', 'change-a')
  await mkdir(changeDir, { recursive: true })
  await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
  await writeFile(join(dir, 'a.txt'), 'a\n')
  const snapshot = await createReviewSnapshot(
    dir,
    change('change-a', changeDir),
    runId,
    defaultGit,
    new AbortController().signal,
  )
  if (snapshot === undefined) throw new Error('expected a review snapshot')
  return { dir, snapshot }
}

describe('snapshot lifecycle', () => {
  it('freezes the change-artifact digest with the copy', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    await writeFile(join(changeDir, 'proposal.md'), '# proposal\n')
    let snapshot: Awaited<ReturnType<typeof createReviewSnapshot>>
    snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-spec',
      defaultGit,
      new AbortController().signal,
      async () => {
        // The edit lands after the live directory was copied and before the
        // digest is computed; the digest must describe the frozen copy.
        await writeFile(join(changeDir, 'proposal.md'), '# edited between copy and hash\n')
      },
    )
    if (snapshot === undefined) throw new Error('expected a review snapshot')
    expect(snapshot.specDigest).toBe(await specDigest(snapshot.changeDir))
    expect(await specDigest(changeDir)).not.toBe(snapshot.specDigest)
    await discardReviewSnapshot(dir, 'run-spec', defaultGit)
  })

  it('keeps the digest source stable across snapshot times', async () => {
    const { dir, snapshot: first } = await lifecycleFixture('run-stable-a')
    await discardReviewSnapshot(dir, 'run-stable-a', defaultGit)
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    const second = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-stable-b',
      defaultGit,
      new AbortController().signal,
    )
    if (second === undefined) throw new Error('expected a review snapshot')
    expect(second.tree).toBe(first.tree)
    expect(second.specDigest).toBe(first.specDigest)
    expect(second.commit).not.toBe(first.commit)
    await discardReviewSnapshot(dir, 'run-stable-b', defaultGit)
  })

  it('writes a lease and removes it with the checkout', async () => {
    const { dir, snapshot } = await lifecycleFixture('run-lease')
    const lease = `${snapshot.worktree}.lease`
    const scratch = join(dir, '.dsh', 'delegation', 'scratch', 'run-lease.index')
    const value = JSON.parse(await readFile(lease, 'utf8')) as { expiresAt: number }
    expect(value.expiresAt).toBeGreaterThan(Date.now())
    await expect(readFile(scratch)).resolves.toBeDefined()
    await discardReviewSnapshot(dir, 'run-lease', defaultGit)
    await expect(readFile(lease)).rejects.toThrow()
    await expect(readFile(scratch)).rejects.toThrow()
    await expect(readFile(join(snapshot.worktree, 'a.txt'))).rejects.toThrow()
  })

  it('keeps a valid lease past the review timeout and sweeps it once expired', async () => {
    const { dir, snapshot } = await lifecycleFixture('run-long')
    const base = Date.now()
    await writeFile(
      `${snapshot.worktree}.lease`,
      JSON.stringify({ runId: 'run-long', expiresAt: base + 2 * 60 * 60_000 }),
    )
    await utimes(
      snapshot.worktree,
      new Date(base - 2 * 60 * 60_000),
      new Date(base - 2 * 60 * 60_000),
    )
    await sweepReviewSnapshots(dir, defaultGit, base + 60 * 60_000)
    expect(await readFile(join(snapshot.worktree, 'a.txt'), 'utf8')).toBe('a\n')
    await sweepReviewSnapshots(dir, defaultGit, base + 3 * 60 * 60_000)
    await expect(readFile(join(snapshot.worktree, 'a.txt'))).rejects.toThrow()
  })

  it('sweeps a lease-less leftover only after the grace period', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    await mkdir(join(snapshots, 'run-leftover'), { recursive: true })
    const now = Date.now()
    await sweepReviewSnapshots(dir, defaultGit, now + 60_000)
    expect(await readdir(snapshots)).toContain('run-leftover')
    await sweepReviewSnapshots(dir, defaultGit, now + 11 * 60_000)
    expect(await readdir(snapshots)).not.toContain('run-leftover')
  })

  it('sweeps a leftover whose lease expired after a failed settle removal', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    const leftover = join(snapshots, 'run-stale')
    await mkdir(leftover, { recursive: true })
    await writeFile(
      `${leftover}.lease`,
      JSON.stringify({ runId: 'run-stale', expiresAt: Date.now() - 1_000 }),
    )
    await sweepReviewSnapshots(dir, defaultGit, Date.now())
    expect(await readdir(snapshots)).not.toContain('run-stale')
  })

  it('renews a lease and stops without recreating it', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const lease = join(dir, '.dsh', 'delegation', 'snapshots', 'run-renew.lease')
    await startSnapshotLease(dir, 'run-renew', 10)
    await rm(lease, { force: true })
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(JSON.parse(await readFile(lease, 'utf8'))).toMatchObject({ runId: 'run-renew' })
    await stopSnapshotLease(dir, 'run-renew')
    await rm(lease, { force: true })
    await new Promise((resolve) => setTimeout(resolve, 40))
    await expect(readFile(lease)).rejects.toThrow()
  })

  it('keeps a valid lease whose checkout does not exist yet', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    await mkdir(snapshots, { recursive: true })
    const now = Date.now()
    await writeFile(
      join(snapshots, 'run-live.lease'),
      JSON.stringify({ runId: 'run-live', expiresAt: now + 60_000 }),
    )
    await writeFile(
      join(snapshots, 'run-dead.lease'),
      JSON.stringify({ runId: 'run-dead', expiresAt: now - 1_000 }),
    )
    await sweepReviewSnapshots(dir, defaultGit, now)
    expect(await readdir(snapshots)).toContain('run-live.lease')
    expect(await readdir(snapshots)).not.toContain('run-dead.lease')
  })

  it('sweeps an orphaned scratch index and keeps one whose lease is valid', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    const scratch = join(dir, '.dsh', 'delegation', 'scratch')
    await mkdir(snapshots, { recursive: true })
    await mkdir(scratch, { recursive: true })
    const now = Date.now()
    const orphan = join(scratch, 'run-orphan.index')
    const live = join(scratch, 'run-live.index')
    await writeFile(orphan, 'x')
    await writeFile(live, 'x')
    const old = new Date(now - 60 * 60_000)
    await utimes(orphan, old, old)
    await utimes(live, old, old)
    await writeFile(
      join(snapshots, 'run-live.lease'),
      JSON.stringify({ runId: 'run-live', expiresAt: now + 60_000 }),
    )
    await sweepReviewSnapshots(dir, defaultGit, now)
    expect(await readdir(scratch)).toContain('run-live.index')
    expect(await readdir(scratch)).not.toContain('run-orphan.index')
  })

  it('keeps working when the sweep itself fails', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    await mkdir(join(snapshots, 'run-broken'), { recursive: true })
    await writeFile(
      join(snapshots, 'run-broken.lease'),
      JSON.stringify({ runId: 'run-broken', expiresAt: Date.now() - 1_000 }),
    )
    const failing: GitRunner = async () => {
      throw new Error('git is unavailable')
    }
    await expect(sweepReviewSnapshots(dir, failing, Date.now())).resolves.toBeUndefined()
    expect(await readdir(snapshots)).not.toContain('run-broken')
    const changeDir = join(dir, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n')
    const snapshot = await createReviewSnapshot(
      dir,
      change('change-a', changeDir),
      'run-after-failure',
      defaultGit,
      new AbortController().signal,
    )
    expect(snapshot).toBeDefined()
    await discardReviewSnapshot(dir, 'run-after-failure', defaultGit)
  })

  it('sweeps an abandoned lease temporary file', async () => {
    const dir = await repository()
    await writeFile(join(dir, '.gitignore'), '.dsh/\n')
    const snapshots = join(dir, '.dsh', 'delegation', 'snapshots')
    await mkdir(snapshots, { recursive: true })
    const now = Date.now()
    const temp = join(snapshots, 'run-temp.lease.abcdef12.tmp')
    await writeFile(temp, '{}')
    const old = new Date(now - 60 * 60_000)
    await utimes(temp, old, old)
    await sweepReviewSnapshots(dir, defaultGit, now)
    expect(await readdir(snapshots)).not.toContain('run-temp.lease.abcdef12.tmp')
  })

  it('retries a failed snapshot removal on a later sweep', async () => {
    const { dir, snapshot } = await lifecycleFixture('run-locked')
    const failingGit: GitRunner = async (args, cwd, signal) => {
      if (args[0] === 'worktree' && args[1] === 'remove') throw new Error('git removal failed')
      return defaultGit(args, cwd, signal)
    }
    let injected = false
    const failingRemove = async (path: string) => {
      if (!injected && path === snapshot.worktree) {
        injected = true
        throw new Error('locked')
      }
      await rm(path, { recursive: true, force: true })
    }
    await discardReviewSnapshot(dir, 'run-locked', failingGit, failingRemove)
    expect(injected).toBe(true)
    expect(await readdir(join(dir, '.dsh', 'delegation', 'snapshots'))).toContain('run-locked')
    await sweepReviewSnapshots(dir, defaultGit, Date.now() + 11 * 60_000)
    await expect(readFile(join(snapshot.worktree, 'a.txt'))).rejects.toThrow()
  })
})
