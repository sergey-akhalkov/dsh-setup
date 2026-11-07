import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  findingHistoryPath,
  type HistoryFinding,
  type HistoryRunEntry,
} from '../src/host/finding-history.ts'
import { readLessons } from '../src/host/lesson-store.ts'
import {
  buildRetroReport,
  executeReviewRetro,
  findingTitleHash,
  MAX_REPORT_CHARS,
  reviewRetro,
} from '../src/host/retro.ts'
import { FINDING_CLASSES } from '../src/shared/approval.ts'
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

function finding(overrides: Partial<HistoryFinding> = {}): HistoryFinding {
  return {
    class: 'missing-test',
    title: 'Missing failure test',
    evidence: 'src/file.ts:1 no failure test',
    fix: 'add the failure test',
    ...overrides,
  }
}

function entry(overrides: Partial<HistoryRunEntry> = {}): HistoryRunEntry {
  return {
    v: 1,
    kind: 'run',
    rule: 'task-review',
    change: 'add-x',
    taskId: 'abc123',
    verdict: 'FINDINGS',
    digest: 'a'.repeat(64),
    findings: [finding()],
    time: '2026-11-01T00:00:00.000Z',
    ...overrides,
  }
}

async function writeHistory(root: string, entries: readonly unknown[]): Promise<void> {
  const path = findingHistoryPath(root)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${entries.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8')
}

describe('retro report', () => {
  it('groups a mixed window by class with the top class and examples', () => {
    const report = buildRetroReport([
      entry({ findings: [finding(), finding({ class: 'path-boundary', title: 'String prefix' })] }),
      entry({
        change: 'add-y',
        taskId: 'def456',
        time: '2026-11-02T00:00:00.000Z',
        findings: [finding({ class: 'missing-test' })],
      }),
    ])
    expect(report.findings).toBe(3)
    expect(report.topClass).toBe('missing-test')
    expect(report.classes[0]).toMatchObject({ class: 'missing-test', count: 2 })
    expect(report.classes.find((item) => item.class === 'path-boundary')?.count).toBe(1)
    expect(report.examples[0]).toMatchObject({
      class: 'missing-test',
      change: 'add-x',
      taskId: 'abc123',
    })
    expect(report.examples.length).toBeLessThanOrEqual(3)
  })

  it('renders each example with its bounded evidence and source rule', async () => {
    const root = await workspace()
    await writeHistory(root, [entry()])
    const text = await executeReviewRetro(
      { action: 'report' },
      { workspaceRoot: root, now: () => new Date(1_000) },
    )
    expect(text).toContain('src/file.ts:1 no failure test')
    expect(text).toContain('(task-review add-x abc123')
    expect(text).toContain('evidence:')
  })

  it('reports an empty window and proposes no lesson', () => {
    const report = buildRetroReport([])
    expect(report.findings).toBe(0)
    expect(report.draft).toBeUndefined()
    expect(report.text).toContain('no findings in the window')
  })

  it('counts malformed lines and still reports valid findings', async () => {
    const root = await workspace()
    const valid = entry()
    const path = findingHistoryPath(root)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(valid)}\nnot json\n{}\n`, 'utf8')
    const report = await reviewRetro(root)
    expect(report.skipped).toBe(2)
    expect(report.findings).toBe(1)
    expect(report.text).toContain('2 malformed line(s) skipped')
  })

  it('names the gap count and still reports valid findings', async () => {
    const root = await workspace()
    await writeHistory(root, [
      entry(),
      { v: 1, kind: 'gap', time: '2026-11-02T00:00:00.000Z', reason: 'EACCES' },
    ])
    const report = await reviewRetro(root)
    expect(report.gaps).toBe(1)
    expect(report.findings).toBe(1)
    expect(report.text).toContain('1 gap(s)')
  })

  it('still counts the earlier finding when a later review for the task is PASS', async () => {
    const root = await workspace()
    await writeHistory(root, [
      entry(),
      entry({ verdict: 'PASS', findings: [], time: '2026-11-02T00:00:00.000Z' }),
    ])
    const report = await reviewRetro(root)
    expect(report.findings).toBe(1)
    expect(report.topClass).toBe('missing-test')
    expect((await readLessons(root)).lessons).toHaveLength(0)
  })

  it('counts a repeat only on the second occurrence of the normalized title', () => {
    const first = finding({ title: 'Missing  FAILURE test' })
    const second = finding({ title: 'missing failure TEST!' })
    expect(findingTitleHash(first)).toBe(findingTitleHash(second))
    const report = buildRetroReport([entry({ findings: [first] }), entry({ findings: [second] })])
    const count = report.classes.find((item) => item.class === 'missing-test')
    expect(count).toMatchObject({ count: 2, repeats: 1, rate: 50 })
  })

  it('does not count a first occurrence as a repeat', () => {
    const report = buildRetroReport([entry()])
    expect(report.classes[0]).toMatchObject({ count: 1, repeats: 0, rate: 0 })
  })

  it('reads the newest 50 by default, honors 200, and clamps above the ceiling', async () => {
    const root = await workspace()
    const entries = Array.from({ length: 205 }, (_, index) =>
      entry({
        digest: `${(index % 16).toString(16)}`.repeat(64),
        time: `2026-11-01T00:${String(index).padStart(2, '0')}:00.000Z`,
        findings: [finding({ title: `Finding ${index}` })],
      }),
    )
    await writeHistory(root, entries)
    expect((await reviewRetro(root)).entries).toBe(50)
    expect((await reviewRetro(root, { window: 200 })).entries).toBe(200)
    expect((await reviewRetro(root, { window: 500 })).entries).toBe(200)
  })

  it('renders exactly three examples with bounded title and evidence fields', () => {
    const oversized = 'q'.repeat(1_000)
    const report = buildRetroReport([
      entry({
        findings: Array.from({ length: 4 }, (_, index) =>
          finding({
            class: 'missing-test',
            title: `Example ${index} ${oversized}`,
            evidence: `Evidence ${index} ${oversized}`,
          }),
        ),
      }),
    ])
    expect(report.examples).toHaveLength(3)
    for (const example of report.examples) {
      expect(example.title.length).toBeLessThanOrEqual(300)
      expect(example.evidence.length).toBeLessThanOrEqual(300)
      expect(example.title.endsWith('…')).toBe(true)
      expect(example.evidence.endsWith('…')).toBe(true)
    }
  })

  it('does not count equivalent titles inside one record as a repeat', () => {
    const report = buildRetroReport([
      entry({
        findings: [finding({ title: 'Same title' }), finding({ title: 'same  TITLE!' })],
      }),
    ])
    expect(report.classes[0]).toMatchObject({ count: 2, repeats: 0, rate: 0 })
  })

  it('rejects a bound too small for the marker and keeps a valid small bound', async () => {
    const root = await workspace()
    await writeHistory(root, [
      entry({ findings: [finding(), finding({ class: 'security', title: 'x'.repeat(300) })] }),
    ])
    expect(() => buildRetroReport([entry()], { maxChars: 16 })).toThrow(/at least/)
    await expect(
      executeReviewRetro(
        { action: 'report' },
        { workspaceRoot: root, now: () => new Date(1_000), maxChars: 16 },
      ),
    ).rejects.toThrow(/at least/)
    const bounded = buildRetroReport(
      [entry({ findings: [finding(), finding({ class: 'security', title: 'x'.repeat(300) })] })],
      { maxChars: 40 },
    )
    expect(bounded.text.length).toBeLessThanOrEqual(40)
    expect(bounded.text.endsWith('… (truncated)')).toBe(true)
  })

  it('bounds the report and marks a truncated output', () => {
    const long = 'x'.repeat(300)
    const findings = FINDING_CLASSES.flatMap((findingClass) =>
      Array.from({ length: 3 }, (_, index) =>
        finding({ class: findingClass, title: `${findingClass} case ${index} ${long}` }),
      ),
    )
    const report = buildRetroReport([entry({ findings })], { maxChars: 500 })
    expect(report.text.length).toBeLessThanOrEqual(500)
    expect(report.text.endsWith('… (truncated)')).toBe(true)
    expect(MAX_REPORT_CHARS).toBe(4_000)
  })
})

describe('retro propose', () => {
  async function repeatedWorkspace(): Promise<string> {
    const root = await workspace()
    await writeHistory(root, [
      entry(),
      entry({
        time: '2026-11-02T00:00:00.000Z',
        findings: [finding({ title: 'Missing failure test' })],
      }),
    ])
    return root
  }

  it('stores at most one proposed draft with source hashes and merges a duplicate by store key', async () => {
    const root = await repeatedWorkspace()
    const first = await executeReviewRetro(
      { action: 'propose' },
      { workspaceRoot: root, now: () => new Date(1_000) },
    )
    expect(first).toContain('proposed lesson')
    let { lessons } = await readLessons(root)
    expect(lessons).toHaveLength(1)
    expect(lessons[0]).toMatchObject({
      class: 'missing-test',
      status: 'proposed',
      appliesTo: { rules: ['*'], capabilities: [] },
    })
    expect(lessons[0]?.source.findingHashes?.length).toBeGreaterThan(0)

    const second = await executeReviewRetro(
      { action: 'propose' },
      { workspaceRoot: root, now: () => new Date(2_000) },
    )
    expect(second).toContain('proposed lesson')
    ;({ lessons } = await readLessons(root))
    expect(lessons).toHaveLength(1)
    expect(lessons[0]?.createdAt).toBe(2_000)
  })

  it('proposes nothing when no finding repeats', async () => {
    const root = await workspace()
    await writeHistory(root, [entry()])
    const text = await executeReviewRetro(
      { action: 'propose' },
      { workspaceRoot: root, now: () => new Date(1_000) },
    )
    expect(text).toContain('no repeated class; no lesson draft')
    expect((await readLessons(root)).lessons).toHaveLength(0)
  })

  it('report writes no lesson even when a draft exists', async () => {
    const root = await repeatedWorkspace()
    const text = await executeReviewRetro(
      { action: 'report' },
      { workspaceRoot: root, now: () => new Date(1_000) },
    )
    expect(text).toContain('draft:')
    expect((await readLessons(root)).lessons).toHaveLength(0)
  })
})

describe('retro report source', () => {
  it('reads the default 50-entry window from the history file', async () => {
    const root = await workspace()
    await writeHistory(root, [entry()])
    const report = await reviewRetro(root)
    expect(report.window).toBe(50)
    expect(report.entries).toBe(1)
    expect(MAX_REPORT_CHARS).toBe(4_000)
    expect(await readFile(findingHistoryPath(root), 'utf8')).toContain('Missing failure test')
  })
})
