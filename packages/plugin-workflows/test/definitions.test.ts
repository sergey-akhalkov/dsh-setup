import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadApprovedDefinitions } from '../src/host/approval-store.ts'
import {
  type Definition,
  loadShippedDefinitions,
  resolveOwnership,
  validateDefinition,
} from '../src/host/definitions.ts'
import { HostAuth } from '../src/host/host-auth.ts'

const TEMP_DIRECTORIES: string[] = []

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
      match: { tool: 'shell', command: 'openspec new change <name>' },
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
  it('loads the complete shipped change-intake definition with its all contracts', () => {
    const definitions = loadShippedDefinitions()
    const intake = definitions.find((definition) => definition.id === 'change-intake')
    expect(intake).toBeDefined()
    const definition = intake as Definition
    expect(definition.name).toBe('OpenSpec change intake')
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

  it('loads a valid definition and keeps its normalized step by id', () => {
    const definition = validateDefinition(valid())
    expect(definition.id).toBe('auth-draft')
    expect(definition.steps[0]?.id).toBe('requirements')
    expect(definition.steps[0]?.next).toBe('end')
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
  it('keeps the shipped intake own for its own steps and defers only spec-review', () => {
    const intake = loadShippedDefinitions().find((definition) => definition.id === 'change-intake')
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
    const intake = loadShippedDefinitions().find((definition) => definition.id === 'change-intake')
    const missing = resolveOwnership(intake as Definition, profile())
    expect(missing.issues.join('\n')).toMatch(
      /step "spec-review".*"delegation-rules\/spec-review" is not installed.*retire-legacy-gates/u,
    )
    const workspace = await tempWorkspace()
    const refused = await loadApprovedDefinitions(workspace, {
      auth: HostAuth.fromKey('test-ownership-host-key-0123'),
      installedLegacy: profile(),
    })
    expect(refused.definitions.map((definition) => definition.id)).not.toContain('change-intake')
    expect(refused.errors.join('\n')).toMatch(/retire-legacy-gates/u)
    const loaded = await loadApprovedDefinitions(workspace, {
      auth: HostAuth.fromKey('test-ownership-host-key-0123'),
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
      /step "requirements".*"delegation-rules\/task-review" is installed.*retire-legacy-gates/u,
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
