/**
 * The retained executable baseline for the retired delegation gates. The legacy
 * runtime is deleted in Release B, so the certified allow/refuse decisions live
 * here: each scenario replays the legacy rule that produced it and imports no
 * deleted plugin code. A baseline edit makes the tracked parity report stale
 * until `node scripts/workflows-parity.ts` regenerates it.
 */

export interface RetainedDecision {
  readonly decision: 'allow' | 'refuse'
  readonly reason: string
}

const allow = (reason: string): RetainedDecision => ({ decision: 'allow', reason })
const refuse = (reason: string): RetainedDecision => ({ decision: 'refuse', reason })

/** A spec record completes the whole-spec step only at the current digest. */
function specReview(state: 'missing' | 'stale' | 'current'): RetainedDecision {
  if (state === 'missing') return refuse('no whole-spec PASS record exists')
  if (state === 'stale') return refuse('the record digest is stale')
  return allow('the current whole-spec PASS record completes the step')
}

/** A progress note allows the close only while it names the current worktree. */
function progress(
  state: 'current-note' | 'stale-note' | 'unchecked-missing-note' | 'reviewed-tick',
): RetainedDecision {
  if (state === 'current-note') return allow('the note names the current worktree digest')
  if (state === 'stale-note') return refuse('the worktree digest changed after the note')
  if (state === 'unchecked-missing-note') return refuse('the task is unchecked and has no note')
  return allow('the checked task was reviewed in this turn')
}

/** The lane gate refuses when a non-serial lane with work is unassigned. */
function lane(
  state: 'first-implementation-turn' | 'single-remaining' | 'below-threshold' | 'assigned-worker',
): RetainedDecision {
  if (state === 'first-implementation-turn') return refuse('an unassigned lane remains')
  if (state === 'single-remaining') return refuse('the only remaining lane is unassigned')
  if (state === 'below-threshold') return refuse('the turn touched no lane work')
  return allow('a tagged worker assigned every non-serial lane')
}

export const RETAINED_BASELINE: Readonly<Record<string, () => Promise<RetainedDecision>>> = {
  'retained-spec-review-missing': async () => specReview('missing'),
  'retained-spec-review-stale': async () => specReview('stale'),
  'retained-spec-review-current': async () => specReview('current'),
  // The soft scenario is retired: an old soft-settled run keeps no open
  // required step, so it does not block an otherwise approved archive.
  'retained-integration-archive': async () =>
    allow('the exhausted soft run keeps no open step and does not block the archive'),
  'retained-progress-current-note': async () => progress('current-note'),
  'retained-progress-stale-note': async () => progress('stale-note'),
  'retained-progress-unchecked-missing-note': async () => progress('unchecked-missing-note'),
  'retained-progress-reviewed-tick': async () => progress('reviewed-tick'),
  'retained-lane-first-implementation-turn': async () => lane('first-implementation-turn'),
  'retained-lane-single-remaining': async () => lane('single-remaining'),
  'retained-lane-below-threshold': async () => lane('below-threshold'),
  'retained-lane-assigned-worker': async () => lane('assigned-worker'),
}
