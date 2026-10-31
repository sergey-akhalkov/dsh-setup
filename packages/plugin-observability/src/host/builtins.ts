import type { TraceRecord } from './records.js'
import type { ArgumentMatch, Predicate, Row } from './rows.js'

/** How the dashboard files one row. */
export type RowGroup = 'activity' | 'tools' | 'sources' | 'aborts' | 'errors' | 'plugin'

/** A row plus the predicate test aggregation applies to one record. */
export interface TestableRow {
  readonly row: Row
  readonly test: (record: TraceRecord) => boolean
  readonly group: RowGroup
}

/** Whether a record's configured argument fields carry the predicate field/value. */
export function argumentMatches(
  values: Readonly<Record<string, string>> | undefined,
  argument: ArgumentMatch,
): boolean {
  return values?.[argument.field] === argument.value
}

/** Whether one record satisfies every field of one predicate. */
export function matchesPredicate(record: TraceRecord, predicate: Predicate): boolean {
  if (predicate.eventType !== undefined && record.eventType !== predicate.eventType) return false
  // A tool predicate counts calls, not the result event that echoes the same tool.
  if (predicate.tool !== undefined) {
    if (record.eventType !== 'tool/call' || record.tool !== predicate.tool) return false
  }
  if (predicate.sourceKind !== undefined && record.sourceKind !== predicate.sourceKind) return false
  if (predicate.abortPrefix !== undefined) {
    if (record.abortPrefix === undefined || !record.abortPrefix.startsWith(predicate.abortPrefix)) {
      return false
    }
  }
  if (predicate.command !== undefined && record.command !== predicate.command) return false
  if (
    predicate.argument !== undefined &&
    !argumentMatches(record.argumentValues, predicate.argument)
  ) {
    return false
  }
  return true
}

/** Whether a failed tool result belongs to a row that names its tool (and argument). */
export function matchesOwnedTool(record: TraceRecord, match: readonly Predicate[]): boolean {
  return match.some(
    (predicate) =>
      predicate.tool !== undefined &&
      predicate.tool === record.tool &&
      (predicate.argument === undefined ||
        argumentMatches(record.argumentValues, predicate.argument)),
  )
}

/** Whether one record satisfies any predicate of a row's any-of list. */
export function matchesRow(record: TraceRecord, match: readonly Predicate[]): boolean {
  return match.some((predicate) => matchesPredicate(record, predicate))
}

/** Turn a configured row into the row aggregation tests. */
export function testableRow(row: Row): TestableRow {
  return {
    row,
    test:
      row.kind === 'guidance' || row.match === undefined
        ? () => false
        : (record) => matchesRow(record, row.match ?? []),
    group: 'plugin',
  }
}

/**
 * A content-free abort owner token: the leading `token:` segment of a hook
 * reason. The text after the prefix may quote streamed model output, so only
 * this token ever becomes a row id or label.
 */
function abortToken(reason: string): string {
  const token = (reason.split(':')[0] ?? '').trim().split(/\s+/)[0] ?? ''
  return token === '' ? 'other' : token.slice(0, 40)
}

/**
 * The built-in sets that work with no configuration at all: activity, one row
 * per observed tool name, one row per injected-message source kind, one row per
 * abort owner, and errors. A tool, source, or abort no configuration mentions
 * still gets a row under its own name.
 */
export function builtinRows(records: readonly TraceRecord[]): TestableRow[] {
  const tools = new Set<string>()
  const sources = new Set<string>()
  const aborts = new Set<string>()
  for (const record of records) {
    if (record.eventType === 'tool/call' && record.tool !== undefined) tools.add(record.tool)
    if (record.sourceKind !== undefined) sources.add(record.sourceKind)
    if (record.abortPrefix !== undefined) aborts.add(abortToken(record.abortPrefix))
  }
  const alphabetical = (left: string, right: string): number => left.localeCompare(right)
  const rows: TestableRow[] = [
    {
      row: {
        id: 'activity.turns',
        label: 'Turns',
        kind: 'signal',
        match: [{ eventType: 'turn/start' }],
      },
      test: (record) => record.eventType === 'turn/start',
      group: 'activity',
    },
    {
      row: {
        id: 'activity.steps',
        label: 'Steps',
        kind: 'signal',
        match: [{ eventType: 'step/start' }],
      },
      test: (record) => record.eventType === 'step/start',
      group: 'activity',
    },
    {
      row: {
        id: 'activity.tool-calls',
        label: 'Tool calls',
        kind: 'signal',
        match: [{ eventType: 'tool/call' }],
      },
      test: (record) => record.eventType === 'tool/call',
      group: 'activity',
    },
    {
      row: {
        id: 'errors',
        label: 'Errors',
        kind: 'signal',
      },
      test: (record) => record.failed === true,
      group: 'errors',
    },
  ]
  for (const tool of [...tools].sort(alphabetical)) {
    rows.push({
      row: { id: `tools.${tool}`, label: tool, kind: 'signal', match: [{ tool }] },
      test: (record) => record.eventType === 'tool/call' && record.tool === tool,
      group: 'tools',
    })
  }
  for (const source of [...sources].sort(alphabetical)) {
    rows.push({
      row: {
        id: `sources.${source}`,
        label: `Message: ${source}`,
        kind: 'signal',
        match: [{ sourceKind: source }],
      },
      test: (record) => record.sourceKind === source,
      group: 'sources',
    })
  }
  for (const abort of [...aborts].sort(alphabetical)) {
    rows.push({
      row: {
        id: `aborts.${abort}`,
        label: `Abort: ${abort}`,
        kind: 'signal',
        match: [{ abortPrefix: abort }],
      },
      test: (record) => record.abortPrefix?.startsWith(abort) === true,
      group: 'aborts',
    })
  }
  return rows
}
