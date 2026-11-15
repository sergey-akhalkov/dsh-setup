import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveBundledInstruction } from '../../plugin-delegation-rules/src/host/index.ts'
import { readReviewInstruction } from '../src/host/review.ts'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..')
const SHIPPED = join(ROOT, 'packages/plugin-workflows/assets/reviews')
const LEGACY = join(ROOT, 'packages/plugin-delegation-rules/assets/delegation-rules')
const IDS = ['review-spec', 'review-task', 'review-integration']

describe('bundled review instructions', () => {
  it('ships the three ids byte-identically to the legacy copies', () => {
    for (const id of IDS) {
      const shipped = readFileSync(join(SHIPPED, `${id}.md`))
      const legacy = readFileSync(join(LEGACY, `${id}.md`))
      expect(shipped.equals(legacy), id).toBe(true)
      const text = shipped.toString()
      expect(text, id).toContain('P0')
      expect(text, id).toContain('P1')
      expect(text.toLowerCase(), id).toContain('class')
    }
  })

  it('resolves both copies through their readers', () => {
    for (const id of IDS) {
      const text = readReviewInstruction(id)
      expect(text, id).toBe(readFileSync(join(SHIPPED, `${id}.md`), 'utf8'))
    }
    expect(resolveBundledInstruction('bundled:review-task')).toBe(
      readFileSync(join(LEGACY, 'review-task.md'), 'utf8'),
    )
  })

  it('ships only review instruction ids', () => {
    expect(readdirSync(SHIPPED).sort()).toEqual(IDS.map((id) => `${id}.md`).sort())
  })
})
