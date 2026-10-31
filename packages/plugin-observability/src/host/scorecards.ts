import { startOfLocalDay } from './aggregate.js'
import { matchesPredicate, type TestableRow } from './builtins.js'
import type { Distribution, EpisodeWork } from './metrics.js'
import { distribution } from './metrics.js'
import type { Row } from './rows.js'

/**
 * Plugin scorecards: a declared goal, the eligible population, activation, and
 * an outcome comparison between the treated cohort (fired and eligible) and the
 * control (eligible and not fired), matched by tool-call size and week.
 */

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The tool-call size bins every comparison matches on. */
const BIN_EDGES: readonly number[] = [10, 50, 200]

/** The bin index of an episode's tool-call count. */
export function toolBin(calls: number): number {
  let bin = 0
  for (const edge of BIN_EDGES) {
    if (calls >= edge) bin += 1
  }
  return bin
}

/** The local Monday-start key of a time, so a week cell is stable. */
export function weekStart(time: number): number {
  const day = startOfLocalDay(time)
  const weekday = (new Date(day).getDay() + 6) % 7
  return day - weekday * DAY
}

/** One cohort's outcome metrics; a p50/p90 pair per metric. */
export interface CohortMetrics {
  readonly n: number
  /** Verified completions over completed episodes; absent when none completed. */
  readonly verifiedShare?: number
  readonly tokens: Distribution
  readonly activeMinutes: Distribution
  readonly stepsPerHumanMessage: Distribution
}

/** Treated minus control for each comparable outcome; absent when either side is absent. */
export interface OutcomeDeltas {
  readonly verifiedShare?: number
  readonly tokensP50?: number
  readonly activeMinutesP50?: number
  readonly stepsPerHumanMessageP50?: number
}

/** One signal row's scorecard. */
export interface Scorecard {
  readonly rowId: string
  readonly label: string
  /** The declared business goal, rendered as data. */
  readonly goal?: string
  /** Whether the row declares an eligibility predicate. */
  readonly eligibilityDeclared: boolean
  /** Episodes matching the eligibility predicate, or every episode without one. */
  readonly eligible: number
  /** Fired and eligible episodes. */
  readonly fired: number
  /** Fired episodes outside the eligibility predicate; never in activation. */
  readonly firedOutside: number
  /** Fired and eligible over eligible; absent when no episode was eligible. */
  readonly activation?: number
  /** Treated episodes with a recorded failure over treated episodes. */
  readonly errorRate?: number
  readonly treated: CohortMetrics
  readonly control: CohortMetrics
  /** Treated minus control, preserving unavailable values as absent. */
  readonly deltas: OutcomeDeltas
  /** Whether the comparison found a matched control for every treated episode. */
  readonly matched: boolean
  /** Whether a size bin had to be compared across weeks. */
  readonly weekRelaxed: boolean
  /** Either side below the configured minimum. */
  readonly insufficient: boolean
  readonly association: 'association, not proof'
}

/** The window's records of an episode, its children included. */
function episodeRecords(work: EpisodeWork) {
  return [...work.ownRecords, ...work.childRecords]
}

/** Whether a row fired anywhere inside the episode. */
function firedIn(work: EpisodeWork, row: TestableRow): boolean {
  return episodeRecords(work).some((record) => row.test(record))
}

/** Whether an episode is eligible; an undeclared predicate makes every episode eligible. */
function eligibleIn(work: EpisodeWork, row: Row): boolean {
  const eligible = row.eligible
  if (eligible === undefined) return true
  return episodeRecords(work).some((record) =>
    eligible.some((predicate) => matchesPredicate(record, predicate)),
  )
}

function cohortMetrics(entries: readonly EpisodeWork[]): CohortMetrics {
  const completed = entries.filter((entry) => entry.outcome === 'completed')
  const verified = completed.filter((entry) => entry.verified).length
  return {
    n: entries.length,
    ...(completed.length === 0 ? {} : { verifiedShare: verified / completed.length }),
    tokens: distribution(entries.map((entry) => entry.usage.total)),
    activeMinutes: distribution(entries.map((entry) => entry.activeMs / 60_000)),
    stepsPerHumanMessage: distribution(
      entries.flatMap((entry) => {
        const humans = entry.ownRecords.filter(
          (record) => record.eventType === 'user/message' && record.sourceKind === 'user',
        ).length
        return humans === 0 ? [] : [entry.steps / humans]
      }),
    ),
  }
}

/** Treated minus control for each comparable outcome. */
function deltasOf(treated: CohortMetrics, control: CohortMetrics): OutcomeDeltas {
  const both = (left: Distribution, right: Distribution): boolean => left.n > 0 && right.n > 0
  return {
    ...(treated.verifiedShare === undefined || control.verifiedShare === undefined
      ? {}
      : { verifiedShare: treated.verifiedShare - control.verifiedShare }),
    ...(both(treated.tokens, control.tokens)
      ? { tokensP50: treated.tokens.p50 - control.tokens.p50 }
      : {}),
    ...(both(treated.activeMinutes, control.activeMinutes)
      ? { activeMinutesP50: treated.activeMinutes.p50 - control.activeMinutes.p50 }
      : {}),
    ...(both(treated.stepsPerHumanMessage, control.stepsPerHumanMessage)
      ? {
          stepsPerHumanMessageP50:
            treated.stepsPerHumanMessage.p50 - control.stepsPerHumanMessage.p50,
        }
      : {}),
  }
}

/** Split a cohort into matching cells: tool-call bin, or bin plus week. */
function matchCohorts(
  treated: readonly EpisodeWork[],
  control: readonly EpisodeWork[],
  minEpisodes: number,
): { treated: EpisodeWork[]; control: EpisodeWork[]; matched: boolean; weekRelaxed: boolean } {
  const treatedByBin = new Map<number, EpisodeWork[]>()
  const controlByBin = new Map<number, EpisodeWork[]>()
  for (const entry of treated) {
    const bin = toolBin(entry.toolCalls)
    const list = treatedByBin.get(bin) ?? []
    list.push(entry)
    treatedByBin.set(bin, list)
  }
  for (const entry of control) {
    const bin = toolBin(entry.toolCalls)
    const list = controlByBin.get(bin) ?? []
    list.push(entry)
    controlByBin.set(bin, list)
  }
  const matchedTreated = new Set<EpisodeWork>()
  const matchedControl = new Set<EpisodeWork>()
  let weekRelaxed = false
  for (const bin of new Set([...treatedByBin.keys(), ...controlByBin.keys()])) {
    const treatedBin = treatedByBin.get(bin) ?? []
    const controlBin = controlByBin.get(bin) ?? []
    if (treatedBin.length === 0 || controlBin.length === 0) continue
    const weeks = new Set<number>()
    for (const entry of [...treatedBin, ...controlBin]) weeks.add(weekStart(entry.episode.start))
    const cells = [...weeks].map((week) => ({
      treated: treatedBin.filter((entry) => weekStart(entry.episode.start) === week),
      control: controlBin.filter((entry) => weekStart(entry.episode.start) === week),
    }))
    // Every week cell inside the bin must be large enough on both sides; a
    // small cell aggregates the whole bin across weeks and says so.
    const strong = cells.every(
      (cell) => cell.treated.length >= minEpisodes && cell.control.length >= minEpisodes,
    )
    const paired = strong ? cells : [{ treated: treatedBin, control: controlBin }]
    if (!strong) weekRelaxed = true
    for (const pair of paired) {
      // Equal cell sizes, so one week's episode count cannot weigh the pooled
      // distributions and manufacture a delta the cells do not have.
      const size = Math.min(pair.treated.length, pair.control.length)
      const order = (left: EpisodeWork, right: EpisodeWork): number =>
        left.episode.start - right.episode.start
      for (const entry of [...pair.treated].sort(order).slice(0, size)) {
        matchedTreated.add(entry)
      }
      for (const entry of [...pair.control].sort(order).slice(0, size)) {
        matchedControl.add(entry)
      }
    }
  }
  return {
    treated: [...matchedTreated],
    control: [...matchedControl],
    matched: matchedTreated.size > 0 && matchedControl.size > 0,
    weekRelaxed,
  }
}

/** One scorecard per configured signal row. */
export function scorecards(
  rows: readonly TestableRow[],
  work: readonly EpisodeWork[],
  minEpisodes: number,
): Scorecard[] {
  return rows
    .filter((entry) => entry.row.kind === 'signal')
    .map((entry) => {
      const eligible = work.filter((candidate) => eligibleIn(candidate, entry.row))
      const fired = eligible.filter((candidate) => firedIn(candidate, entry))
      const firedOutside = work.filter(
        (candidate) => !eligibleIn(candidate, entry.row) && firedIn(candidate, entry),
      )
      const control = eligible.filter((candidate) => !firedIn(candidate, entry))
      const matched = matchCohorts(fired, control, minEpisodes)
      const treatedMetrics = cohortMetrics(matched.treated)
      const controlMetrics = cohortMetrics(matched.control)
      const insufficient = treatedMetrics.n < minEpisodes || controlMetrics.n < minEpisodes
      return {
        rowId: entry.row.id,
        label: entry.row.label,
        ...(entry.row.goal === undefined ? {} : { goal: entry.row.goal }),
        eligibilityDeclared: entry.row.eligible !== undefined,
        eligible: eligible.length,
        fired: fired.length,
        firedOutside: firedOutside.length,
        ...(eligible.length === 0 ? {} : { activation: fired.length / eligible.length }),
        ...(fired.length === 0
          ? {}
          : {
              errorRate: fired.filter((candidate) => candidate.failures > 0).length / fired.length,
            }),
        treated: treatedMetrics,
        control: controlMetrics,
        deltas: deltasOf(treatedMetrics, controlMetrics),
        matched: matched.matched,
        weekRelaxed: matched.weekRelaxed,
        insufficient,
        association: 'association, not proof',
      }
    })
}
