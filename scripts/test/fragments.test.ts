import { describe, expect, it } from 'vitest'
import { FragmentError, parseCompositionFragment } from '../lib/fragments.ts'

const PACKAGE = '@dsh-setup/plugin-example'

describe('parseCompositionFragment', () => {
  it('derives the row module name from the owning package', () => {
    const fragment = parseCompositionFragment('rows:\n  - id: dsh-setup-example\n', PACKAGE)
    expect(fragment.rows).toEqual([{ id: 'dsh-setup-example', name: PACKAGE }])
  })

  it('keeps an optional row config', () => {
    const fragment = parseCompositionFragment(
      'rows:\n  - id: dsh-setup-example\n    config:\n      format: short\n',
      PACKAGE,
    )
    expect(fragment.rows[0]?.config).toEqual({ format: 'short' })
  })

  it('keeps a disabled row flag', () => {
    const fragment = parseCompositionFragment(
      'rows:\n  - id: dsh-setup-example\n    disabled: true\n',
      PACKAGE,
    )
    expect(fragment.rows[0]?.disabled).toBe(true)
  })

  it('rejects a non-boolean disabled flag', () => {
    expect(() =>
      parseCompositionFragment('rows:\n  - id: dsh-setup-example\n    disabled: 5\n', PACKAGE),
    ).toThrow(/disabled must be a boolean/)
  })

  it('rejects an unknown top-level field', () => {
    expect(() =>
      parseCompositionFragment('rows:\n  - id: dsh-setup-example\nextra: true\n', PACKAGE),
    ).toThrow(/unknown field "extra"/)
  })

  it('rejects an unknown row field', () => {
    expect(() =>
      parseCompositionFragment('rows:\n  - id: dsh-setup-example\n    command: other\n', PACKAGE),
    ).toThrow(/unknown field "command"/)
  })

  it('accepts the approved adapter target instead of the owning package', () => {
    const fragment = parseCompositionFragment(
      "rows:\n  - id: dsh-setup-adapter\n    name: '@deepseek-ai/dsh-mcp-client'\n    config:\n      serverName: serena\n",
      '@dsh-setup/plugin-example',
    )
    expect(fragment.rows).toEqual([
      {
        id: 'dsh-setup-adapter',
        name: '@deepseek-ai/dsh-mcp-client',
        config: { serverName: 'serena' },
      },
    ])
  })

  it('rejects an unapproved adapter target', () => {
    expect(() =>
      parseCompositionFragment(
        "rows:\n  - id: dsh-setup-adapter\n    name: '@deepseek-ai/dsh-tools'\n",
        PACKAGE,
      ),
    ).toThrow(/not an approved adapter target/)
  })

  it('rejects a non-string row name', () => {
    expect(() =>
      parseCompositionFragment('rows:\n  - id: dsh-setup-adapter\n    name: 5\n', PACKAGE),
    ).toThrow(/name must be a string/)
  })

  it('rejects an id outside the repository namespace', () => {
    expect(() => parseCompositionFragment('rows:\n  - id: example\n', PACKAGE)).toThrow(
      FragmentError,
    )
  })

  it('rejects a duplicate id', () => {
    expect(() =>
      parseCompositionFragment(
        'rows:\n  - id: dsh-setup-example\n  - id: dsh-setup-example\n',
        PACKAGE,
      ),
    ).toThrow(/not unique/)
  })

  it('rejects an empty row list', () => {
    expect(() => parseCompositionFragment('rows: []\n', PACKAGE)).toThrow(/must not be empty/)
  })
})
