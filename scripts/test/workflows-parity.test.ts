import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { shippedParityReportPath } from '../../packages/plugin-workflows/src/host/parity.ts'
import {
  assertArchiveRecognition,
  PARITY_CASES,
  runParityCase,
} from '../../packages/plugin-workflows/test/parity-fixtures.ts'
import {
  buildParityReport,
  checkParityReport,
  parityExitCode,
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
  it('ignores an external report override for the packaged path', () => {
    const previous = process.env.DSH_WORKFLOWS_PARITY_REPORT
    process.env.DSH_WORKFLOWS_PARITY_REPORT = join(tmpdir(), 'external-override.json')
    try {
      const path = shippedParityReportPath()
      expect(path).not.toContain('external-override')
      expect(readFileSync(path, 'utf8')).toContain('retire-legacy-gates')
    } finally {
      if (previous === undefined) delete process.env.DSH_WORKFLOWS_PARITY_REPORT
      else process.env.DSH_WORKFLOWS_PARITY_REPORT = previous
    }
  })

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

  it('carries every required case with its decision and side', () => {
    const required = [
      'checkpoint-missing',
      'checkpoint-lead-bottleneck-unexecuted',
      'checkpoint-lead-bottleneck-executed',
      'checkpoint-worker-bottleneck-unexecuted',
      'checkpoint-worker-bottleneck-executed',
      'checkpoint-aged-bottleneck',
      'task-review-missing',
      'task-review-pass',
      'task-review-error-intermediate',
      'task-review-findings',
      'completion-unapproved-foreign',
      'completion-error-foreign',
      'completion-pass-coverage',
      'archive-missing-approval',
      'archive-pass-approval',
      'archive-form-openspec',
      'archive-form-mv',
      'archive-form-move-item',
      'archive-form-git-mv',
      'verify-code-write-missing-check',
      'verify-code-write-success',
      'verify-code-write-failed-check',
      'verify-non-code-turn',
      'verify-inert-no-commands',
      'verify-background-check',
      'verify-settings-profile-a',
      'verify-settings-profile-b',
      'verify-cap-129-refuses-below',
      'verify-cap-129-allows-at-cap',
      'retained-spec-review-missing',
      'retained-spec-review-stale',
      'retained-progress-current-note',
      'retained-progress-stale-note',
      'retained-progress-unchecked-missing-note',
      'retained-progress-reviewed-tick',
      'retained-lane-first-implementation-turn',
      'retained-lane-single-remaining',
      'retained-lane-below-threshold',
      'retained-lane-assigned-worker',
    ]
    expect(PARITY_CASES.map((entry) => entry.id)).toEqual(expect.arrayContaining(required))
    for (const entry of PARITY_CASES) {
      if (entry.gate === 'retained') {
        expect(entry.retained).toBeDefined()
        expect(entry.workflow).toBeUndefined()
      } else {
        expect(entry.workflow).toBeDefined()
        expect(entry.legacy.decision).toMatch(/allow|refuse/u)
      }
    }
  })

  it('fails the report and the exit code on a deliberate mismatch', async () => {
    const mismatch = {
      id: 'deliberate-mismatch',
      gate: 'checkpoint' as const,
      legacy: { decision: 'allow' as const, reason: 'legacy allows' },
      workflow: async () => ({ decision: 'refuse' as const, reason: 'workflow refuses' }),
    }
    const report = await buildParityReport(new Date(), [...PARITY_CASES, mismatch])
    const text = report.mismatches.join('\n')
    expect(text).toContain('deliberate-mismatch')
    expect(text).toContain('legacy allows')
    expect(text).toContain('workflow refuses')
    expect(report.gates.checkpoint?.status).toBe('fail')
    expect(parityExitCode(report)).toBe(1)
    expect(parityExitCode({ mismatches: [] })).toBe(0)
  })

  it('fails when a required archive form loses recognition', async () => {
    const directory = await tempDirectory()
    expect(() => assertArchiveRecognition('mv docs/a.md docs/b.md', directory)).toThrow(
      /not recognized/u,
    )
  })

  it('fails when a shipped step stops enforcing or its evidence changes', async () => {
    const { loadShippedDefinitions } = await import(
      '../../packages/plugin-workflows/lib/definitions.js'
    )
    const { evaluateTurnClose } = await import('../../packages/plugin-workflows/lib/gates.js')
    const { verifyEvidence } = await import('../../packages/plugin-workflows/lib/evidence.js')
    const { createRun, settleStep } = await import('../../packages/plugin-workflows/lib/runs.js')
    const shipped = loadShippedDefinitions()
    const taskReview = shipped.find((entry) => entry.id === 'task-review')
    const verify = shipped.find((entry) => entry.id === 'verify')
    if (taskReview === undefined || verify === undefined) throw new Error('definitions missing')

    const unblocked = {
      ...taskReview,
      steps: taskReview.steps.map((step) => ({ ...step, blockTurnClose: false })),
    }
    const reviewCase = {
      id: 'task-review-without-blocking-close',
      gate: 'task-review' as const,
      legacy: { decision: 'refuse' as const, reason: 'legacy refuses the missing review' },
      workflow: (): Promise<{ decision: 'allow' | 'refuse'; reason: string }> => {
        let run = createRun({
          definition: 'task-review',
          trigger: 'fs.change',
          session: 'session-1',
          workspace: '/workspace',
          context: { name: 'change-a', taskId: '0123456789abcdef' },
          steps: ['start-review', 'await-review', 'complete-review'],
          now: 1_000,
        })
        run = settleStep(run, 'start-review', 'done', { at: 1_001 })
        const outcome = evaluateTurnClose({
          run,
          definition: unblocked,
          agent: { steer: () => undefined },
          evidenceContext: { workspace: '/workspace', values: {} },
          turn: 1,
          maxBlocks: 3,
          installedLegacy: new Set(),
          enabledLegacy: new Set(),
        })
        return Promise.resolve(
          outcome.kind === 'allow'
            ? { decision: 'allow', reason: 'the unblocked await step closed' }
            : { decision: 'refuse', reason: 'the await step blocked' },
        )
      },
    }

    const rewordedEvidence = {
      ...verify,
      steps: verify.steps.map((step) =>
        step.id === 'check'
          ? {
              ...step,
              evidence: { kind: 'check' as const, source: 'task-review-coverage' as const },
            }
          : step,
      ),
    }
    const evidenceCase = {
      id: 'verify-with-incompatible-evidence',
      gate: 'verification' as const,
      legacy: { decision: 'allow' as const, reason: 'legacy allows the successful check' },
      workflow: async (): Promise<{ decision: 'allow' | 'refuse'; reason: string }> => {
        const step = rewordedEvidence.steps.find((entry) => entry.id === 'check')
        if (step?.evidence === undefined) throw new Error('check evidence missing')
        const check = await verifyEvidence(step.evidence, {
          workspace: '/workspace',
          values: {},
          checkCommands: ['pnpm check'],
          lastWriteAt: 100,
          shellResults: [
            { callId: 'c1', command: 'pnpm check', at: 120, exitCode: 0, foreground: true },
          ],
        })
        return check.ok
          ? { decision: 'allow', reason: 'the swapped evidence passed' }
          : { decision: 'refuse', reason: 'the swapped evidence failed' }
      },
    }

    const report = await buildParityReport(new Date(), [...PARITY_CASES, reviewCase, evidenceCase])
    const text = report.mismatches.join('\n')
    expect(text).toContain('task-review-without-blocking-close')
    expect(text).toContain('verify-with-incompatible-evidence')
    expect(parityExitCode(report)).toBe(1)
  })

  it('fails when the verify definition stops blocking the close', async () => {
    const { loadShippedDefinitions } = await import(
      '../../packages/plugin-workflows/lib/definitions.js'
    )
    const { evaluateTurnClose } = await import('../../packages/plugin-workflows/lib/gates.js')
    const { createRun } = await import('../../packages/plugin-workflows/lib/runs.js')
    const verify = loadShippedDefinitions().find((entry) => entry.id === 'verify')
    if (verify === undefined) throw new Error('the verify definition is missing')
    const unblocked = {
      ...verify,
      steps: verify.steps.map((step) => ({ ...step, blockTurnClose: false })),
    }
    const crafted = {
      id: 'verify-without-blocking-close',
      gate: 'verification' as const,
      legacy: { decision: 'refuse' as const, reason: 'legacy refuses the unverified close' },
      workflow: (): Promise<{ decision: 'allow' | 'refuse'; reason: string }> => {
        const outcome = evaluateTurnClose({
          run: createRun({
            definition: 'verify',
            trigger: 'turn.stopping',
            session: 'session-1',
            workspace: '/workspace',
            context: {},
            steps: ['check'],
            now: 1_000,
          }),
          definition: unblocked,
          agent: { steer: () => undefined },
          evidenceContext: { workspace: '/workspace', values: {} },
          turn: 1,
          maxBlocks: 8,
          installedLegacy: new Set(),
          enabledLegacy: new Set(),
        })
        return Promise.resolve(
          outcome.kind === 'allow'
            ? { decision: 'allow', reason: 'the unblocked step closed' }
            : { decision: 'refuse', reason: 'the step blocked' },
        )
      },
    }
    const report = await buildParityReport(new Date(), [...PARITY_CASES, crafted])
    expect(report.mismatches.join('\n')).toContain('verify-without-blocking-close')
    expect(parityExitCode(report)).toBe(1)
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
