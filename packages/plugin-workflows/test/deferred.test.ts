import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadApprovedDefinitions } from '../src/host/approval-store.ts'
import {
  type Definition,
  loadShippedDefinitions,
  resolveOwnership,
} from '../src/host/definitions.ts'
import { verifyEvidence } from '../src/host/evidence.ts'
import { runDeferredStep } from '../src/host/gates.ts'
import { HostAuth } from '../src/host/host-auth.ts'
import {
  completeNotApplicable,
  createRun,
  DAY_MS,
  pruneRuns,
  runPath,
  type WorkflowRun,
  writeRun,
} from '../src/host/runs.ts'
import {
  checkpointRequired,
  type DefinitionEvent,
  evaluateDefinitions,
} from '../src/host/triggers.ts'

const TEMP_DIRECTORIES: string[] = []

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-deferred-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

function definition(id: string): Definition {
  const found = loadShippedDefinitions().find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`the ${id} definition is missing`)
  return found
}

function auth(): HostAuth {
  return HostAuth.fromKey('test-deferred-host-key-0123456789')
}

const INSTALLED: ReadonlySet<string> = new Set(['delegation-rules', 'goal-continuity'])
const DISABLED: ReadonlySet<string> = new Set(['delegation-rules/spec-review'])
const ENABLED: ReadonlySet<string> = new Set([
  'delegation-rules/task-review',
  'goal-continuity/work_checkpoint',
])

/** A synthetic deferred definition: the shipped one with its ownership flipped. */
function deferred(
  entry: Definition,
  step: string,
  evidence: Definition['steps'][number]['evidence'],
): Definition {
  return {
    ...entry,
    settings: {
      ...entry.settings,
      gateOwnership: 'defer',
      legacy: entry.settings.legacy ?? { plugin: 'delegation-rules', signal: 'task-review' },
    },
    steps: [
      {
        id: step,
        title: 'Read the existing legacy record',
        executor: 'main',
        prompt: 'Read the record; never steer.',
        ...(evidence === undefined ? {} : { evidence }),
        next: 'end',
      },
    ],
  }
}

describe('shipped ownership after the retirement flip', () => {
  it('ships task-review, retro, and verify as active owned definitions', () => {
    const taskReview = definition('task-review')
    expect(taskReview.trigger).toMatchObject({ kind: 'fs.change', mode: 'active' })
    expect(taskReview.settings.gateOwnership).toBe('own')
    expect(taskReview.settings.legacy).toEqual({
      plugin: 'delegation-rules',
      signal: 'task-review',
    })
    expect(taskReview.steps.map((step) => step.id)).toEqual([
      'start-review',
      'await-review',
      'complete-review',
    ])

    const retro = definition('retro')
    expect(retro.trigger).toMatchObject({
      kind: 'turn.stopping',
      mode: 'active',
      applicability: 'checkpoint-required',
    })
    expect(retro.settings.gateOwnership).toBe('own')
    expect(retro.settings.legacy).toEqual({
      plugin: 'goal-continuity',
      signal: 'work_checkpoint',
    })
    expect(retro.steps.map((step) => step.id)).toEqual(['checkpoint', 'verify'])

    const verify = definition('verify')
    expect(verify.settings.gateOwnership).toBe('own')
    expect(verify.settings.legacy).toEqual({
      plugin: 'verification-gate',
      signal: 'verification-gate',
    })
    expect(verify.trigger.applicability).toBe('code-write')
  })

  it('loads an own definition beside an installed but disabled signal', async () => {
    const workspace = await tempWorkspace()
    const loaded = await loadApprovedDefinitions(workspace, {
      auth: auth(),
      installedLegacy: INSTALLED,
      enabledLegacy: DISABLED,
    })
    expect(loaded.definitions.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['retro', 'task-review']),
    )
    expect(loaded.errors).toEqual([])
    for (const id of ['retro', 'task-review', 'verify']) {
      expect(resolveOwnership(definition(id), INSTALLED, DISABLED).issues).toEqual([])
    }
  })

  it('refuses an own definition beside its enabled signal', async () => {
    const workspace = await tempWorkspace()
    const loaded = await loadApprovedDefinitions(workspace, {
      auth: auth(),
      installedLegacy: INSTALLED,
      enabledLegacy: ENABLED,
    })
    expect(loaded.definitions.map((entry) => entry.id)).not.toContain('task-review')
    expect(loaded.definitions.map((entry) => entry.id)).not.toContain('retro')
    expect(loaded.errors.join('\n')).toMatch(/still enabled/u)
    expect(loaded.errors.join('\n')).toMatch(/retire-legacy-gates/u)
  })
})

describe('deferred step runtime', () => {
  async function taskReviewFixture(): Promise<{
    workspace: string
    taskId: string
    entry: Definition
  }> {
    const workspace = await tempWorkspace()
    const entry = deferred(definition('task-review'), 'read-review', {
      kind: 'record',
      rule: 'task-review',
      change: '{name}',
      scope: 'task',
      task: '{taskId}',
      verdict: 'PASS',
      path: 'openspec/changes/{name}/reviews/{taskId}.json',
    })
    const taskId = '0123456789abcdef'
    await mkdir(join(workspace, 'openspec', 'changes', 'auth', 'reviews'), { recursive: true })
    await writeFile(
      join(workspace, 'openspec', 'changes', 'auth', 'reviews', `${taskId}.json`),
      `${JSON.stringify({
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        taskId,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        time: '2026-11-07T00:00:00.000Z',
        target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
      })}\n`,
      'utf8',
    )
    return { workspace, taskId, entry }
  }

  function runFor(name: string, context: Record<string, unknown>): WorkflowRun {
    return createRun({
      definition: name,
      trigger: 'fs.change',
      session: 'session-1',
      workspace: '/workspace',
      context,
      steps: ['read-review'],
      now: 1_000,
    })
  }

  it('completes a deferred step from the existing PASS record without a steer', async () => {
    const { workspace, taskId, entry } = await taskReviewFixture()
    const evidence = {
      kind: 'record' as const,
      rule: 'task-review',
      change: '{name}',
      scope: 'task',
      task: '{taskId}',
      verdict: 'PASS',
      path: 'openspec/changes/{name}/reviews/{taskId}.json',
    }
    const readRecord = (candidate: { evidence?: unknown }) =>
      verifyEvidence((candidate.evidence as never) ?? { kind: 'declaration' }, {
        workspace,
        values: { name: 'auth', taskId },
      })
    const result = await runDeferredStep({
      run: runFor('task-review', { name: 'auth', taskId }),
      definition: entry,
      stepId: 'read-review',
      installedLegacy: INSTALLED,
      enabledLegacy: ENABLED,
      readRecord: readRecord as never,
    })
    expect(result.dispatched).toBe(false)
    expect(result.steered).toBe(false)
    expect(result.run.steps[0]?.state).toBe('done')

    const missing = await runDeferredStep({
      run: runFor('task-review', { name: 'auth', taskId: 'fedcba9876543210' }),
      definition: entry,
      stepId: 'read-review',
      installedLegacy: INSTALLED,
      enabledLegacy: ENABLED,
      readRecord: (candidate) =>
        verifyEvidence(candidate.evidence ?? { kind: 'declaration' }, {
          workspace,
          values: { name: 'auth', taskId: 'fedcba9876543210' },
        }),
    })
    expect(missing.run.status).toBe('blocked')
    expect(missing.run.steps[0]?.state).toBe('blocked')
    expect(evidence.kind).toBe('record')
  })

  it('blocks a deferred step whose signal is installed but disabled', async () => {
    const { entry } = await taskReviewFixture()
    const result = await runDeferredStep({
      run: runFor('task-review', { name: 'auth', taskId: '0123456789abcdef' }),
      definition: entry,
      stepId: 'read-review',
      installedLegacy: INSTALLED,
      enabledLegacy: DISABLED,
      readRecord: async () => ({ ok: true, evidence: { kind: 'record', path: 'x' } }),
    })
    expect(result.run.status).toBe('blocked')
  })
})

describe('retro applicability', () => {
  it('records retro applicability and creates observational runs only when applicable', () => {
    const retro = definition('retro')
    const event: DefinitionEvent = {
      kind: 'turn.stopping',
      subject: 'stop-attempt',
      session: 'session-1',
      turn: 3,
    }
    const evaluate = (input: {
      toolCalls: number
      lastTool?: string
      written?: number
      workers?: number
    }): { runs: number; reason: string | undefined } => {
      let runs = 0
      const rows = evaluateDefinitions([retro], event, {
        isDuplicate: () => false,
        resolveApplicability: () =>
          checkpointRequired({
            toolCalls: input.toolCalls,
            ...(input.lastTool === undefined ? {} : { lastTool: input.lastTool }),
            written: input.written ?? 0,
            workers: input.workers ?? 0,
          }),
        startRun: () => {
          runs += 1
          return { ok: true }
        },
      })
      return { runs, reason: rows[0]?.reason }
    }
    expect(evaluate({ toolCalls: 2 })).toEqual({ runs: 0, reason: 'not-applicable' })
    expect(evaluate({ toolCalls: 5, written: 0 })).toEqual({ runs: 0, reason: 'not-applicable' })
    expect(evaluate({ toolCalls: 5, lastTool: 'ask_user_question', written: 1 })).toEqual({
      runs: 0,
      reason: 'not-applicable',
    })
    expect(evaluate({ toolCalls: 5, written: 1 })).toEqual({ runs: 1, reason: 'run-created' })
  })

  it('completes a non-applicable retro run so retention can prune it', async () => {
    const workspace = await tempWorkspace()
    const retro = definition('retro')
    const run = createRun({
      definition: 'retro',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace,
      context: { checkpoint: `.dsh/work-checkpoints/${'a'.repeat(16)}/3.json` },
      steps: ['checkpoint'],
      now: 1_000,
    })
    const settled = completeNotApplicable(run, 2_000)
    expect(settled.status).toBe('completed')
    expect(settled.reason).toBe('not-applicable')
    await writeRun(workspace, settled, auth())
    const old = Date.now() - 40 * DAY_MS
    await utimes(runPath(workspace, run.id), new Date(old), new Date(old))
    const result = await pruneRuns(workspace, { auth: auth(), retentionMs: 30 * DAY_MS })
    expect(result.removed).toContain(run.id)
    expect(retro.settings.gateOwnership).toBe('own')
  })

  it('keeps the deferred runs visible and never starts a second run for a duplicate turn', () => {
    const retro = definition('retro')
    const seen = new Map<string, number>()
    let runs = 0
    const context = {
      isDuplicate: (key: string) => seen.has(key),
      markKey: (key: string) => seen.set(key, 1),
      resolveApplicability: () => true,
      startRun: () => {
        runs += 1
        return { ok: true }
      },
    }
    const event: DefinitionEvent = {
      kind: 'turn.stopping',
      subject: 'stop-attempt',
      session: 'session-1',
      turn: 7,
    }
    expect(evaluateDefinitions([retro], event, context)[0]?.reason).toBe('run-created')
    expect(evaluateDefinitions([retro], event, context)[0]?.reason).toBe('dedupe')
    expect(runs).toBe(1)
  })
})
