import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckpointHarness } from '../../plugin-goal-continuity/test/checkpoint-harness.ts'
import { decideVerifyClose } from '../../plugin-verification-gate/src/host/index.ts'
import {
  shellResult,
  Harness as VerifyHarness,
} from '../../plugin-verification-gate/test/harness.ts'
import { parseArchiveCommand } from '../lib/command-parse.js'
import type { Evidence } from '../lib/definitions.js'
import { currentSpecDigest, verifyEvidence } from '../lib/evidence.js'
import {
  evaluateArchiveGate,
  evaluateLaneParity,
  evaluateProgressParity,
  evaluateTurnClose,
  SOFT_SETTLEMENT,
} from '../lib/gates.js'
import {
  type CheckpointCloseRecord,
  type CheckpointObservation,
  checkpointCloseIssue,
  taskReviewCompletion,
  taskReviewCoverage,
} from '../lib/parity.js'
import { createRun, incrementTurnBlocks, setRunStatus, settleStep } from '../lib/runs.js'
import {
  computeApprovalCoverage,
  legacyRecordSatisfies,
  parsePortableTaskReviewRecord,
  parseReviewApprovalMarker,
  parseTasksText,
  portableTaskRecordPath,
  type ReviewApprovalMarker,
  recognizeArchiveCommands,
  reviewerBindingOf,
} from '../src/shared/approval.ts'
import { RETAINED_BASELINE } from './parity-baseline.ts'

/**
 * The shared retirement-parity fixture table. Each case carries the legacy
 * allow/refuse decision (transcribed from the legacy tests and the delta spec)
 * and an executable legacy replay plus a workflow-side evaluation that calls
 * the same function the owned gate calls. The retired gates are compared; the
 * replayed spec-review, integration, progress, and lane cases run both sides so
 * a missing evaluator or a changed decision fails certification.
 */

export type ParityGate = 'checkpoint' | 'task-review' | 'verification'

export interface ParityDecision {
  readonly decision: 'allow' | 'refuse'
  readonly reason: string
}

/** A per-turn decision sequence; replaces the single legacy/workflow comparison. */
export interface ParitySequence {
  readonly legacy?: () => Promise<readonly ParityDecision[]>
  readonly workflow?: () => Promise<readonly ParityDecision[]>
}

export interface ParityCase {
  readonly id: string
  readonly gate: ParityGate | 'retained'
  /** The legacy gate's recorded decision for the same state. */
  readonly legacy: ParityDecision
  /** Replay the real legacy decision where a pure legacy reader exists. */
  readonly legacyCheck?: () => Promise<ParityDecision>
  /** Retained behavior replayed by this change. */
  readonly retained?: {
    readonly group: 'spec-review' | 'integration-review' | 'task-progress' | 'lane'
  }
  /** Evaluate the owned workflow path. */
  readonly workflow?: () => Promise<ParityDecision>
  /** A per-turn sequence; replaces the single legacy/workflow comparison. */
  readonly sequence?: ParitySequence
}

/**
 * A declared, documented difference: the legacy scenario is retired, so its
 * parity entry is absent from the replay and the report names the removal
 * instead of replaying it.
 */
export interface RetiredParityEntry {
  readonly group: 'spec-review' | 'integration-review' | 'task-progress' | 'lane-assignment'
  readonly case: string
  /** Why the scenario is retired instead of replayed. */
  readonly declared: string
}

/**
 * The retired parity entries. `workflows-parity --check` accepts the absence
 * only because the tracked report carries one declaration per entry.
 */
export const RETIRED_PARITY_ENTRIES: readonly RetiredParityEntry[] = [
  {
    group: 'integration-review',
    case: 'retained-integration-soft-sequence',
    declared:
      'integration-review is a required review; the legacy soft settlement scenario is retired and is not replayed',
  },
]

const ALLOW: ParityDecision = { decision: 'allow', reason: 'legacy allows' }
const REFUSE: ParityDecision = { decision: 'refuse', reason: 'legacy refuses' }

async function checkpointWorkflow(input: {
  readonly record?: CheckpointCloseRecord
  readonly observations?: readonly CheckpointObservation[]
  readonly bottleneckAge?: number
}): Promise<ParityDecision> {
  const definition = loadShippedDefinitionsForFixtures().find((entry) => entry.id === 'retro')
  if (definition === undefined) throw new Error('the shipped retro definition is missing')
  const issue =
    input.record === undefined
      ? undefined
      : checkpointCloseIssue({
          record: input.record,
          checkpointId:
            typeof (input.record as { checkpoint?: unknown }).checkpoint === 'string'
              ? (input.record as { checkpoint: string }).checkpoint
              : 'checkpoint-1-aaaaaaaa',
          observations: input.observations ?? [],
          bottleneckAge: input.bottleneckAge ?? 2,
        })
  let run = createRun({
    definition: 'retro',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { checkpoint: 'checkpoint-1-aaaaaaaa' },
    steps: ['checkpoint', 'verify'],
    now: 1_000,
  })
  if (input.record !== undefined && issue === undefined) {
    run = settleStep(run, 'checkpoint', 'done', { at: 1_001 })
    run = settleStep(run, 'verify', 'done', { at: 1_002 })
  }
  const outcome = evaluateTurnClose({
    run,
    definition,
    agent: { steer: () => undefined },
    evidenceContext: { workspace: '/workspace', values: {} },
    turn: 1,
    maxBlocks: 3,
    installedLegacy: new Set(),
    enabledLegacy: new Set(),
  })
  return outcome.kind === 'allow'
    ? { decision: 'allow', reason: 'the shipped retro close gate allows' }
    : {
        decision: 'refuse',
        reason:
          (outcome.kind === 'refuse' ? outcome.text : outcome.detail) ??
          issue ??
          'the retro step is open',
      }
}

/** The shipped review step judged by the production evidence reader. */
async function reviewWorkflow(verdict: string | undefined): Promise<ParityDecision> {
  const definition = loadShippedDefinitionsForFixtures().find((entry) => entry.id === 'task-review')
  if (definition === undefined) throw new Error('the shipped task-review definition is missing')
  const evidence = definition.steps.find((step) => step.id === 'review')?.evidence
  if (evidence === undefined) throw new Error('the shipped review evidence is missing')
  const root = await mkdtemp(join(tmpdir(), 'workflows-parity-'))
  try {
    const taskId = '0123456789abcdef'
    const directory = join(root, '.dsh', 'workflows', 'records', 'task-review', 'change-a', 'tasks')
    await mkdir(directory, { recursive: true })
    if (verdict !== undefined) {
      await writeFile(
        join(directory, `${taskId}.json`),
        JSON.stringify({
          rule: 'task-review',
          change: 'change-a',
          phase: 'task',
          scope: 'task',
          taskId,
          digest: 'a'.repeat(64),
          verdict,
          findings:
            verdict === 'FINDINGS'
              ? [{ severity: 'P1', title: 'finding', evidence: 'e', fix: 'f' }]
              : [],
          target: { provider: 'codex-subagent' },
          time: '2026-10-29T08:55:43.317Z',
        }),
        'utf8',
      )
    }
    const check = await verifyEvidence(evidence, {
      workspace: root,
      values: { name: 'change-a', taskId },
    })
    let run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace: '/workspace',
      context: { name: 'change-a', taskId },
      steps: ['review', 'complete-review'],
      now: 1_000,
    })
    if (check.ok) {
      run = settleStep(run, 'review', 'done', { at: 1_002 })
      run = settleStep(run, 'complete-review', 'done', { at: 1_003 })
    }
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: { steer: () => undefined },
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 1,
      maxBlocks: 3,
      installedLegacy: new Set(),
      enabledLegacy: new Set(),
    })
    return outcome.kind === 'allow'
      ? {
          decision: 'allow',
          reason: `the shipped task-review close gate allows ${verdict ?? 'no record'}`,
        }
      : {
          decision: 'refuse',
          reason: `the shipped task-review close gate rejects ${verdict ?? 'no record'}`,
        }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function verifyWorkflow(input: {
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
  const definition = loadVerifyDefinition()
  const evidence: Evidence = definition.steps.find((step) => step.id === 'check')?.evidence ?? {
    kind: 'check',
    source: 'verify-settings',
  }
  const check = await verifyEvidence(evidence, {
    workspace: '/workspace',
    values: {},
    checkCommands: input.commands,
    ...(input.lastWriteAt === undefined ? {} : { lastWriteAt: input.lastWriteAt }),
    shellResults: input.results ?? [],
  })
  let run = createRun({
    definition: 'verify',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: {},
    steps: ['check'],
    now: 1_000,
  })
  if (check.ok) run = settleStep(run, 'check', 'done', { at: 1_001 })
  const outcome = evaluateTurnClose({
    run,
    definition,
    agent: { steer: () => undefined },
    evidenceContext: {
      workspace: '/workspace',
      values: {},
      checkCommands: input.commands,
      ...(input.lastWriteAt === undefined ? {} : { lastWriteAt: input.lastWriteAt }),
      shellResults: input.results ?? [],
    },
    turn: 1,
    maxBlocks: definition.settings.maxBlocks,
    installedLegacy: new Set(),
    enabledLegacy: new Set(),
  })
  return outcome.kind === 'allow' || outcome.kind === 'violation'
    ? {
        decision: 'allow',
        reason: check.ok ? 'the shipped verify check passed' : 'the override state allowed',
      }
    : { decision: 'refuse', reason: check.ok ? 'the check step is open' : check.failure.detail }
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

/**
 * Both guards must recognize a required archive form; a lost form fails the
 * parity run instead of passing as a vacuous refusal.
 */
export function assertArchiveRecognition(command: string, root: string): { change: string } {
  const legacy = recognizeArchiveCommands(command, root)
  const workflow = parseArchiveCommand(command, root)
  if (
    legacy.length !== 1 ||
    workflow === undefined ||
    workflow.kind !== 'archive' ||
    legacy[0]?.change !== workflow.change
  ) {
    throw new Error(`the archive form is not recognized by both guards: ${command}`)
  }
  return { change: workflow.change }
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
    const { change } = assertArchiveRecognition(command, root)
    const coverage = taskReviewCoverage(root, change)
    return coverage.ok
      ? { decision: 'allow', reason: `the ${change} archive has portable coverage` }
      : {
          decision: 'refuse',
          reason: `the ${change} archive has no portable task-review PASS`,
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
    const { change } = assertArchiveRecognition(command, root)
    const coverage = await legacyCoverageDecision(root)
    return coverage.decision === 'allow'
      ? { decision: 'allow', reason: `the legacy ${change} guard allows` }
      : { decision: 'refuse', reason: `the legacy ${change} guard refuses` }
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
  run = { ...run, turnBlocksTurn: 1 }
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
    legacyCheck: RETAINED_BASELINE['retained-spec-review-missing'],
    workflow: () => specReviewWorkflowCase('missing'),
  },
  {
    id: 'retained-spec-review-stale',
    gate: 'retained',
    retained: { group: 'spec-review' },
    legacy: REFUSE,
    legacyCheck: RETAINED_BASELINE['retained-spec-review-stale'],
    workflow: () => specReviewWorkflowCase('stale'),
  },
  {
    id: 'retained-spec-review-current',
    gate: 'retained',
    retained: { group: 'spec-review' },
    legacy: ALLOW,
    legacyCheck: RETAINED_BASELINE['retained-spec-review-current'],
    workflow: () => specReviewWorkflowCase('current'),
  },
  {
    id: 'retained-integration-archive',
    gate: 'retained',
    retained: { group: 'integration-review' },
    legacy: ALLOW,
    legacyCheck: RETAINED_BASELINE['retained-integration-archive'],
    workflow: integrationArchiveCase,
  },
  {
    id: 'retained-progress-current-note',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: ALLOW,
    legacyCheck: RETAINED_BASELINE['retained-progress-current-note'],
    workflow: async () =>
      progressWorkflowDecision({
        codeChanged: true,
        tickedReviewed: false,
        note: { digest: 'a'.repeat(64), currentDigest: 'a'.repeat(64) },
      }),
  },
  {
    id: 'retained-progress-stale-note',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: REFUSE,
    legacyCheck: RETAINED_BASELINE['retained-progress-stale-note'],
    workflow: async () =>
      progressWorkflowDecision({
        codeChanged: true,
        tickedReviewed: false,
        note: { digest: 'a'.repeat(64), currentDigest: 'b'.repeat(64) },
      }),
  },
  {
    id: 'retained-progress-unchecked-missing-note',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: REFUSE,
    legacyCheck: RETAINED_BASELINE['retained-progress-unchecked-missing-note'],
    workflow: async () => progressWorkflowDecision({ codeChanged: true, tickedReviewed: false }),
  },
  {
    id: 'retained-progress-reviewed-tick',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: ALLOW,
    legacyCheck: RETAINED_BASELINE['retained-progress-reviewed-tick'],
    workflow: async () => progressWorkflowDecision({ codeChanged: true, tickedReviewed: true }),
  },
  {
    id: 'retained-lane-first-implementation-turn',
    gate: 'retained',
    retained: { group: 'lane' },
    legacy: REFUSE,
    legacyCheck: RETAINED_BASELINE['retained-lane-first-implementation-turn'],
    workflow: async () =>
      laneWorkflowDecision({
        plan: LANE_PLAN_TWO,
        ticked: ['1.1'],
        assigned: [],
        implementationChanged: true,
      }),
  },
  {
    id: 'retained-lane-single-remaining',
    gate: 'retained',
    retained: { group: 'lane' },
    legacy: REFUSE,
    legacyCheck: RETAINED_BASELINE['retained-lane-single-remaining'],
    workflow: async () =>
      laneWorkflowDecision({
        plan: LANE_PLAN_SINGLE,
        ticked: ['1.1'],
        assigned: [],
        implementationChanged: true,
      }),
  },
  {
    id: 'retained-lane-below-threshold',
    gate: 'retained',
    retained: { group: 'lane' },
    legacy: REFUSE,
    legacyCheck: RETAINED_BASELINE['retained-lane-below-threshold'],
    workflow: async () =>
      laneWorkflowDecision({
        plan: LANE_PLAN_TWO,
        ticked: [],
        assigned: [],
        implementationChanged: true,
      }),
  },
  {
    id: 'retained-lane-assigned-worker',
    gate: 'retained',
    retained: { group: 'lane' },
    legacy: ALLOW,
    legacyCheck: RETAINED_BASELINE['retained-lane-assigned-worker'],
    workflow: async () =>
      laneWorkflowDecision({
        plan: LANE_PLAN_SINGLE,
        ticked: ['1.1'],
        assigned: [LANE_DOCS_TITLE],
        implementationChanged: true,
      }),
  },
]

/**
 * The retired gates replayed for the parity table: the checkpoint and verify
 * cases run their surviving provider harnesses, and the retained groups use the
 * executable baseline in `parity-baseline.ts`, which imports no deleted plugin
 * code.
 */

const CHECKPOINT_BOTTLENECK = {
  id: 'guard',
  owner: 'lead',
  action: 'lead_action' as const,
  blockingLanes: ['edit'],
  targets: ['src/a.ts'],
}

function checkpointRecord(
  outcome: 'continue' | 'done',
  bottleneck = true,
): Record<string, unknown> {
  return {
    outcome,
    verified: [],
    lanes: [{ id: 'main', owner: 'lead', scope: ['src'], state: 'running' }],
    next: outcome === 'done' ? 'report' : 'continue',
    ...(outcome === 'continue' && bottleneck
      ? {
          bottleneck: CHECKPOINT_BOTTLENECK,
        }
      : {}),
  }
}

function checkpointCalls(harness: CheckpointHarness): void {
  for (const [name, args] of [
    ['read', {}],
    ['read', {}],
    ['read', {}],
    ['edit', { file_path: 'src/a.ts' }],
  ] as const) {
    const callId = harness.toolCall(name, args)
    harness.toolResult(callId)
  }
}

async function legacyCheckpointCase(kind: string): Promise<ParityDecision> {
  const { harness, cleanup } = await CheckpointHarness.create({
    config: { checkpoint: { automation: true, bottleneckAge: 2, stepInterval: 40 } },
  })
  try {
    harness.turnStart(1)
    checkpointCalls(harness)
    if (kind === 'missing') {
      await harness.turnStopping(1)
      return harness.steers.length > 0 ? REFUSE : ALLOW
    }
    if (kind === 'done') {
      await harness.checkpoint(checkpointRecord('done'))
      await harness.turnStopping(1)
      return harness.steers.length > 0 ? REFUSE : ALLOW
    }
    const record =
      kind === 'worker-unexecuted' || kind === 'worker-executed'
        ? {
            ...checkpointRecord('continue'),
            bottleneck: {
              id: 'guard',
              owner: 'lane',
              action: 'worker_start',
              blockingLanes: ['edit'],
            },
          }
        : checkpointRecord('continue')
    await harness.checkpoint(record)
    if (kind === 'lead-executed') {
      const callId = harness.toolCall('edit', { file_path: 'src/a.ts' })
      harness.toolResult(callId)
    }
    if (kind === 'worker-executed') {
      const checkpointId = String((await harness.readRecord(1)).checkpoint ?? '')
      const callId = harness.toolCall('subagent', {
        checkpoint: checkpointId,
        bottleneck: 'guard',
      })
      harness.toolResult(callId, 'worker started')
    }
    await harness.turnStopping(1)
    if (kind !== 'aged' && kind !== 'route-change') {
      return harness.steers.length > 0 ? REFUSE : ALLOW
    }
    // Aged: the second consecutive record names the same owner and lanes; the
    // remedy is executed each turn so only the age rule can refuse.
    harness.turnStart(2)
    checkpointCalls(harness)
    const aged =
      kind === 'route-change'
        ? {
            ...checkpointRecord('continue'),
            bottleneck: { ...CHECKPOINT_BOTTLENECK, owner: 'lane-b' },
          }
        : checkpointRecord('continue')
    await harness.checkpoint(aged)
    const before = harness.steers.length
    const callId = harness.toolCall('edit', { file_path: 'src/a.ts' })
    harness.toolResult(callId)
    await harness.turnStopping(2)
    return harness.steers.length > before ? REFUSE : ALLOW
  } finally {
    await cleanup()
  }
}

async function legacyVerifyCase(
  kind: string,
  commands: readonly string[] = ['pnpm check'],
  maxBlocks = 8,
): Promise<ParityDecision> {
  const short = kind.replace(/^verify-/u, '')
  const configured = short === 'inert-no-commands' ? [] : commands
  const harness = new VerifyHarness({ commands: [...configured], maxBlocks })
  await harness.preStep(1)
  if (short !== 'non-code-turn') await harness.write('src/a.ts')
  const command = configured.at(-1) ?? 'pnpm check'
  if (short === 'code-write-success') {
    await harness.shell(command, shellResult())
  }
  if (short === 'code-write-failed-check') {
    await harness.shell(command, shellResult({ exitCode: 1 }))
  }
  if (short === 'background-check') {
    await harness.shell(command, shellResult({ kind: 'background' }))
  }
  await harness.stop(1)
  return harness.steerTexts().length > 0 ? REFUSE : ALLOW
}

async function legacyReviewCase(verdict?: string): Promise<ParityDecision> {
  const state =
    verdict === undefined
      ? { kind: 'missing' as const }
      : {
          kind: 'record' as const,
          record: {
            rule: 'task-review',
            change: 'change-a',
            phase: 'task',
            scope: 'task',
            taskId: '0123456789abcdef',
            digest: 'a'.repeat(64),
            verdict,
            findings: [],
            target: { provider: 'codex-subagent' },
            time: '2026-10-29T08:55:43.317Z',
          },
        }
  const record = state.kind === 'record' ? state.record : undefined
  const ok =
    record !== undefined &&
    legacyRecordSatisfies(record, 'change-a', 'task', undefined, '0123456789abcdef')
  return ok ? ALLOW : REFUSE
}

/** The real legacy verdict per case id; it overrides the recorded decision. */
const LEGACY_CHECKS: Readonly<Record<string, () => Promise<ParityDecision>>> = {
  'checkpoint-missing': () => legacyCheckpointCase('missing'),
  'checkpoint-lead-bottleneck-unexecuted': () => legacyCheckpointCase('lead-unexecuted'),
  'checkpoint-lead-bottleneck-executed': () => legacyCheckpointCase('lead-executed'),
  'checkpoint-worker-bottleneck-unexecuted': () => legacyCheckpointCase('worker-unexecuted'),
  'checkpoint-worker-bottleneck-executed': () => legacyCheckpointCase('worker-executed'),
  'checkpoint-aged-bottleneck': () => legacyCheckpointCase('aged'),
  'checkpoint-route-change': () => legacyCheckpointCase('route-change'),
  'checkpoint-done': () => legacyCheckpointCase('done'),
  'task-review-missing': () => legacyReviewCase(),
  'task-review-pass': () => legacyReviewCase('PASS'),
  'task-review-error-intermediate': () => legacyReviewCase('ERROR'),
  'task-review-findings': () => legacyReviewCase('FINDINGS'),
  'verify-code-write-missing-check': () => legacyVerifyCase('verify-code-write-missing-check'),
  'verify-code-write-success': () => legacyVerifyCase('verify-code-write-success'),
  'verify-code-write-failed-check': () => legacyVerifyCase('verify-code-write-failed-check'),
  'verify-non-code-turn': () => legacyVerifyCase('non-code-turn'),
  'verify-inert-no-commands': () => legacyVerifyCase('inert-no-commands'),
  'verify-background-check': () => legacyVerifyCase('verify-background-check'),
  'verify-settings-profile-a': () => legacyVerifyCase('code-write-success', ['pnpm check'], 8),
  'verify-settings-profile-b': () =>
    legacyVerifyCase('code-write-success', ['rtk pnpm check', 'cargo test'], 129),
  'verify-cap-129-refuses-below': () =>
    Promise.resolve(decideVerifyClose(true, 128, 129) === 'refuse' ? REFUSE : ALLOW),
  'verify-cap-129-allows-at-cap': () =>
    Promise.resolve(decideVerifyClose(true, 129, 129) === 'unverified' ? ALLOW : REFUSE),
}

/* ------------------------------------------------------------------ */
/* replayed retained gates                                             */
/* ------------------------------------------------------------------ */

/**
 * A programmable git runner for the legacy gate replays. The legacy engine
 * only needs status/diff for the implementation fingerprint and the worktree
 * digest; every other command returns the same empty deterministic answer.
 */
/** A throwaway review-ready change; the legacy and workflow readers share it. */
async function parityWorkspace(plan: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'workflows-parity-'))
  const dir = join(root, 'openspec', 'changes', 'change-a')
  await mkdir(join(dir, 'specs', 'capability'), { recursive: true })
  await writeFile(join(dir, 'proposal.md'), '# Proposal\n\nWhy.\n', 'utf8')
  await writeFile(join(dir, 'design.md'), '# Design\n\nDecisions.\n', 'utf8')
  await writeFile(join(dir, 'specs', 'capability', 'spec.md'), '# Spec\n\nA requirement.\n', 'utf8')
  await writeFile(join(dir, 'tasks.md'), plan, 'utf8')
  return root
}

interface ProgressScenario {
  readonly codeChanged: boolean
  readonly tickedReviewed: boolean
  readonly note?: { readonly digest: string; readonly currentDigest: string }
}

/**
 * shortcut: the engine-owned progress gate lands with tasks 1.6/1.9; this
 * replay certifies the decision table until then.
 */
function progressWorkflowDecision(scenario: ProgressScenario): ParityDecision {
  return evaluateProgressParity(scenario)
}

interface LaneScenario {
  readonly plan: string
  /** Task numbers ticked by the turn. */
  readonly ticked: readonly string[]
  /** Lane titles covered by a tagged worker start or serial note. */
  readonly assigned: readonly string[]
  readonly implementationChanged: boolean
}

/**
 * shortcut: the engine-owned lane gate lands with tasks 1.6/1.9; this replay
 * certifies the decision table over the production plan parser until then.
 */
function laneWorkflowDecision(scenario: LaneScenario): ParityDecision {
  return evaluateLaneParity(scenario)
}

const LANE_PLAN_TWO = `# Tasks

## 1. Engine (owns \`packages/engine/**\`)

- [ ] 1.1 First task
- [ ] 1.2 Second task

## 2. Docs (owns \`docs/**\`)

- [ ] 2.1 Doc task
`

const LANE_PLAN_SINGLE = `# Tasks

## 1. Engine (owns \`packages/engine/**\`)

- [ ] 1.1 First task

## 2. Docs (owns \`docs/**\`)

- [ ] 2.1 Doc task
`

const LANE_DOCS_TITLE = '2. Docs (owns `docs/**`)'

/** The owned spec-review definition judged by the production evidence reader. */
async function specReviewWorkflowCase(
  kind: 'missing' | 'stale' | 'current',
): Promise<ParityDecision> {
  const definition = loadShippedDefinitionsForFixtures().find((entry) => entry.id === 'spec-review')
  if (definition === undefined) throw new Error('the shipped spec-review definition is missing')
  const step = definition.steps.find((entry) => entry.id === 'review')
  if (step?.evidence === undefined) throw new Error('the shipped spec-review evidence is missing')
  const plan = '# Tasks\n\n- [ ] 1.1 First task\n'
  const root = await parityWorkspace(plan)
  try {
    if (kind !== 'missing') {
      const digest =
        kind === 'stale' ? 'b'.repeat(64) : ((await currentSpecDigest(root, 'change-a')) ?? '')
      const recordDir = join(root, '.dsh', 'workflows', 'records', 'spec-review', 'change-a')
      await mkdir(recordDir, { recursive: true })
      await writeFile(
        join(recordDir, 'spec.json'),
        JSON.stringify({
          rule: 'spec-review',
          change: 'change-a',
          phase: 'spec',
          scope: 'whole',
          digest,
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-11-15T00:00:00.000Z',
        }),
        'utf8',
      )
    }
    const check = await verifyEvidence(step.evidence, {
      workspace: root,
      values: { name: 'change-a' },
    })
    let run = createRun({
      definition: 'spec-review',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace: root,
      context: { name: 'change-a' },
      steps: ['review'],
      now: 1_000,
    })
    if (check.ok) run = settleStep(run, 'review', 'done', { at: 1_001 })
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: { steer: () => undefined },
      evidenceContext: { workspace: root, values: { name: 'change-a' } },
      turn: 1,
      maxBlocks: definition.settings.maxBlocks,
      installedLegacy: new Set(),
      enabledLegacy: new Set(),
    })
    return outcome.kind === 'allow'
      ? { decision: 'allow', reason: `the shipped spec-review step allows ${kind}` }
      : { decision: 'refuse', reason: `the shipped spec-review step rejects ${kind}` }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/**
 * An old run settled on the retired soft budget: the review step was released
 * without evidence and the run closed. The definition no longer produces this
 * state, so the fixture builds it directly for the archive scenario.
 */
function softSettledIntegrationRun(): import('../lib/runs.js').WorkflowRun {
  const run = createRun({
    definition: 'integration-review',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'change-a' },
    steps: ['review'],
    now: 1_000,
  })
  const released = settleStep(run, 'review', 'cancelled', {
    at: 1_001,
    reason: `${SOFT_SETTLEMENT}: the retired refusal budget released the run without evidence`,
  })
  return setRunStatus(released, 'completed', 1_001, SOFT_SETTLEMENT)
}

/**
 * An exhausted soft run keeps no open required step, so an otherwise
 * authorized archive is allowed and the run never counts as a pass.
 */
async function integrationArchiveCase(): Promise<ParityDecision> {
  const run = softSettledIntegrationRun()
  const receipt = {
    v: 1 as const,
    kind: 'intake' as const,
    change: 'change-a',
    digest: 'a'.repeat(64),
    issuedAt: 1,
    workspaceKey: '/workspace',
    signature: 'test',
  }
  const decision = evaluateArchiveGate({
    change: 'change-a',
    runs: [run],
    receipts: [receipt],
    specRecord: {
      ok: true,
      evidence: { kind: 'record', path: 'spec.json', digest: 'a'.repeat(64) },
    },
    taskReview: { ok: true },
  })
  return decision.kind === 'allow'
    ? { decision: 'allow', reason: `the ${SOFT_SETTLEMENT} run does not block the archive` }
    : { decision: 'refuse', reason: decision.reason }
}

export interface ParityCaseResult {
  readonly ok: boolean
  readonly workflow?: ParityDecision
  readonly legacyReplay?: ParityDecision
  readonly workflowSequence?: readonly ParityDecision[]
  readonly legacySequence?: readonly ParityDecision[]
  /** The evaluator certification could not run. */
  readonly missing?: 'workflow' | 'legacy' | 'workflow-sequence' | 'legacy-sequence'
}

export function decisionText(decisions: readonly ParityDecision[]): string {
  return `[${decisions.map((entry) => entry.decision).join(', ')}]`
}

export function sequenceReason(decisions: readonly ParityDecision[]): string {
  return decisions.map((entry) => entry.reason).join('; ')
}

export async function runParityCase(parityCase: ParityCase): Promise<ParityCaseResult> {
  if (parityCase.sequence !== undefined) {
    if (parityCase.sequence.legacy === undefined) {
      return { ok: false, missing: 'legacy-sequence' }
    }
    if (parityCase.sequence.workflow === undefined) {
      return { ok: false, missing: 'workflow-sequence' }
    }
    const legacySequence = await parityCase.sequence.legacy()
    const workflowSequence = await parityCase.sequence.workflow()
    const decisionsMatch =
      legacySequence.length === workflowSequence.length &&
      legacySequence.every((entry, index) => entry.decision === workflowSequence[index]?.decision)
    const recordedOk = legacySequence[0]?.decision === parityCase.legacy.decision
    return {
      ok: decisionsMatch && recordedOk,
      legacySequence,
      workflowSequence,
    }
  }
  if (parityCase.workflow === undefined) return { ok: false, missing: 'workflow' }
  if (parityCase.gate === 'retained' && parityCase.legacyCheck === undefined) {
    return { ok: false, missing: 'legacy' }
  }
  const replay = LEGACY_CHECKS[parityCase.id]
  const legacyReplay = replay === undefined ? await parityCase.legacyCheck?.() : await replay()
  const workflow = await parityCase.workflow()
  if (legacyReplay === undefined) {
    return { ok: workflow.decision === parityCase.legacy.decision, workflow }
  }
  // The replay is the authority; a recorded decision that disagrees is a stale
  // table entry and fails the report rather than silently certifying it.
  const recordedOk = legacyReplay.decision === parityCase.legacy.decision
  return {
    ok: recordedOk && workflow.decision === legacyReplay.decision,
    workflow,
    legacyReplay,
  }
}
