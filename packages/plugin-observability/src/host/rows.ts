/**
 * Declarative signal rows. A row is inert data: an id, a label, a kind, and a
 * match over session-event facts. Nothing here is executed.
 */

/** A row either reports traces (`signal`) or names a prompt-only plugin (`guidance`). */
export type RowKind = 'signal' | 'guidance'

/** One argument field/value check on a tool call's raw JSON arguments. */
export interface ArgumentMatch {
  readonly field: string
  readonly value: string
}

/**
 * One event predicate. A predicate with several fields requires all of them;
 * a row's predicate list is an any-of, so one row can cover several tools.
 */
export interface Predicate {
  readonly eventType?: string
  readonly tool?: string
  readonly sourceKind?: string
  readonly abortPrefix?: string
  readonly command?: string
  readonly argument?: ArgumentMatch
}

/**
 * Declared prompt contribution of a guidance row: the prompt section name
 * and/or the skill name the named plugin is expected to register.
 */
export interface MountedNames {
  readonly section?: string
  readonly skill?: string
}

/** One configured row. */
export interface Row {
  readonly id: string
  readonly label: string
  readonly kind: RowKind
  readonly match?: readonly Predicate[]
  /** What the row waits for, shown while it has no traces. */
  readonly trigger?: string
  readonly mounted?: MountedNames
}

/** A configuration error that names the offending field or row. */
export class RowConfigError extends Error {
  constructor(message: string) {
    super(`observability config: ${message}`)
    this.name = 'RowConfigError'
  }
}

const ROW_FIELDS = new Set(['id', 'label', 'kind', 'match', 'trigger', 'mounted'])
const MOUNTED_FIELDS = new Set(['section', 'skill'])
const PREDICATE_FIELDS = new Set([
  'eventType',
  'tool',
  'sourceKind',
  'abortPrefix',
  'command',
  'argument',
])
const ARGUMENT_FIELDS = new Set(['field', 'value'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  at: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new RowConfigError(`${at}: unknown field "${key}"`)
  }
}

function readText(value: unknown, at: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RowConfigError(`${at} must be a non-empty string`)
  }
  return value
}

function readArgument(value: unknown, at: string): ArgumentMatch {
  if (!isRecord(value)) throw new RowConfigError(`${at} must be a mapping`)
  rejectUnknownFields(value, ARGUMENT_FIELDS, at)
  return {
    field: readText(value.field, `${at}.field`),
    value: readText(value.value, `${at}.value`),
  }
}

function readPredicate(value: unknown, at: string): Predicate {
  if (!isRecord(value)) throw new RowConfigError(`${at} must be a mapping`)
  rejectUnknownFields(value, PREDICATE_FIELDS, at)
  const predicate: {
    eventType?: string
    tool?: string
    sourceKind?: string
    abortPrefix?: string
    command?: string
    argument?: ArgumentMatch
  } = {}
  for (const field of ['eventType', 'tool', 'sourceKind', 'abortPrefix', 'command'] as const) {
    if (value[field] !== undefined) predicate[field] = readText(value[field], `${at}.${field}`)
  }
  if (value.argument !== undefined) {
    if (predicate.tool === undefined) {
      throw new RowConfigError(`${at}.argument requires "${at}.tool" to name the tool`)
    }
    predicate.argument = readArgument(value.argument, `${at}.argument`)
  }
  if (Object.keys(predicate).length === 0) {
    throw new RowConfigError(`${at} names no predicate field`)
  }
  return predicate
}

function readMounted(value: unknown, at: string): MountedNames {
  if (!isRecord(value)) throw new RowConfigError(`${at} must be a mapping`)
  rejectUnknownFields(value, MOUNTED_FIELDS, at)
  const mounted: { section?: string; skill?: string } = {}
  for (const field of ['section', 'skill'] as const) {
    if (value[field] !== undefined) mounted[field] = readText(value[field], `${at}.${field}`)
  }
  if (Object.keys(mounted).length === 0) {
    throw new RowConfigError(`${at} must name "section" or "skill"`)
  }
  return mounted
}

function readRow(value: unknown, at: string): Row {
  if (!isRecord(value)) throw new RowConfigError(`${at} must be a mapping`)
  rejectUnknownFields(value, ROW_FIELDS, at)
  const id = readText(value.id, `${at}.id`)
  const label = readText(value.label, `${at}.label`)
  const kind = value.kind
  if (kind !== 'signal' && kind !== 'guidance') {
    throw new RowConfigError(`${at}.kind must be "signal" or "guidance"`)
  }
  const descriptors: { trigger?: string; mounted?: MountedNames } = {
    ...(value.trigger === undefined ? {} : { trigger: readText(value.trigger, `${at}.trigger`) }),
  }
  if (value.mounted !== undefined) {
    if (kind === 'signal') {
      throw new RowConfigError(`${at}.mounted is not allowed on a signal row`)
    }
    descriptors.mounted = readMounted(value.mounted, `${at}.mounted`)
  }
  if (kind === 'guidance') {
    if (value.match !== undefined) {
      throw new RowConfigError(`${at}.match is not allowed on a guidance row`)
    }
    return { id, label, kind, ...descriptors }
  }
  if (value.match === undefined) {
    throw new RowConfigError(`${at}.match is required on a signal row`)
  }
  const raw = Array.isArray(value.match) ? value.match : [value.match]
  if (raw.length === 0) throw new RowConfigError(`${at}.match must not be empty`)
  const match = raw.map((predicate, index) => readPredicate(predicate, `${at}.match[${index}]`))
  return { id, label, kind, match, ...descriptors }
}

/**
 * Validate the configured row list. An absent list is valid: the built-in
 * signal sets still work on a profile with no configuration.
 */
export function parseRows(raw: unknown): Row[] {
  let rows: unknown = []
  if (raw !== undefined && raw !== null) {
    if (!isRecord(raw)) throw new RowConfigError('config must be a mapping')
    for (const key of Object.keys(raw)) {
      if (key !== 'rows') throw new RowConfigError(`config: unknown field "${key}"`)
    }
    rows = raw.rows ?? []
  }
  if (!Array.isArray(rows)) throw new RowConfigError('config.rows must be an array')
  const parsed: Row[] = []
  const seen = new Set<string>()
  rows.forEach((value, index) => {
    const row = readRow(value, `rows[${index}]`)
    if (seen.has(row.id)) throw new RowConfigError(`rows[${index}].id "${row.id}" is not unique`)
    seen.add(row.id)
    parsed.push(row)
  })
  return parsed
}

/**
 * The argument fields configured predicates read, per tool. Extraction keeps
 * only these values, so raw tool arguments never enter a neutral record.
 */
export function configuredArgumentFields(rows: readonly Row[]): Map<string, Set<string>> {
  const fields = new Map<string, Set<string>>()
  for (const row of rows) {
    for (const predicate of row.match ?? []) {
      if (predicate.tool === undefined || predicate.argument === undefined) continue
      let names = fields.get(predicate.tool)
      if (names === undefined) {
        names = new Set()
        fields.set(predicate.tool, names)
      }
      names.add(predicate.argument.field)
    }
  }
  return fields
}
