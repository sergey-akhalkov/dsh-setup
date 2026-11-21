# Proposal

## Why

Issue #11. The review engine treats a verdict as an event, not as the end of a review round. A run
whose review step published `FINDINGS`, or an `ERROR` that only a `PASS` may clear, stays open, and
the next turn close re-advances it into another reviewer child against the same unit and the same
digest. No restart decision compares the reviewed digest or coverage with the verdict it already
has: the intake re-dispatches for any review step that is not done (`src/host/intake.ts:447-505`),
the review executor checks only *live* coverage before enqueueing (`src/host/index.ts:3830-3891`),
the whole-scope triggers fire once per turn from a condition that only asks "no current `PASS`"
(`assets/definitions/spec-review.json:12-23`, `integration-review.json:12-15`), and the due-unit
dispatch starts any unit that has no local `PASS` (`src/host/engine-gates.ts:293-329` called from
`src/host/index.ts:5286-5378`).

On 2026-11-20 one session produced five reviewer children that reported the same findings digest
`d7461435…`; another left a `task-review` run at `next review; review orphaned; review:blocked`
while its own `PASS` record for the unit was on disk, because the explicit-start approval check
validates the section record id instead of the tasks the section approves
(`src/host/evidence.ts:822-853`). Cancelling one run does not stop the round either: a cancelled
attempt leaves no verdict, so the next turn's trigger starts a new run for the same unit. Each new
child wakes the session, so every verdict costs a paid re-review of unchanged code plus a turn, and
"blocked" stops being readable as either "waiting" or "needs work".

The engine already records what the decision needs: the record at the unit's path carries the
reviewed digest and the verdict, a section digest binds its covered task set
(`src/host/review.ts:407-424`), and a run's review step carries the record path and digest
(`src/host/review.ts:1411-1416`). The missing piece is that no dispatch path reads it, so the
restart decision cannot tell "nothing left to review at this snapshot" from "not reviewed yet".

## What Changes

- **A verdict settles its review unit at the digest it reviewed.** The publishing run records the
  verdict on its review step (as today) and the engine stops dispatching another reviewer for that
  unit while the unit's reviewed digest and coverage still equal the settled verdict's. For a
  whole-scope unit that digest is the live prepared digest; for a task or section unit it is the
  digest that run recorded — including a fallback record when snapshot creation failed — and a
  later write does not invalidate it, preserving the existing `Task-scoped review` rule. The
  suppression applies to every automatic path: the close advance, the due-unit dispatch, and the
  review triggers.
- **A restart needs changed whole-scope scope, changed coverage or task text, or an explicit
  request.** A fresh round becomes eligible only when a whole-scope unit's live digest differs from
  the settled verdict's digest, the unit's covered task set or task text changed, or a user or model
  calls `workflows start` for that unit. A historical task or section `PASS` is not invalidated by a
  later write. An attempt that ended without a verdict (interrupted by a host restart, cancelled, or
  a start failure) is not settled, so its unit keeps the existing recovery behavior.
- **A settled non-`PASS` verdict surfaces instead of restarting.** A `FINDINGS` or terminal `ERROR`
  at the unit's current digest keeps the unit due and the close refused, and the refusal names the
  verdict, its digest, the record path, and the two remedies: fix the findings so the reviewed
  digest moves, or explicitly start a fresh round. A matching-digest `PASS` is never re-reviewed.
- **A blocked run is not live coverage.** Only a run the executor holds, an in-flight admission, or
  a run waiting on a live covering review makes the waiting close; a run that merely has a pending
  review step no longer counts as "waiting on a review that will never come".
- **A section `PASS` is reused through its covered approvals.** The explicit-start reuse check
  validates the portable approval of every task the record covers, so a section `PASS` whose
  approvals are on disk settles instead of re-reviewing the same snapshot forever.
- No new run status, step status, record field, store, or configuration option; no client UI change;
  the `fix-review-run-liveness` liveness rules stay as decided (liveness is the live executor, a
  `PASS` is current only for its digest, an interrupted review run is superseded by the next fresh
  round).

## Capabilities

### New Capabilities

None. The behavior belongs to the existing `workflows` capability.

### Modified Capabilities

- `workflows`: a new review-round settlement requirement, plus `Review verdict contract` (the reuse
  policy covers `FINDINGS` and a terminal `ERROR` at the current digest), `Waiting close for a live
  review` (a settled unit refuses and surfaces instead of starting the next round), and
  `Turn-close gate` (the close never restarts a unit settled at its current digest).

## Impact

- `packages/plugin-workflows/src/host/review.ts` — the settled-round read and the step settlement
  from a stored verdict.
- `packages/plugin-workflows/src/host/index.ts` — the review executor, the trigger start path, the
  due-unit dispatch, the close's open-run coverage, and the whole-scope close decision.
- `packages/plugin-workflows/src/host/engine-gates.ts` — the unit text and the dispatch eligibility
  for a settled unit.
- `packages/plugin-workflows/src/host/evidence.ts` — the explicit-start approval check for a section
  record.
- `packages/plugin-workflows/test/`: `host-wiring.test.ts`, `review-host.test.ts`,
  `review-scheduler.test.ts`, `recovery-completion.test.ts`, `recovery-integration.test.ts`,
  `review-restart.test.ts`, `review-status.test.ts` regressions for each case.
- `docs/workflows.md`; the vendored copy and the built `lib/**` through `pnpm build`/`pnpm gen`.
- No dependency, configuration, record-schema, approval-schema, or client change. The live profile
  keeps its current behavior until a release is installed.
