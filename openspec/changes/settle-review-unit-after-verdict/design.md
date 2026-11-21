# Design

## Context

See [proposal.md](proposal.md) for the motivation and the issue. The behavior lives in
`@dsh-setup/plugin-workflows`: the review executor inside the turn-close advance
(`src/host/index.ts`), the step walk (`src/host/intake.ts`), the review scheduler
(`src/host/review-scheduler.ts`), the record store and reconsideration logic (`src/host/review.ts`),
the gate read model (`src/host/engine-gates.ts`, `src/host/evidence.ts`), and the shipped review
definitions and their triggers (`assets/definitions/*.json`).

```text
turn close (agent/turn-stopping)
      |
      +-- dispatch due task units .............. engine-gates.reviewUnits: no local PASS -> start
      +-- advance every open run .............. intake review branch -> review executor
      |                                            live checks only -> enqueue reviewer
      +-- gate: reviewCloseStatus ............. due units vs live/waiting runs
      |                                            whole scope: settled non-PASS -> "next round"

turn.stopping triggers (spec-review, integration-review, task-review fs.change)
      |  condition asks only "no current PASS" -> start a run per turn
      v
  advance -> review executor -> a new reviewer child for the same unit and digest
```

The defect is the missing input, not a missing state. Every decision above knows the record path and
the digest of the last verdict (the review step's evidence carries both, see
`src/host/review.ts:1411-1416`), and the record at the unit's path carries the verdict, the reviewed
digest, and for a section the covered `taskIds` (`src/host/review.ts:1253-1305`). Nothing reads it to
decide "this round is already settled". The paths that restart:

- **Intake re-dispatch.** `advanceIntake` calls the review executor for any review step that is not
  `done` (`src/host/intake.ts:447-505`); a `FINDINGS` step is `blocked` (`review.ts:1406-1416`), a
  failed review step is reopened once per advance (`intake.ts:271-275`), so each close starts a
  reviewer at the same digest.
- **Live-only admission.** The executor returns early only for a live run of the same unit or digest
  (`src/host/index.ts:3830-3893`); a settled predecessor holds no live entry, so a fresh reviewer is
  admitted (`index.ts:4274-4294`, `review-scheduler.ts:918-1021`).
- **Trigger per turn.** The whole-scope triggers fire once per turn from a condition that only asks
  whether a current `PASS` exists (`assets/definitions/spec-review.json:12-23`,
  `integration-review.json:12-15`), so a `FINDINGS` or `ERROR` starts a new run — and a new reviewer —
  on every turn.
- **Due-unit dispatch.** `reviewUnits` treats a checked task without a local `PASS` as due
  (`src/host/engine-gates.ts:280-329`), and `dispatchDueUnits` starts every uncovered unit
  (`index.ts:5286-5378`), so a settled `FINDINGS` lane starts again on each close.
- **Silent coverage.** The close's open-run list counts any pending run of the session
  (`index.ts:664-700`, `index.ts:5547-5552`), so a blocked `FINDINGS` run makes the close a silent
  waiting close although no executor holds it, and the findings never reach the agent.
- **Cancel is not a verdict.** A cancelled run leaves no record, so the whole-scope condition still
  asks for a review, the trigger's dedupe is per turn (`assets/definitions/spec-review.json:11`), and
  `forgetSettledTriggerKey` drops the cancelled run's key so the same turn may start again
  (`src/host/triggers.ts:758-765`). Cancelling one run therefore stops that run, not its unit's
  round, and a new `spec-review` run appears on the next one.

The recorded evidence for the second symptom is in the repository's own run store: a section run
whose review step is `blocked` with `an explicit task review start needs the matching portable
approval` although its own section `PASS` wrote one approval per covered task. The explicit-start
reuse check validates the approval keyed by the record's `taskId`, which for a section is the
synthetic section id (`src/host/evidence.ts:822-853`), while publication writes approvals per covered
task (`review.ts:2087-2125`) and recovery already validates the covered set
(`index.ts:1420-1449`). The unit therefore never settles and every close re-reviews the same
snapshot.

## Goals / Non-Goals

**Goals:**

- Make a verdict the end of its round: no automatic second reviewer for a unit whose current digest
  and coverage the verdict already covered.
- Make the restart condition readable and singular: a changed reviewed digest, a changed covered task
  set, or an explicit `workflows start`.
- Surface a settled non-`PASS` verdict once instead of re-reviewing it, and stop a pending run
  without an executor from making the waiting close.
- Keep the `fix-review-run-liveness` decisions: liveness is the live executor, a `PASS` is current
  only for its digest, and an interrupted review run is superseded by the next fresh round.
- Keep the `review-until-pass` decision: no content-round cap, every due unit starts in one pass,
  and only a current `PASS` ends a unit.

**Non-Goals:**

- No new run status, step state, record field, approval field, store, or configuration option.
- No persisted "unit verdict" index or durable review queue; the run step and the record already
  carry the facts.
- No time-based expiry of a settled verdict: a snapshot stays settled until its inputs move.
- No new `status` liveness token and no client change: a settled run is reported by the existing
  `orphaned` token, and its step reason names the verdict.
- No change to the review prompt, the reviewer thread contract, the finding rubric, or the focused
  re-review.
- No change to the committed `reviews/<taskId>.json` format, the local record layout, or the audit.

## Decisions

**D1 — The settled round is a read model over what the engine already writes, compared per
scope.** A round is settled when the unit's record file at its path holds a well-formed verdict. For
a whole-scope unit the verdict is current only when its `digest` equals the digest the unit would
prepare now. For a task or section unit the verdict settles the run that published it: its `digest`
equals the digest that run recorded for the round — the snapshot input-tree digest, or the fallback
`worktreeDigest` when snapshot creation failed — and, for a section, its `taskIds` equal the run's
covered set. Task and section records stay historical under the existing `Task-scoped review`
requirement: a later write does not invalidate them, and the optional integration review covers the
current worktree. No new file is written: the record is the verdict, and the review step's evidence
already names the same path and digest. Rejected: a persisted verdict-on-unit flag (a second source
of truth that drifts from the record and needs its own authentication and cleanup); a durable review
queue keyed by identity (the queue is in-memory by design because a reviewer needs a live parent
agent, and persisting it does not answer "is this snapshot already reviewed"); a time-based expiry (a
clock rule that would restart a review the user asked to stop, and would still restart at an
unchanged digest while the clock ran).

**D2 — The comparison is per scope, using the digest publication actually recorded.** For a
whole-scope unit the comparison recomputes the live prepared digest — `currentSpecDigest` plus
`reviewInputTree` for a worktree-bound unit, the artifact digest for a spec unit — with the same
functions `prepareInputs` uses (`index.ts:3949-4175`).The reviewed tree of a record is a git tree
hash of the reviewed input set (`review-snapshot.ts:440-507`, snapshot commit at
`review-snapshot.ts:630-667`), while `worktreeDigest` is a different hash of `HEAD` plus the working
diff (`git.ts:207-245`); comparing them would never match. For a task or section unit the comparison
uses the digest the run recorded for its round: the snapshot input-tree digest when the snapshot
succeeded, and the fallback `worktreeDigest` when creation failed (`index.ts:4049`, `:4136-4169`),
so a fallback `FINDINGS` or `PASS` settles its run instead of looping. Rejected: comparing
`record.reviewedTree` with the live worktree digest (different hash); trusting the record's
`worktreeDigest` for a snapshot review (same problem); revalidating a historical task `PASS` against
the live worktree (contradicts `Task-scoped review`); skipping the check for task scope (the issue's
paid loop lives there).

**D3 — One predicate, four enforcement points.** A single host-level lookup returns the settled
verdict for a unit (verdict, digest, record path, covered ids), and it is consulted where a reviewer
could start or a close could restart:

1. the review executor, before a snapshot is prepared or a reviewer is admitted, except while an
   explicit start has not yet published a verdict for its requested round;
2. the automatic start path: the event router before trigger evaluation for whole-scope review
   definitions, and `dispatchDueUnits` for task units;
3. the close's open-run coverage, so only a live run or a run waiting on a live covering review
   counts;
4. the close's surface text for a settled unit.

The start callback inside `evaluateDefinitions` is synchronous, so (2) gathers the facts before the
call and suppresses the definition (or the unit) for that event, recording a `run-suppressed` row
with the verdict, digest, and remedies. The facts are gathered only for review definitions whose
event kind and filters already match, so an ordinary tool call pays no git work. Rejected:
suppressing only in the shipped `condition` data (a local or contributed review definition would
still loop, `integration-review` has no record field to test, and `dispatchDueUnits` is not
condition-driven); making `evaluateDefinitions` async (a signature and test refactor that buys
nothing once the facts are gathered per event).

**D4 — A settled unit refuses; it does not silently wait.** For a settled `FINDINGS` or terminal
`ERROR` the close is refused with the verdict, digest, record path, and the two remedies: fix the
findings so the reviewed digest moves, or start a fresh round explicitly. The run that published the
verdict stays at its step state and is not re-advanced into a reviewer; the executor settles an open
step from the stored verdict only when the step does not already carry it, so a repeated close writes
nothing. The close evaluates the settled verdict for the session's involved changes even when this
session owns no review run for the unit: a foreign session's settled non-`PASS` is still a due unit
and refuses with the same diagnostic. Suppressing a start must never be the only surface, because the
close would then have no local run to inspect. Rejected: a silent waiting close (indistinguishable
from a live review and the reason the current state is unreadable); cancelling the run (loses the
verdict history and makes `resume` the only recovery); a VIOLATION (the close is refused, not
bypassed).

**D5 — Restart eligibility is per scope: a changed whole-scope digest, changed coverage or task
text, or an explicit start.** A whole-scope unit starts a fresh round when its live digest differs
from the settled verdict's. A task or section unit does not restart because the worktree changed
later: its record is historical under `Task-scoped review`, and it restarts when a newly checked
task changes the section's coverage, when the task's text (and therefore its record key) changes, or
when an explicit start requests it. `context.explicitReview` requests one round, not a permanent
exemption: once the run holds a verdict, later automatic advances settle from the record like any
other run. A run interrupted by a host restart, a cancelled run, and a failed start carry no
verdict, so they are not settled: the `fix-review-run-liveness` rules keep governing them and the
next close starts one fresh round, superseding the interrupted predecessor. Rejected: a "seen
digest" memory in the run store (a fourth copy of the same fact); treating a verdict-less attempt as
settled (a restart after a crash would strand the unit with no way to review it except a manual
start); letting a cancel settle the unit permanently (a user cancel is not a verdict).

**D6 — The explicit-start reuse check validates the covered approvals.** For a section record the
check verifies the portable approval of every covered checked task — the same rule recovery already
applies (`index.ts:1420-1449`) — and never an approval keyed by the synthetic section record id. A
`PASS` whose covered approvals all match settles the step; a `PASS` with a missing or mismatched
approval keeps the current behavior and blocks the step, and only an explicit start may re-review it.
Rejected: publishing an approval keyed by the section id (a new approval kind in the committed audit
for a synthetic id); dropping the approval check (it is what keeps a stale approval marker from
passing as a review).

**D7 — No record is written or deleted by the settlement.** The settlement reads the record and
settles a step; it never publishes, re-publishes, or removes a record or approval. A record that no
longer matches its contract is surfaced, not rewritten; recovering it is the explicit round's job.

**D8 — The stored-PASS shortcuts keep their historical rule; the settlement is run-scoped.**
`taskReviewPass` and `reviewUnits` (`src/host/engine-gates.ts:160-329`) and the accepted-`PASS`
shortcut in the step walk (`src/host/intake.ts:454-457`) keep accepting a stored task or section
`PASS` as historical coverage under `Task-scoped review`: a later write does not invalidate it. The
new settlement closes the loop at the run that already published a verdict, not by revalidating that
`PASS` against the live worktree. A whole-scope record alone is revalidated against the live digest
(the existing stale-record rule). Rejected: rejecting a task `PASS` after any later write (it would
contradict `Task-scoped review` and require rewriting that requirement); checking only in the
executor (the blocked run would still be re-advanced by the step walk).

## Risks / Trade-offs

- [Agent-only loop] A settled `FINDINGS` keeps the close refused, so the agent sees the refusal at
  every close until it fixes the findings, explicitly starts a round, or stops. There is no reviewer
  child and no session wake, so the cost is agent steps rather than paid reviews; the goal-continuity
  rules and the user's stop own that loop. Accepted because the alternative is the reported paid
  re-review.
- [Digest cost] The settlement computes the prepared-equivalent digest (`currentSpecDigest` plus one
  `reviewInputTree`) per unit per close where a review step is being advanced or a review trigger
  matched. Ordinary tool calls pay nothing because the facts are gathered only for matching review
  triggers; a close with several units reuses one computation per unit.
- [Snapshot vs live tree] The comparison relies on the snapshot and `reviewInputTree` hashing the
  same input set. Both call the same `writeInputTree` with the same excludes, and the change
  directory is hashed by the same `specDigest`; a future change to either set must keep them
  identical or the settlement would restart a review it should reuse.
- [Explicit start] An explicit start bypasses the settlement for exactly one round; once that
  round's verdict exists the normal settlement applies, so repeated automatic closes cannot reuse
  the flag. A model that repeatedly starts the same unit can still pay for repeated reviews; the
  status still reports the settled run, and `start` keeps its live-coverage reuse and refusal rules.
- [Foreign verdicts] A verdict published by another session settles the unit host-wide; a session
  that wanted a fresh look must ask explicitly. That matches the existing cross-session liveness and
  duplicate-admission rules.
- [Local definitions] A local review definition that omits `settings.gate: 'review'` is not treated as
  a review definition elsewhere either; the settlement suppression follows `settings.gate`, so such a
  definition keeps its current behavior and is out of scope.
- [Test surface] The behavior is host-level and timing-sensitive; the regressions lean on the existing
  fake host and reviewer stub in `test/host-wiring.test.ts` plus the record fixtures in
  `test/review-host.test.ts`.

## Migration Plan

- Source change only; no data migration. Existing runs, records, approvals, and receipts stay valid.
- A run already blocked on a settled `FINDINGS` from an earlier version is recognized by the same
  settlement on its next close and stops starting reviewers; it is not rewritten or cancelled.
- A run blocked by the section-approval mismatch settles on its next close from the record it already
  published; no new review and no record rewrite.
- The live desktop profile keeps its behavior until a release is installed; no agent session installs
  into it. Release through the repository process (version bump, `pnpm build`, `pnpm gen`, the full
  gate, tag, push).
- Rollback is a version downgrade; no persisted state is rewritten, so the previous build reads the
  same records and runs.

## Test Plan

- `host-wiring.test.ts`:
  - a whole-scope `FINDINGS` at the current digest refuses the close, names the verdict and the
    explicit start, and starts no reviewer on the next close;
  - a `PASS` at the current digest settles without a reviewer, including a section record whose
    covered approvals match;
  - a changed whole-scope worktree digest and a newly checked task in a section each start exactly
    one round, while a task `PASS` followed by a later task's write stays historical coverage and
    starts no round;
  - a fallback record (snapshot creation forced to fail) settles its run: an unchanged `FINDINGS`
    and a `PASS` each start no reviewer on the next close;
  - an explicit start that publishes `FINDINGS` starts no reviewer on the following automatic
    closes;
  - a foreign settled `FINDINGS` with no local review run refuses the close and starts no reviewer;
  - an interrupted review run is superseded and exactly one fresh round starts;
  - an explicit `workflows start` for a settled unit starts one reviewer;
  - a blocked run whose executor is gone no longer makes the waiting close;
  - a foreign session's settled verdict suppresses the round.
- `review-host.test.ts`: the executor settles an open step from the stored verdict without enqueueing;
  the section reuse check accepts covered approvals and rejects a missing one.
- `review-scheduler.test.ts` / `review-queue.test.ts`: the settlement is checked before admission;
  a settled unit never reaches `enqueue`.
- `recovery-completion.test.ts` / `recovery-integration.test.ts` / `review-restart.test.ts`: an
  interrupted attempt is not a settled round; the supersede write is unchanged and no record is
  synthesized.
- `review-status.test.ts`: a settled run reports `orphaned` with the verdict in its step reason, and
  no new token appears.
- Gate: `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `pnpm build` with no uncommitted
  generated diff; `openspec validate settle-review-unit-after-verdict --strict`.
