# Design

## Context

The turn-close gate runs on `agent/turn-stopping`, a serial host event with no veto: a listener holds
the turn only by submitting an inbox message (`agent.steer`). The gate says so itself at
`gates.ts:306-308` ("a returned outcome alone does not hold a turn open"). The listener evaluates
runs in order and, on any non-`allow` outcome, sets `refusedThisClose`, keeps the owner, and breaks;
the later obligations (settled verdicts, dispatch failure, checkpoint freshness, completion coverage)
run only while `refusedThisClose` is false (`index.ts:6249`, `6345`, `6354`, `6423`).

The non-review path already bounds the hold with `run.turnBlocks` / `turnBlocksTurn` and
`definition.settings.maxBlocks`. The owned-review path deliberately bypasses the release budget — no
pass before a PASS — but also bypasses the delivery bound, so it steers the whole ~700-character
refusal on every attempt.

Evidence (session `session-ea02b074`, turn 6): 98 `workflows-gate` messages, 26 assistant messages
with the same closing text, the model's reasoning then repeating "The gate repeats…", the loop guard
cutting the turn.

## Goals / Non-Goals

**Goals:**

- Keep the obligations: while a due review unit has no live review, no pass, no `VIOLATION`, the run
  stays open, and completion and the archive stay blocked.
- Bound how long the review obligation holds the turn, reusing `maxBlocks` and no new configuration.
- Keep unrelated obligations evaluated: an exhausted review bound must not swallow a verification,
  checkpoint, or completion hold.

**Non-Goals:**

- Releasing the review close after a budget.
- Adding a turn-stop veto to DSH (the serial event has none; that is a core change).
- Bounding the non-review obligations; they keep their own budgets.
- Changing the loop guard or goal continuity (the second change covers the goal side).

## Decisions

### D1: the outcome distinguishes hold from unresolved

`TurnCloseOutcome`'s `refuse` gains `hold: boolean`:

- the review branch returns `refuse` with `hold: true` while it submits a steer;
- at or above the per-turn delivery bound it returns `refuse` with `hold: false` and submits nothing.

The caller (`index.ts`, the `agent/turn-stopping` listener) changes to:

- `hold: true` and every other non-`allow` outcome: today's path (`refusedThisClose = true`, keep the
  owner, break);
- `refuse` with `hold: false`: keep the run's owner so it stays open, do not set
  `refusedThisClose`, and continue with the remaining runs and the post-loop obligations, so a
  pending verification, checkpoint, or completion obligation still applies its own refusal and
  `VIOLATION` rules.

When no other obligation holds, the turn ends with the review run open and unresolved. That is not a
release: no pass, no `VIOLATION`, and the next turn evaluates the run again with its own bounded
delivery.

### D2: one per-turn delivery budget for every review refusal

Every review-refusal steer site shares one per-turn delivery budget:

- `evaluateReviewClose`: the uncovered-units branch and its owned-text branch;
- the owned-review fallback in `evaluateTurnClose` (`gates.ts:344-356`), reached when the review
  status is unavailable (`input.review === undefined`), both the failed-dispatch and the open-step
  case — this path steers today without any bound;
- the settled-verdict steer loop (`index.ts:6249-6341`);
- the review-start failure branch (`index.ts:6345-6349`, set by `dispatchDueUnits`).

The caller owns a per-turn counter keyed by session and turn (`Map<session, { turn, used }>` in the
listener closure) and passes a small delivery object into `evaluateTurnClose`: `remaining()` and
`spend()`. A review site steers only while `remaining() > 0` and calls `spend()` when it does; with
no budget left it returns `refuse` with `hold: false` and settles no obligation.

The review fallback must never take the `ownedRefusal` `VIOLATION` release: a review obligation stays
due until a PASS, so after exhaustion it returns `hold: false` instead of a marked close. The
start-failure branch keeps its semantics — it still records the failure and keeps the unit due, but
it sets `refusedThisClose` only when it actually steered. After the bound it records the unresolved
state and lets the post-loop obligations evaluate, so a pending verification, checkpoint, or
completion hold is not swallowed. The next turn retries under a fresh budget.

### D3: no run rewrite after the bound

The no-hold outcome returns the run unchanged: no counter increment and no store write for the
silent attempts. The per-turn counter lives in memory and resets when the turn number changes.

## Risks / Trade-offs

- A model that ignores the bounded refusals can end its turn while a review unit is due. Nothing is
  released; the run stays open, completion and the archive stay blocked, and the next turn
  re-delivers the first refusal.
- A turn can now end with a due review unit and no message; the run view and the session status still
  show it, and the next turn's first refusal names the remedy again.
- The in-memory counter is per plugin mount; a reload resets the bound, which is the same behavior as
  a new turn and cannot release anything.
