# Proposal

## Why

The turn-close review gate keeps the close unapproved whenever a due review unit has no live review,
which is correct, but it steers the whole ~700-character refusal text into the agent on **every**
close attempt. In the recorded session `session-ea02b074` that produced 98 identical gate messages in
one turn; the model's reasoning degenerated into a repeated line ("The gate repeats…"), the loop guard
cut the turn, and the repeated closing message the user saw is that cascade. The obligations (no
approval without a PASS, completion and the archive blocked) must stay; the repeated delivery and the
unbounded hold must not.

## What Changes

- The review obligation keeps every obligation: no pass, no `VIOLATION`, the run stays open, and
  completion and the archive stay blocked.
- The engine SHALL steer the review refusal at most `maxBlocks` times per turn; the bound covers every
  review-refusal steer site — the review-close branch, the settled-verdict branch, and the
  review-start failure branch — and reuses the existing `settings.maxBlocks` with no new configuration
  field.
- After the bound the refusal no longer holds the turn: the listener records the run as unresolved,
  submits no message, and **continues evaluating unrelated obligations**, so a pending verification,
  checkpoint, or completion obligation still applies its own refusal and `VIOLATION` rules. When none
  of them holds, the turn may end with the review run open.
- Ending the turn after the bound MUST NOT release, settle, cancel, or close the review run, approve
  a unit, or unblock completion or the archive; the next turn evaluates the run again and delivers
  its own bounded refusal.
- The first refusal of every turn is unchanged, so the model still receives the named remedy (the
  affected units, the verdict or record, and the `workflows` start call).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: the "Turn-close gate" requirement gains the hold/unresolved outcome split, the per-turn
  delivery bound over every review-refusal steer site, and the rule that an unrelated obligation
  still applies after the bound. "Waiting close for a live review", "Settled verdict surfacing", and
  "Owned completion coverage" are restated so a bounded ending leaves the unit due and completion
  blocked instead of promising an unbounded hold.

## Impact

- `packages/plugin-workflows/src/host/gates.ts` (`TurnCloseOutcome`, `evaluateReviewClose`).
- `packages/plugin-workflows/src/host/index.ts` (turn-stopping loop: `hold: false` handling, the shared
  per-turn review delivery counter, and the settled-verdict steer site).
- `packages/plugin-workflows/test/gates.test.ts` and the host wiring tests.
- `docs/workflows.md` and `docs/plugins.md` where the review close behaviour is described.
- No DSH API, configuration schema, stored-run format, or public tool shape changes; runs written
  before this change load unchanged.
