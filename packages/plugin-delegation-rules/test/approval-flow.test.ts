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
  steerTexts,
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

describe('change-level approval in delegation_status', () => {
  const TASKS = [
    { number: '1.1', text: 'First task', checked: true },
    { number: '1.2', text: 'Second task', checked: true },
    { number: '1.3', text: 'Third task', checked: true },
    { number: '1.4', text: 'Open task', checked: false },
  ]

  async function statusFixture() {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    const dir = await writeChange(workspace.root, 'change-a', TASKS)
    const agents = new FakeSubagents()
    agents.addProvider('codex-subagent')
    const harness = new Harness({
      cwd: workspace.root,
      config: defaultTestConfig(),
      agents,
      git: new FakeGit(),
    })
    return { root: workspace.root, dir, agents, harness }
  }

  async function writePortable(
    dir: string,
    taskText: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const taskId = taskIdFor(taskText)
    await mkdir(join(dir, 'reviews'), { recursive: true })
    await writeFile(
      join(dir, 'reviews', `${taskId}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: 'change-a',
        scope: 'task',
        taskId,
        digest: 'a'.repeat(64),
        worktreeDigest: 'b'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-10-29T08:55:43.317Z',
        ...overrides,
      }),
      'utf8',
    )
    return taskId
  }

  it('counts PASS only, reports ERROR and missing, and ignores unchecked tasks', async () => {
    const { dir, harness } = await statusFixture()
    await writePortable(dir, 'First task')
    await writePortable(dir, 'Second task', { verdict: 'ERROR' })
    const text = await harness.toolText('delegation_status', {})
    expect(text).toContain('tasks: 3/4 checked')
    expect(text).toContain(
      'task approval: task-review PASS 1/3, ERROR 1, missing 1; archive-ready: no',
    )
    const missingId = taskIdFor('Third task')
    expect(text).toContain(
      `missing 1.3 "Third task" -> delegate(rule: "task-review", change: "change-a", task: "${missingId}")`,
    )
    expect(text).toContain(`record: openspec/changes/change-a/reviews/${missingId}.json`)
    const failedId = taskIdFor('Second task')
    expect(text).toContain(`record at openspec/changes/change-a/reviews/${failedId}.json`)
    expect(text).not.toContain('Open task')
  })

  it('names a malformed portable record as an error', async () => {
    const { dir, harness } = await statusFixture()
    await writePortable(dir, 'First task')
    await writePortable(dir, 'Second task')
    const taskId = taskIdFor('Second task')
    await writeFile(join(dir, 'reviews', `${taskId}.json`), '{not json', 'utf8')
    const text = await harness.toolText('delegation_status', {})
    expect(text).toContain(
      'task approval: task-review PASS 1/3, ERROR 1, missing 1; archive-ready: no',
    )
  })

  it('accepts a portable PASS from a different session with no local state', async () => {
    const { dir, harness } = await statusFixture()
    for (const task of TASKS.filter((entry) => entry.checked)) {
      await writePortable(dir, task.text)
    }
    const text = await harness.toolText('delegation_status', {})
    expect(text).toContain('this session: not involved')
    expect(text).toContain(
      'task approval: task-review PASS 3/3, ERROR 0, missing 0; archive-ready: yes',
    )
  })

  it('counts a FINDINGS record as unapproved', async () => {
    const { dir, harness } = await statusFixture()
    await writePortable(dir, 'First task')
    await writePortable(dir, 'Second task', {
      verdict: 'FINDINGS',
      findings: [{ severity: 'P1', title: 't', evidence: 'e', fix: 'f' }],
    })
    await writePortable(dir, 'Third task')
    const text = await harness.toolText('delegation_status', {})
    expect(text).toContain(
      'task approval: task-review PASS 2/3, ERROR 1, missing 0; archive-ready: no',
    )
  })

  it('fails closed on a checked line that is not a numbered task', async () => {
    const { dir, harness } = await statusFixture()
    await writeFile(
      join(dir, 'tasks.md'),
      '# Tasks\n\n- [x] 1.1 First task\n- [x] stray line\n',
      'utf8',
    )
    await writePortable(dir, 'First task')
    const text = await harness.toolText('delegation_status', {})
    expect(text).toContain('archive-ready: no')
    expect(text).toContain(
      'checked line 4 "- [x] stray line" is not a numbered task; the approval cannot be proven',
    )
  })

  it('reports an invalid marker rule instead of inventing an approval rule', async () => {
    const { root, harness } = await statusFixture()
    await writeFile(
      join(root, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'missing-rule' }),
      'utf8',
    )
    const text = await harness.toolText('delegation_status', {})
    expect(text).toContain(
      'task approval: unavailable (marker taskRule "missing-rule" is not a configured rule)',
    )
  })
})

describe('completion steer', () => {
  async function gateFixture(tasks: Array<{ number: string; text: string; checked: boolean }>) {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    const dir = await writeChange(workspace.root, 'change-a', tasks)
    const agents = new FakeSubagents()
    agents.addProvider('codex-subagent')
    const harness = new Harness({
      cwd: workspace.root,
      config: defaultTestConfig(),
      agents,
      git: new FakeGit(),
    })
    return { root: workspace.root, dir, harness }
  }

  async function writeLocalPass(root: string, taskText: string): Promise<void> {
    const taskId = taskIdFor(taskText)
    const path = join(
      root,
      '.dsh',
      'delegation',
      'task-review',
      'change-a',
      'tasks',
      `${taskId}.json`,
    )
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(
      path,
      JSON.stringify({
        rule: 'task-review',
        change: 'change-a',
        phase: 'task',
        scope: 'task',
        taskId,
        digest: 'a'.repeat(64),
        worktreeDigest: 'b'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        session: 'session-1',
        runId: 'run-1',
        time: '2026-10-29T08:55:43.317Z',
      }),
      'utf8',
    )
  }

  function tasksMarkdown(
    entries: Array<{ number: string; text: string; checked: boolean }>,
  ): string {
    return `# Tasks\n\n${entries
      .map((entry) => `- [${entry.checked ? 'x' : ' '}] ${entry.number} ${entry.text}`)
      .join('\n')}\n`
  }

  it('requires a portable PASS for every checked task when the tick completes the list', async () => {
    const { dir, harness } = await gateFixture([
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Own task', checked: false },
    ])
    const before = tasksMarkdown([
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Own task', checked: false },
    ])
    const after = tasksMarkdown([
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Own task', checked: true },
    ])
    await harness.preStep(1)
    await harness.writeResult('openspec/changes/change-a/tasks.md', before, after)
    await writeFile(join(dir, 'tasks.md'), after, 'utf8')
    await harness.turnStopping(1)
    const text = steerTexts(harness.agent).join('\n')
    expect(text).toContain('the task list of change "change-a" is fully checked')
    expect(text).toContain('Foreign task')
    expect(text).toContain('Own task')
  })

  it('does not require a foreign checked task before the list is complete', async () => {
    const { root, dir, harness } = await gateFixture([
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Own task', checked: false },
      { number: '1.3', text: 'Later task', checked: false },
    ])
    const before = tasksMarkdown([
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Own task', checked: false },
      { number: '1.3', text: 'Later task', checked: false },
    ])
    const after = tasksMarkdown([
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Own task', checked: true },
      { number: '1.3', text: 'Later task', checked: false },
    ])
    await writeLocalPass(root, 'Own task')
    await harness.preStep(1)
    await harness.writeResult('openspec/changes/change-a/tasks.md', before, after)
    await writeFile(join(dir, 'tasks.md'), after, 'utf8')
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toEqual([])
  })
})
