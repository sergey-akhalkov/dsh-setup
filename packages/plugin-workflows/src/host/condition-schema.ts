import { validateJsonLogic } from './jsonlogic.js'

/**
 * The bounded condition schema. A trigger's `condition` is JSONLogic over a
 * closed context: the event, the change's tasks and lanes, the current records
 * and digests, and the session's involvement. A path outside that vocabulary
 * fails the definition load with its field.
 */

export const CONDITION_ROOTS = ['event', 'change', 'records', 'digests', 'session'] as const
export type ConditionRoot = (typeof CONDITION_ROOTS)[number]

const STATIC_PATHS: ReadonlySet<string> = new Set([
  'event.kind',
  'event.tool',
  'event.command',
  'event.path',
  'change.name',
  'change.tasks',
  'change.tasks.checked',
  'change.tasks.unchecked',
  'change.tasks.items',
  'change.lanes',
  'records.spec',
  'records.spec.verdict',
  'records.spec.digest',
  'records.spec.current',
  'records.spec.pass',
  'records.tasks',
  'digests.spec',
  'digests.worktree',
  'session.involved',
  'session.changedSpec',
  'session.completed',
])

const ROOT_SET: ReadonlySet<string> = new Set(CONDITION_ROOTS)

/** The fields of one collection item, valid only inside an item predicate. */
const ITEM_FIELDS: ReadonlySet<string> = new Set([
  'id',
  'number',
  'text',
  'checked',
  'n',
  'title',
  'owned',
  'unchecked',
])

function indexedPath(segments: readonly string[]): boolean {
  if (segments[0] !== 'change') return false
  if (segments[1] === 'lanes' && segments.length === 4) {
    return (
      /^\d+$/u.test(segments[2] ?? '') &&
      ['n', 'title', 'owned', 'unchecked'].includes(segments[3] ?? '')
    )
  }
  if (segments[1] === 'tasks' && segments[2] === 'items' && segments.length === 5) {
    return (
      /^\d+$/u.test(segments[3] ?? '') &&
      ['id', 'number', 'text', 'checked'].includes(segments[4] ?? '')
    )
  }
  return false
}

function checkPath(raw: string, field: string, itemScope: boolean): void {
  if (/[\\/]|(?:^|\.)\.\.(?:\.|$)|:/u.test(raw)) {
    throw new Error(`condition.${field} "var" path "${raw}" must not name a path`)
  }
  const segments = raw.split('.')
  if (segments.some((segment) => segment === '')) {
    throw new Error(`condition.${field} "var" path "${raw}" has an empty segment`)
  }
  if (segments.length > 8) {
    throw new Error(`condition.${field} "var" path "${raw}" nests too deeply`)
  }
  if (itemScope && ITEM_FIELDS.has(raw)) return
  if (raw === '') return
  const root = segments[0] ?? ''
  if (!ROOT_SET.has(root)) {
    throw new Error(
      `condition.${field} "var" path "${raw}" names an unknown context field; use one of: ${CONDITION_ROOTS.join(', ')}`,
    )
  }
  if (raw === root) return
  if (STATIC_PATHS.has(raw)) return
  if (indexedPath(segments)) return
  // The per-task record map is keyed by task id; its values carry these fields.
  if (segments[0] === 'records' && segments[1] === 'tasks') {
    if (segments.length === 2) return
    if (segments.length === 4 && (segments[3] === 'verdict' || segments[3] === 'digest')) return
  }
  throw new Error(
    `condition.${field} "var" path "${raw}" names an unknown context field; use one of the documented fields`,
  )
}

const ITEM_OPERATORS: ReadonlySet<string> = new Set(['some', 'all', 'none', 'map', 'filter'])

function varPath(rule: unknown, field: string, depth = 0, itemScope = false): void {
  if (depth > 32) throw new Error(`condition.${field} nests too deeply`)
  if (rule === null || typeof rule !== 'object') return
  if (Array.isArray(rule)) {
    for (const entry of rule) varPath(entry, field, depth + 1, itemScope)
    return
  }
  const record = rule as Record<string, unknown>
  const keys = Object.keys(record)
  if (keys.length !== 1) return
  const operator = keys[0] ?? ''
  if (operator === 'var') {
    const args = Array.isArray(record.var) ? record.var : [record.var]
    const raw = args[0]
    if (raw !== undefined) {
      if (typeof raw !== 'string') {
        throw new Error(`condition.${field} "var" path must be a string`)
      }
      checkPath(raw, field, itemScope)
    }
    for (const arg of args.slice(1)) varPath(arg, field, depth + 1, itemScope)
    return
  }
  if (operator === 'missing' || operator === 'missing_some') {
    const operands = Array.isArray(record[operator])
      ? (record[operator] as unknown[])
      : [record[operator]]
    for (const [operandIndex, operand] of operands.entries()) {
      const names = Array.isArray(operand) ? operand : [operand]
      for (const name of names) {
        // A missing reference is a lookup name, never a computed expression.
        // Only missing_some's first operand is its numeric threshold.
        if (typeof name === 'number') {
          if (operator === 'missing_some' && operandIndex === 0) continue
          throw new Error(
            `condition.${field} "${operator}" names must be literal field names, not numbers`,
          )
        }
        if (typeof name !== 'string' || /^\d+$/u.test(name)) {
          throw new Error(
            `condition.${field} "${operator}" names must be literal field names, not computed expressions`,
          )
        }
        checkPath(name, field, false)
      }
    }
    return
  }
  const args = Array.isArray(record[operator])
    ? (record[operator] as unknown[])
    : [record[operator]]
  if (ITEM_OPERATORS.has(operator)) {
    for (const [index, arg] of args.entries()) {
      varPath(arg, field, depth + 1, index > 0)
    }
    return
  }
  if (operator === 'reduce') {
    for (const [index, arg] of args.entries()) {
      varPath(arg, field, depth + 1, index > 0)
    }
    return
  }
  for (const arg of args) varPath(arg, field, depth + 1, itemScope)
}

/** Validate a trigger condition at load: JSONLogic only, closed context paths. */
export function validateCondition(rule: unknown, field = 'trigger.condition'): void {
  try {
    validateJsonLogic(rule)
  } catch (error) {
    throw new Error(`${field}: ${error instanceof Error ? error.message : String(error)}`)
  }
  varPath(rule, field)
}
