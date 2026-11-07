import { describe, expect, it } from 'vitest'
import {
  type EvaluationContext,
  evaluate,
  evaluateEvent,
  evaluationKey,
  globMatches,
  type ObservedEvent,
} from '../src/host/evaluate.ts'
import type { Trigger } from '../src/host/triggers.ts'

function trigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'delegate-result',
    event: 'tool.result',
    filter: { tool: 'delegate' },
    mode: 'shadow',
    dedupe: 'none',
    ...overrides,
  }
}

function context(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    ready: true,
    isDuplicate: () => false,
    ...overrides,
  }
}

function event(overrides: Partial<ObservedEvent> = {}): ObservedEvent {
  return { kind: 'tool.result', subject: 'delegate', tool: 'delegate', ...overrides }
}

describe('shadow trigger evaluation', () => {
  it('reports would-fire for a matching shadow trigger', () => {
    expect(evaluate(trigger(), event(), context())).toEqual({
      matched: true,
      reason: 'would-fire',
    })
  })

  it('reports event-mismatch for another event kind', () => {
    expect(evaluate(trigger(), event({ kind: 'agent.turn-start' }), context())).toEqual({
      matched: false,
      reason: 'event-mismatch',
    })
  })

  it('explains a path filter mismatch with the path and the filter', () => {
    const result = evaluate(
      trigger({
        event: 'fs.change',
        filter: { path: 'openspec/changes/**/tasks.md' },
        dedupe: 'path+content-hash',
      }),
      event({ kind: 'fs.change', subject: 'src/index.ts', change: 'modified' }),
      context(),
    )
    expect(result.reason).toBe('filter-mismatch')
    expect(result.path).toBe('src/index.ts')
    expect(result.filter).toBe('path: openspec/changes/**/tasks.md')
  })

  it('explains a tool filter mismatch', () => {
    const result = evaluate(trigger(), event({ tool: 'read' }), context())
    expect(result.reason).toBe('filter-mismatch')
    expect(result.filter).toBe('tool: delegate')
  })

  it('reports dedupe for a duplicate path+content-hash event', () => {
    const matching = trigger({
      event: 'fs.change',
      filter: { path: 'openspec/changes/**/tasks.md' },
      dedupe: 'path+content-hash',
    })
    const observed = event({
      kind: 'fs.change',
      subject: 'openspec/changes/add-x/tasks.md',
      change: 'modified',
      hash: 'abc',
    })
    expect(evaluationKey(matching, observed)).toBe('openspec/changes/add-x/tasks.md\u0000abc')
    expect(evaluate(matching, observed, context({ isDuplicate: () => true }))).toEqual({
      matched: false,
      reason: 'dedupe',
    })
  })

  it('reports disabled and not-ready without evaluating the filter', () => {
    expect(evaluate(trigger({ mode: 'disabled' }), event(), context())).toEqual({
      matched: false,
      reason: 'disabled',
    })
    expect(evaluate(trigger(), event(), context({ ready: false }))).toEqual({
      matched: false,
      reason: 'not-ready',
    })
  })

  it('records one matched row and one dedupe row for a repeated file event', () => {
    const triggers = [
      trigger({
        id: 'openspec-tasks-checked',
        event: 'fs.change',
        filter: { path: 'openspec/changes/**/tasks.md', change: 'created-or-modified' },
        dedupe: 'path+content-hash',
      }),
    ]
    const observed = event({
      kind: 'fs.change',
      subject: 'openspec/changes/add-x/tasks.md',
      change: 'modified',
      hash: 'abc',
    })
    const seen = new Map<string, number>()
    const first = evaluateEvent(triggers, observed, seen, true, 1000)
    expect(first).toHaveLength(1)
    expect(first[0]?.matched).toBe(true)
    expect(first[0]?.reason).toBe('would-fire')
    const second = evaluateEvent(triggers, observed, seen, true, 1100)
    expect(second[0]?.matched).toBe(false)
    expect(second[0]?.reason).toBe('dedupe')
    const changed = evaluateEvent(triggers, { ...observed, hash: 'def' }, seen, true, 1200)
    expect(changed[0]?.reason).toBe('would-fire')
    const restored = evaluateEvent(triggers, observed, seen, true, 1600)
    expect(restored[0]?.reason).toBe('would-fire')
  })

  it('contains an internal evaluation error', () => {
    const dedupe = trigger({ dedupe: 'path+content-hash' })
    expect(
      evaluate(
        dedupe,
        event(),
        context({
          isDuplicate: () => {
            throw new Error('boom')
          },
        }),
      ),
    ).toEqual({ matched: false, reason: 'error', detail: 'boom' })
  })
})

describe('glob matching', () => {
  it('matches within a segment, across segments, and zero segments', () => {
    expect(globMatches('openspec/changes/*/tasks.md', 'openspec/changes/add-x/tasks.md')).toBe(true)
    expect(
      globMatches('openspec/changes/*/tasks.md', 'openspec/changes/nested/add-x/tasks.md'),
    ).toBe(false)
    expect(globMatches('openspec/changes/**/tasks.md', 'openspec/changes/add-x/tasks.md')).toBe(
      true,
    )
    expect(globMatches('openspec/changes/**/tasks.md', 'openspec/changes/a/b/tasks.md')).toBe(true)
    expect(
      globMatches('openspec/changes/**/reviews/*.json', 'openspec/changes/add-x/reviews/t.json'),
    ).toBe(true)
    expect(
      globMatches('openspec/changes/**/reviews/*.json', 'openspec/changes/add-x/reviews/t.txt'),
    ).toBe(false)
  })
})
