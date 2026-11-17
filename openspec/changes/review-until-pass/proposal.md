# Proposal

## Why

Review is the slowest and most fragile part of the workflow. The engine starts a fresh Codex
conversation on every round, releases the turn close after `maxBlocks` refusals with a visible
violation, discards a whole-scope verdict when the agent writes during the run, and serializes due
review units behind one profile-wide queue. The measured result in two sessions: `retire-delegation-rules`
spent 27 `task-review` runs on 13 tasks with four `FINDINGS` cycles on the same tasks and three runs
still blocked at the end; `add-exploratory-testing` produced five `spec-review` runs, two cancelled by
the user, and three `ERROR` records of `reviewed-inputs-changed` on the same review. The persisted
review-thread store holds 285 Codex threads, but the workflows prompt carries no review key, so every
round is a new reviewer.

The user requires one reviewer per lane that is re-asked until `PASS`, with no round cap; completed
tasks reviewed lane by lane, all lanes in parallel; and no artificial review queue where parallelism
is possible.

## What Changes

- **Lane-owned review units.** A `tasks.md` level-2 section with any checked task that lacks a current
  `PASS` is one unit covering every checked task of the section. A per-task unit remains only for a
  task outside any section or in a section the engine cannot select. The unit, not the task, is the
  review obligation.
- **One reviewer thread per unit.** The review prompt carries a stable review key derived from the
  unit (`review:<change>:section:<key>`, `:task:<id>`, or `:whole:<phase>`), and the unit's snapshot
  checkout lives at a stable path, so the Codex provider's existing review-thread reuse resumes the
  same conversation across rounds. Fixes are returned to that thread with the complete prior-finding
  inventory and the diff since the reviewed tree.
- **No round cap.** A run that reached its owned review step never releases the turn-close budget:
  `FINDINGS` and `ERROR` leave the unit due, and the next close starts the next round on the same
  thread. Only a current `PASS` ends the obligation. While a review is live, the close is the waiting
  close (no `VIOLATION`); it ends the turn so the asynchronous verdict can be delivered, and the next
  turn resumes the loop.
- **Maximum parallelism.** Review admission is immediate: the queue stops enforcing concurrency and
  waiting-list limits, review starts are exempt from the generic open-run limit, and the gate starts
  every due unit in one pass. The only serialization left is the shared reviewer thread of one unit,
  which is a real provider constraint, not a queue.
- **Whole-scope reviews on a snapshot; a reviewed spec stays reviewed.** `spec-review` and
  `integration-review` use a frozen snapshot. A spec review binds only the change artifacts it read
  (`tasks.md` checkbox state normalized), so parallel worktree work, task ticks, and task approvals
  never invalidate its `PASS`; only an edit to the reviewed plan artifacts does. An integration review
  remains the final worktree check and binds the worktree digest captured at snapshot time. A write
  during either run no longer discards the verdict as an `ERROR`.
- **Required integration review.** `integration-review` loses `nonCritical` and the soft settlement
  and iterates until `PASS` like the other reviews. The legacy soft rule is retired from the parity
  report as a declared, documented difference.
- **Transport limits stay.** The review timeout, transient start retries, and provider failures still
  settle an `ERROR` and never approve. They bound one attempt, not the number of content rounds.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflows`: lane-owned review units and reviewer continuity; uncapped review gates and the waiting
  close; immediate parallel admission with no artificial queue; whole-scope snapshots and focused
  whole-scope re-review; required integration review and its archive requirement; retired parity
  scenario.
- `codex-subagent`: the review key the provider parses now includes the engine's stable unit key,
  including a section key, while thread reuse and confinement are unchanged.

## Impact

- `packages/plugin-workflows/src/host/{review,review-scheduler,review-queue,review-snapshot,engine-gates,gates,index,definitions}.ts`
- `packages/plugin-workflows/assets/definitions/{spec-review,task-review,integration-review}.json`
- `packages/plugin-workflows/assets/reviews/*.md` (the review key line and the whole-scope focused
  sections)
- `packages/plugin-workflows/test/**` (review, snapshot, gates, host wiring, parity, acceptance)
- `packages/plugin-workflows/assets/parity/retire-legacy-gates.json`, `scripts/workflows-parity.ts`
- `packages/setup/defaults.yml` and the generated setup files (review queue defaults)
- `packages/plugin-openspec/assets/guidance/task-lanes.md` (lane-parallel apply guidance)
- `docs/workflows.md`, `docs/codex-subagent.md`, `docs/openspec-status.md`, `AGENTS.md`
- No change to the committed approval format, the review record paths, or the archive audit.
