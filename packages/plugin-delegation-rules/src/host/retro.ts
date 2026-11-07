import { createHash } from 'node:crypto'
import type { FindingClass } from '../shared/approval.js'
import {
  type HistoryEntry,
  type HistoryFinding,
  historyWindowOf,
  readFindingHistory,
} from './finding-history.js'
import { lessonDedupeKey, proposeLesson } from './lesson-store.js'

export const REVIEW_RETRO_DESCRIPTION =
  'Report repeated review findings by class from the local bounded finding history, and optionally propose at most one lesson draft. Deterministic: calls no model and edits no source file. A proposed lesson is never injected until a user accepts it.'

export const MAX_REPORT_CHARS = 4_000
const MAX_EXAMPLE_CHARS = 300
const MAX_EXAMPLES = 3

export interface RetroExample {
  class: FindingClass
  title: string
  evidence: string
  rule: string
  change: string
  taskId?: string
  time: string
}

export interface RetroClassCount {
  class: FindingClass
  count: number
  repeats: number
  /** Repeats divided by count, in whole percent. */
  rate: number
}

export interface RetroDraft {
  class: FindingClass
  title: string
  body: string
  appliesTo: { rules: string[]; capabilities: string[] }
  source: { change?: string; taskId?: string; findingHashes: string[] }
}

export interface RetroReport {
  window: number
  entries: number
  findings: number
  gaps: number
  skipped: number
  classes: RetroClassCount[]
  topClass?: FindingClass
  examples: RetroExample[]
  draft?: RetroDraft
  text: string
}

function clip(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

/** Normalized title identity used to count a repeat across records. */
export function findingTitleHash(finding: Pick<HistoryFinding, 'class' | 'title'>): string {
  return createHash('sha256').update(lessonDedupeKey(finding)).digest('hex').slice(0, 16)
}

function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100)
}

/** Deterministic clustering over the already-read history entries. */
export function buildRetroReport(
  entries: readonly HistoryEntry[],
  options: { window?: number; skipped?: number; maxChars?: number } = {},
): RetroReport {
  const window = historyWindowOf(options.window)
  const skipped = options.skipped ?? 0
  const gaps = entries.filter((entry) => entry.kind === 'gap').length
  const counts = new Map<FindingClass, { count: number; repeats: number }>()
  const examples = new Map<FindingClass, RetroExample[]>()
  const seen = new Map<string, number>()
  const repeatedHashes = new Map<FindingClass, Set<string>>()
  const repeatedSources = new Map<
    FindingClass,
    { change?: string; taskId?: string; time: string }
  >()
  let findings = 0

  for (const entry of entries) {
    if (entry.kind !== 'run') continue
    const currentHashes = new Map<string, number>()
    for (const finding of entry.findings) {
      findings += 1
      const key = findingTitleHash(finding)
      // Only earlier records make a finding a repeat; duplicates inside one
      // record are first occurrences of that record.
      const previous = seen.get(key) ?? 0
      currentHashes.set(key, (currentHashes.get(key) ?? 0) + 1)
      const bucket = counts.get(finding.class) ?? { count: 0, repeats: 0 }
      bucket.count += 1
      if (previous > 0) {
        bucket.repeats += 1
        const hashes = repeatedHashes.get(finding.class) ?? new Set<string>()
        hashes.add(key)
        repeatedHashes.set(finding.class, hashes)
        if (!repeatedSources.has(finding.class)) {
          repeatedSources.set(finding.class, {
            change: entry.change,
            ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
            time: entry.time,
          })
        }
      }
      counts.set(finding.class, bucket)
      const list = examples.get(finding.class) ?? []
      if (list.length < MAX_EXAMPLES) {
        list.push({
          class: finding.class,
          title: clip(finding.title, MAX_EXAMPLE_CHARS),
          evidence: clip(finding.evidence, MAX_EXAMPLE_CHARS),
          rule: entry.rule,
          change: entry.change,
          ...(entry.taskId === undefined ? {} : { taskId: entry.taskId }),
          time: entry.time,
        })
        examples.set(finding.class, list)
      }
    }
    for (const [key, count] of currentHashes) seen.set(key, (seen.get(key) ?? 0) + count)
  }

  const classes = [...counts.entries()]
    .map(([findingClass, bucket]) => ({
      class: findingClass,
      count: bucket.count,
      repeats: bucket.repeats,
      rate: percent(bucket.repeats, bucket.count),
    }))
    .sort((left, right) => right.count - left.count || left.class.localeCompare(right.class))
  const top = classes[0]
  const topClass = top?.class
  const topExamples = topClass === undefined ? [] : (examples.get(topClass) ?? [])
  let draft: RetroDraft | undefined
  if (top !== undefined && top.repeats > 0 && topClass !== undefined) {
    const example = topExamples[0]
    const hashes = [...(repeatedHashes.get(topClass) ?? new Set<string>())].sort()
    const source = repeatedSources.get(topClass)
    draft = {
      class: topClass,
      title: `Check for ${topClass} findings earlier`,
      body: `${top.count} ${topClass} finding(s), ${top.repeats} repeated in the last ${window} settled reviews. Example: ${example?.title ?? 'none'}. Before returning PASS, check this class explicitly.`,
      appliesTo: { rules: ['*'], capabilities: [] },
      source: {
        ...(source?.change === undefined ? {} : { change: source.change }),
        ...(source?.taskId === undefined ? {} : { taskId: source.taskId }),
        findingHashes: hashes.slice(0, 20),
      },
    }
  }

  const lines = [
    `review retro: last ${entries.length} settled review(s), ${findings} finding(s), ${gaps} gap(s), ${skipped} malformed line(s) skipped`,
  ]
  if (findings === 0) {
    lines.push('no findings in the window; no lesson draft')
  } else {
    for (const entry of classes) {
      lines.push(
        `- ${entry.class}: ${entry.count} finding(s), ${entry.repeats} repeated (${entry.rate}%)`,
      )
    }
    lines.push(`top class: ${topClass ?? 'none'}`)
    if (topExamples.length > 0) {
      lines.push('examples:')
      for (const example of topExamples) {
        const source = [example.rule, example.change, example.taskId, example.time]
          .filter((part) => part !== undefined)
          .join(' ')
        lines.push(`- [${example.class}] ${example.title} (${source})`)
        lines.push(`  evidence: ${example.evidence}`)
      }
    }
    lines.push(
      draft === undefined
        ? 'no repeated class; no lesson draft'
        : `draft: ${draft.title}\n${draft.body}`,
    )
  }
  const maximum = options.maxChars ?? MAX_REPORT_CHARS
  const text = lines.join('\n')
  return {
    window,
    entries: entries.length,
    findings,
    gaps,
    skipped,
    classes,
    ...(topClass === undefined ? {} : { topClass }),
    examples: topExamples,
    ...(draft === undefined ? {} : { draft }),
    text: boundReport(text, maximum),
  }
}

const REPORT_MARKER = '… (truncated)'
/** The smallest accepted bound still fits the marker plus a short prefix. */
export const MIN_REPORT_CHARS = REPORT_MARKER.length + 10

function boundReport(text: string, maximum: number): string {
  if (!Number.isSafeInteger(maximum) || maximum < MIN_REPORT_CHARS) {
    throw new Error(
      `report character bound must be a whole number of at least ${MIN_REPORT_CHARS}; it must fit the truncation marker`,
    )
  }
  if (text.length <= maximum) return text
  return `${text.slice(0, maximum - REPORT_MARKER.length - 1)}\n${REPORT_MARKER}`
}

/** Read the windowed history and build the deterministic report. */
export async function reviewRetro(
  workspaceRoot: string,
  options: { window?: number } = {},
): Promise<RetroReport> {
  const window = historyWindowOf(options.window)
  const read = await readFindingHistory(workspaceRoot, { window })
  return buildRetroReport(read.entries, { window, skipped: read.skipped })
}

export interface RetroToolContext {
  workspaceRoot: string
  now: () => Date
  window?: number
  maxChars?: number
  maxLessons?: number
}

/** Run one `review_retro` action; `report` writes nothing, `propose` stores one draft. */
export async function executeReviewRetro(
  value: unknown,
  context: RetroToolContext,
): Promise<string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('review_retro arguments must be an object')
  }
  const args = value as Record<string, unknown>
  const action = args.action
  const unknown = Object.keys(args).filter((key) => key !== 'action')
  if (unknown.length > 0) {
    throw new Error(`review_retro has unknown field(s): ${unknown.join(', ')}`)
  }
  if (action !== 'report' && action !== 'propose') {
    throw new Error('review_retro.action must be "report" or "propose"')
  }
  const report = await reviewRetro(context.workspaceRoot, {
    ...(context.window === undefined ? {} : { window: context.window }),
  })
  const maximum = context.maxChars ?? MAX_REPORT_CHARS
  if (action === 'report' || report.draft === undefined) {
    return boundReport(report.text, maximum)
  }
  const created = await proposeLesson(context.workspaceRoot, {
    class: report.draft.class,
    title: report.draft.title,
    body: report.draft.body,
    appliesTo: report.draft.appliesTo,
    source: report.draft.source,
    now: context.now().getTime(),
    ...(context.maxLessons === undefined ? {} : { maxLessons: context.maxLessons }),
  })
  return boundReport(
    `${report.text}\n\nproposed lesson ${created.lesson.id} [${created.lesson.class}] "${created.lesson.title}"; a user must accept it before it is injected`,
    maximum,
  )
}
