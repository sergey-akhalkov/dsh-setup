import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import { verifyEvidence } from '../src/host/evidence.ts'
import type { SubagentRunner, SubagentRunResult } from '../src/host/executors.ts'
import {
  localReviewRecordPath,
  parseReviewVerdict,
  portableApprovalPath,
  type ReviewRecord,
  renderReviewPrompt,
  resolveReviewer,
  resolveReviewers,
  reviewDigest,
  runReviewStep,
  writeLocalReviewRecord,
  writePortableApproval,
} from '../src/host/review.ts'
import { createRun } from '../src/host/runs.ts'

const TASK_ID = '0123456789abcdef'
const DIGEST = 'a'.repeat(64)

function taskDefinition(): Definition {
  return validateDefinition({
    v: 1,
    id: 'task-review',
    name: 'Task review',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'turn' },
    settings: {
      allowModelStart: true,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
      gate: 'review',
      gateIdentity: 'task-review',
      legacy: { plugin: 'delegation-rules', signal: 'task-review' },
    },
    steps: [
      {
        id: 'review',
        title: 'Review the checked task',
        executor: 'review',
        review: { target: 'codex', instruction: 'review-task', scope: 'task' },
        evidence: {
          kind: 'record',
          rule: 'task-review',
          change: '{name}',
          scope: 'task',
          task: '{taskId}',
          verdicts: ['PASS', 'ERROR'],
          path: `.dsh/workflows/records/task-review/{name}/tasks/{taskId}.json`,
        },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  })
}

const reviewers = resolveReviewers({
  codex: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
})

function reviewer() {
  const resolved = reviewers.codex
  if (resolved === undefined) throw new Error('test reviewer missing')
  return { id: 'codex', ...resolved }
}

function fenced(value: unknown): string {
  return `Review complete.\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`
}

const TASK_DIGEST = reviewDigest({ scope: 'task', specDigest: DIGEST })

const PASS_TEXT = fenced({ digest: TASK_DIGEST, verdict: 'PASS', findings: [] })

function runnerFor(text: string | (() => Promise<SubagentRunResult>)): SubagentRunner {
  return {
    run: async () =>
      typeof text === 'function' ? text() : { childId: 'child-1', completed: true, text },
  }
}

function baseRun(definition: Definition) {
  return createRun({
    definition: definition.id,
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth', taskId: TASK_ID },
    steps: ['review'],
    now: 1_000,
  })
}

async function workspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'workflows-review-'))
}

async function invoke(
  root: string,
  runner: SubagentRunner,
  overrides: Partial<Parameters<typeof runReviewStep>[0]> = {},
) {
  const definition = taskDefinition()
  const step = definition.steps[0]
  if (step === undefined || step.review === undefined) throw new Error('test step missing')
  return runReviewStep({
    run: baseRun(definition),
    definition,
    step,
    reviewer: reviewer(),
    runner,
    context: { workspace: root, values: { name: 'auth', taskId: TASK_ID } },
    change: 'auth',
    task: { id: TASK_ID, number: '1.1', text: 'Do the thing' },
    prepared: { specDigest: DIGEST },
    timeoutMs: 5_000,
    session: 'session-1',
    now: 2_000,
    renderPrompt: () => 'test prompt',
    ...overrides,
  })
}

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('runReviewStep', () => {
  it('writes the local record and the committed approval for a task PASS', async () => {
    const root = await workspace()
    roots.push(root)
    const result = await invoke(root, runnerFor(PASS_TEXT))
    expect(result.error).toBeUndefined()
    expect(result.run.steps[0]?.state).toBe('done')
    const local = await readFile(
      join(
        root,
        localReviewRecordPath({
          rule: 'task-review',
          change: 'auth',
          scope: 'task',
          taskId: TASK_ID,
        }),
      ),
      'utf8',
    )
    const record = JSON.parse(local) as ReviewRecord
    expect(record.verdict).toBe('PASS')
    expect(record.taskId).toBe(TASK_ID)
    expect(record.digest).toBe(TASK_DIGEST)
    const approval = JSON.parse(
      await readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8'),
    ) as Record<string, unknown>
    expect(approval).toEqual({
      rule: 'task-review',
      change: 'auth',
      scope: 'task',
      taskId: TASK_ID,
      digest: TASK_DIGEST,
      verdict: 'PASS',
      findings: [],
      target: {
        provider: 'codex-subagent',
        model: 'gpt-6-astra',
        reasoningEffort: 'xhigh',
      },
      time: '1970-01-01T00:00:02.000Z',
    })
  })

  it('publishes the committed approval before the local record', async () => {
    const root = await workspace()
    roots.push(root)
    const order: string[] = []
    const result = await invoke(root, runnerFor(PASS_TEXT), {
      writePortable: async (workspaceRoot, record) => {
        order.push('portable')
        return writePortableApproval(workspaceRoot, record)
      },
      writeLocal: async (workspaceRoot, record) => {
        order.push('local')
        return writeLocalReviewRecord(workspaceRoot, record)
      },
    })
    expect(result.run.steps[0]?.state).toBe('done')
    expect(order).toEqual(['portable', 'local'])
  })

  it('writes FINDINGS, publishes no approval, and keeps the step blocked', async () => {
    const root = await workspace()
    roots.push(root)
    const text = fenced({
      digest: TASK_DIGEST,
      verdict: 'FINDINGS',
      findings: [
        {
          severity: 'P1',
          class: 'missing-test',
          title: 'No regression',
          evidence: 'the test file does not cover it',
          fix: 'add the test',
        },
      ],
    })
    const result = await invoke(root, runnerFor(text))
    expect(result.run.steps[0]?.state).toBe('blocked')
    const record = JSON.parse(
      await readFile(
        join(
          root,
          localReviewRecordPath({
            rule: 'task-review',
            change: 'auth',
            scope: 'task',
            taskId: TASK_ID,
          }),
        ),
        'utf8',
      ),
    ) as ReviewRecord
    expect(record.verdict).toBe('FINDINGS')
    await expect(
      readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8'),
    ).rejects.toThrow()
  })

  it('writes an ERROR for an invalid verdict', async () => {
    const root = await workspace()
    roots.push(root)
    const result = await invoke(root, runnerFor('Prose only; no fenced block.'))
    expect(result.error).toContain('fenced JSON verdict')
    expect(result.run.steps[0]?.state).toBe('done')
    const record = JSON.parse(
      await readFile(
        join(
          root,
          localReviewRecordPath({
            rule: 'task-review',
            change: 'auth',
            scope: 'task',
            taskId: TASK_ID,
          }),
        ),
        'utf8',
      ),
    ) as ReviewRecord
    expect(record.verdict).toBe('ERROR')
    expect(record.failureClass).toBe('invalid-output')
  })

  it('writes an ERROR when the verdict digest is not the prepared digest', async () => {
    const root = await workspace()
    roots.push(root)
    const text = fenced({ digest: 'b'.repeat(64), verdict: 'PASS', findings: [] })
    const result = await invoke(root, runnerFor(text))
    expect(result.error).toContain('digest does not match')
    expect(result.run.steps[0]?.state).toBe('done')
  })

  it('writes an ERROR when the provider cannot start', async () => {
    const root = await workspace()
    roots.push(root)
    const result = await invoke(
      root,
      runnerFor(async () => {
        throw new Error('provider "codex-subagent" is not registered')
      }),
    )
    expect(result.error).toContain('not registered')
    expect(result.run.steps[0]?.state).toBe('done')
    const record = JSON.parse(
      await readFile(
        join(
          root,
          localReviewRecordPath({
            rule: 'task-review',
            change: 'auth',
            scope: 'task',
            taskId: TASK_ID,
          }),
        ),
        'utf8',
      ),
    ) as ReviewRecord
    expect(record.verdict).toBe('ERROR')
    expect(record.failureClass).toBe('provider-not-started')
  })

  it('times out with an ERROR record', async () => {
    const root = await workspace()
    roots.push(root)
    const result = await invoke(
      root,
      { run: () => new Promise<SubagentRunResult>(() => undefined) },
      { timeoutMs: 10 },
    )
    expect(result.error).toContain('timed out')
    expect(result.run.steps[0]?.state).toBe('done')
    const record = JSON.parse(
      await readFile(
        join(
          root,
          localReviewRecordPath({
            rule: 'task-review',
            change: 'auth',
            scope: 'task',
            taskId: TASK_ID,
          }),
        ),
        'utf8',
      ),
    ) as ReviewRecord
    expect(record.verdict).toBe('ERROR')
    expect(record.failureClass).toBe('timeout')
  })

  it('publishes no PASS when the committed approval cannot be written', async () => {
    const root = await workspace()
    roots.push(root)
    const result = await invoke(root, runnerFor(PASS_TEXT), {
      writePortable: async () => ({ ok: false, error: 'disk full' }),
    })
    expect(result.error).toContain('disk full')
    expect(result.run.steps[0]?.state).toBe('done')
    const local = JSON.parse(
      await readFile(
        join(
          root,
          localReviewRecordPath({
            rule: 'task-review',
            change: 'auth',
            scope: 'task',
            taskId: TASK_ID,
          }),
        ),
        'utf8',
      ),
    ) as ReviewRecord
    expect(local.verdict).toBe('ERROR')
    await expect(
      readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8'),
    ).rejects.toThrow()
  })
})

describe('parseReviewVerdict', () => {
  it('rejects two fenced blocks and an invalid severity', () => {
    expect(parseReviewVerdict(`${PASS_TEXT}\n${PASS_TEXT}`, DIGEST).ok).toBe(false)
    const bad = fenced({
      digest: DIGEST,
      verdict: 'FINDINGS',
      findings: [{ severity: 'P2', title: 't', evidence: 'e', fix: 'f' }],
    })
    expect(parseReviewVerdict(bad, DIGEST).ok).toBe(false)
  })

  it('accepts one fenced block and normalizes an unknown class', () => {
    const text = fenced({
      digest: DIGEST,
      verdict: 'FINDINGS',
      findings: [{ severity: 'P0', class: 'made-up', title: 't', evidence: 'e', fix: 'f' }],
    })
    const parsed = parseReviewVerdict(text, DIGEST)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.findings[0]?.class).toBe('other')
  })
})

describe('review record store', () => {
  const record: ReviewRecord = {
    definition: 'task-review',
    rule: 'task-review',
    change: 'auth',
    phase: 'task',
    scope: 'task',
    taskId: TASK_ID,
    digest: DIGEST,
    verdict: 'PASS',
    findings: [],
    target: { provider: 'codex-subagent' },
    reviewer: 'codex',
    session: 'session-1',
    runId: 'run-1',
    time: '2026-11-14T00:00:00.000Z',
  }

  it('derives the whole and task record paths', () => {
    expect(
      localReviewRecordPath({ rule: 'spec-review', change: 'auth', scope: 'whole', phase: 'spec' }),
    ).toBe('.dsh/workflows/records/spec-review/auth/spec.json')
    expect(
      localReviewRecordPath({
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        taskId: TASK_ID,
      }),
    ).toBe(`.dsh/workflows/records/task-review/auth/tasks/${TASK_ID}.json`)
    expect(portableApprovalPath('auth', TASK_ID)).toBe(
      `openspec/changes/auth/reviews/${TASK_ID}.json`,
    )
  })

  it('keeps the committed approval to the sanitized field set', async () => {
    const root = await workspace()
    roots.push(root)
    expect((await writePortableApproval(root, record)).ok).toBe(true)
    const approval = JSON.parse(
      await readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8'),
    ) as Record<string, unknown>
    expect(Object.keys(approval)).toEqual([
      'rule',
      'change',
      'scope',
      'taskId',
      'digest',
      'verdict',
      'findings',
      'target',
      'time',
    ])
    expect(approval.session).toBeUndefined()
    expect(approval.runId).toBeUndefined()
    expect(approval.definition).toBeUndefined()
    expect((await writeLocalReviewRecord(root, record)).ok).toBe(true)
    const local = JSON.parse(
      await readFile(join(root, localReviewRecordPath(record)), 'utf8'),
    ) as Record<string, unknown>
    expect(local.definition).toBe('task-review')
    expect(local.runId).toBe('run-1')
  })

  it('reads the path its ownership selects', async () => {
    const root = await workspace()
    roots.push(root)
    const legacyDir = join(root, '.dsh', 'delegation', 'task-review', 'auth', 'tasks')
    await mkdir(legacyDir, { recursive: true })
    await writeFile(
      join(legacyDir, `${TASK_ID}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: 'auth',
        phase: 'task',
        scope: 'task',
        taskId: TASK_ID,
        digest: DIGEST,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-14T00:00:00.000Z',
      }),
      'utf8',
    )
    const evidence = {
      kind: 'record' as const,
      rule: 'task-review',
      change: '{name}',
      scope: 'task',
      task: '{taskId}',
      verdicts: ['PASS', 'ERROR'],
      path: `.dsh/workflows/records/task-review/{name}/tasks/{taskId}.json`,
    }
    const context = { workspace: root, values: { name: 'auth', taskId: TASK_ID } }
    expect((await verifyEvidence(evidence, { ...context, reviewOwner: 'legacy' })).ok).toBe(true)
    expect((await verifyEvidence(evidence, context)).ok).toBe(false)
    expect((await verifyEvidence(evidence, { ...context, reviewOwner: 'workflows' })).ok).toBe(
      false,
    )
  })
})

describe('review routing and prompt', () => {
  it('forwards the reviewer provider, model, effort, and catalog label', async () => {
    const root = await workspace()
    roots.push(root)
    let seen: Parameters<SubagentRunner['run']>[0] | undefined
    const result = await invoke(root, {
      run: async (request) => {
        seen = request
        return { childId: 'child-1', completed: true, text: PASS_TEXT }
      },
    })
    expect(result.error).toBeUndefined()
    expect(seen?.provider).toBe('codex-subagent')
    expect(seen?.model).toBe('gpt-6-astra')
    expect(seen?.reasoningEffort).toBe('xhigh')
    expect(seen?.reviewer).toBe('codex')
    expect(seen?.delivery).toBe('parent')
    expect(seen?.label).toBe('delegation:task-review')
  })

  it('renders the bundled instruction with the change, task, and digest', async () => {
    const root = await workspace()
    roots.push(root)
    let prompt = ''
    await invoke(
      root,
      {
        run: async (request) => {
          prompt = request.prompt
          return { childId: 'child-1', completed: true, text: PASS_TEXT }
        },
      },
      { renderPrompt: renderReviewPrompt },
    )
    expect(prompt).toContain('# Task-scoped review')
    expect(prompt).toContain('- Rule: task-review')
    expect(prompt).toContain('- Change: auth')
    expect(prompt).toContain('1.1 Do the thing')
    expect(prompt).toContain(TASK_ID)
    expect(prompt).toContain(TASK_DIGEST)
  })

  it('names the missing reviewer and its config remedy', () => {
    const missing = resolveReviewer({}, 'codex')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('reviewers.codex')
    const found = resolveReviewer(reviewers, 'codex')
    expect(found.ok).toBe(true)
    if (found.ok) expect(found.reviewer.provider).toBe('codex-subagent')
  })
})
