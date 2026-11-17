# Proposal

## Why

A task review repeats from scratch after every fix. The prior `FINDINGS` record is bound to the old
digest, so the next run renders a fresh prompt with no previous findings and no diff; a fresh full
pass then finds another P1. In the review runs recorded for the 28-task change
`move-review-runtime-into-workflows` in this repository, 196 reviewers started for 20 checked tasks
(185 task-review and 11 spec-review), one task consumed 72 full reviews, 168 runs returned `FINDINGS`
with 331 findings, and 45 fix commits in one five-hour window each triggered another full review.
The review count tracks fix commits, not tasks.

The shipped section-scoped review already publishes one per-task approval for every checked task in
a section, but the apply flow and the gate still select a task at a time: 5 section runs against 191
per-task runs in the same audit. The two improvements are independent. Focused re-review removes the
"fresh eyes find another P1" repetition; section-first selection collapses N per-task units into one
unit per related section.

The native review executor lands with the Release A change `move-review-runtime-into-workflows`. The
legacy runtime is dormant and deleted in Release B, so the fix belongs in the native executor; doing
it only in the legacy runtime would be discarded with it.

## What Changes

- **Focused re-review (task and section scope).** When a prior `FINDINGS` record exists for the same
  unit at a different digest, the next review prompt carries the previous findings and a bounded
  diff between the previously reviewed tree and the current one. The reviewer confirms every
  previous finding by its stable per-record id as `closed` or `open` and reports only new P0/P1
  introduced by the diff. `PASS` requires every previous finding `closed` and no new finding. A
  missing, duplicate, or unknown confirmation is an invalid verdict. The local record stores the
  reviewed tree and the confirmations; the committed approval format is unchanged.
- **Section-first selection.** When a level-2 section of `tasks.md` has two or more checked tasks
  without a matching task-review `PASS`/`ERROR` record, the gate selects one section review unit
  covering the section's checked tasks instead of one unit per task. A section with a single missing
  task, a task outside any section, or a section with no missing task keeps the per-task unit. The
  steer names the section key and the missing tasks; while the deprecated `delegate` alias exists it
  names `delegate(rule: "task-review", change: "<change>", section: "<key>")`.
- **Apply-flow documentation.** `AGENTS.md` section 5 and the review docs state the section-first
  default for a related group, keeping the per-task review for a lone or risky task.

Explicitly out of scope: a review-round cap or budget, a change to the zero-P0/P1 bar, any behavior
change to the dormant legacy runtime, any edit under `packages/plugin-delegation-rules/**` (the
package is deleted in Release B; its prompt copy keeps the pre-focus text), whole-spec focused
re-review, the committed approval format, and new profile defaults.

## Capabilities

### New Capabilities

None. The change extends the existing `workflows` capability.

### Modified Capabilities

- `workflows`: the native review executor's re-review prompt and verdict contract, and the owned
  task-review gate's review-unit selection.

## Impact

- **Dependency:** `move-review-runtime-into-workflows` must be archived first. That change moves the
  review runtime into `workflows` (Release A) and makes the native executor the review owner; this
  change modifies the requirements it contributes. It also stays before Release B, which deletes the
  legacy runtime and its aliases.
- **Code:** `packages/plugin-workflows/src/host/review.ts` (prompt and verdict parse),
  `review-scheduler.ts` and `review-snapshot.ts` (prior reviewed tree, bounded diff),
  `index.ts`/`engine-gates.ts` (review-unit selection, run start, gate and status text), the bundled
  `packages/plugin-workflows/assets/reviews/review-task.md`, and their tests. The prompt is edited in
  the workflows copy only; retiring Release A's byte-equality check against the legacy copy in
  `packages/plugin-workflows/test/assets.test.ts` is part of this change.
- **Data:** the local `ReviewRecord` gains optional reviewed-tree and previous-confirmation fields.
  The committed `openspec/changes/<change>/reviews/<taskId>.json` keeps its field set, order, and
  byte layout.
- **Docs and generated output:** `AGENTS.md`, `docs/workflows.md`, and the vendored setup tree after
  `pnpm gen`.
- **Users:** applying a multi-task section uses one reviewer instead of N; a re-review confirms the
  prior findings instead of re-discovering the whole task. The gate still refuses a close on
  `FINDINGS` or a missing record, and the archive gate still requires a portable `PASS` per task.
