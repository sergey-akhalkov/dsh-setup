import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultTestConfig,
  FakeGit,
  FakeSubagents,
  Harness,
  makeWorkspace,
  passResponder,
  type RunRecord,
  taskIdFor,
  writeChange,
} from './helpers.js'

const TASK_TEXT = 'Add the portable record'

function digestIn(prompt: string): string {
  const match = /- Digest: ([0-9a-f]{64})/.exec(prompt)
  return match?.[1] ?? '0'.repeat(64)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup !== undefined) await cleanup()
  }
})

async function fixture() {
  const workspace = await makeWorkspace()
  cleanups.push(workspace.cleanup)
  const dir = await writeChange(workspace.root, 'change-a', [
    { number: '1.1', text: TASK_TEXT, checked: true },
  ])
  const agents = new FakeSubagents()
  agents.addProvider('codex-subagent')
  const harness = new Harness({
    cwd: workspace.root,
    config: defaultTestConfig(),
    agents,
    git: new FakeGit(),
  })
  const taskId = taskIdFor(TASK_TEXT)
  return {
    root: workspace.root,
    dir,
    agents,
    harness,
    taskId,
    localPath: join(
      workspace.root,
      '.dsh',
      'delegation',
      'task-review',
      'change-a',
      'tasks',
      `${taskId}.json`,
    ),
    portablePath: join(dir, 'reviews', `${taskId}.json`),
  }
}

describe('portable task-review approval', () => {
  it('writes the sanitized record beside the local PASS', async () => {
    const { harness, taskId, localPath, portablePath } = await fixture()
    const runId = await harness.startReview({
      rule: 'task-review',
      change: 'change-a',
      task: taskId,
    })
    await harness.waitForRun(runId)
    const local = await readJson(localPath)
    const portable = await readJson(portablePath)
    expect(local.verdict).toBe('PASS')
    expect(local.session).toBeDefined()
    expect(local.runId).toBeDefined()
    expect(portable).toEqual({
      rule: 'task-review',
      change: 'change-a',
      scope: 'task',
      taskId,
      digest: local.digest,
      worktreeDigest: local.worktreeDigest,
      verdict: 'PASS',
      findings: [],
      target: { provider: 'codex-subagent' },
      time: local.time,
    })
    for (const field of ['session', 'runId', 'error', 'phase']) {
      expect(portable[field]).toBeUndefined()
    }
    expect(JSON.stringify(portable)).not.toContain(String(local.session))
  })

  it('writes no portable record for an ERROR verdict', async () => {
    const { harness, agents, taskId, localPath, portablePath } = await fixture()
    agents.respond = () => ({
      output: [{ type: 'text', text: 'prose only' }],
      stopReason: 'completed',
    })
    const runId = await harness.startReview({
      rule: 'task-review',
      change: 'change-a',
      task: taskId,
    })
    await harness.waitForRun(runId)
    expect((await readJson(localPath)).verdict).toBe('ERROR')
    expect(await exists(portablePath)).toBe(false)
  })

  it('writes no portable record for a FINDINGS verdict', async () => {
    const { harness, agents, taskId, localPath, portablePath } = await fixture()
    agents.respond = (run: RunRecord) => ({
      output: [
        {
          type: 'text',
          text: [
            'Reviewed.',
            '',
            '```json',
            JSON.stringify({
              digest: digestIn(run.prompt),
              verdict: 'FINDINGS',
              findings: [{ severity: 'P1', title: 't', evidence: 'e', fix: 'f' }],
            }),
            '```',
          ].join('\n'),
        },
      ],
      stopReason: 'completed',
    })
    const runId = await harness.startReview({
      rule: 'task-review',
      change: 'change-a',
      task: taskId,
    })
    await harness.waitForRun(runId)
    expect((await readJson(localPath)).verdict).toBe('FINDINGS')
    expect(await exists(portablePath)).toBe(false)
  })

  it('publishes no PASS when the portable record cannot be written', async () => {
    const { harness, taskId, dir, localPath } = await fixture()
    // A file where the reviews directory belongs makes the atomic write fail.
    await writeFile(join(dir, 'reviews'), 'not a directory', 'utf8')
    const runId = await harness.startReview({
      rule: 'task-review',
      change: 'change-a',
      task: taskId,
    })
    await harness.waitForRun(runId)
    const local = await readJson(localPath)
    expect(local.verdict).toBe('ERROR')
    expect(String(local.error)).toMatch(/portable approval record/)
  })
})

describe('portable records and the change artifact digest', () => {
  async function specFixture() {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    const dir = await writeChange(workspace.root, 'change-a', [
      { number: '1.1', text: TASK_TEXT, checked: false },
    ])
    const agents = new FakeSubagents()
    agents.addProvider('codex-subagent')
    const harness = new Harness({
      cwd: workspace.root,
      config: defaultTestConfig(),
      agents,
      git: new FakeGit(),
    })
    const specRecord = join(
      workspace.root,
      '.dsh',
      'delegation',
      'spec-review',
      'change-a',
      'spec.json',
    )
    return { dir, agents, harness, specRecord }
  }

  it('reuses a spec PASS when a later portable record is added', async () => {
    const { dir, agents, harness } = await specFixture()
    const first = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    await harness.waitForRun(first)
    expect(agents.startCalls).toBe(1)
    // Even a malformed file under reviews/ is not a change artifact.
    await mkdir(join(dir, 'reviews'), { recursive: true })
    await writeFile(join(dir, 'reviews', 'aaaaaaaaaaaaaaaa.json'), '{not json', 'utf8')
    const text = await harness.toolText('delegate', { rule: 'spec-review', change: 'change-a' })
    expect(text).toContain('reused record')
    expect(agents.startCalls).toBe(1)
  })

  it('publishes a running whole-spec review when a task approval is written concurrently', async () => {
    const { dir, agents, harness, specRecord } = await specFixture()
    agents.respond = async (run: RunRecord) => {
      await mkdir(join(dir, 'reviews'), { recursive: true })
      await writeFile(
        join(dir, 'reviews', 'bbbbbbbbbbbbbbbb.json'),
        JSON.stringify({
          rule: 'task-review',
          change: 'change-a',
          scope: 'task',
          taskId: 'b'.repeat(16),
          digest: 'c'.repeat(64),
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-10-29T08:55:43.317Z',
        }),
        'utf8',
      )
      return passResponder(run)
    }
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    await harness.waitForRun(runId)
    expect((await readJson(specRecord)).verdict).toBe('PASS')
  })

  it('still reviews a nested specs/reviews artifact during a whole-spec review', async () => {
    const { dir, agents, harness, specRecord } = await specFixture()
    const nested = join(dir, 'specs', 'reviews', 'spec.md')
    await mkdir(join(dir, 'specs', 'reviews'), { recursive: true })
    await writeFile(nested, '# nested artifact\n', 'utf8')
    agents.respond = async (run: RunRecord) => {
      await writeFile(nested, '# changed during review\n', 'utf8')
      return passResponder(run)
    }
    const runId = await harness.startReview({ rule: 'spec-review', change: 'change-a' })
    await harness.waitForRun(runId)
    const record = await readJson(specRecord)
    expect(record.verdict).toBe('ERROR')
    expect(String(record.error)).toContain('reviewed inputs changed')
  })
})
