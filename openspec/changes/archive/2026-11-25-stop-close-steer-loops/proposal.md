# Proposal

## Why

A turn close is held only by steering an inbox message, and a steered message is another model
step. The engine bounded that reflex for the review refusals
(`2026-11-24-bound-review-gate-steer`) but not for the engine-owned work-progress and
lane-assignment gates, whose refusal has no per-turn budget and no terminal outcome. When a turn
changed code and the refused state had no remedy the model could execute — every task checked, no
progress note, and a steer that reports the digest as `(unavailable)` merely because no note exists
— every close produced the same refusal and the same closing answer. In session
`session-dc6ba8ad-eff8-4591-b5ef-f729194b6a69` one turn was refused 7 times, emitted 9 closing
summaries, and ended only on a user abort; the two earlier fixes each bounded a sibling branch and
left this one open.

Refs #18

## What Changes

- **One per-turn refusal budget for the turn-close sites that have no terminal outcome of their
  own.** The review refusals, the settled verdict refusals, the failed-dispatch refusal, the
  parity-report refusal, and the engine-owned work-progress and lane-assignment refusals share the
  existing per-session, per-turn delivery counter. While the budget is not reached a site steers and
  spends it; once it is reached no site steers, the turn may end, and the obligation stays due for
  the next turn. The checkpoint and run-step obligations keep their own bounded rule that allows one
  close recorded as a visible `VIOLATION`, so every close obligation is bounded and no unchanged
  state is held forever.
- **The engine-owned gates refuse only with an executable remedy.** When the plan still has an
  unchecked task the steer keeps the tick plus task-review remedy. When every task is checked it
  offers only the `note` remedy and names the checked task by its 16-character id, because there is
  no task left to tick.
- **The refusal text names the state instead of guessing.** A missing note is reported as a missing
  note, never as an unavailable digest; the worktree digest is printed when a note exists to compare
  it with, and an unreadable digest is named as the cause. The text stays one bounded line with the
  ready-to-paste call.
- The owned progress refusal obeys the shared turn-close budget, so an unsatisfiable or repeatedly
  stale state stops holding the turn after the bound instead of steering forever.
- The lane-assignment gate and the parity-report refusal reuse the same shared budget. Nothing is
  released, settled, approved, or unblocked by the bound.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: the "Turn-close gate" requirement gains the single per-turn refusal budget over the
  sites without a terminal outcome, the rule that the checkpoint and run-step obligations keep their
  own bounded rule, and the bounded ending for the engine-owned refusals; the "Owned work-progress
  gate" requirement gains the executable-remedy rule and the state-derived refusal text.

## Impact

- `packages/plugin-workflows/src/host/index.ts` (the turn-stopping listener: the owned-gate branch
  spends the shared delivery budget and stops holding the turn at the bound).
- `packages/plugin-workflows/src/host/engine-gates.ts` (`evaluateOwnedProgressGate`: the
  state-derived remedy and the honest digest text).
- `packages/plugin-workflows/test/owned-gates.test.ts` (the state-derived remedy and the truthful
  refusal text) and `packages/plugin-workflows/test/host-wiring.test.ts` (the per-turn bound and the
  shared budget).
- `openspec/specs/workflows` through the delta spec, and `docs/workflows.md` where the owned
  work-progress gate and the turn-close gate are described.
- Generated output: `pnpm build` refreshes `packages/plugin-workflows/lib/**`; `pnpm gen` refreshes
  the setup vendor tree. No configuration field, public tool shape, stored-run format, or DSH API
  changes, so a profile needs no migration.
