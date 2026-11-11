import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type Definition, validateDefinition } from '../src/host/definitions.ts'
import {
  type DefinitionEvent,
  EVENT_KINDS,
  evaluateDefinitions,
  evaluateDefinitionTrigger,
  evaluateIntents,
  type IntentClassification,
  loadCatalog,
  obligationDedupeKey,
  validateCatalog,
} from '../src/host/triggers.ts'

const packageDir = fileURLToPath(new URL('..', import.meta.url))

describe('shadow trigger catalog', () => {
  it('loads the shipped generic catalog with every supported event kind', () => {
    const triggers = loadCatalog()
    expect(triggers).toHaveLength(5)
    expect(new Set(triggers.map((trigger) => trigger.id)).size).toBe(triggers.length)
    for (const trigger of triggers) {
      expect(EVENT_KINDS).toContain(trigger.event)
      expect(trigger.mode).toBe('shadow')
      expect(['none', 'path+content-hash']).toContain(trigger.dedupe)
    }
    // The OpenSpec fs.change entries are contributed by the OpenSpec plugin,
    // not shipped by the engine.
    expect(triggers.map((trigger) => trigger.id)).not.toContain('openspec-tasks-checked')
  })

  it('loads the catalog from the compiled lib layout too', async () => {
    const compiled = join(packageDir, 'lib', 'triggers.js')
    if (!existsSync(compiled)) throw new Error('run `pnpm build` before this test')
    const module = (await import(pathToFileURL(compiled).href)) as {
      loadCatalog(): unknown[]
    }
    expect(module.loadCatalog()).toHaveLength(loadCatalog().length)
  })

  it('accepts a valid trigger without a filter', () => {
    const triggers = validateCatalog({
      triggers: [{ id: 'worker', event: 'subagent.start', mode: 'shadow', dedupe: 'none' }],
    })
    expect(triggers).toEqual([
      { id: 'worker', event: 'subagent.start', filter: {}, mode: 'shadow', dedupe: 'none' },
    ])
  })

  it('refuses an unknown event and names the trigger and field', () => {
    expect(() =>
      validateCatalog({
        triggers: [{ id: 'bad', event: 'intent.change', mode: 'shadow', dedupe: 'none' }],
      }),
    ).toThrow(/trigger "bad".*field "event"/u)
  })

  it('refuses an empty id, an invalid filter, a mode, and a duplicate', () => {
    expect(() =>
      validateCatalog({
        triggers: [{ id: '', event: 'tool.result', mode: 'shadow', dedupe: 'none' }],
      }),
    ).toThrow(/field ".*id"/u)
    expect(() =>
      validateCatalog({
        triggers: [
          { id: 'bad', event: 'tool.result', filter: 'nope', mode: 'shadow', dedupe: 'none' },
        ],
      }),
    ).toThrow(/trigger "bad".*field "filter"/u)
    expect(() =>
      validateCatalog({
        triggers: [
          {
            id: 'bad',
            event: 'tool.result',
            filter: { nope: 'x' },
            mode: 'shadow',
            dedupe: 'none',
          },
        ],
      }),
    ).toThrow(/field "filter.nope"/u)
    expect(() =>
      validateCatalog({
        triggers: [{ id: 'bad', event: 'tool.result', mode: 'active', dedupe: 'none' }],
      }),
    ).toThrow(/field "mode"/u)
    expect(() =>
      validateCatalog({
        triggers: [{ id: 'bad', event: 'tool.result', mode: 'shadow', dedupe: 'sometimes' }],
      }),
    ).toThrow(/field "dedupe"/u)
    expect(() =>
      validateCatalog({
        triggers: [
          { id: 'same', event: 'tool.result', mode: 'shadow', dedupe: 'none' },
          { id: 'same', event: 'tool.result', mode: 'shadow', dedupe: 'none' },
        ],
      }),
    ).toThrow(/field "id"/u)
  })
})

/** A one-step definition whose only trigger is the test trigger. */
function obligation(id: string, trigger: Record<string, unknown>): Definition {
  return validateDefinition({
    v: 1,
    id,
    name: id,
    version: 1,
    trigger,
    settings: {
      allowModelStart: false,
      risk: 'low',
      gateOwnership: 'own',
      maxBlocks: 3,
      allowIntent: false,
    },
    steps: [
      {
        id: 'only',
        title: 'Only step',
        executor: 'main',
        prompt: 'Do the work.',
        evidence: { kind: 'file', path: 'out.md' },
        next: 'end',
      },
    ],
  })
}

function stopEvent(overrides: Partial<DefinitionEvent> = {}): DefinitionEvent {
  return {
    kind: 'turn.stopping',
    subject: 'stop-attempt',
    session: 'session-1',
    turn: 3,
    ...overrides,
  }
}

describe('definition triggers', () => {
  it('records a shadow match without creating a run', () => {
    const definition = obligation('shadow-def', {
      kind: 'turn.stopping',
      match: {},
      mode: 'shadow',
      dedupe: 'turn',
    })
    const runs: string[] = []
    const rows = evaluateDefinitions([definition], stopEvent(), {
      isDuplicate: () => false,
      startRun: (matched) => {
        runs.push(matched.id)
        return { ok: true }
      },
    })
    expect(rows).toEqual([
      { definition: 'shadow-def', trigger: 'turn.stopping', matched: true, reason: 'would-fire' },
    ])
    expect(runs).toEqual([])
  })

  it('creates one run for an active match and suppresses a duplicate', () => {
    const definition = obligation('active-def', {
      kind: 'turn.stopping',
      match: {},
      mode: 'active',
      dedupe: 'turn',
    })
    const seen = new Map<string, number>()
    const runs: string[] = []
    const context = {
      isDuplicate: (key: string) => seen.has(key),
      markKey: (key: string) => seen.set(key, 1),
      startRun: () => {
        runs.push('created')
        return { ok: true }
      },
    }
    expect(evaluateDefinitions([definition], stopEvent(), context)[0]).toMatchObject({
      matched: true,
      reason: 'run-created',
    })
    expect(evaluateDefinitions([definition], stopEvent(), context)[0]).toEqual({
      definition: 'active-def',
      trigger: 'turn.stopping',
      matched: false,
      reason: 'dedupe',
    })
    expect(runs).toEqual(['created'])
  })

  it('honors the repeat flag for the same subject', () => {
    const definition = obligation('repeat-def', {
      kind: 'turn.stopping',
      match: {},
      mode: 'active',
      dedupe: 'turn',
      repeat: true,
    })
    const seen = new Map<string, number>()
    let created = 0
    const context = {
      isDuplicate: (key: string) => seen.has(key),
      markKey: (key: string) => seen.set(key, 1),
      startRun: () => {
        created += 1
        return { ok: true }
      },
    }
    expect(evaluateDefinitions([definition], stopEvent(), context)[0]?.reason).toBe('run-created')
    expect(evaluateDefinitions([definition], stopEvent(), context)[0]?.reason).toBe('run-created')
    expect(created).toBe(2)
  })

  it('records a filter mismatch and a non-applicable evaluation', () => {
    const filtered = obligation('tasks-def', {
      kind: 'fs.change',
      match: { path: 'openspec/changes/**/tasks.md' },
      mode: 'active',
      dedupe: 'path+content-hash',
    })
    const mismatch = evaluateDefinitionTrigger(
      filtered,
      {
        kind: 'fs.change',
        subject: 'openspec/changes/auth/design.md',
        path: 'openspec/changes/auth/design.md',
      },
      { isDuplicate: () => false },
    )
    expect(mismatch).toMatchObject({
      matched: false,
      reason: 'filter-mismatch',
      path: 'openspec/changes/auth/design.md',
      filter: 'path: openspec/changes/**/tasks.md',
    })
    const retro = obligation('retro-def', {
      kind: 'turn.stopping',
      match: {},
      mode: 'shadow',
      dedupe: 'turn',
      applicability: 'checkpoint-required',
    })
    const rows = evaluateDefinitions([retro], stopEvent(), {
      isDuplicate: () => false,
      resolveApplicability: () => false,
    })
    expect(rows[0]).toMatchObject({ matched: false, reason: 'not-applicable' })
    const unknown = evaluateDefinitions([retro], stopEvent(), { isDuplicate: () => false })
    expect(unknown[0]).toMatchObject({ matched: false, reason: 'not-ready' })
  })

  it('reports a suppressed run with its bounded cause and an engine off switch', () => {
    const definition = obligation('active-def', {
      kind: 'turn.stopping',
      match: {},
      mode: 'active',
      dedupe: 'turn',
    })
    const suppressed = evaluateDefinitions([definition], stopEvent(), {
      isDuplicate: () => false,
      startRun: () => ({ ok: false, reason: 'maxRuns reached' }),
    })
    expect(suppressed[0]).toMatchObject({
      matched: true,
      reason: 'run-suppressed',
      detail: 'maxRuns reached',
    })
    const disabled = evaluateDefinitionTrigger(definition, stopEvent(), {
      enabled: false,
      isDuplicate: () => false,
    })
    expect(disabled).toMatchObject({ matched: false, reason: 'disabled' })
  })

  it('keys dedupe by definition, policy, session, and subject', () => {
    const definition = obligation('key-def', {
      kind: 'turn.stopping',
      match: {},
      mode: 'shadow',
      dedupe: 'turn',
    })
    const key = obligationDedupeKey(definition.id, definition.trigger, stopEvent())
    expect(key).toContain('key-def')
    expect(key).toContain('session-1')
    expect(key).toContain('turn')
    expect(key).toContain('3')
    const other = obligationDedupeKey(definition.id, definition.trigger, stopEvent({ turn: 4 }))
    expect(other).not.toBe(key)
    const fsTrigger = obligation('path-def', {
      kind: 'fs.change',
      match: {},
      mode: 'shadow',
      dedupe: 'path+content-hash',
    })
    const pathKey = obligationDedupeKey(fsTrigger.id, fsTrigger.trigger, {
      kind: 'fs.change',
      subject: 'openspec/changes/a/tasks.md',
      path: 'openspec/changes/a/tasks.md',
      hash: 'abc',
      session: 'session-1',
    })
    expect(pathKey).toContain('openspec/changes/a/tasks.md')
    expect(pathKey).toContain('abc')
  })
})

const INTENT: IntentClassification = {
  intent: 'new-change',
  confidence: 0.82,
  reason: 'the user asks to start a new change',
  classifier: 'heuristic-v1',
}

function intentDefinition(mode: 'shadow' | 'active'): Definition {
  const base = obligation('intent-def', {
    kind: 'intent',
    match: { intent: 'new-change', classifier: 'heuristic-v1' },
    mode,
    dedupe: 'none',
  })
  return { ...base, settings: { ...base.settings, allowIntent: true } }
}

function optedInIntent(id: string, dedupe: string): Definition {
  const base = obligation(id, {
    kind: 'intent',
    match: { intent: 'new-change', classifier: 'heuristic-v1' },
    mode: 'active',
    dedupe,
  })
  return { ...base, settings: { ...base.settings, allowIntent: true } }
}

describe('intent trigger', () => {
  it('records the classifier, confidence, and reason while staying shadow', () => {
    let created = 0
    const rows = evaluateIntents([intentDefinition('active')], INTENT, {
      allowIntent: false,
      confirmed: false,
      isDuplicate: () => false,
      startRun: () => {
        created += 1
        return { ok: true }
      },
    })
    expect(created).toBe(0)
    expect(rows[0]).toMatchObject({
      definition: 'intent-def',
      trigger: 'intent',
      matched: true,
      reason: 'would-fire',
    })
    expect(rows[0]?.detail).toContain('classifier=heuristic-v1')
    expect(rows[0]?.detail).toContain('confidence=0.82')
    expect(rows[0]?.detail).toContain('reason=the user asks to start a new change')
    expect(rows[0]?.detail).toContain('allowIntent is false')
  })

  it('refuses an active run without a user-confirmed definition', () => {
    let created = 0
    const rows = evaluateIntents([intentDefinition('active')], INTENT, {
      allowIntent: true,
      confirmed: false,
      isDuplicate: () => false,
      startRun: () => {
        created += 1
        return { ok: true }
      },
    })
    expect(created).toBe(0)
    expect(rows[0]?.reason).toBe('would-fire')
    expect(rows[0]?.detail).toContain('user-confirmed')
  })

  it('starts one run for a confirmed, opted-in definition', () => {
    let created = 0
    const rows = evaluateIntents([intentDefinition('active')], INTENT, {
      allowIntent: true,
      confirmed: true,
      isDuplicate: () => false,
      startRun: () => {
        created += 1
        return { ok: true }
      },
    })
    expect(created).toBe(1)
    expect(rows[0]?.reason).toBe('run-created')
  })

  it('records a classifier or intent mismatch as a filter mismatch', () => {
    const shadow = evaluateIntents([intentDefinition('shadow')], INTENT, {
      allowIntent: false,
      confirmed: false,
      isDuplicate: () => false,
    })
    expect(shadow[0]?.reason).toBe('would-fire')
    const other = evaluateIntents(
      [intentDefinition('shadow')],
      { ...INTENT, intent: 'bug-fix' },
      { allowIntent: false, confirmed: false, isDuplicate: () => false },
    )
    expect(other[0]).toMatchObject({ matched: false, reason: 'filter-mismatch' })
    expect(other[0]?.filter).toBe('intent: new-change')
  })
})

describe('definition trigger wiring regressions', () => {
  it('matches a workspace filter with the resolved workspace', () => {
    const definition = obligation('workspace-def', {
      kind: 'turn.stopping',
      match: { workspace: '/workspace/**' },
      mode: 'shadow',
      dedupe: 'turn',
    })
    const matched = evaluateDefinitionTrigger(
      definition,
      stopEvent({ workspace: '/workspace/project' }),
      { isDuplicate: () => false },
    )
    expect(matched).toMatchObject({ matched: true, reason: 'would-fire' })
    const mismatch = evaluateDefinitionTrigger(
      definition,
      stopEvent({ workspace: '/other/project' }),
      { isDuplicate: () => false },
    )
    expect(mismatch).toMatchObject({ matched: false, reason: 'filter-mismatch' })
  })

  it('does not consume the dedupe key for a suppressed active start', () => {
    const definition = obligation('retry-def', {
      kind: 'turn.stopping',
      match: {},
      mode: 'active',
      dedupe: 'turn',
    })
    const seen = new Map<string, number>()
    let attempts = 0
    const context = {
      isDuplicate: (key: string) => seen.has(key),
      markKey: (key: string) => seen.set(key, 1),
      startRun: () => {
        attempts += 1
        return attempts === 1
          ? { ok: false, reason: 'the host key is not ready' }
          : { ok: true, runId: 'run-9' }
      },
    }
    expect(evaluateDefinitions([definition], stopEvent(), context)[0]).toMatchObject({
      matched: true,
      reason: 'run-suppressed',
    })
    const retried = evaluateDefinitions([definition], stopEvent(), context)[0]
    expect(retried).toMatchObject({ matched: true, reason: 'run-created', runId: 'run-9' })
    expect(attempts).toBe(2)
  })

  it('carries the created run id on the run-created evaluation', () => {
    const definition = obligation('runid-def', {
      kind: 'turn.stopping',
      match: {},
      mode: 'active',
      dedupe: 'turn',
    })
    const rows = evaluateDefinitions([definition], stopEvent(), {
      isDuplicate: () => false,
      startRun: () => ({ ok: true, runId: 'run-created-1' }),
    })
    expect(rows[0]).toMatchObject({ reason: 'run-created', runId: 'run-created-1' })
  })
})

it('matches a Windows workspace path after separator normalization', () => {
  const definition = obligation('win-workspace', {
    kind: 'turn.stopping',
    match: { workspace: 'work/**' },
    mode: 'shadow',
    dedupe: 'turn',
  })
  const matched = evaluateDefinitionTrigger(definition, stopEvent({ workspace: 'work\\repo' }), {
    isDuplicate: () => false,
  })
  expect(matched).toMatchObject({ matched: true, reason: 'would-fire' })
  const mismatch = evaluateDefinitionTrigger(definition, stopEvent({ workspace: 'other\\repo' }), {
    isDuplicate: () => false,
  })
  expect(mismatch).toMatchObject({ matched: false, reason: 'filter-mismatch' })
})

it('does not collapse a missing dedupe identity onto an empty value', () => {
  const named = obligation('missing-name', {
    kind: 'tool.pre-execute',
    match: { tool: 'read' },
    mode: 'shadow',
    dedupe: 'name',
  })
  expect(
    obligationDedupeKey(named.id, named.trigger, {
      kind: 'tool.pre-execute',
      subject: 'read',
      tool: 'read',
      session: 'session-1',
    }),
  ).toBeUndefined()
  const called = obligation('missing-call', {
    kind: 'tool.pre-execute',
    match: { tool: 'read' },
    mode: 'shadow',
    dedupe: 'callId',
  })
  expect(
    obligationDedupeKey(called.id, called.trigger, {
      kind: 'tool.pre-execute',
      subject: 'read',
      tool: 'read',
      session: 'session-1',
    }),
  ).toBeUndefined()
})

it('respects dedupe none for repeated intent classifications', () => {
  const definition = optedInIntent('intent-none', 'none')
  let created = 0
  const context = {
    allowIntent: true,
    confirmed: true,
    session: 'session-1',
    turn: 1,
    isDuplicate: () => false,
    markKey: () => undefined,
    startRun: () => {
      created += 1
      return { ok: true, runId: `run-${String(created)}` }
    },
  }
  expect(evaluateIntents([definition], INTENT, context)[0]).toMatchObject({
    reason: 'run-created',
  })
  expect(evaluateIntents([definition], INTENT, context)[0]).toMatchObject({
    reason: 'run-created',
  })
  expect(created).toBe(2)
})

it('dedupes an intent within a turn and allows another turn', () => {
  const definition = optedInIntent('intent-turn', 'turn')
  const seen = new Set<string>()
  const contextFor = (turn: number) => ({
    allowIntent: true,
    confirmed: true,
    session: 'session-1',
    turn,
    isDuplicate: (key: string) => seen.has(key),
    markKey: (key: string) => seen.add(key),
    startRun: () => ({ ok: true, runId: 'run-1' }),
  })
  expect(evaluateIntents([definition], INTENT, contextFor(1))[0]?.reason).toBe('run-created')
  expect(evaluateIntents([definition], INTENT, contextFor(1))[0]?.reason).toBe('dedupe')
  expect(evaluateIntents([definition], INTENT, contextFor(2))[0]?.reason).toBe('run-created')
})

it('retries a suppressed intent start and keeps the classification detail', () => {
  const definition = optedInIntent('intent-retry', 'turn')
  const seen = new Set<string>()
  let attempts = 0
  const context = {
    allowIntent: true,
    confirmed: true,
    session: 'session-1',
    turn: 5,
    isDuplicate: (key: string) => seen.has(key),
    markKey: (key: string) => seen.add(key),
    startRun: () => {
      attempts += 1
      return attempts === 1
        ? { ok: false, reason: 'capacity full' }
        : { ok: true, runId: 'run-retried' }
    },
  }
  const first = evaluateIntents([definition], INTENT, context)[0]
  expect(first?.reason).toBe('run-suppressed')
  expect(String(first?.detail)).toContain('classifier=heuristic-v1')
  expect(String(first?.detail)).toContain('capacity full')
  const second = evaluateIntents([definition], INTENT, context)[0]
  expect(second?.reason).toBe('run-created')
  expect(attempts).toBe(2)
})

it('keeps the classification detail when no start is registered', () => {
  const definition = optedInIntent('intent-no-starter', 'turn')
  const row = evaluateIntents([definition], INTENT, {
    allowIntent: true,
    confirmed: true,
    session: 'session-1',
    turn: 1,
    isDuplicate: () => false,
  })[0]
  expect(row?.reason).toBe('run-suppressed')
  expect(String(row?.detail)).toContain('classifier=heuristic-v1')
  expect(String(row?.detail)).toContain('no run starter')
})

it('does not start an opted-out intent because another definition opted in', () => {
  const optedOut = obligation('intent-out', {
    kind: 'intent',
    match: { intent: 'new-change' },
    mode: 'active',
    dedupe: 'turn',
  })
  const optedIn = optedInIntent('intent-in', 'turn')
  let created = 0
  const rows = evaluateIntents([optedOut, optedIn], INTENT, {
    allowIntent: true,
    confirmed: true,
    session: 'session-1',
    turn: 1,
    isDuplicate: () => false,
    markKey: () => undefined,
    startRun: () => {
      created += 1
      return { ok: true, runId: 'run-1' }
    },
  })
  expect(rows.find((row) => row.definition === 'intent-out')?.reason).toBe('would-fire')
  expect(rows.find((row) => row.definition === 'intent-in')?.reason).toBe('run-created')
  expect(created).toBe(1)
})

it('enforces an intent session filter', () => {
  const definition = obligation('intent-session', {
    kind: 'intent',
    match: { intent: 'new-change', session: 'another-session' },
    mode: 'active',
    dedupe: 'turn',
  })
  const rows = evaluateIntents([definition], INTENT, {
    allowIntent: true,
    confirmed: true,
    session: 'session-1',
    turn: 1,
    isDuplicate: () => false,
    startRun: () => ({ ok: true, runId: 'run-1' }),
  })
  expect(rows[0]).toMatchObject({
    reason: 'filter-mismatch',
    filter: 'session: another-session',
  })
})

it('captures the name from a command template and keys dedupe by it', () => {
  const definition = obligation('deploy-def', {
    kind: 'tool.pre-execute',
    match: { tool: 'shell', command: 'acme deploy {name}' },
    mode: 'active',
    dedupe: 'name',
  })
  const event: DefinitionEvent = {
    kind: 'tool.pre-execute',
    subject: 'shell',
    tool: 'shell',
    command: 'rtk acme deploy auth',
    session: 'session-1',
  }
  const seen = new Map<string, number>()
  const captures: Array<string | undefined> = []
  const rows = evaluateDefinitions([definition], event, {
    isDuplicate: (key) => seen.has(key),
    markKey: (key) => seen.set(key, 1),
    startRun: (_definition, _event, capture) => {
      captures.push(capture)
      return { ok: true }
    },
  })
  expect(rows[0]).toMatchObject({ matched: true, reason: 'run-created', capture: 'auth' })
  expect(captures).toEqual(['auth'])
  const key = obligationDedupeKey(definition.id, definition.trigger, event, 'auth')
  expect(key).toContain('auth')
  expect(obligationDedupeKey(definition.id, definition.trigger, event)).toBeUndefined()
  const second = evaluateDefinitions([definition], event, {
    isDuplicate: (key) => seen.has(key),
    markKey: (key) => seen.set(key, 1),
    startRun: () => ({ ok: true }),
  })
  expect(second[0]).toMatchObject({ matched: false, reason: 'dedupe' })
})

it('captures the name from a path glob and passes it to the run start', () => {
  const definition = obligation('path-def', {
    kind: 'fs.change',
    match: { path: 'openspec/changes/{name}/tasks.md' },
    mode: 'active',
    dedupe: 'path+content-hash',
  })
  const captures: Array<string | undefined> = []
  const rows = evaluateDefinitions(
    [definition],
    {
      kind: 'fs.change',
      subject: 'openspec/changes/auth/tasks.md',
      path: 'openspec/changes/auth/tasks.md',
      hash: 'abc',
      session: 'session-1',
    },
    {
      isDuplicate: () => false,
      startRun: (_definition, _event, capture) => {
        captures.push(capture)
        return { ok: true }
      },
    },
  )
  expect(rows[0]).toMatchObject({ matched: true, reason: 'run-created', capture: 'auth' })
  expect(captures).toEqual(['auth'])
})
