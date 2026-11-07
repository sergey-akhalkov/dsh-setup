import { describe, expect, it } from 'vitest'
import { parseVerdict } from '../src/host/index.js'

const DIGEST = 'a'.repeat(64)

function fenced(value: unknown): string {
  return ['Reviewed.', '', '```json', JSON.stringify(value), '```'].join('\n')
}

function finding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    severity: 'P1',
    title: 'Short failure title',
    evidence: 'src/file.ts:1 the failure',
    fix: 'the smallest change',
    ...overrides,
  }
}

describe('verdict finding class', () => {
  it('stores a valid class with the finding', () => {
    const parsed = parseVerdict(
      fenced({
        digest: DIGEST,
        verdict: 'FINDINGS',
        findings: [finding({ class: 'path-boundary' })],
      }),
      DIGEST,
    )
    expect(parsed.verdict).toBe('FINDINGS')
    expect(parsed.findings[0]?.class).toBe('path-boundary')
  })

  it('normalizes an absent class to other and still accepts the verdict', () => {
    const parsed = parseVerdict(
      fenced({ digest: DIGEST, verdict: 'FINDINGS', findings: [finding()] }),
      DIGEST,
    )
    expect(parsed.findings[0]?.class).toBe('other')
  })

  it('normalizes an unknown or malformed class to other and never rejects the verdict', () => {
    for (const malformed of ['made-up', 7, null, { class: 'security' }]) {
      const parsed = parseVerdict(
        fenced({ digest: DIGEST, verdict: 'FINDINGS', findings: [finding({ class: malformed })] }),
        DIGEST,
      )
      expect(parsed.verdict).toBe('FINDINGS')
      expect(parsed.findings[0]?.class).toBe('other')
    }
  })

  it('leaves a PASS with no findings unchanged', () => {
    const parsed = parseVerdict(fenced({ digest: DIGEST, verdict: 'PASS', findings: [] }), DIGEST)
    expect(parsed).toEqual({ verdict: 'PASS', findings: [] })
  })
})
