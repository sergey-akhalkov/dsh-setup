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
  it('loads the shipped catalog with every supported event kind', () => {
    const triggers = loadCatalog()
    expect(triggers.length).toBeGreaterThanOrEqual(9)
    expect(new Set(triggers.map((trigger) => trigger.id)).size).toBe(triggers.length)
    for (const trigger of triggers) {
      expect(EVENT_KINDS).toContain(trigger.event)
      expect(trigger.mode).toBe('shadow')
      expect(['none', 'path+content-hash']).toContain(trigger.dedupe)
    }
    expect(triggers.map((trigger) => trigger.event)).toEqual(
      expect.arrayContaining([...EVENT_KINDS]),
    )
    const tasks = triggers.find((trigger) => trigger.id === 'openspec-tasks-checked')
    expect(tasks?.filter.path).toBe('openspec/changes/**/tasks.md')
    expect(tasks?.filter.change).toBe('created-or-modified')
    expect(tasks?.dedupe).toBe('path+content-hash')
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
  return obligation('intent-def', {
    kind: 'intent',
    match: { intent: 'new-change', classifier: 'heuristic-v1' },
    mode,
    dedupe: 'none',
  })
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
    match: { workspace: 'D:/work/**' },
    mode: 'shadow',
    dedupe: 'turn',
  })
  const matched = evaluateDefinitionTrigger(
    definition,
    stopEvent({ workspace: 'D:\\work\\repo' }),
    { isDuplicate: () => false },
  )
  expect(matched).toMatchObject({ matched: true, reason: 'would-fire' })
  const mismatch = evaluateDefinitionTrigger(
    definition,
    stopEvent({ workspace: 'D:\\other\\repo' }),
    { isDuplicate: () => false },
  )
  expect(mismatch).toMatchObject({ matched: false, reason: 'filter-mismatch' })
})
