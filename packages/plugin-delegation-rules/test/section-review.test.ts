import { createHash } from 'node:crypto'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SubagentResult } from '@deepseek-ai/dsh-subagent'
import { afterEach, describe, expect, it } from 'vitest'
import { readFindingHistory } from '../src/host/finding-history.ts'
import {
  type BundleConfigLike,
  defaultTestConfig,
  FakeSubagents,
  Harness,
  makeWorkspace,
  passResponder,
  type RunRecord,
  runIdFrom,
  steerTexts,
  taskIdFor,
  writeChange,
} from './helpers.js'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const plan = `# Tasks

## 1. Engine (lane 1, owns \`packages/engine/**\`)

- [x] 1.1 First task
- [x] 1.2 Second task
- [ ] 1.3 Later task

## 2. Docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Doc task
`

const FIRST = taskIdFor('First task')
const SECOND = taskIdFor('Second task')
const LATER = taskIdFor('Later task')

function taskConfig(extraRules: BundleConfigLike['rules'] = []): BundleConfigLike {
  return defaultTestConfig({
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
      ...(extraRules ?? []),
    ],
  })
}

async function fixture(
  tasks: string = plan,
  config: BundleConfigLike = taskConfig(),
  extra: {
    publishHold?: (info: { rule: string; change: string; section?: string }) => Promise<void> | void
    startHold?: (info: { rule: string; change: string; section?: string }) => Promise<void> | void
  } = {},
): Promise<{ root: string; dir: string; agents: FakeSubagents; harness: Harness }> {
  const workspace = await makeWorkspace()
  cleanups.push(workspace.cleanup)
  const dir = await writeChange(workspace.root, 'change-a', [])
  await writeFile(join(dir, 'tasks.md'), tasks, 'utf8')
  const agents = new FakeSubagents()
  agents.addProvider('codex-subagent')
  const harness = new Harness({ cwd: workspace.root, config, agents, ...extra })
  return { root: workspace.root, dir, agents, harness }
}

function localTaskPath(root: string, taskId: string): string {
  return join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks', `${taskId}.json`)
}

function portablePath(dir: string, taskId: string): string {
  return join(dir, 'reviews', `${taskId}.json`)
}

function sectionRecordPath(root: string, key = '1'): string {
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 16)
  return join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'sections', `${hash}.json`)
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function writeMarker(root: string): Promise<void> {
  await writeFile(
    join(root, 'openspec', 'review-approval.json'),
    `${JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review', reviewerProvider: 'codex-subagent' })}\n`,
    'utf8',
  )
}

async function writePortable(
  dir: string,
  taskText: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const taskId = taskIdFor(taskText)
  await mkdir(join(dir, 'reviews'), { recursive: true })
  await writeFile(
    portablePath(dir, taskId),
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

function findingsResponder(
  title = '1.2 Second task has no regression test',
): (run: RunRecord) => SubagentResult {
  const digest = (prompt: string): string =>
    /- Digest: ([0-9a-f]{64})/.exec(prompt)?.[1] ?? '0'.repeat(64)
  return (run) => ({
    output: [
      {
        type: 'text',
        text: [
          'Reviewed.',
          '',
          '```json',
          JSON.stringify({
            digest: digest(run.prompt),
            verdict: 'FINDINGS',
            findings: [
              {
                severity: 'P1',
                class: 'missing-test',
                title,
                evidence: 'packages/engine/src/engine.ts:1',
                fix: 'add the regression test',
              },
            ],
          }),
          '```',
        ].join('\n'),
      },
    ],
    stopReason: 'completed',
  })
}

const invalidOutput = (): SubagentResult => ({
  output: [{ type: 'text', text: 'prose only' }],
  stopReason: 'completed',
})

describe('section selector resolution', () => {
  it('names the available sections in the delegate description before a section call', async () => {
    const { harness } = await fixture()
    await harness.toolText('delegation_status', {})
    const description = harness.tools.get('delegate')?.description ?? ''
    expect(description).toContain('Available sections in change "change-a"')
    expect(description).toContain('1 Engine')
    expect(description).toContain('2 Docs')
  })

  it('resolves the heading number, the wildcard, and the normalized title to one section', async () => {
    const { root, agents, harness } = await fixture()
    const first = runIdFrom(
      await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        section: '1',
      }),
    )
    expect(await harness.waitForRun(first)).toContain('state=completed')
    expect(agents.startCalls).toBe(1)
    expect(agents.runs[0]?.prompt).toContain('Section: 1. Engine')
    for (const section of ['1.x', 'Engine (lane 1, owns `packages/engine/**`)']) {
      const handle = await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        section,
      })
      expect(handle).toContain('reused record')
    }
    expect(agents.startCalls).toBe(1)
    expect(await exists(sectionRecordPath(root))).toBe(true)
  })

  it('resolves the untitled leading group by name', async () => {
    const untitled = `# Tasks

- [x] 0.1 Leading task

## 1. Engine

- [x] 1.1 First task
`
    const { agents, harness } = await fixture(untitled)
    const run = runIdFrom(
      await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        section: 'untitled',
      }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    expect(agents.runs[0]?.prompt).toContain('Leading task')
    expect(agents.runs[0]?.prompt).not.toContain('1.1 First task')
  })

  it('rejects unknown, empty, ambiguous, unchecked-only, and mixed selectors before a target starts', async () => {
    const { agents, harness } = await fixture()
    await expect(
      harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '9' }),
    ).rejects.toThrow(/available sections/)
    await expect(
      harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '' }),
    ).rejects.toThrow(/delegate.section/)
    await expect(
      harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task: FIRST,
        section: '1',
      }),
    ).rejects.toThrow(/mutually exclusive/)
    await expect(
      harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '2' }),
    ).rejects.toThrow(/no checked task/)
    expect(agents.startCalls).toBe(0)

    const ambiguous = `# Tasks

## 1. First

- [x] 1.1 First task

## 1. Second

- [x] 2.1 Second task
`
    const second = await fixture(ambiguous)
    await expect(
      second.harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        section: '1',
      }),
    ).rejects.toThrow(/ambiguous/)
    // A title selector cannot disambiguate two sections that share a key.
    await expect(
      second.harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        section: 'Second',
      }),
    ).rejects.toThrow(/shared by 2 sections/)
    expect(second.agents.startCalls).toBe(0)
  })

  it('rejects a section on a whole-scope or non-review rule and keeps task selection without it', async () => {
    const workspace = await makeWorkspace()
    cleanups.push(workspace.cleanup)
    const dir = await writeChange(workspace.root, 'change-a', [])
    await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
    const agents = new FakeSubagents()
    agents.addProvider('codex-subagent')
    const config = defaultTestConfig({
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
    const harness = new Harness({ cwd: workspace.root, config, agents })
    await expect(
      harness.toolText('delegate', { rule: 'spec-review', change: 'change-a', section: '1' }),
    ).rejects.toThrow(/omit section/)
    await expect(
      harness.toolText('delegate', { rule: 'research', change: 'change-a', section: '1' }),
    ).rejects.toThrow(/only valid for a task-scoped review/)
    expect(agents.startCalls).toBe(0)

    // Without a selector the existing next-checked-task behavior is unchanged.
    const handle = await harness.toolText('delegate', { rule: 'task-review', change: 'change-a' })
    expect(handle).toMatch(/task id: [0-9a-f]{16}/)
    expect(handle).not.toContain('section:')
    const runId = runIdFrom(handle)
    expect(await harness.waitForRun(runId)).toContain('state=completed')
  })

  it('exposes the section selector and its limits in the tool schema', async () => {
    const { harness } = await fixture()
    const tool = harness.tools.get('delegate') as unknown as {
      parameters: { properties: Record<string, { description?: string }> }
    }
    const section = tool.parameters.properties.section
    expect(section).toBeDefined()
    expect(section?.description).toContain('1.x')
    expect(section?.description).toContain('Mutually exclusive')
    const task = tool.parameters.properties.task
    expect(task?.description).toContain('Mutually exclusive with section')
  })
})

describe('one section run, one verdict', () => {
  it('reviews every checked task in one snapshot and publishes one approval each', async () => {
    const { root, dir, agents, harness } = await fixture()
    const run = runIdFrom(
      await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        section: '1.x',
      }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    expect(agents.startCalls).toBe(1)
    const prompt = agents.runs[0]?.prompt ?? ''
    expect(prompt).toContain('Section: 1. Engine')
    expect(prompt).toContain('1.1 First task')
    expect(prompt).toContain('1.2 Second task')
    expect(prompt).toContain('1.3 Later task')
    expect(prompt).toContain('Out of scope (unchecked')
    expect(prompt).toContain('Name the affected task number')

    const section = await readJson(sectionRecordPath(root))
    expect(section.section).toBe('1')
    expect(section.sectionTitle).toBe('1. Engine (lane 1, owns `packages/engine/**`)')
    expect(section.verdict).toBe('PASS')
    expect(section.failureClass).toBeUndefined()
    expect((section.taskIds as string[]).sort()).toEqual([FIRST, SECOND].sort())

    const first = await readJson(localTaskPath(root, FIRST))
    const second = await readJson(localTaskPath(root, SECOND))
    for (const record of [first, second]) {
      expect(record.verdict).toBe('PASS')
      expect(record.section).toBe('1')
      expect(record.digest).toBe(section.digest)
      expect(record.worktreeDigest).toBe(section.worktreeDigest)
      expect(record.runId).toBe(section.runId)
      expect(record.time).toBe(section.time)
    }
    expect(first.taskId).toBe(FIRST)
    expect(second.taskId).toBe(SECOND)
    expect(await exists(localTaskPath(root, LATER))).toBe(false)
    expect(await exists(portablePath(dir, LATER))).toBe(false)

    const firstPortable = await readJson(portablePath(dir, FIRST))
    const secondPortable = await readJson(portablePath(dir, SECOND))
    for (const portable of [firstPortable, secondPortable]) {
      expect(portable.scope).toBe('task')
      expect(portable.verdict).toBe('PASS')
      expect(portable.digest).toBe(section.digest)
      expect(portable.worktreeDigest).toBe(section.worktreeDigest)
      expect(portable.target).toEqual({ provider: 'codex-subagent' })
      expect(portable.time).toBe(section.time)
      for (const field of ['session', 'runId', 'section', 'taskIds', 'phase', 'error']) {
        expect(portable[field]).toBeUndefined()
      }
    }
  })

  it('changes the digest when a checked duplicate-text occurrence switches', async () => {
    const planFor = (checked: '1.1' | '1.2'): string => `# Tasks

## 1. First (lane 1, owns \`one/**\`)

- [${checked === '1.1' ? 'x' : ' '}] 1.1 Run regression tests
- [${checked === '1.2' ? 'x' : ' '}] 1.2 Run regression tests
`
    const { root, dir, agents, harness } = await fixture(planFor('1.1'))
    const first = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(first)).toContain('state=completed')
    const firstDigest = (await readJson(sectionRecordPath(root))).digest
    await writeFile(join(dir, 'tasks.md'), planFor('1.2'), 'utf8')
    const second = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(second)).toContain('state=completed')
    expect(agents.startCalls).toBe(2)
    expect((await readJson(sectionRecordPath(root))).digest).not.toBe(firstDigest)
    const prompt = agents.runs[1]?.prompt ?? ''
    const scope = prompt.slice(
      prompt.indexOf('Checked tasks in scope'),
      prompt.indexOf('Out of scope'),
    )
    expect(scope).toContain('1.2 Run regression tests')
  })

  it('resolves identical task text within the selected frozen section', async () => {
    const duplicate = `# Tasks

## 1. First (lane 1, owns \`one/**\`)

- [x] 1.1 Run regression tests

## 2. Second (lane 2, owns \`two/**\`)

- [x] 2.1 Run regression tests
- [x] 2.2 Add parser
`
    const { root, dir, agents, harness } = await fixture(duplicate)
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '2' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    expect(agents.startCalls).toBe(1)
    expect(agents.runs[0]?.prompt).toContain('2.1 Run regression tests')
    expect(agents.runs[0]?.prompt).toContain('2.2 Add parser')
    const section = await readJson(sectionRecordPath(root, '2'))
    expect(section.verdict).toBe('PASS')
    const shared = taskIdFor('Run regression tests')
    expect(await exists(portablePath(dir, shared))).toBe(true)
    expect(await exists(portablePath(dir, taskIdFor('Add parser')))).toBe(true)
    expect(await exists(localTaskPath(root, taskIdFor('Add parser')))).toBe(true)
  })

  it('covers a repeated task text occurrence by its number', async () => {
    const repeated = `# Tasks

## 1. First (lane 1, owns \`one/**\`)

- [ ] 1.1 Run regression tests
- [x] 1.2 Run regression tests
`
    const { agents, harness } = await fixture(repeated)
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    const prompt = agents.runs[0]?.prompt ?? ''
    const scope = prompt.slice(
      prompt.indexOf('Checked tasks in scope'),
      prompt.indexOf('Out of scope'),
    )
    expect(scope).toContain('1.2 Run regression tests')
    expect(scope).not.toContain('1.1 Run regression tests')
  })

  it('accepts one FINDINGS verdict that names the affected task and publishes no approval', async () => {
    const { root, dir, agents, harness } = await fixture()
    agents.respond = findingsResponder('1.2 Second task has no regression test')
    const run = runIdFrom(
      await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        section: '1',
      }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    const section = await readJson(sectionRecordPath(root))
    expect(section.verdict).toBe('FINDINGS')
    expect(agents.runs[0]?.prompt).toContain('Name the affected task number')
    for (const id of [FIRST, SECOND]) {
      expect((await readJson(localTaskPath(root, id))).verdict).toBe('FINDINGS')
      expect(await exists(portablePath(dir, id))).toBe(false)
    }
  })

  it('joins two identical section calls to one target run', async () => {
    const { agents, harness } = await fixture()
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    agents.respond = async (run) => {
      await gate
      return passResponder(run)
    }
    const firstHandle = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      section: '1',
    })
    const secondHandle = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      section: '1',
    })
    const first = runIdFrom(firstHandle)
    expect(runIdFrom(secondHandle)).toBe(first)
    expect(secondHandle).toContain('already pending')
    expect(agents.startCalls).toBe(1)
    release()
    expect(await harness.waitForRun(first)).toContain('state=completed')
  })

  it('reuses an unchanged FINDINGS record and needs a new run after a worktree change', async () => {
    const { agents, harness } = await fixture()
    let calls = 0
    agents.respond = (run) => {
      calls += 1
      return calls === 1 ? findingsResponder()(run) : passResponder(run)
    }
    const first = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(first)).toContain('state=completed')
    expect(agents.startCalls).toBe(1)
    const reused = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      section: '1',
    })
    expect(reused).toContain('reused record')
    expect(agents.startCalls).toBe(1)
    harness.git.status = ' M packages/engine/src/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine/src/engine.ts b/packages/engine/src/engine.ts'
    const second = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(second)).toContain('state=completed')
    expect(agents.startCalls).toBe(2)
  })

  it('changes the digest when a task is newly checked or a covered text changes', async () => {
    const { root, dir, agents, harness } = await fixture()
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    await harness.waitForRun(run)
    const firstDigest = (await readJson(sectionRecordPath(root))).digest
    // Checking a new task in the section requires a new section review.
    await writeFile(
      join(dir, 'tasks.md'),
      plan.replace('- [ ] 1.3 Later task', '- [x] 1.3 Later task'),
      'utf8',
    )
    const second = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(second)).toContain('state=completed')
    const secondDigest = (await readJson(sectionRecordPath(root))).digest
    expect(secondDigest).not.toBe(firstDigest)
    expect(agents.startCalls).toBe(2)
    expect(await exists(portablePath(dir, LATER))).toBe(true)

    // A covered task text change changes its id and the digest.
    const restated = plan
      .replace('- [ ] 1.3 Later task', '- [x] 1.3 Later task')
      .replace('- [x] 1.2 Second task', '- [x] 1.2 Second task restated')
    await writeFile(join(dir, 'tasks.md'), restated, 'utf8')
    const third = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(third)).toContain('state=completed')
    const thirdDigest = (await readJson(sectionRecordPath(root))).digest
    expect(thirdDigest).not.toBe(secondDigest)
    expect(agents.startCalls).toBe(3)
    expect(await exists(portablePath(dir, taskIdFor('Second task restated')))).toBe(true)
  })
})

describe('section approval publication', () => {
  it('keeps a matching approval byte-identical and replaces a nonmatching reviewer', async () => {
    const { root, dir, harness } = await fixture()
    await writeMarker(root)
    await writePortable(dir, 'First task', { target: { provider: 'codex-subagent' } })
    await writePortable(dir, 'Second task', { target: { provider: 'other-provider' } })
    const kept = await readFile(portablePath(dir, FIRST), 'utf8')
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    expect(await readFile(portablePath(dir, FIRST), 'utf8')).toBe(kept)
    const replaced = await readJson(portablePath(dir, SECOND))
    expect(replaced.target).toEqual({ provider: 'codex-subagent' })
    const section = await readJson(sectionRecordPath(root))
    expect(replaced.digest).toBe(section.digest)
  })

  it('rolls a partial publication back byte-identically and leaves no approval', async () => {
    const { root, dir, harness } = await fixture()
    await writeMarker(root)
    // A nonmatching record is destined for replacement; the second task's
    // portable path is a directory, making its rename fail after the first
    // replacement already happened.
    await writePortable(dir, 'First task', { target: { provider: 'other-provider' } })
    const original = await readFile(portablePath(dir, FIRST), 'utf8')
    await mkdir(portablePath(dir, SECOND))
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=failed')
    expect(await readFile(portablePath(dir, FIRST), 'utf8')).toBe(original)
    expect((await readJson(localTaskPath(root, FIRST))).verdict).toBe('ERROR')
    const secondPath = await readJson(localTaskPath(root, SECOND))
    expect(secondPath.verdict).toBe('ERROR')
    const section = await readJson(sectionRecordPath(root))
    expect(section.verdict).toBe('ERROR')
    expect(String(section.error)).toContain('could not publish the section review records')
  })

  it('preserves a per-task PASS published before the section and publishes the rest', async () => {
    const { root, dir, agents, harness } = await fixture()
    const perTask = runIdFrom(
      await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task: FIRST,
      }),
    )
    expect(await harness.waitForRun(perTask)).toContain('state=completed')
    const keptPortable = await readFile(portablePath(dir, FIRST), 'utf8')
    const keptLocal = await readFile(localTaskPath(root, FIRST), 'utf8')
    const sectionRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(sectionRun)).toContain('state=completed')
    expect(agents.startCalls).toBe(2)
    expect(await readFile(portablePath(dir, FIRST), 'utf8')).toBe(keptPortable)
    expect(await readFile(localTaskPath(root, FIRST), 'utf8')).toBe(keptLocal)
    expect(await exists(portablePath(dir, SECOND))).toBe(true)
  })

  it('makes a per-task run published after the section reuse the section PASS', async () => {
    const { dir, agents, harness } = await fixture()
    const sectionRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(sectionRun)).toContain('state=completed')
    const kept = await readFile(portablePath(dir, FIRST), 'utf8')
    const handle = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task: FIRST,
    })
    expect(handle).toContain('reused record')
    expect(agents.startCalls).toBe(1)
    expect(await readFile(portablePath(dir, FIRST), 'utf8')).toBe(kept)
  })

  it('discards an in-flight per-task completion that publishes after the section', async () => {
    const { root, dir, agents, harness } = await fixture()
    let releasePerTask = (): void => undefined
    const perTaskGate = new Promise<void>((resolve) => {
      releasePerTask = resolve
    })
    agents.respond = async (run) => {
      if (!run.prompt.includes('Section:')) await perTaskGate
      return passResponder(run)
    }
    const perTaskRun = runIdFrom(
      await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        task: FIRST,
      }),
    )
    const sectionRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(sectionRun)).toContain('state=completed')
    const sectionLocal = await readFile(localTaskPath(root, FIRST), 'utf8')
    const sectionPortable = await readFile(portablePath(dir, FIRST), 'utf8')
    releasePerTask()
    expect(await harness.waitForRun(perTaskRun)).toContain('state=discarded')
    expect(await readFile(localTaskPath(root, FIRST), 'utf8')).toBe(sectionLocal)
    expect(await readFile(portablePath(dir, FIRST), 'utf8')).toBe(sectionPortable)
  })

  it('discards a frozen section run when a newer identity is admitted', async () => {
    const { root, dir, agents, harness } = await fixture()
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    agents.respond = async (run) => {
      calls += 1
      if (calls === 1) await gate
      return passResponder(run)
    }
    const older = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    // The newer identity comes from a changed checked set; the older run still
    // reviews its frozen snapshot and must publish nothing.
    await writeFile(
      join(dir, 'tasks.md'),
      plan.replace('- [ ] 1.3 Later task', '- [x] 1.3 Later task'),
      'utf8',
    )
    const newer = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(newer).not.toBe(older)
    expect(await exists(portablePath(dir, FIRST))).toBe(false)
    release()
    expect(await harness.waitForRun(older)).toContain('state=discarded')
    expect(await harness.waitForRun(newer)).toContain('state=completed')
    expect(await exists(portablePath(dir, LATER))).toBe(true)
    expect(await exists(sectionRecordPath(root))).toBe(true)
  })

  it('keeps the newer identity when an older section startup is still pending', async () => {
    let entered = (): void => undefined
    let release = (): void => undefined
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let holds = 0
    const { agents, harness } = await fixture(plan, taskConfig(), {
      startHold: async (info) => {
        if (info.section === undefined) return
        holds += 1
        if (holds > 1) return
        entered()
        await gate
      },
    })
    const olderPromise = harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      section: '1',
    })
    await enteredPromise
    await writeFile(
      join(harness.cwd, 'openspec', 'changes', 'change-a', 'tasks.md'),
      plan.replace('- [ ] 1.3 Later task', '- [x] 1.3 Later task'),
      'utf8',
    )
    const newer = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    release()
    const older = runIdFrom(await olderPromise)
    expect(await harness.waitForRun(newer)).toContain('state=completed')
    expect(await harness.waitForRun(older)).toContain('state=discarded')
    const inScope = (prompt: string): string =>
      prompt.slice(prompt.indexOf('Checked tasks in scope'), prompt.indexOf('Out of scope'))
    expect(inScope(agents.runs[0]?.prompt ?? '')).not.toContain('1.3 Later task')
    expect(inScope(agents.runs[1]?.prompt ?? '')).toContain('1.3 Later task')
  })

  it('discards a queued per-task run when the section PASS lands first', async () => {
    const config = taskConfig()
    config.reviewQueue = { concurrency: 1 }
    const { agents, harness } = await fixture(plan, config)
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    agents.respond = async (run) => {
      if (run.prompt.includes('Section:')) await gate
      return passResponder(run)
    }
    const sectionRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    const perTaskHandle = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      task: FIRST,
    })
    expect(perTaskHandle).toContain('queued')
    release()
    expect(await harness.waitForRun(sectionRun)).toContain('state=completed')
    const perTaskRun = runIdFrom(perTaskHandle)
    expect(await harness.waitForRun(perTaskRun)).toContain('state=discarded')
    expect(agents.startCalls).toBe(1)
    const sectionLocal = await readJson(localTaskPath(harness.cwd, FIRST))
    expect(sectionLocal.verdict).toBe('PASS')
  })

  it('serializes a held section publication with a per-task publication', async () => {
    let entered = (): void => undefined
    let release = (): void => undefined
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { root, dir, agents, harness } = await fixture(plan, taskConfig(), {
      publishHold: async (info) => {
        if (info.section === undefined) return
        entered()
        await gate
      },
    })
    const sectionRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    await enteredPromise
    const perTaskRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', task: FIRST }),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    // With a shared publication lock the per-task completion is still waiting.
    expect(await exists(localTaskPath(root, FIRST))).toBe(false)
    release()
    expect(await harness.waitForRun(sectionRun)).toContain('state=completed')
    expect(await harness.waitForRun(perTaskRun)).toContain('state=discarded')
    expect(await exists(portablePath(dir, FIRST))).toBe(true)
    expect(await exists(portablePath(dir, SECOND))).toBe(true)
    expect(agents.startCalls).toBe(2)
  })

  it('serializes a held per-task publication with a section publication', async () => {
    let entered = (): void => undefined
    let release = (): void => undefined
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const { root, dir, agents, harness } = await fixture(plan, taskConfig(), {
      publishHold: async (info) => {
        if (info.section !== undefined) return
        entered()
        await gate
      },
    })
    const perTaskRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', task: FIRST }),
    )
    await enteredPromise
    const sectionRun = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    await new Promise((resolve) => setTimeout(resolve, 100))
    // The section completion waits instead of writing during the held lock.
    expect(await exists(sectionRecordPath(root))).toBe(false)
    expect(await exists(portablePath(dir, SECOND))).toBe(false)
    release()
    expect(await harness.waitForRun(perTaskRun)).toContain('state=completed')
    expect(await harness.waitForRun(sectionRun)).toContain('state=completed')
    const kept = await readJson(localTaskPath(root, FIRST))
    expect(kept.verdict).toBe('PASS')
    expect(await exists(portablePath(dir, SECOND))).toBe(true)
    expect(agents.startCalls).toBe(2)
  })

  it('leaves originals untouched when staging fails before any rename', async () => {
    const { root, dir, harness } = await fixture()
    await writeMarker(root)
    await writePortable(dir, 'First task', { target: { provider: 'other-provider' } })
    const original = await readFile(portablePath(dir, FIRST), 'utf8')
    const records = join(root, '.dsh', 'delegation', 'task-review', 'change-a')
    await mkdir(records, { recursive: true })
    await writeFile(join(records, 'tasks'), 'not a directory', 'utf8')
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=failed')
    expect(await readFile(portablePath(dir, FIRST), 'utf8')).toBe(original)
    expect(await exists(sectionRecordPath(root))).toBe(false)
    expect(await exists(localTaskPath(root, FIRST))).toBe(false)
  })

  it('discards a superseded section identity and approves no task', async () => {
    const { root, dir, agents, harness } = await fixture()
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    agents.respond = async (run) => {
      await gate
      return passResponder(run)
    }
    const handle = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      section: '1',
    })
    const runId = runIdFrom(handle)
    const path = join(root, /^record: (\S+)$/m.exec(handle)?.[1] ?? '')
    await mkdir(join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'sections'), {
      recursive: true,
    })
    await writeFile(
      path,
      JSON.stringify({
        rule: 'task-review',
        change: 'change-a',
        phase: 'task',
        scope: 'task',
        section: '1',
        taskIds: [FIRST, SECOND],
        digest: 'c'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        runId: 'run-other',
        time: '2026-10-26T12:00:00.000Z',
      }),
      'utf8',
    )
    release()
    expect(await harness.waitForRun(runId)).toContain('state=discarded')
    expect(await exists(portablePath(dir, FIRST))).toBe(false)
    expect(await exists(portablePath(dir, SECOND))).toBe(false)
  })
})

describe('section gate and status', () => {
  it('counts covered tasks in status and accepts them at turn close', async () => {
    const { dir, harness } = await fixture()
    await harness.preStep(1)
    const before = plan.replace(/- \[x\] 1\.([12])/g, '- [ ] 1.$1')
    await harness.writeResult(join(dir, 'tasks.md'), before, plan)
    await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
    const status = await harness.toolText('delegation_status', {})
    expect(status).toContain('task-review PASS 2/2')
    expect(status).toContain('archive-ready: yes')
    expect(status).toContain('section=1')
  })

  it('points a pending section run at its record instead of starting another run', async () => {
    const { dir, agents, harness } = await fixture()
    await harness.preStep(1)
    const before = plan.replace(/- \[x\] 1\.([12])/g, '- [ ] 1.$1')
    await harness.writeResult(join(dir, 'tasks.md'), before, plan)
    await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
    let release = (): void => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    agents.respond = async (run) => {
      await gate
      return passResponder(run)
    }
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    await harness.turnStopping(1)
    const steer = steerTexts(harness.agent).join('\n')
    expect(steer).toContain(`review run ${run} is running`)
    expect(steer).toContain('instead of starting another run')
    expect(agents.startCalls).toBe(1)
    release()
    expect(await harness.waitForRun(run)).toContain('state=completed')
  })

  it('closes the turn on an eligible section ERROR with the failure class preserved', async () => {
    const { root, agents, harness } = await fixture()
    agents.respond = invalidOutput
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=failed')
    for (const id of [FIRST, SECOND]) {
      const record = await readJson(localTaskPath(root, id))
      expect(record.verdict).toBe('ERROR')
      expect(record.failureClass).toBe('invalid-output')
    }
    await harness.turnStopping(1)
    expect(steerTexts(harness.agent)).toHaveLength(0)
  })

  it('reports only the unapproved task after a mixed-coverage section ERROR', async () => {
    const { dir, agents, harness } = await fixture()
    await writePortable(dir, 'First task', { target: { provider: 'codex-subagent' } })
    const approved = await readFile(portablePath(dir, FIRST), 'utf8')
    agents.respond = invalidOutput
    const run = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    expect(await harness.waitForRun(run)).toContain('state=failed')
    expect(await readFile(portablePath(dir, FIRST), 'utf8')).toBe(approved)
    const status = await harness.toolText('delegation_status', {})
    expect(status).toContain('task-review PASS 1/2')
    expect(status).toContain('missing 1')
    expect(status).toContain('missing 1.2 "Second task"')
    expect(status).not.toContain('1.1 First task')
  })

  it('appends one section finding-history entry and nothing on reuse', async () => {
    const { root, agents, harness } = await fixture()
    let calls = 0
    agents.respond = (run) => {
      calls += 1
      return calls === 1 ? findingsResponder()(run) : passResponder(run)
    }
    const first = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    await harness.waitForRun(first)
    harness.git.status = ' M packages/engine/src/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine/src/engine.ts b/packages/engine/src/engine.ts'
    const second = runIdFrom(
      await harness.toolText('delegate', { rule: 'task-review', change: 'change-a', section: '1' }),
    )
    await harness.waitForRun(second)
    const reused = await harness.toolText('delegate', {
      rule: 'task-review',
      change: 'change-a',
      section: '1',
    })
    expect(reused).toContain('reused record')
    const history = await readFindingHistory(root)
    expect(history.entries).toHaveLength(2)
    const findingsEntry = history.entries[0]
    expect(findingsEntry?.kind).toBe('run')
    if (findingsEntry?.kind === 'run') {
      expect(findingsEntry.section).toBe('1')
      expect(findingsEntry.taskIds?.sort()).toEqual([FIRST, SECOND].sort())
    }
    const retro = await harness.toolText('review_retro', { action: 'report' })
    expect(retro).toContain('2 settled review(s), 1 finding(s)')
    expect(retro).toContain('missing-test: 1 finding(s), 0 repeated')
  })

  it('sanitizes an unnumbered section key before writing finding history', async () => {
    const title = 'Review /srv/synthetic/private token=synthetic-history-secret'
    const untitled = `# Tasks\n\n## ${title}\n\n- [x] 1.1 First task\n`
    const { root, harness } = await fixture(untitled)
    const run = runIdFrom(
      await harness.toolText('delegate', {
        rule: 'task-review',
        change: 'change-a',
        section: title,
      }),
    )
    expect(await harness.waitForRun(run)).toContain('state=completed')
    const history = await readFindingHistory(root)
    const entry = history.entries[0]
    expect(entry?.kind).toBe('run')
    if (entry?.kind === 'run') {
      expect(entry.section).not.toContain('/srv/')
      expect(entry.section).not.toContain('synthetic-history-secret')
      expect(entry.section).toContain('[path]')
      expect(entry.section).toContain('[secret]')
    }
  })
})
