import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { decideLesson, proposeLesson } from '../src/host/lesson-store.ts'
import { apply, inject, validateConfig } from '../src/index.js'
import { defaultTestConfig, FakeSubagents, Harness, makeWorkspace, writeChange } from './helpers.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

const cleanups: Array<() => Promise<void>> = []

async function workspace(): Promise<string> {
  const created = await makeWorkspace()
  cleanups.push(created.cleanup)
  return created.root
}

/** Load the plugin through a real Cordis root context with the injected services provided. */
async function realCordisPlugin(options: { learning?: boolean } = {}): Promise<{
  tools: string[]
  commands: string[]
}> {
  const ctx = new Context()
  const tools: string[] = []
  const commands: string[] = []
  ctx.provide('tools', {
    register: (definition: { name: string }) => {
      tools.push(definition.name)
      return () => undefined
    },
  })
  ctx.provide('subagents', {
    list: () => [],
    getProvider: () => undefined,
    startActivation: async () => {
      throw new Error('no target starts in a registration test')
    },
  })
  ctx.provide('skills', { registerProvider: () => () => undefined })
  ctx.provide('workingDirectory', { get: () => process.cwd() })
  if (options.learning === true) {
    ctx.provide('userQuestions', { ask: async () => ({ answers: [] }) })
    ctx.provide('commands', {
      register: (definition: { name: string }) => {
        commands.push(definition.name)
        return () => undefined
      },
    })
  }
  await (ctx.plugin as unknown as (plugin: unknown, config: unknown) => Promise<unknown>)(
    { apply, inject },
    {},
  )
  return { tools, commands }
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const review = {
  id: 'spec-review',
  when: 'spec-ready',
  to: 'codex',
  contract: 'review',
  phase: 'spec',
  scope: 'whole',
  gate: 'strict',
  instruction: 'bundled:review-spec',
}

function configWithRule(rule: Record<string, unknown>): Record<string, unknown> {
  return {
    targets: {
      codex: { provider: 'codex-subagent' },
      'codex-write': { provider: 'codex-subagent-write', write: true },
    },
    rules: [rule],
  }
}

describe('configuration validation', () => {
  it('accepts a minimal configuration with defaults', () => {
    const config = validateConfig({})
    expect(config.rules).toEqual([])
    expect(config.targets.size).toBe(0)
    expect(config.failureStreak).toBe(3)
    expect(config.timeouts).toEqual({ review: 1_200_000, answer: 300_000, patch: 1_800_000 })
    expect(config.reviewQueue).toEqual({
      enabled: true,
      concurrency: 2,
      maxQueued: 16,
      maxAttempts: 3,
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
      waitTimeoutMs: 300_000,
    })
  })

  it('merges a partial review queue block over the documented defaults', () => {
    expect(validateConfig({ reviewQueue: { enabled: false } }).reviewQueue).toEqual({
      enabled: false,
      concurrency: 2,
      maxQueued: 16,
      maxAttempts: 3,
      baseDelayMs: 5_000,
      maxDelayMs: 60_000,
      waitTimeoutMs: 300_000,
    })
    expect(
      validateConfig({ reviewQueue: { concurrency: 4, maxAttempts: 5 } }).reviewQueue,
    ).toMatchObject({ enabled: true, concurrency: 4, maxAttempts: 5 })
  })

  it('accepts the gate-only gates.workflowOwned switch and defaults it true', () => {
    expect(validateConfig({}).gates).toEqual({ workflowOwned: true })
    expect(validateConfig({ gates: { workflowOwned: false } }).gates).toEqual({
      workflowOwned: false,
    })
    expect(() => validateConfig({ gates: { workflowOwned: 'off' } })).toThrow(
      /gates\.workflowOwned/u,
    )
    expect(() => validateConfig({ gates: { unknown: true } })).toThrow(/gates: unknown field/u)
    expect(() => validateConfig({ gates: false })).toThrow(/gates must be a mapping/u)
  })

  it('accepts an explicit empty rule list and the no-rules state', () => {
    expect(validateConfig({ rules: [] }).rules).toEqual([])
  })

  it('accepts the shipped default rules and targets from the composition fragment', () => {
    const fragment = parse(readFileSync(join(packageDir, 'cordis.fragment.yml'), 'utf8')) as {
      rows: Array<{ id: string; config: Record<string, unknown> }>
    }
    const row = fragment.rows[0]
    expect(row?.id).toBe('dsh-setup-delegation-rules')
    const config = validateConfig(row?.config)
    expect(config.rules.map((rule) => rule.id)).toEqual([
      'spec-review',
      'task-review',
      'blocker',
      'research',
      'advisor',
      'worker-fast',
      'worker-deep',
      'bug-fix',
      'integration-review',
      'lane-fanout',
    ])
    expect(config.rules.map((rule) => rule.when)).not.toContain('implementation-work')
    expect(config.rules.find((rule) => rule.id === 'lane-fanout')).toMatchObject({
      when: 'lane-assignment',
      contract: 'note',
      gate: 'strict',
    })
    expect([...config.targets.keys()]).toEqual([
      'codex',
      'codex-write',
      'codex-astra',
      'worker-fast',
      'worker-deep',
    ])
    expect(config.targets.get('codex-write')?.write).toBe(true)
    // The shipped targets select the strong model; codex-astra stays the explicit strong advisor target.
    expect(config.targets.get('codex')).toEqual({
      provider: 'codex-subagent',
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
    expect(config.targets.get('codex-write')).toEqual({
      provider: 'codex-subagent-write',
      write: true,
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
    expect(config.targets.get('codex-astra')).toEqual({
      provider: 'codex-subagent',
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
    // The worker tiers set only effort, so both keep the profile's model.
    expect(config.targets.get('worker-fast')).toEqual({
      provider: 'spawn',
      reasoningEffort: 'high',
    })
    expect(config.targets.get('worker-deep')).toEqual({
      provider: 'spawn',
      reasoningEffort: 'max',
    })
    for (const ruleId of ['worker-fast', 'worker-deep']) {
      expect(config.rules.find((rule) => rule.id === ruleId)).toMatchObject({
        when: 'manual',
        to: ruleId,
        contract: 'answer',
        gate: 'none',
      })
    }
    expect(config.rules.find((rule) => rule.id === 'advisor')).toMatchObject({
      when: 'manual',
      to: 'codex-astra',
      contract: 'answer',
      gate: 'none',
      instruction: 'bundled:advisor',
    })
    expect(config.failureStreak).toBe(3)
    const integration = config.rules.find((rule) => rule.id === 'integration-review')
    expect(integration).toMatchObject({
      when: 'implementation-complete',
      gate: 'soft',
      scope: 'whole',
    })
  })

  it('ships max as the setup owner default reasoning effort', () => {
    const defaults = parse(
      readFileSync(join(packageDir, '..', '..', 'packages', 'setup', 'defaults.yml'), 'utf8'),
    ) as Array<{ id: string; config?: Record<string, unknown> }>
    const row = defaults.find((entry) => entry.id === 'agent-default-model')
    expect(row?.config).toMatchObject({ reasoningEffort: 'max' })
  })

  it('accepts a valid custom rule on an existing trigger and contract', () => {
    const config = {
      ...defaultTestConfig(),
      rules: [
        ...(defaultTestConfig().rules ?? []),
        {
          id: 'extra-spec-review',
          when: 'spec-ready',
          to: 'codex',
          contract: 'review',
          phase: 'second-spec',
          scope: 'whole',
          gate: 'soft',
          instruction: 'Inline review instructions.',
        },
      ],
    }
    expect(validateConfig(config).rules.map((rule) => rule.id)).toContain('extra-spec-review')
  })

  it('accepts the lane-boundary note rule and rejects a review contract for it', () => {
    const laneRule = { id: 'lane-fanout', when: 'lane-boundary', contract: 'note', gate: 'strict' }
    expect(validateConfig(configWithRule(laneRule)).rules[0]).toMatchObject(laneRule)
    expect(() =>
      validateConfig(
        configWithRule({
          id: 'lane-fanout',
          when: 'lane-boundary',
          contract: 'review',
          scope: 'task',
          to: 'codex',
          gate: 'strict',
          instruction: 'bundled:review-task',
        }),
      ),
    ).toThrow(/lane-boundary is satisfied only by a task progress note/)
  })

  it('accepts lane-assignment as a note rule and rejects a target or review contract', () => {
    const laneRule = {
      id: 'lane-fanout',
      when: 'lane-assignment',
      contract: 'note',
      gate: 'strict',
    }
    expect(validateConfig(configWithRule(laneRule)).rules[0]).toMatchObject(laneRule)
    expect(() => validateConfig(configWithRule({ ...laneRule, to: 'codex' }))).toThrow(
      /a note rule takes no "to"/,
    )
    expect(() =>
      validateConfig(
        configWithRule({
          id: 'lane-fanout',
          when: 'lane-assignment',
          contract: 'review',
          scope: 'task',
          to: 'codex',
          gate: 'strict',
          instruction: 'bundled:review-task',
        }),
      ),
    ).toThrow(/lane-assignment is satisfied only by a lane assignment or a task progress note/)
  })

  it('accepts profile note rules on the implementation-work and lane-assignment triggers', () => {
    const config = {
      targets: { codex: { provider: 'codex-subagent' } },
      rules: [
        { id: 'task-progress', when: 'implementation-work', contract: 'note', gate: 'strict' },
        { id: 'lane-fanout', when: 'lane-assignment', contract: 'note', gate: 'strict' },
      ],
    }
    expect(validateConfig(config).rules.map((rule) => rule.when)).toEqual([
      'implementation-work',
      'lane-assignment',
    ])
  })

  const invalid: Array<[string, Record<string, unknown>, RegExp]> = [
    ['an unknown top-level field', { rules: [], bogus: true }, /unknown configuration field/],
    [
      'an unknown trigger',
      configWithRule({ ...review, when: 'whenever' }),
      /rule "spec-review": unknown trigger/,
    ],
    [
      'an unknown contract',
      configWithRule({ ...review, contract: 'verdict' }),
      /rule "spec-review": unknown contract/,
    ],
    [
      'an unknown gate',
      configWithRule({ ...review, gate: 'hard' }),
      /rule "spec-review": unknown gate/,
    ],
    [
      'a missing target',
      configWithRule({ ...review, to: 'missing' }),
      /target "missing" is not configured/,
    ],
    [
      'a duplicate rule id',
      { ...configWithRule(review), rules: [review, { ...review, phase: 'other' }] },
      /duplicate rule id "spec-review"/,
    ],
    ['a non-kebab rule id', configWithRule({ ...review, id: 'Spec_Review' }), /is not kebab-case/],
    ['an unknown rule field', configWithRule({ ...review, bogus: 1 }), /unknown field\(s\) bogus/],
    [
      'a missing instruction',
      configWithRule({ ...review, instruction: '' }),
      /instruction.*must be a non-empty string/,
    ],
    [
      'a missing bundled instruction',
      configWithRule({ ...review, instruction: 'bundled:does-not-exist' }),
      /bundled instruction "does-not-exist" does not exist/,
    ],
    [
      'a review without a phase',
      configWithRule({ ...review, phase: undefined }),
      /phase.*must be a non-empty string/,
    ],
    [
      'a task review with a phase',
      configWithRule({ ...review, when: 'spec-task-ready', scope: 'task' }),
      /task-scoped review has no phase/,
    ],
    [
      'a note rule with a target',
      configWithRule({
        id: 'note-rule',
        when: 'implementation-work',
        contract: 'note',
        gate: 'strict',
        to: 'codex',
      }),
      /a note rule takes no "to"/,
    ],
    [
      'a note rule on a non-implementation trigger',
      configWithRule({ id: 'note-rule', when: 'manual', contract: 'note', gate: 'none' }),
      /only the implementation-work trigger uses a note rule|manual rules cannot use the note contract/,
    ],
    [
      'a patch rule without isolation',
      configWithRule({
        ...review,
        id: 'bug-fix',
        when: 'manual',
        contract: 'patch',
        gate: 'none',
        to: 'codex-write',
        scope: undefined,
        phase: undefined,
        instruction: 'bundled:fix',
      }),
      /must declare isolation: worktree/,
    ],
    [
      'a patch rule on a read-only target',
      configWithRule({
        ...review,
        id: 'bug-fix',
        when: 'manual',
        contract: 'patch',
        gate: 'none',
        to: 'codex',
        scope: undefined,
        phase: undefined,
        instruction: 'bundled:fix',
        isolation: 'worktree',
      }),
      /not declared write-capable/,
    ],
    [
      'a duplicate strict digest scope',
      {
        ...configWithRule(review),
        rules: [review, { ...review, id: 'second-spec-review', phase: 'spec' }],
      },
      /both gate the same digest scope as strict/,
    ],
    [
      'a strict failure-streak rule',
      configWithRule({
        ...review,
        id: 'blocker',
        when: 'failure-streak',
        contract: 'answer',
        gate: 'strict',
        scope: undefined,
        phase: undefined,
        instruction: 'bundled:consult',
      }),
      /writes no gate record/,
    ],
    [
      'a gated manual rule',
      configWithRule({
        ...review,
        id: 'research',
        when: 'manual',
        to: 'codex',
        contract: 'answer',
        gate: 'soft',
        scope: undefined,
        phase: undefined,
        instruction: 'bundled:research',
      }),
      /manual rule has no automatic condition/,
    ],
    [
      'an answer rule with a scope',
      configWithRule({
        ...review,
        id: 'research',
        when: 'manual',
        to: 'codex',
        contract: 'answer',
        gate: 'none',
        instruction: 'bundled:research',
      }),
      /only a review rule takes phase\/scope/,
    ],
    [
      'a spec-ready answer rule',
      configWithRule({
        ...review,
        id: 'research',
        when: 'spec-ready',
        to: 'codex',
        contract: 'answer',
        gate: 'none',
        instruction: 'bundled:research',
        scope: undefined,
        phase: undefined,
      }),
      /spec-ready drives a whole-spec review/,
    ],
    [
      'an implementation-work review rule',
      configWithRule({ ...review, when: 'implementation-work' }),
      /implementation-work is satisfied only by a task progress note/,
    ],
    [
      'an unknown target option',
      {
        targets: { codex: { provider: 'codex-subagent', agentOptions: { temperature: 1 } } },
        rules: [],
      },
      /unknown option "temperature"/,
    ],
    [
      'an empty target model',
      { targets: { codex: { provider: 'codex-subagent', model: '' } }, rules: [] },
      /target "codex".model.*must be a non-empty string/,
    ],
    [
      'a non-string reasoning effort',
      {
        targets: { codex: { provider: 'codex-subagent', reasoningEffort: 5 } },
        rules: [],
      },
      /target "codex".reasoningEffort.*must be a non-empty string/,
    ],
    [
      'an empty agent-options reasoning effort',
      {
        targets: {
          codex: { provider: 'codex-subagent', agentOptions: { reasoningEffort: '' } },
        },
        rules: [],
      },
      /target "codex".agentOptions.reasoningEffort.*must be a non-empty string/,
    ],
    [
      'an invalid timeout',
      { rules: [], timeouts: { review: -1 } },
      /timeouts.review must be a positive integer/,
    ],
    [
      'an invalid failure streak',
      { rules: [], failureStreak: 1.5 },
      /failureStreak must be a positive integer/,
    ],
    [
      'a review queue concurrency below the range',
      { reviewQueue: { concurrency: 0 } },
      /reviewQueue\.concurrency must be a whole number from 1 to 4/,
    ],
    [
      'a review queue concurrency above the range',
      { reviewQueue: { concurrency: 5 } },
      /reviewQueue\.concurrency must be a whole number from 1 to 4/,
    ],
    [
      'a negative review queue attempt budget',
      { reviewQueue: { maxAttempts: -1 } },
      /reviewQueue\.maxAttempts must be a whole number at least 1/,
    ],
    [
      'an empty review queue waiting list',
      { reviewQueue: { maxQueued: 0 } },
      /reviewQueue\.maxQueued must be a whole number at least 1/,
    ],
    [
      'a non-boolean review queue switch',
      { reviewQueue: { enabled: 'yes' } },
      /reviewQueue\.enabled must be true or false/,
    ],
    [
      'an unknown review queue field',
      { reviewQueue: { backlog: 2 } },
      /reviewQueue: unknown field\(s\) backlog/,
    ],
  ]

  for (const [name, config, message] of invalid) {
    it(`rejects ${name} with the rule id and next action`, () => {
      expect(() => validateConfig(config)).toThrow(message)
    })
  }
})

describe('real Cordis registration', () => {
  it('loads without the optional learning services and registers the enabled tools', async () => {
    const { tools, commands } = await realCordisPlugin()
    expect(tools.sort()).toEqual([
      'delegate',
      'delegation_status',
      'review_lesson',
      'review_retro',
      'task_progress',
    ])
    // No command registry: the learning tools load, the command is skipped.
    expect(commands).toHaveLength(0)
  })

  it('registers the learning tools and command when both services are provided', async () => {
    const { tools, commands } = await realCordisPlugin({ learning: true })
    expect(tools.sort()).toEqual([
      'delegate',
      'delegation_status',
      'review_lesson',
      'review_retro',
      'task_progress',
    ])
    expect(commands).toEqual(['review-retro'])
  })
})

describe('review learning configuration', () => {
  it('defaults enabled window 50 and maxLessons 200', () => {
    expect(validateConfig({}).reviewLearning).toEqual({
      enabled: true,
      window: 50,
      maxLessons: 200,
    })
  })

  it('merges a partial block over the defaults', () => {
    expect(validateConfig({ reviewLearning: { enabled: false } }).reviewLearning).toEqual({
      enabled: false,
      window: 50,
      maxLessons: 200,
    })
    expect(
      validateConfig({ reviewLearning: { window: 5, maxLessons: 10 } }).reviewLearning,
    ).toEqual({ enabled: true, window: 5, maxLessons: 10 })
  })

  it('fails loud on an invalid window, maxLessons, or unknown field', () => {
    expect(() => validateConfig({ reviewLearning: { window: 0 } })).toThrow(
      /reviewLearning\.window must be a whole number from 1 to 200/,
    )
    expect(() => validateConfig({ reviewLearning: { window: 201 } })).toThrow(
      /reviewLearning\.window must be a whole number from 1 to 200/,
    )
    expect(() => validateConfig({ reviewLearning: { window: 1.5 } })).toThrow(
      /reviewLearning\.window must be a whole number from 1 to 200/,
    )
    expect(() => validateConfig({ reviewLearning: { maxLessons: 0 } })).toThrow(
      /reviewLearning\.maxLessons must be a whole number from 1 to 1000/,
    )
    expect(() => validateConfig({ reviewLearning: { nope: true } })).toThrow(
      /reviewLearning: unknown field\(s\) nope/,
    )
    expect(() => validateConfig({ reviewLearning: 'on' })).toThrow(
      /reviewLearning must be a mapping/,
    )
  })

  it('registers no learning tool or command when disabled and still injects nothing', async () => {
    const root = await workspace()
    await writeChange(root, 'change-a', [{ number: '1.1', text: 'First task', checked: true }])
    const accepted = await proposeLesson(root, {
      class: 'path-boundary',
      title: 'Disabled lesson title',
      body: 'Disabled lesson body.',
      appliesTo: { rules: ['*'], capabilities: [] },
      now: 1_000,
    })
    await decideLesson(root, accepted.lesson.id, 'accepted', 2_000)

    const disabled = new Harness({
      cwd: root,
      config: { ...defaultTestConfig(), reviewLearning: { enabled: false } },
      agents: new FakeSubagents(),
    })
    expect([...disabled.tools.keys()].sort()).toEqual([
      'delegate',
      'delegation_status',
      'task_progress',
    ])
    expect(disabled.commands).toHaveLength(0)
    const subagents = new FakeSubagents()
    subagents.addProvider('codex-subagent')
    const review = new Harness({
      cwd: root,
      config: { ...defaultTestConfig(), reviewLearning: { enabled: false } },
      agents: subagents,
    })
    const runId = await review.startReview({ rule: 'task-review', change: 'change-a' })
    await review.waitForRun(runId)
    expect(subagents.runs[0]?.prompt ?? '').not.toContain('## Lessons from prior reviews')
  })

  it('names the user-approval rule in both learning tool descriptions when enabled', async () => {
    const root = await workspace()
    const harness = new Harness({ cwd: root, config: defaultTestConfig() })
    const retro = harness.tools.get('review_retro')?.description ?? ''
    const lesson = harness.tools.get('review_lesson')?.description ?? ''
    expect(retro).toContain('user accepts')
    expect(lesson).toContain('user-questions service')
    expect(lesson).toContain('never change the P0/P1')
    expect(harness.commands.map((command) => command.name)).toEqual(['review-retro'])
  })
})
