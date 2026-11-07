import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendFindingHistory,
  type HistoryRunEntry,
  readFindingHistory,
} from '../src/host/finding-history.ts'
import { reviewRetro } from '../src/host/retro.ts'
import { makeWorkspace } from './helpers.js'

const cleanups: Array<() => Promise<void>> = []

async function workspace(): Promise<string> {
  const created = await makeWorkspace()
  cleanups.push(created.cleanup)
  return created.root
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

const TASK_ID = 'abc123abc123abc1'

function run(verdict: 'PASS' | 'FINDINGS', time: string): HistoryRunEntry {
  return {
    v: 1,
    kind: 'run',
    rule: 'task-review',
    change: 'change-a',
    taskId: TASK_ID,
    verdict,
    digest: 'a'.repeat(64),
    findings:
      verdict === 'FINDINGS'
        ? [
            {
              class: 'missing-test',
              title: 'Missing failure test',
              evidence: 'src/file.ts:1 no failure test',
              fix: 'add the failure test',
            },
          ]
        : [],
    time,
  }
}

describe('finding history fixture', () => {
  it('counts the earlier finding once after a later PASS review of the same task', async () => {
    const root = await workspace()
    await appendFindingHistory(root, run('FINDINGS', '2026-11-01T00:00:00.000Z'))
    await appendFindingHistory(root, run('PASS', '2026-11-02T00:00:00.000Z'))
    // The authoritative local record is now PASS; the history keeps the findings.
    const recordPath = join(
      root,
      '.dsh',
      'delegation',
      'task-review',
      'change-a',
      'tasks',
      `${TASK_ID}.json`,
    )
    await mkdir(dirname(recordPath), { recursive: true })
    await writeFile(
      recordPath,
      JSON.stringify({
        rule: 'task-review',
        change: 'change-a',
        phase: 'task',
        scope: 'task',
        taskId: TASK_ID,
        digest: 'a'.repeat(64),
        verdict: 'PASS',
        findings: [],
        target: { provider: 'codex-subagent' },
        time: '2026-11-02T00:00:00.000Z',
      }),
      'utf8',
    )

    const read = await readFindingHistory(root)
    expect(
      read.entries.map((entry) => (entry.kind === 'run' ? entry.verdict : entry.kind)),
    ).toEqual(['FINDINGS', 'PASS'])
    const report = await reviewRetro(root)
    expect(report.findings).toBe(1)
    expect(report.entries).toBe(2)
    expect(report.topClass).toBe('missing-test')
    expect(report.examples[0]).toMatchObject({ change: 'change-a', taskId: TASK_ID })
  })

  it('reads a missing history file as empty', async () => {
    const root = await workspace()
    expect(await readFindingHistory(root)).toEqual({ entries: [], skipped: 0, gaps: 0 })
  })
})
