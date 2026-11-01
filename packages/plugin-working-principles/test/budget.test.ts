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

  it('carries the lane plan, bottleneck, remedy, and next action in a checkpoint', () => {
    const section = (contract.split('## Recover instead of repeating')[1] ?? '').replace(
      /\s+/g,
      ' ',
    )
    expect(contract).toContain('`work_checkpoint`')
    expect(section).toContain(
      'the lane plan, `verified`, `bottleneck`, its owner, blocking lanes, remedy, `next`',
    )
    expect(section).toContain('Execute the remedy before the turn closes; the plugin checks for it')
    expect(section).toContain('Independent lanes start a worker before the turn closes')
    expect(section).toContain('integrated in the main agent')
    expect(contract).not.toContain('serialReason')
    expect(contract).not.toContain('speedup')
  })

  it('requires a route change for a bottleneck surviving a second checkpoint', () => {
    const section = (contract.split('## Recover instead of repeating')[1] ?? '').replace(
      /\s+/g,
      ' ',
    )
    expect(section).toContain('bottleneck surviving a second checkpoint needs a route change')
    expect(section).toContain('new owner, changed blocking lane, or user decision')
    expect(section).toContain('not another wait')
  })

  it('names independent lanes with owners and scopes and refreshes the plan', () => {
    const delegation = (
      contract.split('## Delegate only to parallelize')[1]?.split('## ')[0] ?? ''
    ).replace(/\s+/g, ' ')
    expect(delegation).toContain('One agent is the default')
    expect(delegation).toContain('Multi-file or multi-step work')
    expect(delegation).toContain('independent lanes, owners, and scopes')
    expect(delegation).toContain('in the plan before the first edit')
    expect(delegation).toContain('refreshed at each checkpoint')
    expect(delegation).toContain('Start a worker per independent lane')
    expect(delegation).toContain('verify in a fresh context')
  })

  it('expresses serial work as a shared scope or a single owner, never a serial reason', () => {
    const delegation = (
      contract.split('## Delegate only to parallelize')[1]?.split('## ')[0] ?? ''
    ).replace(/\s+/g, ' ')
    expect(delegation).toContain('serial form: shared scope or single owner')
    expect(delegation).toContain('not a serial-reason sentence')
  })

  it('exempts a one-line fix from the plan and worker rule', () => {
    expect(contract).toContain('one-line fix needs no plan or worker')
    expect(contract).toContain('single-turn, one-line, or informational request is exempt')
  })

  it('checks in at the configured step interval with a bottleneck and its remedy', () => {
    const section = (contract.split('## Recover instead of repeating')[1] ?? '').replace(
      /\s+/g,
      ' ',
    )
    expect(section).toContain('each step interval')
    expect(section).toContain('`bottleneck`')
    expect(section).toContain('blocking lanes, remedy')
  })
})
