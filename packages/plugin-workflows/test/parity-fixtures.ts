import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArchiveCommand } from '../lib/command-parse.js'
import type { Evidence } from '../lib/definitions.js'
import { verifyEvidence } from '../lib/evidence.js'
import {
  type CheckpointCloseRecord,
  type CheckpointObservation,
  checkpointCloseIssue,
  taskReviewCompletion,
  taskReviewCoverage,
} from '../lib/parity.js'

/**
 * The shared retirement-parity fixture table. Each case carries the legacy
 * allow/refuse decision (transcribed from the legacy tests and the delta spec)
 * and a workflow-side evaluation that calls the same function the owned gate
 * calls. The retired gates are compared; the retained spec-review, progress,
 * and lane cases record the legacy decision and are never flipped here.
 */

export type ParityGate = 'checkpoint' | 'task-review' | 'verification'

export interface ParityDecision {
  readonly decision: 'allow' | 'refuse'
  readonly reason: string
}

export interface ParityCase {
  readonly id: string
  readonly gate: ParityGate | 'retained'
  /** The legacy gate's decision for the same state. */
  readonly legacy: ParityDecision
  /** Retained behavior: recorded, never flipped by this change. */
  readonly retained?: { readonly group: 'spec-review' | 'task-progress' | 'lane' }
  /** Evaluate the owned workflow path; absent for a retained case. */
  readonly workflow?: () => Promise<ParityDecision>
}

const ALLOW: ParityDecision = { decision: 'allow', reason: 'legacy allows' }
const REFUSE: ParityDecision = { decision: 'refuse', reason: 'legacy refuses' }

function checkpointWorkflow(input: {
  readonly record?: CheckpointCloseRecord
  readonly observations?: readonly CheckpointObservation[]
  readonly bottleneckAge?: number
}): Promise<ParityDecision> {
  if (input.record === undefined) {
    return Promise.resolve({
      decision: 'refuse',
      reason: 'the checkpoint step is open: no fresh work_checkpoint record',
    })
  }
  const issue = checkpointCloseIssue({
    record: input.record,
    checkpointId:
      typeof (input.record as { checkpoint?: unknown }).checkpoint === 'string'
        ? (input.record as { checkpoint: string }).checkpoint
        : 'checkpoint-1-aaaaaaaa',
    observations: input.observations ?? [],
    bottleneckAge: input.bottleneckAge ?? 2,
  })
  return Promise.resolve(
    issue === undefined
      ? { decision: 'allow', reason: 'the checkpoint evidence and remedy are present' }
      : { decision: 'refuse', reason: issue },
  )
}

function reviewWorkflow(verdict: string | undefined): Promise<ParityDecision> {
  if (verdict === undefined) {
    return Promise.resolve({ decision: 'refuse', reason: 'no task-review record' })
  }
  if (verdict === 'PASS' || verdict === 'ERROR') {
    return Promise.resolve({
      decision: 'allow',
      reason: `${verdict} is matching intermediate turn-close evidence`,
    })
  }
  return Promise.resolve({
    decision: 'refuse',
    reason:
      verdict === 'FINDINGS'
        ? 'the record is FINDINGS; fix the findings and re-run'
        : `verdict ${verdict} does not satisfy the review step`,
  })
}

function verifyWorkflow(input: {
  readonly commands: readonly string[]
  readonly lastWriteAt?: number
  readonly results?: ReadonlyArray<{
    readonly callId: string
    readonly command: string
    readonly at: number
    readonly exitCode: number
    readonly foreground: boolean
    readonly signal?: string
    readonly timedOut?: boolean
    readonly sandboxDenied?: boolean
  }>
}): Promise<ParityDecision> {
  const evidence: Evidence = { kind: 'check', source: 'verify-settings' }
  return verifyEvidence(evidence, {
    workspace: '/workspace',
    values: {},
    checkCommands: input.commands,
    ...(input.lastWriteAt === undefined ? {} : { lastWriteAt: input.lastWriteAt }),
    shellResults: input.results ?? [],
  }).then((check) =>
    check.ok
      ? { decision: 'allow', reason: 'a configured check passed after the last code write' }
      : { decision: 'refuse', reason: check.failure.detail },
  )
}

/** Build a throwaway workspace with a change and its approvals, then judge it. */
async function coverageWorkflow(input: {
  readonly tasks: readonly { number: string; text: string; checked: boolean }[]
  readonly approved: readonly string[]
  readonly completed: boolean
}): Promise<ParityDecision> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-parity-'))
  try {
    const changeDir = join(root, 'openspec', 'changes', 'change-a')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(
      join(changeDir, 'tasks.md'),
      `# Tasks\n\n${input.tasks
        .map((task) => `- [${task.checked ? 'x' : ' '}] ${task.number} ${task.text}`)
        .join('\n')}\n`,
      'utf8',
    )
    for (const approved of input.approved) {
      const task = input.tasks.find((entry) => entry.text === approved)
      if (task === undefined) continue
      const id = taskIdOf(task.text)
      await writeFile(
        join(changeDir, 'reviews', `${id}.json`),
        JSON.stringify({
          rule: 'task-review',
          change: 'change-a',
          scope: 'task',
          taskId: id,
          digest: 'a'.repeat(64),
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-10-29T08:55:43.317Z',
        }),
        'utf8',
      )
    }
    const completion = input.completed ? taskReviewCompletion(root, 'change-a') : undefined
    if (completion !== undefined) {
      return completion.ok
        ? { decision: 'allow', reason: 'every checked task has a portable PASS' }
        : { decision: 'refuse', reason: completion.text ?? 'a checked task has no portable PASS' }
    }
    return archiveWorkflow(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function taskIdOf(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16)
}

async function archiveWorkflow(root: string): Promise<ParityDecision> {
  const coverage = taskReviewCoverage(root, 'change-a')
  return coverage.ok
    ? { decision: 'allow', reason: 'every checked task has a portable PASS' }
    : { decision: 'refuse', reason: coverage.gaps.join('; ') }
}

/** One archive move form: parsed as an archive and judged by the owned coverage. */
async function moveFormWorkflow(command: string): Promise<ParityDecision> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-parity-'))
  try {
    const changeDir = join(root, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Final task\n', 'utf8')
    const intent = parseArchiveCommand(command, root)
    if (intent === undefined || intent.kind !== 'archive') {
      return { decision: 'refuse', reason: `the ${command} form was not recognized as an archive` }
    }
    const coverage = taskReviewCoverage(root, 'change-a')
    return coverage.ok
      ? { decision: 'allow', reason: `the ${intent.form} archive has portable coverage` }
      : {
          decision: 'refuse',
          reason: `the ${intent.form} archive of "${intent.change}" has no portable task-review PASS`,
        }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const LEAD_REMEDY = {
  id: 'guard-missing',
  owner: 'lead',
  action: 'lead_action' as const,
  blockingLanes: ['edit'],
  targets: ['src/a.ts'],
}

const LEAD_EXECUTED: ParityDecision = { decision: 'allow', reason: 'the declared edit ran' }

export const PARITY_CASES: readonly ParityCase[] = [
  {
    id: 'checkpoint-missing',
    gate: 'checkpoint',
    legacy: REFUSE,
    workflow: () => checkpointWorkflow({}),
  },
  {
    id: 'checkpoint-lead-bottleneck-unexecuted',
    gate: 'checkpoint',
    legacy: REFUSE,
    workflow: () =>
      checkpointWorkflow({
        record: { outcome: 'continue', lanes: [{}], bottleneck: LEAD_REMEDY },
        observations: [],
      }),
  },
  {
    id: 'checkpoint-lead-bottleneck-executed',
    gate: 'checkpoint',
    legacy: LEAD_EXECUTED,
    workflow: () =>
      checkpointWorkflow({
        record: { outcome: 'continue', lanes: [{}], bottleneck: LEAD_REMEDY },
        observations: [{ toolName: 'edit', arguments: { file_path: 'src/a.ts' }, ok: true }],
      }),
  },
  {
    id: 'checkpoint-worker-bottleneck-unexecuted',
    gate: 'checkpoint',
    legacy: REFUSE,
    workflow: () =>
      checkpointWorkflow({
        record: {
          outcome: 'continue',
          lanes: [{}],
          bottleneck: {
            id: 'split',
            owner: 'lead',
            action: 'worker_start',
            blockingLanes: ['host'],
          },
        },
        observations: [],
      }),
  },
  {
    id: 'checkpoint-worker-bottleneck-executed',
    gate: 'checkpoint',
    legacy: ALLOW,
    workflow: () =>
      checkpointWorkflow({
        record: {
          outcome: 'continue',
          lanes: [{}],
          bottleneck: {
            id: 'split',
            owner: 'lead',
            action: 'worker_start',
            blockingLanes: ['host'],
          },
        },
        observations: [
          {
            toolName: 'subagent',
            arguments: {
              checkpoint: 'checkpoint-1-aaaaaaaa',
              bottleneck: 'split',
            },
            ok: true,
          },
        ],
      }),
  },
  {
    id: 'checkpoint-aged-bottleneck',
    gate: 'checkpoint',
    legacy: REFUSE,
    workflow: () =>
      checkpointWorkflow({
        record: {
          outcome: 'continue',
          lanes: [{}],
          bottleneck: LEAD_REMEDY,
          bottleneckAge: 2,
        },
        observations: [{ toolName: 'edit', arguments: { file_path: 'src/a.ts' }, ok: true }],
      }),
  },
  {
    id: 'checkpoint-route-change',
    gate: 'checkpoint',
    legacy: ALLOW,
    workflow: () =>
      checkpointWorkflow({
        record: {
          outcome: 'continue',
          lanes: [{}],
          bottleneck: LEAD_REMEDY,
          bottleneckAge: 3,
          bottleneckChanged: true,
        },
        observations: [{ toolName: 'edit', arguments: { file_path: 'src/a.ts' }, ok: true }],
      }),
  },
  {
    id: 'checkpoint-done',
    gate: 'checkpoint',
    legacy: ALLOW,
    workflow: () => checkpointWorkflow({ record: { outcome: 'done', lanes: [] } }),
  },
  {
    id: 'task-review-missing',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () => reviewWorkflow(undefined),
  },
  {
    id: 'task-review-pass',
    gate: 'task-review',
    legacy: ALLOW,
    workflow: () => reviewWorkflow('PASS'),
  },
  {
    id: 'task-review-error-intermediate',
    gate: 'task-review',
    legacy: ALLOW,
    workflow: () => reviewWorkflow('ERROR'),
  },
  {
    id: 'task-review-findings',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () => reviewWorkflow('FINDINGS'),
  },
  {
    id: 'completion-unapproved-foreign',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () =>
      coverageWorkflow({
        tasks: [
          { number: '1.1', text: 'Foreign task', checked: true },
          { number: '1.2', text: 'Final task', checked: true },
        ],
        approved: ['Final task'],
        completed: true,
      }),
  },
  {
    id: 'completion-error-foreign',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () =>
      coverageWorkflow({
        tasks: [
          { number: '1.1', text: 'Foreign task', checked: true },
          { number: '1.2', text: 'Final task', checked: true },
        ],
        approved: [],
        completed: true,
      }),
  },
  {
    id: 'completion-pass-coverage',
    gate: 'task-review',
    legacy: ALLOW,
    workflow: () =>
      coverageWorkflow({
        tasks: [
          { number: '1.1', text: 'Foreign task', checked: true },
          { number: '1.2', text: 'Final task', checked: true },
        ],
        approved: ['Foreign task', 'Final task'],
        completed: true,
      }),
  },
  {
    id: 'archive-missing-approval',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () =>
      coverageWorkflow({
        tasks: [{ number: '1.1', text: 'Final task', checked: true }],
        approved: [],
        completed: false,
      }),
  },
  {
    id: 'archive-pass-approval',
    gate: 'task-review',
    legacy: ALLOW,
    workflow: () =>
      coverageWorkflow({
        tasks: [{ number: '1.1', text: 'Final task', checked: true }],
        approved: ['Final task'],
        completed: false,
      }),
  },
  {
    id: 'archive-form-openspec',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () => moveFormWorkflow('openspec archive change-a'),
  },
  {
    id: 'archive-form-mv',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () => moveFormWorkflow('mv openspec/changes/change-a openspec/changes/archive/'),
  },
  {
    id: 'archive-form-move-item',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () =>
      moveFormWorkflow('Move-Item openspec/changes/change-a openspec/changes/archive/change-a'),
  },
  {
    id: 'archive-form-git-mv',
    gate: 'task-review',
    legacy: REFUSE,
    workflow: () =>
      moveFormWorkflow('git mv openspec/changes/change-a openspec/changes/archive/change-a'),
  },
  {
    id: 'verify-code-write-missing-check',
    gate: 'verification',
    legacy: REFUSE,
    workflow: () =>
      verifyWorkflow({
        commands: ['pnpm check'],
        lastWriteAt: 100,
        results: [],
      }),
  },
  {
    id: 'verify-code-write-success',
    gate: 'verification',
    legacy: ALLOW,
    workflow: () =>
      verifyWorkflow({
        commands: ['pnpm check'],
        lastWriteAt: 100,
        results: [{ callId: 'c1', command: 'pnpm check', at: 120, exitCode: 0, foreground: true }],
      }),
  },
  {
    id: 'verify-code-write-failed-check',
    gate: 'verification',
    legacy: REFUSE,
    workflow: () =>
      verifyWorkflow({
        commands: ['pnpm check'],
        lastWriteAt: 100,
        results: [{ callId: 'c1', command: 'pnpm check', at: 120, exitCode: 1, foreground: true }],
      }),
  },
  {
    id: 'verify-non-code-turn',
    gate: 'verification',
    legacy: ALLOW,
    workflow: () => verifyWorkflow({ commands: ['pnpm check'], results: [] }),
  },
  {
    id: 'verify-inert-no-commands',
    gate: 'verification',
    legacy: ALLOW,
    workflow: () => verifyWorkflow({ commands: [], lastWriteAt: 100, results: [] }),
  },
  {
    id: 'verify-background-check',
    gate: 'verification',
    legacy: REFUSE,
    workflow: () =>
      verifyWorkflow({
        commands: ['pnpm check'],
        lastWriteAt: 100,
        results: [{ callId: 'c1', command: 'pnpm check', at: 120, exitCode: 0, foreground: false }],
      }),
  },
  {
    id: 'retained-spec-review-missing',
    gate: 'retained',
    retained: { group: 'spec-review' },
    legacy: REFUSE,
  },
  {
    id: 'retained-spec-review-stale',
    gate: 'retained',
    retained: { group: 'spec-review' },
    legacy: REFUSE,
  },
  {
    id: 'retained-progress-current-note',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: ALLOW,
  },
  {
    id: 'retained-progress-stale-note',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: REFUSE,
  },
  {
    id: 'retained-progress-unchecked-missing-note',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: REFUSE,
  },
  {
    id: 'retained-lane-single-remaining',
    gate: 'retained',
    retained: { group: 'lane' },
    legacy: REFUSE,
  },
  {
    id: 'retained-lane-below-threshold',
    gate: 'retained',
    retained: { group: 'lane' },
    legacy: REFUSE,
  },
  {
    id: 'retained-lane-assigned-worker',
    gate: 'retained',
    retained: { group: 'lane' },
    legacy: ALLOW,
  },
]

/** Every non-retained case's workflow decision, or the mismatch text. */
export async function runParityCase(
  parityCase: ParityCase,
): Promise<{ readonly ok: boolean; readonly workflow?: ParityDecision }> {
  if (parityCase.workflow === undefined) return { ok: true }
  const workflow = await parityCase.workflow()
  return { ok: workflow.decision === parityCase.legacy.decision, workflow }
}
