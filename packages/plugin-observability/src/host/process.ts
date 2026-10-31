import type { Distribution, EpisodeWork, Window } from './metrics.js'
import { distribution, parallelWidth } from './metrics.js'
import type { TraceRecord } from './records.js'

/**
 * The process timeline: when workers were spawned, how many ran at once, when a
 * decomposition burst began, when the agent reflected, and the step rate under
 * them. Derived only from recorded session metadata: times, counts, ids, and an
 * outcome word. No message text, tool arguments, goal objectives, or checkpoint
 * list text is kept.
 */

/** One joined worker session's span, clipped to the observed window. */
export interface WorkerSpan {
  readonly sessionId: string
  readonly episodeId: string
  readonly from: number
  readonly to: number
}

/** One step of the worker-concurrency series; `active` holds until the next point. */
export interface ConcurrencyPoint {
  readonly time: number
  readonly active: number
}

/**
 * One bucket of the step-rate strip, aligned by index with the report's bucket
 * labels. The session range carries `0`/`0` bounds because its buckets are time
 * slices, not calendar buckets.
 */
export interface StepBucket {
  readonly from: number
  readonly to: number
  readonly steps: number
}

/** The first worker activation of an episode while no other worker was active. */
export interface DecompositionMarker {
  readonly time: number
  readonly episodeId: string
  /** Workers joined to the episode, not only the ones active at this instant. */
  readonly workers: number
}

/** A `work_checkpoint` call whose outcome word parsed. */
export interface ReflectionMarker {
  readonly time: number
  readonly episodeId: string
  readonly outcome: string
  /** Steps since the previous reflection, or since the episode start. */
  readonly stepsSince: number
}

/** The window's process counts, distributions, and coverage. */
export interface ProcessSummary {
  readonly episodes: number
  /** Distinct joined child sessions alive in the window. */
  readonly workers: number
  readonly episodesWithWorker: number
  /** Worker activations inside the window; a span that began earlier is not one. */
  readonly activations: number
  readonly maxConcurrency: number
  /** Per episode with a worker: first worker activation minus episode start. */
  readonly timeToFirstWorker: Distribution
  readonly reflections: number
  /** Steps since the previous valid reflection, or since the episode start. */
  readonly stepsBetweenReflections: Distribution
  /** Reflections over episodes; absent when the window holds no episode. */
  readonly reflectionsPerEpisode?: number
  /** Episodes with at least one valid reflection over all episodes; absent when empty. */
  readonly reflectionCoverage?: number
  /** False means no decomposition was observed, never that one was skipped. */
  readonly decompositionObserved: boolean
}

/** One side of the before-and-after comparison. */
export interface ProcessSide {
  readonly summary: ProcessSummary
}

/** The intervention comparison; either a configured date or the report's baseline. */
export interface ProcessComparison {
  readonly basis: 'intervention date' | 'previous equal window' | 'previous completed session'
  /** Epoch milliseconds of the date the panel prints, when one was used. */
  readonly interventionAt?: number
  readonly before: ProcessSide
  readonly after: ProcessSide
  readonly status: 'association' | 'insufficient'
  readonly label: 'association, not proof' | 'insufficient data'
  readonly minEpisodes: number
}

/** The whole process section of the report. */
export interface ProcessTimelineData {
  readonly from: number
  readonly to: number
  readonly workers: readonly WorkerSpan[]
  readonly concurrency: readonly ConcurrencyPoint[]
  readonly decomposition: readonly DecompositionMarker[]
  readonly reflections: readonly ReflectionMarker[]
  /** Steps per report bucket, aligned by index with the report's bucket labels. */
  readonly stepRate: readonly StepBucket[]
  readonly summary: ProcessSummary
  /** Absent when no intervention date is configured and the report has no baseline. */
  readonly comparison?: ProcessComparison
}

/** The tool that records a work checkpoint. */
const CHECKPOINT_TOOL = 'work_checkpoint'

/** Everything derived once from a set of episodes and a window. */
interface ProcessFacts {
  readonly spans: readonly WorkerSpan[]
  readonly decomposition: readonly DecompositionMarker[]
  readonly reflections: readonly ReflectionMarker[]
  readonly episodes: number
  readonly episodesWithWorker: number
  readonly activations: number
  readonly timeToFirstWorker: readonly number[]
}

/** Whether a worker's span is alive anywhere inside the window. */
function intersects(start: number, end: number, window: Window): boolean {
  if (start === end) return start >= window.from && start < window.to
  return start < window.to && end > window.from
}

/** A worker's observed span; a single recorded instant counts at that instant. */
function observedSpan(
  start: number,
  end: number,
  window: Window,
): { from: number; to: number } | undefined {
  if (!intersects(start, end, window)) return undefined
  if (start === end) return { from: start, to: Math.min(start + 1, window.to) }
  return { from: Math.max(start, window.from), to: Math.min(end, window.to) }
}

/**
 * A valid reflection per episode, with the steps since the previous valid one.
 * A malformed call is not a reflection: it neither becomes a marker nor resets
 * the cadence, so the next gap covers the steps it pretended to account for.
 */
function reflectionMarkers(
  records: readonly TraceRecord[],
  episodeId: string,
  window: Window,
): ReflectionMarker[] {
  const ordered = [...records].sort((left, right) => left.time - right.time || left.seq - right.seq)
  const markers: ReflectionMarker[] = []
  let steps = 0
  for (const record of ordered) {
    if (record.eventType === 'step/start') {
      steps += 1
      continue
    }
    if (record.eventType !== 'tool/call' || record.tool !== CHECKPOINT_TOOL) continue
    if (record.checkpointOutcome === undefined) continue
    if (record.time >= window.from && record.time < window.to) {
      markers.push({
        time: record.time,
        episodeId,
        outcome: record.checkpointOutcome,
        stepsSince: steps,
      })
    }
    steps = 0
  }
  return markers
}

/**
 * Burst starts: an episode's first worker activation while no other worker was
 * active. Its burst size is every worker joined to that episode. A worker that
 * starts while one is still running belongs to the burst already underway.
 */
function decompositionMarkers(work: readonly EpisodeWork[], window: Window): DecompositionMarker[] {
  interface Candidate {
    readonly time: number
    readonly end: number
    readonly episodeId: string
    readonly sessionId: string
    readonly workers: number
    readonly first: boolean
  }
  const candidates: Candidate[] = []
  for (const entry of work) {
    const children = [...entry.episode.children].sort(
      (left, right) => left.start - right.start || left.sessionId.localeCompare(right.sessionId),
    )
    children.forEach((child, index) => {
      candidates.push({
        time: child.start,
        end: child.end,
        episodeId: entry.episode.id,
        sessionId: child.sessionId,
        workers: children.length,
        first: index === 0,
      })
    })
  }
  candidates.sort(
    (left, right) =>
      left.time - right.time ||
      left.episodeId.localeCompare(right.episodeId) ||
      left.sessionId.localeCompare(right.sessionId),
  )
  const started: Candidate[] = []
  const markers: DecompositionMarker[] = []
  for (const candidate of candidates) {
    // Only a worker that started strictly earlier is already active: two
    // episodes whose first workers start at the same instant after idle are
    // both burst starts, while the concurrency series still shows both at once.
    const busy = started.some(
      (other) =>
        other.time < candidate.time &&
        (other.end > other.time ? other.end > candidate.time : other.time + 1 > candidate.time),
    )
    if (candidate.first && !busy && candidate.time >= window.from && candidate.time < window.to) {
      markers.push({
        time: candidate.time,
        episodeId: candidate.episodeId,
        workers: candidate.workers,
      })
    }
    started.push(candidate)
  }
  return markers
}

/** The window's worker spans, markers, and the values the summary distributes. */
function processFacts(work: readonly EpisodeWork[], window: Window): ProcessFacts {
  const spans: WorkerSpan[] = []
  const reflections: ReflectionMarker[] = []
  const timeToFirstWorker: number[] = []
  let episodesWithWorker = 0
  let activations = 0
  for (const entry of work) {
    const episode = entry.episode
    const children = episode.children
    const active = children.filter((child) => intersects(child.start, child.end, window))
    if (active.length > 0) {
      episodesWithWorker += 1
      const first = children.reduce(
        (earliest, child) => Math.min(earliest, child.start),
        Number.POSITIVE_INFINITY,
      )
      timeToFirstWorker.push(first - episode.start)
    }
    for (const child of active) {
      const span = observedSpan(child.start, child.end, window)
      if (span === undefined) continue
      spans.push({
        sessionId: child.sessionId,
        episodeId: episode.id,
        from: span.from,
        to: span.to,
      })
      if (child.start >= window.from && child.start < window.to) activations += 1
    }
    reflections.push(...reflectionMarkers(episode.records, episode.id, window))
  }
  spans.sort(
    (left, right) => left.from - right.from || left.sessionId.localeCompare(right.sessionId),
  )
  reflections.sort(
    (left, right) => left.time - right.time || left.episodeId.localeCompare(right.episodeId),
  )
  return {
    spans,
    decomposition: decompositionMarkers(work, window),
    reflections,
    episodes: work.length,
    episodesWithWorker,
    activations,
    timeToFirstWorker,
  }
}

/** The summary of the facts, with an absent average left absent rather than zero. */
function summaryOf(facts: ProcessFacts): ProcessSummary {
  const workers = new Set(facts.spans.map((span) => span.sessionId)).size
  const reflected = new Set(facts.reflections.map((marker) => marker.episodeId)).size
  return {
    episodes: facts.episodes,
    workers,
    episodesWithWorker: facts.episodesWithWorker,
    activations: facts.activations,
    maxConcurrency: parallelWidth(facts.spans.map((span) => ({ start: span.from, end: span.to }))),
    timeToFirstWorker: distribution(facts.timeToFirstWorker),
    reflections: facts.reflections.length,
    stepsBetweenReflections: distribution(facts.reflections.map((marker) => marker.stepsSince)),
    ...(facts.episodes === 0
      ? {}
      : {
          reflectionsPerEpisode: facts.reflections.length / facts.episodes,
          reflectionCoverage: reflected / facts.episodes,
        }),
    decompositionObserved: workers > 0,
  }
}

/** The worker-concurrency step series, anchored at the window start. */
function concurrencySeries(spans: readonly WorkerSpan[], window: Window): ConcurrencyPoint[] {
  if (spans.length === 0) return []
  const changes = new Map<number, number>()
  const add = (time: number, delta: number): void => {
    changes.set(time, (changes.get(time) ?? 0) + delta)
  }
  for (const span of spans) {
    add(span.from, 1)
    add(span.to, -1)
  }
  const times = [...changes.keys()].sort((left, right) => left - right)
  const points: ConcurrencyPoint[] = []
  let active = 0
  for (const time of times) {
    if (points.length === 0 && time > window.from) points.push({ time: window.from, active: 0 })
    active += changes.get(time) ?? 0
    points.push({ time, active })
  }
  return points
}

/** The window's process summary; exported for the report's baseline side. */
export function processSummary(work: readonly EpisodeWork[], window: Window): ProcessSummary {
  return summaryOf(processFacts(work, window))
}

function comparisonOf(
  basis: ProcessComparison['basis'],
  interventionAt: number | undefined,
  before: ProcessSummary,
  after: ProcessSummary,
  minEpisodes: number,
): ProcessComparison {
  // Either side below the minimum reads insufficient, never an improvement.
  const insufficient = before.episodes < minEpisodes || after.episodes < minEpisodes
  return {
    basis,
    ...(interventionAt === undefined ? {} : { interventionAt }),
    before: { summary: before },
    after: { summary: after },
    status: insufficient ? 'insufficient' : 'association',
    label: insufficient ? 'insufficient data' : 'association, not proof',
    minEpisodes,
  }
}

/** Split the window's episodes at the configured date, or compare with the baseline. */
function comparisonFor(
  options: BuildProcessOptions,
  current: ProcessSummary,
): ProcessComparison | undefined {
  const interventionAt = options.interventionAt
  if (interventionAt !== undefined) {
    const before = processSummary(
      options.work.filter((entry) => entry.episode.start < interventionAt),
      options.window,
    )
    const after = processSummary(
      options.work.filter((entry) => entry.episode.start >= interventionAt),
      options.window,
    )
    return comparisonOf('intervention date', interventionAt, before, after, options.minEpisodes)
  }
  if (options.baseline === undefined) return undefined
  return comparisonOf(
    options.baseline.kind,
    undefined,
    options.baseline.summary,
    current,
    options.minEpisodes,
  )
}

/** What the process timeline needs: the window's episodes and its step-rate series. */
export interface BuildProcessOptions {
  /** Episodes overlapping the observed window; `work` is clipped by it. */
  readonly work: readonly EpisodeWork[]
  readonly window: Window
  /** Steps per report bucket, aligned by index with the report's bucket labels. */
  readonly stepRate: readonly StepBucket[]
  readonly minEpisodes: number
  /** Epoch milliseconds of the configured intervention date, when set. */
  readonly interventionAt?: number
  /** The report's baseline, when the reader resolved one. */
  readonly baseline?: {
    readonly kind: 'previous equal window' | 'previous completed session'
    readonly summary: ProcessSummary
  }
}

/** Build the window's process timeline, summary, and comparison. */
export function buildProcessTimeline(options: BuildProcessOptions): ProcessTimelineData {
  const facts = processFacts(options.work, options.window)
  const summary = summaryOf(facts)
  const comparison = comparisonFor(options, summary)
  return {
    from: options.window.from,
    to: options.window.to,
    workers: facts.spans.map((span) => ({
      sessionId: span.sessionId,
      episodeId: span.episodeId,
      from: span.from,
      to: span.to,
    })),
    concurrency: concurrencySeries(facts.spans, options.window),
    decomposition: facts.decomposition,
    reflections: facts.reflections,
    stepRate: options.stepRate,
    summary,
    ...(comparison === undefined ? {} : { comparison }),
  }
}
