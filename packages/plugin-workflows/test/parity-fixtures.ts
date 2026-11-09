import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  computeApprovalCoverage,
  parsePortableTaskReviewRecord,
  parseReviewApprovalMarker,
  parseTasksText,
  portableTaskRecordPath,
  type ReviewApprovalMarker,
  reviewerBindingOf,
} from '../../plugin-delegation-rules/src/shared/approval.ts'
import { parseArchiveCommand } from '../lib/command-parse.js'
import type { Evidence } from '../lib/definitions.js'
import { verifyEvidence } from '../lib/evidence.js'
import { evaluateTurnClose } from '../lib/gates.js'
import {
  type CheckpointCloseRecord,
  type CheckpointObservation,
  checkpointCloseIssue,
  taskReviewCompletion,
  taskReviewCoverage,
} from '../lib/parity.js'
import { createRun, incrementTurnBlocks, settleStep } from '../lib/runs.js'

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
  /** Replay the real legacy decision where a pure legacy reader exists. */
  readonly legacyCheck?: () => Promise<ParityDecision>
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
interface CoverageInput {
  readonly tasks: readonly { number: string; text: string; checked: boolean }[]
  /** PASS records to write (the legacy coverage must accept them). */
  readonly approved: readonly string[]
  /** Explicit non-PASS verdicts to write for named tasks. */
  readonly verdicts?: Readonly<Record<string, 'ERROR' | 'FINDINGS'>>
  readonly completed: boolean
}

function taskIdOf(text: string): string {
  return createHash('sha256').update(text.replace(/\s+/gu, ' ').trim()).digest('hex').slice(0, 16)
}

/** A throwaway workspace with the change, its marker, and portable records. */
async function coverageWorkspace(input: CoverageInput): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-parity-'))
  const changeDir = join(root, 'openspec', 'changes', 'change-a')
  await mkdir(join(changeDir, 'reviews'), { recursive: true })
  await writeFile(
    join(root, 'openspec', 'review-approval.json'),
    JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
    'utf8',
  )
  await writeFile(
    join(changeDir, 'tasks.md'),
    `# Tasks\n\n${input.tasks
      .map((task) => `- [${task.checked ? 'x' : ' '}] ${task.number} ${task.text}`)
      .join('\n')}\n`,
    'utf8',
  )
  for (const text of input.approved) {
    if (input.tasks.some((task) => task.text === text)) {
      await writeRecord(changeDir, text, 'PASS')
    }
  }
  for (const [text, verdict] of Object.entries(input.verdicts ?? {})) {
    await writeRecord(changeDir, text, verdict)
  }
  return root
}

async function writeRecord(changeDir: string, text: string, verdict: string): Promise<void> {
  const id = taskIdOf(text)
  await writeFile(
    join(changeDir, 'reviews', `${id}.json`),
    JSON.stringify({
      rule: 'task-review',
      change: 'change-a',
      scope: 'task',
      taskId: id,
      digest: 'a'.repeat(64),
      verdict,
      findings: [],
      target: { provider: 'codex-subagent' },
      time: '2026-10-29T08:55:43.317Z',
    }),
    'utf8',
  )
}

/** The workflow decision for one coverage state. */
async function workflowCoverageDecision(root: string, completed: boolean): Promise<ParityDecision> {
  const completion = completed ? taskReviewCompletion(root, 'change-a') : undefined
  if (completion !== undefined) {
    return completion.ok
      ? { decision: 'allow', reason: 'every checked task has a portable PASS' }
      : { decision: 'refuse', reason: completion.text ?? 'a checked task has no portable PASS' }
  }
  const coverage = taskReviewCoverage(root, 'change-a')
  return coverage.ok
    ? { decision: 'allow', reason: 'every checked task has a portable PASS' }
    : { decision: 'refuse', reason: coverage.gaps.join('; ') }
}

/** Replay the legacy archive guard's decision over the same workspace. */
async function legacyCoverageDecision(root: string): Promise<ParityDecision> {
  let marker: ReviewApprovalMarker
  try {
    const parsed = parseReviewApprovalMarker(
      JSON.parse(readFileSync(join(root, 'openspec', 'review-approval.json'), 'utf8')),
    )
    if (parsed.marker === undefined) {
      return { decision: 'refuse', reason: `marker invalid: ${parsed.error ?? 'unknown'}` }
    }
    marker = parsed.marker
  } catch {
    return { decision: 'allow', reason: 'no approval marker; the legacy archive guard allows' }
  }
  if (!marker.archiveGate) return { decision: 'allow', reason: 'archiveGate is false' }
  const changeDir = join(root, 'openspec', 'changes', 'change-a')
  const coverage = await computeApprovalCoverage({
    change: 'change-a',
    rule: marker.taskRule,
    tasks: parseTasksText(readFileSync(join(changeDir, 'tasks.md'), 'utf8')),
    recordPath: (id) => portableTaskRecordPath(changeDir, id),
    inspect: (id) => {
      try {
        const parsed = parsePortableTaskReviewRecord(
          JSON.parse(readFileSync(portableTaskRecordPath(changeDir, id), 'utf8')),
        )
        return parsed.record === undefined
          ? { kind: 'malformed', error: parsed.error ?? 'invalid record' }
          : { kind: 'record', record: parsed.record }
      } catch {
        return { kind: 'missing' }
      }
    },
    reviewer: reviewerBindingOf(marker),
  })
  return coverage.archiveReady
    ? { decision: 'allow', reason: 'the legacy archive coverage is complete' }
    : {
        decision: 'refuse',
        reason: coverage.tasks
          .filter((task) => task.state !== 'pass')
          .map((task) => `${task.number} "${task.text}": ${task.detail ?? 'not approved'}`)
          .join('; '),
      }
}

async function coverageCase(input: CoverageInput): Promise<ParityDecision> {
  const root = await coverageWorkspace(input)
  try {
    return await workflowCoverageDecision(root, input.completed)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function legacyCoverageCase(input: CoverageInput): Promise<ParityDecision> {
  const root = await coverageWorkspace(input)
  try {
    return await legacyCoverageDecision(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** One coverage case that replays both the legacy and the workflow decision. */
function coverageParityCase(id: string, legacy: ParityDecision, input: CoverageInput): ParityCase {
  return {
    id,
    gate: 'task-review',
    legacy,
    legacyCheck: () => legacyCoverageCase(input),
    workflow: () => coverageCase(input),
  }
}

/** One archive move-form case that replays both guards over the same state. */
function moveParityCase(id: string, command: string): ParityCase {
  return {
    id,
    gate: 'task-review',
    legacy: REFUSE,
    legacyCheck: () => legacyMoveFormDecision(command),
    workflow: () => moveFormWorkflow(command),
  }
}

/** One archive move form: parse the real form, then judge the owned coverage. */
async function moveFormWorkflow(command: string): Promise<ParityDecision> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-parity-'))
  try {
    const changeDir = join(root, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Final task\n', 'utf8')
    await writeFile(
      join(root, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    const intent = parseArchiveCommand(command, root)
    if (intent === undefined || intent.kind !== 'archive') {
      // A form the workflow cannot parse fails the case instead of passing.
      return { decision: 'refuse', reason: `UNPARSED archive form: ${command}` }
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

/** The legacy decision for one move form on the same missing-approval state. */
async function legacyMoveFormDecision(command: string): Promise<ParityDecision> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-parity-'))
  try {
    const changeDir = join(root, 'openspec', 'changes', 'change-a')
    await mkdir(changeDir, { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '# Tasks\n\n- [x] 1.1 Final task\n', 'utf8')
    await writeFile(
      join(root, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    const intent = parseArchiveCommand(command, root)
    if (intent === undefined || intent.kind !== 'archive') {
      return { decision: 'refuse', reason: `UNPARSED archive form: ${command}` }
    }
    const coverage = await legacyCoverageDecision(root)
    return coverage.decision === 'allow'
      ? { decision: 'allow', reason: `the legacy ${intent.form} guard allows` }
      : { decision: 'refuse', reason: `the legacy ${intent.form} guard refuses` }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** The verify refusal cap: allow once at the cap, refuse below it. */
function verifyCapDecision(maxBlocks: number, blocks: number): ParityDecision {
  const definition = loadVerifyDefinition()
  let run = createRun({
    definition: 'verify',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: {},
    steps: ['check'],
    now: 1_000,
  })
  run = settleStep(run, 'check', 'open', { at: 1_001 })
  for (let index = 0; index < blocks; index += 1) run = incrementTurnBlocks(run, 1_001)
  const outcome = evaluateTurnClose({
    run,
    definition,
    agent: { steer: () => undefined },
    evidenceContext: { workspace: '/workspace', values: {}, checkCommands: ['pnpm check'] },
    turn: 1,
    maxBlocks,
    installedLegacy: new Set(),
    enabledLegacy: new Set(),
    checkpointIssue: { text: 'run the configured check' },
  })
  return outcome.kind === 'violation'
    ? { decision: 'allow', reason: 'the refusal cap allows the close once as a VIOLATION' }
    : { decision: 'refuse', reason: 'below the cap the close is refused' }
}

let verifyDefinition: import('../lib/definitions.js').Definition | undefined
function loadVerifyDefinition() {
  if (verifyDefinition === undefined) {
    const found = loadShippedDefinitionsForFixtures().find((entry) => entry.id === 'verify')
    if (found === undefined) throw new Error('the verify definition is missing')
    verifyDefinition = found
  }
  return verifyDefinition
}

import { loadShippedDefinitions as loadShippedDefinitionsForFixtures } from '../lib/definitions.js'

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
  coverageParityCase('completion-unapproved-foreign', REFUSE, {
    tasks: [
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Final task', checked: true },
    ],
    approved: ['Final task'],
    completed: true,
  }),
  coverageParityCase('completion-error-foreign', REFUSE, {
    tasks: [
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Final task', checked: true },
    ],
    approved: ['Final task'],
    verdicts: { 'Foreign task': 'ERROR' },
    completed: true,
  }),
  coverageParityCase('completion-pass-coverage', ALLOW, {
    tasks: [
      { number: '1.1', text: 'Foreign task', checked: true },
      { number: '1.2', text: 'Final task', checked: true },
    ],
    approved: ['Foreign task', 'Final task'],
    completed: true,
  }),
  coverageParityCase('archive-missing-approval', REFUSE, {
    tasks: [{ number: '1.1', text: 'Final task', checked: true }],
    approved: [],
    completed: false,
  }),
  coverageParityCase('archive-pass-approval', ALLOW, {
    tasks: [{ number: '1.1', text: 'Final task', checked: true }],
    approved: ['Final task'],
    completed: false,
  }),
  moveParityCase('archive-form-openspec', 'openspec archive change-a'),
  moveParityCase('archive-form-mv', 'mv openspec/changes/change-a openspec/changes/archive/'),
  moveParityCase(
    'archive-form-move-item',
    'Move-Item openspec/changes/change-a openspec/changes/archive/change-a',
  ),
  moveParityCase(
    'archive-form-git-mv',
    'git mv openspec/changes/change-a openspec/changes/archive/change-a',
  ),
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
    id: 'verify-settings-profile-a',
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
    id: 'verify-settings-profile-b',
    gate: 'verification',
    legacy: ALLOW,
    workflow: () =>
      verifyWorkflow({
        commands: ['rtk pnpm check', 'cargo test'],
        lastWriteAt: 100,
        results: [{ callId: 'c1', command: 'cargo test', at: 120, exitCode: 0, foreground: true }],
      }),
  },
  {
    id: 'verify-cap-129-refuses-below',
    gate: 'verification',
    legacy: REFUSE,
    workflow: async () => verifyCapDecision(129, 128),
  },
  {
    id: 'verify-cap-129-allows-at-cap',
    gate: 'verification',
    legacy: ALLOW,
    workflow: async () => verifyCapDecision(129, 129),
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
    id: 'retained-progress-reviewed-tick',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: ALLOW,
  },
  {
    id: 'retained-lane-first-implementation-turn',
    gate: 'retained',
    retained: { group: 'lane' },
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

/** Every non-retained case's decision, with the replayed legacy verdict. */
export async function runParityCase(parityCase: ParityCase): Promise<{
  readonly ok: boolean
  readonly workflow?: ParityDecision
  readonly legacyReplay?: ParityDecision
}> {
  if (parityCase.workflow === undefined) return { ok: true }
  const legacyReplay = await parityCase.legacyCheck?.()
  const workflow = await parityCase.workflow()
  const replayOk =
    legacyReplay === undefined || legacyReplay.decision === parityCase.legacy.decision
  return {
    ok: replayOk && workflow.decision === parityCase.legacy.decision,
    workflow,
    ...(legacyReplay === undefined ? {} : { legacyReplay }),
  }
}
