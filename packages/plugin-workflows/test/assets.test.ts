import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readReviewInstruction } from '../src/host/review.ts'

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), '..', '..')
const SHIPPED = join(ROOT, 'packages/plugin-workflows/assets/reviews')
const IDS = ['review-spec', 'review-task', 'review-integration']

describe('bundled review instructions', () => {
  it('ships the three ids with the P0/P1 rubric', () => {
    for (const id of IDS) {
      const text = readFileSync(join(SHIPPED, `${id}.md`), 'utf8')
      expect(text, id).toContain('P0')
      expect(text, id).toContain('P1')
      expect(text.toLowerCase(), id).toContain('class')
    }
  })

  it('ships the review posture in every instruction', () => {
    for (const id of IDS) {
      const text = readFileSync(join(SHIPPED, `${id}.md`), 'utf8')
      expect(text, id).toContain('## Review posture')
      expect(text, id).toContain('Do not ask the user')
      expect(text.replace(/\s+/gu, ' '), id).toContain('single fenced JSON block')
    }
  })

  it('documents the focused re-review confirmation contract', () => {
    const text = readFileSync(join(SHIPPED, 'review-task.md'), 'utf8')
    for (const phrase of [
      '## Previous findings',
      '## Changes since the last review',
      '"previous"',
      '"previousId"',
      'closed',
      'open',
    ]) {
      expect(text, phrase).toContain(phrase)
    }
  })

  it('resolves the shipped instructions through their reader', () => {
    for (const id of IDS) {
      const text = readReviewInstruction(id)
      expect(text, id).toBe(readFileSync(join(SHIPPED, `${id}.md`), 'utf8'))
    }
  })

  it('ships only review instruction ids', () => {
    expect(readdirSync(SHIPPED).sort()).toEqual(IDS.map((id) => `${id}.md`).sort())
  })
})
