import { describe, expect, it } from 'vitest'
import type { RowAggregate } from '../src/host/aggregate.ts'
import { parseRows } from '../src/host/rows.ts'
import {
  boundTools,
  guidanceReadiness,
  type ReadinessSources,
  rowState,
  SILENT_NOTE,
} from '../src/host/status.ts'

function row(raw: unknown) {
  const rows = parseRows({ rows: [raw] })
  const first = rows[0]
  if (first === undefined) throw new Error('fixture row missing')
  return first
}

function aggregate(counts: readonly number[], errors = 0): RowAggregate {
  return { rowId: 'configured', counts, errors }
}

const REGISTRY = new Set(['delegate', 'task_progress'])

describe('row status', () => {
  it('reports not loaded when a configured tool is absent from the registry', () => {
    const state = rowState(
      row({ id: 'x', label: 'X', kind: 'signal', match: [{ tool: 'retired_tool' }] }),
      aggregate([0]),
      REGISTRY,
    )
    expect(state?.status).toBe('not loaded')
    expect(state?.note).toContain('"retired_tool"')
  })

  it('reports silent with the no-traces text for a loaded signal with no traces', () => {
    const state = rowState(
      row({ id: 'x', label: 'X', kind: 'signal', match: [{ tool: 'delegate' }] }),
      aggregate([0, 0]),
      REGISTRY,
    )
    expect(state?.status).toBe('silent')
    expect(state?.note).toBe(SILENT_NOTE)
    expect(state?.note).toContain('not evidence of a fault')
  })

  it('reports active when traces exist and error when any failed', () => {
    const active = rowState(
      row({ id: 'x', label: 'X', kind: 'signal', match: [{ tool: 'delegate' }] }),
      aggregate([2, 1]),
      REGISTRY,
    )
    expect(active?.status).toBe('active')
    expect(active?.note).toContain('3 traces')
    const errored = rowState(
      row({ id: 'x', label: 'X', kind: 'signal', match: [{ tool: 'delegate' }] }),
      aggregate([2, 1], 1),
      REGISTRY,
    )
    expect(errored?.status).toBe('error')
    expect(errored?.note).toContain('1 error trace')
  })

  it('keeps a guidance row out of all four statuses', () => {
    const guidance = row({ id: 'guidance', label: 'Guidance', kind: 'guidance' })
    expect(rowState(guidance, aggregate([0]), REGISTRY)).toBeUndefined()
    expect(rowState(guidance, aggregate([5], 2), REGISTRY)).toBeUndefined()
    expect(boundTools(guidance)).toEqual([])
  })

  it('collects every bound tool of an any-of row without duplicates', () => {
    const tools = boundTools(
      row({
        id: 'x',
        label: 'X',
        kind: 'signal',
        match: [{ tool: 'delegate' }, { tool: 'task_progress' }, { tool: 'delegate' }],
      }),
    )
    expect(tools).toEqual(['delegate', 'task_progress'])
  })
})

describe('guidance readiness', () => {
  const live: ReadinessSources = {
    sections: new Set(['dsh-setup:ponytail']),
    skills: new Set(['ponytail']),
    skillsComplete: true,
  }

  function guidance(raw: unknown) {
    return row({ id: 'g', label: 'G', kind: 'guidance', ...(raw as object) })
  }

  it('reports a present section and a present skill as mounted', () => {
    expect(guidanceReadiness(guidance({ mounted: { section: 'dsh-setup:ponytail' } }), live)).toBe(
      'mounted',
    )
    expect(guidanceReadiness(guidance({ mounted: { skill: 'ponytail' } }), live)).toBe('mounted')
    expect(
      guidanceReadiness(
        guidance({ mounted: { section: 'dsh-setup:ponytail', skill: 'ponytail' } }),
        live,
      ),
    ).toBe('mounted')
  })

  it('reports an absent section or skill as not mounted', () => {
    expect(guidanceReadiness(guidance({ mounted: { section: 'dsh-setup:gone' } }), live)).toBe(
      'not mounted',
    )
    expect(guidanceReadiness(guidance({ mounted: { skill: 'gone' } }), live)).toBe('not mounted')
  })

  it('reports readiness unknown when a registry is unavailable', () => {
    const noPrompt: ReadinessSources = { skills: live.skills, skillsComplete: true }
    const noSkills: ReadinessSources = { sections: live.sections, skillsComplete: false }
    expect(
      guidanceReadiness(guidance({ mounted: { section: 'dsh-setup:ponytail' } }), noPrompt),
    ).toBe('readiness unknown')
    expect(guidanceReadiness(guidance({ mounted: { skill: 'ponytail' } }), noSkills)).toBe(
      'readiness unknown',
    )
  })

  it('never turns an incomplete catalog into absence', () => {
    const partial: ReadinessSources = {
      sections: live.sections,
      skills: new Set(),
      skillsComplete: false,
    }
    expect(guidanceReadiness(guidance({ mounted: { skill: 'ponytail' } }), partial)).toBe(
      'readiness unknown',
    )
    const complete: ReadinessSources = {
      sections: live.sections,
      skills: new Set(),
      skillsComplete: true,
    }
    expect(guidanceReadiness(guidance({ mounted: { skill: 'ponytail' } }), complete)).toBe(
      'not mounted',
    )
  })

  it('leaves an undeclared guidance row without a readiness word', () => {
    expect(guidanceReadiness(guidance({}), live)).toBeUndefined()
  })
})
