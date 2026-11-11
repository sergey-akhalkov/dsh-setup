import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type Definition,
  loadShippedDefinitions,
  resolveOwnership,
} from '../src/host/definitions.ts'
import { commandMatches, verifyEvidence } from '../src/host/evidence.ts'
import { evaluateArchiveGate, evaluateTurnClose } from '../src/host/gates.ts'
import {
  checkpointCloseIssue,
  parityLoadIssues,
  readParityReport,
  resolveVerifySettings,
  taskReviewCompletion,
  taskReviewCoverage,
  templateHash,
  withVerifySettings,
} from '../src/host/parity.ts'
import {
  createRun,
  incrementTurnBlocks,
  setRunStatus,
  settleStep,
  type WorkflowRun,
} from '../src/host/runs.ts'
import { contributedIntake } from './intake-definition.ts'

/**
 * The retirement load gate, the owned close/archive decisions, and the verify
 * settings contract. These are the pure functions the runtime calls; the
 * host-wiring suite exercises the same path end to end.
 */

function shipped(id: string): Definition {
  if (id === 'change-intake') return contributedIntake()
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

  it('keeps the rollback switch inside the bounded 300-character diagnostic', () => {
    const missing = parityLoadIssues(
      loadShippedDefinitions(),
      undefined,
      `${'very-long-install-prefix/'.repeat(20)}packages/plugin-workflows/assets/parity/retire-legacy-gates.json`,
      'the report file does not exist',
    )
    for (const issue of missing.issues) {
      expect(issue.slice(0, 300)).toMatch(
        /checkpoint\.automation: true|delegation\.gates\.workflowOwned: true|verification-gate/u,
      )
    }
  })

  it('refuses verify only when the settings matrix is invalid or verify is bound', () => {
    const definitions = loadShippedDefinitions()
    const report = readParityReport().report
    if (report === undefined) throw new Error('the tracked parity report is missing')
    const invalid = {
      ...report,
      settings: {
        'verify.commands': { type: 'number', cases: [1, 2] },
        'verify.maxBlocks': { type: 'string', cases: [129.5] },
      },
    }
    expect([
      ...parityLoadIssues(definitions, invalid, '/plugins/parity.json', undefined).refused,
    ]).toContain('verify')

    const deferred = definitions.map((entry) =>
      entry.id === 'verify'
        ? { ...entry, settings: { ...entry.settings, gateOwnership: 'defer' as const } }
        : entry,
    )
    const deferredResult = parityLoadIssues(
      deferred,
      { ...report, settings: {} as never },
      '/plugins/parity.json',
      undefined,
    )
    expect([...deferredResult.refused]).not.toContain('verify')
  })

  it('binds the retirement ids by name even when their legacy metadata is removed', () => {
    const definitions = loadShippedDefinitions().map((entry) =>
      entry.id === 'verify'
        ? { ...entry, settings: { ...entry.settings, legacy: undefined } }
        : entry,
    )
    const missing = parityLoadIssues(definitions, undefined, '/plugins/parity.json', 'missing')
    expect([...missing.refused]).toContain('verify')
    const report = readParityReport().report
    if (report === undefined) throw new Error('the tracked parity report is missing')
    const stale = parityLoadIssues(
      definitions,
      { ...report, templates: { ...report.templates, verify: 'sha256-wrong' } },
      '/plugins/parity.json',
      undefined,
    )
    expect([...stale.refused]).toContain('verify')
    expect(stale.issues.join('\n')).toContain('enable the verification-gate row')
  })

  it('refuses an own definition whose parity gate is failed, missing, or mismatched', () => {
    const definitions = loadShippedDefinitions()
    const report = readParityReport().report
    if (report === undefined) throw new Error('the tracked parity report is missing')
    const variants = [
      {
        ...report,
        gates: {
          ...report.gates,
          checkpoint: { cases: 1, mismatches: 0, status: 'fail' as const },
        },
      },
      {
        ...report,
        gates: Object.fromEntries(
          Object.entries(report.gates).filter(([key]) => key !== 'verification'),
        ),
      },
      {
        ...report,
        gates: {
          ...report.gates,
          'task-review': { cases: 1, mismatches: 1, status: 'fail' as const },
        },
      },
    ]
    const refused = variants.map(
      (variant) =>
        parityLoadIssues(definitions, variant, '/plugins/parity.json', undefined).refused,
    )
    expect(refused.map((entry) => [...entry])).toEqual([
      expect.arrayContaining(['retro']),
      expect.arrayContaining(['verify']),
      expect.arrayContaining(['task-review']),
    ])
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
          definition: { id: 'change-intake', name: 'Change intake', version: 1 },
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

    // The refusal names both the blocking review run and the missing task;
    // the coverage-only branch names the related run id.
    const review = { ...runFor(shipped('task-review'), false), id: 'run-review' }
    const blocked = evaluateArchiveGate({
      ...base,
      runs: [...base.runs, review],
      taskReview: { ok: false, text: 'checked task "1.1 Task" has no portable PASS' },
    })
    expect(blocked.kind).toBe('deny')
    expect(blocked.reason).toContain('run-review')
    expect(blocked.reason).toContain('1.1 Task')
    const completedReview = { ...review, status: 'completed' as const }
    const coverageOnly = evaluateArchiveGate({
      ...base,
      runs: [...base.runs, completedReview],
      taskReview: { ok: false, text: 'checked task "1.1 Task" has no portable PASS' },
    })
    expect(coverageOnly.kind).toBe('deny')
    expect(coverageOnly.reason).toContain('run-review')
    expect(coverageOnly.reason).toContain('1.1 Task')
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
    expect(workerOwned).toContain('worker_start')
    expect(workerOwned).toContain('user_decision')
  })

  it('prefers the unredacted checkpoint arguments and treats resource scopes exactly', () => {
    const record = {
      outcome: 'continue' as const,
      lanes: [],
      bottleneck: {
        id: 'guard',
        owner: 'lead',
        action: 'lead_action' as const,
        blockingLanes: ['edit'],
        targets: ['[workspace]\\src'],
      },
    }
    expect(
      checkpointCloseIssue({
        record,
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [
          {
            toolName: 'write',
            arguments: { file_path: 'src/app.ts' },
            ok: true,
            at: 300,
          },
          {
            toolName: 'work_checkpoint',
            arguments: { bottleneck: { targets: ['src'] }, lanes: [] },
            ok: true,
            at: 100,
          },
        ],
        bottleneckAge: 2,
        checkpointAt: 100,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
        workspace: '/workspace',
        checkpointArguments: { bottleneck: { targets: ['src'] }, lanes: [] },
      }),
    ).toBeUndefined()

    const lanes = [
      { id: 'a', owner: 'lane-a', scope: ['.'], state: 'running' },
      { id: 'b', owner: 'lane-b', scope: ['resource:database'], state: 'running' },
    ]
    expect(
      checkpointCloseIssue({
        record: { outcome: 'continue', lanes, bottleneck: undefined },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
        workspace: '/workspace',
      }),
    ).toContain('parallel runnable lanes')
    expect(
      checkpointCloseIssue({
        record: {
          outcome: 'continue',
          lanes: [
            { id: 'a', owner: 'lane-a', scope: ['resource:DB'], state: 'running' },
            { id: 'b', owner: 'lane-b', scope: ['resource:db'], state: 'running' },
          ],
          bottleneck: undefined,
        },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
        workspace: '/workspace',
      }),
    ).toContain('parallel runnable lanes')

    // Disjoint external scopes are parallel; a parent scope contains src.
    expect(
      checkpointCloseIssue({
        record: {
          outcome: 'continue',
          lanes: [
            { id: 'a', owner: 'lane-a', scope: ['../one'], state: 'running' },
            { id: 'b', owner: 'lane-b', scope: ['../two'], state: 'running' },
          ],
          bottleneck: undefined,
        },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
        workspace: '/repo/app',
      }),
    ).toContain('parallel runnable lanes')
    expect(
      checkpointCloseIssue({
        record: {
          outcome: 'continue',
          lanes: [
            { id: 'a', owner: 'lane-a', scope: ['..'], state: 'running' },
            { id: 'b', owner: 'lane-b', scope: ['src'], state: 'running' },
          ],
          bottleneck: undefined,
        },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
        workspace: '/repo/app',
      }),
    ).toContain('without a bottleneck')

    // Padded identifiers are normalized like the producer's validator.
    expect(
      checkpointCloseIssue({
        record: {
          outcome: 'continue',
          lanes: [
            { id: 'a', owner: 'lane-a', scope: ['src'], state: 'running' },
            {
              id: 'b',
              owner: 'lane-b',
              scope: ['src2'],
              state: 'running',
              blockedBy: [' done '],
            },
          ],
          bottleneck: {
            id: ' guard ',
            owner: ' lead ',
            action: 'lead_action',
            blockingLanes: ['edit'],
            targets: [' src '],
          },
        },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [
          { toolName: 'subagent', arguments: { checkpoint: 'checkpoint-1-aaaaaaaa' }, ok: true },
          { toolName: 'write', arguments: { file_path: 'src/app.ts' }, ok: true, at: 300 },
          {
            toolName: 'work_checkpoint',
            arguments: {
              lanes: [
                { id: 'a', owner: 'lane-a', scope: ['src'], state: 'running' },
                {
                  id: 'b',
                  owner: 'lane-b',
                  scope: ['src2'],
                  state: 'running',
                  blockedBy: [' done '],
                },
              ],
              bottleneck: {
                id: ' guard ',
                owner: ' lead ',
                action: 'lead_action',
                blockingLanes: ['edit'],
                targets: [' src '],
              },
            },
            ok: true,
            at: 100,
          },
        ],
        bottleneckAge: 2,
        checkpointAt: 100,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
        workspace: '/workspace',
      }),
    ).toBeUndefined()
  })

  it('requires the remedy after the checkpoint and matches targets by path component', () => {
    const record = {
      outcome: 'continue' as const,
      lanes: [],
      bottleneck: {
        id: 'guard',
        owner: 'lead',
        action: 'lead_action' as const,
        blockingLanes: ['edit'],
        targets: ['src/app.ts'],
      },
    }
    const before = checkpointCloseIssue({
      record,
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        {
          toolName: 'write',
          arguments: { file_path: 'src/app.ts' },
          ok: true,
          at: 100,
        },
      ],
      bottleneckAge: 2,
      checkpointAt: 200,
      fresh: true,
      workerVisible: true,
      enforceParallel: true,
    })
    expect(before).toContain('execute the bottleneck remedy')
    const after = checkpointCloseIssue({
      record,
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        {
          toolName: 'write',
          arguments: { file_path: './src/app.ts' },
          ok: true,
          at: 300,
        },
      ],
      bottleneckAge: 2,
      checkpointAt: 200,
      fresh: true,
      workerVisible: true,
      enforceParallel: true,
    })
    expect(after).toBeUndefined()
    const external = checkpointCloseIssue({
      record: {
        outcome: 'continue',
        lanes: [],
        bottleneck: {
          id: 'guard',
          owner: 'lead',
          action: 'lead_action',
          blockingLanes: ['edit'],
          targets: ['../shared'],
        },
      },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        { toolName: 'write', arguments: { file_path: '../shared/helper.ts' }, ok: true, at: 300 },
      ],
      bottleneckAge: 2,
      checkpointAt: 100,
      fresh: true,
      workerVisible: false,
      enforceParallel: false,
      workspace: '/repo/app',
    })
    expect(external).toBeUndefined()
    const rootTarget = checkpointCloseIssue({
      record: {
        outcome: 'continue',
        lanes: [],
        bottleneck: {
          id: 'guard',
          owner: 'lead',
          action: 'lead_action',
          blockingLanes: ['edit'],
          targets: ['/'],
        },
      },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        { toolName: 'write', arguments: { file_path: 'src/app.ts' }, ok: true, at: 300 },
      ],
      bottleneckAge: 2,
      checkpointAt: 100,
      fresh: true,
      workerVisible: true,
      enforceParallel: true,
      workspace: '/repo/app',
    })
    expect(rootTarget).toBeUndefined()
    const sibling = checkpointCloseIssue({
      record,
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        {
          toolName: 'write',
          arguments: { file_path: 'xsrc/app.ts' },
          ok: true,
          at: 300,
        },
      ],
      bottleneckAge: 2,
      checkpointAt: 200,
      fresh: true,
      workerVisible: true,
      enforceParallel: true,
    })
    expect(sibling).toContain('execute the bottleneck remedy')
  })

  it('accepts a started delegate as a worker remedy and rejects a cached answer', () => {
    const record = {
      outcome: 'continue' as const,
      lanes: [],
      bottleneck: {
        id: 'guard',
        owner: 'lane',
        action: 'worker_start' as const,
        blockingLanes: ['edit'],
      },
    }
    const args = { checkpoint: 'checkpoint-1-aaaaaaaa', bottleneck: 'guard' }
    const started = checkpointCloseIssue({
      record,
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        {
          toolName: 'delegate',
          arguments: args,
          ok: true,
          at: 300,
          detail: 'rule "task-review" review started',
        },
      ],
      bottleneckAge: 2,
      fresh: true,
      workerVisible: true,
      enforceParallel: true,
    })
    expect(started).toBeUndefined()
    const cached = checkpointCloseIssue({
      record,
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        {
          toolName: 'delegate',
          arguments: args,
          ok: true,
          at: 300,
          detail: 'rule "task-review" PASS (reused record abc)',
        },
      ],
      bottleneckAge: 2,
      fresh: true,
      workerVisible: true,
      enforceParallel: true,
    })
    expect(cached).toContain('execute the bottleneck remedy')
  })

  it('fails open to a targeted lead action when no worker tool is visible', () => {
    const record = {
      outcome: 'continue' as const,
      lanes: [],
      bottleneck: {
        id: 'guard',
        owner: 'lane',
        action: 'lead_action' as const,
        blockingLanes: ['edit'],
        targets: ['src/app.ts'],
      },
    }
    expect(
      checkpointCloseIssue({
        record,
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [{ toolName: 'write', arguments: { file_path: 'src/app.ts' }, ok: true }],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: false,
        enforceParallel: true,
      }),
    ).toBeUndefined()
    expect(
      checkpointCloseIssue({
        record,
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
      }),
    ).toContain('worker_start')
  })

  it('requires a tagged worker for disjoint parallel lanes and allows the serial forms', () => {
    const lanes = [
      { id: 'a', owner: 'lane-a', scope: ['src'], state: 'running' },
      { id: 'b', owner: 'lane-b', scope: ['src2'], state: 'running' },
    ]
    const parallel = checkpointCloseIssue({
      record: { outcome: 'continue', lanes, bottleneck: undefined },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [],
      bottleneckAge: 2,
      fresh: true,
      workerVisible: true,
      enforceParallel: true,
    })
    expect(parallel).toContain('parallel runnable lanes')
    expect(
      checkpointCloseIssue({
        record: {
          outcome: 'continue',
          lanes,
          bottleneck: {
            id: 'guard',
            owner: 'lead',
            action: 'user_decision',
            blockingLanes: ['edit'],
          },
        },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [
          { toolName: 'subagent', arguments: { checkpoint: 'checkpoint-1-aaaaaaaa' }, ok: true },
          { toolName: 'ask_user_question', arguments: {}, ok: true },
        ],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
      }),
    ).toBeUndefined()
    const sameOwner = lanes.map((lane) => ({ ...lane, owner: 'lead' }))
    expect(
      checkpointCloseIssue({
        record: { outcome: 'continue', lanes: sameOwner, bottleneck: undefined },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
      }),
    ).toContain('without a bottleneck')
    expect(
      checkpointCloseIssue({
        record: {
          outcome: 'continue',
          lanes: [
            { id: 'a', owner: 'lane-a', scope: ['src'], state: 'running' },
            { id: 'b', owner: 'lane-b', scope: ['src/**'], state: 'running' },
          ],
          bottleneck: undefined,
        },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
      }),
    ).toContain('without a bottleneck')
  })

  it('applies freshness and the user-decision age escape', () => {
    const record = {
      outcome: 'continue' as const,
      lanes: [],
      bottleneck: {
        id: 'guard',
        owner: 'lead',
        action: 'lead_action' as const,
        blockingLanes: ['edit'],
        targets: ['src/app.ts'],
      },
      bottleneckAge: 2,
    }
    expect(
      checkpointCloseIssue({
        record: { ...record, bottleneckAge: undefined },
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [{ toolName: 'write', arguments: { file_path: 'src/app.ts' }, ok: true }],
        bottleneckAge: 2,
        fresh: false,
        workerVisible: true,
        enforceParallel: true,
      }),
    ).toContain('older than the configured step interval')
    const userDecision = {
      ...record,
      bottleneck: { ...record.bottleneck, action: 'user_decision' as const, targets: [] },
    }
    expect(
      checkpointCloseIssue({
        record: userDecision,
        checkpointId: 'checkpoint-1-aaaaaaaa',
        observations: [{ toolName: 'ask_user_question', arguments: {}, ok: true }],
        bottleneckAge: 2,
        fresh: true,
        workerVisible: true,
        enforceParallel: true,
      }),
    ).toBeUndefined()
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

  it('bounds the displayed command list so a refusal is still steered', async () => {
    const definition = shipped('verify')
    const run = createRun({
      definition: 'verify',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace: '/workspace',
      context: {},
      steps: ['check'],
      now: 1_000,
    })
    const commands = Array.from({ length: 30 }, (_, index) => 'check-' + String(index))
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: { steer: () => undefined },
      evidenceContext: { workspace: '/workspace', values: {}, checkCommands: commands },
      turn: 1,
      maxBlocks: 129,
      installedLegacy: new Set(),
      enabledLegacy: new Set(),
    })
    expect(outcome.kind).toBe('refuse')
    if (outcome.kind === 'refuse') {
      expect(outcome.text.length).toBeLessThan(2000)
      expect(outcome.text).toContain('more')
    }
    expect(commands.length).toBe(30)
    const check = await verifyEvidence(
      { kind: 'check', source: 'verify-settings' },
      {
        workspace: '/workspace',
        values: {},
        checkCommands: commands,
        lastWriteAt: 100,
        shellResults: [],
      },
    )
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.failure.detail.length).toBeLessThan(600)
  })

  it('applies a profile maxBlocks above 128 to the close cap', () => {
    const definition = withVerifySettings(shipped('verify'), {
      commands: ['pnpm check'],
      maxBlocks: 129,
    })
    const blocked = (blocks: number) => {
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
      return run
    }
    const context = {
      workspace: '/workspace',
      values: {},
      checkCommands: ['pnpm check'],
      lastWriteAt: 100,
      shellResults: [],
    }
    const below = evaluateTurnClose({
      run: blocked(128),
      definition,
      agent: { steer: () => undefined },
      evidenceContext: context,
      turn: 1,
      maxBlocks: definition.settings.maxBlocks,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
    })
    expect(below.kind).toBe('refuse')
    const atCap = evaluateTurnClose({
      run: blocked(129),
      definition,
      agent: { steer: () => undefined },
      evidenceContext: context,
      turn: 1,
      maxBlocks: definition.settings.maxBlocks,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
    })
    expect(atCap.kind).toBe('violation')
  })

  it('keeps the checkpoint refusal capped across repeated closes', () => {
    const definition = shipped('retro')
    let run = createRun({
      definition: 'retro',
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace: '/workspace',
      context: { checkpoint: 'checkpoint-1-aaaaaaaa' },
      steps: ['checkpoint', 'verify'],
      now: 1_000,
    })
    const kinds: string[] = []
    for (let close = 0; close < 5; close += 1) {
      const outcome = evaluateTurnClose({
        run,
        definition,
        agent: { steer: () => undefined },
        evidenceContext: { workspace: '/workspace', values: {} },
        turn: 1,
        maxBlocks: 3,
        installedLegacy: new Set(),
        enabledLegacy: enabledOff(),
        checkpointIssue: { text: 'execute the bottleneck remedy' },
      })
      kinds.push(outcome.kind)
      run = outcome.run
    }
    expect(kinds).toEqual(['refuse', 'refuse', 'refuse', 'violation', 'violation'])
    // A later turn starts a fresh budget: the capped turn does not suppress it.
    const nextTurn = evaluateTurnClose({
      run,
      definition,
      agent: { steer: () => undefined },
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 2,
      maxBlocks: 3,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
      checkpointIssue: { text: 'execute the bottleneck remedy' },
    })
    expect(nextTurn.kind).toBe('refuse')
  })

  it('bounds a very long written path in the refusal', () => {
    const definition = shipped('verify')
    const longPath = `${'nested/'.repeat(250)}file.ts`
    const outcome = evaluateTurnClose({
      run: createRun({
        definition: 'verify',
        trigger: 'turn.stopping',
        session: 'session-1',
        workspace: '/workspace',
        context: {},
        steps: ['check'],
        now: 1_000,
      }),
      definition,
      agent: { steer: () => undefined },
      evidenceContext: {
        workspace: '/workspace',
        values: {},
        checkCommands: ['pnpm check'],
        lastWriteAt: 100,
        lastWritePath: longPath,
        shellResults: [],
      },
      turn: 1,
      maxBlocks: 129,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
    })
    expect(outcome.kind).toBe('refuse')
    if (outcome.kind === 'refuse') expect(outcome.text.length).toBeLessThan(2500)
  })

  it('prefers the persisted successful check over buffered failures', async () => {
    const check = await verifyEvidence(
      { kind: 'check', source: 'verify-settings' },
      {
        workspace: '/workspace',
        values: {},
        checkCommands: ['pnpm check'],
        lastWriteAt: 100,
        lastCheckAt: 120,
        shellResults: [
          {
            callId: 'c1',
            command: 'pnpm check',
            at: 130,
            exitCode: 1,
            foreground: true,
            ok: false,
          },
        ],
      },
    )
    expect(check.ok).toBe(true)
  })

  it('resolves a bare root remedy target against the workspace drive', () => {
    const workspace =
      process.platform === 'win32'
        ? (process.env.WINDIR?.slice(0, 2) ?? 'C:') + '/repo/app'
        : '/repo/app'
    const issue = checkpointCloseIssue({
      record: {
        outcome: 'continue',
        lanes: [],
        bottleneck: {
          id: 'guard',
          owner: 'lead',
          action: 'lead_action',
          blockingLanes: ['edit'],
          targets: ['/'],
        },
      },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        { toolName: 'write', arguments: { file_path: 'src/app.ts' }, ok: true, at: 300 },
      ],
      bottleneckAge: 2,
      checkpointAt: 100,
      fresh: true,
      workerVisible: true,
      enforceParallel: true,
      workspace,
    })
    expect(issue).toBeUndefined()
  })

  it('uses the latest attempted checkpoint outcome over a stale record', () => {
    const issue = checkpointCloseIssue({
      record: {
        outcome: 'done',
        lanes: [],
        bottleneck: {
          id: 'guard',
          owner: 'worker',
          action: 'worker_start',
          blockingLanes: ['edit'],
          targets: ['.'],
        },
      },
      checkpointArguments: { outcome: 'continue' },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [],
      bottleneckAge: 2,
      checkpointAt: 100,
      fresh: true,
      workerVisible: true,
      enforceParallel: false,
      workspace: '/repo/app',
    })
    expect(issue).toContain('execute the bottleneck remedy')
  })

  it('does not treat a call that started before the checkpoint as later', () => {
    const issue = checkpointCloseIssue({
      record: {
        outcome: 'continue',
        lanes: [],
        bottleneck: {
          id: 'guard',
          owner: 'worker',
          action: 'worker_start',
          blockingLanes: ['edit'],
          targets: ['.'],
        },
      },
      checkpointId: 'checkpoint-1-aaaaaaaa',
      observations: [
        { toolName: 'spawn_teammate', arguments: {}, ok: true, seq: 3, detail: 'started' },
      ],
      checkpointSeq: 5,
      bottleneckAge: 2,
      checkpointAt: 100,
      fresh: true,
      workerVisible: true,
      enforceParallel: false,
      workspace: '/repo/app',
    })
    expect(issue).toContain('execute the bottleneck remedy')
  })

  it('matches the legacy rtk wrapper contract', () => {
    expect(commandMatches('pnpm check', 'pnpm check')).toBe(true)
    expect(commandMatches('pnpm check', 'rtk pnpm check')).toBe(true)
    expect(commandMatches('rtk pnpm check', 'rtk rtk pnpm check')).toBe(true)
    expect(commandMatches('rtk pnpm check', 'pnpm check')).toBe(false)
  })

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
          findings:
            verdict === 'FINDINGS'
              ? [{ severity: 'P1', title: 'finding', evidence: 'e', fix: 'f' }]
              : [],
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

  it('rejects ERROR through the shipped await-review when PASS is the only verdict', async () => {
    const taskId = '0123456789abcdef'
    const workspace = await workspaceWithRecords({ [taskId]: 'ERROR' })
    const step = shipped('task-review').steps.find((entry) => entry.id === 'await-review')
    const evidence = {
      ...(step?.evidence as unknown as Record<string, unknown>),
      verdicts: ['PASS'],
    }
    const check = await verifyEvidence(evidence as never, {
      workspace,
      values: { name: 'auth', taskId },
    })
    expect(check.ok).toBe(false)
    await rm(workspace, { recursive: true, force: true })
  })

  it('keeps the run open at complete-review until every checked task is approved', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'workflows-retire-'))
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Foreign\n- [ ] 1.2 Later\n', 'utf8')
    const context = { workspace, values: { name: 'auth' } }
    const intermediate = await verifyEvidence(
      { kind: 'check', source: 'task-review-coverage' },
      context,
    )
    expect(intermediate.ok).toBe(true)
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Foreign\n', 'utf8')
    const missing = await verifyEvidence({ kind: 'check', source: 'task-review-coverage' }, context)
    expect(missing.ok).toBe(false)
    const id = (await import('../src/host/tasks.ts')).taskIdOf('Foreign')
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
    expect(
      (await verifyEvidence({ kind: 'check', source: 'task-review-coverage' }, context)).ok,
    ).toBe(true)
    await rm(workspace, { recursive: true, force: true })
  })

  it('rejects a discarded or queue-fault ERROR record and a malformed approval', async () => {
    const taskId = '0123456789abcdef'
    const awaitEvidence = shipped('task-review').steps.find(
      (step) => step.id === 'await-review',
    )?.evidence
    for (const extra of [
      { failureClass: 'reviewed-inputs-changed' },
      { error: 'queue-internal-error: failure' },
      { failureClass: 42 },
      { failureClass: 'not-a-valid-failure-class' },
      { worktreeDigest: 42 },
      { error: { message: 'bad' } },
    ]) {
      const workspace = await workspaceWithRecords({ [taskId]: 'ERROR' })
      const recordPath = join(
        workspace,
        '.dsh',
        'delegation',
        'task-review',
        'auth',
        'tasks',
        `${taskId}.json`,
      )
      const record = JSON.parse(await readFile(recordPath, 'utf8')) as Record<string, unknown>
      await writeFile(recordPath, JSON.stringify({ ...record, ...extra }), 'utf8')
      const check = await verifyEvidence(awaitEvidence as never, {
        workspace,
        values: { name: 'auth', taskId },
      })
      expect(check.ok).toBe(false)
      await rm(workspace, { recursive: true, force: true })
    }

    // A four-field or findings-bearing PASS cannot approve coverage.
    const workspace = await mkdtemp(join(tmpdir(), 'workflows-retire-'))
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Foreign\n', 'utf8')
    const id = (await import('../src/host/tasks.ts')).taskIdOf('Foreign')
    await writeFile(
      join(changeDir, 'reviews', `${id}.json`),
      JSON.stringify({ rule: 'task-review', change: 'auth', scope: 'task', taskId: id }),
      'utf8',
    )
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
    await writeFile(
      join(changeDir, 'reviews', `${id}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        taskId: id,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [{ severity: 'P1', title: 'bad', evidence: 'x', fix: 'y' }],
        target: { provider: 'codex-subagent' },
        time: '2026-11-08T00:00:00.000Z',
      }),
      'utf8',
    )
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
    for (const extra of [{ session: 's' }, { runId: 'r' }, { worktreeDigest: 'invalid' }]) {
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
          ...extra,
        }),
        'utf8',
      )
      expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
      expect(taskReviewCompletion(workspace, 'auth')?.ok).toBe(false)
    }
    await rm(workspace, { recursive: true, force: true })
  })

  it('defers completion coverage for an intermediate close and steers the final one', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'workflows-retire-'))
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Foreign\n- [ ] 1.2 Later\n', 'utf8')
    expect(
      (
        await verifyEvidence(
          { kind: 'check', source: 'task-review-coverage' },
          { workspace, values: { name: 'auth' } },
        )
      ).ok,
    ).toBe(true)
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Foreign\n', 'utf8')
    expect(
      (
        await verifyEvidence(
          { kind: 'check', source: 'task-review-coverage' },
          { workspace, values: { name: 'auth' } },
        )
      ).ok,
    ).toBe(false)
    await rm(workspace, { recursive: true, force: true })

    const definition = shipped('task-review')
    let run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace: '/workspace',
      context: { name: 'auth', taskId: '0123456789abcdef' },
      steps: definition.steps.map((step) => step.id),
      now: 1_000,
    })
    run = settleStep(run, 'start-review', 'done', { at: 1_001, evidence: { kind: 'declaration' } })
    run = settleStep(run, 'await-review', 'done', { at: 1_002, evidence: { kind: 'declaration' } })
    const steers: string[] = []
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: { steer: (text: string) => steers.push(text) },
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 3,
      maxBlocks: 3,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
      completion: { ok: false, text: 'checked task "1.1 Foreign" has no portable PASS' },
    })
    expect(outcome.kind).toBe('refuse')
    expect(steers).toHaveLength(1)
    expect(steers[0]).toContain('coverage')
    expect(steers[0]).toContain('1.1 Foreign')
    expect(steers[0]).toContain('has no portable PASS')
  })

  it('applies the reviewer binding to intermediate records and refuses an invalid marker', async () => {
    const taskId = '0123456789abcdef'
    const awaitEvidence = shipped('task-review').steps.find(
      (step) => step.id === 'await-review',
    )?.evidence
    const workspace = await workspaceWithRecords({ [taskId]: 'PASS' })
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Pass task\n', 'utf8')
    const portableId = (await import('../src/host/tasks.ts')).taskIdOf('Pass task')
    await writeFile(
      join(changeDir, 'reviews', `${portableId}.json`),
      JSON.stringify({
        rule: 'task-review',
        change: 'auth',
        scope: 'task',
        taskId: portableId,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-08T00:00:00.000Z',
      }),
      'utf8',
    )
    const marker = join(workspace, 'openspec', 'review-approval.json')
    await writeFile(
      marker,
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(true)
    expect(
      (
        await verifyEvidence(awaitEvidence as never, {
          workspace,
          values: { name: 'auth', taskId },
        })
      ).ok,
    ).toBe(true)
    await writeFile(
      marker,
      JSON.stringify({
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        reviewerProvider: 'other-provider',
      }),
      'utf8',
    )
    expect(
      (
        await verifyEvidence(awaitEvidence as never, {
          workspace,
          values: { name: 'auth', taskId },
        })
      ).ok,
    ).toBe(false)
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
    await writeFile(marker, '{ not json', 'utf8')
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
    await writeFile(
      marker,
      JSON.stringify({
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        reviewerProvider: 42,
      }),
      'utf8',
    )
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
    for (const malformed of [
      { version: 1, archiveGate: true, taskRule: 'task-review', reviewerModle: 'x' },
      { version: 1, archiveGate: true, taskRule: 'task-review', grandfathered: 42 },
      { version: 1, archiveGate: true, taskRule: 'task-review', cutoff: 42 },
      { version: 1, archiveGate: true, taskRule: 'task-review', cutoff: '/tmp/release' },
      { version: 1, archiveGate: true, taskRule: 'task-review', grandfathered: { archive: 'old' } },
      {
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        grandfathered: { '../bad': 'old' },
      },
      {
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        reviewerModel: '/tmp/reviewer',
      },
    ]) {
      await writeFile(marker, JSON.stringify(malformed), 'utf8')
      expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
      expect(
        (
          await verifyEvidence(awaitEvidence as never, {
            workspace,
            values: { name: 'auth', taskId },
          })
        ).ok,
      ).toBe(false)
    }
    await rm(workspace, { recursive: true, force: true })
  })

  it('rejects an unnumbered checked line instead of skipping it', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'workflows-retire-'))
    const changeDir = join(workspace, 'openspec', 'changes', 'auth')
    await mkdir(join(changeDir, 'reviews'), { recursive: true })
    await writeFile(join(changeDir, 'tasks.md'), '- [x] 1.1 Task\n- [x] Foreign task\n', 'utf8')
    const id = (await import('../src/host/tasks.ts')).taskIdOf('Task')
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
    for (const malformed of [
      '- [x] 1.1 Task\n* [x] Foreign task\n',
      '- [x] 1.1 Task\n+ [x] 1.2 Foreign task\n',
      '- [x] 1.1 Task\n- [x]Foreign task\n',
    ]) {
      const workspace = await mkdtemp(join(tmpdir(), 'workflows-retire-'))
      const changeDir = join(workspace, 'openspec', 'changes', 'auth')
      await mkdir(join(changeDir, 'reviews'), { recursive: true })
      await writeFile(join(changeDir, 'tasks.md'), malformed, 'utf8')
      const id = (await import('../src/host/tasks.ts')).taskIdOf('Task')
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
      expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
      expect(taskReviewCompletion(workspace, 'auth')?.ok).toBe(false)
      await rm(workspace, { recursive: true, force: true })
    }
  })

  it('refuses a close while a failed dispatch step is unresolved', () => {
    const definition = shipped('task-review')
    let run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace: '/workspace',
      context: { name: 'auth', taskId: '0123456789abcdef' },
      steps: definition.steps.map((step) => step.id),
      now: 1_000,
    })
    run = settleStep(run, 'start-review', 'failed', { at: 1_001, reason: 'delegate failed' })
    const steers: string[] = []
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: { steer: (text: string) => steers.push(text) },
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 1,
      maxBlocks: 3,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
    })
    expect(outcome.kind).not.toBe('allow')
    expect(steers).toHaveLength(1)
    expect(steers[0]).toContain('failed dispatch')
    expect(steers[0]).toContain('workflows resume')
  })

  it('allows a close for a terminal run whose dispatch attempts are exhausted', () => {
    const definition = shipped('task-review')
    let run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace: '/workspace',
      context: { name: 'auth', taskId: '0123456789abcdef' },
      steps: definition.steps.map((step) => step.id),
      now: 1_000,
    })
    run = settleStep(run, 'start-review', 'failed', {
      at: 1_001,
      reason: 'the review dispatch failed 3 time(s); resume or cancel the run',
      attempts: 3,
    })
    run = setRunStatus(run, 'failed', 1_002, 'the review dispatch failed 3 time(s)')
    const steers: string[] = []
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: { steer: (text: string) => steers.push(text) },
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 1,
      maxBlocks: 30,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
    })
    expect(outcome.kind).toBe('allow')
    expect(steers).toHaveLength(0)
  })

  it('still refuses a terminal run with incomplete completion coverage', () => {
    const definition = shipped('task-review')
    let run = createRun({
      definition: 'task-review',
      trigger: 'fs.change',
      session: 'session-1',
      workspace: '/workspace',
      context: { name: 'auth', taskId: '0123456789abcdef' },
      steps: definition.steps.map((step) => step.id),
      now: 1_000,
    })
    run = settleStep(run, 'start-review', 'failed', {
      at: 1_001,
      reason: 'the review dispatch failed 3 time(s)',
      attempts: 3,
    })
    run = setRunStatus(run, 'failed', 1_002, 'the review dispatch failed 3 time(s)')
    const outcome = evaluateTurnClose({
      run,
      definition,
      agent: { steer: () => undefined },
      evidenceContext: { workspace: '/workspace', values: {} },
      turn: 1,
      maxBlocks: 30,
      installedLegacy: new Set(),
      enabledLegacy: enabledOff(),
      completion: { ok: false, text: 'the completion coverage is incomplete' },
    })
    expect(outcome.kind).not.toBe('allow')
    if (outcome.kind === 'refuse') {
      expect(outcome.text).toContain('completion coverage')
    }
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

    // The marker's reviewer binding still applies: another reviewer's PASS
    // cannot approve the checked task.
    await writeFile(
      join(workspace, 'openspec', 'review-approval.json'),
      JSON.stringify({
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        reviewerProvider: 'other-provider',
      }),
      'utf8',
    )
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(false)
    await writeFile(
      join(workspace, 'openspec', 'review-approval.json'),
      JSON.stringify({ version: 1, archiveGate: true, taskRule: 'task-review' }),
      'utf8',
    )
    expect(taskReviewCoverage(workspace, 'auth').ok).toBe(true)
    expect(taskReviewCompletion(workspace, 'missing-change')).toBeUndefined()
    await rm(workspace, { recursive: true, force: true })
  })
})
