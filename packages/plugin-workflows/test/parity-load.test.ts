import { describe, expect, it } from 'vitest'
import { loadShippedDefinitions } from '../src/host/definitions.ts'
import {
  type ParityReport,
  parityLoadIssues,
  readParityReport,
  reportBoundDefinitions,
  retiredGateIssue,
  shippedParityReportPath,
} from '../src/host/parity.ts'

/**
 * The runtime report filter: an own definition loads only when the shipped
 * report covers its template hash and every gate passed. These are the loader
 * regressions for task 2.3; bypassing the filter would make them fail.
 */

const reportPath = shippedParityReportPath()

function shipped(): {
  definitions: ReturnType<typeof loadShippedDefinitions>
  report: ParityReport
} {
  const definitions = loadShippedDefinitions()
  const { report, error } = readParityReport(reportPath)
  expect(error).toBeUndefined()
  if (report === undefined) throw new Error('the shipped parity report is missing')
  return { definitions, report }
}

describe('parity report load filter', () => {
  it('loads every own definition when the report covers it and all gates pass', () => {
    const { definitions, report } = shipped()
    const bound = reportBoundDefinitions(definitions)
    expect(bound.length).toBeGreaterThan(0)
    const result = parityLoadIssues(definitions, report, reportPath, undefined)
    expect(result.issues).toEqual([])
    expect([...result.refused]).toEqual([])
  })

  it('refuses the bound definitions when the report is missing', () => {
    const { definitions } = shipped()
    const bound = reportBoundDefinitions(definitions).map((definition) => definition.id)
    const result = parityLoadIssues(definitions, undefined, 'missing.json', 'not found')
    expect([...result.refused].sort()).toEqual(bound.sort())
    expect(result.issues).toHaveLength(bound.length)
    for (const issue of result.issues) expect(issue).toContain('legacy gate')
  })

  it('refuses the bound definitions when a gate or its retained replay is not pass', () => {
    const { definitions, report } = shipped()
    const failing = {
      ...report,
      gates: Object.fromEntries(
        Object.entries(report.gates).map(([id, gate]) => [id, { ...gate, status: 'fail' }]),
      ),
      retained: Object.fromEntries(
        Object.entries(report.retained).map(([id, entry]) => [id, { ...entry, status: 'failed' }]),
      ),
    } as ParityReport
    const result = parityLoadIssues(definitions, failing, reportPath, undefined)
    expect([...result.refused].sort()).toEqual(
      reportBoundDefinitions(definitions)
        .map((definition) => definition.id)
        .sort(),
    )
    for (const issue of result.issues) {
      expect(issue).toMatch(/parity gate is not pass|did not replay/u)
    }
  })

  it('refuses the bound definitions when a template hash differs', () => {
    const { definitions, report } = shipped()
    const bound = reportBoundDefinitions(definitions)
    const mismatched = {
      ...report,
      templates: {
        ...report.templates,
        ...Object.fromEntries(bound.map((definition) => [definition.id, 'stale'])),
      },
    }
    const result = parityLoadIssues(definitions, mismatched, reportPath, undefined)
    expect([...result.refused].sort()).toEqual(bound.map((definition) => definition.id).sort())
    for (const issue of result.issues) expect(issue).toContain('does not match the report')
  })

  it('binds spec-review and integration-review to their replayed retained cases', () => {
    const { definitions, report } = shipped()
    const bound = reportBoundDefinitions(definitions).map((definition) => definition.id)
    expect(bound).toEqual(expect.arrayContaining(['spec-review', 'integration-review']))

    for (const group of ['spec-review', 'integration-review'] as const) {
      // Failure: a recorded mismatch fails every bound definition.
      const mismatch = { ...report, mismatches: [`the ${group} replay differs`] }
      const mismatchResult = parityLoadIssues(definitions, mismatch, reportPath, undefined)
      expect([...mismatchResult.refused]).toEqual(expect.arrayContaining([group]))
      expect(mismatchResult.issues.join('\n')).toContain('decision mismatch')
    }

    for (const group of ['spec-review', 'integration-review'] as const) {
      // Absent evaluator: the retained replay summary is failed or absent.
      const failed = {
        ...report,
        retained: {
          ...report.retained,
          [group]: { cases: 3, replayed: group === 'spec-review' ? 2 : 1, status: 'failed' },
        },
      }
      const failedResult = parityLoadIssues(definitions, failed, reportPath, undefined)
      expect([...failedResult.refused]).toContain(group)
      expect(failedResult.issues.join('\n')).toContain(`retained "${group}" parity cases`)
      const missing = {
        ...report,
        retained: Object.fromEntries(
          Object.entries(report.retained).filter(([key]) => key !== group),
        ),
      }
      expect([...parityLoadIssues(definitions, missing, reportPath, undefined).refused]).toContain(
        group,
      )
    }
  })

  it('certifies the owned work-progress and lane gates from the same report', () => {
    const { report } = shipped()
    expect(retiredGateIssue(report, undefined, reportPath, 'task-progress')).toBeUndefined()
    expect(retiredGateIssue(report, undefined, reportPath, 'lane-assignment')).toBeUndefined()

    const failed = {
      ...report,
      retained: {
        ...report.retained,
        'task-progress': { cases: 4, replayed: 3, status: 'failed' },
      },
    }
    const issue = retiredGateIssue(failed, undefined, reportPath, 'task-progress')
    expect(issue).toContain('did not replay')
    expect(issue).toContain('fix the parity report')
    const missing = retiredGateIssue(undefined, 'no report', 'missing.json', 'lane-assignment')
    expect(missing).toContain('missing or unreadable')
    expect(missing).toContain('fix the parity report')
  })
})
