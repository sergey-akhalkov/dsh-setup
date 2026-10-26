import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { validateConfig } from '../lib/index.js'
import { defaultTestConfig } from './helpers.js'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

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
    expect(config.timeouts).toEqual({ review: 600_000, answer: 300_000, patch: 1_800_000 })
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
      'task-progress',
      'blocker',
      'research',
      'bug-fix',
      'integration-review',
    ])
    expect([...config.targets.keys()]).toEqual(['codex', 'codex-write', 'codex-astra'])
    expect(config.targets.get('codex-write')?.write).toBe(true)
    // The default Codex targets keep provider defaults; the example target selects a model/effort.
    expect(config.targets.get('codex')).toEqual({ provider: 'codex-subagent' })
    expect(config.targets.get('codex-astra')).toEqual({
      provider: 'codex-subagent',
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
    expect(config.failureStreak).toBe(3)
    const integration = config.rules.find((rule) => rule.id === 'integration-review')
    expect(integration).toMatchObject({
      when: 'implementation-complete',
      gate: 'soft',
      scope: 'whole',
    })
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
  ]

  for (const [name, config, message] of invalid) {
    it(`rejects ${name} with the rule id and next action`, () => {
      expect(() => validateConfig(config)).toThrow(message)
    })
  }
})
