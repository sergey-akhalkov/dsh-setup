import { validateJsonLogic } from './jsonlogic.js'

/**
 * The bounded condition schema. A trigger's `condition` is JSONLogic over a
 * closed context: the event, the change's tasks and lanes, the current records
 * and digests, and the session's involvement. A path outside that vocabulary
 * fails the definition load with its field.
 */

export const CONDITION_ROOTS = ['event', 'change', 'records', 'digests', 'session'] as const
export type ConditionRoot = (typeof CONDITION_ROOTS)[number]

const ROOT_SET: ReadonlySet<string> = new Set(CONDITION_ROOTS)

function varPath(rule: unknown, field: string): void {
  if (rule === null || typeof rule !== 'object') return
  if (Array.isArray(rule)) {
    for (const entry of rule) varPath(entry, field)
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
      const root = segments[0] ?? ''
      if (!ROOT_SET.has(root)) {
        throw new Error(
          `condition.${field} "var" path "${raw}" names an unknown context field; use one of: ${CONDITION_ROOTS.join(', ')}`,
        )
      }
    }
    for (const arg of args.slice(1)) varPath(arg, field)
    return
  }
  const args = Array.isArray(record[operator])
    ? (record[operator] as unknown[])
    : [record[operator]]
  for (const arg of args) varPath(arg, field)
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
