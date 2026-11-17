import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type Definition,
  type RecordEvidence,
  resolveOwnership,
  reviewIdentityOf,
  reviewStoreOf,
  validateDefinition,
  withSource,
} from '../src/host/definitions.ts'
import { currentSpecDigest, verifyEvidence } from '../src/host/evidence.ts'
import type { SubagentRunner, SubagentRunResult } from '../src/host/executors.ts'
import { defaultGit, type GitRunner, worktreeDigest } from '../src/host/git.ts'
import { portableRecordError } from '../src/host/projection.ts'
import {
  localReviewRecordPath,
  parseReviewVerdict,
  portableApprovalPath,
  type ReviewFinding,
  type ReviewRecord,
  renderReviewPrompt,
  resolveReviewer,
  resolveReviewers,
  reviewDigest,
  runReviewStep,
  type SectionReview,
  sectionReviewDigest,
  writeLocalReviewRecord,
  writePortableApproval,
} from '../src/host/review.ts'
import { createRun } from '../src/host/runs.ts'
import { taskIdOf } from '../src/host/tasks.ts'

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

const TREE_BEFORE = 'a'.repeat(40)
const TREE_AFTER = 'b'.repeat(40)

function focusedDigest(tree: string): string {
  return reviewDigest({ scope: 'task', specDigest: DIGEST, tree })
}

function testFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: 'P1',
    class: 'missing-test',
    title: 'No regression',
    evidence: 'the test file does not cover it',
    fix: 'add the test',
    ...overrides,
  }
}

function taskRecordPath(): string {
  return localReviewRecordPath({
    definition: 'task-review',
    change: 'auth',
    scope: 'task',
    taskId: TASK_ID,
  })
}

async function writePriorFindings(
  root: string,
  prior: { digest: string; findings: readonly ReviewFinding[]; reviewedTree?: string },
): Promise<void> {
  const path = join(root, taskRecordPath())
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(
    path,
    `${JSON.stringify(
      {
        definition: 'task-review',
        rule: 'task-review',
        change: 'auth',
        phase: 'task',
        scope: 'task',
        taskId: TASK_ID,
        digest: prior.digest,
        verdict: 'FINDINGS',
        findings: prior.findings,
        target: { provider: 'codex-subagent' },
        reviewer: 'codex',
        time: '2026-11-14T00:00:00.000Z',
        ...(prior.reviewedTree === undefined ? {} : { reviewedTree: prior.reviewedTree }),
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

/** A fake git runner; the focused diff never touches the real repository in tests. */
function fakeGit(options: { statuses?: string; patch?: string; missingTree?: boolean } = {}): {
  calls: string[][]
  runGit: GitRunner
} {
  const calls: string[][] = []
  const runGit: GitRunner = async (args) => {
    calls.push([...args])
    if (args[0] === 'cat-file') {
      if (options.missingTree === true) throw new Error('fatal: Not a valid object name')
      return Buffer.from('')
    }
    if (args[0] === 'diff' && args.includes('--name-status')) {
      return Buffer.from(options.statuses ?? 'M\tsrc/engine.ts\n')
    }
    if (args[0] === 'diff') {
      return Buffer.from(
        options.patch ??
          'diff --git a/src/engine.ts b/src/engine.ts\n@@ -1 +1 @@\n-export const engine = 1\n+export const engine = 2\n',
      )
    }
    return Buffer.from('')
  }
  return { calls, runGit }
}

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('runReviewStep', () => {
  it('fails a changed live input even when the verdict itself is a PASS', async () => {
    const root = await workspace()
    roots.push(root)
    const result = await invoke(root, runnerFor(PASS_TEXT), {
      prepared: {
        specDigest: DIGEST,
        liveGuard: async () => '1 changed: src/engine.ts',
      },
    })
    expect(result.record?.verdict).toBe('ERROR')
    expect(result.record?.failureClass).toBe('reviewed-inputs-changed')
    expect(result.record?.error).toContain('src/engine.ts')
    expect(result.run.steps[0]?.state).not.toBe('done')
  })
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

  it('publishes one approval per covered section task and preserves a matching one', async () => {
    const root = await workspace()
    roots.push(root)
    const section: SectionReview = {
      key: '1',
      title: '1. Compose the profile',
      recordId: 'fedcba9876543210',
      covered: [
        { id: '0123456789abcdef', number: '1.1', text: 'First covered' },
        { id: '1111111111111111', number: '1.2', text: 'Second covered' },
      ],
      unchecked: [],
    }
    const digest = sectionReviewDigest(section, DIGEST)
    const preservedPath = join(root, portableApprovalPath('auth', '0123456789abcdef'))
    await mkdir(join(preservedPath, '..'), { recursive: true })
    const preserved = `${JSON.stringify(
      {
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        taskId: '0123456789abcdef',
        digest: 'b'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
        time: '2026-01-01T00:00:00.000Z',
      },
      null,
      2,
    )}\n`
    await writeFile(preservedPath, preserved, 'utf8')
    const result = await invoke(
      root,
      runnerFor(fenced({ digest, verdict: 'PASS', findings: [] })),
      {
        prepared: { specDigest: DIGEST, section },
        context: {
          workspace: root,
          values: {
            name: 'auth',
            taskId: section.recordId,
            taskIds: section.covered.map((task) => task.id),
          },
        },
        task: undefined,
      },
    )
    expect(result.run.steps[0]?.state).toBe('done')
    expect(result.record).toMatchObject({
      scope: 'task',
      taskId: section.recordId,
      section: '1',
      taskIds: section.covered.map((task) => task.id),
      digest,
    })
    // The matching approval stays byte-identical; the other covered task gets one.
    expect(await readFile(preservedPath, 'utf8')).toBe(preserved)
    const written = JSON.parse(
      await readFile(join(root, portableApprovalPath('auth', '1111111111111111')), 'utf8'),
    ) as Record<string, unknown>
    expect(written).toMatchObject({
      rule: 'task-review',
      change: 'auth',
      taskId: '1111111111111111',
      digest,
      verdict: 'PASS',
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
    // A missing provider is a permanent config failure, never a retryable start.
    expect(record.failureClass).toBe('config')
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

  it('settles a matching ERROR as provisional when the step accepts only PASS', async () => {
    const root = await workspace()
    roots.push(root)
    const definition = taskDefinition()
    const step = definition.steps[0]
    if (step === undefined) throw new Error('the task definition has no review step')
    const provisionalStep = {
      ...step,
      evidence: { ...(step.evidence as RecordEvidence), verdict: 'PASS', verdicts: undefined },
    }
    const result = await invoke(
      root,
      runnerFor(() => Promise.reject(new Error('provider down'))),
      { step: provisionalStep },
    )
    expect(result.record?.verdict).toBe('ERROR')
    const recordPath = localReviewRecordPath({
      definition: 'task-review',
      change: 'auth',
      scope: 'task',
      taskId: TASK_ID,
    })
    // Only a PASS completes a PASS-only step; the matching ERROR leaves it
    // failed with its record visible so the close stays allowed and retries.
    const settled = result.run.steps[0]
    expect(settled?.state).toBe('failed')
    expect(settled?.evidence?.path).toBe(recordPath)
    expect(settled?.reason).toContain('ERROR')
    expect(settled?.reason).toContain('retries the review')
    await expect(
      readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8'),
    ).rejects.toThrow()
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

describe('focused re-review', () => {
  it('renders the complete prior findings and the diff from the prior reviewed tree', async () => {
    const root = await workspace()
    roots.push(root)
    const findings = [
      testFinding({ title: 'First failure', evidence: 'the first evidence', fix: 'the first fix' }),
      testFinding({
        severity: 'P0',
        class: 'security',
        title: 'Second failure',
        evidence: 'the second evidence',
        fix: 'the second fix',
      }),
    ]
    await writePriorFindings(root, {
      digest: reviewDigest({ scope: 'task', specDigest: DIGEST }),
      findings,
      reviewedTree: TREE_BEFORE,
    })
    const digest = focusedDigest(TREE_AFTER)
    const text = fenced({
      digest,
      verdict: 'PASS',
      previous: [
        { id: 'f1', status: 'closed' },
        { id: 'f2', status: 'closed' },
      ],
      findings: [],
    })
    let prompt = ''
    const result = await invoke(
      root,
      {
        run: async (request) => {
          prompt = request.prompt
          return { childId: 'child-1', completed: true, text }
        },
      },
      {
        prepared: { specDigest: DIGEST, tree: TREE_AFTER, reviewCwd: '/snapshot/run-1' },
        runGit: fakeGit({ statuses: 'M\tsrc/engine.ts\nA\tsrc/new.ts\n' }).runGit,
        renderPrompt: renderReviewPrompt,
      },
    )
    expect(result.run.steps[0]?.state).toBe('done')
    // The rendered inventory is after the bundled instruction and lists every
    // prior finding in full, keyed by its stable id.
    expect(prompt.lastIndexOf('## Previous findings')).toBeGreaterThan(
      prompt.indexOf('## Native review'),
    )
    for (const line of [
      'f1 [P1] (missing-test) First failure',
      'the first evidence',
      'the first fix',
      'f2 [P0] (security) Second failure',
      'the second evidence',
      'the second fix',
    ]) {
      expect(prompt).toContain(line)
    }
    expect(prompt.lastIndexOf('## Changes since the last review')).toBeGreaterThan(
      prompt.indexOf('## Native review'),
    )
    expect(prompt).toContain(`The prior reviewed tree is \`${TREE_BEFORE}\``)
    expect(prompt).toContain(`the current reviewed tree is \`${TREE_AFTER}\``)
    expect(prompt).toContain('- M\tsrc/engine.ts')
    expect(prompt).toContain('- A\tsrc/new.ts')
    expect(prompt).toContain('+export const engine = 2')
    expect(prompt).toContain('also return `previous`')
    const local = JSON.parse(await readFile(join(root, taskRecordPath()), 'utf8')) as ReviewRecord
    expect(local.reviewedTree).toBe(TREE_AFTER)
    expect(local.previous).toEqual([
      { id: 'f1', status: 'closed' },
      { id: 'f2', status: 'closed' },
    ])
    const approval = JSON.parse(
      await readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8'),
    ) as Record<string, unknown>
    expect(Object.keys(approval)).not.toContain('previous')
    expect(Object.keys(approval)).not.toContain('reviewedTree')
  })

  it('fails loud when the complete prior-finding inventory exceeds the prompt limit', async () => {
    const root = await workspace()
    roots.push(root)
    const findings = Array.from({ length: 90 }, (_unused, index) =>
      testFinding({
        title: `prior finding ${String(index)}`,
        evidence: 'e'.repeat(2_000),
        fix: 'f'.repeat(2_000),
      }),
    )
    await writePriorFindings(root, {
      digest: reviewDigest({ scope: 'task', specDigest: DIGEST }),
      findings,
      reviewedTree: TREE_BEFORE,
    })
    let started = 0
    const result = await invoke(
      root,
      {
        run: async () => {
          started += 1
          return { childId: 'child-1', completed: true, text: PASS_TEXT }
        },
      },
      {
        prepared: { specDigest: DIGEST, tree: TREE_AFTER },
        runGit: fakeGit().runGit,
      },
    )
    // The inventory is never truncated: the reviewer never starts and an ERROR
    // record names the cause.
    expect(started).toBe(0)
    expect(result.record?.verdict).toBe('ERROR')
    expect(result.record?.failureClass).toBe('config')
    expect(result.error).toContain('prior-finding inventory')
    expect(result.error).toContain('focused review limit')
    await expect(
      readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8'),
    ).rejects.toThrow()
  })

  it('falls back to the prior findings when the prior record carries no reviewed tree', async () => {
    const root = await workspace()
    roots.push(root)
    await writePriorFindings(root, {
      digest: reviewDigest({ scope: 'task', specDigest: DIGEST }),
      findings: [testFinding({ title: 'First failure' })],
    })
    const digest = focusedDigest(TREE_AFTER)
    let prompt = ''
    const result = await invoke(
      root,
      {
        run: async (request) => {
          prompt = request.prompt
          return {
            childId: 'child-1',
            completed: true,
            text: fenced({
              digest,
              verdict: 'PASS',
              previous: [{ id: 'f1', status: 'closed' }],
              findings: [],
            }),
          }
        },
      },
      {
        prepared: { specDigest: DIGEST, tree: TREE_AFTER },
        runGit: fakeGit().runGit,
        renderPrompt: renderReviewPrompt,
      },
    )
    expect(result.run.steps[0]?.state).toBe('done')
    expect(prompt).toContain(
      'The diff since the prior reviewed tree is unavailable: the prior review record carries no reviewed tree.',
    )
    expect(prompt).toContain('First failure')
    expect(result.record?.previous).toEqual([{ id: 'f1', status: 'closed' }])
  })

  it('names a missing prior tree object as the fallback cause', async () => {
    const root = await workspace()
    roots.push(root)
    await writePriorFindings(root, {
      digest: reviewDigest({ scope: 'task', specDigest: DIGEST }),
      findings: [testFinding({ title: 'First failure' })],
      reviewedTree: TREE_BEFORE,
    })
    const digest = focusedDigest(TREE_AFTER)
    let prompt = ''
    const result = await invoke(
      root,
      {
        run: async (request) => {
          prompt = request.prompt
          return {
            childId: 'child-1',
            completed: true,
            text: fenced({
              digest,
              verdict: 'PASS',
              previous: [{ id: 'f1', status: 'closed' }],
              findings: [],
            }),
          }
        },
      },
      {
        prepared: { specDigest: DIGEST, tree: TREE_AFTER },
        runGit: fakeGit({ missingTree: true }).runGit,
        renderPrompt: renderReviewPrompt,
      },
    )
    expect(result.run.steps[0]?.state).toBe('done')
    expect(prompt).toContain(
      'is no longer in the repository object database. Confirm the prior findings',
    )
  })

  it('bounds the changed-path list and the patch and names the snapshot checkout', async () => {
    const root = await workspace()
    roots.push(root)
    await writePriorFindings(root, {
      digest: reviewDigest({ scope: 'task', specDigest: DIGEST }),
      findings: [testFinding({ title: 'First failure' })],
      reviewedTree: TREE_BEFORE,
    })
    const digest = focusedDigest(TREE_AFTER)
    const statuses = Array.from(
      { length: 201 },
      (_unused, index) => `M\tsrc/file${String(index)}.ts`,
    ).join('\n')
    const patch = Array.from({ length: 500 }, (_unused, index) => `+line ${String(index)}`).join(
      '\n',
    )
    let prompt = ''
    const result = await invoke(
      root,
      {
        run: async (request) => {
          prompt = request.prompt
          return {
            childId: 'child-1',
            completed: true,
            text: fenced({
              digest,
              verdict: 'PASS',
              previous: [{ id: 'f1', status: 'closed' }],
              findings: [],
            }),
          }
        },
      },
      {
        prepared: { specDigest: DIGEST, tree: TREE_AFTER, reviewCwd: '/snapshot/run-1' },
        runGit: fakeGit({ statuses, patch }).runGit,
        renderPrompt: renderReviewPrompt,
      },
    )
    expect(result.run.steps[0]?.state).toBe('done')
    expect(prompt).toContain('Changed paths (the first 200; the list is bounded):')
    expect(prompt).toContain('- M\tsrc/file199.ts')
    expect(prompt).toContain('+line 399')
    expect(prompt).not.toContain('+line 400')
    expect(prompt).toContain(
      'The patch is truncated at the 400-line / 32 KiB bound; read the full change in the current snapshot checkout at /snapshot/run-1.',
    )
  })

  it('starts no reviewer when the run is cancelled during preparation', async () => {
    const root = await workspace()
    roots.push(root)
    let started = 0
    const result = await invoke(
      root,
      {
        run: async () => {
          started += 1
          return { childId: 'child-1', completed: true, text: PASS_TEXT }
        },
      },
      { cancelled: () => true },
    )
    expect(started).toBe(0)
    expect(result.discarded).toBe(true)
  })

  it('keeps a full review when the prior section covered a narrower set', async () => {
    const root = await workspace()
    roots.push(root)
    const changeDir = join(root, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(
      join(changeDir, 'tasks.md'),
      '# Tasks\n\n## 1. Engine\n\n- [x] 1.1 First covered\n- [x] 1.2 Second covered\n- [x] 1.3 Third covered\n',
      'utf8',
    )
    const first = taskIdOf('First covered')
    const second = taskIdOf('Second covered')
    const third = taskIdOf('Third covered')
    const priorSection: SectionReview = {
      key: '1',
      title: '1. Engine',
      recordId: 'fedcba9876543210',
      covered: [
        { id: first, number: '1.1', text: 'First covered' },
        { id: second, number: '1.2', text: 'Second covered' },
      ],
      unchecked: [],
    }
    const recordPath = localReviewRecordPath({
      definition: 'task-review',
      change: 'auth',
      scope: 'task',
      taskId: priorSection.recordId,
    })
    await mkdir(join(root, recordPath, '..'), { recursive: true })
    await writeFile(
      join(root, recordPath),
      `${JSON.stringify(
        {
          definition: 'task-review',
          rule: 'task-review',
          change: 'auth',
          phase: 'task',
          scope: 'task',
          taskId: priorSection.recordId,
          section: '1',
          sectionTitle: '1. Engine',
          taskIds: [first, second],
          digest: sectionReviewDigest(priorSection, DIGEST),
          verdict: 'FINDINGS',
          findings: [testFinding({ title: 'First failure' })],
          reviewedTree: TREE_BEFORE,
          target: { provider: 'codex-subagent' },
          time: '2026-11-14T00:00:00.000Z',
        },
        null,
        2,
      )}\n`,
      'utf8',
    )
    const currentSection: SectionReview = {
      ...priorSection,
      covered: [...priorSection.covered, { id: third, number: '1.3', text: 'Third covered' }],
    }
    let prompt = ''
    const digest = sectionReviewDigest(currentSection, DIGEST, TREE_AFTER)
    // A section run carries the section record id as its task id, so the step
    // evidence path resolves to the section record.
    const definition = taskDefinition()
    const result = await runReviewStep({
      run: createRun({
        definition: definition.id,
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace: '/workspace',
        context: { name: 'auth', taskId: priorSection.recordId, section: '1' },
        steps: ['review'],
        now: 1_000,
      }),
      definition,
      step: definition.steps[0] as Definition['steps'][number],
      reviewer: reviewer(),
      runner: {
        run: async (request) => {
          prompt = request.prompt
          return {
            childId: 'child-1',
            completed: true,
            text: fenced({ digest, verdict: 'PASS', findings: [] }),
          }
        },
      },
      context: {
        workspace: root,
        values: {
          name: 'auth',
          taskId: priorSection.recordId,
          taskIds: [first, second, third],
        },
      },
      change: 'auth',
      prepared: { specDigest: DIGEST, tree: TREE_AFTER, section: currentSection },
      timeoutMs: 5_000,
      session: 'session-1',
      now: 2_000,
      runGit: fakeGit().runGit,
      renderPrompt: renderReviewPrompt,
    })
    // The newly checked task existed before the prior tree, so its defects are
    // outside the focused diff: the expanded section gets a full review.
    expect(result.run.steps[0]?.state).toBe('done')
    expect(prompt).not.toContain('The prior reviewed tree is')
    expect(prompt).not.toContain('also return `previous`')
  })

  it('keeps the full prompt when no prior FINDINGS moved', async () => {
    const root = await workspace()
    roots.push(root)
    // A same-digest FINDINGS record keeps the existing path, not a focused one.
    await writePriorFindings(root, {
      digest: TASK_DIGEST,
      findings: [testFinding({ title: 'First failure' })],
      reviewedTree: TREE_BEFORE,
    })
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
    expect(prompt).not.toContain('also return `previous`')
    expect(prompt).not.toContain('The prior reviewed tree is')
    const local = JSON.parse(await readFile(join(root, taskRecordPath()), 'utf8')) as ReviewRecord
    expect(local.previous).toBeUndefined()
  })

  it('confirms duplicate prior titles by id and stores the confirmations locally', async () => {
    const root = await workspace()
    roots.push(root)
    // Both prior titles sanitize to the same text; only the positional ids
    // distinguish them.
    await writePriorFindings(root, {
      digest: reviewDigest({ scope: 'task', specDigest: DIGEST }),
      findings: [testFinding({ title: '[path]' }), testFinding({ title: '[path]' })],
      reviewedTree: TREE_BEFORE,
    })
    const digest = focusedDigest(TREE_AFTER)
    const text = fenced({
      digest,
      verdict: 'FINDINGS',
      previous: [
        { id: 'f1', status: 'open' },
        { id: 'f2', status: 'closed' },
      ],
      findings: [
        {
          severity: 'P1',
          class: 'missing-test',
          title: 'Still failing',
          evidence: 'the first evidence still holds',
          fix: 'finish the fix',
          previousId: 'f1',
        },
      ],
    })
    const result = await invoke(root, runnerFor(text), {
      prepared: { specDigest: DIGEST, tree: TREE_AFTER },
      runGit: fakeGit().runGit,
    })
    expect(result.run.steps[0]?.state).toBe('blocked')
    const local = JSON.parse(await readFile(join(root, taskRecordPath()), 'utf8')) as ReviewRecord
    expect(local.previous).toEqual([
      { id: 'f1', status: 'open' },
      { id: 'f2', status: 'closed' },
    ])
    expect(local.findings).toHaveLength(1)
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

describe('parseReviewVerdict focused confirmations', () => {
  const PRIOR_IDS = ['f1', 'f2'] as const
  const previous = [
    { id: 'f1', status: 'closed' },
    { id: 'f2', status: 'closed' },
  ]

  it('returns one confirmation per prior id and requires every one closed for PASS', () => {
    const parsed = parseReviewVerdict(
      fenced({ digest: DIGEST, verdict: 'PASS', previous, findings: [] }),
      DIGEST,
      PRIOR_IDS,
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.previous).toEqual(previous)
    const open = parseReviewVerdict(
      fenced({
        digest: DIGEST,
        verdict: 'PASS',
        previous: [
          { id: 'f1', status: 'open' },
          { id: 'f2', status: 'closed' },
        ],
        findings: [],
      }),
      DIGEST,
      PRIOR_IDS,
    )
    expect(open.ok).toBe(false)
    if (!open.ok) expect(open.error).toContain('every prior finding to be closed')
  })

  it('accepts an open prior id repeated by exactly one finding with previousId', () => {
    const parsed = parseReviewVerdict(
      fenced({
        digest: DIGEST,
        verdict: 'FINDINGS',
        previous: [
          { id: 'f1', status: 'open' },
          { id: 'f2', status: 'closed' },
        ],
        findings: [
          {
            severity: 'P1',
            class: 'missing-test',
            title: 'Still failing',
            evidence: 'the first evidence still holds',
            fix: 'finish the fix',
            previousId: 'f1',
          },
        ],
      }),
      DIGEST,
      PRIOR_IDS,
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.verdict).toBe('FINDINGS')
      expect(parsed.previous).toEqual([
        { id: 'f1', status: 'open' },
        { id: 'f2', status: 'closed' },
      ])
    }
  })

  it('rejects missing, duplicate, and unknown confirmation ids', () => {
    const run = (entries: unknown[]): ReturnType<typeof parseReviewVerdict> =>
      parseReviewVerdict(
        fenced({ digest: DIGEST, verdict: 'PASS', previous: entries, findings: [] }),
        DIGEST,
        PRIOR_IDS,
      )
    const missing = run([{ id: 'f1', status: 'closed' }])
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('omits prior finding id(s) f2')
    const duplicate = run([
      { id: 'f1', status: 'closed' },
      { id: 'f1', status: 'closed' },
    ])
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error).toContain('repeats prior finding id "f1"')
    const unknown = run([
      { id: 'f1', status: 'closed' },
      { id: 'f9', status: 'closed' },
    ])
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toContain('unknown prior finding id "f9"')
  })

  it('rejects a finding that names a closed prior id', () => {
    const parsed = parseReviewVerdict(
      fenced({
        digest: DIGEST,
        verdict: 'FINDINGS',
        previous,
        findings: [{ severity: 'P1', title: 't', evidence: 'e', fix: 'f', previousId: 'f1' }],
      }),
      DIGEST,
      PRIOR_IDS,
    )
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain('that confirmation is "closed"')
  })

  it('rejects an open prior id with no finding or with two findings', () => {
    const base = {
      digest: DIGEST,
      verdict: 'FINDINGS',
      previous: [
        { id: 'f1', status: 'open' },
        { id: 'f2', status: 'closed' },
      ],
    }
    const unnamed = parseReviewVerdict(
      fenced({
        ...base,
        findings: [{ severity: 'P1', title: 'new', evidence: 'e', fix: 'f' }],
      }),
      DIGEST,
      PRIOR_IDS,
    )
    expect(unnamed.ok).toBe(false)
    if (!unnamed.ok) expect(unnamed.error).toContain('"f1" is not named by a finding')
    const repeated = parseReviewVerdict(
      fenced({
        ...base,
        findings: [
          { severity: 'P1', title: 'a', evidence: 'e', fix: 'f', previousId: 'f1' },
          { severity: 'P1', title: 'b', evidence: 'e', fix: 'f', previousId: 'f1' },
        ],
      }),
      DIGEST,
      PRIOR_IDS,
    )
    expect(repeated.ok).toBe(false)
    if (!repeated.ok) expect(repeated.error).toContain('is named by 2 findings')
  })

  it('ignores previous and previousId without prior ids', () => {
    const parsed = parseReviewVerdict(
      fenced({
        digest: DIGEST,
        verdict: 'PASS',
        previous: [{ id: 'f9', status: 'open' }],
        findings: [],
      }),
      DIGEST,
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.previous).toBeUndefined()
    const finding = parseReviewVerdict(
      fenced({
        digest: DIGEST,
        verdict: 'FINDINGS',
        findings: [{ severity: 'P1', title: 't', evidence: 'e', fix: 'f', previousId: 'f1' }],
      }),
      DIGEST,
    )
    expect(finding.ok).toBe(true)
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

  it('writes the reviewed tree and confirmations to the local record only', async () => {
    const root = await workspace()
    roots.push(root)
    const focused: ReviewRecord = {
      ...record,
      reviewedTree: TREE_AFTER,
      previous: [{ id: 'f1', status: 'closed' }],
    }
    expect((await writePortableApproval(root, focused)).ok).toBe(true)
    // The committed approval keeps the pre-focus field set, order, and bytes.
    const expected = `${JSON.stringify(
      {
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        taskId: TASK_ID,
        digest: DIGEST,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-14T00:00:00.000Z',
      },
      null,
      2,
    )}\n`
    expect(await readFile(join(root, portableApprovalPath('auth', TASK_ID)), 'utf8')).toBe(expected)
    expect((await writeLocalReviewRecord(root, focused)).ok).toBe(true)
    const local = JSON.parse(
      await readFile(join(root, localReviewRecordPath(focused)), 'utf8'),
    ) as ReviewRecord
    expect(local.reviewedTree).toBe(TREE_AFTER)
    expect(local.previous).toEqual([{ id: 'f1', status: 'closed' }])
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
    const windowsModel = ['C', ':', '\\models\\x'].join('')
    expect(() =>
      resolveReviewers({ codex: { provider: 'p', agentOptions: { model: windowsModel } } }),
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
  it('shares the canonical whole-spec identity only from a whole-spec step', () => {
    const def = taskDefinition()
    const step = def.steps[0] as Definition['steps'][number]
    const ev = step.evidence as unknown as Record<string, unknown>
    const wholeStep = {
      ...step,
      review: {
        target: 'codex',
        instruction: 'review-spec',
        scope: 'whole' as const,
        phase: 'spec',
      },
      evidence: {
        ...ev,
        rule: 'spec-review',
        phase: 'spec',
        scope: 'whole',
        digest: 'current',
        path: '.dsh/workflows/records/spec-review/{name}/spec.json',
      },
    }
    // A whole-spec step reuses the built-in definition's canonical record.
    const whole = validateDefinition({ ...def, steps: [wholeStep] })
    const shared = whole.steps[0] as Definition['steps'][number]
    expect(reviewIdentityOf(whole, shared)).toBe('spec-review')
    expect(reviewStoreOf(whole, shared)).toBe('spec-review')
    // A task-scoped step cannot claim the shared identity.
    expect(() =>
      validateDefinition({
        ...def,
        steps: [{ ...step, evidence: { ...ev, rule: 'spec-review' } }],
      }),
    ).toThrow(/whole-spec review step/u)
    // The identity reads only its canonical record.
    expect(() =>
      validateDefinition({
        ...def,
        steps: [
          {
            ...wholeStep,
            evidence: {
              ...wholeStep.evidence,
              path: '.dsh/workflows/records/spec-review/{name}/x.json',
            },
          },
        ],
      }),
    ).toThrow(/canonical whole-spec record/u)
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

describe('integration review worktree binding', () => {
  function integrationDefinition(): Definition {
    return validateDefinition({
      v: 1,
      id: 'integration-review',
      name: 'Integration review',
      version: 1,
      trigger: { kind: 'turn.stopping', match: {}, mode: 'active', dedupe: 'turn' },
      settings: {
        allowModelStart: true,
        risk: 'low',
        gateOwnership: 'own',
        maxBlocks: 1,
        allowIntent: false,
        gate: 'review',
        gateIdentity: 'integration-review',
        legacy: { plugin: 'delegation-rules', signal: 'integration-review' },
      },
      steps: [
        {
          id: 'review',
          title: 'Review the worktree',
          executor: 'review',
          review: {
            target: 'codex',
            instruction: 'review-integration',
            scope: 'whole',
            phase: 'integration',
          },
          evidence: {
            kind: 'record',
            rule: 'integration-review',
            change: '{name}',
            scope: 'whole',
            phase: 'integration',
            verdicts: ['PASS', 'ERROR'],
            digest: 'current-worktree',
            path: '.dsh/workflows/records/integration-review/{name}/integration.json',
          },
          next: 'end',
          blockTurnClose: true,
          nonCritical: true,
        },
      ],
    })
  }

  function integrationRun(root: string) {
    const definition = integrationDefinition()
    return createRun({
      definition: definition.id,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace: root,
      context: { name: 'auth' },
      steps: ['review'],
      now: 1_000,
    })
  }

  /** Run the integration review step as if the host prepared it at one tree. */
  async function invokeIntegration(root: string, specDigest: string, tree: string) {
    const definition = integrationDefinition()
    const step = definition.steps[0]
    if (step === undefined || step.review === undefined) throw new Error('test step missing')
    const digest = reviewDigest({ scope: 'whole', specDigest, tree })
    return await runReviewStep({
      run: integrationRun(root),
      definition,
      step,
      reviewer: reviewer(),
      runner: runnerFor(fenced({ digest, verdict: 'PASS', findings: [] })),
      context: { workspace: root, values: { name: 'auth' }, runGit: defaultGit },
      change: 'auth',
      prepared: { specDigest, tree },
      timeoutMs: 5_000,
      session: 'session-1',
      now: 2_000,
      renderPrompt: () => 'test prompt',
    })
  }

  async function gitWorkspace(): Promise<string> {
    const root = await workspace()
    roots.push(root)
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'engine.ts'), 'export const engine = 1\n', 'utf8')
    await writeFile(join(root, '.gitignore'), '.dsh/\n', 'utf8')
    const changeDir = join(root, 'openspec', 'changes', 'auth')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: root, stdio: 'ignore' })
    }
    git('init')
    git('config', 'user.name', 'review-test')
    git('config', 'user.email', 'review-test@example.test')
    git('add', '-A')
    git('commit', '-m', 'init')
    return root
  }

  it('invalidates a previous integration PASS after a code-only change', async () => {
    const root = await gitWorkspace()
    const specDigest = await currentSpecDigest(root, 'auth')
    if (specDigest === undefined) throw new Error('test change digest missing')
    const treeBefore = await worktreeDigest(root, defaultGit)
    if (treeBefore === undefined) throw new Error('test worktree digest missing')
    const first = await invokeIntegration(root, specDigest, treeBefore)
    expect(first.run.steps[0]?.state).toBe('done')
    const firstDigest = first.record?.digest
    expect(firstDigest).toBe(reviewDigest({ scope: 'whole', specDigest, tree: treeBefore }))
    expect(first.record?.worktreeDigest).toBeDefined()

    // A code-only edit leaves the change artifacts untouched and moves the tree.
    await writeFile(join(root, 'src', 'engine.ts'), 'export const engine = 2\n', 'utf8')
    expect(await currentSpecDigest(root, 'auth')).toBe(specDigest)
    const treeAfter = await worktreeDigest(root, defaultGit)
    if (treeAfter === undefined) throw new Error('test worktree digest missing')
    expect(treeAfter).not.toBe(treeBefore)
    const freshDigest = reviewDigest({ scope: 'whole', specDigest, tree: treeAfter })
    expect(freshDigest).not.toBe(firstDigest)

    // The old PASS is stale for the moved worktree and never completes the run.
    const stale = await invokeIntegration(root, specDigest, treeBefore)
    expect(stale.run.steps[0]?.state).toBe('blocked')
    expect(stale.run.steps[0]?.reason).toContain('stale')
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

  it('refuses a deferred shipped copy beside a disabled switch', () => {
    for (const [signal, switchName] of SWITCHES) {
      const base = withSource(localDefinition(signal), 'shipped')
      const deferred = {
        ...base,
        settings: { ...base.settings, gateOwnership: 'defer' as const },
      }
      const issues = resolveOwnership(deferred, new Set(['delegation-rules']), new Set()).issues
      expect(issues.join('\n')).toContain(switchName)
      expect(issues.join('\n')).toContain('off')
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
