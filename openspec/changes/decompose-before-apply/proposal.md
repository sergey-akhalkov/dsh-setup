# Proposal

## Why

A multi-task apply run can inherit a plan whose task groups look like lanes but own no paths, close
planning with `parallel: false` for a review-process reason, and then spend a whole turn editing and
waiting for task reviews. The lane gates fail open on a plan without owned paths, the shipped
defaults no longer include the lane-fanout rule, and the work-checkpoint decision runs only at turn
close, so nothing reopens the decomposition question while the run is in progress. The result is a
serial apply even when a second work lane (for example, a client half that does not depend on the
host report shape) could start immediately.

## What Changes

- The packaged OpenSpec task-lane guidance requires a plan-time lane check: each level-2 task group
  names its owned paths in the heading, or `tasks.md` states one explicit single-lane reason about
  the work (shared hot file, generated output, or serial gate). A review or archive process is not
  a valid single-lane reason.
- The guidance adds an apply-start check: before the first implementation task, read the lane
  headings once and either assign each independent lane to a worker or record a per-lane serial
  reason. No new tool, state, or configuration.
- The bundled whole-spec review instruction adds a P1 criterion for lane shape: a `tasks.md` with
  several groups and no owned paths, or a single-lane reason that cites the review or archive
  process, is a finding.
- The apply-loop guidance stops telling the agent to block on a task review: start the review, keep
  implementing the next independent task while it runs, and collect the verdict before the turn
  closes. No blocking sleep.
- The guidance conditions that overlap on a frozen review snapshot and names the live-worktree
  fallback: restore snapshot support and re-run, or defer writes until the run settles without a
  blocking sleep.
- The always-on working contract's plan step names independent work streams and their owned files
  for any multi-file or multi-step task, and directs a worker per independent stream or one stated
  serial reason. The delegation paragraph is condensed so the registered contract stays within its
  1500 estimated-token budget.
- The goal-continuity checkpoint gains a configurable mid-turn interval (`stepInterval`, default 40
  steps): a root turn that reaches the interval with a write or worker start gets the same bounded
  checkpoint request. A checkpoint younger than the interval satisfies the close, so a turn that
  checked in a couple of steps earlier does not get a duplicate at close.
- The checkpoint requires both outputs: the lane decision (`parallel` or `serialReason`) and the
  bottleneck reflection. `work_checkpoint` gains a required `bottleneck` when the outcome is
  `continue`, and the request asks for the current bottleneck and the next action that removes it.
  The always-on checkpoint clause names the bottleneck and the per-interval request.
- The goal-continuity bundle carries the periodic trigger and the bottleneck field; no new plugin,
  row, tool, or dependency.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-skills`: the task-lane guidance addendum states the plan-time lane check, the work-only
  single-lane reason, and the apply-start lane assignment.
- `delegation-rules`: the whole-spec review checks the plan's lane shape, and the documented apply
  loop permits implementation overlap with a running task review.
- `session-guidance`: the plan clause gains the work-stream requirement for any multi-file or
  multi-step task, and the checkpoint clause names the bottleneck reflection and the step interval.
- `work-checkpoints`: the checkpoint gains a configurable mid-turn interval, a fresh-checkpoint
  close rule, and a required bottleneck reflection.

## Impact

- `packages/plugin-openspec/assets/guidance/task-lanes.md` and its text assertions.
- `packages/plugin-delegation-rules/assets/delegation-rules/review-spec.md`,
  `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md`, and their text assertions.
- `packages/plugin-working-principles/assets/working-principles/contract.md`, its budget test, and
  `docs/principles.md`.
- `packages/plugin-goal-continuity/src/host/index.ts`, `cordis.fragment.yml`, the checkpoint tests,
  and `docs/goal-continuity.md`.
- `AGENTS.md`, `docs/openspec.md`, and `docs/delegation-rules.md`.
- Generated vendored copies under `packages/setup/node_modules/@dsh-setup/**` (through `pnpm gen`);
  no runtime code, no new dependency, and no profile change.
