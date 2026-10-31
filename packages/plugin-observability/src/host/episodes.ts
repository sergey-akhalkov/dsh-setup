import type { SessionMeta, TokenUsage, TraceRecord } from './records.js'

/**
 * Task episodes. An episode starts at a human message and ends before the next
 * one, at session end, or after the configured idle gap. Machine messages and
 * tool activity stay inside it; nothing here reads message text.
 */

/** The terminal classification of one episode. */
export type EpisodeOutcome = 'completed' | 'failed' | 'cut' | 'blocked' | 'other' | 'open'

/** Every outcome word, in report order. */
export const EPISODE_OUTCOMES: readonly EpisodeOutcome[] = [
  'completed',
  'failed',
  'cut',
  'blocked',
  'other',
  'open',
]

/** The idle gap default: no event for this long ends the episode. */
export const DEFAULT_IDLE_GAP_MINUTES = 30

/** One session's owned records and its header metadata. */
export interface SessionInput {
  readonly id: string
  readonly records: readonly TraceRecord[]
  readonly meta: SessionMeta
}

/** An active work interval, clipped to its episode. */
export interface EpisodeInterval {
  readonly from: number
  readonly to: number
}

/** What the episode's own goal changes say. */
export interface EpisodeGoals {
  readonly created: number
  readonly paused: number
  readonly resumed: number
  readonly completed: number
  /** The highest cumulative `roundsStarted` the episode recorded. */
  readonly rounds: number
  readonly phase?: string
}

/** What one episode's work checkpoints say. */
export interface EpisodeCheckpoints {
  readonly total: number
  /** Completed checkpoints; a `continue` checkpoint is not a close. */
  readonly closes: number
  /** Completed checkpoints that carried non-empty evidence. */
  readonly verified: number
}

/** One child session joined to a parent episode. */
export interface EpisodeChild {
  readonly sessionId: string
  readonly origin?: string
  readonly delegationDepth?: number
  readonly start: number
  readonly end: number
  readonly outcome: EpisodeOutcome
  readonly verified: boolean
  readonly usage: TokenUsage
  readonly toolCalls: number
  /** The child's own records, so its work is counted once in the parent episode. */
  readonly records: readonly TraceRecord[]
}

/** One derived episode. */
export interface Episode {
  /** `sessionId#index`, index following start time. */
  readonly id: string
  readonly sessionId: string
  readonly index: number
  readonly start: number
  /** The last included record's time. */
  readonly end: number
  /** The episode's own records, in time order. */
  readonly records: readonly TraceRecord[]
  /** Child sessions joined to this episode; their work is counted here once. */
  readonly children: readonly EpisodeChild[]
  readonly humanMessages: number
  readonly machineMessages: number
  readonly turns: number
  readonly steps: number
  readonly toolCalls: number
  readonly commands: number
  readonly outcome: EpisodeOutcome
  readonly verified: boolean
  readonly checkpoints: EpisodeCheckpoints
  readonly goals: EpisodeGoals
  /** The episode's own usage plus every joined child's usage. */
  readonly usage: TokenUsage
  /** Unioned step and tool intervals of the episode and its children, clipped. */
  readonly intervals: readonly EpisodeInterval[]
  readonly activeMs: number
  /** Turn failures plus tool failures no completed turn closer recovered. */
  readonly failures: number
}

/** One session whose parent chain does not reach the read corpus. */
export interface UnlinkedChild {
  readonly sessionId: string
  readonly parentSession: string
}

/** The episodes of every root session plus the children that could not be joined. */
export interface EpisodeIndex {
  readonly episodes: readonly Episode[]
  readonly unlinked: readonly UnlinkedChild[]
}

/** The empty usage a message without a usage record contributes. */
export const NO_USAGE: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }

/** The human message source kind; every other kind is a machine injection. */
const HUMAN_SOURCE = 'user'

const CUT_CLOSERS: ReadonlySet<string> = new Set(['aborted', 'max-tokens', 'interrupted'])
const ERROR_CLOSER = 'error'
const COMPLETED_CLOSER = 'completed'
const BLOCKED_CLOSER = 'blocked'

/** Every terminal kind the outcome map defines. */
export const KNOWN_TERMINALS: ReadonlySet<string> = new Set([
  COMPLETED_CLOSER,
  ERROR_CLOSER,
  'aborted',
  'max-tokens',
  'interrupted',
  BLOCKED_CLOSER,
])

/** Whether a record is a human message; the only thing that starts an episode. */
export function isHumanMessage(record: TraceRecord): boolean {
  return record.eventType === 'user/message' && record.sourceKind === HUMAN_SOURCE
}

/** Add one record's usage, if it recorded any. */
export function addUsage(total: TokenUsage, usage: TokenUsage | undefined): TokenUsage {
  if (usage === undefined) return total
  return {
    input: total.input + usage.input,
    output: total.output + usage.output,
    cacheRead: total.cacheRead + usage.cacheRead,
    cacheWrite: total.cacheWrite + usage.cacheWrite,
    total: total.total + usage.total,
  }
}

/** The usage of a record list, in one pass. */
export function usageOf(records: readonly TraceRecord[]): TokenUsage {
  return records.reduce((total, record) => addUsage(total, record.usage), NO_USAGE)
}

/** The last closer per turn, the episode's final closer, and whether a turn is open. */
function turnClosers(records: readonly TraceRecord[]): {
  readonly closers: ReadonlyMap<number, string>
  readonly last?: string
  readonly open: boolean
} {
  const closers = new Map<number, string>()
  let last: string | undefined
  let lastStart = -1
  let lastEnd = -1
  records.forEach((record, index) => {
    if (record.eventType === 'turn/start') {
      lastStart = index
      return
    }
    if (record.eventType !== 'turn/end') return
    lastEnd = index
    if (record.turnEnd === undefined) return
    if (record.turn !== undefined) closers.set(record.turn, record.turnEnd)
    last = record.turnEnd
  })
  return { closers, ...(last === undefined ? {} : { last }), open: lastStart > lastEnd }
}

/**
 * Classify an episode from its recorded turn ends and failures. An unrecovered
 * failure outranks the closer; a started turn with no end is open even when an
 * earlier turn closed.
 */
export function outcomeOf(records: readonly TraceRecord[]): {
  readonly outcome: EpisodeOutcome
  readonly failures: number
} {
  const { closers, last, open } = turnClosers(records)
  let failures = 0
  for (const record of records) {
    if (record.eventType === 'turn/end' && record.turnEnd === ERROR_CLOSER) {
      failures += 1
      continue
    }
    if (record.eventType !== 'tool/result' || record.failed !== true) continue
    const closer = record.turn === undefined ? undefined : closers.get(record.turn)
    if (closer !== COMPLETED_CLOSER) failures += 1
  }
  if (failures > 0) return { outcome: 'failed', failures }
  if (open || last === undefined) return { outcome: 'open', failures: 0 }
  if (last === COMPLETED_CLOSER) return { outcome: 'completed', failures: 0 }
  if (CUT_CLOSERS.has(last)) return { outcome: 'cut', failures: 0 }
  if (last === BLOCKED_CLOSER) return { outcome: 'blocked', failures: 0 }
  return { outcome: 'other', failures: 0 }
}

/** The final terminal kind when the last turn ended, whatever the map says. */
export function finalTerminalOf(records: readonly TraceRecord[]): string | undefined {
  const { last, open } = turnClosers(records)
  return open ? undefined : last
}

/** The final terminal kind when the map does not define it. */
export function unmappedTerminalOf(records: readonly TraceRecord[]): string | undefined {
  const terminal = finalTerminalOf(records)
  return terminal !== undefined && !KNOWN_TERMINALS.has(terminal) ? terminal : undefined
}

/** Whether a completed checkpoint carried non-empty evidence. */
export function checkpointEvidence(records: readonly TraceRecord[]): EpisodeCheckpoints {
  let total = 0
  let closes = 0
  let verified = 0
  for (const record of records) {
    if (record.checkpointOutcome === undefined) continue
    total += 1
    if (record.checkpointOutcome !== 'done') continue
    closes += 1
    if ((record.checkpointVerifiedCount ?? 0) > 0) verified += 1
  }
  return { total, closes, verified }
}

/** The episode's goal operations, phase, and cumulative rounds. */
export function goalsOf(records: readonly TraceRecord[]): EpisodeGoals {
  const counts = { created: 0, paused: 0, resumed: 0, completed: 0, rounds: 0 }
  const roundsByGoal = new Map<string, number>()
  let phase: string | undefined
  for (const record of records) {
    if (record.eventType !== 'goal/change') continue
    switch (record.goalOperation) {
      case 'create':
        counts.created += 1
        break
      case 'pause':
        counts.paused += 1
        break
      case 'resume':
        counts.resumed += 1
        break
      case 'complete':
        counts.completed += 1
        break
      default:
        break
    }
    if (record.goalRounds !== undefined) {
      // The counter is cumulative per goal; the sum of per-goal maxima is the round count.
      const key = record.goalId ?? 'unidentified'
      roundsByGoal.set(key, Math.max(roundsByGoal.get(key) ?? 0, record.goalRounds))
    }
    if (record.goalPhase !== undefined) phase = record.goalPhase
  }
  for (const rounds of roundsByGoal.values()) counts.rounds += rounds
  return phase === undefined ? counts : { ...counts, phase }
}

/** Merge intervals, counting overlapping time once. */
function mergeIntervals(
  raw: readonly EpisodeInterval[],
  start: number,
  end: number,
): EpisodeInterval[] {
  const clipped = raw
    .map((interval) => ({ from: Math.max(interval.from, start), to: Math.min(interval.to, end) }))
    .filter((interval) => interval.to > interval.from)
    .sort((left, right) => left.from - right.from)
  const merged: EpisodeInterval[] = []
  for (const interval of clipped) {
    const last = merged[merged.length - 1]
    if (last !== undefined && interval.from <= last.to) {
      if (interval.to > last.to) merged[merged.length - 1] = { from: last.from, to: interval.to }
      continue
    }
    merged.push(interval)
  }
  return merged
}

/**
 * The raw step and tool intervals of a record list, before clipping. Pairing
 * happens over the complete session so an interval that crosses a human message
 * still contributes the part inside the later episode.
 */
export function laneIntervals(records: readonly TraceRecord[]): {
  readonly steps: readonly EpisodeInterval[]
  readonly tools: readonly EpisodeInterval[]
} {
  const steps: EpisodeInterval[] = []
  const tools: EpisodeInterval[] = []
  const stepStarts = new Map<string, number>()
  const callStarts = new Map<string, number>()
  for (const record of records) {
    if (
      record.eventType === 'step/start' &&
      record.turn !== undefined &&
      record.step !== undefined
    ) {
      stepStarts.set(`${String(record.turn)}:${String(record.step)}`, record.time)
      continue
    }
    if (record.eventType === 'step/end' && record.turn !== undefined && record.step !== undefined) {
      const from = stepStarts.get(`${String(record.turn)}:${String(record.step)}`)
      if (from !== undefined) steps.push({ from, to: record.time })
      continue
    }
    if (record.eventType === 'tool/call' && record.callId !== undefined) {
      callStarts.set(record.callId, record.time)
      continue
    }
    if (record.eventType === 'tool/result' && record.callId !== undefined) {
      const from = callStarts.get(record.callId)
      if (from !== undefined) tools.push({ from, to: record.time })
    }
  }
  return { steps, tools }
}

/** Both lane interval lists of a record list, before clipping. */
export function intervalPairs(records: readonly TraceRecord[]): EpisodeInterval[] {
  const lanes = laneIntervals(records)
  return [...lanes.steps, ...lanes.tools]
}

/** Clip raw intervals to `[start, end]` and merge the overlaps. */
export function clipIntervals(
  raw: readonly EpisodeInterval[],
  start: number,
  end: number,
): EpisodeInterval[] {
  return mergeIntervals(raw, start, end)
}

/**
 * The union of step and tool intervals, clipped to `[start, end]`. A tool call
 * inside a step overlaps it and counts once; a command is neither, so it adds
 * no active time.
 */
export function activeIntervals(
  records: readonly TraceRecord[],
  start: number,
  end: number,
): EpisodeInterval[] {
  return clipIntervals(intervalPairs(records), start, end)
}

/** The total length of unioned intervals. */
export function intervalLength(intervals: readonly EpisodeInterval[]): number {
  return intervals.reduce((total, interval) => total + interval.to - interval.from, 0)
}

/** One session's records in time order; ties keep the recorded sequence. */
function sorted(records: readonly TraceRecord[]): TraceRecord[] {
  return [...records].sort((left, right) => left.time - right.time || left.seq - right.seq)
}

function makeEpisode(
  session: SessionInput,
  index: number,
  records: readonly TraceRecord[],
  children: readonly EpisodeChild[] = [],
  ownIntervals?: readonly EpisodeInterval[],
  boundaryEnd?: number,
): Episode {
  const start = records[0]?.time ?? 0
  // The end is the episode's boundary — the next human message — not its last
  // event, so an interval that crosses the boundary is split, not dropped.
  const end = boundaryEnd ?? records[records.length - 1]?.time ?? start
  const { outcome, failures } = outcomeOf(records)
  const checkpoints = checkpointEvidence(records)
  // Child intervals are unioned with the parent's, so work that runs while the
  // parent waits counts once rather than twice.
  const raw = [
    ...(ownIntervals ?? activeIntervals(records, start, end)),
    ...children.flatMap((child) => intervalPairs(child.records)),
  ]
  const work = children.length === 0 ? records : [...records, ...children.flatMap((c) => c.records)]
  const intervals = clipIntervals(raw, start, end)
  return {
    id: `${session.id}#${String(index + 1)}`,
    sessionId: session.id,
    index,
    start,
    end,
    records,
    children,
    humanMessages: records.filter(isHumanMessage).length,
    machineMessages: records.filter(
      (record) => record.eventType === 'user/message' && record.sourceKind !== HUMAN_SOURCE,
    ).length,
    turns: records.filter((record) => record.eventType === 'turn/start').length,
    steps: work.filter((record) => record.eventType === 'step/start').length,
    toolCalls: work.filter((record) => record.eventType === 'tool/call').length,
    commands: records.filter((record) => record.eventType === 'command/run').length,
    outcome,
    verified: checkpoints.verified > 0,
    checkpoints,
    goals: goalsOf(records),
    usage: usageOf(work),
    intervals,
    activeMs: intervalLength(intervals),
    failures,
  }
}

/**
 * Derive one session's episodes. Events before its first human message are
 * preamble; activity after an idle gap ends an episode and stays outside every
 * episode until the next human message starts one.
 */
export function deriveEpisodes(session: SessionInput, idleGapMs: number): Episode[] {
  const events = sorted(session.records)
  const raw = intervalPairs(events)
  const episodes: Episode[] = []
  let current: TraceRecord[] = []
  let started = false
  let previous: number | undefined
  const flush = (boundaryEnd?: number): void => {
    if (current.length > 0) {
      const start = current[0]?.time ?? 0
      episodes.push(
        makeEpisode(
          session,
          episodes.length,
          current,
          [],
          clipIntervals(raw, start, boundaryEnd ?? Number.POSITIVE_INFINITY),
          boundaryEnd,
        ),
      )
    }
    current = []
    started = false
  }
  for (const record of events) {
    if (started && previous !== undefined && record.time - previous > idleGapMs) {
      flush()
    }
    if (isHumanMessage(record)) {
      // The next human message is this episode's boundary; a crossing interval
      // is split at it, so neither side loses its active share.
      flush(record.time)
      started = true
      current = [record]
      previous = record.time
      continue
    }
    if (started) {
      current.push(record)
      previous = record.time
    }
  }
  flush()
  return episodes
}

/** The nearest root session above a session, or undefined when the chain leaves the corpus. */
function rootOf(
  session: SessionInput,
  byId: ReadonlyMap<string, SessionInput>,
): string | undefined {
  const seen = new Set<string>()
  let cursor: SessionInput = session
  while (cursor.meta.parentSession !== undefined) {
    if (seen.has(cursor.id)) return undefined
    seen.add(cursor.id)
    const parent = byId.get(cursor.meta.parentSession)
    if (parent === undefined) return undefined
    cursor = parent
  }
  return cursor.id
}

/** A session's time span, or undefined when it recorded nothing. */
function spanOf(records: readonly TraceRecord[]): EpisodeInterval | undefined {
  if (records.length === 0) return undefined
  let from = Number.POSITIVE_INFINITY
  let to = Number.NEGATIVE_INFINITY
  for (const record of records) {
    if (record.time < from) from = record.time
    if (record.time > to) to = record.time
  }
  return { from, to }
}

/** The episode a child span overlaps most, if any. */
function bestOverlap(episodes: readonly Episode[], span: EpisodeInterval): Episode | undefined {
  let best: Episode | undefined
  let bestScore = Number.NEGATIVE_INFINITY
  for (const episode of episodes) {
    const score =
      span.from === span.to
        ? // A child that recorded one instant still belongs where that instant lies.
          span.from >= episode.start && span.from <= episode.end
          ? 0
          : -1
        : Math.min(episode.end, span.to) - Math.max(episode.start, span.from)
    if (score > bestScore) {
      best = episode
      bestScore = score
    }
  }
  return bestScore < 0 ? undefined : best
}

/** One child's contribution to its parent episode. */
function childOf(session: SessionInput, records: readonly TraceRecord[]): EpisodeChild {
  const span = spanOf(records) ?? { from: 0, to: 0 }
  const { outcome } = outcomeOf(records)
  return {
    sessionId: session.id,
    ...(session.meta.origin === undefined ? {} : { origin: session.meta.origin }),
    ...(session.meta.delegationDepth === undefined
      ? {}
      : { delegationDepth: session.meta.delegationDepth }),
    start: span.from,
    end: span.to,
    outcome,
    verified: checkpointEvidence(records).verified > 0,
    usage: usageOf(records),
    toolCalls: records.filter((record) => record.eventType === 'tool/call').length,
    records,
  }
}

/**
 * Derive the episodes of every root session and join each descendant session to
 * the root episode its time overlaps most. A child never becomes a top-level
 * episode; a child whose parent chain leaves the read corpus, or whose time
 * overlaps no root episode, is reported as unlinked rather than dropped.
 */
export function buildEpisodes(
  sessions: readonly SessionInput[],
  idleGapMs = DEFAULT_IDLE_GAP_MINUTES * 60_000,
): EpisodeIndex {
  const byId = new Map(sessions.map((session) => [session.meta.id, session]))
  const roots = sessions.filter((session) => session.meta.parentSession === undefined)
  const derived = new Map<string, Episode[]>(
    roots.map((session) => [session.id, deriveEpisodes(session, idleGapMs)]),
  )
  const joined = new Map<string, EpisodeChild[]>()
  const unlinked: UnlinkedChild[] = []
  for (const session of sessions) {
    if (session.meta.parentSession === undefined) continue
    const root = rootOf(session, byId)
    const span = spanOf(session.records)
    if (root === undefined) {
      unlinked.push({ sessionId: session.id, parentSession: session.meta.parentSession })
      continue
    }
    const target = span === undefined ? undefined : bestOverlap(derived.get(root) ?? [], span)
    if (target === undefined) {
      // A child that overlaps no root episode cannot be attributed; keep it visible.
      unlinked.push({ sessionId: session.id, parentSession: session.meta.parentSession })
      continue
    }
    const children = joined.get(target.id) ?? []
    children.push(childOf(session, session.records))
    joined.set(target.id, children)
  }
  const episodes = roots.flatMap((session) =>
    (derived.get(session.id) ?? []).map((episode) => {
      const children = joined.get(episode.id)
      if (children === undefined) return episode
      return makeEpisode(session, episode.index, episode.records, children, episode.intervals)
    }),
  )
  return { episodes, unlinked }
}
