import { describe, expect, it } from 'vitest'
import { loadShippedDefinitions } from '../src/host/definitions.ts'
import {
  type ParityReport,
  parityLoadIssues,
  readParityReport,
  reportBoundDefinitions,
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

  it('refuses the bound definitions when a gate is not pass', () => {
    const { definitions, report } = shipped()
    const failing = {
      ...report,
      gates: Object.fromEntries(
        Object.entries(report.gates).map(([id, gate]) => [id, { ...gate, status: 'fail' }]),
      ),
    } as ParityReport
    const result = parityLoadIssues(definitions, failing, reportPath, undefined)
    expect([...result.refused].sort()).toEqual(
      reportBoundDefinitions(definitions)
        .map((definition) => definition.id)
        .sort(),
    )
    for (const issue of result.issues) expect(issue).toContain('parity gate is not pass')
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
})
