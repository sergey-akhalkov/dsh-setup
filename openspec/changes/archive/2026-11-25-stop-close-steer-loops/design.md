# Design

## Context

A turn close is held only by `agent.steer`: the `agent/turn-stopping` event is serial and has no
veto, so a refused close is an inbox message and every submitted message starts another model step.
The listener already bounds its review-refusal sites with one per-session, per-turn delivery counter
(`reviewDeliveryFor` in `gates.ts`, spent by `evaluateReviewClose` and the settled-verdict,
dispatch-failure, and review-start sites in `index.ts`). The engine-owned work-progress and
lane-assignment refusals are computed by `ownedGateRefusal` (`index.ts`, steered by the same
listener) and spend nothing: they hold the turn on every close.

`evaluateOwnedProgressGate` (`engine-gates.ts`) gathers the evidence: a code-changing turn is
allowed by a newly checked task with a task-review `PASS`, or by a progress note whose worktree
digest equals the current one. Its refusal text offers both remedies unconditionally and prints
`(unavailable)` as the digest whenever no note exists, because the digest is computed only inside
the note branch. `notes.ts` already accepts a note on a checked task (the spec requires it), and the
`note` action resolves a task by its 16-character id.

See `proposal.md` for the recorded session and the symptom.

## Goals / Non-Goals

**Goals:**

- One per-turn refusal budget over the close-refusal sites that have no terminal outcome of their
  own, so an unchanged state cannot hold a turn more than `maxBlocks` times. The checkpoint and
  run-step obligations keep their own bounded `VIOLATION` rule, so every close obligation is bounded.
- An engine-owned refusal whose remedy is executable in the observed state, and a refusal text that
  reports that state instead of a placeholder digest.
- Tests that pin the invariant (bounded steers, shared budget, the independent budgets) rather than
  one scenario.

**Non-Goals:**

- Releasing, settling, approving, or unblocking anything at the bound.
- Replacing the checkpoint and run-step `turnBlocks` → `VIOLATION` budgets with the shared counter:
  those two obligations already have a terminal outcome of their own and keep it.
- Changing the review refusal semantics, the verification obligation, or the parity report.
- Changing the digest scope (worktree-wide), the note store format, or the `note` action's contract.
- Accepting a whole-scope review `PASS` as progress evidence (issue #18's first suggestion).

## Decisions

### D1: one shared delivery budget, reused, not a second counter

The turn-close listener already holds `reviewRefusals: Map<session, { turn, cap, used }>` and builds
every review site's view with `reviewDelivery(maxBlocks)`. The owned-gate branch uses the same view:

- `remaining() > 0` → submit the owned refusal, `spend()`, `refusedThisClose = true`;
- `remaining() <= 0` → submit nothing, do not set `refusedThisClose`, let the listener finish.

The cap belongs to the first site that spends (existing `reviewDeliveryFor` behavior), so the total
submitted close refusals in one turn never exceed `maxBlocks`, whatever mix of sites refuses. A new
turn number starts from zero.

The owned gate has no run to carry a `turnBlocks` counter, and a per-gate counter would reproduce
the defect: each family bounded alone still lets the sum grow. Alternative rejected: a second
counter for the owned gates only.

The shared budget covers exactly the refusals that otherwise have no terminal outcome: the review
refusals, the settled verdicts, the failed dispatch, the parity-report check, and the owned progress
and lane gates. The checkpoint freshness refusal and a run's non-review step refusal keep their own
per-turn `turnBlocks` budget and their own marked close (`evaluateTurnClose` and the listener's
checkpoint branch), because those already end in a visible `VIOLATION`. The contract therefore has
two bounded forms and no unbounded one; a mixed-obligation test pins that a checkpoint or run-step
obligation still applies its own budget after the shared bound.

### D2: at the bound the turn ends and the state stays

The owned branch is the listener's last obligation before `refreshPromptRuns`. Submitting nothing
and not setting `refusedThisClose` is enough for the turn to end. Nothing is written for the silent
attempt: no run to settle, no note, no `VIOLATION`.

The obligation is per turn: `codeChangedThisTurn` filters observations by the current turn number,
and the listener captures an implementation baseline at turn start, so a later turn that changes no
implementation file is allowed by the progress gate. That is deliberate — carrying the uncovered
write into every later turn would refuse each of them and reproduce the repeated-answer cycle this
change removes. The allowance approves nothing: the digest-bound whole-scope review records still
block the archive, and a later turn that changes code again refuses under its own fresh budget.

No separate user-facing notice is added: the last refusal, with its remedy, is already in the
transcript, and the owned gate is rendered as a read-only contract card in the Workflows view
(`docs/workflows.md`).

### D3: the refusal is derived from the plan and note state

`evaluateOwnedProgressGate` builds the text from the same evidence it already reads:

- an unchecked task exists → today's tick plus task-review remedy, with the ready-to-paste start
  call;
- every task is checked → the `note` remedy only, naming a checked task by its 16-character id
  (`workflows { action: "note", change: "X", task: "<id>", status: "in-progress", reason: "..." }`),
  because there is no task left to tick;
- no note exists → say `no progress note for this change`; the worktree digest is not mentioned;
- a note exists and the digest cannot be read → say the digest could not be read and name the git
  state as the cause;
- a note exists and the digest differs → keep today's stale-note sentence naming both digests.

The digest is still computed only when a note exists (no extra git call on the common refusing
path). The text stays one line: one cause, one remedy.

Alternative rejected: fail open when the digest cannot be read. It would close a code-changing turn
without evidence; the bound already protects against an unfixable git state, so the gate keeps its
strictness and names the cause.

### D4: the tests assert the invariant

- `host-wiring.test.ts`: drive `N > maxBlocks` consecutive turn-stopping events with an unchanged,
  refusing state and assert exactly `maxBlocks` steers, a final close with no steer, and no release.
- `host-wiring.test.ts`: a review refusal spends the budget, so an owned refusal in the same turn
  submits nothing.
- `host-wiring.test.ts`: after the shared bound is exhausted, an open checkpoint or run-step
  obligation still applies its own budget and its own `VIOLATION` close.
- `host-wiring.test.ts`: a turn that changes no implementation file is not refused by the progress
  gate, and a later turn that changes code again refuses under a fresh budget.
- `owned-gates.test.ts`: the three refusal texts (unchecked task, all-checked plan with a task id,
  missing note without a digest claim) and the unreadable-digest sentence.

### D5: the cap and the existing budgets

The owned branch reads `definitions.find((entry) => entry.id === 'task-review')?.settings.maxBlocks ?? 3`,
the same fallback the checkpoint branch already uses for a definition without the setting. No new
configuration field.

## Risks / Trade-offs

- A code-changing turn can end after the bound without a tick or a note → the close proves nothing:
  no `PASS` and no `VIOLATION` are recorded for the owned gates. A later turn that writes nothing is
  allowed by the progress gate, so the uncovered write is caught only by the digest-bound whole-scope
  review records and the archive gate; a later turn that writes again refuses under its own budget.
- An owned refusal can consume the review budget → both are close refusals and the first delivered
  message names its remedy; a held review run is not released by the owned refusal.
- The `note` task lookup stays exact-text or id → the steer now always prints the id, so the model
  does not have to reconstruct a task line.
- The worktree-wide digest still stales notes and whole-scope `PASS` records when another session
  writes the same checkout → not fixed here; the bound stops the resulting state from holding a turn
  forever, and the digest scope needs its own change.

## Open Questions

- Whether an uncovered code write should survive the turn boundary as a pending obligation until
  valid evidence clears it. Deferred: it would need persisted per-worktree state, and re-refusing
  every later turn is exactly the repeated-answer cycle this change removes; today the digest-bound
  whole-scope review records and the archive gate carry the consequence.
- Whether a settled whole-scope review `PASS` at the current digest should satisfy the progress gate
  (issue #18's first suggestion). It changes the gate's evidence contract and needs a parity case;
  it can be decided after this change without altering its specs.
- Whether the progress note and the whole-scope review records should bind to a per-change digest
  instead of the whole worktree. Separate design.
