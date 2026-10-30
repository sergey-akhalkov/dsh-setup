# Proposal

## Why

A task-scoped review hashes the live worktree and guards every Git-visible file as a reviewed input, so
any write while the review runs discards the verdict. Measured on the retained local history: 50 of 56
failed review runs were discarded because a reviewed input changed, 43 of them task reviews — roughly a
quarter of all task-review runs. The consequence is structural: a writer cannot implement the next task
while the current task's review runs, so a change with N tasks pays N serial review waits, and once a
change is cut into parallel lanes the external reviewer becomes the bottleneck instead of the work.

The engine already has the mechanism the fix needs: the patch contract creates a detached
`git worktree` and runs the target there. A task review can review an immutable snapshot instead of the
live worktree, which removes the invalidation class entirely for task scope.

## What Changes

- A task-scoped review reviews an immutable snapshot of the session worktree taken when the run starts:
  a temporary Git index built from the exact review input set (tracked paths from the real index, including
  newly staged ignored files, plus untracked non-ignored files), with `.dsh/`, `.tmp/`, and the change
  directory excluded, checked out into a detached `git worktree` under `.dsh`; the change directory is
  copied onto the absent destination so the reviewer and the record share the same frozen artifacts. The
  real index and working tree are never modified.
- The task digest becomes `task-review-v2` over the task id and text, the frozen change-artifact digest,
  and the snapshot's content tree, so unchanged content reuses an unchanged `FINDINGS` record. The record
  and portable-record shapes are unchanged.
- A write after a task review starts no longer invalidates it. Whole-spec and integration reviews keep the
  live-input mutation guard.
- A snapshot lifecycle: a per-run lease, the disposable checkout, and its temporary index are removed on
  every settle path (PASS, FINDINGS, ERROR, timeout, discard, duplicate reuse, start failure); a throttled
  per-workspace sweep removes expired-lease leftovers from a crashed or failed Host and prunes stale
  worktree metadata. The engine never runs a repository-wide `gc`/`prune`.
- Fallback: when the snapshot cannot be built (not a Git checkout, `.dsh` not ignored, Git failure), the
  task review runs on the live worktree with the existing mutation guard, so behavior is never worse than
  today.
- Documentation and the `delegation-rules` delta spec.

**Out of scope:** running tests or checks in the snapshot (the review target stays read-only), a
`prepare` command, write-capable review targets, a verification rule, relaxing the turn-stopping gate
for a pending run, changing whole-spec or integration reviews, changing the record or portable-record
shape, and any new tool, row, target, or configuration field.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: task-scoped review inputs and digest (snapshot instead of the live worktree), the
  stable-inputs requirement split between snapshot-bound task reviews and live whole-scope reviews, the
  reviewed worktree/change-artifact input sets scoped to live reviews, plus a new snapshot construction
  and lifecycle/cleanup requirement. The review record, gate, archive gate, and portable approval are
  unchanged.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts` — `GitRunner`/`defaultGit` environment support, a
  snapshot helper, `prepareReview`/`beginReviewRun`/`completeReviewRun`/`failRun`, snapshot cleanup and
  the workspace sweep, and one injected review-prompt line.
- `packages/plugin-delegation-rules/test/**` — `FakeGit` gains the snapshot commands, the two task-scope
  invalidation tests flip to snapshot behavior, and a real-Git fixture covers the snapshot helper.
- `docs/delegation-rules.md`, `docs/openspec-status.md`, and the plugin `SKILL.md` asset.
- Generated and committed afterwards: `lib/**` and the vendored `packages/setup/node_modules` tree via
  `pnpm gen`/`pnpm build`; no composition change.
- Disk: a snapshot checkout is about 6 MB (923 tracked files) plus the untracked change directory, and it
  is removed when the run settles; the sweep bounds anything a crash leaves behind.
- No new tool description or system-prompt section; the model-facing cost is unchanged.
