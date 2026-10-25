import { parse } from 'yaml'

/** One row a plugin contributes to a bundle patch. */
export interface FragmentRow {
  /** Globally unique row id, namespaced with the repository prefix. */
  id: string
  /** Module specifier mounted by the row; always the owning package name. */
  name: string
  /** Optional loader configuration for the row. */
  config?: Record<string, unknown>
}

/** One package's composition contribution. */
export interface CompositionFragment {
  rows: FragmentRow[]
}

/** Row ids are global: a bundle may only mount entries under the repository prefix. */
export const ROW_ID_PATTERN = /^dsh-setup-[a-z0-9]+(?:-[a-z0-9]+)*$/

export class FragmentError extends Error {
  constructor(message: string) {
    super(`composition fragment: ${message}`)
    this.name = 'FragmentError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse and validate one package's composition fragment.
 *
 * The fragment is intentionally tiny: it names the row ids a package mounts,
 * and the row `name` is derived from the owning package so a fragment can never
 * mount another package's code. Unknown fields fail loudly so a typo does not
 * silently produce a patch that omits a contribution.
 */
export function parseCompositionFragment(text: string, packageName: string): CompositionFragment {
  const document: unknown = parse(text)
  if (!isRecord(document)) throw new FragmentError('document must be a mapping')
  for (const key of Object.keys(document)) {
    if (key !== 'rows') throw new FragmentError(`unknown field "${key}"`)
  }
  const rows = document.rows
  if (!Array.isArray(rows)) throw new FragmentError('rows must be an array')

  const result: FragmentRow[] = []
  const seen = new Set<string>()
  rows.forEach((row: unknown, index: number) => {
    const at = `rows[${index}]`
    if (!isRecord(row)) throw new FragmentError(`${at} must be a mapping`)
    for (const key of Object.keys(row)) {
      if (key !== 'id' && key !== 'config') throw new FragmentError(`${at}: unknown field "${key}"`)
    }
    if (typeof row.id !== 'string') throw new FragmentError(`${at}.id must be a string`)
    if (!ROW_ID_PATTERN.test(row.id)) {
      throw new FragmentError(`${at}.id "${row.id}" does not match ${ROW_ID_PATTERN.source}`)
    }
    if (seen.has(row.id)) throw new FragmentError(`${at}.id "${row.id}" is not unique`)
    seen.add(row.id)
    const generated: FragmentRow = { id: row.id, name: packageName }
    if (row.config !== undefined) {
      if (!isRecord(row.config)) throw new FragmentError(`${at}.config must be a mapping`)
      generated.config = row.config
    }
    result.push(generated)
  })
  if (result.length === 0) throw new FragmentError('rows must not be empty')
  return { rows: result }
}
