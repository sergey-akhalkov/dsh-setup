import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The always-on contract is paid on every model step of every session, so its
 * size is a hard budget rather than a preference. A token is estimated as one
 * quarter of the UTF-8 byte count, the same metric the documentation uses.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const contractPath = join(packageDir, 'assets', 'working-principles', 'contract.md')
const bytes = Buffer.byteLength(readFileSync(contractPath, 'utf8'), 'utf8')
const estimatedTokens = bytes / 4

const BUDGET_TOKENS = 1500
const MINIMUM_BYTES = 3200
const MAXIMUM_BYTES = 5300

describe('always-on contract budget', () => {
  it('stays inside the documented per-step budget', () => {
    expect(
      estimatedTokens,
      `assets/working-principles/contract.md is ${bytes} bytes (~${Math.round(estimatedTokens)} estimated tokens), over the ${BUDGET_TOKENS}-token budget`,
    ).toBeLessThanOrEqual(BUDGET_TOKENS)
  })

  it('stays within the reviewed size range', () => {
    expect(bytes).toBeGreaterThanOrEqual(MINIMUM_BYTES)
    expect(bytes).toBeLessThanOrEqual(MAXIMUM_BYTES)
  })

  it('names no invocation the Harness does not provide', () => {
    const text = readFileSync(contractPath, 'utf8')
    expect(text).not.toMatch(/`\/[a-z-]+/)
  })

  it('states the goal-round continuation policy in the existing section', () => {
    const text = readFileSync(contractPath, 'utf8')
    const section = text.split('## Recover instead of repeating')[1] ?? ''
    expect(section).toContain('`job_output(wait: true)`')
    expect(section).toContain('same handle after a timeout')
    expect(section).toContain('three consecutive rounds')
    expect(section).toContain('difficulty, uncertainty, and remaining work are not blockers')
    expect(section).toContain('evidence for every requirement')
    expect(section).toContain('max_goal_rounds')
  })
})
