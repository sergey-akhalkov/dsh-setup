# Design

## Context

Issue #4 is a lifecycle bug in `plugin-workflows`, not a definition bug. The shipped
`task-review` definition already declares `start-review` (delegate), `await-review`
(record PASS/ERROR) and `complete-review` (coverage check). The engine, however,
dispatches `delegate` unconditionally, attributes runs to the workspace's last active
session, and has no liveness or attempt bound, so a run can outlive the session that
can satisfy it and keep retrying a call that cannot succeed.

## Decisions

### 1. Reuse the review record at `start-review` instead of skipping the run

Before dispatching a `task-review` `start-review` tool step, `advanceIntake` verifies
the `await-review` step's `record` contract against the current workspace. A valid PASS
or ERROR record settles `start-review` with that record evidence and the loop continues
to `await-review`, which settles from the same record; `complete-review` still checks
the portable coverage of every checked task.

- Alternative rejected: complete the whole run when the record exists. That would skip
  the completion-coverage check, which is the owned gate's reason to exist.
- Alternative rejected: add a definition setting for record reuse. It is one behavior
  of one shipped definition, and the engine already special-cases the task-review retry
  path; a new schema field would need parity coverage for no additional use.

### 2. Supersede by checked-task identity before advancing

Before advancing any nonterminal task-review run, regardless of which step is pending,
the engine reads `openspec/changes/<change>/tasks.md` and compares its checked task ids
with the run's `context.taskId`. A missing id cancels the run with a bounded
`superseded` reason; an unreadable `tasks.md` is treated the same way (the change is
gone or unreadable, so no dispatch can succeed).

A new task-review run for the same change and task is suppressed while an open run for
that pair exists whose session is live. A dead-session run does not suppress the new
run: otherwise the task could never be reviewed.

Restoring the original task text restores the checked task id, but the superseded run
is terminal and is not resumed: the watcher starts a fresh task-review run, because a
cancelled run is not open and therefore does not suppress its replacement.

- Alternative rejected: a workspace reconciliation pass over every run at turn close.
  The advance path already covers the current session's runs, and the dead-session
  cases are handled by the liveness escape and the `agent/disposed` marking.

### 3. Bound tool attempts; the turn boundary is the backoff

`runToolStep` increments the step's `attempts` on every failed dispatch. The
task-review retry branch reopens a failed step only while `attempts < 3`; at the cap
it leaves the step `failed` and marks the run `failed` with a bounded reason. The
turn-close gate skips the failed-dispatch refusal for a capped run, but the retained
completion-coverage and task-progress checks still run, so a final tick without a
portable PASS is still refused. The archive gate still refuses until the user resumes
or cancels the run. `resume` accepts `failed`, reopens each failed step (clears
evidence, reason, failure class, attempts) and leaves the run `running`, so
`pendingStep` names the retried step.

- Alternative rejected: a timer-based exponential backoff. Turns already space the
  attempts by seconds to minutes; a second timer would add state and test surface with
  no additional safety.
- Alternative rejected: leave the run `blocked` after the cap. That would keep the
  turn-close gate refusing on every turn, which is the issue's symptom.

### 4. Liveness from the existing agent registry

The tools host receives `sessionLive(session)` backed by `agents.get(session) !== undefined`.
`cancel` allows a foreign run only when its owner is not live; `resume` keeps the
same-session rule. An `agent/disposed` listener records the session's open run ids and
marks those runs `interrupted` with the same bounded reason as startup recovery. The
advance path consults the recorded ids before and after its atomic write and persists
a stale advance as `interrupted` instead of reviving the run, so a disposal that races
an in-flight advance wins deterministically. The prompt contribution filters to the
assembly session when the scope names one, keeping the workspace fallback for scopes
without a session.

- Alternative rejected: cancelling every open run when a session ends. It destroys the
  documented resume path.
- Alternative rejected: letting the archive gate ignore dead-session runs. The PASS
  coverage stays authoritative, and the current session can cancel the stale run named
  by the refusal instead.
- Alternative rejected: changing fs.change attribution to the session that wrote
  `tasks.md`. The watcher only knows the workspace's last observed session; correlating
  a write call with a file event is racy and unnecessary once ownership is harmless.

### 5. List wording

`workflows list` renders `user-started` for `allowModelStart: false` and
`model-start allowed` otherwise. The start refusal message keeps its current contract
because it reports an actual attempted start.

## Risks

- Resuming a `failed` run is new user-visible behavior. It is explicit, bounded by the
  existing resume path, and never bypasses the archive coverage.
- The `agent/disposed` write races a concurrent turn-close advance of the same run.
  The listeners record the ended run id and the advance path re-checks it before and
  after persisting, so a stale advance is replaced by the interrupted state instead of
  reviving the run. Runs are never auto-completed by this path.
- The task-review reuse trusts the record's reviewer binding and verdict, exactly as
  `await-review` already does; it does not recompute the delegation digest.
- Generated `lib/**` and the vendored `packages/setup` tree must be refreshed after the
  source change; CI rejects drift.

## Migration

No data migration. Existing run files stay readable (version 1, optional `attempts`).
Stale runs from an older session are handled by the new liveness escape; an already
`running` run of the current session can be cancelled or resumed as documented.
