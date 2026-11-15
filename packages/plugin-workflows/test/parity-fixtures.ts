import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  apply as applyDelegationRules,
  type BundleConfig as DelegationConfig,
  type GatesConfig,
} from '../../plugin-delegation-rules/lib/index.js'
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
} from '../../plugin-delegation-rules/src/shared/approval.ts'
import { CheckpointHarness } from '../../plugin-goal-continuity/test/checkpoint-harness.ts'
import { decideVerifyClose } from '../../plugin-verification-gate/src/host/index.ts'
import {
  shellResult,
  Harness as VerifyHarness,
} from '../../plugin-verification-gate/test/harness.ts'
import { parseArchiveCommand } from '../lib/command-parse.js'
import type { Evidence } from '../lib/definitions.js'
import { currentSpecDigest, verifyEvidence } from '../lib/evidence.js'
import { evaluateArchiveGate, evaluateTurnClose, SOFT_SETTLEMENT } from '../lib/gates.js'
import {
  type CheckpointCloseRecord,
  type CheckpointObservation,
  checkpointCloseIssue,
  taskReviewCompletion,
  taskReviewCoverage,
} from '../lib/parity.js'
import { createRun, incrementTurnBlocks, settleStep } from '../lib/runs.js'
import { evaluateLaneParity, evaluateProgressParity } from '../src/host/gates.ts'

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
  /** The workflow recorded a visible VIOLATION instead of a plain allow. */
  readonly violation?: boolean
}

/** A per-turn decision sequence for a `soft` signal. */
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
  /** The declared, documented workflow VIOLATION at this 0-based turn. */
  readonly violation?: { readonly turn: number; readonly reason: string }
}

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
    legacyCheck: () => legacySpecReviewCase('missing'),
    workflow: () => specReviewWorkflowCase('missing'),
  },
  {
    id: 'retained-spec-review-stale',
    gate: 'retained',
    retained: { group: 'spec-review' },
    legacy: REFUSE,
    legacyCheck: () => legacySpecReviewCase('stale'),
    workflow: () => specReviewWorkflowCase('stale'),
  },
  {
    id: 'retained-spec-review-current',
    gate: 'retained',
    retained: { group: 'spec-review' },
    legacy: ALLOW,
    legacyCheck: () => legacySpecReviewCase('current'),
    workflow: () => specReviewWorkflowCase('current'),
  },
  {
    id: 'retained-integration-soft-sequence',
    gate: 'retained',
    retained: { group: 'integration-review' },
    legacy: REFUSE,
    sequence: {
      legacy: legacyIntegrationSequence,
      workflow: integrationSoftSequence,
    },
    violation: {
      turn: 1,
      reason: 'the second close is a recorded VIOLATION on the exhausted soft budget, never a pass',
    },
  },
  {
    id: 'retained-integration-archive',
    gate: 'retained',
    retained: { group: 'integration-review' },
    legacy: ALLOW,
    legacyCheck: legacyIntegrationArchiveCase,
    workflow: integrationArchiveCase,
  },
  {
    id: 'retained-progress-current-note',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: ALLOW,
    legacyCheck: () => legacyProgressCase('current-note'),
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
    legacyCheck: () => legacyProgressCase('stale-note'),
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
    legacyCheck: () => legacyProgressCase('unchecked-missing-note'),
    workflow: async () => progressWorkflowDecision({ codeChanged: true, tickedReviewed: false }),
  },
  {
    id: 'retained-progress-reviewed-tick',
    gate: 'retained',
    retained: { group: 'task-progress' },
    legacy: ALLOW,
    legacyCheck: () => legacyProgressCase('reviewed-tick'),
    workflow: async () => progressWorkflowDecision({ codeChanged: true, tickedReviewed: true }),
  },
  {
    id: 'retained-lane-first-implementation-turn',
    gate: 'retained',
    retained: { group: 'lane' },
    legacy: REFUSE,
    legacyCheck: () => legacyLaneCase('first-implementation-turn'),
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
    legacyCheck: () => legacyLaneCase('single-remaining'),
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
    legacyCheck: () => legacyLaneCase('below-threshold'),
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
    legacyCheck: () => legacyLaneCase('assigned-worker'),
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
 * The real legacy gates, replayed for the parity table. These run the shipped
 * provider harnesses (or the exported pure legacy decision), so the legacy
 * side is the actual implementation rather than a transcribed table.
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
class ParityGit {
  status = ''
  diff = ''
  files: string[] = []

  run = async (args: readonly string[], cwd: string): Promise<Buffer> => {
    const command = args[0] === '-C' ? args[2] : args[0] === '-c' ? 'commit-tree' : args[0]
    if (command === 'rev-parse') {
      return Buffer.from(args.includes('--verify') ? 'b'.repeat(40) : cwd)
    }
    if (command === 'check-ignore') return Buffer.alloc(0)
    if (command === 'ls-files') {
      return args.includes('-u') ? Buffer.alloc(0) : Buffer.from(this.files.join('\0'))
    }
    if (command === 'write-tree') {
      return Buffer.from(
        createHash('sha256')
          .update(`${this.status}\u0000${this.diff}\u0000${this.files.join('\u0000')}`)
          .digest('hex'),
      )
    }
    if (command === 'status') return Buffer.from(this.status)
    if (command === 'diff') return Buffer.from(this.diff)
    return Buffer.alloc(0)
  }
}

interface ParityAgent {
  readonly id: string
  readonly session: { readonly id: string; readonly header: Record<string, never> }
  steer: (message: unknown) => void
}

type EventHandler = (...args: never[]) => unknown

/**
 * The minimal legacy runtime the parity script can run under plain Node: the
 * delegation plugin's built entry, a fake agent, a fake git, and the events the
 * gate subscribes to. The Vitest-bound helpers cannot be imported by the
 * script, which Node runs without a test runner.
 */
class LegacyGateHarness {
  readonly steers: string[] = []
  readonly tools = new Map<
    string,
    { execute: (args: unknown, exec: unknown) => Promise<unknown> }
  >()
  readonly events = new Map<string, EventHandler[]>()
  readonly git = new ParityGit()
  readonly agent: ParityAgent
  private readonly cwd: string

  constructor(options: { readonly cwd: string; readonly config: DelegationConfig }) {
    this.cwd = options.cwd
    this.agent = {
      id: 'agent-1',
      session: { id: 'agent-1', header: {} },
      steer: (message: unknown) => {
        const content = (message as { content?: Array<{ text?: string }> }).content ?? []
        this.steers.push(content.map((block) => block.text ?? '').join('\n'))
      },
    }
    const events = this.events
    const cwd = options.cwd
    const ctx = {
      subagents: {
        getProvider: () => undefined,
        startActivation: async () => {
          throw new Error('the parity fixture never starts a target')
        },
      },
      provide: () => () => undefined,
      get: () => undefined,
      workingDirectory: { get: () => cwd },
      tools: {
        register: (definition: { name: string } & Record<string, unknown>) => {
          this.tools.set(
            definition.name,
            definition as unknown as {
              execute: (args: unknown, exec: unknown) => Promise<unknown>
            },
          )
          return () => undefined
        },
      },
      skills: { registerProvider: () => () => undefined },
      on: (name: string, handler: EventHandler) => {
        const list = events.get(name) ?? []
        list.push(handler)
        events.set(name, list)
        return () => undefined
      },
    }
    applyDelegationRules(ctx as never, options.config, {
      runGit: this.git.run,
      now: () => new Date('2026-11-15T00:00:00.000Z'),
    })
  }

  private async fire(name: string, args: unknown[]): Promise<void> {
    for (const handler of this.events.get(name) ?? []) {
      await (handler as (...values: unknown[]) => unknown)(...args)
    }
  }

  async preStep(turn = 1): Promise<void> {
    await this.fire('agent/pre-step', [
      {
        agent: this.agent,
        turn,
        step: 1,
        messages: [],
        signal: new AbortController().signal,
      },
      async () => ({ kind: 'enter', messages: [] }),
    ])
  }

  async turnStopping(turn = 1): Promise<void> {
    await this.fire('agent/turn-stopping', [
      { agent: this.agent, turn, signal: new AbortController().signal },
    ])
  }

  /** Record one successful tool call the way the delegation listeners see it. */
  async toolOutcome(name: string, args: unknown, value: unknown): Promise<void> {
    await this.fire('tools/result', [
      {
        agent: this.agent,
        arguments: args,
        callId: 'call-1',
        name,
        rootCallId: 'root-1',
        signal: new AbortController().signal,
        token: Symbol('token'),
      },
      { isError: false, value, content: [] },
    ])
  }

  /** A first-party write result with the canonical before/after contents. */
  async writeResult(filePath: string, before: string, after: string): Promise<void> {
    await this.toolOutcome(
      'write',
      { file_path: filePath },
      { path: resolve(this.cwd, filePath), before, after },
    )
  }

  async toolText(name: string, args: unknown): Promise<string> {
    const tool = this.tools.get(name)
    if (tool === undefined) throw new Error(`the legacy runtime has no "${name}" tool`)
    const result = (await tool.execute(args, {
      agent: this.agent,
      signal: new AbortController().signal,
    })) as { text?: unknown }
    if (typeof result.text !== 'string') {
      throw new Error(`the "${name}" tool returned no text`)
    }
    return result.text
  }

  async preExecute(name: string, args: unknown): Promise<'allow' | 'deny'> {
    let decision: unknown = { kind: 'allow' }
    const next = async (): Promise<{ kind: 'allow' }> => ({ kind: 'allow' })
    for (const handler of this.events.get('tools/pre-execute') ?? []) {
      decision = await (handler as (...values: unknown[]) => unknown)(
        {
          agent: this.agent,
          arguments: args,
          callId: 'call-1',
          name,
          rootCallId: 'root-1',
          signal: new AbortController().signal,
          token: Symbol('token'),
        },
        next,
      )
    }
    return (decision as { kind?: string }).kind === 'deny' ? 'deny' : 'allow'
  }
}

const ALL_SWITCHES_OFF: GatesConfig = {
  workflowOwned: false,
  specReview: false,
  integrationReview: false,
  taskProgress: false,
  laneFanout: false,
}

/** The Release A rule shapes a flipped switch restores, one signal at a time. */
function legacyConfig(
  gates: GatesConfig,
  rules: NonNullable<DelegationConfig['rules']>,
): DelegationConfig {
  return { targets: { codex: { provider: 'codex-subagent' } }, rules, gates }
}

const SPEC_REVIEW_RULE = {
  id: 'spec-review',
  when: 'spec-ready' as const,
  to: 'codex',
  contract: 'review' as const,
  phase: 'spec' as const,
  scope: 'whole' as const,
  gate: 'strict' as const,
  instruction: 'bundled:review-spec',
}

const INTEGRATION_REVIEW_RULE = {
  id: 'integration-review',
  when: 'implementation-complete' as const,
  to: 'codex',
  contract: 'review' as const,
  phase: 'integration' as const,
  scope: 'whole' as const,
  gate: 'soft' as const,
  instruction: 'bundled:review-integration',
}

const PROGRESS_RULE = {
  id: 'task-progress',
  when: 'implementation-work' as const,
  contract: 'note' as const,
  gate: 'strict' as const,
}

const LANE_RULE = {
  id: 'lane-fanout',
  when: 'lane-assignment' as const,
  contract: 'note' as const,
  gate: 'strict' as const,
}

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

function legacySteersReview(harness: LegacyGateHarness, rule: string): boolean {
  return harness.steers.join('\n').includes(`rule "${rule}"`)
}

/** One spec-review turn: a write establishes involvement, then the close runs. */
async function legacySpecReviewCase(
  kind: 'missing' | 'stale' | 'current',
): Promise<ParityDecision> {
  const plan = '# Tasks\n\n- [ ] 1.1 First task\n'
  const root = await parityWorkspace(plan)
  try {
    const proposal = join(root, 'openspec', 'changes', 'change-a', 'proposal.md')
    if (kind === 'current') await writeFile(proposal, '# Proposal\n\nWhy changed.\n', 'utf8')
    if (kind !== 'missing') {
      const digest =
        kind === 'stale' ? 'b'.repeat(64) : ((await currentSpecDigest(root, 'change-a')) ?? '')
      const record = {
        rule: 'spec-review',
        change: 'change-a',
        phase: 'spec',
        scope: 'whole',
        digest,
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-15T00:00:00.000Z',
      }
      const recordDir = join(root, '.dsh', 'delegation', 'spec-review', 'change-a')
      await mkdir(recordDir, { recursive: true })
      await writeFile(join(recordDir, 'spec.json'), JSON.stringify(record), 'utf8')
    }
    const harness = new LegacyGateHarness({
      cwd: root,
      config: legacyConfig({ ...ALL_SWITCHES_OFF, specReview: true }, [SPEC_REVIEW_RULE]),
    })
    await harness.preStep(1)
    await harness.writeResult(
      'openspec/changes/change-a/proposal.md',
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    await writeFile(proposal, '# Proposal\n\nWhy changed.\n', 'utf8')
    await harness.turnStopping(1)
    return legacySteersReview(harness, 'spec-review') ? REFUSE : ALLOW
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const PROGRESS_PLAN = `# Tasks

## 1. Engine (owns \`packages/engine/**\`)

- [ ] 1.1 First task

## 2. Docs (owns \`docs/**\`)

- [ ] 2.1 Doc task
`

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

async function legacyProgressCase(
  kind: 'current-note' | 'stale-note' | 'unchecked-missing-note' | 'reviewed-tick',
): Promise<ParityDecision> {
  const root = await parityWorkspace(PROGRESS_PLAN)
  try {
    if (kind === 'reviewed-tick') {
      const taskId = taskIdOf('First task')
      const recordDir = join(
        root,
        '.dsh',
        'workflows',
        'records',
        'task-review',
        'change-a',
        'tasks',
      )
      await mkdir(recordDir, { recursive: true })
      await writeFile(
        join(recordDir, `${taskId}.json`),
        JSON.stringify({
          rule: 'task-review',
          change: 'change-a',
          phase: 'task',
          scope: 'task',
          taskId,
          digest: 'a'.repeat(64),
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-11-15T00:00:00.000Z',
        }),
        'utf8',
      )
    }
    const harness = new LegacyGateHarness({
      cwd: root,
      config: legacyConfig({ ...ALL_SWITCHES_OFF, taskProgress: true }, [PROGRESS_RULE]),
    })
    harness.git.status = ' M packages/engine/src/base.ts\0'
    await harness.preStep(1)
    harness.git.status = ' M packages/engine/src/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine/src/engine.ts b/packages/engine/src/engine.ts'
    // The legacy gate evaluates only the session's involved changes.
    await harness.writeResult(
      'openspec/changes/change-a/proposal.md',
      '# Proposal\n\nWhy.\n',
      '# Proposal\n\nWhy changed.\n',
    )
    await writeFile(
      join(root, 'openspec/changes/change-a/proposal.md'),
      '# Proposal\n\nWhy changed.\n',
      'utf8',
    )
    if (kind === 'current-note' || kind === 'stale-note') {
      await harness.toolText('task_progress', {
        task: '2.1 Doc task',
        status: 'in-progress',
        reason: 'parity progress note',
      })
    }
    if (kind === 'current-note') {
      // The note binds the current digest; no later implementation change.
    }
    if (kind === 'stale-note') {
      harness.git.status = ' M packages/engine/src/engine.ts\0 M docs/a.md\0'
      harness.git.diff = 'diff --git a/docs/a.md b/docs/a.md'
    }
    if (kind === 'reviewed-tick') {
      await harness.writeResult(
        'openspec/changes/change-a/tasks.md',
        PROGRESS_PLAN,
        PROGRESS_PLAN.replace('- [ ] 1.1 First task', '- [x] 1.1 First task'),
      )
      await writeFile(
        join(root, 'openspec/changes/change-a/tasks.md'),
        PROGRESS_PLAN.replace('- [ ] 1.1 First task', '- [x] 1.1 First task'),
        'utf8',
      )
    }
    await harness.turnStopping(1)
    return legacySteersReview(harness, 'task-progress') ? REFUSE : ALLOW
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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

async function legacyLaneCase(
  kind: 'first-implementation-turn' | 'single-remaining' | 'below-threshold' | 'assigned-worker',
): Promise<ParityDecision> {
  const base =
    kind === 'single-remaining' || kind === 'assigned-worker' ? LANE_PLAN_SINGLE : LANE_PLAN_TWO
  const ticked = base.replace('- [ ] 1.1 First task', '- [x] 1.1 First task')
  const root = await parityWorkspace(base)
  try {
    const harness = new LegacyGateHarness({
      cwd: root,
      config: legacyConfig({ ...ALL_SWITCHES_OFF, laneFanout: true }, [LANE_RULE]),
    })
    harness.git.status = ' M packages/engine/src/base.ts\0'
    await harness.preStep(1)
    harness.git.status = ' M packages/engine/src/engine.ts\0'
    harness.git.diff = 'diff --git a/packages/engine/src/engine.ts b/packages/engine/src/engine.ts'
    if (kind !== 'below-threshold') {
      await harness.writeResult('openspec/changes/change-a/tasks.md', base, ticked)
      await writeFile(join(root, 'openspec/changes/change-a/tasks.md'), ticked, 'utf8')
    } else {
      // No task tick, so the change is involved through its proposal instead.
      await harness.writeResult(
        'openspec/changes/change-a/proposal.md',
        '# Proposal\n\nWhy.\n',
        '# Proposal\n\nWhy changed.\n',
      )
      await writeFile(
        join(root, 'openspec/changes/change-a/proposal.md'),
        '# Proposal\n\nWhy changed.\n',
        'utf8',
      )
    }
    if (kind === 'assigned-worker') {
      await harness.toolOutcome(
        'subagent',
        {
          prompt: `lane-tag: change-a#2. Implement the unchecked tasks under ${LANE_DOCS_TITLE}.`,
        },
        { output: 'started', exitCode: 0 },
      )
    }
    await harness.turnStopping(1)
    return legacySteersReview(harness, 'lane-fanout') ? REFUSE : ALLOW
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** One complete change so the legacy integration rule sees `completed`. */
async function completeLegacyChange(root: string, plan: string): Promise<void> {
  const harness = new LegacyGateHarness({
    cwd: root,
    config: legacyConfig(ALL_SWITCHES_OFF, [INTEGRATION_REVIEW_RULE]),
  })
  await harness.preStep(1)
  await harness.writeResult(
    'openspec/changes/change-a/tasks.md',
    plan,
    plan.replace('- [ ] 1.1 First task', '- [x] 1.1 First task'),
  )
  await writeFile(
    join(root, 'openspec/changes/change-a/tasks.md'),
    plan.replace('- [ ] 1.1 First task', '- [x] 1.1 First task'),
    'utf8',
  )
  await harness.turnStopping(1)
}

/** The legacy soft integration rule: one refusal, then the next close passes. */
async function legacyIntegrationSequence(): Promise<readonly ParityDecision[]> {
  const plan = '# Tasks\n\n- [ ] 1.1 First task\n'
  const root = await parityWorkspace(plan)
  try {
    await completeLegacyChange(root, plan)
    const harness = new LegacyGateHarness({
      cwd: root,
      config: legacyConfig({ ...ALL_SWITCHES_OFF, integrationReview: true }, [
        INTEGRATION_REVIEW_RULE,
      ]),
    })
    await harness.preStep(1)
    const first = harness.steers.length
    await harness.turnStopping(1)
    const firstDecision = harness.steers.length > first ? REFUSE : ALLOW
    const second = harness.steers.length
    await harness.turnStopping(2)
    const secondDecision = harness.steers.length > second ? REFUSE : ALLOW
    return [firstDecision, secondDecision]
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** The legacy archive guard allows an approved, fully checked change. */
async function legacyIntegrationArchiveCase(): Promise<ParityDecision> {
  const plan = '# Tasks\n\n- [x] 1.1 Final task\n'
  const root = await parityWorkspace(plan)
  try {
    const taskId = taskIdOf('Final task')
    const reviews = join(root, 'openspec', 'changes', 'change-a', 'reviews')
    await mkdir(reviews, { recursive: true })
    await writeFile(
      join(reviews, `${taskId}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: 'change-a',
        scope: 'task',
        taskId,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-15T00:00:00.000Z',
      }),
      'utf8',
    )
    await writeFile(
      join(root, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    const harness = new LegacyGateHarness({
      cwd: root,
      config: legacyConfig({ ...ALL_SWITCHES_OFF, workflowOwned: true }, [
        {
          id: 'task-review',
          when: 'spec-task-ready',
          to: 'codex',
          contract: 'review',
          scope: 'task',
          gate: 'strict',
          instruction: 'bundled:review-task',
        },
      ]),
    })
    const decision = await harness.preExecute('pwsh', {
      command: 'openspec archive change-a',
    })
    return decision === 'allow'
      ? { decision: 'allow', reason: 'the legacy archive guard allows the approved change' }
      : { decision: 'refuse', reason: 'the legacy archive guard refuses the approved change' }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

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

/** Run the shipped integration review through two closes; return its run too. */
async function integrationSoftSettlement(): Promise<{
  readonly run: import('../lib/runs.js').WorkflowRun
  readonly outcomes: readonly import('../lib/gates.js').TurnCloseOutcome[]
}> {
  const definition = loadShippedDefinitionsForFixtures().find(
    (entry) => entry.id === 'integration-review',
  )
  if (definition === undefined)
    throw new Error('the shipped integration-review definition is missing')
  let run = createRun({
    definition: 'integration-review',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'change-a' },
    steps: ['review'],
    now: 1_000,
  })
  const outcomes: import('../lib/gates.js').TurnCloseOutcome[] = []
  for (let close = 0; close < 2; close += 1) {
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: { steer: () => undefined },
      evidenceContext: { workspace: '/workspace', values: { name: 'change-a' } },
      turn: 1,
      maxBlocks: definition.settings.maxBlocks,
      installedLegacy: new Set(),
      enabledLegacy: new Set(),
    })
    outcomes.push(outcome)
    run = outcome.run
  }
  return { run, outcomes }
}

function integrationOutcomeDecision(
  outcome: import('../lib/gates.js').TurnCloseOutcome,
): ParityDecision {
  if (outcome.kind === 'allow') return ALLOW
  if (outcome.kind === 'refuse') return REFUSE
  return {
    decision: 'allow',
    reason: 'the exhausted soft budget allows the close once as a recorded VIOLATION',
    violation: true,
  }
}

/** The soft signal's per-turn sequence: refuse once, then allow with a violation. */
async function integrationSoftSequence(): Promise<readonly ParityDecision[]> {
  const { outcomes } = await integrationSoftSettlement()
  return outcomes.map(integrationOutcomeDecision)
}

/**
 * An exhausted soft run keeps no open required step, so an otherwise
 * authorized archive is allowed and the run never counts as a pass.
 */
async function integrationArchiveCase(): Promise<ParityDecision> {
  const { run, outcomes } = await integrationSoftSettlement()
  if (outcomes[1]?.kind !== 'violation') {
    return {
      decision: 'refuse',
      reason: 'the integration run did not settle on its exhausted soft budget',
    }
  }
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
  /** Whether the case's declared VIOLATION was reproduced. */
  readonly declaredViolation?: boolean
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
    const declaredViolation =
      parityCase.violation === undefined
        ? undefined
        : workflowSequence[parityCase.violation.turn]?.violation === true
    return {
      ok:
        decisionsMatch &&
        recordedOk &&
        (parityCase.violation === undefined || declaredViolation === true),
      legacySequence,
      workflowSequence,
      ...(declaredViolation === undefined ? {} : { declaredViolation }),
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
