import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PARITY_CASES,
  runParityCase,
} from '../../packages/plugin-workflows/test/parity-fixtures.ts'
import {
  buildParityReport,
  checkParityReport,
  writeParityReport,
} from '../../scripts/workflows-parity.ts'

/**
 * The release-bound parity runner: the report matches the shipped templates,
 * a stale or missing report fails, a deliberate mismatch names the case and
 * both reasons, the settings matrix covers the accepted values, and the
 * tracked artifact carries no prompts, credentials, or machine paths.
 */

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function tempDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-parity-test-'))
  cleanups.push(async () => rm(directory, { recursive: true, force: true }))
  return directory
}

describe('retirement parity report', () => {
  it('passes every retired gate and records the retained legacy cases', async () => {
    const report = await buildParityReport(new Date('2026-11-08T00:00:00.000Z'))
    expect(report.change).toBe('retire-legacy-gates')
    expect(report.mismatches).toEqual([])
    for (const gate of ['checkpoint', 'task-review', 'verification']) {
      expect(report.gates[gate]?.status).toBe('pass')
      expect(report.gates[gate]?.mismatches).toBe(0)
    }
    expect(Object.keys(report.templates).sort()).toEqual(['retro', 'task-review', 'verify'])
    expect(report.settings['verify.maxBlocks']?.cases).toContain(129)
    expect(report.settings['verify.commands']?.cases.length).toBeGreaterThanOrEqual(2)
    expect(report.retained['spec-review']?.status).toBe('legacy')
    expect(report.retained['task-progress']?.status).toBe('legacy')
    expect(report.retained['lane-assignment']?.status).toBe('legacy')
    for (const retained of PARITY_CASES.filter((entry) => entry.gate === 'retained')) {
      expect(retained.legacy.decision).toMatch(/allow|refuse/u)
      expect(retained.retained).toBeDefined()
    }
  })

  it('compares allow/refuse decisions and names a deliberate mismatch', async () => {
    const mismatch = {
      id: 'deliberate-mismatch',
      gate: 'verification' as const,
      legacy: { decision: 'allow' as const, reason: 'legacy allows' },
      workflow: async () => ({ decision: 'refuse' as const, reason: 'workflow refuses' }),
    }
    const result = await runParityCase(mismatch)
    expect(result.ok).toBe(false)
    expect(result.workflow?.decision).toBe('refuse')
  })

  it('fails --check when the report is missing, stale, or template-mismatched', async () => {
    const directory = await tempDirectory()
    const file = join(directory, 'retire-legacy-gates.json')
    const written = await writeParityReport(file)
    expect(written.mismatches).toEqual([])
    expect((await checkParityReport(file)).ok).toBe(true)

    const parsed = JSON.parse(await readFile(file, 'utf8')) as {
      templates: Record<string, string>
      gates: Record<string, { status: string }>
    }
    parsed.templates.retro = 'sha256-' + 'a'.repeat(64)
    await writeFile(file, JSON.stringify(parsed), 'utf8')
    const stale = await checkParityReport(file)
    expect(stale.ok).toBe(false)
    expect(stale.detail).toContain('retro')
    expect(stale.detail).toContain('stale')

    await rm(file)
    await rm(join(directory, 'empty'), { recursive: true, force: true })
    const missing = await checkParityReport(file)
    expect(missing.ok).toBe(false)
    expect(missing.detail).toContain('missing')

    const passing = await writeParityReport(join(directory, 'gates.json'))
    const gatesFile = join(directory, 'gates.json')
    const gateValue = JSON.parse(await readFile(gatesFile, 'utf8')) as {
      gates: Record<string, { status: string }>
    }
    gateValue.gates.verification = { status: 'fail' }
    await writeFile(gatesFile, JSON.stringify(gateValue), 'utf8')
    const failedGate = await checkParityReport(gatesFile)
    expect(failedGate.ok).toBe(false)
    expect(passing.gates.verification?.status).toBe('pass')
  })

  it('writes a bounded artifact without prompts, credentials, or machine paths', async () => {
    const directory = await tempDirectory()
    const file = join(directory, 'retire-legacy-gates.json')
    await writeParityReport(file)
    const text = await readFile(file, 'utf8')
    expect(text).not.toMatch(/[A-Za-z]:[\\/]/u)
    expect(text).not.toMatch(/\/home\/|\/Users\//u)
    expect(text).not.toMatch(/token=|password|secret|authorization/iu)
    expect(text).not.toContain('Read-only')
    expect(text.length).toBeLessThan(20_000)
  })
})
