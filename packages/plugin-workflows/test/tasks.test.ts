import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkedTaskIds,
  isTaskChecked,
  resolveTaskSection,
  sectionCoverage,
  sectionRecordId,
  taskIdOf,
} from '../src/host/tasks.ts'

const SECTIONS = `# Tasks

## 1. Compose the profile (lane 1, owns \`packages/plugin-workflows/**\`)

- [x] 1.1 First covered
- [x] 1.2 Second covered
- [ ] 1.3 Unchecked follow-up

## 2. Docs (lane 2, owns \`docs/**\`)

- [ ] 2.1 Doc task
`

const SECTION_PLAN_UNCHECKED = SECTIONS.replace('- [x] 1.2', '- [ ] 1.2')

describe('section selectors', () => {
  it('resolves the heading number, its wildcard form, and the title', () => {
    for (const selector of [
      '1',
      '1.x',
      '1.*',
      'Compose the profile (lane 1, owns `packages/plugin-workflows/**`)',
    ]) {
      const section = resolveTaskSection(SECTIONS, selector, 'auth')
      expect(section.key, selector).toBe('1')
      expect(
        section.covered.map((task) => task.text),
        selector,
      ).toEqual(['First covered', 'Second covered'])
      expect(
        section.unchecked.map((task) => task.text),
        selector,
      ).toEqual(['Unchecked follow-up'])
    }
    expect(sectionRecordId('1')).toMatch(/^[0-9a-f]{16}$/u)
  })

  it('rejects an unknown section and a section with no checked task', () => {
    expect(() => resolveTaskSection(SECTIONS, '9', 'auth')).toThrow(
      /section "9" was not found in change "auth"; available sections/u,
    )
    expect(() => resolveTaskSection(SECTIONS, '2', 'auth')).toThrow(
      /section "2" in change "auth" has no checked task/u,
    )
  })

  it('keeps the submitted coverage and refuses a checked task that moved away', () => {
    const covered = resolveTaskSection(SECTIONS, '1', 'auth')
    const ids = covered.covered.map((task) => task.id)
    const kept = sectionCoverage(SECTIONS, '1', ids)
    expect('section' in kept).toBe(true)
    const unchecked = SECTION_PLAN_UNCHECKED
    const moved = sectionCoverage(unchecked, '1', ids)
    expect('error' in moved && moved.error).toMatch(/is not checked in section "1"/u)
  })
})

describe('task ids', () => {
  it('is checked only while the live task is checked', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dsh-task-'))
    const dir = join(workspace, 'openspec', 'changes', 'auth')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'tasks.md'), '- [x] 1.1 Done task\n- [ ] 1.2 Waiting task\n')
    expect(isTaskChecked(workspace, 'auth', taskIdOf('Done task'))).toBe(true)
    expect(isTaskChecked(workspace, 'auth', taskIdOf('Waiting task'))).toBe(false)
    rmSync(workspace, { recursive: true, force: true })
  })

  it('matches the delegation engine id and parses checked tasks in file order', () => {
    const expected = createHash('sha256').update('Implement the intake').digest('hex').slice(0, 16)
    expect(taskIdOf('Implement  the\nintake')).toBe(expected)
    const markdown = [
      '# Tasks',
      '',
      '- [x] 1.1 First  task',
      '- [ ] 1.2 Not done',
      '- [X] 2.3 Third',
    ].join('\n')
    expect(checkedTaskIds(markdown)).toEqual([taskIdOf('First task'), taskIdOf('Third')])
  })
})
