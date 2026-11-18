import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const skill = readFileSync(join(packageDir, 'assets', 'exploratory-testing', 'SKILL.md'), 'utf8')
const templates = readFileSync(
  join(packageDir, 'assets', 'exploratory-testing', 'templates.md'),
  'utf8',
)

describe('exploratory testing skill content', () => {
  it('names the eight state factors, their anchors, and the score', () => {
    for (const factor of ['B', 'K', 'T', 'C', 'D', 'A', 'S', 'F']) {
      expect(skill, factor).toMatch(new RegExp(`^\\| ${factor} \\| `, 'mu'))
    }
    expect(skill).toContain('score = B * (K + T + C + D + A + S) - F')
    expect(skill).toContain('blast radius')
    expect(skill).toContain('feasibility cost')
  })

  it('names both user gates and the no-session-before-approval rule', () => {
    expect(skill).toContain('## User gate 1: focus approval')
    expect(skill).toContain('## User gate 2: finding classification')
    expect(skill).toContain('start any exploratory session until the user approves')
    expect(skill).toContain('must not execute a fix task')
  })

  it('names the five finding classifications', () => {
    for (const classification of ['bug', 'feature', 'spec error', 'test gap', 'unknown']) {
      expect(skill, classification).toMatch(new RegExp(`^- ${classification} — `, 'm'))
    }
  })

  it('states the red-proof, mutation, and scenario-mapping rules', () => {
    expect(skill).toContain('fails on the pre-fix code and passes after the fix')
    expect(skill).toContain('mutation check')
    expect(skill).toContain('delta scenario or to an explicitly named existing scenario')
    expect(skill).toContain('Line coverage and test counts are not goals')
  })

  it('makes the cycle change spec-less and allows the spec-less outcome', () => {
    expect(skill).toContain('`skip_specs: true`')
    expect(skill).toContain('must carry no')
    expect(skill).toContain('## Spec-less outcome change')
    expect(skill).toContain('maps to an explicitly named existing scenario')
    expect(skill).toContain('must never invent a')
    expect(skill).toContain('requirement or a delta to satisfy validation')
  })

  it('has a named section for every requirement of the delta spec', () => {
    for (const section of [
      'When to use it',
      'State scan and focus register',
      'Selection rules',
      'User gate 1: focus approval',
      'Cycle change A',
      'Sessions',
      'Triage and candidate findings',
      'Outcome change B',
      'User gate 2: finding classification',
      'Spec-less outcome change',
      'Evidence contract',
      'Close and the next input',
      'Portability and safety',
    ]) {
      expect(skill, section).toContain(`## ${section}`)
    }
  })

  it('covers the portability and prerequisite boundaries', () => {
    expect(skill).toContain('OpenSpec CLI')
    expect(skill).toContain('do not fabricate a change')
    expect(skill).toContain('Never assume dsh-setup paths')
    expect(skill).toContain('production data')
    expect(skill).toContain('throwaway `DSH_HOME`')
  })
})

describe('exploratory testing templates', () => {
  it('ships the A, B, finding, and session templates', () => {
    for (const heading of [
      '## A: proposal.md',
      '## A: design.md',
      '## A: tasks.md',
      '## A: state.md',
      '## A: brief.md',
      '## Session record',
      '## B: proposal.md',
      '## B: design.md',
      '## B: finding record',
      '## B: decision log entry',
      '## B: tasks.md',
    ]) {
      expect(templates, heading).toContain(heading)
    }
  })

  it('names every charter field the method requires', () => {
    for (const field of [
      'Mission:',
      'Risk hypothesis:',
      'Areas:',
      'Oracles:',
      'Heuristics:',
      'Timebox:',
      'Out-of-scope:',
      'Exit criteria:',
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

  it('names every finding-record and decision-log field', () => {
    for (const field of [
      'Severity:',
      'Confidence:',
      'Proposed class:',
      'Status:',
      'Observed behavior',
      'Expected behavior or oracle',
      'Evidence',
      'Minimal reproduction',
      'Blast radius',
      'Decision:',
      'Rationale:',
      'Oracle or scenario:',
    ]) {
      expect(templates, field).toContain(field)
    }
  })

  it('carries the A and B artifact contracts', () => {
    for (const field of [
      'Why this area now',
      'State snapshot',
      'In scope',
      'Non-goals',
      'Focus register',
      'Rejected candidates',
      'Approval decision',
      'Findings summary',
      'Classification decision requested',
      'Decision log',
      'Spec decision',
      'red run',
      'green',
    ]) {
      expect(templates, field).toContain(field)
    }
  })
})
