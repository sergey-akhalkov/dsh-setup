import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  type ApprovalRecordState,
  approvalSummaryLine,
  computeApprovalCoverage,
  formatApprovalGapLines,
  localTaskRecordPath,
  normalizeCheckboxes,
  type PortableTaskReviewRecord,
  parsePortableTaskReviewRecord,
  parseReviewApprovalMarker,
  parseTasksText,
  portableRecordFromLocal,
  recognizeArchiveCommands,
  taskIdOf,
  unparseableCheckedLines,
} from '../src/shared/approval.ts'

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
// Composed at runtime so the repository machine-path scan does not flag the fixtures.
const WINDOWS_MODEL_PATH = ['C:', 'models', 'x'].join('\\')
const WINDOWS_TAG_PATH = ['C:', 'tag'].join('/')

function recordFor(
  taskText: string,
  overrides: Partial<PortableTaskReviewRecord> = {},
): PortableTaskReviewRecord {
  return {
    rule: 'task-review',
    change: 'change-a',
    scope: 'task',
    taskId: taskIdOf(taskText),
    digest: DIGEST_A,
    worktreeDigest: DIGEST_B,
    verdict: 'PASS',
    findings: [],
    target: { provider: 'codex-subagent' },
    time: '2026-10-29T08:55:43.317Z',
    ...overrides,
  }
}

describe('numbered task parser', () => {
  it('parses checked, unchecked, and nested numbers with normalized text', () => {
    const tasks = parseTasksText(
      '# Tasks\n\n- [x] 1.1  Add   the **shared** module\n- [ ] 2.10 Read docs\n',
    )
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({
      number: '1.1',
      text: 'Add the **shared** module',
      checked: true,
      id: taskIdOf('Add the **shared** module'),
    })
    expect(tasks[1]).toMatchObject({ number: '2.10', text: 'Read docs', checked: false })
    expect(tasks[0]?.at).toBeGreaterThan(0)
  })

  it('accepts an uppercase checked mark and ignores non-task lines', () => {
    const tasks = parseTasksText('- [X] 3.1 Done\n\nSome prose with [x].\n\n* [x] 1.1 star\n')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ number: '3.1', checked: true })
  })

  it('hashes the whitespace-normalized text to a stable task id', () => {
    const expected = createHash('sha256').update('Add the shared module').digest('hex').slice(0, 16)
    expect(taskIdOf('  Add   the\tshared module \n')).toBe(expected)
    expect(expected).toMatch(/^[0-9a-f]{16}$/)
    expect(taskIdOf('Add the shared module')).not.toBe(taskIdOf('Add the shared module.'))
  })

  it('normalizes checkbox state without touching other text', () => {
    const markdown = '- [x] 1.1 Done\n  - [X] 1.2 Nested\n- [ ] 1.3 Open\n'
    expect(normalizeCheckboxes(markdown)).toBe(
      '- [ ] 1.1 Done\n  - [ ] 1.2 Nested\n- [ ] 1.3 Open\n',
    )
  })

  it('reports every checked line that is not a numbered task', () => {
    const markdown = [
      '- [x] no number',
      '- [x]',
      '* [x] 1.1 a star bullet',
      '- [x] 1.1  ',
      '- [ ] 2.1 unchecked is fine',
      '- [x] 3.1 a numbered task',
    ].join('\n')
    expect(unparseableCheckedLines(markdown).map((line) => line.line)).toEqual([1, 2, 3, 4])
    expect(unparseableCheckedLines(markdown)[0]?.text).toBe('- [x] no number')
  })
})

describe('portable record validation', () => {
  it('accepts the sanitized PASS shape', () => {
    const parsed = parsePortableTaskReviewRecord(recordFor('1.1 done'))
    expect(parsed.error).toBeUndefined()
    expect(parsed.record).toEqual(recordFor('1.1 done'))
  })

  it('rejects session, run id, and error fields that would leak local state', () => {
    for (const field of ['session', 'runId', 'phase', 'error']) {
      const parsed = parsePortableTaskReviewRecord({ ...recordFor('1.1 done'), [field]: 'x' })
      expect(parsed.record).toBeUndefined()
      expect(parsed.error).toContain('unsupported field')
    }
  })

  it('rejects malformed fields and impossible verdicts', () => {
    const cases: Array<Record<string, unknown>> = [
      { ...recordFor('1.1 done'), digest: 'short' },
      { ...recordFor('1.1 done'), taskId: '0'.repeat(15) },
      { ...recordFor('1.1 done'), verdict: 'MAYBE' },
      { ...recordFor('1.1 done'), findings: [{ severity: 'P2' }] },
      {
        ...recordFor('1.1 done'),
        findings: [{ severity: 'P1', title: 't', evidence: 'e', fix: 'f' }],
      },
      { ...recordFor('1.1 done'), verdict: 'FINDINGS' },
      { ...recordFor('1.1 done'), target: {} },
      { ...recordFor('1.1 done'), target: { provider: 'codex', model: WINDOWS_MODEL_PATH } },
      { ...recordFor('1.1 done'), target: { provider: 'codex', model: '/opt/models/x' } },
      { ...recordFor('1.1 done'), target: { provider: 'codex', model: '~/models/x' } },
      { ...recordFor('1.1 done'), time: '' },
      { ...recordFor('1.1 done'), scope: 'whole' },
    ]
    for (const value of cases) {
      expect(parsePortableTaskReviewRecord(value).record).toBeUndefined()
    }
  })

  it('rejects a non-object record', () => {
    for (const value of [undefined, null, 'record', []]) {
      expect(parsePortableTaskReviewRecord(value).record).toBeUndefined()
    }
  })
})

describe('change-level coverage', () => {
  const tasks = parseTasksText(
    '- [x] 1.1 approved\n- [x] 1.2 failed\n- [x] 1.3 absent\n- [ ] 1.4 open follow-up\n',
  )

  async function coverageOf(states: Record<string, ApprovalRecordState>, unparseable = false) {
    return computeApprovalCoverage({
      change: 'change-a',
      rule: 'task-review',
      tasks,
      unparseable: unparseable ? [{ line: 7, text: '- [x] stray' }] : [],
      recordPath: (taskId) => `openspec/changes/change-a/reviews/${taskId}.json`,
      inspect: (taskId) => states[taskId] ?? { kind: 'missing' },
    })
  }

  it('counts PASS separately from ERROR and missing and reports unchecked tasks only', async () => {
    const approvedId = taskIdOf('approved')
    const failedId = taskIdOf('failed')
    const coverage = await coverageOf({
      [approvedId]: { kind: 'record', record: recordFor('approved') },
      [failedId]: { kind: 'record', record: recordFor('failed', { verdict: 'ERROR' }) },
    })
    expect(coverage.checked).toBe(3)
    expect(coverage.pass).toBe(1)
    expect(coverage.error).toBe(1)
    expect(coverage.missing).toBe(1)
    expect(coverage.unchecked).toEqual([{ number: '1.4', text: 'open follow-up' }])
    expect(coverage.archiveReady).toBe(false)
    expect(approvalSummaryLine(coverage)).toBe(
      'task-review PASS 1/3, ERROR 1, missing 1; archive-ready: no',
    )
    const gaps = formatApprovalGapLines(coverage).join('\n')
    expect(gaps).toContain(
      `missing 1.3 "absent" -> delegate(rule: "task-review", change: "change-a", task: "${taskIdOf('absent')}")`,
    )
    expect(gaps).toContain('record: openspec/changes/change-a/reviews/')
    expect(gaps).not.toContain('1.4 "open follow-up"')
  })

  it('names a malformed record and an unparseable checked line', async () => {
    const approvedId = taskIdOf('approved')
    const failedId = taskIdOf('failed')
    const coverage = await coverageOf(
      {
        [approvedId]: { kind: 'record', record: recordFor('approved') },
        [failedId]: { kind: 'malformed', error: 'record has unsupported field(s): session' },
      },
      true,
    )
    expect(coverage.error).toBe(1)
    expect(coverage.missing).toBe(1)
    expect(coverage.archiveReady).toBe(false)
    const gaps = formatApprovalGapLines(coverage).join('\n')
    expect(gaps).toContain('malformed record at openspec/changes/change-a/reviews/')
    expect(gaps).toContain('checked line 7')
  })

  it('accepts a valid PASS regardless of which session wrote it', async () => {
    const coverage = await coverageOf({
      [taskIdOf('approved')]: { kind: 'record', record: recordFor('approved') },
      [taskIdOf('failed')]: { kind: 'record', record: recordFor('failed') },
      [taskIdOf('absent')]: { kind: 'record', record: recordFor('absent') },
    })
    expect(coverage.archiveReady).toBe(true)
    expect(coverage.pass).toBe(3)
    expect(approvalSummaryLine(coverage)).toBe(
      'task-review PASS 3/3, ERROR 0, missing 0; archive-ready: yes',
    )
  })

  it('does not approve a record whose rule, change, or task id differs', async () => {
    const coverage = await coverageOf({
      [taskIdOf('approved')]: {
        kind: 'record',
        record: recordFor('approved', { rule: 'other-review' }),
      },
      [taskIdOf('failed')]: {
        kind: 'record',
        record: recordFor('failed', { change: 'other-change' }),
      },
      [taskIdOf('absent')]: { kind: 'record', record: recordFor('absent') },
    })
    expect(coverage.pass).toBe(1)
    expect(coverage.error).toBe(2)
    expect(coverage.archiveReady).toBe(false)
  })
})

describe('approval marker', () => {
  it('parses the repository marker schema', () => {
    const parsed = parseReviewApprovalMarker({
      version: 1,
      archiveGate: true,
      taskRule: 'task-review',
      cutoff: 'v0.12.0',
      grandfathered: { 'old-change': 'integration review PASS' },
    })
    expect(parsed.error).toBeUndefined()
    expect(parsed.marker).toEqual({
      version: 1,
      archiveGate: true,
      taskRule: 'task-review',
      cutoff: 'v0.12.0',
      grandfathered: { 'old-change': 'integration review PASS' },
    })
  })

  it('accepts archiveGate false and rejects malformed markers', () => {
    expect(
      parseReviewApprovalMarker({ version: 1, archiveGate: false, taskRule: 'r' }).marker,
    ).toBeDefined()
    const cases = [
      { version: 2, archiveGate: true, taskRule: 'task-review' },
      { version: 1, archiveGate: 'yes', taskRule: 'task-review' },
      { version: 1, archiveGate: true, taskRule: 'Task Review' },
      { version: 1, archiveGate: true, taskRule: 'task-review', extra: 1 },
      { version: 1, archiveGate: true, taskRule: 'task-review', cutoff: WINDOWS_TAG_PATH },
      {
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        grandfathered: { archive: 'x' },
      },
      {
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        grandfathered: { 'old-change': 7 },
      },
      null,
    ]
    for (const value of cases) expect(parseReviewApprovalMarker(value).marker).toBeUndefined()
  })
})

describe('archive command recognition', () => {
  const cwd = process.cwd()

  it('recognizes openspec archive in its documented forms', () => {
    expect(recognizeArchiveCommands('openspec archive change-a', cwd)).toEqual([
      { kind: 'openspec-archive', change: 'change-a' },
    ])
    expect(recognizeArchiveCommands('pnpm exec openspec archive change-a --json', cwd)).toEqual([
      { kind: 'openspec-archive', change: 'change-a' },
    ])
    expect(recognizeArchiveCommands('openspec archive --change change-b', cwd)).toEqual([
      { kind: 'openspec-archive', change: 'change-b' },
    ])
    expect(recognizeArchiveCommands('cd openspec && openspec archive change-a', cwd)).toEqual([
      { kind: 'openspec-archive', change: 'change-a' },
    ])
  })

  it('recognizes mv, Move-Item, and git mv into the archive directory', () => {
    const forms = [
      'mv openspec/changes/change-a openspec/changes/archive',
      'mv "openspec/changes/change-a" "openspec/changes/archive/2026-10-29-change-a"',
      'Move-Item -Path .\\openspec\\changes\\change-a -Destination openspec/changes/archive',
      'Move-Item openspec/changes/change-a openspec/changes/archive/',
      'git mv openspec/changes/change-a openspec/changes/archive/2026-10-29-change-a',
    ]
    for (const command of forms) {
      expect(recognizeArchiveCommands(command, cwd)).toEqual([{ kind: 'move', change: 'change-a' }])
    }
  })

  it('recognizes every source of a multi-source move', () => {
    expect(
      recognizeArchiveCommands(
        'git mv openspec/changes/change-a openspec/changes/change-b openspec/changes/archive/',
        cwd,
      ),
    ).toEqual([
      { kind: 'move', change: 'change-a' },
      { kind: 'move', change: 'change-b' },
    ])
    expect(
      recognizeArchiveCommands(
        'Move-Item -Path "openspec/changes/change-a,openspec/changes/change-b" -Destination openspec/changes/archive',
        cwd,
      ),
    ).toEqual([
      { kind: 'move', change: 'change-a' },
      { kind: 'move', change: 'change-b' },
    ])
  })

  it('ignores non-archive operations and previews', () => {
    const commands = [
      'mv openspec/changes/change-a packages/elsewhere',
      'mv openspec/changes/change-a/tasks.md openspec/changes/archive/',
      'echo openspec archive change-a',
      'cp -r openspec/changes/change-a openspec/changes/archive/',
      'Move-Item -WhatIf openspec/changes/change-a openspec/changes/archive',
      'mv openspec/changes/archive openspec/changes/archive-old',
      'openspec list',
      'git status',
    ]
    for (const command of commands) {
      expect(recognizeArchiveCommands(command, cwd)).toEqual([])
    }
  })
})

describe('export validation', () => {
  const taskText = 'approved task'
  const taskId = taskIdOf(taskText)

  function localPass(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
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
      ...overrides,
    }
  }

  function exportOf(value: unknown, overrides: Partial<Record<string, string>> = {}) {
    return portableRecordFromLocal({
      value,
      rule: 'task-review',
      change: 'change-a',
      taskId,
      ...overrides,
    })
  }

  it('copies a local PASS as the sanitized record without local fields', () => {
    const result = exportOf(localPass())
    expect(result.error).toBeUndefined()
    expect(result.record).toEqual({
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
    expect(JSON.stringify(result.record)).not.toContain('session')
    expect(JSON.stringify(result.record)).not.toContain('run-not-committed')
  })

  it('keeps the target selection when the local record carries one', () => {
    const result = exportOf(
      localPass({
        target: { provider: 'codex-subagent', model: 'gpt-6-astra', reasoningEffort: 'xhigh' },
      }),
    )
    expect(result.record?.target).toEqual({
      provider: 'codex-subagent',
      model: 'gpt-6-astra',
      reasoningEffort: 'xhigh',
    })
  })

  it('refuses an ERROR or FINDINGS local record', () => {
    expect(exportOf(localPass({ verdict: 'ERROR' })).error).toContain('only PASS is exported')
    expect(exportOf(localPass({ verdict: 'FINDINGS' })).error).toContain('only PASS is exported')
  })

  it('refuses a mismatched task id, a foreign change, and a foreign rule', () => {
    expect(exportOf(localPass({ taskId: taskIdOf('another task') })).error).toContain('task id')
    expect(exportOf(localPass({ change: 'other-change' })).error).toContain('change "other-change"')
    expect(exportOf(localPass({ rule: 'spec-review' }), { rule: 'task-review' }).error).toContain(
      'rule "spec-review"',
    )
  })

  it('refuses findings on a PASS and malformed local records', () => {
    expect(
      exportOf(localPass({ findings: [{ severity: 'P1', title: 't', evidence: 'e', fix: 'f' }] }))
        .error,
    ).toContain('zero findings')
    expect(exportOf(localPass({ findings: 'none' })).error).toContain('findings')
    expect(exportOf(localPass({ scope: 'whole' })).error).toContain('task-scoped')
    expect(exportOf(localPass({ digest: 'short' })).error).toContain('digest')
    expect(
      exportOf(localPass({ target: { provider: 'codex', model: '/opt/models/x' } })).error,
    ).toBeDefined()
  })

  it('locates the local .dsh record the export reads', () => {
    const root = resolve('repo-root')
    expect(localTaskRecordPath(root, 'task-review', 'change-a', taskId)).toBe(
      join(root, '.dsh', 'delegation', 'task-review', 'change-a', 'tasks', `${taskId}.json`),
    )
  })
})
