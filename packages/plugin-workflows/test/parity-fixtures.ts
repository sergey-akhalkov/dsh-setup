import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/** The shipped await-review step judged by the production evidence reader. */
async function reviewWorkflow(verdict: string | undefined): Promise<ParityDecision> {
  const definition = loadShippedDefinitionsForFixtures().find((entry) => entry.id === 'task-review')
  const evidence = definition?.steps.find((step) => step.id === 'await-review')?.evidence
  if (evidence === undefined) throw new Error('the shipped await-review evidence is missing')
  const root = await mkdtemp(join(tmpdir(), 'workflows-parity-'))
  try {
    const taskId = '0123456789abcdef'
    const directory = join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks')
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
          findings: [],
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
    return check.ok
      ? {
          decision: 'allow',
          reason: `the shipped await-review accepts ${verdict ?? 'no record'}`,
        }
      : {
          decision: 'refuse',
          reason: `the shipped await-review rejects ${verdict ?? 'no record'}`,
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

export async function runParityCase(parityCase: ParityCase): Promise<{
  readonly ok: boolean
  readonly workflow?: ParityDecision
  readonly legacyReplay?: ParityDecision
}> {
  if (parityCase.workflow === undefined) return { ok: true }
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
