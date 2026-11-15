import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkedTaskIds, isTaskChecked, taskIdOf } from '../src/host/tasks.ts'

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
