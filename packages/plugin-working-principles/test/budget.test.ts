import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { alwaysOnFooter } from '../lib/index.js'

/**
 * The always-on contract is paid on every model step of every session, so its
 * size is a hard budget rather than a preference. A token is estimated as one
 * quarter of the UTF-8 byte count, the same metric the documentation uses. The
 * registered section includes the footer, so both are measured.
 */

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const contractPath = join(packageDir, 'assets', 'working-principles', 'contract.md')
const contract = readFileSync(contractPath, 'utf8')
const sectionBytes = Buffer.byteLength(`${contract}${alwaysOnFooter()}`, 'utf8')
const contractBytes = Buffer.byteLength(contract, 'utf8')
const estimatedTokens = sectionBytes / 4

const BUDGET_TOKENS = 1500
const MINIMUM_BYTES = 3200
const MAXIMUM_BYTES = 5850

describe('always-on contract budget', () => {
  it('stays inside the documented per-step budget', () => {
    expect(
      estimatedTokens,
      `the registered working-principles section is ${sectionBytes} bytes (~${Math.round(estimatedTokens)} estimated tokens), over the ${BUDGET_TOKENS}-token budget`,
    ).toBeLessThanOrEqual(BUDGET_TOKENS)
  })

  it('stays within the reviewed contract size range', () => {
    expect(contractBytes).toBeGreaterThanOrEqual(MINIMUM_BYTES)
    expect(contractBytes).toBeLessThanOrEqual(MAXIMUM_BYTES)
  })

  it('names no invocation the Harness does not provide', () => {
    expect(contract).not.toMatch(/`\/[a-z-]+/)
  })

  it('states the goal-round continuation policy in the existing section', () => {
    const section = contract.split('## Recover instead of repeating')[1] ?? ''
    expect(section).toContain('`job_output(wait: true)`')
    expect(section).toContain('three consecutive rounds')
    expect(section).toContain('user-only')
    expect(section).toContain('not a menu')
    expect(section).toContain('permission the runtime grants')
    expect(section).toContain('evidence for every requirement')
    expect(section).toContain('max_goal_rounds')
    expect(section).toContain('independently reviewed')
    expect(section).toContain('continuation')
    expect(section).toContain('grants.json')
  })

  it('states the user-only blocker, means, and scope rules', () => {
    const scope = contract.split('## Scope belongs to the user')[1]?.split('## Delegate')[0] ?? ''
    expect(scope).toContain('is a means')
    expect(scope).toContain('test-only activation')
    expect(scope).toContain('production behavior change')
    expect(scope).toContain('scope decision')
    expect(contract).toContain('never converted into a permission request')
    expect(contract).toContain('foreign or stale grant')
  })

  it('makes a multi-step task a goal and exempts single-turn requests', () => {
    expect(contract).toContain('A multi-step task runs under a goal created before the first step')
    expect(contract).toContain('single-turn, one-line, or informational request is exempt')
  })

  it('requires a pause checkpoint with a parallel worker or a serial reason', () => {
    expect(contract).toContain('`work_checkpoint`')
    expect(contract).toContain('done, verified, remaining, and parallel lanes')
    expect(contract).toContain('starts a worker for at least one lane before the turn closes')
    expect(contract).toContain('in the main agent')
    expect(contract).toContain('`serialReason`')
  })
})
