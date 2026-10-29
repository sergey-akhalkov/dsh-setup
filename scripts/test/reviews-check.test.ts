import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import {
  portableTaskRecordPath,
  taskIdOf,
} from '../../packages/plugin-delegation-rules/src/shared/approval.ts'
import { auditActive, auditAll, auditPush, exportChange, readMarker } from '../reviews-check.ts'

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

const MARKER = {
  version: 1,
  archiveGate: true,
  taskRule: 'task-review',
  cutoff: 'v1.0.0',
  grandfathered: { 'exception-change': 'post-hoc integration review PASS' },
}

const ZEROES = '0'.repeat(40)

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr)}`)
  }
  return result.stdout
}

async function initRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reviews-git-'))
  cleanups.push(async () => {
    await rm(root, { recursive: true, force: true })
  })
  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.email', 'review-test@example.invalid'])
  git(root, ['config', 'user.name', 'Review Test'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  return root
}

async function commit(root: string, message: string): Promise<string> {
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', message])
  return git(root, ['rev-parse', 'HEAD']).trim()
}

async function writeMarker(root: string): Promise<void> {
  await mkdir(join(root, 'openspec'), { recursive: true })
  await writeFile(join(root, 'openspec', 'review-approval.json'), JSON.stringify(MARKER), 'utf8')
}

async function writeArchive(
  root: string,
  directory: string,
  tasks: Array<{ text: string; checked?: boolean }>,
): Promise<string> {
  const changeDir = join(root, 'openspec', 'changes', 'archive', directory)
  await mkdir(changeDir, { recursive: true })
  const body = tasks
    .map((task, index) => `- [${task.checked === false ? ' ' : 'x'}] 1.${index + 1} ${task.text}`)
    .join('\n')
  await writeFile(join(changeDir, 'tasks.md'), `# Tasks\n\n${body}\n`, 'utf8')
  return changeDir
}

async function writePass(changeDir: string, change: string, taskText: string): Promise<void> {
  const taskId = taskIdOf(taskText)
  await mkdir(join(changeDir, 'reviews'), { recursive: true })
  await writeFile(
    join(changeDir, 'reviews', `${taskId}.json`),
    JSON.stringify({
      rule: 'task-review',
      change,
      scope: 'task',
      taskId,
      digest: DIGEST_A,
      worktreeDigest: DIGEST_B,
      verdict: 'PASS',
      findings: [],
      target: { provider: 'codex-subagent' },
      time: '2026-10-29T08:55:43.317Z',
    }),
    'utf8',
  )
}

async function historyFixture(options: { fresh?: boolean } = {}) {
  const root = await initRepo()
  await writeMarker(root)
  const oldDir = await writeArchive(root, '2026-10-01-old-change', [{ text: 'Old one' }])
  await writeFile(join(oldDir, 'notes.md'), '# archived notes\n', 'utf8')
  await writeArchive(root, '2026-10-02-exception-change', [{ text: 'Exception one' }])
  await commit(root, 'archive the pre-cutoff changes')
  git(root, ['tag', 'v1.0.0'])
  const cutoff = git(root, ['rev-parse', 'HEAD']).trim()
  let freshDir: string | undefined
  let freshCommit: string | undefined
  if (options.fresh !== false) {
    freshDir = await writeArchive(root, '2026-10-10-fresh-change', [{ text: 'Fresh one' }])
    freshCommit = await commit(root, 'archive the fresh change')
  }
  return { root, cutoff, freshDir, freshCommit }
}

describe('reviews:check --change', () => {
  it('keeps the repository marker and its v0.12.0 exception', () => {
    const root = join(import.meta.dirname, '..', '..')
    const marker = readMarker(join(root, 'openspec'))
    expect(marker.kind).toBe('marker')
    if (marker.kind !== 'marker') return
    expect(marker.marker).toMatchObject({
      version: 1,
      archiveGate: true,
      taskRule: 'task-review',
      cutoff: 'v0.12.0',
    })
    expect(Object.keys(marker.marker.grandfathered ?? {}).sort()).toEqual([
      'add-goal-block-review',
      'adopt-agent-best-practices',
      'fix-delegation-review-build-inputs',
    ])
  })

  it('points the OpenSpec archive guidance at the approval audit', async () => {
    const root = join(import.meta.dirname, '..', '..')
    const config = await readFile(join(root, 'openspec', 'config.yaml'), 'utf8')
    expect(config).toContain('operations:')
    expect(config).toContain('archive:')
    expect(config).toContain('pnpm reviews:check --change')
    expect(config).toContain('pnpm reviews:check --all')
  })

  it('fails an unreviewed checked task and passes an approved one', async () => {
    const { root, changeDir } = await fixture()
    const missing = await auditActive(root, 'change-a')
    expect(missing.ok).toBe(false)
    expect(missing.lines.join('\n')).toContain(
      `missing 1.1 "${TASK_TEXT}" -> delegate(rule: "task-review", change: "change-a", task: "${taskIdOf(TASK_TEXT)}")`,
    )
    await writePass(changeDir, 'change-a', TASK_TEXT)
    const approved = await auditActive(root, 'change-a')
    expect(approved.ok).toBe(true)
    expect(approved.lines.join('\n')).toContain('archive-ready: yes')
  })

  it('runs as the documented command', async () => {
    const { root, changeDir } = await fixture()
    const script = join(import.meta.dirname, '..', 'reviews-check.ts')
    const failed = spawnSync(process.execPath, [script, '--change', 'change-a'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(failed.status).toBe(1)
    await writePass(changeDir, 'change-a', TASK_TEXT)
    const passed = spawnSync(process.execPath, [script, '--change', 'change-a'], {
      cwd: root,
      encoding: 'utf8',
    })
    expect(passed.status, passed.stderr).toBe(0)
  })
})

describe('reviews:check --all', () => {
  it('reports the pre-cutoff baseline and the v0.12.0 exception without failing', async () => {
    const { root } = await historyFixture({ fresh: false })
    const result = await auditAll(root)
    const text = result.lines.join('\n')
    expect(result.ok, text).toBe(true)
    expect(text).toContain(
      'old-change: pre-cutoff historical baseline, 1 checked task(s), no retroactive portable records; reported, not enforced',
    )
    expect(text).toContain('exception-change: v0.12.0 exception (post-hoc integration review PASS)')
  })

  it('fails a post-cutoff archive with a missing approval', async () => {
    const { root } = await historyFixture()
    const result = await auditAll(root)
    const text = result.lines.join('\n')
    expect(result.ok).toBe(false)
    expect(text).toContain('openspec/changes/archive/2026-10-10-fresh-change')
    expect(text).toContain(`missing 1.1 "Fresh one" -> delegate(rule: "task-review"`)
  })

  it('accepts a post-cutoff archive once every checked task has a portable PASS', async () => {
    const { root, freshDir } = await historyFixture()
    await writePass(freshDir as string, 'fresh-change', 'Fresh one')
    await commit(root, 'record the fresh approval')
    const result = await auditAll(root)
    const text = result.lines.join('\n')
    expect(result.ok, text).toBe(true)
    expect(text).toContain('2026-10-10-fresh-change: task-review PASS 1/1')
  })

  it('fails a post-cutoff archive with a malformed record', async () => {
    const { root, freshDir } = await historyFixture()
    await mkdir(join(freshDir as string, 'reviews'), { recursive: true })
    await writeFile(
      join(freshDir as string, 'reviews', `${taskIdOf('Fresh one')}.json`),
      '{not json',
      'utf8',
    )
    await commit(root, 'record a malformed approval')
    const result = await auditAll(root)
    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('malformed record')
  })

  it('checks a pre-cutoff archive modified after the cutoff under the normal rule', async () => {
    const { root } = await historyFixture({ fresh: false })
    const oldDir = join(root, 'openspec', 'changes', 'archive', '2026-10-01-old-change')
    await writeFile(join(oldDir, 'notes.md'), '# touched after the cutoff\n', 'utf8')
    await commit(root, 'modify the old archive')
    const result = await auditAll(root)
    const text = result.lines.join('\n')
    expect(result.ok).toBe(false)
    expect(text).not.toContain('old-change: pre-cutoff historical baseline')
    expect(text).toContain('2026-10-01-old-change: task-review PASS 0/1')
  })
})

describe('reviews:check --push', () => {
  async function pushFixture() {
    const history = await historyFixture()
    return history
  }

  it('refuses a pushed archive with a missing approval and allows an approved one', async () => {
    const { root, cutoff, freshDir, freshCommit } = await pushFixture()
    const unapproved = await auditPush(
      root,
      `refs/heads/main ${freshCommit as string} refs/heads/main ${cutoff}`,
    )
    expect(unapproved.ok).toBe(false)
    expect(unapproved.lines.join('\n')).toContain('missing 1.1 "Fresh one"')
    expect(unapproved.lines.join('\n')).toContain('refusing the push')

    await writePass(freshDir as string, 'fresh-change', 'Fresh one')
    const approvedCommit = await commit(root, 'record the fresh approval')
    const approved = await auditPush(
      root,
      `refs/heads/main ${approvedCommit} refs/heads/main ${cutoff}`,
    )
    expect(approved.ok, approved.lines.join('\n')).toBe(true)
  })

  it('reports the baseline and exception for a new branch push without failing', async () => {
    const { root, freshDir, freshCommit } = await pushFixture()
    await writePass(freshDir as string, 'fresh-change', 'Fresh one')
    const approvedCommit = await commit(root, 'record the fresh approval')
    expect(freshCommit).toBeDefined()
    const result = await auditPush(
      root,
      `refs/heads/main ${approvedCommit} refs/heads/main ${ZEROES}`,
    )
    const text = result.lines.join('\n')
    expect(result.ok, text).toBe(true)
    expect(text).toContain('pre-cutoff historical baseline')
    expect(text).toContain('v0.12.0 exception')
  })

  it('fails closed on an unknown range and on empty stdin', async () => {
    const { root } = await pushFixture()
    const unknown = await auditPush(
      root,
      `refs/heads/main ${git(root, ['rev-parse', 'HEAD']).trim()} refs/heads/main ${'f'.repeat(40)}`,
    )
    expect(unknown.ok).toBe(false)
    expect(unknown.lines.join('\n')).toContain('not available locally')
    expect(unknown.lines.join('\n')).toContain('pnpm reviews:check --all')
    const empty = await auditPush(root, '')
    expect(empty.ok).toBe(false)
    expect(empty.lines.join('\n')).toContain('no pre-push refs')
  })

  it('treats a deleted ref as a range with no archived change', async () => {
    const { root } = await pushFixture()
    const result = await auditPush(root, `refs/heads/gone ${ZEROES} refs/heads/gone ${ZEROES}`)
    expect(result.ok).toBe(true)
    expect(result.lines.join('\n')).toContain('no archived change')
  })

  it('does not accept an untracked approval record for the pushed commit', async () => {
    const { root, cutoff, freshDir, freshCommit } = await pushFixture()
    await writePass(freshDir as string, 'fresh-change', 'Fresh one')
    const result = await auditPush(
      root,
      `refs/heads/main ${freshCommit as string} refs/heads/main ${cutoff}`,
    )
    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('missing 1.1 "Fresh one"')
  })

  it('audits a pushed branch that is not checked out', async () => {
    const root = await initRepo()
    await writeMarker(root)
    await writeArchive(root, '2026-10-01-old-change', [{ text: 'Old one' }])
    await commit(root, 'archive the pre-cutoff changes')
    git(root, ['tag', 'v1.0.0'])
    const cutoff = git(root, ['rev-parse', 'HEAD']).trim()
    git(root, ['checkout', '-q', '-b', 'feature'])
    const freshDir = await writeArchive(root, '2026-10-10-fresh-change', [{ text: 'Fresh one' }])
    const unapproved = await commit(root, 'archive the fresh change')
    git(root, ['checkout', '-q', 'main'])
    const missing = await auditPush(
      root,
      `refs/heads/feature ${unapproved} refs/heads/feature ${cutoff}`,
    )
    expect(missing.ok).toBe(false)
    expect(missing.lines.join('\n')).toContain('missing 1.1 "Fresh one"')
    git(root, ['checkout', '-q', 'feature'])
    await writePass(freshDir, 'fresh-change', 'Fresh one')
    const approved = await commit(root, 'record the fresh approval')
    git(root, ['checkout', '-q', 'main'])
    const passed = await auditPush(
      root,
      `refs/heads/feature ${approved} refs/heads/feature ${cutoff}`,
    )
    expect(passed.ok, passed.lines.join('\n')).toBe(true)
  })

  it('catches a pushed deletion of an approval record', async () => {
    const { root, freshDir } = await pushFixture()
    await writePass(freshDir as string, 'fresh-change', 'Fresh one')
    const approved = await commit(root, 'record the fresh approval')
    await rm(join(freshDir as string, 'reviews', `${taskIdOf('Fresh one')}.json`))
    const deleted = await commit(root, 'delete the approval record')
    const result = await auditPush(root, `refs/heads/main ${deleted} refs/heads/main ${approved}`)
    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('missing 1.1 "Fresh one"')
  })

  it('checks a deletion-only change to a pre-cutoff archive', async () => {
    const { root, cutoff } = await historyFixture({ fresh: false })
    await rm(join(root, 'openspec', 'changes', 'archive', '2026-10-01-old-change', 'notes.md'))
    const deleted = await commit(root, 'delete a file from the old archive')
    const result = await auditPush(root, `refs/heads/main ${deleted} refs/heads/main ${cutoff}`)
    const text = result.lines.join('\n')
    expect(result.ok).toBe(false)
    expect(text).not.toContain('pre-cutoff historical baseline')
    expect(text).toContain('2026-10-01-old-change: task-review PASS 0/1')
  })

  it('catches an archive change that only the merge commit introduces', async () => {
    const { root, cutoff } = await historyFixture({ fresh: false })
    git(root, ['checkout', '-q', '-b', 'side'])
    await writeFile(join(root, 'side.txt'), 'side\n', 'utf8')
    await commit(root, 'side work')
    git(root, ['checkout', '-q', 'main'])
    await writeFile(join(root, 'main.txt'), 'main\n', 'utf8')
    await commit(root, 'main work')
    git(root, ['merge', '--no-ff', '--no-commit', 'side'])
    await rm(join(root, 'openspec', 'changes', 'archive', '2026-10-01-old-change', 'notes.md'))
    git(root, ['add', '-A'])
    git(root, ['commit', '-q', '-m', 'evil merge'])
    const mergeCommit = git(root, ['rev-parse', 'HEAD']).trim()
    const result = await auditPush(root, `refs/heads/main ${mergeCommit} refs/heads/main ${cutoff}`)
    expect(result.ok).toBe(false)
    expect(result.lines.join('\n')).toContain('2026-10-01-old-change: task-review PASS 0/1')
  })

  it('runs as the documented hook command', async () => {
    const { root, cutoff, freshCommit } = await pushFixture()
    const script = join(import.meta.dirname, '..', 'reviews-check.ts')
    const failed = spawnSync(process.execPath, [script, '--push'], {
      cwd: root,
      encoding: 'utf8',
      input: `refs/heads/main ${freshCommit as string} refs/heads/main ${cutoff}\n`,
    })
    expect(failed.status).toBe(1)
    expect(failed.stdout).toContain('refusing the push')
  })
})

describe('CI approval audit', () => {
  it('runs the audit with full history in both Windows workflows', async () => {
    const root = join(import.meta.dirname, '..', '..')
    for (const file of ['validate.yml', 'release.yml']) {
      const text = await readFile(join(root, '.github', 'workflows', file), 'utf8')
      const document = parse(text) as {
        jobs?: Record<
          string,
          { steps?: Array<{ uses?: string; with?: Record<string, unknown>; run?: string }> }
        >
      }
      const validate = document.jobs?.validate
      expect(validate, file).toBeDefined()
      const checkout = validate?.steps?.find((step) => step.uses === 'actions/checkout@v4')
      expect(checkout?.with?.['fetch-depth'], file).toBe(0)
      expect(
        validate?.steps?.some((step) => step.run === 'pnpm reviews:check --all'),
        file,
      ).toBe(true)
    }
  })
})
