import { describe, expect, it } from 'vitest'
import { FragmentError, parseCompositionFragment } from '../lib/fragments.ts'

const PACKAGE = '@dsh-setup/plugin-composer-clock'

describe('parseCompositionFragment', () => {
  it('derives the row module name from the owning package', () => {
    const fragment = parseCompositionFragment('rows:\n  - id: dsh-setup-composer-clock\n', PACKAGE)
    expect(fragment.rows).toEqual([{ id: 'dsh-setup-composer-clock', name: PACKAGE }])
  })

  it('keeps an optional row config', () => {
    const fragment = parseCompositionFragment(
      'rows:\n  - id: dsh-setup-composer-clock\n    config:\n      format: short\n',
      PACKAGE,
    )
    expect(fragment.rows[0]?.config).toEqual({ format: 'short' })
  })

  it('rejects an unknown top-level field', () => {
    expect(() =>
      parseCompositionFragment('rows:\n  - id: dsh-setup-composer-clock\nextra: true\n', PACKAGE),
    ).toThrow(/unknown field "extra"/)
  })

  it('rejects an unknown row field', () => {
    expect(() =>
      parseCompositionFragment(
        'rows:\n  - id: dsh-setup-composer-clock\n    name: other\n',
        PACKAGE,
      ),
    ).toThrow(/unknown field "name"/)
  })

  it('rejects an id outside the repository namespace', () => {
    expect(() => parseCompositionFragment('rows:\n  - id: composer-clock\n', PACKAGE)).toThrow(
      FragmentError,
    )
  })

  it('rejects a duplicate id', () => {
    expect(() =>
      parseCompositionFragment(
        'rows:\n  - id: dsh-setup-composer-clock\n  - id: dsh-setup-composer-clock\n',
        PACKAGE,
      ),
    ).toThrow(/not unique/)
  })

  it('rejects an empty row list', () => {
    expect(() => parseCompositionFragment('rows: []\n', PACKAGE)).toThrow(/must not be empty/)
  })
})
