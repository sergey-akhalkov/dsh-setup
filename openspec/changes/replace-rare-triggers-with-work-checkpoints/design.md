# Design

## Context

The goal-continuity plugin already observes every tool call and the turn-close boundary for the block
review and the speed review, and its speed-review follow-through gate already steers a turn close
until evidence appears. The delegation-rules engine already has a turn-stopping gate that accepts a
worker start or a `task_progress` note as evidence, and its shipped defaults use that gate only for
OpenSpec-attributed progress and lane fan-out. The always-on working contract is at 5,997 bytes
against a 6,000-byte budget, so new clauses must be written by replacing text, not by appending.
The repository's archive gate depends on `task-review` records, so the review-record rules are not
part of this change. The live model route advertises a 1,048,576-token context window and compaction
defaults to a high threshold ratio, so a context-fill or compaction trigger would be both rare and
mistimed.

See `proposal.md` for motivation.

## Goals / Non-Goals

**Goals:**

- Require a checkpoint at every substantial root-agent pause, with a close gate that makes the
  requirement effective rather than advisory.
- Record a structured, machine-readable decision: done, verified facts, remaining work, parallel or
  serial, the next action, and an optional speedup.
- Require a tagged worker start before the close when the checkpoint declares parallel remaining
  work, with a serial reason as the explicit escape.
- Remove the speed review and the two automatic delegation nudges, while keeping the review-approval
  pipeline and the block review.
- Measure conversion and detect ritual compliance before claiming the behavior improved.

**Non-Goals:**

- No compaction, context-percentage, or timer trigger.
- No new plugin package, bundle row, installer array, market entry, or DSH version change.
- No change to `spec-review`, `task-review`, `integration-review`, the archive gate, the
  verification gate, Hindsight, or loop guard.
- No automatic team, role, or subagent requirement for sequential work.

## Decisions

### 1. Deliver the checkpoint from the existing goal-continuity bundle

The plugin already owns the turn-close listener, tool-result observation, per-turn state, local
records, and the row that ships enabled. The checkpoint reuses that machinery and the speed review's
freed budget. The `work-checkpoints` capability is a separate spec, so the behavior contract stays
clean even though the code lives in the goal-continuity package.

Alternative: a new `plugin-work-checkpoints`. It gives a cleaner package boundary but adds a bundle
row, installer arrays, the vendored setup tree, a market entry, installer/composition tests, and
documentation, with no behavioral gain. A future split remains possible if the gate grows.

### 2. Trigger at `agent/turn-stopping`, not at compaction or a context percentage

The pause is the decision point: the turn has produced work and is about to yield. The event is
deterministic, the plugin already observes the turn's tool results, and a steer keeps the turn open
for one checkpoint step. Compaction is an information-loss boundary reached late and rarely with the
1M window; a window percentage makes the cadence depend on the routed model, not on the work.

Alternative: a `compaction/end` listener or a token-meter threshold. Both produce advice without a
work unit and fire at the wrong moment. Rejected.

### 3. One `work_checkpoint` tool, not a free-form reflection and not a review child

A structured tool call is a machine-checkable artifact, so the close gate can require it and the
record is useful to the next turn and the user. The main agent has the context; an independent child
would duplicate it and cost a model call. The checkpoint is self-review, not independent review; the
block review remains the independent check for blockers.

Alternatives: a notice-only reflection (skippable, no artifact), a reviewer child (cost and an extra
context, not what the owner asked for), or a `task_progress` note (OpenSpec-specific). Rejected.

### 4. Gate on the artifact, then on the parallel action

The owner asked for 100% firing. A steer alone only asks; the gate refuses the close until the
checkpoint call exists, bounded by `maxBlocks`, and after the cap allows the close with an UNCHECKED
notice. When the checkpoint declares parallel remaining work, the close also requires a worker start
whose arguments contain the checkpoint id, or an amendment that sets parallel to false with a serial
reason. The parallel gate re-steers on each unsatisfied close under the same `maxBlocks`/UNCHECKED
budget; a failed worker start does not satisfy it. This is the strong form of "think about
parallelization at every pause"; the serial escape keeps a genuinely sequential remainder possible.

Alternative: start with a notice and measure. Rejected by the owner's explicit choice of a hard
trigger; the measurement still decides whether the parallel gate stays.

### 5. The serial escape lives in the checkpoint, not in a separate note tool

Reusing the checkpoint result avoids a new tool and any OpenSpec dependency. A serial reason is the
only alternative to a worker start, so the anti-ritual measurement is the serial rate: if almost
every checkpoint declares serial, the gate is not changing behavior.

Alternative: a generic `task_progress`-like note. It adds a tool and a second artifact without
making the decision more precise.

### 6. Goal rounds use the same turn-close path

A goal round ends with a turn close; the gate runs before the close, and the goal driver continues
only after the turn closes. The checkpoint is in the session log, so the next round sees it. No
separate goal-round trigger, brief, or record is added.

Alternative: the removed next-round brief pattern. It fires after the pause and is static; the
checkpoint must happen before the stop.

### 7. Remove the speed review; keep the block review and its reviewer preset

The speed review was the rare self-reflection trigger: one read-only child per expensive goal round.
The checkpoint replaces it at every substantial pause. The block review answers a different question
and stays. The shared `goal-reviewer` preset remains installed and is selected only by the block
review.

### 8. Keep the review-approval rules and the archive gate; remove only the two nudges

`spec-review`, `task-review`, and `integration-review` produce the records the archive gate and CI
require; removing them would break `openspec/review-approval.json` and `pnpm reviews:check`. The
removed items are the automatic `task-progress` and `lane-fanout` rules that duplicated the new
checkpoint. Their triggers, the `task_progress` tool, and existing-profile rules stay, matching the
repository's deprecated-trigger pattern.

### 9. Accept a legacy `speedReview` object and ignore it with a warning

The live desktop profile and market users may carry the old section. Failing plugin load would trap
them. The plugin accepts the object, warns once, and runs no speed review. The section is documented
as deprecated; a future major release may remove it.

### 10. Make the goal the work unit in the always-on contract

The owner chose goals for multi-step work. A goal gives the pause a unit and makes continuation
explicit. The contract must fit the existing 1,500 estimated-token budget by rewriting: the new goal
and checkpoint clauses replace the generic speed policy and are checked by the budget test. A
single-turn, one-line, or informational request is exempt.

Alternative: no contract change. The checkpoint fires on ordinary turns anyway, but the agent would
still stop without a unit and the user would have to say "continue". Rejected.

### 11. Data-only observability change

Add a `tool: work_checkpoint` match to the existing `goal-continuity` row in `packages/setup/defaults.yml`.
No new row kind, no new log, no dependence on the in-flight observability change; the local record
and the session log are the only stores.

### 12. State and record

The checkpoint tool writes one atomic record under `.dsh/work-checkpoints/<session-key>/<turn>.json`,
where the session key is hashed the way the delegation session ledger hashes its file name. The
record is bounded and redacted, is not a tracked file, and is reused for the same turn. The gate
keeps per-turn in-memory state; an internal error fails open and never claims a checkpoint.

## Risks / Trade-offs

- **Ritual compliance: every checkpoint declares serial.** → The measurement counts the serial rate
  and the worker-start conversion. If the serial rate stays high while no parallel work starts, tune
  the request evidence, narrow the gate to goal rounds, or drop the parallel gate.
- **Noise and latency at every substantial pause.** → `minToolCalls` (default 4), `requireWrite`
  (default true), one checkpoint per turn, the awaiting-user skip, and `maxBlocks` (default 3). Tune
  after the baseline.
- **Goal spam from the default.** → Single-turn and informational requests are exempt in the
  contract; the owner can suspend the clause for a session. The measurement counts goal creation.
- **Prompt budget overrun.** → The contract must be rewritten within 1,500 estimated tokens; the
  existing budget test fails the build if the new clauses are appended without trimming.
- **A profile with `speedReview` fails to load.** → The section is accepted and ignored with a
  warning; a test covers the legacy object.
- **Two turn-close gates steer the same turn.** → The checkpoint asks for a decision, the
  verification gate asks for a check; the messages and sources differ. The verification gate remains
  inert unless configured.
- **The goal driver and the checkpoint gate interact badly.** → The checkpoint gate steers at the
  turn close, and the goal driver continues only after the close. The task list includes a goal-round
  test before the removal is accepted.
- **The checkpoint tool adds a tool schema to every request.** → One small tool, bounded fields, and
  `checkpoint.enabled: false` removes it. The prompt cost is measured with the existing token budget
  conventions.
- **The capability lives in a goal-named package.** → The documentation names the package as the
  delivery vehicle for both capabilities; the spec is separate, and a future split is possible.
- **Removing the review-record rules would break the archive gate.** → Explicitly out of scope; the
  proposal and docs state the boundary. A different change would be needed.

## Migration Plan

1. Ship the checkpoint enabled and the speed review removed in one release. The `speedReview`
   section is accepted and ignored, so an existing profile keeps loading.
2. The owner installs the regenerated setup; the existing goal-continuity row updates in place. No
   new bundle, row id, installer array, or market entry.
3. Rollback for the behavior: set `checkpoint.enabled: false` (or disable the row) to stop the gate.
   Restoring the speed review needs a code revert; the old `retro/` records are local scratch and can
   be left in place.
4. Measure for one to two weeks with the scorecard below before deciding whether the parallel gate
   stays, the thresholds change, or the change is reverted.

## Measurement

**Baseline (before the checkpoint is enabled):** from the observability dashboard or a read-only
pass over recent session logs, count substantial pauses by the trigger definition, worker starts in
the next turn after a pause, and median steps and wall time to completion. The pre-change sample is
for the behavioral comparison only; it is not the coverage denominator.

**After:** within the same post-install window, count eligible turns by the trigger definition,
successful checkpoints per turn (deduplicating amendments), and UNCHECKED closes separately; report
the checkpointed share and the UNCHECKED count. Also report the share of checkpoints that declare
parallel work, the worker-start conversion among parallel checkpoints, the serial-reason rate,
double-steer incidents, and median steps and wall time to completion. Compare the behavioral fields
with the pre-change baseline. The checkpoint records carry the fields; no new telemetry is added.

**Initial success:** every eligible post-install turn ends with a checkpoint or a counted UNCHECKED
close, and an eligible turn with neither is a trigger miss; the checkpointed share and the UNCHECKED
count are reported; at least 30% of parallel checkpoints followed by a tagged worker start; serial
rate at most 70%; no meaningful increase in median steps against the baseline; the owner judges the
checkpoints useful.

**Failure:** conversion near zero while the serial rate is high (ritual), or the extra step visibly
delays work without decisions. Then disable the parallel gate or the checkpoint and rework. These
thresholds are initial and owner-calibrated after the baseline.

## Open Questions

- The exact `minToolCalls` default and whether `requireWrite` should stay true; both are initial
  values to calibrate from the baseline.
- The exact contract wording and which existing text it replaces; this is a task-level detail
  constrained by the budget test.
- The final success thresholds; the owner confirms them after the baseline.
