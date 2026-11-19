import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { currentSpecDigest } from '../src/host/evidence.ts'
import { reviewSummary, summaries } from '../src/host/review-status.ts'

/**
 * The static review read model: the whole-spec record at its digest and the
 * portable task-review coverage the archive gate counts. Nothing here starts or
 * observes a review.
 */

const TEMP_DIRECTORIES: string[] = []
const CHANGE = 'show-review-status'

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
    }),
  )
})

async function tempWorkspace(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'workflows-review-status-'))
  TEMP_DIRECTORIES.push(directory)
  return directory
}

async function writeArtifact(workspace: string, path: string, text = 'artifact\n'): Promise<void> {
  const file = join(workspace, path)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, text, 'utf8')
}

async function writeJson(workspace: string, path: string, value: unknown): Promise<void> {
  await writeArtifact(workspace, path, `${JSON.stringify(value, null, 2)}\n`)
}

/** The portable task id of one task's text, exactly as the gate parses it. */
function taskId(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

async function writeTasks(workspace: string, markdown: string): Promise<void> {
  await writeArtifact(workspace, `openspec/changes/${CHANGE}/tasks.md`, markdown)
}

/** A portable task-review PASS for one checked task. */
async function writeApproval(workspace: string, text: string, time = '2026-11-18T20:40:00.000Z') {
  await writeJson(workspace, `openspec/changes/${CHANGE}/reviews/${taskId(text)}.json`, {
    rule: 'task-review',
    change: CHANGE,
    scope: 'task',
    taskId: taskId(text),
    digest: 'c'.repeat(64),
    verdict: 'PASS',
    findings: [],
    target: { provider: 'codex-subagent', model: 'gpt-5.1-codex' },
    time,
  })
}

/** One whole-spec record at the given digest. */
function recordValue(
  digest: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    rule: 'spec-review',
    change: CHANGE,
    phase: 'spec',
    scope: 'whole',
    verdict: 'PASS',
    digest,
    findings: [],
    reviewer: 'codex',
    target: { provider: 'codex-subagent', model: 'gpt-5.1-codex' },
    time: '2026-11-18T20:55:00.000Z',
    ...overrides,
  }
}

/** One whole-spec record at the given digest. */
async function writeRecord(
  workspace: string,
  digest: string,
  overrides: Record<string, unknown> = {},
): Promise<void> {
  await writeJson(
    workspace,
    `.dsh/workflows/records/spec-review/${CHANGE}/spec.json`,
    recordValue(digest, overrides),
  )
}

/** A change whose tasks file and whole-spec digest are current. */
async function currentChange(
  workspace: string,
  markdown = '- [x] 1.1 First task\n- [x] 1.2 Second task\n- [ ] 1.3 Pending task\n',
): Promise<string> {
  await writeArtifact(workspace, `openspec/changes/${CHANGE}/proposal.md`, '# Proposal\n')
  await writeArtifact(workspace, `openspec/changes/${CHANGE}/design.md`, '# Design\n')
  await writeTasks(workspace, markdown)
  const digest = (await currentSpecDigest(workspace, CHANGE)) as string
  await writeRecord(workspace, digest)
  return digest
}

describe('review summaries', () => {
  it('reports a current PASS and the checked tasks with a portable PASS', async () => {
    const workspace = await tempWorkspace()
    await currentChange(workspace)
    await writeApproval(workspace, 'First task')
    const summary = await reviewSummary(workspace, CHANGE)
    expect(summary?.spec).toMatchObject({
      verdict: 'PASS',
      current: true,
      findings: 0,
      reviewer: 'codex',
      model: 'gpt-5.1-codex',
    })
    expect(summary?.tasks).toMatchObject({ checked: 2, passed: 1, missing: ['1.2'] })
    // The newest matching approval time is the task unit's timestamp.
    expect(summary?.tasks?.at).toBe('2026-11-18T20:40:00.000Z')
  })

  it('counts a valid approval that is only in the working tree', async () => {
    const workspace = await tempWorkspace()
    await currentChange(workspace)
    // Never committed: the fixture writes the file directly, and the summary
    // counts it exactly as the archive gate reads the working tree.
    await writeApproval(workspace, 'First task')
    await writeApproval(workspace, 'Second task')
    const summary = await reviewSummary(workspace, CHANGE)
    expect(summary?.tasks).toMatchObject({ checked: 2, passed: 2, missing: [] })
  })

  it('marks a PASS outdated after the artifacts changed', async () => {
    const workspace = await tempWorkspace()
    const digest = await currentChange(workspace)
    await writeArtifact(
      workspace,
      `openspec/changes/${CHANGE}/proposal.md`,
      '# Proposal\n\nEdited.\n',
    )
    const summary = await reviewSummary(workspace, CHANGE)
    expect(summary?.spec).toMatchObject({ verdict: 'PASS', current: false })
    expect(digest).not.toBe(await currentSpecDigest(workspace, CHANGE))
  })

  it('reports findings at the current digest', async () => {
    const workspace = await tempWorkspace()
    const digest = await currentChange(workspace)
    await writeRecord(workspace, digest, {
      verdict: 'FINDINGS',
      findings: [{ severity: 'P1', title: 'A gap', evidence: 'x', fix: 'y' }],
    })
    const summary = await reviewSummary(workspace, CHANGE)
    expect(summary?.spec).toMatchObject({ verdict: 'FINDINGS', current: true, findings: 1 })
  })

  it('reports an engine error record', async () => {
    const workspace = await tempWorkspace()
    const digest = await currentChange(workspace)
    await writeRecord(workspace, digest, { verdict: 'ERROR', error: 'provider did not start' })
    const summary = await reviewSummary(workspace, CHANGE)
    expect(summary?.spec?.verdict).toBe('ERROR')
  })

  it('reads a missing local record as no spec verdict', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, `openspec/changes/${CHANGE}/proposal.md`, '# Proposal\n')
    await writeTasks(workspace, '- [x] 1.1 Only task\n')
    const summary = await reviewSummary(workspace, CHANGE)
    expect(summary?.spec).toBeNull()
    expect(summary?.tasks).toMatchObject({ checked: 1, passed: 0, missing: ['1.1'] })
  })

  it('leaves the task unit null when tasks.md is missing or unreadable', async () => {
    const workspace = await tempWorkspace()
    await writeArtifact(workspace, `openspec/changes/${CHANGE}/proposal.md`, '# Proposal\n')
    expect((await reviewSummary(workspace, CHANGE))?.tasks).toBeNull()
    const directory = join(workspace, `openspec/changes/${CHANGE}/tasks.md`)
    await mkdir(directory, { recursive: true })
    expect((await reviewSummary(workspace, CHANGE))?.tasks).toBeNull()
  })

  it('counts an unparseable checked line and names its raw text', async () => {
    const workspace = await tempWorkspace()
    await currentChange(workspace, '- [x] 1.1 First task\n- [x] not a numbered task\n')
    const summary = await reviewSummary(workspace, CHANGE)
    expect(summary?.tasks).toMatchObject({
      checked: 2,
      passed: 0,
      missing: ['1.1', '- [x] not a numbered task'],
    })
  })

  it('omits a change whose directory does not exist', async () => {
    const workspace = await tempWorkspace()
    await currentChange(workspace)
    expect(await summaries(workspace, [CHANGE, 'ghost-change', 'Not A Name'])).toEqual({
      [CHANGE]: expect.objectContaining({ tasks: expect.objectContaining({ checked: 2 }) }),
    })
  })

  it('does not treat an oversized or linked record as a local review', async () => {
    const workspace = await tempWorkspace()
    const digest = await currentChange(workspace)
    const record = `.dsh/workflows/records/spec-review/${CHANGE}/spec.json`
    // Otherwise valid, so only the reader's 256 KiB bound rejects it.
    await writeJson(workspace, record, {
      ...recordValue(digest),
      pad: 'x'.repeat(300 * 1024),
    })
    expect((await reviewSummary(workspace, CHANGE))?.spec).toBeNull()

    const outside = await tempWorkspace()
    await writeJson(outside, 'spec.json', recordValue(digest))
    try {
      await rm(join(workspace, record))
      await symlink(join(outside, 'spec.json'), join(workspace, record), 'file')
    } catch (error) {
      // Creating a file symlink needs developer mode on Windows; skip only the
      // host that cannot express the attack.
      if (['EPERM', 'EACCES', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        return
      }
      throw error
    }
    expect((await reviewSummary(workspace, CHANGE))?.spec).toBeNull()
  })

  it('keeps the spec state when the digest read fails on an existing change', async () => {
    const workspace = await tempWorkspace()
    await currentChange(workspace)
    // Model the digest read failing, for example an EACCES while hashing
    // tasks.md: the change still exists, so its record is reported with
    // `current` false and the unreadable task unit is omitted.
    await rm(join(workspace, `openspec/changes/${CHANGE}/tasks.md`))
    await mkdir(join(workspace, `openspec/changes/${CHANGE}/tasks.md`), { recursive: true })
    const summary = await reviewSummary(workspace, CHANGE, async () => undefined)
    expect(summary?.spec).toMatchObject({ verdict: 'PASS', current: false })
    expect(summary?.tasks).toBeNull()
  })

  it('omits a change directory that resolves outside the workspace', async () => {
    const workspace = await tempWorkspace()
    const outside = await tempWorkspace()
    await writeArtifact(outside, 'tasks.md', '- [x] 1.1 Outside task\n')
    await mkdir(join(workspace, 'openspec', 'changes'), { recursive: true })
    await symlink(
      outside,
      join(workspace, 'openspec', 'changes', CHANGE),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    expect(await reviewSummary(workspace, CHANGE)).toBeUndefined()
    expect(await summaries(workspace, [CHANGE])).toEqual({})
  })
})
