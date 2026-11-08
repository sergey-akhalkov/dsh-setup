import { describe, expect, it } from 'vitest'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import { collectEvidencePaths } from '../src/host/evidence.ts'
import {
  adaptUserQuestions,
  evaluateJsonLogic,
  type HumanQuestionService,
  OwnedCalls,
  requestMainStep,
  runBranchStep,
  runHumanStep,
  runLoopStep,
  runSubagentStep,
  runToolStep,
  type SubagentRunner,
  type SubagentRunResult,
  settleMainStep,
  type ToolRunner,
  validateResultSchema,
} from '../src/host/executors.ts'
import { createRun, type WorkflowRun } from '../src/host/runs.ts'
import type { SteerTarget } from '../src/host/steer.ts'

const definition: Definition = validateDefinition({
  v: 1,
  id: 'demo',
  name: 'Demo',
  version: 1,
  trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
  settings: {
    allowModelStart: false,
    risk: 'low',
    gateOwnership: 'own',
    maxBlocks: 3,
    allowIntent: false,
  },
  steps: [
    {
      id: 'requirements',
      title: 'Business requirements',
      executor: 'main',
      prompt: 'Capture users, problem, and acceptance in the draft.',
      evidence: {
        kind: 'file',
        path: '.dsh/workflows/drafts/{name}/requirements.md',
        minBytes: 200,
      },
      next: 'end',
      blockTurnClose: true,
    },
  ],
})

const evidenceContext = { workspace: '/workspace', values: { name: 'auth' } }

function freshRun(): WorkflowRun {
  return createRun({
    definition: 'demo',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth' },
    steps: ['requirements'],
    now: 1_000,
  })
}

class FakeAgent implements SteerTarget {
  readonly messages: string[] = []
  steer(message: string): void {
    this.messages.push(message)
  }
}

describe('main executor', () => {
  it('steers the root agent with the step, its evidence, and the exact checked path', () => {
    const agent = new FakeAgent()
    const result = requestMainStep({
      run: freshRun(),
      definition,
      step: definition.steps[0] as (typeof definition.steps)[number],
      agent,
      evidenceContext,
      turn: 1,
    })
    expect(result.steered).toBe(true)
    if (!result.steered) return
    const checked = collectEvidencePaths(
      definition.steps[0]?.evidence ?? { kind: 'declaration' },
      evidenceContext,
    )
    expect(checked).toEqual(['.dsh/workflows/drafts/auth/requirements.md'])
    expect(result.text).toContain('Business requirements')
    expect(result.text).toContain('Capture users, problem, and acceptance in the draft.')
    expect(result.text).toContain('.dsh/workflows/drafts/auth/requirements.md')
    expect(result.text).toContain(result.run.id)
    expect(result.text).toContain('requirements')
    expect(agent.messages).toEqual([result.text])
  })

  it('re-requests only on a later turn stop and respects the attempt bound', () => {
    const agent = new FakeAgent()
    const step = definition.steps[0] as (typeof definition.steps)[number]
    let run = freshRun()
    const first = requestMainStep({
      run,
      definition,
      step,
      agent,
      evidenceContext,
      turn: 1,
      maxAttempts: 3,
    })
    expect(first.steered).toBe(true)
    run = first.run
    const sameTurn = requestMainStep({
      run,
      definition,
      step,
      agent,
      evidenceContext,
      turn: 1,
      maxAttempts: 3,
    })
    expect(sameTurn.steered).toBe(false)
    if (!sameTurn.steered) expect(sameTurn.reason).toContain('already steered in turn 1')
    for (const turn of [2, 3]) {
      const next = requestMainStep({
        run,
        definition,
        step,
        agent,
        evidenceContext,
        turn,
        maxAttempts: 3,
      })
      expect(next.steered).toBe(true)
      run = next.run
    }
    const bound = requestMainStep({
      run,
      definition,
      step,
      agent,
      evidenceContext,
      turn: 4,
      maxAttempts: 3,
    })
    expect(bound.steered).toBe(false)
    if (!bound.steered) expect(bound.reason).toContain('3-request bound')
    expect(agent.messages).toHaveLength(3)
    expect(run.steps[0]?.attempts).toBe(3)
    expect(run.steps[0]?.state).toBe('open')
  })

  it('never settles a step from a text claim; only verified evidence does', () => {
    const run = freshRun()
    const afterClaim = settleMainStep(run, 'requirements', {
      ok: false,
      failure: { reason: 'missing-file', detail: 'the draft is missing' },
    })
    expect(afterClaim.steps[0]?.state).toBe('open')
    expect(afterClaim.steps[0]?.evidence).toBeUndefined()
    const settled = settleMainStep(run, 'requirements', {
      ok: true,
      evidence: { kind: 'file', path: '.dsh/workflows/drafts/auth/requirements.md', bytes: 400 },
    })
    expect(settled.steps[0]).toMatchObject({
      state: 'done',
      evidence: { kind: 'file', bytes: 400 },
    })
  })
})

const subagentDefinition: Definition = validateDefinition({
  v: 1,
  id: 'subagent-demo',
  name: 'Subagent demo',
  version: 1,
  trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
  settings: {
    allowModelStart: false,
    risk: 'low',
    gateOwnership: 'own',
    maxBlocks: 3,
    allowIntent: false,
  },
  steps: [
    {
      id: 'review',
      title: 'Child review',
      executor: 'subagent',
      prompt: 'Review the change {name}.',
      subagent: {
        provider: 'spawn',
        schema: {
          type: 'object',
          required: ['verdict'],
          properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] } },
          additionalProperties: false,
        },
      },
      evidence: { kind: 'file', path: '.dsh/workflows/drafts/{name}/review.json' },
      next: 'end',
    },
  ],
})

function subagentRun(): WorkflowRun {
  return createRun({
    definition: 'subagent-demo',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth' },
    steps: ['review'],
    now: 1_000,
  })
}

class FakeRunner implements SubagentRunner {
  readonly requests: Array<Record<string, unknown>> = []
  constructor(private readonly result: SubagentRunResult) {}
  async run(request: Record<string, unknown>): Promise<SubagentRunResult> {
    this.requests.push(request)
    return this.result
  }
}

describe('subagent executor', () => {
  it('starts one provider, records the child, and accepts a schema-valid result', async () => {
    const runner = new FakeRunner({
      childId: 'child-1',
      completed: true,
      result: { verdict: 'PASS' },
    })
    const run = await runSubagentStep({
      run: subagentRun(),
      definition: subagentDefinition,
      step: subagentDefinition.steps[0] as (typeof subagentDefinition.steps)[number],
      runner,
      evidenceContext,
    })
    expect(runner.requests).toHaveLength(1)
    expect(runner.requests[0]).toMatchObject({
      provider: 'spawn',
      prompt: 'Review the change auth.',
    })
    expect(runner.requests[0]?.schema).toBeDefined()
    expect(run.steps[0]).toMatchObject({
      state: 'done',
      evidence: { kind: 'subagent', callId: 'child-1', result: { verdict: 'PASS' } },
    })
  })

  it('fails the step on an invalid result and never falls back to main', async () => {
    const runner = new FakeRunner({
      childId: 'child-2',
      completed: true,
      result: { verdict: 'MAYBE' },
    })
    const run = await runSubagentStep({
      run: subagentRun(),
      definition: subagentDefinition,
      step: subagentDefinition.steps[0] as (typeof subagentDefinition.steps)[number],
      runner,
      evidenceContext,
    })
    expect(run.status).toBe('failed')
    expect(run.steps[0]?.state).toBe('failed')
    expect(run.steps[0]?.reason).toContain('does not match the schema')
    expect(run.steps[0]?.evidence).toMatchObject({ kind: 'subagent', callId: 'child-2' })
    expect(runner.requests).toHaveLength(1)
  })

  it('marks a non-completed child as failed with its bounded error', async () => {
    const runner = new FakeRunner({
      childId: 'child-3',
      completed: false,
      error: 'the child provider stopped',
    })
    const run = await runSubagentStep({
      run: subagentRun(),
      definition: subagentDefinition,
      step: subagentDefinition.steps[0] as (typeof subagentDefinition.steps)[number],
      runner,
      evidenceContext,
    })
    expect(run.status).toBe('failed')
    expect(run.steps[0]?.state).toBe('failed')
    expect(run.steps[0]?.reason).toContain('the child provider stopped')
    expect(run.steps[0]?.evidence).toMatchObject({ kind: 'subagent', callId: 'child-3' })
  })
})

const toolDefinition: Definition = validateDefinition({
  v: 1,
  id: 'tool-demo',
  name: 'Tool demo',
  version: 1,
  trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
  settings: {
    allowModelStart: false,
    risk: 'low',
    gateOwnership: 'own',
    maxBlocks: 3,
    allowIntent: false,
    allowTools: ['shell'],
  },
  steps: [
    {
      id: 'validate',
      title: 'Validate the change',
      executor: 'tool',
      tool: { name: 'shell', command: 'openspec validate {name} --strict' },
      evidence: { kind: 'check', command: 'openspec validate {name} --strict' },
      next: 'end',
    },
  ],
})

function toolRun(): WorkflowRun {
  return createRun({
    definition: 'tool-demo',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth' },
    steps: ['validate'],
    now: 1_000,
  })
}

describe('tool executor', () => {
  it('dispatches an allowlisted tool with an owned call id registered first', async () => {
    const owned = new OwnedCalls()
    const calls: Array<{
      callId: string
      name: string
      arguments: Readonly<Record<string, unknown>>
    }> = []
    const runner: ToolRunner = {
      async call(request) {
        calls.push(request)
        return owned.has(request.callId)
          ? { ok: true }
          : { ok: false, error: 'the call id was not owned before dispatch' }
      },
    }
    const run = await runToolStep({
      run: toolRun(),
      definition: toolDefinition,
      step: toolDefinition.steps[0] as (typeof toolDefinition.steps)[number],
      runner,
      owned,
      evidenceContext,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      name: 'shell',
      arguments: { command: 'openspec validate auth --strict' },
    })
    expect(owned.has(calls[0]?.callId ?? '')).toBe(true)
    expect(run.steps[0]).toMatchObject({
      state: 'done',
      evidence: { kind: 'tool', callId: calls[0]?.callId },
    })
  })

  it('refuses a tool outside the allowlist before dispatch', async () => {
    let dispatched = 0
    const runner: ToolRunner = {
      async call() {
        dispatched += 1
        return { ok: true }
      },
    }
    const run = await runToolStep({
      run: toolRun(),
      definition: toolDefinition,
      step: {
        ...toolDefinition.steps[0],
        tool: { name: 'delegate', command: 'x' },
      } as (typeof toolDefinition.steps)[number],
      runner,
      owned: new OwnedCalls(),
      evidenceContext,
    })
    expect(dispatched).toBe(0)
    expect(run.steps[0]?.state).toBe('failed')
    expect(run.steps[0]?.reason).toContain('not on the definition allowlist')
  })

  it('refuses an invalid interpolation before dispatch and records it', async () => {
    let dispatched = 0
    const runner: ToolRunner = {
      async call() {
        dispatched += 1
        return { ok: true }
      },
    }
    const run = await runToolStep({
      run: toolRun(),
      definition: toolDefinition,
      step: toolDefinition.steps[0] as (typeof toolDefinition.steps)[number],
      runner,
      owned: new OwnedCalls(),
      evidenceContext: { workspace: '/workspace', values: { name: '../auth' } },
    })
    expect(dispatched).toBe(0)
    expect(run.steps[0]?.state).toBe('failed')
    expect(run.steps[0]?.reason).toContain('could not be resolved')
  })
})

function branchDefinition(): Definition {
  return validateDefinition({
    v: 1,
    id: 'branch-demo',
    name: 'Branch demo',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: {
      allowModelStart: false,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'choose',
        title: 'Choose',
        executor: 'branch',
        branch: {
          predicate: { '==': [{ var: 'context.flag' }, true] },
          // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
          then: 'yes',
          else: 'no',
        },
      },
      {
        id: 'yes',
        title: 'Yes',
        executor: 'main',
        prompt: 'Yes.',
        evidence: { kind: 'declaration' },
        nonCritical: true,
        next: 'end',
      },
      {
        id: 'no',
        title: 'No',
        executor: 'main',
        prompt: 'No.',
        evidence: { kind: 'declaration' },
        nonCritical: true,
        next: 'end',
      },
    ],
  })
}

function branchRun(): WorkflowRun {
  return createRun({
    definition: 'branch-demo',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { flag: true },
    steps: ['choose'],
    now: 1_000,
  })
}

describe('branch executor', () => {
  it('chooses both declared paths and fails the run on invalid JSONLogic', () => {
    const definition = branchDefinition()
    const choose = definition.steps[0] as (typeof definition.steps)[number]
    const truthy = runBranchStep({ run: branchRun(), step: choose, values: { flag: true } })
    expect(truthy.next).toBe('yes')
    expect(truthy.run.steps[0]?.state).toBe('done')
    const falsy = runBranchStep({ run: branchRun(), step: choose, values: { flag: false } })
    expect(falsy.next).toBe('no')
    const invalid = runBranchStep({
      run: branchRun(),
      step: {
        ...choose,
        branch: {
          predicate: { nope: true },
          // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
          then: 'yes',
          else: 'no',
        },
      } as (typeof definition.steps)[number],
      values: { flag: true },
    })
    expect(invalid.run.status).toBe('failed')
    expect(invalid.run.steps[0]?.reason).toContain('unknown operator')
    const boolean = runBranchStep({
      run: branchRun(),
      step: {
        ...choose,
        branch: {
          predicate: { '!!': { var: 'context.flag' } },
          // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
          then: 'yes',
          else: 'no',
        },
      } as (typeof definition.steps)[number],
      values: { flag: true },
    })
    expect(boolean.next).toBe('yes')
    const nullMissing = runBranchStep({
      run: branchRun(),
      step: {
        ...choose,
        branch: {
          predicate: { '!': { missing: ['context.approval'] } },
          // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
          then: 'yes',
          else: 'no',
        },
      } as (typeof definition.steps)[number],
      values: { approval: null },
    })
    expect(nullMissing.next).toBe('no')
    const triggerMatch = runBranchStep({
      run: branchRun(),
      step: {
        ...choose,
        branch: {
          predicate: { '==': [{ var: 'trigger' }, 'turn.stopping'] },
          // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
          then: 'yes',
          else: 'no',
        },
      } as (typeof definition.steps)[number],
      values: {},
    })
    expect(triggerMatch.next).toBe('yes')
  })
})

const loopDefinition: Definition = validateDefinition({
  v: 1,
  id: 'loop-demo',
  name: 'Loop demo',
  version: 1,
  trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
  settings: {
    allowModelStart: false,
    risk: 'low',
    gateOwnership: 'own',
    maxBlocks: 3,
    allowIntent: false,
  },
  steps: [
    {
      id: 'iterate',
      title: 'Iterate',
      executor: 'loop',
      loop: {
        maxIterations: 3,
        stop: { '==': [{ var: 'iteration' }, 1] },
        next: 'end',
        cap: 'blocked',
      },
    },
  ],
})

function loopRun(): WorkflowRun {
  return createRun({
    definition: 'loop-demo',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    steps: ['iterate'],
    now: 1_000,
  })
}

describe('loop executor', () => {
  it('stops on the predicate, honors the cap, and fails invalid JSONLogic', () => {
    const step = loopDefinition.steps[0] as (typeof loopDefinition.steps)[number]
    const loop = step.loop
    if (loop === undefined) throw new Error('the loop step has no loop')
    const stopped = runLoopStep({ run: loopRun(), step, values: {} })
    expect(stopped.next).toBe('end')
    expect(stopped.run.steps[0]?.state).toBe('done')
    const capped = runLoopStep({
      run: loopRun(),
      step: {
        ...step,
        loop: { ...loop, stop: { '==': [{ var: 'iteration' }, 99] } },
      } as (typeof loopDefinition.steps)[number],
      values: {},
    })
    expect(capped.run.status).toBe('blocked')
    expect(capped.run.steps[0]?.state).toBe('blocked')
    expect(capped.run.steps[0]?.reason).toContain('3-iteration cap')
    const nonnumeric = runLoopStep({
      run: loopRun(),
      step: {
        ...step,
        loop: { ...loop, stop: { '>=': [{ var: 'context.value' }, 10] } },
      } as (typeof loopDefinition.steps)[number],
      values: { value: 'unknown' },
    })
    expect(nonnumeric.run.status).toBe('blocked')
    expect(nonnumeric.run.steps[0]?.reason).toContain('3-iteration cap')
    const triggerStop = runLoopStep({
      run: loopRun(),
      step: {
        ...step,
        loop: {
          ...loop,
          stop: { '==': [{ var: 'trigger' }, 'turn.stopping'] },
        },
      } as (typeof loopDefinition.steps)[number],
      values: {},
    })
    expect(triggerStop.next).toBe('end')
    const invalid = runLoopStep({
      run: loopRun(),
      step: {
        ...step,
        loop: { ...loop, stop: { nope: true } },
      } as (typeof loopDefinition.steps)[number],
      values: {},
    })
    expect(invalid.run.status).toBe('failed')
    expect(invalid.run.steps[0]?.reason).toContain('unknown operator')
  })
})

const humanDefinition: Definition = validateDefinition({
  v: 1,
  id: 'human-demo',
  name: 'Human demo',
  version: 1,
  trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
  settings: {
    allowModelStart: false,
    risk: 'low',
    gateOwnership: 'own',
    maxBlocks: 3,
    allowIntent: false,
  },
  steps: [
    {
      id: 'approve',
      title: 'Approve',
      executor: 'human',
      prompt: 'Approve {name}?',
      human: { timeoutAction: 'cancel' },
      evidence: { kind: 'human', answer: 'yes' },
      next: 'end',
    },
  ],
})

function humanRun(): WorkflowRun {
  return createRun({
    definition: 'human-demo',
    trigger: 'turn.stopping',
    session: 'session-1',
    workspace: '/workspace',
    context: { name: 'auth' },
    steps: ['approve'],
    now: 1_000,
  })
}

function questions(asked: { answer?: string; timedOut?: boolean }): HumanQuestionService {
  return { ask: async () => asked }
}

describe('human executor', () => {
  it('completes only on the accepted answer and records it', async () => {
    const step = humanDefinition.steps[0] as (typeof humanDefinition.steps)[number]
    const accepted = await runHumanStep({
      run: humanRun(),
      step,
      questions: questions({ answer: 'Yes' }),
      evidenceContext,
    })
    expect(accepted.steps[0]).toMatchObject({
      state: 'done',
      evidence: { kind: 'human', answer: 'Yes' },
    })
  })

  it('records a rejected non-affirmative answer without completing, and a timeout cancels', async () => {
    const step = humanDefinition.steps[0] as (typeof humanDefinition.steps)[number]
    const rejected = await runHumanStep({
      run: humanRun(),
      step,
      questions: questions({ answer: 'no' }),
      evidenceContext,
    })
    expect(rejected.steps[0]?.state).not.toBe('done')
    expect(rejected.status).toBe('blocked')
    expect(rejected.steps[0]?.reason).toContain('is not one of: yes')
    const timedOut = await runHumanStep({
      run: humanRun(),
      step,
      questions: questions({ timedOut: true }),
      evidenceContext,
    })
    expect(timedOut.status).toBe('cancelled')
    expect(timedOut.steps[0]?.reason).toContain('timed out')
  })
})

it('enforces integer, const, and bare additionalProperties schema constraints', () => {
  expect(validateResultSchema({ type: 'integer' }, 1.5)).toBeDefined()
  expect(
    validateResultSchema({ type: 'object', additionalProperties: false }, { extra: true }),
  ).toBeDefined()
  expect(validateResultSchema({ type: 'string', const: 'PASS' }, 'FAIL')).toBeDefined()
})

it('fails before dispatch when a subagent step has no schema', async () => {
  const runner = new FakeRunner({ childId: 'child-x', completed: true, result: {} })
  const step = {
    ...(subagentDefinition.steps[0] as (typeof subagentDefinition.steps)[number]),
    subagent: { provider: 'spawn' },
  } as never
  const run = await runSubagentStep({
    run: subagentRun(),
    definition: subagentDefinition,
    step,
    runner,
    evidenceContext,
  })
  expect(run.steps[0]?.state).toBe('failed')
  expect(run.steps[0]?.reason).toContain('no provider or result schema')
  expect(runner.requests).toHaveLength(0)
})

it('uses own properties and structural JSON equality', () => {
  expect(validateResultSchema({ type: 'object', required: ['constructor'] }, {})).toBeDefined()
  expect(
    validateResultSchema(
      { type: 'object', properties: {}, additionalProperties: false },
      { constructor: 'unexpected' },
    ),
  ).toBeDefined()
  expect(validateResultSchema({ const: { verdict: 'PASS' } }, { verdict: 'PASS' })).toBeUndefined()
  expect(validateResultSchema({ enum: [[1, 2]] }, [1, 2])).toBeUndefined()
  expect(validateResultSchema({ const: { a: 1, b: 2 } }, { b: 2, a: 1 })).toBeUndefined()
})

it('rejects array/object mismatches and a completed child without a result', async () => {
  expect(validateResultSchema({ const: [] }, {})).toBeDefined()
  expect(validateResultSchema({ enum: [{}] }, [])).toBeDefined()
  const runner = new FakeRunner({ childId: 'child-empty', completed: true })
  const run = await runSubagentStep({
    run: subagentRun(),
    definition: subagentDefinition,
    step: subagentDefinition.steps[0] as (typeof subagentDefinition.steps)[number],
    runner,
    evidenceContext,
  })
  expect(run.status).toBe('failed')
  expect(run.steps[0]?.reason).toContain('without a result')
  expect(run.steps[0]?.evidence).toMatchObject({ kind: 'subagent', callId: 'child-empty' })
})

it('formats an object enum safely and fails the step with the child id', async () => {
  expect(
    validateResultSchema(
      { type: 'object', enum: [{ toString: 'reserved field' }] },
      {
        other: true,
      },
    ),
  ).toBeDefined()
  const definition = validateDefinition({
    v: 1,
    id: 'object-enum-demo',
    name: 'Object enum demo',
    version: 1,
    trigger: { kind: 'turn.stopping', match: {}, mode: 'shadow', dedupe: 'turn' },
    settings: {
      allowModelStart: false,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'review',
        title: 'Child review',
        executor: 'subagent',
        prompt: 'Review.',
        subagent: {
          provider: 'spawn',
          schema: { type: 'object', enum: [{ toString: 'reserved field' }] },
        },
        evidence: { kind: 'file', path: '.dsh/out.json' },
        next: 'end',
      },
    ],
  })
  const runner = new FakeRunner({ childId: 'child-enum', completed: true, result: { other: true } })
  const run = await runSubagentStep({
    run: createRun({
      definition: definition.id,
      trigger: 'turn.stopping',
      session: 'session-1',
      workspace: '/workspace',
      steps: ['review'],
    }),
    definition,
    step: definition.steps[0] as (typeof definition.steps)[number],
    runner,
    evidenceContext,
  })
  expect(run.status).toBe('failed')
  expect(run.steps[0]?.evidence).toMatchObject({ kind: 'subagent', callId: 'child-enum' })
})

it('resolves nested tool arguments and refuses a checkpoint-shaped name', async () => {
  const calls: Array<Readonly<Record<string, unknown>>> = []
  const runner: ToolRunner = {
    async call(request) {
      calls.push(request.arguments)
      return { ok: true }
    },
  }
  const nested = await runToolStep({
    run: toolRun(),
    definition: toolDefinition,
    step: {
      ...toolDefinition.steps[0],
      tool: {
        name: 'shell',
        args: { payload: { change: '{name}' }, list: ['{name}'] },
      },
    } as (typeof toolDefinition.steps)[number],
    runner,
    owned: new OwnedCalls(),
    evidenceContext,
  })
  expect(calls[0]).toMatchObject({ payload: { change: 'auth' }, list: ['auth'] })
  expect(nested.steps[0]?.state).toBe('done')

  let dispatched = 0
  const refusal = await runToolStep({
    run: toolRun(),
    definition: toolDefinition,
    step: toolDefinition.steps[0] as (typeof toolDefinition.steps)[number],
    runner: {
      async call() {
        dispatched += 1
        return { ok: true }
      },
    },
    owned: new OwnedCalls(),
    evidenceContext: {
      workspace: '/workspace',
      values: { name: '.dsh/work-checkpoints/0123456789abcdef/1.json' },
    },
  })
  expect(dispatched).toBe(0)
  expect(refusal.steps[0]?.state).toBe('failed')
  expect(refusal.steps[0]?.reason).toContain('not a change name')
})

it('keeps the call id on both failed dispatch paths', async () => {
  const thrown = await runToolStep({
    run: toolRun(),
    definition: toolDefinition,
    step: toolDefinition.steps[0] as (typeof toolDefinition.steps)[number],
    runner: {
      async call() {
        throw new Error('boom')
      },
    },
    owned: new OwnedCalls(),
    evidenceContext,
  })
  expect(thrown.steps[0]?.evidence).toMatchObject({
    kind: 'tool',
    detail: 'the tool call failed',
  })
  expect(thrown.steps[0]?.evidence?.callId).toMatch(/^owned-/u)
  const rejected = await runToolStep({
    run: toolRun(),
    definition: toolDefinition,
    step: toolDefinition.steps[0] as (typeof toolDefinition.steps)[number],
    runner: {
      async call() {
        return { ok: false, error: 'refused' }
      },
    },
    owned: new OwnedCalls(),
    evidenceContext,
  })
  expect(rejected.steps[0]?.evidence).toMatchObject({
    kind: 'tool',
    detail: 'the tool call failed',
  })
  expect(rejected.steps[0]?.evidence?.callId).toMatch(/^owned-/u)
})

it('refuses placeholders other than {name} before dispatch', async () => {
  let dispatched = 0
  const run = await runToolStep({
    run: toolRun(),
    definition: toolDefinition,
    step: {
      ...toolDefinition.steps[0],
      tool: { name: 'shell', command: '{command}' },
    } as (typeof toolDefinition.steps)[number],
    runner: {
      async call() {
        dispatched += 1
        return { ok: true }
      },
    },
    owned: new OwnedCalls(),
    evidenceContext: { workspace: '/workspace', values: { name: 'auth', command: 'whoami' } },
  })
  expect(dispatched).toBe(0)
  expect(run.steps[0]?.state).toBe('failed')
  expect(run.steps[0]?.reason).toContain('unsupported placeholder')
})

it('bounds the human question before asking', async () => {
  const step = {
    ...(humanDefinition.steps[0] as (typeof humanDefinition.steps)[number]),
    prompt: 'x'.repeat(2_001),
  }
  let asked = 0
  const run = await runHumanStep({
    run: humanRun(),
    step,
    questions: {
      async ask() {
        asked += 1
        return { answer: 'yes' }
      },
    },
    evidenceContext,
  })
  expect(asked).toBe(0)
  expect(run.steps[0]?.state).toBe('failed')
  expect(run.steps[0]?.reason).toContain('longer than')
})

it('implements multi-operand ranges, multi-clause if, and validates malformed rules', () => {
  const data = { context: { value: 100 } }
  expect(evaluateJsonLogic({ '<': [0, { var: 'context.value' }, 10] }, data)).toBe(false)
  expect(evaluateJsonLogic({ '<=': [0, { var: 'context.value' }, 100] }, data)).toBe(true)
  const multi = {
    if: [
      { '>': [{ var: 'context.value' }, 200] },
      'large',
      { '>': [{ var: 'context.value' }, 10] },
      'medium',
      'small',
    ],
  }
  expect(evaluateJsonLogic(multi, data)).toBe('medium')
  expect(evaluateJsonLogic({ '===': [{ or: [false, 0] }, 0] }, {})).toBe(true)
  expect(
    evaluateJsonLogic(
      { in: [{ var: 'context.role' }, { var: 'context.allowedRoles' }] },
      { context: {} },
    ),
  ).toBe(false)
  expect(evaluateJsonLogic({ '===': [{ var: 'context.absent' }, null] }, { context: {} })).toBe(
    true,
  )
  expect(evaluateJsonLogic({ var: '' }, { context: { one: 1 } })).toEqual({
    context: { one: 1 },
  })
  expect(
    evaluateJsonLogic(
      { '<': [{ var: 'context.left' }, { var: 'context.right' }] },
      { context: { left: 'apple', right: 'banana' } },
    ),
  ).toBe(true)
  let nested: unknown = { var: 'context.one' }
  for (let index = 0; index < 30; index += 1) nested = { '<': [0, nested, 2] }
  expect(evaluateJsonLogic(nested, { context: { one: 1 } })).toBe(true)
  expect(
    evaluateJsonLogic({ '>=': [{ var: 'context.value' }, 10] }, { context: { value: 'unknown' } }),
  ).toBe(false)
  expect(evaluateJsonLogic({ '!!': { var: 'context.flag' } }, { context: { flag: true } })).toBe(
    true,
  )
  expect(evaluateJsonLogic({ '+': [1, 2, 3] }, {})).toBe(6)
  expect(evaluateJsonLogic({ '!!': { '/': [0, 0] } }, {})).toBe(false)
  expect(
    evaluateJsonLogic({ missing: ['context.approval'] }, { context: { approval: null } }),
  ).toEqual(['context.approval'])
  expect(evaluateJsonLogic({ missing: ['context.absent'] }, { context: {} })).toEqual([
    'context.absent',
  ])
  expect(
    evaluateJsonLogic({ '<=': [{ var: 'context.value' }, 10] }, { context: { value: 'unknown' } }),
  ).toBe(false)
  expect(() => evaluateJsonLogic({ '==': [] }, {})).toThrow(/operand/u)
  expect(() => evaluateJsonLogic({ and: [false, { nope: true }] }, {})).toThrow(/unknown operator/u)
})

it('adapts the DSH questions contract and maps timeout', async () => {
  const requests: unknown[] = []
  const answered = adaptUserQuestions({
    async ask(request) {
      requests.push(request)
      return { answers: [{ id: request.questions[0]?.id ?? '', selected: ['yes'] }] }
    },
  })
  expect(
    await answered.ask({ question: 'Approve?', accepted: ['yes', 'no'], timeoutAction: 'block' }),
  ).toEqual({ answer: 'yes' })
  expect(requests[0]).toMatchObject({
    questions: [
      {
        id: expect.stringMatching(/^workflows-\d+$/u),
        question: 'Approve?',
        options: [{ label: 'yes' }, { label: 'no' }],
      },
    ],
  })
  const custom = adaptUserQuestions({
    async ask() {
      return { answers: [{ id: 'workflows-1', custom: 'maybe' }] }
    },
  })
  expect(
    await custom.ask({ question: 'Approve?', accepted: ['yes'], timeoutAction: 'block' }),
  ).toEqual({ answer: 'maybe' })
  const timedOut = adaptUserQuestions(
    {
      ask: async () => new Promise<never>(() => undefined),
    },
    5,
  )
  expect(
    await timedOut.ask({ question: 'Approve?', accepted: ['yes'], timeoutAction: 'block' }),
  ).toEqual({ timedOut: true })
})

it('applies the declared action to a cancelled question', async () => {
  const blockStep = {
    ...(humanDefinition.steps[0] as (typeof humanDefinition.steps)[number]),
    human: { timeoutAction: 'block' as const },
  }
  const blocked = await runHumanStep({
    run: humanRun(),
    step: blockStep,
    questions: { ask: async () => ({ cancelled: true }) },
    evidenceContext,
  })
  expect(blocked.status).toBe('blocked')
  expect(blocked.steps[0]?.state).toBe('blocked')
  const cancelStep = {
    ...blockStep,
    human: { timeoutAction: 'cancel' as const },
  }
  const cancelled = await runHumanStep({
    run: humanRun(),
    step: cancelStep,
    questions: { ask: async () => ({ cancelled: true }) },
    evidenceContext,
  })
  expect(cancelled.status).toBe('cancelled')
  expect(cancelled.steps[0]?.state).toBe('cancelled')
})

it('maps an abort from the question service to cancellation in the adapter', async () => {
  const aborted = adaptUserQuestions({
    async ask() {
      const error = new Error('the question was aborted')
      error.name = 'AbortError'
      throw error
    },
  })
  expect(
    await aborted.ask({ question: 'Approve?', accepted: ['yes'], timeoutAction: 'block' }),
  ).toEqual({ cancelled: true })
})
