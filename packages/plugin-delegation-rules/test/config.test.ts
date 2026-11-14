import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { apply, inject, validateConfig } from '../src/index.js'
import { defaultTestConfig } from './helpers.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

/** Load the plugin through a real Cordis root context with the injected services provided. */
async function realCordisPlugin(): Promise<{ tools: string[] }> {
  const ctx = new Context()
  const tools: string[] = []
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
  await (ctx.plugin as unknown as (plugin: unknown, config: unknown) => Promise<unknown>)(
    { apply, inject },
    {},
  )
  return { tools }
}

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
    targets: { codex: { provider: 'codex-subagent' } },
    rules: [rule],
  }
}

describe('configuration validation', () => {
  it('accepts a minimal configuration with defaults', () => {
    const config = validateConfig({})
    expect(config.rules).toEqual([])
    expect(config.targets.size).toBe(0)
    expect(config.timeouts).toEqual({ review: 1_200_000 })
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

  it('accepts the shipped review rules and the single codex target from the composition fragment', () => {
    const fragment = parse(readFileSync(join(packageDir, 'cordis.fragment.yml'), 'utf8')) as {
      rows: Array<{ id: string; config: Record<string, unknown> }>
    }
    const row = fragment.rows[0]
    expect(row?.id).toBe('dsh-setup-delegation-rules')
    const config = validateConfig(row?.config)
    expect(config.rules.map((rule) => rule.id)).toEqual([
      'spec-review',
      'task-review',
      'integration-review',
      'lane-fanout',
    ])
    expect(config.rules.map((rule) => rule.when)).not.toContain('implementation-work')
    expect(config.rules.find((rule) => rule.id === 'lane-fanout')).toMatchObject({
      when: 'lane-assignment',
      contract: 'note',
      gate: 'strict',
    })
    expect([...config.targets.keys()]).toEqual(['codex'])
    expect(config.targets.get('codex')).toEqual({
      provider: 'codex-subagent',
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
    expect(config.timeouts).toEqual({ review: 600_000 })
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
      'a removed failure-streak field',
      { rules: [], failureStreak: 3 },
      /unknown configuration field\(s\) failureStreak.*removed/,
    ],
    [
      'an unknown trigger',
      configWithRule({ ...review, when: 'whenever' }),
      /rule "spec-review": unknown trigger/,
    ],
    [
      'the removed failure-streak trigger',
      configWithRule({ ...review, when: 'failure-streak', contract: 'note', gate: 'soft' }),
      /the failure-streak trigger was removed.*subagent tool \(or codex_subagent .*use manual, spec-ready/,
    ],
    [
      'a removed threshold field',
      configWithRule({ ...review, threshold: 3 }),
      /threshold belongs to the removed failure-streak trigger; remove it and consult with the subagent tool \(or codex_subagent/,
    ],
    [
      'the removed answer contract',
      configWithRule({ ...review, contract: 'answer' }),
      /the answer contract was removed; use the subagent tool \(or codex_subagent/,
    ],
    [
      'the removed patch contract',
      configWithRule({ ...review, contract: 'patch' }),
      /the patch contract was removed; use create_worktree/,
    ],
    [
      'a removed isolation field',
      configWithRule({ ...review, isolation: 'worktree' }),
      /isolation was removed with the patch contract; use create_worktree/,
    ],
    [
      'a removed target write flag',
      {
        targets: { 'codex-write': { provider: 'codex-subagent-write', write: true } },
        rules: [],
      },
      /target "codex-write"\.write was removed with the patch contract; .*subagent tool with create_worktree/,
    ],
    [
      'a removed answer timeout',
      { rules: [], timeouts: { answer: 1 } },
      /timeouts: unknown contract "answer"; use review \(answer and patch were removed/,
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
      'a duplicate strict digest scope',
      {
        ...configWithRule(review),
        rules: [review, { ...review, id: 'second-spec-review', phase: 'spec' }],
      },
      /both gate the same digest scope as strict/,
    ],
    [
      'a gated manual rule',
      configWithRule({
        ...review,
        id: 'manual-review',
        when: 'manual',
        gate: 'soft',
        scope: 'task',
        phase: undefined,
      }),
      /manual rule has no automatic condition/,
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
  it('loads with the three delegation tools and no removed learning tool or command', async () => {
    const { tools } = await realCordisPlugin()
    expect(tools.sort()).toEqual(['delegate', 'delegation_status', 'task_progress'])
  })
})
