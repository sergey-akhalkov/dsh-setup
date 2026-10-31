import { describe, expect, it } from 'vitest'
import { parseRows, RowConfigError } from '../src/host/rows.ts'

/** Read the message of the config error a call must throw. */
function rejection(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (error instanceof RowConfigError) return error.message
    throw error
  }
  throw new Error('expected a RowConfigError')
}

describe('row schema', () => {
  it('accepts a signal row and an any-of predicate list', () => {
    expect(
      parseRows({
        rows: [
          {
            id: 'delegation',
            label: 'Delegation',
            kind: 'signal',
            match: [{ tool: 'delegate' }, { tool: 'task_progress' }],
          },
          {
            id: 'abort',
            label: 'Goal abort',
            kind: 'signal',
            match: [{ abortPrefix: 'goal-' }],
          },
          {
            id: 'scratch',
            label: 'Scratch tool',
            kind: 'signal',
            match: [{ tool: 'write', argument: { field: 'path', value: 'notes.md' } }],
          },
        ],
      }),
    ).toEqual([
      {
        id: 'delegation',
        label: 'Delegation',
        kind: 'signal',
        match: [{ tool: 'delegate' }, { tool: 'task_progress' }],
      },
      {
        id: 'abort',
        label: 'Goal abort',
        kind: 'signal',
        match: [{ abortPrefix: 'goal-' }],
      },
      {
        id: 'scratch',
        label: 'Scratch tool',
        kind: 'signal',
        match: [{ tool: 'write', argument: { field: 'path', value: 'notes.md' } }],
      },
    ])
  })

  it('normalizes a single predicate object and preserves every supported field', () => {
    expect(
      parseRows({
        rows: [
          {
            id: 'all-fields',
            label: 'Every field',
            kind: 'signal',
            match: {
              eventType: 'tool/call',
              tool: 'write',
              sourceKind: 'goal',
              abortPrefix: 'goal-',
              command: 'compact',
              argument: { field: 'path', value: 'notes.md' },
            },
          },
        ],
      }),
    ).toEqual([
      {
        id: 'all-fields',
        label: 'Every field',
        kind: 'signal',
        match: [
          {
            eventType: 'tool/call',
            tool: 'write',
            sourceKind: 'goal',
            abortPrefix: 'goal-',
            command: 'compact',
            argument: { field: 'path', value: 'notes.md' },
          },
        ],
      },
    ])
  })

  it('accepts a guidance row without a match', () => {
    expect(parseRows({ rows: [{ id: 'ponytail', label: 'Ponytail', kind: 'guidance' }] })).toEqual([
      { id: 'ponytail', label: 'Ponytail', kind: 'guidance' },
    ])
  })

  it('treats absent configuration as no configured rows', () => {
    expect(parseRows(undefined)).toEqual([])
    expect(parseRows({})).toEqual([])
    expect(parseRows({ rows: [] })).toEqual([])
  })

  it('names an unknown row field', () => {
    expect(rejection(() => parseRows({ rows: [{ id: 'a', label: 'A', kin: 'signal' }] }))).toBe(
      'observability config: rows[0]: unknown field "kin"',
    )
  })

  it('names an unknown predicate field', () => {
    expect(
      rejection(() =>
        parseRows({
          rows: [{ id: 'a', label: 'A', kind: 'signal', match: [{ toolName: 'x' }] }],
        }),
      ),
    ).toBe('observability config: rows[0].match[0]: unknown field "toolName"')
  })

  it('names an unknown top-level config field', () => {
    expect(rejection(() => parseRows({ row: [] }))).toBe(
      'observability config: config: unknown field "row"',
    )
  })

  it('rejects a guidance row that carries a match', () => {
    expect(
      rejection(() =>
        parseRows({
          rows: [{ id: 'a', label: 'A', kind: 'guidance', match: [{ tool: 'x' }] }],
        }),
      ),
    ).toContain('rows[0].match is not allowed on a guidance row')
  })

  it('rejects a signal row without a match and an empty any-of list', () => {
    expect(rejection(() => parseRows({ rows: [{ id: 'a', label: 'A', kind: 'signal' }] }))).toBe(
      'observability config: rows[0].match is required on a signal row',
    )
    expect(
      rejection(() => parseRows({ rows: [{ id: 'a', label: 'A', kind: 'signal', match: [] }] })),
    ).toBe('observability config: rows[0].match must not be empty')
  })

  it('rejects a predicate with no field', () => {
    expect(
      rejection(() => parseRows({ rows: [{ id: 'a', label: 'A', kind: 'signal', match: [{}] }] })),
    ).toBe('observability config: rows[0].match[0] names no predicate field')
  })

  it('requires tool on an argument predicate', () => {
    expect(
      rejection(() =>
        parseRows({
          rows: [
            {
              id: 'a',
              label: 'A',
              kind: 'signal',
              match: [{ argument: { field: 'path', value: 'x' } }],
            },
          ],
        }),
      ),
    ).toContain('requires "rows[0].match[0].tool"')
  })

  it('rejects malformed predicates and argument fields', () => {
    expect(
      rejection(() => parseRows({ rows: [{ id: 'a', label: 'A', kind: 'signal', match: [42] }] })),
    ).toBe('observability config: rows[0].match[0] must be a mapping')
    expect(
      rejection(() =>
        parseRows({
          rows: [{ id: 'a', label: 'A', kind: 'signal', match: [{ tool: 42 }] }],
        }),
      ),
    ).toBe('observability config: rows[0].match[0].tool must be a non-empty string')
    expect(
      rejection(() =>
        parseRows({
          rows: [
            { id: 'a', label: 'A', kind: 'signal', match: [{ tool: 'write', argument: 'x' }] },
          ],
        }),
      ),
    ).toBe('observability config: rows[0].match[0].argument must be a mapping')
    expect(
      rejection(() =>
        parseRows({
          rows: [
            {
              id: 'a',
              label: 'A',
              kind: 'signal',
              match: [{ tool: 'write', argument: { field: 'path', value: 'x', extra: 1 } }],
            },
          ],
        }),
      ),
    ).toBe('observability config: rows[0].match[0].argument: unknown field "extra"')
    expect(
      rejection(() =>
        parseRows({
          rows: [
            {
              id: 'a',
              label: 'A',
              kind: 'signal',
              match: [{ tool: 'write', argument: { field: 'path', value: '' } }],
            },
          ],
        }),
      ),
    ).toBe('observability config: rows[0].match[0].argument.value must be a non-empty string')
    expect(
      rejection(() =>
        parseRows({
          rows: [
            {
              id: 'a',
              label: 'A',
              kind: 'signal',
              match: [{ tool: 'write', argument: { field: '', value: 'x' } }],
            },
          ],
        }),
      ),
    ).toBe('observability config: rows[0].match[0].argument.field must be a non-empty string')
    expect(
      rejection(() =>
        parseRows({
          rows: [{ id: 'a', label: 'A', kind: 'signal', match: [{ tool: 'write', argument: {} }] }],
        }),
      ),
    ).toBe('observability config: rows[0].match[0].argument.field must be a non-empty string')
  })

  it('rejects mistyped values and duplicate ids', () => {
    expect(rejection(() => parseRows({ rows: [{ id: '', label: 'A', kind: 'signal' }] }))).toBe(
      'observability config: rows[0].id must be a non-empty string',
    )
    expect(
      rejection(() => parseRows({ rows: [{ id: 'a', label: 'A', kind: 'metric' }] })),
    ).toContain('kind must be "signal" or "guidance"')
    expect(
      rejection(() =>
        parseRows({
          rows: [
            { id: 'a', label: 'A', kind: 'guidance' },
            { id: 'a', label: 'A again', kind: 'guidance' },
          ],
        }),
      ),
    ).toContain('id "a" is not unique')
    expect(rejection(() => parseRows({ rows: 'nope' }))).toContain('config.rows must be an array')
  })
})

describe('row descriptors', () => {
  it('accepts a trigger on a signal row and on a guidance row', () => {
    expect(
      parseRows({
        rows: [
          {
            id: 'loop',
            label: 'Loop',
            kind: 'signal',
            trigger: 'a turn aborts because a loop was detected',
            match: [{ tool: 'loop' }],
          },
          { id: 'pony', label: 'Ponytail', kind: 'guidance', trigger: 'a ruleset is loaded' },
        ],
      }),
    ).toEqual([
      {
        id: 'loop',
        label: 'Loop',
        kind: 'signal',
        trigger: 'a turn aborts because a loop was detected',
        match: [{ tool: 'loop' }],
      },
      { id: 'pony', label: 'Ponytail', kind: 'guidance', trigger: 'a ruleset is loaded' },
    ])
  })

  it('accepts a mounted section, a mounted skill, and both on a guidance row', () => {
    expect(
      parseRows({
        rows: [
          { id: 'a', label: 'A', kind: 'guidance', mounted: { section: 'dsh-setup:ponytail' } },
          { id: 'b', label: 'B', kind: 'guidance', mounted: { skill: 'ponytail' } },
          {
            id: 'c',
            label: 'C',
            kind: 'guidance',
            mounted: { section: 'dsh-setup:rtk', skill: 'rtk' },
          },
        ],
      }),
    ).toEqual([
      { id: 'a', label: 'A', kind: 'guidance', mounted: { section: 'dsh-setup:ponytail' } },
      { id: 'b', label: 'B', kind: 'guidance', mounted: { skill: 'ponytail' } },
      {
        id: 'c',
        label: 'C',
        kind: 'guidance',
        mounted: { section: 'dsh-setup:rtk', skill: 'rtk' },
      },
    ])
  })

  it('rejects an empty mounted object and mounted on a signal row', () => {
    expect(
      rejection(() =>
        parseRows({ rows: [{ id: 'a', label: 'A', kind: 'guidance', mounted: {} }] }),
      ),
    ).toBe('observability config: rows[0].mounted must name "section" or "skill"')
    expect(
      rejection(() =>
        parseRows({
          rows: [
            {
              id: 'a',
              label: 'A',
              kind: 'signal',
              match: [{ tool: 'x' }],
              mounted: { section: 'x' },
            },
          ],
        }),
      ),
    ).toBe('observability config: rows[0].mounted is not allowed on a signal row')
  })

  it('names an unknown mounted field and a mistyped trigger', () => {
    expect(
      rejection(() =>
        parseRows({
          rows: [{ id: 'a', label: 'A', kind: 'guidance', mounted: { prompt: 'x' } }],
        }),
      ),
    ).toBe('observability config: rows[0].mounted: unknown field "prompt"')
    expect(
      rejection(() =>
        parseRows({ rows: [{ id: 'a', label: 'A', kind: 'guidance', trigger: '' }] }),
      ),
    ).toBe('observability config: rows[0].trigger must be a non-empty string')
  })
})
