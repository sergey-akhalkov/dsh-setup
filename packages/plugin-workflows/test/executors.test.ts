import { describe, expect, it } from 'vitest'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import { collectEvidencePaths } from '../src/host/evidence.ts'
import {
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
    expect(rejected.status).toBe('cancelled')
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
