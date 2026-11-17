import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  type ApprovalRecordState,
  approvalSummaryLine,
  computeApprovalCoverage,
  FINDING_CLASSES,
  formatApprovalGapLines,
  hasMachinePath,
  isReviewFinding,
  laneOfTask,
  normalizeCheckboxes,
  normalizeFindingClass,
  type PortableTaskReviewRecord,
  parsePortableTaskReviewRecord,
  parseReviewApprovalMarker,
  parseTaskLanes,
  parseTasksText,
  type ReviewerBinding,
  recognizeArchiveCommands,
  reviewerBindingOf,
  reviewerMatches,
  sanitizeText,
  taskIdOf,
  unparseableCheckedLines,
} from '../src/shared/approval.ts'

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)
// Composed at runtime so the repository machine-path scan does not flag the fixtures.
const WINDOWS_MODEL_PATH = ['C:', 'models', 'x'].join('\\')
const WINDOWS_TAG_PATH = ['C:', 'tag'].join('/')
const POSIX_HOME = ['', 'home', 'owner', 'private'].join('/')
const TILDE_HOME = ['~', '.config', 'service', 'credentials.json'].join('/')

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

describe('finding classification', () => {
  it('accepts the fixed vocabulary and normalizes everything else to other', () => {
    expect(FINDING_CLASSES).toHaveLength(10)
    expect(normalizeFindingClass('path-boundary')).toBe('path-boundary')
    expect(normalizeFindingClass('security')).toBe('security')
    expect(normalizeFindingClass(undefined)).toBe('other')
    expect(normalizeFindingClass('made-up')).toBe('other')
    expect(normalizeFindingClass(7)).toBe('other')
  })

  it('keeps a record with no class readable and rejects an invalid stored class', () => {
    const finding = { severity: 'P1', title: 't', evidence: 'e', fix: 'f' }
    expect(isReviewFinding(finding)).toBe(true)
    expect(isReviewFinding({ ...finding, class: 'missing-test' })).toBe(true)
    expect(isReviewFinding({ ...finding, class: 'made-up' })).toBe(false)
  })

  it('redacts backtick paths, file URLs, and home-relative machine paths from finding text', () => {
    const text =
      `See \`${POSIX_HOME}/config.json:12\`, file://${POSIX_HOME}/a.json, ` +
      `${TILDE_HOME}, [${POSIX_HOME}/b.json], ` +
      `<${POSIX_HOME}/c.json:9> and {${POSIX_HOME}/d.json}`
    const sanitized = sanitizeText(text)
    expect(sanitized).not.toContain(POSIX_HOME)
    expect(sanitized).not.toContain(TILDE_HOME)
    expect(sanitized).not.toContain('file://')
    expect(sanitized).toContain('[path]')
    expect(hasMachinePath(text)).toBe(true)
    expect(hasMachinePath('src/file.ts:12')).toBe(false)
  })
})

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

describe('task lanes', () => {
  const markdown = [
    '# Tasks',
    '',
    '- [x] 0.1 Before the lanes',
    '',
    '## 1. Code (`packages/x/**`, `docs/a.md`)',
    '',
    '- [x] 1.1 First',
    '- [ ] 1.2 Second',
    '',
    '### 1a. Detail',
    '',
    '- [ ] 1.3 Nested detail',
    '',
    '## 2. Serial tail: generated output',
    '',
    '- [ ] 2.1 Gate',
  ].join('\n')

  it('groups tasks by level-2 heading with their owned paths', () => {
    const lanes = parseTaskLanes(markdown)
    expect(lanes.map((lane) => lane.title)).toEqual([
      '',
      '1. Code (`packages/x/**`, `docs/a.md`)',
      '2. Serial tail: generated output',
    ])
    expect(lanes[0]?.tasks.map((task) => task.number)).toEqual(['0.1'])
    expect(lanes[1]?.owns).toEqual(['packages/x/**', 'docs/a.md'])
    expect(lanes[1]?.tasks.map((task) => task.number)).toEqual(['1.1', '1.2', '1.3'])
    expect(lanes[1]?.tasks.map((task) => task.checked)).toEqual([true, false, false])
    expect(lanes[2]?.tasks.map((task) => task.number)).toEqual(['2.1'])
  })

  it('returns one untitled lane for a plan without headings', () => {
    const lanes = parseTaskLanes('- [ ] 1.1 One\n- [x] 1.2 Two\n')
    expect(lanes).toHaveLength(1)
    expect(lanes[0]?.title).toBe('')
    expect(lanes[0]?.owns).toEqual([])
    expect(lanes[0]?.tasks).toHaveLength(2)
  })

  it('keeps a heading without backticks as a lane with no owned path', () => {
    const lanes = parseTaskLanes('## 1. Code\n\n- [ ] 1.1 One\n')
    expect(lanes[0]?.title).toBe('1. Code')
    expect(lanes[0]?.owns).toEqual([])
  })

  it('parses CRLF input and returns no lane for a plan without tasks', () => {
    const lanes = parseTaskLanes('# Tasks\r\n\r\n## 1. Code (`a/**`)\r\n\r\n- [x] 1.1 One\r\n')
    expect(lanes).toHaveLength(1)
    expect(lanes[0]?.owns).toEqual(['a/**'])
    expect(lanes[0]?.tasks[0]?.checked).toBe(true)
    expect(parseTaskLanes('# Tasks\n')).toEqual([])
  })

  it('looks a task id up across lanes, including the untitled prefix', () => {
    const lanes = parseTaskLanes(markdown)
    expect(laneOfTask(lanes, taskIdOf('Second'))?.title).toBe(
      '1. Code (`packages/x/**`, `docs/a.md`)',
    )
    expect(laneOfTask(lanes, taskIdOf('Before the lanes'))?.title).toBe('')
    expect(laneOfTask(lanes, taskIdOf('Missing'))).toBeUndefined()
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

  async function coverageOf(
    states: Record<string, ApprovalRecordState>,
    unparseable = false,
    reviewer?: ReviewerBinding,
  ) {
    return computeApprovalCoverage({
      change: 'change-a',
      rule: 'task-review',
      ...(reviewer === undefined ? {} : { reviewer }),
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
      `missing 1.3 "absent" -> workflows(action: "start", definitionId: "task-review", change: "change-a", task: "${taskIdOf('absent')}")`,
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

  it('approves a record whose provider matches the declared reviewer', async () => {
    const coverage = await coverageOf(
      {
        [taskIdOf('approved')]: { kind: 'record', record: recordFor('approved') },
        [taskIdOf('failed')]: { kind: 'record', record: recordFor('failed') },
        [taskIdOf('absent')]: { kind: 'record', record: recordFor('absent') },
      },
      false,
      { provider: 'codex-subagent' },
    )
    expect(coverage.pass).toBe(3)
    expect(coverage.archiveReady).toBe(true)
  })

  it('rejects a record from another provider and names both in the detail', async () => {
    const coverage = await coverageOf(
      {
        [taskIdOf('approved')]: {
          kind: 'record',
          record: recordFor('approved', { target: { provider: 'other-reviewer' } }),
        },
      },
      false,
      { provider: 'codex-subagent' },
    )
    expect(coverage.pass).toBe(0)
    expect(coverage.error).toBe(1)
    const gaps = formatApprovalGapLines(coverage).join('\n')
    expect(gaps).toContain('target provider "other-reviewer" (marker reviewer "codex-subagent")')
    expect(gaps).toContain('1.1 "approved"')
  })

  it('rejects a record whose model differs from a pinned reviewer model', async () => {
    const pinned = await coverageOf(
      {
        [taskIdOf('approved')]: {
          kind: 'record',
          record: recordFor('approved', {
            target: { provider: 'codex-subagent', model: 'model-a' },
          }),
        },
      },
      false,
      { provider: 'codex-subagent', model: 'model-b' },
    )
    expect(pinned.pass).toBe(0)
    expect(formatApprovalGapLines(pinned).join('\n')).toContain(
      'target model "model-a" (marker reviewer model "model-b")',
    )
    const missingModel = await coverageOf(
      {
        [taskIdOf('approved')]: { kind: 'record', record: recordFor('approved') },
      },
      false,
      { provider: 'codex-subagent', model: 'model-b' },
    )
    expect(missingModel.pass).toBe(0)
    expect(formatApprovalGapLines(missingModel).join('\n')).toContain(
      'target model "(none)" (marker reviewer model "model-b")',
    )
  })

  it('keeps provider-agnostic behavior when the marker declares no reviewer', async () => {
    const coverage = await coverageOf({
      [taskIdOf('approved')]: {
        kind: 'record',
        record: recordFor('approved', { target: { provider: 'any-reviewer' } }),
      },
    })
    expect(coverage.pass).toBe(1)
    expect(coverage.error).toBe(0)
  })
})

describe('reviewer binding helpers', () => {
  it('returns a binding only when the marker declares one', () => {
    expect(reviewerBindingOf(undefined)).toBeUndefined()
    expect(
      reviewerBindingOf({ version: 1, archiveGate: true, taskRule: 'task-review' }),
    ).toBeUndefined()
    expect(
      reviewerBindingOf({
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        reviewerProvider: 'codex-subagent',
      }),
    ).toEqual({ provider: 'codex-subagent' })
    expect(
      reviewerBindingOf({
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        reviewerProvider: 'codex-subagent',
        reviewerModel: 'gpt-6',
      }),
    ).toEqual({ provider: 'codex-subagent', model: 'gpt-6' })
  })

  it('matches provider and an optional model, and accepts any target without a binding', () => {
    expect(reviewerMatches({ provider: 'a' }, undefined)).toBe(true)
    expect(reviewerMatches({ provider: 'a' }, { provider: 'a' })).toBe(true)
    expect(reviewerMatches({ provider: 'b' }, { provider: 'a' })).toBe(false)
    expect(reviewerMatches({ provider: 'a', model: 'm1' }, { provider: 'a', model: 'm2' })).toBe(
      false,
    )
    expect(reviewerMatches({ provider: 'a' }, { provider: 'a', model: 'm2' })).toBe(false)
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

  it('parses an optional reviewer provider and model', () => {
    const parsed = parseReviewApprovalMarker({
      version: 1,
      archiveGate: true,
      taskRule: 'task-review',
      reviewerProvider: 'codex-subagent',
      reviewerModel: 'gpt-6-astra',
    })
    expect(parsed.error).toBeUndefined()
    expect(parsed.marker).toMatchObject({
      reviewerProvider: 'codex-subagent',
      reviewerModel: 'gpt-6-astra',
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
      { version: 1, archiveGate: true, taskRule: 'task-review', reviewerProvider: '' },
      { version: 1, archiveGate: true, taskRule: 'task-review', reviewerModel: 7 },
      {
        version: 1,
        archiveGate: true,
        taskRule: 'task-review',
        reviewerProvider: WINDOWS_MODEL_PATH,
      },
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
