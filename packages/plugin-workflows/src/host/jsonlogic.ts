/**
 * A bounded JSONLogic validator over plain data. It is data, not code: only a
 * small operator set is accepted, an unknown operator or malformed rule throws,
 * and the recursion depth is capped. It lives apart from the evaluator so a
 * definition trigger's `condition` can be validated at load without importing
 * the executor module.
 */

function operands(args: unknown): unknown[] {
  return Array.isArray(args) ? args : [args]
}

/** Validate the whole rule tree, operand counts included, before any evaluation. */
export function validateJsonLogic(rule: unknown, depth = 0): void {
  if (depth > 32) throw new Error('invalid JSONLogic: nesting is too deep')
  if (rule === null || typeof rule !== 'object') return
  if (Array.isArray(rule)) {
    for (const entry of rule) validateJsonLogic(entry, depth + 1)
    return
  }
  const keys = Object.keys(rule)
  if (keys.length !== 1) throw new Error('invalid JSONLogic: an operator object has one key')
  const operator = keys[0] ?? ''
  const args = operands((rule as Record<string, unknown>)[operator])
  const expect = (min: number, max?: number): void => {
    if (args.length < min || (max !== undefined && args.length > max)) {
      throw new Error(
        `invalid JSONLogic: "${operator}" expects ${max === undefined ? `at least ${String(min)}` : `${String(min)} to ${String(max)}`} operand(s)`,
      )
    }
  }
  switch (operator) {
    case 'var':
      expect(1, 2)
      break
    case '==':
    case '!=':
    case '===':
    case '!==':
    case 'in':
      expect(2, 2)
      break
    case '<':
    case '<=':
    case '>':
    case '>=':
      expect(2, 3)
      break
    case 'and':
    case 'or':
      expect(1)
      break
    case '!':
      expect(1, 1)
      break
    case '!!':
      expect(1, 1)
      break
    case '+':
    case '*':
    case 'cat':
    case 'min':
    case 'max':
      expect(1)
      break
    case '-':
      expect(1, 2)
      break
    case '/':
      expect(2)
      break
    case '%':
      expect(2, 2)
      break
    case 'missing':
      expect(1)
      break
    case 'some':
    case 'all':
    case 'none':
    case 'missing_some':
      expect(2, 2)
      break
    case 'substr':
      expect(2, 3)
      break
    case 'map':
    case 'filter':
      expect(2, 2)
      break
    case 'reduce':
      expect(2, 3)
      break
    case 'merge':
      expect(1)
      break
    case 'if':
      expect(2)
      break
    default:
      throw new Error(`invalid JSONLogic: unknown operator "${operator}"`)
  }
  for (const entry of args) validateJsonLogic(entry, depth + 1)
}
