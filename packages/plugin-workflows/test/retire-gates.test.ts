import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type Definition,
  loadShippedDefinitions,
  resolveOwnership,
} from '../src/host/definitions.ts'
import { verifyEvidence } from '../src/host/evidence.ts'
import { evaluateArchiveGate, evaluateTurnClose } from '../src/host/gates.ts'
import {
  checkpointCloseIssue,
  parityLoadIssues,
  resolveVerifySettings,
  taskReviewCompletion,
  taskReviewCoverage,
  templateHash,
  withVerifySettings,
} from '../src/host/parity.ts'
import { createRun, settleStep, type WorkflowRun } from '../src/host/runs.ts'

/**
 * The retirement load gate, the owned close/archive decisions, and the verify
 * settings contract. These are the pure functions the runtime calls; the
 * host-wiring suite exercises the same path end to end.
 */

function shipped(id: string): Definition {
  const found = loadShippedDefinitions().find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`the ${id} definition is missing`)
  return found
}

const enabledOff = (): ReadonlySet<string> => new Set<string>()

function runFor(definition: Definition, done: boolean): WorkflowRun {
  let run = createRun({
    definition: definition.id,
    trigger: definition.trigger.kind,
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth', taskId: '0123456789abcdef' },
    steps: definition.steps.map((step) => step.id),
    now: 1_000,
  })
  if (done) {
    for (const step of definition.steps) {
      run = settleStep(run, step.id, 'done', { at: 1_001, evidence: { kind: 'declaration' } })
    }
  }
  return run
}

const steer = { steer: () => undefined }

describe('parity load gate and verify settings', () => {
  it('refuses an own definition when the shipped report is missing or stale', () => {
    const definitions = loadShippedDefinitions()
    const missing = parityLoadIssues(definitions, undefined, '/plugins/parity.json', undefined)
    expect([...missing.refused]).toEqual(expect.arrayContaining(['retro', 'task-review', 'verify']))
    expect(missing.issues.join('\n')).toMatch(/checkpoint\.automation: true/u)
    expect(missing.issues.join('\n')).toMatch(/delegation\.gates\.workflowOwned: true/u)

    const report = {
      v: 1 as const,
      change: 'retire-legacy-gates',
      at: '',
      templates: { retro: 'sha256-wrong' },
      settings: { 'verify.commands': { type: 'list', cases: ['a'] } },
      gates: {},
      retained: {},
      mismatches: [],
    }
    const stale = parityLoadIssues(definitions, report, '/plugins/parity.json', undefined)
    expect(stale.issues.join('\n')).toMatch(/template hash/u)
    expect(stale.issues.join('\n')).toMatch(/workflows:parity/u)
  })

  it('accepts the settings matrix and rejects an invalid profile value', () => {
    expect(resolveVerifySettings({ commands: ['pnpm check'], maxBlocks: 129 })).toEqual({
      commands: ['pnpm check'],
      maxBlocks: 129,
    })
    expect(() => resolveVerifySettings({ commands: [''] })).toThrow(/commands/u)
    expect(() => resolveVerifySettings({ commands: [] })).not.toThrow()
    expect(() => resolveVerifySettings({ maxBlocks: 0 })).toThrow(/maxBlocks/u)
    expect(() => resolveVerifySettings({ maxBlocks: 1.5 })).toThrow(/maxBlocks/u)
    expect(() => resolveVerifySettings({ unknown: true })).toThrow(/unknown field/u)
  })

  it('applies profile settings without changing the parity template hash', () => {
    const verify = shipped('verify')
    const before = templateHash(verify)
    const applied = withVerifySettings(verify, { commands: ['cargo test'], maxBlocks: 129 })
    expect(applied.settings.maxBlocks).toBe(129)
    expect(templateHash(applied)).toBe(before)
    expect(verify.settings.maxBlocks).toBe(8)
  })

  it('accepts the intake spec-review defer only while that signal is real', () => {
    const intake = shipped('change-intake')
    const enabled = new Set(['delegation-rules/spec-review'])
    expect(resolveOwnership(intake, new Set(['delegation-rules']), enabled).issues).toEqual([])
    const disabled = resolveOwnership(intake, new Set(['delegation-rules']), new Set())
    expect(disabled.issues.join('\n')).toMatch(/spec-review/u)
    expect(disabled.issues.join('\n')).toMatch(/gate-only switch is off|no enforcing legacy gate/u)
  })

  it('never embeds a shell command in the verify template', () => {
    const check = shipped('verify').steps[0]
    expect(check?.evidence).toEqual({ kind: 'check', source: 'verify-settings' })
    expect(JSON.stringify(check?.evidence)).not.toContain('"command"')
  })
})

describe('owned task-review decisions', () => {
  const taskReview = () => shipped('task-review')

  it('refuses a completed list without portable coverage and allows full coverage', () => {
    const run = runFor(taskReview(), true)
    const refused = evaluateTurnClose({
      run,
      definition: taskReview(),
      agent: steer,
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 1,
      maxBlocks: 3,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
      completion: { ok: false, text: 'checked task "1.1 Foreign" has no portable PASS' },
    })
    expect(refused.kind).toBe('refuse')
    if (refused.kind === 'refuse') expect(refused.text).toContain('portable PASS')

    const allowed = evaluateTurnClose({
      run,
      definition: taskReview(),
      agent: steer,
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 1,
      maxBlocks: 3,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
      completion: { ok: true },
    })
    expect(allowed.kind).toBe('allow')
  })

  it('refuses the archive for a missing portable PASS and allows it with coverage', () => {
    const base = {
      change: 'auth',
      runs: [
        {
          ...runFor(shipped('change-intake'), true),
          id: 'run-intake',
          definition: 'change-intake',
          status: 'completed' as const,
          context: { name: 'auth' },
        },
      ],
      receipts: [],
      specRecord: { ok: true as const, evidence: { kind: 'record' as const, path: 'spec.json' } },
    }
    const refused = evaluateArchiveGate({
      ...base,
      taskReview: { ok: false, text: 'checked task "1.1 Task" has no portable PASS' },
    })
    expect(refused.kind).toBe('deny')
    if (refused.kind === 'deny') expect(refused.reason).toContain('portable PASS')
    const allowed = evaluateArchiveGate({ ...base, taskReview: { ok: true } })
    expect(allowed.kind).toBe('allow')
  })

  it('allows an ERROR to close an intermediate turn without approving', () => {
    const definition = taskReview()
    const run = runFor(definition, true)
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: steer,
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 1,
      maxBlocks: 3,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
    })
    expect(outcome.kind).toBe('allow')
  })
})

describe('owned checkpoint decisions', () => {
  it('refuses an unexecuted remedy and an aged bottleneck, and allows the executed route', () => {
    const bottleneck = {
      id: 'guard-missing',
      owner: 'lead',
      action: 'lead_action',
      blockingLanes: ['edit'],
      targets: ['src/a.ts'],
    }
    const unexecuted = checkpointCloseIssue({
      record: { outcome: 'continue', lanes: [], bottleneck },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [],
      bottleneckAge: 2,
    })
    expect(unexecuted).toContain('execute the bottleneck remedy')
    const executed = checkpointCloseIssue({
      record: { outcome: 'continue', lanes: [], bottleneck },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [{ toolName: 'edit', arguments: { file_path: 'src/a.ts' }, ok: true }],
      bottleneckAge: 2,
    })
    expect(executed).toBeUndefined()
    const aged = checkpointCloseIssue({
      record: { outcome: 'continue', lanes: [], bottleneck, bottleneckAge: 2 },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [{ toolName: 'edit', arguments: { file_path: 'src/a.ts' }, ok: true }],
      bottleneckAge: 2,
    })
    expect(aged).toContain('survived')
    const workerOwned = checkpointCloseIssue({
      record: {
        outcome: 'continue',
        lanes: [],
        bottleneck: { ...bottleneck, owner: 'lane-a', action: 'lead_action' },
      },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [],
      bottleneckAge: 2,
    })
    expect(workerOwned).toContain('worker_start or user_decision')
  })

  it('refuses the turn close while a checkpoint issue is present', () => {
    const retro = shipped('retro')
    const run = runFor(retro, true)
    const refused = evaluateTurnClose({
      run,
      definition: retro,
      agent: steer,
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 1,
      maxBlocks: 3,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
      checkpointIssue: { text: 'execute the bottleneck remedy' },
    })
    expect(refused.kind).toBe('refuse')
  })
})

describe('owned verification evidence', () => {
  const check = (input: Parameters<typeof verifyEvidence>[1]) =>
    verifyEvidence({ kind: 'check', source: 'verify-settings' }, input)

  it('requires a passing configured command after the last code write', async () => {
    const passing = await check({
      workspace: '/workspace',
      values: {},
      checkCommands: ['pnpm check'],
      lastWriteAt: 100,
      shellResults: [
        { callId: 'c1', command: 'pnpm check', at: 120, exitCode: 0, foreground: true },
      ],
    })
    expect(passing.ok).toBe(true)
    const missing = await check({
      workspace: '/workspace',
      values: {},
      checkCommands: ['pnpm check'],
      lastWriteAt: 100,
      shellResults: [],
    })
    expect(missing.ok).toBe(false)
    const failed = await check({
      workspace: '/workspace',
      values: {},
      checkCommands: ['pnpm check'],
      lastWriteAt: 100,
      shellResults: [
        { callId: 'c1', command: 'pnpm check', at: 120, exitCode: 1, foreground: true },
      ],
    })
    expect(failed.ok).toBe(false)
    const background = await check({
      workspace: '/workspace',
      values: {},
      checkCommands: ['pnpm check'],
      lastWriteAt: 100,
      shellResults: [
        { callId: 'c1', command: 'pnpm check', at: 120, exitCode: 0, foreground: false },
      ],
    })
    expect(background.ok).toBe(false)
    const before = await check({
      workspace: '/workspace',
      values: {},
      checkCommands: ['pnpm check'],
      lastWriteAt: 200,
      shellResults: [
        { callId: 'c1', command: 'pnpm check', at: 120, exitCode: 0, foreground: true },
      ],
    })
    expect(before.ok).toBe(false)
  })

  it('is inert without a code write or a configured command', async () => {
    expect(
      (
        await check({
          workspace: '/workspace',
          values: {},
          checkCommands: ['pnpm check'],
          shellResults: [],
        })
      ).ok,
    ).toBe(true)
    expect(
      (
        await check({
          workspace: '/workspace',
          values: {},
          checkCommands: [],
          lastWriteAt: 100,
          shellResults: [],
        })
      ).ok,
    ).toBe(true)
  })

  it('normalizes one rtk prefix like the legacy gate', async () => {
    const check2 = await check({
      workspace: '/workspace',
      values: {},
      checkCommands: ['pnpm check'],
      lastWriteAt: 100,
      shellResults: [
        { callId: 'c1', command: 'rtk pnpm check', at: 120, exitCode: 0, foreground: true },
      ],
    })
    expect(check2.ok).toBe(true)
  })

  it('refuses an own verify beside the enabled row and a defer verify beside the disabled row', () => {
    const verify = shipped('verify')
    const verificationEnabled = new Set(['verification-gate/verification-gate'])
    expect(
      resolveOwnership(verify, new Set(['verification-gate']), verificationEnabled).issues.join(
        '\n',
      ),
    ).toMatch(/still enabled/u)
    expect(resolveOwnership(verify, new Set(['verification-gate']), new Set()).issues).toEqual([])
    const deferred = {
      ...verify,
      settings: { ...verify.settings, gateOwnership: 'defer' as const },
    }
    expect(
      resolveOwnership(deferred, new Set(['verification-gate']), new Set()).issues.join('\n'),
    ).toMatch(/no enforcing legacy gate/u)
  })
})

describe('owned task-review definition', () => {
  async function workspaceWithRecords(verdicts: Record<string, string>): Promise<string> {
    const workspace = await mkdtemp(join(tmpdir(), 'workflows-retire-'))
    const localDir = join(workspace, '.dsh', 'delegation', 'task-review', 'auth', 'tasks')
    await mkdir(localDir, { recursive: true })
    for (const [taskId, verdict] of Object.entries(verdicts)) {
      await writeFile(
        join(localDir, `${taskId}.json`),
        JSON.stringify({
          rule: 'task-review',
          change: 'auth',
          phase: 'task',
          scope: 'task',
          taskId,
          digest: 'a'.repeat(64),
          verdict,
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-11-08T00:00:00.000Z',
        }),
        'utf8',
      )
    }
    return workspace
  }

  it('accepts PASS and ERROR for await-review, and keeps FINDINGS open', async () => {
    const taskId = '0123456789abcdef'
    const awaitEvidence = shipped('task-review').steps.find(
      (step) => step.id === 'await-review',
    )?.evidence
    expect(awaitEvidence).toBeDefined()
    for (const verdict of ['PASS', 'ERROR']) {
      const workspace = await workspaceWithRecords({ [taskId]: verdict })
      const check = await verifyEvidence(awaitEvidence as never, {
        workspace,
        values: { name: 'auth', taskId },
      })
      expect(check.ok).toBe(true)
      await rm(workspace, { recursive: true, force: true })
    }
    const findings = await workspaceWithRecords({ [taskId]: 'FINDINGS' })
    const check = await verifyEvidence(awaitEvidence as never, {
      workspace: findings,
      values: { name: 'auth', taskId },
    })
    expect(check.ok).toBe(false)
    await rm(findings, { recursive: true, force: true })
  })

  it('requires portable PASS coverage for every checked task at completion', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'workflows-retire-'))
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(
      join(changeDir, 'tasks.md'),
      '# Tasks\n\n- [x] 1.1 Foreign\n- [x] 1.2 Local\n',
      'utf8',
    )
    const missing = taskReviewCompletion(workspace, 'auth')
    expect(missing?.ok).toBe(false)
    expect(missing?.text).toContain('Foreign')
    const taskId = (await import('../src/host/tasks.ts')).taskIdOf('Foreign')
    const localId = (await import('../src/host/tasks.ts')).taskIdOf('Local')
    for (const id of [taskId, localId]) {
      await writeFile(
        join(changeDir, 'reviews', `${id}.json`),
        JSON.stringify({
          rule: 'task-review',
          change: 'auth',
          scope: 'task',
          taskId: id,
          digest: 'a'.repeat(64),
          verdict: 'PASS',
          findings: [],
          target: { provider: 'codex-subagent' },
          time: '2026-11-08T00:00:00.000Z',
        }),
        'utf8',
      )
    }
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(true)
    expect(taskReviewCompletion(workspace, 'auth')?.ok).toBe(true)
    expect(taskReviewCompletion(workspace, 'missing-change')).toBeUndefined()
    await rm(workspace, { recursive: true, force: true })
  })
})
