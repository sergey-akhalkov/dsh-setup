import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const skill = readFileSync(join(packageDir, 'assets', 'refactoring', 'SKILL.md'), 'utf8')
const templates = readFileSync(join(packageDir, 'assets', 'refactoring', 'templates.md'), 'utf8')
/** Prose is wrapped for readability; phrases are matched with whitespace collapsed. */
const prose = skill.split(/\s+/).filter(Boolean).join(' ')

describe('refactoring skill content', () => {
  it('names the nine ROI factors, their anchors, and the formula', () => {
    for (const factor of ['H', 'C', 'D', 'A', 'M', 'B', 'E', 'R', 'F']) {
      expect(skill, factor).toMatch(new RegExp(`^\\| ${factor} \\| `, 'mu'))
    }
    expect(skill).toContain('value = (H + 1) * (C + D + A + M) * (B + 1)')
    expect(skill).toContain('cost  = (E + 1) * (R + F + 1)')
    expect(skill).toContain('ROI   = value / cost')
    expect(skill).toContain('hotspot')
    expect(skill).toContain('change coupling')
  })

  it('names both user gates and the no-edit-before-approval rule', () => {
    expect(skill).toContain('## User gate 1: path approval')
    expect(skill).toContain('## User gate 2: safety-net approval')
    expect(prose).toContain(
      'Do not edit production code and do not create the refactor change until',
    )
    expect(prose).toContain('do not edit production code until the user approves the net')
  })

  it('names the four safety-net proofs and the weak-net refusal', () => {
    expect(skill).toContain('1. Green baseline')
    expect(skill).toContain('2. Behavior oracles')
    expect(skill).toContain('3. Mutation proof')
    expect(skill).toContain('4. Performance or data baseline')
    expect(skill).toContain('A weak net is refused')
  })

  it('states the behavior-change stop rule and the test-removal rule', () => {
    expect(skill).toContain('## Behavior-change stop rule')
    expect(prose).toContain('separate red-test-first change')
    expect(prose).toContain('never improvises a behavior change')
    expect(prose).toContain('Never delete a test that encodes live behavior')
    expect(prose).toContain('proven-dead code')
  })

  it('requires the highest-ROI path and excludes the previous area without a hard override', () => {
    expect(prose).toContain('Select the highest-ROI eligible candidate')
    expect(prose).toContain("exclude the previous cycle's area unless a hard override applies")
    expect(prose).toContain('rotate the path class and the area')
    // The spec scenario has no second exception: no anti-repetition bypass for a failed refactor.
    expect(prose).not.toContain('failed verification')
  })

  it('requires a ratchet and its baseline', () => {
    expect(prose).toContain('At least one automated ratchet guards the target architecture')
    expect(skill).toContain('## Ratchet baseline')
    expect(prose).toContain('fail only on new violations')
    expect(prose).toContain('Never widen the baseline')
  })

  it('makes the refactor change spec-less when nothing enforceable changes', () => {
    expect(skill).toContain('## Spec-less refactor change')
    expect(skill).toContain('`skip_specs: true`')
    expect(skill).toContain('Never invent a requirement, or a delta, to satisfy validation')
  })

  it('keeps the audit artifacts review-safe', () => {
    expect(skill).toContain('## Audit change A')
    expect(skill).toContain('`findings/P-*.md`')
    expect(skill).toContain('The whole-spec review reads these')
    expect(skill).toContain('`audit.md` and `brief.md` hold the raw')
    expect(skill).toContain('evidence and are linked, not required for the verdict')
  })

  it('stops instead of inventing prerequisites or a toolchain', () => {
    expect(skill).toContain('## Prerequisites')
    expect(skill).toContain('report the')
    expect(skill).toContain('do not fabricate a change')
    expect(skill).toContain('do not add a fake delta')
    expect(skill).toContain('Do not require CodeGraph')
    expect(skill).toContain("do not install a new tool without the user's approval")
    expect(skill).toContain('Never assume dsh-setup paths')
    expect(skill).toContain('production data or a live Harness profile')
  })

  it('allows the optional Serena adapter without making it mandatory', () => {
    expect(skill).toContain('## Optional tool adapters')
    expect(skill).toContain('Serena is optional')
    expect(skill).toContain('record the gap')
  })

  it('has a named section for every requirement of the delta spec', () => {
    for (const section of [
      'When to use it',
      'Prerequisites',
      'Cycle at a glance',
      'Audit sources and baseline',
      'ROI register and the nine factors',
      'Selection rules',
      'User gate 1: path approval',
      'Audit change A',
      'Refactor change B',
      'Spec-less refactor change',
      'Safety net: four proofs',
      'User gate 2: safety-net approval',
      'Green steps',
      'Behavior-change stop rule',
      'Deduplication rule',
      'Migration patterns',
      'Verification and the ratchet',
      'Ratchet baseline',
      'Close and continuity',
      'Portability and safety',
      'Optional tool adapters',
    ]) {
      expect(skill, section).toContain(`## ${section}`)
    }
  })
})

describe('refactoring templates', () => {
  it('ships the audit A, path record, refactor B, record, and close templates', () => {
    for (const heading of [
      '## A: proposal.md',
      '## A: design.md',
      '## A: tasks.md',
      '## A: path finding record (`findings/P-<n>.md`)',
      '## A: audit.md',
      '## A: brief.md',
      '## B: proposal.md',
      '## B: design.md',
      '## B: tasks.md',
      '## B: safety-net record',
      '## B: step record',
      '## B: verification and ratchet record',
      '## Close record',
    ]) {
      expect(templates, heading).toContain(heading)
    }
  })

  it('carries the register, the formula, and the selection fields', () => {
    for (const field of [
      'ROI register',
      'Formula:',
      'Hard overrides',
      'Rejected candidates',
      'Previous cycle area',
      'WIP state',
      'path class',
      'Approval decision',
    ]) {
      expect(templates, field).toContain(field)
    }
  })

  it('ships the refactor B task plan with every phase', () => {
    const start = templates.indexOf('## B: tasks.md')
    expect(start).toBeGreaterThan(-1)
    const block = templates.slice(start)
    for (const phase of [
      '## 1. Safety net',
      '## 2. Gate 2 and the steps',
      '## 3. Deduplication and deletion',
      '## 4. Ratchet and verification',
      '## 5. Close',
    ]) {
      expect(block, phase).toContain(phase)
    }
    for (const rule of ['user gate 2 approval', 'narrow suite, full suite, commit', 'ratchet']) {
      expect(block, rule).toContain(rule)
    }
  })

  it('carries every safety-net field', () => {
    for (const field of [
      'Green baseline',
      'Behavior oracles',
      'Mutation proof',
      'Performance or data baseline',
      'Known flakes',
      'Budget',
      'Gate 2 decision',
      'Missing proof when refused',
    ]) {
      expect(templates, field).toContain(field)
    }
  })

  it('carries the verification, ratchet, knowledge, and close fields', () => {
    for (const field of [
      'Public contract diff empty',
      'Performance within budget',
      'Full suite green',
      'Target metric improved',
      'Ratchet landed',
      'Baseline frozen',
      'Hindsight digest',
      'State snapshot updated',
      'Next input',
    ]) {
      expect(templates, field).toContain(field)
    }
  })

  it('ships proposals with the OpenSpec Why and What Changes headings', () => {
    for (const heading of ['## A: proposal.md', '## B: proposal.md']) {
      const start = templates.indexOf(heading)
      const fence = templates.indexOf('```markdown', start)
      const end = templates.indexOf('\n```', fence + '```markdown'.length)
      const block = templates.slice(fence + '```markdown'.length, end)
      expect(block, heading).toMatch(/^## Why$/mu)
      expect(block, heading).toMatch(/^## What Changes$/mu)
    }
  })
})
