import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadApprovedDefinitions } from '../src/host/approval-store.ts'
import {
  type Definition,
  loadShippedDefinitions,
  MAX_DEFINITION_DESCRIPTION,
  resolveOwnership,
  validateDefinition,
} from '../src/host/definitions.ts'
import { HostAuth } from '../src/host/host-auth.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const TEMP_DIRECTORIES: string[] = []

/** The intake definition that now ships read-only with the OpenSpec plugin. */
function contributedIntake(): Definition {
  return validateDefinition(
    JSON.parse(
      readFileSync(
        join(packageDir, '..', 'plugin-openspec', 'assets', 'workflows', 'change-intake.json'),
        'utf8',
      ),
    ) as unknown,
  )
}

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-ownership-'))
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

/** The installed legacy plugins of a fake profile. */
function profile(...plugins: string[]): ReadonlySet<string> {
  return new Set(plugins)
}

/** A minimal valid definition; each test overrides one part. */
function valid(): Record<string, unknown> {
  return {
    v: 1,
    id: 'auth-draft',
    name: 'Auth draft',
    version: 1,
    trigger: {
      kind: 'tool.pre-execute',
      match: { tool: 'shell', command: 'openspec new change {name}' },
      mode: 'active',
      dedupe: 'name',
    },
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
        title: 'Requirements',
        executor: 'main',
        prompt: 'Write the requirements.',
        evidence: { kind: 'file', path: '.dsh/workflows/drafts/{name}/requirements.md' },
        next: 'end',
        blockTurnClose: true,
      },
    ],
  }
}

function stepsOf(definition: Record<string, unknown>): Array<Record<string, unknown>> {
  return definition.steps as Array<Record<string, unknown>>
}

function firstStep(definition: Record<string, unknown>): Record<string, unknown> {
  const step = stepsOf(definition)[0]
  if (step === undefined) throw new Error('the test definition has no first step')
  return step
}

describe('workflow definition schema', () => {
  it('loads the complete contributed change-intake definition with its all contracts', () => {
    const definition = contributedIntake()
    expect(definition.name).toBe('OpenSpec change intake')
    expect(definition.description).toBe(
      'Collect the requirements, architecture, and interface, then create and review an OpenSpec change.',
    )
    expect(definition.trigger).toMatchObject({
      kind: 'tool.pre-execute',
      mode: 'active',
      dedupe: 'name',
    })
    expect(definition.settings).toMatchObject({
      allowModelStart: false,
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    })
    expect(definition.steps.map((step) => step.id)).toEqual([
      'requirements',
      'architecture',
      'interface',
      'create-change',
      'spec',
      'spec-review',
      'approval',
    ])
    const create = definition.steps.find((step) => step.id === 'create-change')
    expect(create?.executor).toBe('tool')
    expect(create?.evidence).toMatchObject({ kind: 'all' })
    expect(create?.evidence?.kind === 'all' ? create.evidence.items : []).toHaveLength(2)
    const spec = definition.steps.find((step) => step.id === 'spec')
    const specItems = spec?.evidence?.kind === 'all' ? spec.evidence.items : []
    expect(specItems).toHaveLength(5)
    expect(specItems.map((item) => item.kind)).toEqual(['file', 'file', 'file', 'file', 'check'])
    const review = definition.steps.find((step) => step.id === 'spec-review')
    expect(review?.ownership).toBe('defer')
    expect(review?.legacy).toEqual({ plugin: 'delegation-rules', signal: 'spec-review' })
    expect(review?.evidence).toMatchObject({
      kind: 'record',
      rule: 'spec-review',
      phase: 'spec',
      scope: 'whole',
      verdict: 'PASS',
      digest: 'current',
    })
    expect(definition.steps.at(-1)?.executor).toBe('human')
    expect(definition.steps.at(-1)?.evidence).toEqual({ kind: 'human', answer: 'yes' })
  })

  it('gives every shipped definition a human description', () => {
    for (const definition of loadShippedDefinitions()) {
      expect(typeof definition.description, definition.id).toBe('string')
      expect(definition.description?.trim(), definition.id).not.toBe('')
    }
  })

  it('loads a valid definition and keeps its normalized step by id', () => {
    const definition = validateDefinition(valid())
    expect(definition.id).toBe('auth-draft')
    expect(definition.steps[0]?.id).toBe('requirements')
    expect(definition.steps[0]?.next).toBe('end')
  })

  it('accepts an optional bounded description and keeps it out when absent', () => {
    const withText = valid()
    withText.description = 'Intake a new OpenSpec change.'
    expect(validateDefinition(withText).description).toBe('Intake a new OpenSpec change.')
    expect('description' in validateDefinition(valid())).toBe(false)
    const longest = valid()
    longest.description = 'x'.repeat(MAX_DEFINITION_DESCRIPTION)
    expect(validateDefinition(longest).description).toHaveLength(MAX_DEFINITION_DESCRIPTION)
    for (const bad of [1, '', '   ']) {
      const definition = valid()
      definition.description = bad
      expect(() => validateDefinition(definition)).toThrow(
        /definition "auth-draft" field "description"/u,
      )
    }
    const tooLong = valid()
    tooLong.description = 'x'.repeat(MAX_DEFINITION_DESCRIPTION + 1)
    expect(() => validateDefinition(tooLong)).toThrow(
      /field "description" must be at most 500 characters/u,
    )
  })

  it('refuses an unknown field at every level with the definition and field', () => {
    const top = valid()
    top.extra = true
    expect(() => validateDefinition(top)).toThrow(/definition "auth-draft" field "extra"/u)
    const nested = valid()
    ;(nested.settings as Record<string, unknown>).nope = 1
    expect(() => validateDefinition(nested)).toThrow(
      /definition "auth-draft" field "settings.nope"/u,
    )
    const step = valid()
    firstStep(step).surprise = 'x'
    expect(() => validateDefinition(step)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.surprise"/u,
    )
    const trigger = valid()
    ;(trigger.trigger as Record<string, unknown>).extra = true
    expect(() => validateDefinition(trigger)).toThrow(
      /definition "auth-draft" field "trigger\.extra"/u,
    )
    const evidence = valid()
    firstStep(evidence).evidence = { kind: 'file', path: 'a.md', extra: 1 }
    expect(() => validateDefinition(evidence)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.evidence\.extra"/u,
    )
  })

  it('refuses a duplicate step id and a dangling next edge', () => {
    const duplicate = valid()
    stepsOf(duplicate).push({
      id: 'requirements',
      title: 'Again',
      executor: 'main',
      prompt: 'Again.',
      evidence: { kind: 'file', path: 'b.md' },
      next: 'end',
    })
    expect(() => validateDefinition(duplicate)).toThrow(
      /definition "auth-draft" field "steps\[1\]\.id" is duplicated/u,
    )
    const dangling = valid()
    firstStep(dangling).next = 'nowhere'
    expect(() => validateDefinition(dangling)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.next" names unknown step "nowhere"/u,
    )
  })

  it('requires a non-empty all contract and a nonCritical declaration', () => {
    const empty = valid()
    firstStep(empty).evidence = { kind: 'all', items: [] }
    expect(() => validateDefinition(empty)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.evidence\.items" must be a non-empty list/u,
    )
    const declared = valid()
    firstStep(declared).evidence = { kind: 'declaration' }
    expect(() => validateDefinition(declared)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.evidence\.kind"/u,
    )
    const nonCritical = valid()
    const allowedStep = firstStep(nonCritical)
    allowedStep.nonCritical = true
    allowedStep.evidence = { kind: 'declaration' }
    expect(validateDefinition(nonCritical).steps[0]?.evidence).toEqual({ kind: 'declaration' })
  })

  it('requires a path-safe definition id', () => {
    for (const id of [
      '../../outside',
      '../../escape',
      'UPPER',
      'with space',
      'with_underscore',
      '.hidden',
    ]) {
      const bad = valid()
      bad.id = id
      expect(() => validateDefinition(bad), id).toThrow(/field "id" must match/u)
    }
  })

  it('refuses a defer without a legacy source and a tool step outside settings.allowTools', () => {
    const defer = valid()
    ;(defer.settings as Record<string, unknown>).gateOwnership = 'defer'
    expect(() => validateDefinition(defer)).toThrow(
      /definition "auth-draft" field "settings\.legacy" is required/u,
    )
    const tool = valid()
    const toolStep = firstStep(tool)
    toolStep.executor = 'tool'
    toolStep.tool = { name: 'shell', command: 'openspec new change {name}' }
    expect(() => validateDefinition(tool)).toThrow(
      /definition "auth-draft" field "settings\.allowTools" must list "shell"/u,
    )
  })

  it('refuses an executor object that belongs to another executor', () => {
    const wrong = valid()
    firstStep(wrong).tool = { unexpected: true }
    expect(() => validateDefinition(wrong)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.tool" is not valid on a main step/u,
    )
  })

  it('requires a definition id and never synthesizes one', () => {
    const missing = valid()
    delete missing.id
    expect(() => validateDefinition(missing)).toThrow(/field "id" must be a non-empty string/u)
    const nullId = valid()
    nullId.id = null
    expect(() => validateDefinition(nullId)).toThrow(/field "id" must be a non-empty string/u)
  })

  it('refuses an implicit cycle outside the explicit loop executor', () => {
    const cycle = valid()
    firstStep(cycle).next = 'second'
    stepsOf(cycle).push({
      id: 'second',
      title: 'Second',
      executor: 'main',
      prompt: 'Loop back.',
      evidence: { kind: 'file', path: 'second.md' },
      next: 'requirements',
    })
    expect(() => validateDefinition(cycle)).toThrow(
      /definition "auth-draft" field "steps\[1\]\.next" forms a cycle.*explicit loop step/u,
    )
    const branch = valid()
    const branchStep = firstStep(branch)
    branchStep.executor = 'branch'
    delete branchStep.prompt
    delete branchStep.evidence
    delete branchStep.next
    // biome-ignore lint/suspicious/noThenProperty: a branch target, not a thenable
    branchStep.branch = { predicate: {}, then: 'requirements', else: 'end' }
    expect(() => validateDefinition(branch)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.branch\.then" forms a cycle/u,
    )
  })

  it('requires a record digest to be a string', () => {
    const arrayDigest = valid()
    firstStep(arrayDigest).evidence = {
      kind: 'record',
      rule: 'spec-review',
      change: 'auth',
      verdict: 'PASS',
      digest: ['a'.repeat(64)],
    }
    expect(() => validateDefinition(arrayDigest)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.evidence\.digest" must be "current" or a 64-hex digest string/u,
    )
  })

  it('defaults an omitted gateOwnership to own and refuses the reserved end id', () => {
    const defaults = valid()
    delete (defaults.settings as Record<string, unknown>).gateOwnership
    expect(validateDefinition(defaults).settings.gateOwnership).toBe('own')
    const reserved = valid()
    stepsOf(reserved).push({
      id: 'end',
      title: 'Reserved',
      executor: 'main',
      prompt: 'Back.',
      evidence: { kind: 'file', path: 'end.md' },
      next: 'requirements',
    })
    expect(() => validateDefinition(reserved)).toThrow(
      /definition "auth-draft" field "steps\[1\]\.id" must not use the reserved terminal value "end"/u,
    )
  })

  it('validates a nested all recursively and reports the first failing item path', () => {
    const nested = valid()
    firstStep(nested).evidence = {
      kind: 'all',
      items: [
        {
          kind: 'all',
          items: [
            { kind: 'file', path: 'a.md' },
            { kind: 'file', path: 'b.md' },
          ],
        },
        { kind: 'file', path: 'c.md' },
      ],
    }
    expect(validateDefinition(nested).steps[0]?.evidence?.kind).toBe('all')

    const invalidNested = valid()
    firstStep(invalidNested).evidence = {
      kind: 'all',
      items: [
        { kind: 'all', items: [{ kind: 'file', path: 'a.md' }, { kind: 'file' }] },
        { kind: 'file', path: 'c.md' },
      ],
    }
    expect(() => validateDefinition(invalidNested)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.evidence\.items\[0\]\.items\[1\]\.path" must be a non-empty string/u,
    )

    const firstFailure = valid()
    firstStep(firstFailure).evidence = {
      kind: 'all',
      items: [{ kind: 'file' }, { kind: 'check' }],
    }
    expect(() => validateDefinition(firstFailure)).toThrow(
      /definition "auth-draft" field "steps\[0\]\.evidence\.items\[0\]\.path" must be a non-empty string/u,
    )
  })
})

describe('ownership and the installed legacy profile', () => {
  it('keeps the contributed intake own for its own steps and defers only spec-review', () => {
    const intake = contributedIntake()
    const resolved = resolveOwnership(
      intake as Definition,
      profile('delegation-rules', 'goal-continuity'),
    )
    expect(resolved.issues).toEqual([])
    const byId = new Map(resolved.steps.map((step) => [step.id, step]))
    expect(byId.get('spec-review')?.ownership).toBe('defer')
    expect(byId.get('spec-review')?.legacy).toEqual({
      plugin: 'delegation-rules',
      signal: 'spec-review',
    })
    for (const id of [
      'requirements',
      'architecture',
      'interface',
      'create-change',
      'spec',
      'approval',
    ]) {
      expect(byId.get(id)?.ownership).toBe('own')
    }
  })

  it('refuses a deferred step when its legacy source is not installed', async () => {
    const intake = contributedIntake()
    const missing = resolveOwnership(intake, profile())
    expect(missing.issues.join('\n')).toMatch(
      /step "spec-review".*"delegation-rules\/spec-review" is not installed.*retire-legacy-gates/u,
    )
    const workspace = await tempWorkspace()
    const refused = await loadApprovedDefinitions(workspace, {
      auth: HostAuth.fromKey('test-ownership-host-key-0123'),
      shipped: [...loadShippedDefinitions(), intake],
      installedLegacy: profile(),
    })
    expect(refused.definitions.map((definition) => definition.id)).not.toContain('change-intake')
    expect(refused.errors.join('\n')).toMatch(/retire-legacy-gates/u)
    const loaded = await loadApprovedDefinitions(workspace, {
      auth: HostAuth.fromKey('test-ownership-host-key-0123'),
      shipped: [...loadShippedDefinitions(), intake],
      installedLegacy: profile('delegation-rules', 'goal-continuity'),
    })
    expect(loaded.definitions.map((definition) => definition.id)).toContain('change-intake')
  })

  it('refuses an own step that declares an installed legacy source and allows it once retired', () => {
    const own = valid()
    const step = firstStep(own)
    step.legacy = { plugin: 'delegation-rules', signal: 'task-review' }
    step.ownership = 'own'
    const definition = validateDefinition(own)
    expect(resolveOwnership(definition, profile('delegation-rules')).issues.join('\n')).toMatch(
      /step "requirements".*"delegation-rules\/task-review" is still enabled.*retire-legacy-gates/u,
    )
    expect(resolveOwnership(definition, profile()).issues).toEqual([])
  })

  it('refuses a deferred definition without its installed source and defers every step when present', () => {
    const deferred = valid()
    const settings = deferred.settings as Record<string, unknown>
    settings.gateOwnership = 'defer'
    settings.legacy = { plugin: 'goal-continuity', signal: 'work_checkpoint' }
    const definition = validateDefinition(deferred)
    expect(resolveOwnership(definition, profile()).issues.join('\n')).toMatch(
      /"goal-continuity\/work_checkpoint" is not installed.*retire-legacy-gates/u,
    )
    const resolved = resolveOwnership(definition, profile('goal-continuity'))
    expect(resolved.issues).toEqual([])
    expect(resolved.steps.every((step) => step.ownership === 'defer')).toBe(true)
    expect(resolved.steps[0]?.legacy).toEqual({
      plugin: 'goal-continuity',
      signal: 'work_checkpoint',
    })
  })

  it('refuses a step that claims ownership inside a deferred definition', () => {
    const mixed = valid()
    const settings = mixed.settings as Record<string, unknown>
    settings.gateOwnership = 'defer'
    settings.legacy = { plugin: 'goal-continuity', signal: 'work_checkpoint' }
    firstStep(mixed).ownership = 'own'
    const resolved = resolveOwnership(validateDefinition(mixed), profile('goal-continuity'))
    expect(resolved.issues.join('\n')).toMatch(/defers every step/u)
  })
})

it('checks a deferred step override even when the definition-level source is installed', () => {
  const mixed = valid()
  const settings = mixed.settings as Record<string, unknown>
  settings.gateOwnership = 'defer'
  settings.legacy = { plugin: 'goal-continuity', signal: 'work_checkpoint' }
  firstStep(mixed).legacy = { plugin: 'delegation-rules', signal: 'spec-review' }
  const resolved = resolveOwnership(validateDefinition(mixed), profile('goal-continuity'))
  expect(resolved.issues.join('\n')).toMatch(
    /step "requirements".*"delegation-rules\/spec-review" is not installed.*retire-legacy-gates/u,
  )
})

it('resolves the shipped intake against the shipped strict spec-review rule', () => {
  const fragmentPath = join(packageDir, '..', 'plugin-delegation-rules', 'cordis.fragment.yml')
  const fragment = parse(readFileSync(fragmentPath, 'utf8')) as {
    rows: Array<{ id: string; config: { rules: Array<Record<string, unknown>> } }>
  }
  const row = fragment.rows.find((entry) => entry.id === 'dsh-setup-delegation-rules')
  const rule = row?.config.rules.find((entry) => entry.id === 'spec-review')
  expect(rule).toMatchObject({
    when: 'spec-ready',
    contract: 'review',
    phase: 'spec',
    scope: 'whole',
    gate: 'strict',
  })
  const intake = contributedIntake()
  const resolved = resolveOwnership(intake, profile('delegation-rules', 'goal-continuity'))
  expect(resolved.issues).toEqual([])
  const byId = new Map(resolved.steps.map((step) => [step.id, step]))
  expect(byId.get('spec-review')).toMatchObject({
    ownership: 'defer',
    legacy: { plugin: 'delegation-rules', signal: 'spec-review' },
  })
  expect(byId.get('requirements')?.ownership).toBe('own')
})

it('refuses a dedupe identity the event kind cannot provide', () => {
  const subagent = valid()
  firstStep(subagent).evidence = { kind: 'file', path: 'out.md' }
  const subagentTrigger = subagent.trigger as Record<string, unknown>
  subagentTrigger.kind = 'subagent.end'
  subagentTrigger.match = {}
  subagentTrigger.dedupe = 'callId'
  expect(() => validateDefinition(subagent)).toThrow(
    /trigger\.dedupe "callId" is not available for trigger kind "subagent\.end"/u,
  )
  const change = valid()
  firstStep(change).evidence = { kind: 'file', path: 'out.md' }
  const changeTrigger = change.trigger as Record<string, unknown>
  changeTrigger.kind = 'fs.change'
  changeTrigger.match = {}
  changeTrigger.dedupe = 'name'
  expect(() => validateDefinition(change)).toThrow(
    /trigger\.dedupe "name" is not available for trigger kind "fs\.change"/u,
  )
})

it('rejects a main evidence contract too large for the bounded steer', () => {
  const raw = valid()
  const steps = raw.steps as Array<Record<string, unknown>>
  const step = steps[0] as Record<string, unknown>
  step.evidence = {
    kind: 'all',
    items: Array.from({ length: 40 }, (_, index) => ({
      kind: 'file',
      path: `.dsh/workflows/drafts/{name}/part-${String(index)}.md`,
    })),
  }
  expect(() => validateDefinition(raw)).toThrow(/too long to fit the bounded main-step steer/u)
})

it('requires a closed, supported result schema for a subagent step', () => {
  const withoutSchema = valid()
  const steps = withoutSchema.steps as Array<Record<string, unknown>>
  const step = steps[0] as Record<string, unknown>
  step.executor = 'subagent'
  step.subagent = { provider: 'spawn' }
  delete step.evidence
  expect(() => validateDefinition(withoutSchema)).toThrow(/schema.*required/u)

  const unsupported = valid()
  const unsupportedSteps = unsupported.steps as Array<Record<string, unknown>>
  const unsupportedStep = unsupportedSteps[0] as Record<string, unknown>
  unsupportedStep.executor = 'subagent'
  unsupportedStep.subagent = { provider: 'spawn', schema: { type: 'string', pattern: 'x' } }
  delete unsupportedStep.evidence
  expect(() => validateDefinition(unsupported)).toThrow(/unsupported constraint/u)
})

it('validates the one {name} capture in a command template and a path glob', () => {
  const captured = valid()
  captured.trigger = {
    kind: 'tool.pre-execute',
    match: { tool: 'shell', command: 'acme deploy {name}' },
    mode: 'active',
    dedupe: 'name',
  }
  expect(validateDefinition(captured).trigger.match.command).toBe('acme deploy {name}')

  const pathCaptured = valid()
  pathCaptured.trigger = {
    kind: 'fs.change',
    match: { path: 'openspec/changes/{name}/tasks.md' },
    mode: 'active',
    dedupe: 'path+content-hash',
  }
  expect(validateDefinition(pathCaptured).trigger.match.path).toBe(
    'openspec/changes/{name}/tasks.md',
  )

  for (const command of [
    'acme deploy {name} {name}',
    'acme deploy {}',
    'acme deploy {name',
    'acme deploy {other}',
  ]) {
    const bad = valid()
    bad.trigger = {
      kind: 'tool.pre-execute',
      match: { tool: 'shell', command },
      mode: 'active',
      dedupe: 'name',
    }
    expect(() => validateDefinition(bad)).toThrow(/trigger\.match\.command/u)
  }

  const badPath = valid()
  badPath.trigger = {
    kind: 'fs.change',
    match: { path: 'openspec/{name}x/tasks.md' },
    mode: 'active',
    dedupe: 'none',
  }
  expect(() => validateDefinition(badPath)).toThrow(/whole path segment/u)
})

it('accepts the closed intake gate declaration and refuses another gate', () => {
  const gated = valid()
  gated.settings = {
    ...(gated.settings as Record<string, unknown>),
    gate: 'intake',
  }
  expect(validateDefinition(gated).settings.gate).toBe('intake')

  const unknown = valid()
  unknown.settings = {
    ...(unknown.settings as Record<string, unknown>),
    gate: 'archive',
  }
  expect(() => validateDefinition(unknown)).toThrow(/settings\.gate/u)
})
