import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The always-on RTK rule is paid on every model step of every session, so its
 * size is a hard budget rather than a preference. A token is estimated as one
 * quarter of the UTF-8 byte count, the same metric the documentation uses.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const rulesPath = join(packageDir, 'assets', 'rtk', 'rules.md')
const rules = readFileSync(rulesPath, 'utf8')
const bytes = Buffer.byteLength(rules, 'utf8')
const estimatedTokens = bytes / 4

const BUDGET_TOKENS = 300
const MINIMUM_BYTES = 600
const MAXIMUM_BYTES = 1100

describe('always-on RTK rule budget', () => {
  it('stays inside the documented per-step budget', () => {
    expect(
      estimatedTokens,
      `assets/rtk/rules.md is ${bytes} bytes (~${Math.round(estimatedTokens)} estimated tokens), over the ${BUDGET_TOKENS}-token budget`,
    ).toBeLessThanOrEqual(BUDGET_TOKENS)
  })

  it('stays within the reviewed size range', () => {
    expect(bytes).toBeGreaterThanOrEqual(MINIMUM_BYTES)
    expect(bytes).toBeLessThanOrEqual(MAXIMUM_BYTES)
  })

  it('names no invocation the Harness does not provide', () => {
    expect(rules).not.toMatch(/`\/[a-z-]+/)
  })
})
