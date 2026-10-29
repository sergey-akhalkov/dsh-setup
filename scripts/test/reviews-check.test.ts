import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  portableTaskRecordPath,
  taskIdOf,
} from '../../packages/plugin-delegation-rules/src/shared/approval.ts'
import { exportChange } from '../reviews-check.ts'

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
const TASK_TEXT = 'Add the reviewed behavior'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop()
    if (cleanup !== undefined) await cleanup()
  }
})

interface FixtureOptions {
  checked?: boolean
  local?: Record<string, unknown> | null
}

async function fixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reviews-check-'))
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true })
  })
  const changeDir = join(root, 'openspec', 'changes', 'change-a')
  await mkdir(join(changeDir, 'specs', 'capability'), { recursive: true })
  await writeFile(join(changeDir, 'proposal.md'), '# Proposal\n', 'utf8')
  await writeFile(join(changeDir, 'design.md'), '# Design\n', 'utf8')
  await writeFile(join(changeDir, 'specs', 'capability', 'spec.md'), '# Spec\n', 'utf8')
  const mark = options.checked === false ? ' ' : 'x'
  await writeFile(join(changeDir, 'tasks.md'), `# Tasks\n\n- [${mark}] 1.1 ${TASK_TEXT}\n`, 'utf8')
  const taskId = taskIdOf(TASK_TEXT)
  const localRecord = {
    rule: 'task-review',
    change: 'change-a',
    phase: 'task',
    scope: 'task',
    taskId,
    digest: DIGEST_A,
    worktreeDigest: DIGEST_B,
    verdict: 'PASS',
    findings: [],
    target: { provider: 'codex-subagent' },
    session: 'session-not-committed',
    runId: 'run-not-committed',
    time: '2026-10-29T08:55:43.317Z',
  }
  if (options.local !== null) {
    const localPath = join(
      root,
      '.dsh',
      'delegation',
      'task-review',
      'change-a',
      'tasks',
      `${taskId}.json`,
    )
    await mkdir(join(localPath, '..'), { recursive: true })
    await writeFile(localPath, JSON.stringify({ ...localRecord, ...options.local }), 'utf8')
  }
  return { root, changeDir, taskId, localRecord }
}

describe('reviews:export', () => {
  it('copies a local PASS into the change as a sanitized portable record', async () => {
    const { root, changeDir, taskId } = await fixture()
    const result = exportChange(root, 'change-a')
    expect(result.ok).toBe(true)
    const portable = JSON.parse(
      await readFile(join(changeDir, 'reviews', `${taskId}.json`), 'utf8'),
    ) as Record<string, unknown>
    expect(portable).toEqual({
      rule: 'task-review',
      change: 'change-a',
      scope: 'task',
      taskId,
      digest: DIGEST_A,
      worktreeDigest: DIGEST_B,
      verdict: 'PASS',
      findings: [],
      target: { provider: 'codex-subagent' },
      time: '2026-10-29T08:55:43.317Z',
    })
    expect(portable.session).toBeUndefined()
    expect(portable.runId).toBeUndefined()
  })

  it('is idempotent and reports an existing valid record', async () => {
    const { root } = await fixture()
    expect(exportChange(root, 'change-a').ok).toBe(true)
    const second = exportChange(root, 'change-a')
    expect(second.ok).toBe(true)
    expect(second.lines.join('\n')).toContain('already present')
  })

  it('refuses an ERROR local record', async () => {
    const { root, changeDir, taskId } = await fixture({ local: { verdict: 'ERROR' } })
    const result = exportChange(root, 'change-a')
    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('only PASS is exported')
    await expect(readFile(portableTaskRecordPath(changeDir, taskId), 'utf8')).rejects.toMatchObject(
      { code: 'ENOENT' },
    )
  })

  it('refuses a mismatched task id and a foreign change', async () => {
    const mismatched = await fixture({ local: { taskId: taskIdOf('another task') } })
    expect(exportChange(mismatched.root, 'change-a').ok).toBe(false)
    expect(exportChange(mismatched.root, 'change-a').lines.join('\n')).toContain('task id')
    const foreign = await fixture({ local: { change: 'other-change' } })
    expect(exportChange(foreign.root, 'change-a').ok).toBe(false)
    expect(exportChange(foreign.root, 'change-a').lines.join('\n')).toContain('other-change')
  })

  it('refuses a checked task with no local record', async () => {
    const { root } = await fixture({ local: null })
    const result = exportChange(root, 'change-a')
    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('no readable local PASS record')
  })

  it('ignores unchecked tasks', async () => {
    const { root } = await fixture({ checked: false, local: null })
    const result = exportChange(root, 'change-a')
    expect(result.ok).toBe(true)
    expect(result.lines.join('\n')).toContain('export complete')
  })

  it('runs as the documented command', async () => {
    const { root, changeDir, taskId } = await fixture()
    const script = join(import.meta.dirname, '..', 'reviews-check.ts')
    const run = spawnSync(process.execPath, [script, '--export', '--change', 'change-a'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(run.status, run.stderr).toBe(0)
    expect(run.stdout).toContain('wrote openspec/changes/change-a/reviews/')
    const portable = JSON.parse(
      await readFile(join(changeDir, 'reviews', `${taskId}.json`), 'utf8'),
    ) as Record<string, unknown>
    expect(portable.verdict).toBe('PASS')
  })

  it('exits non-zero when a checked task cannot be exported', async () => {
    const { root } = await fixture({ local: { verdict: 'ERROR' } })
    const script = join(import.meta.dirname, '..', 'reviews-check.ts')
    const run = spawnSync(process.execPath, [script, '--export', '--change', 'change-a'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
  })
})
