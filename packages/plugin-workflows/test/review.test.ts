import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type Definition,
  resolveOwnership,
  validateDefinition,
  withSource,
} from '../src/host/definitions.ts'
import { verifyEvidence } from '../src/host/evidence.ts'
import type { SubagentRunner, SubagentRunResult } from '../src/host/executors.ts'
import { portableRecordError } from '../src/host/projection.ts'
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
          definition: 'task-review',
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
            definition: 'task-review',
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
            definition: 'task-review',
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
            definition: 'task-review',
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
            definition: 'task-review',
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
            definition: 'task-review',
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

  it('records the effective model and effort supplied through agentOptions', async () => {
    const root = await workspace()
    roots.push(root)
    const map = resolveReviewers({
      codex: {
        provider: 'codex-subagent',
        agentOptions: { model: 'gpt-alt', reasoningEffort: 'high' },
      },
    })
    const reviewer = { id: 'codex', ...(map.codex as NonNullable<typeof map.codex>) }
    const received: Array<Readonly<Record<string, unknown>> | undefined> = []
    const result = await invoke(
      root,
      {
        run: async (request) => {
          received.push(request.agentOptions)
          return { childId: 'child-1', completed: true, text: PASS_TEXT }
        },
      },
      { reviewer },
    )
    expect(result.error).toBeUndefined()
    expect(received[0]).toEqual({ model: 'gpt-alt', reasoningEffort: 'high' })
    const local = JSON.parse(
      await readFile(
        join(
          root,
          localReviewRecordPath({
            definition: 'task-review',
            change: 'auth',
            scope: 'task',
            taskId: TASK_ID,
          }),
        ),
        'utf8',
      ),
    ) as ReviewRecord
    expect(local.target).toEqual({
      provider: 'codex-subagent',
      model: 'gpt-alt',
      reasoningEffort: 'high',
    })
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

it('binds a task digest to the frozen change-artifact digest', () => {
  const first = reviewDigest({
    scope: 'task',
    specDigest: 'a'.repeat(64),
    tree: 'tree',
    artifactDigest: 'first',
  })
  const second = reviewDigest({
    scope: 'task',
    specDigest: 'a'.repeat(64),
    tree: 'tree',
    artifactDigest: 'second',
  })
  expect(first).not.toBe(second)
  expect(first).toHaveLength(64)
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
      localReviewRecordPath({
        definition: 'spec-review',
        change: 'auth',
        scope: 'whole',
        phase: 'spec',
      }),
    ).toBe('.dsh/workflows/records/spec-review/auth/spec.json')
    expect(
      localReviewRecordPath({
        definition: 'task-review',
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

describe('record write boundary', () => {
  const boundaryRecord: ReviewRecord = {
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

  it('refuses a linked local record store and publishes nothing outside', async () => {
    const root = await workspace()
    roots.push(root)
    const outside = await mkdtemp(join(tmpdir(), 'workflows-review-outside-'))
    roots.push(outside)
    await mkdir(join(root, '.dsh', 'workflows'), { recursive: true })
    await symlink(outside, join(root, '.dsh', 'workflows', 'records'), 'junction')
    const written = await writeLocalReviewRecord(root, boundaryRecord)
    expect(written.ok).toBe(false)
    if (!written.ok) expect(written.error).toContain('link')
    expect(await readdir(outside)).toEqual([])
  })

  it('refuses a linked committed approval directory and publishes nothing outside', async () => {
    const root = await workspace()
    roots.push(root)
    const outside = await mkdtemp(join(tmpdir(), 'workflows-approval-outside-'))
    roots.push(outside)
    const changeDir = join(root, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await symlink(outside, join(changeDir, 'reviews'), 'junction')
    const written = await writePortableApproval(root, boundaryRecord)
    expect(written.ok).toBe(false)
    if (!written.ok) expect(written.error).toContain('link')
    expect(await readdir(outside)).toEqual([])
  })
})

describe('record path identity and portable target boundary', () => {
  it('uses the definition id for the local directory, not the rule', async () => {
    const root = await workspace()
    roots.push(root)
    const first = localReviewRecordPath({
      definition: 'task-review-copy',
      change: 'auth',
      scope: 'task',
      taskId: TASK_ID,
    })
    expect(first).toContain('/task-review-copy/')
    const record: ReviewRecord = {
      definition: 'task-review-copy',
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
      time: '2026-11-14T00:00:00.000Z',
    }
    expect((await writeLocalReviewRecord(root, record)).ok).toBe(true)
    const written = JSON.parse(await readFile(join(root, first), 'utf8')) as ReviewRecord
    expect(written.rule).toBe('task-review')
    expect(written.definition).toBe('task-review-copy')
  })

  it('rejects a reviewer machine path at load and an unsafe approval target at publication', async () => {
    expect(() => resolveReviewers({ codex: { provider: 'p', model: '/models/x.gguf' } })).toThrow(
      /machine path/u,
    )
    expect(() =>
      resolveReviewers({ codex: { provider: 'p', agentOptions: { model: 'C:\\models\\x' } } }),
    ).toThrow(/machine path/u)
    const root = await workspace()
    roots.push(root)
    const unsafe: ReviewRecord = {
      definition: 'task-review',
      rule: 'task-review',
      change: 'auth',
      phase: 'task',
      scope: 'task',
      taskId: TASK_ID,
      digest: DIGEST,
      verdict: 'PASS',
      findings: [],
      target: { provider: 'codex-subagent', model: '/models/x.gguf' },
      reviewer: 'codex',
      time: '2026-11-14T00:00:00.000Z',
    }
    const written = await writePortableApproval(root, unsafe)
    expect(written.ok).toBe(false)
    if (!written.ok) expect(written.error).toContain('machine path')
  })

  it('writes an approval the unchanged portable parser accepts', async () => {
    const root = await workspace()
    roots.push(root)
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
      target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
      reviewer: 'codex',
      time: '2026-11-14T00:00:00.000Z',
    }
    expect((await writePortableApproval(root, record)).ok).toBe(true)
    const approval = JSON.parse(
      await readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8'),
    ) as Record<string, unknown>
    expect(portableRecordError(approval)).toBeUndefined()
  })
})

describe('review evidence contract', () => {
  it('refuses a review step that does not declare its matching record evidence', () => {
    const def = taskDefinition()
    const step = def.steps[0] as Definition['steps'][number]
    expect(() =>
      validateDefinition({
        ...def,
        steps: [{ ...step, evidence: { kind: 'file', path: 'README.md' } }],
      }),
    ).toThrow(/must be "record"/u)
    expect(() =>
      validateDefinition({
        ...def,
        steps: [
          {
            ...step,
            evidence: {
              ...(step.evidence as unknown as Record<string, unknown>),
              rule: 'other-rule',
            },
          },
        ],
      }),
    ).toThrow(/another record/u)
    expect(() =>
      validateDefinition({
        ...def,
        steps: [
          {
            ...step,
            evidence: {
              ...(step.evidence as unknown as Record<string, unknown>),
              path: 'test/fixtures/delegation-record.json',
            },
          },
        ],
      }),
    ).toThrow(/stay under|record store/u)
  })

  it('binds task evidence to the run task and change placeholders', () => {
    const def = taskDefinition()
    const step = def.steps[0] as Definition['steps'][number]
    const ev = step.evidence as unknown as Record<string, unknown>
    expect(() =>
      validateDefinition({
        ...def,
        steps: [{ ...step, evidence: { ...ev, task: '0123456789abcdef' } }],
      }),
    ).toThrow(/placeholder/u)
    expect(() =>
      validateDefinition({
        ...def,
        steps: [
          {
            ...step,
            evidence: {
              ...ev,
              path: '.dsh/workflows/records/task-review/{name}/tasks/fixed.json',
            },
          },
        ],
      }),
    ).toThrow(/placeholder/u)
  })

  it('refuses a review step that cannot accept PASS', () => {
    const def = taskDefinition()
    const step = def.steps[0] as Definition['steps'][number]
    const ev = step.evidence as unknown as Record<string, unknown>
    expect(() =>
      validateDefinition({
        ...def,
        steps: [{ ...step, evidence: { ...ev, verdicts: ['FINDINGS'] } }],
      }),
    ).toThrow(/accept PASS/u)
    expect(() =>
      validateDefinition({
        ...def,
        steps: [{ ...step, evidence: { ...ev, verdicts: ['PASS'] } }],
      }),
    ).not.toThrow()
  })
  it('requires the same record contract even without the review gate', () => {
    const def = taskDefinition()
    const step = def.steps[0] as Definition['steps'][number]
    const { gate: _gate, gateIdentity: _identity, ...settings } = def.settings
    expect(() =>
      validateDefinition({
        ...def,
        settings,
        steps: [{ ...step, evidence: { kind: 'file', path: 'README.md' } }],
      }),
    ).toThrow(/must be "record"/u)
  })

  it('does not call the reviewer when the step evidence is unrelated', async () => {
    const root = await workspace()
    roots.push(root)
    const definition = taskDefinition()
    const step = definition.steps[0] as Definition['steps'][number]
    let started = 0
    const result = await runReviewStep({
      run: baseRun(definition),
      definition,
      step: { ...step, evidence: { kind: 'file', path: 'README.md' } },
      reviewer: reviewer(),
      runner: {
        run: async () => {
          started += 1
          return { childId: 'child-1', completed: true, text: PASS_TEXT }
        },
      },
      context: { workspace: root, values: { name: 'auth', taskId: TASK_ID } },
      change: 'auth',
      task: { id: TASK_ID, number: '1.1', text: 'Do the thing' },
      prepared: { specDigest: DIGEST },
      timeoutMs: 5_000,
      session: 'session-1',
      renderPrompt: () => 'test prompt',
    })
    expect(started).toBe(0)
    expect(result.run.steps[0]?.state).toBe('failed')
    expect(result.error).toContain('record')
  })
})

describe('review instruction failure', () => {
  it('writes an ERROR record when the bundled instruction cannot be rendered', async () => {
    const root = await workspace()
    roots.push(root)
    const definition = taskDefinition()
    const step = definition.steps[0] as Definition['steps'][number]
    const result = await invoke(root, runnerFor(PASS_TEXT), {
      step: {
        ...step,
        review: {
          target: 'codex',
          instruction: 'no-such-instruction',
          scope: 'task',
        },
      },
      renderPrompt: renderReviewPrompt,
    })
    expect(result.error).toContain('could not be rendered')
    const record = JSON.parse(
      await readFile(
        join(
          root,
          localReviewRecordPath({
            definition: 'task-review',
            change: 'auth',
            scope: 'task',
            taskId: TASK_ID,
          }),
        ),
        'utf8',
      ),
    ) as ReviewRecord
    expect(record.verdict).toBe('ERROR')
    expect(record.failureClass).toBe('config')
  })
})

describe('review publication identity', () => {
  it('validates the evidence directory against the definition id, not the gate identity', () => {
    const def = taskDefinition()
    const step = def.steps[0] as Definition['steps'][number]
    const ev = step.evidence as unknown as Record<string, unknown>
    const copy = {
      ...def,
      id: 'task-review-copy',
      settings: { ...def.settings, gateIdentity: 'task-review' },
      steps: [
        {
          ...step,
          evidence: {
            ...ev,
            path: '.dsh/workflows/records/task-review-copy/{name}/tasks/{taskId}.json',
          },
        },
      ],
    }
    expect(() => validateDefinition(copy)).not.toThrow()
    expect(() =>
      validateDefinition({
        ...copy,
        steps: [
          {
            ...step,
            evidence: {
              ...ev,
              path: '.dsh/workflows/records/task-review/{name}/tasks/{taskId}.json',
            },
          },
        ],
      }),
    ).toThrow(/task-review-copy/u)
  })

  it("does not settle FINDINGS from another run's concurrent PASS", async () => {
    const root = await workspace()
    roots.push(root)
    const text = fenced({
      digest: TASK_DIGEST,
      verdict: 'FINDINGS',
      findings: [{ severity: 'P1', title: 't', evidence: 'e', fix: 'f' }],
    })
    const result = await invoke(root, runnerFor(text), {
      writeLocal: async (workspaceRoot, record) => {
        const written = await writeLocalReviewRecord(workspaceRoot, record)
        await writeLocalReviewRecord(workspaceRoot, {
          ...record,
          runId: 'other-run',
          verdict: 'PASS',
          findings: [],
        })
        return written
      },
    })
    expect(result.run.steps[0]?.state).toBe('blocked')
  })
})

describe('per-signal switch diagnostics', () => {
  const SWITCHES: ReadonlyArray<readonly [string, string]> = [
    ['spec-review', 'delegation.gates.specReview'],
    ['task-review', 'delegation.gates.workflowOwned'],
    ['integration-review', 'delegation.gates.integrationReview'],
    ['task-progress', 'delegation.gates.taskProgress'],
    ['lane-assignment', 'delegation.gates.laneFanout'],
  ]

  function localDefinition(signal: string): Definition {
    return validateDefinition({
      v: 1,
      id: 'local-legacy',
      name: 'Local legacy',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
      settings: {
        allowModelStart: false,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 3,
        allowIntent: false,
        legacy: { plugin: 'delegation-rules', signal },
      },
      steps: [
        {
          id: 's',
          title: 'Step',
          executor: 'main',
          prompt: 'Do it.',
          evidence: { kind: 'file', path: 'README.md' },
          next: 'end',
        },
      ],
    })
  }

  it('names the exact switch for every signal', () => {
    for (const [signal, switchName] of SWITCHES) {
      const issues = resolveOwnership(
        localDefinition(signal),
        new Set(['delegation-rules']),
        new Set([`delegation-rules/${signal}`]),
      ).issues.join('\n')
      expect(issues).toContain(switchName)
    }
  })

  it('resolves a shipped review definition from its switch', () => {
    const shipped = withSource(taskDefinition(), 'shipped')
    const enabled = resolveOwnership(
      shipped,
      new Set(['delegation-rules']),
      new Set(['delegation-rules/task-review']),
    )
    expect(enabled.issues).toEqual([])
    expect(enabled.steps.every((step) => step.ownership === 'defer')).toBe(true)
    const disabled = resolveOwnership(shipped, new Set(['delegation-rules']), new Set())
    expect(disabled.issues).toEqual([])
    expect(disabled.steps.every((step) => step.ownership === 'own')).toBe(true)
  })
})
