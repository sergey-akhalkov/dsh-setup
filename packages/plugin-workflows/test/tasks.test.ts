import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkedTaskIds, taskIdOf } from '../src/host/tasks.ts'

describe('task ids', () => {
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
