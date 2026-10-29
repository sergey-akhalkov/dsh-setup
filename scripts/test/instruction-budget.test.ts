import { describe, expect, it } from 'vitest'
import { checkInstructionBudget, INSTRUCTION_FILE_BUDGET_BYTES } from '../lib/workspace.ts'

describe('checkInstructionBudget', () => {
  it('accepts a file exactly at the budget and reports its measured size', () => {
    const result = checkInstructionBudget('x'.repeat(INSTRUCTION_FILE_BUDGET_BYTES))
    expect(result).toEqual({
      file: 'AGENTS.md',
      bytes: INSTRUCTION_FILE_BUDGET_BYTES,
      budget: INSTRUCTION_FILE_BUDGET_BYTES,
    })
  })

  it('reports the owning file and measured size once the budget is exceeded', () => {
    const result = checkInstructionBudget('x'.repeat(INSTRUCTION_FILE_BUDGET_BYTES + 1))
    expect(result.bytes).toBe(INSTRUCTION_FILE_BUDGET_BYTES + 1)
    expect(result.problem).toContain('AGENTS.md')
    expect(result.problem).toContain(`${INSTRUCTION_FILE_BUDGET_BYTES + 1} bytes`)
    expect(result.problem).toContain(`${INSTRUCTION_FILE_BUDGET_BYTES}-byte`)
  })

  it('measures UTF-8 bytes rather than characters', () => {
    const twoByteChar = '\u00e9'
    const result = checkInstructionBudget(twoByteChar.repeat(INSTRUCTION_FILE_BUDGET_BYTES / 2 + 1))
    expect(result.bytes).toBe(INSTRUCTION_FILE_BUDGET_BYTES + 2)
    expect(result.problem).toBeDefined()
  })
})
