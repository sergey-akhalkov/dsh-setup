# Design

## Context

See [proposal.md](proposal.md) for the motivation. The behavior lives in
`@dsh-setup/plugin-workflows`: the durable run store (`src/host/runs.ts`), the review executor
inside the turn-close advance (`src/host/index.ts`), the in-memory review scheduler and queue
(`src/host/review-scheduler.ts`, `src/host/review-queue.ts`), the tool host
(`src/host/tools.ts`), and startup recovery (`src/host/resume.ts`).

```text
tick (fs.change)                    turn close (agent/turn-stopping)
      |                                      |
      v                                      v
 create run (running)             advanceRun -> review executor
                                               | prepare snapshot
                                               | enqueue
                                               v
                                     ReviewScheduler (in memory)
                                               | start reviewer child
                                               v
                                     settle run + review record
```

The scheduler is the only executor-liveness source (`liveByRun`), and the close and the trigger
already use it. The tool paths, the duplicate admission, and post-restart cleanup do not: they
infer liveness from the persisted `running`/`blocked` status. The local run store shows the
consequence — review runs cancelled seconds before their verdicts, a waiting run refusing a
fresh section start, and an idle foreign session blocking the only cancel path. The review
queue is in memory; a Host restart loses it, so recovery marks unfinished runs `interrupted` and
the next close must start the fresh round.

## Goals / Non-Goals

**Goals:**

- Make the host executor state, or a bounded in-flight admission, the only source of
  "live" for a review step in `start`, the trigger, the close, and `status`.
- Make a rejected duplicate admission terminal instead of an open run with no executor.
- Make a foreign stale run recoverable when its owning agent is not executing a turn.
- Leave no review run `blocked` with an open step after a Host restart: the next close
  supersedes it with the fresh round, without writing a record.

**Non-Goals:**

- Rebuilding or persisting the review queue; the reviewer needs a live parent agent, so the
  next-close dispatch is the requeue.
- Synthesizing an `ERROR` (or any) review record at recovery.
- Cancelling an already started reviewer child when its workflow run is cancelled.
- New run/step statuses, new config options, or client UI changes.

## Decisions

**D1 — Liveness is `reviewScheduler.liveRunById(run.id)` or an in-flight admission.** The review
executor adds the run id to a host-local `reviewStarting` set before preparing a snapshot and
removes it in a `finally` after `enqueue`. A single `reviewLive(run)` predicate combines both and
is used by:
- `startRun` coverage (reuse a fully covering run, refuse a partial overlap only against a live
  run, name the live run in the refusal);
- the `fs.change` trigger's live-run suppression (a foreign run counts only while live);
- the close's `reviewOpenRuns` (this session's in-flight run and any live run; a foreign run
  must be live).

Alternatives rejected: persisted status (today — cannot tell a live review from a lost queue
entry); the step attempt count (exists only after a start and is lost with the process); a
durable reservation (signed state for a sub-second window).

**D2 — A waiter stays; a rejected duplicate settles.** When the executor returns early because a
live review already covers the unit, the run is a legitimate waiter: it keeps the unit's
coverage and is re-advanced at the next close. When the scheduler itself returns
`{kind:'duplicate', runId}` for a different run, the executor settles the current run
`cancelled` with a reason naming the covering run. No record is written for the duplicate.

Alternative rejected: cancel every overlapping run — forces one new run per close and loses the
expanded-coverage wait. Leaving the duplicate open is the reported zombie.

**D3 — Cross-session cancel uses the owning agent's status.** The runtime `Agent` exposes
`status: 'idle' | 'running'`; a foreign run is cancellable when `agents.get(run.session)` is
absent or not `running`. The per-run lifecycle lock already serializes the cancel with an
in-flight advance. The existing refusal remains for a session executing a turn.

Alternatives rejected: `turnBoundaryOf(session)` from the Agent registry (same signal, wider host
surface); time-based expiry (a clock rule that would cancel legitimate long work); `agent/disposed`
only (today — misses a loaded but idle session).

**D4 — Liveness is a read-time projection.** `workflows status` asks the host for the review
step's state and appends `live (attempt <n>)`, `waiting on <runId>`, or `orphaned` (plus the
run's bounded `interrupted` reason when present). No new persisted field.

The waiting lookup resolves the same unit first (`liveUnit`: change, record id, and phase, which
covers whole-scope phase identity and an equal-coverage predecessor at another digest) and then a
cross-shape covering review (`liveCovering`) for a per-task run behind a section review, always
excluding the run itself. `liveCovering` alone is insufficient: it returns nothing for empty
(whole-scope) coverage and skips equal coverage, while the executor leaves waiters in both cases.

Alternative rejected: a persisted `waitingOn` step field — signed state with a lifetime, for a
diagnostic. The client run view stays unchanged.

**D5 — Recovery keeps `interrupted`; the fresh round supersedes.** `recoverRuns` is unchanged. The
review executor, in the same advance that is about to enqueue a fresh review, settles every open
`interrupted` review run of the same change whose review unit overlaps the fresh unit
`cancelled` with `reason: "superseded by a fresh review round after a host restart"`. For task
scope the units overlap when their task coverage intersects; for whole scope when the definition
rule and review phase match (`whole:spec`, `whole:integration`). Any session is considered: the
unit is workspace-global and an interrupted run holds no executor, so its session cannot advance
it. The supersede runs in the review executor rather than `dispatchDueUnits`, because that
dispatch starts only `task-review` units; the shipped `spec-review` and `integration-review`
definitions are started by their `turn.stopping` triggers and would otherwise leave their
interrupted predecessors open. The fresh round is a normal close dispatch, so the archive gate
still needs a real `PASS`.

Alternatives rejected: a synthetic `ERROR` at recovery (fabricates a verdict and needs a
reviewer/prepared digest recovery does not have); auto-resume (no live parent agent at startup);
marking the step `failed` at recovery (recovery has no definition context and would write a
terminal failure the user cannot resume cleanly).

## Risks / Trade-offs

- [Enqueue window] Between `reviewStarting` and the scheduler entry, another close can still see
  the run as not live → the scheduler's identity dedupe rejects a duplicate there and D2 settles
  it; the window is bounded by snapshot preparation and `enqueue`.
- [Parallel sessions] A live review from another session covers a unit host-wide → the gate
  must not key coverage off the run's persisted status; the regressions include a foreign live
  review.
- [Idle-owner cancel] Cancelling an idle session's run can race the owner's next close → the run
  lock makes the outcome deterministic; the owner's close may then start a fresh round, which is
  the intended recovery.
- [Recovery supersede] A run interrupted while its owner is idle but could resume manually may be
  cancelled by the next close first → the fresh round preserves the same obligation and the
  cancellation is visible in the run history.
- [Test surface] The behavior is host-level and timing-sensitive → use the existing fake host and
  reviewer stub in `test/host-wiring.test.ts`, plus the queue and recovery unit tests.

## Migration Plan

- Source change only; no data migration. Existing runs, records, approvals, and receipts stay
  valid. An interrupted review run from an earlier version is superseded by the next close like
  a newly interrupted one.
- The live desktop profile keeps its behavior until a release is installed; no agent session
  installs into it. Release via `pnpm release:prepare`, `pnpm build`, `pnpm gen` if the vendored
  copy changes, the full gate, tag, and push.
- Rollback is a version downgrade; no persisted state is rewritten, so the previous build reads
  the same run files.

## Test Plan

- `host-wiring.test.ts`:
  - a stored `blocked` run with no scheduler entry does not refuse a fresh start;
  - a live covering review still refuses a partial section start and names the live run;
  - a fully covered live run is reused (existing test stays green);
  - a duplicate admission settles the duplicate `cancelled` with the covering id and writes no
    record;
  - `status` prints `live`, `waiting on <runId>`, and `orphaned`, including a whole-scope waiter
    behind a live same-phase review and a task run waiting behind an equal-coverage run;
  - a foreign idle-agent run cancels, a foreign running-agent run is refused;
  - recovery marks a review run interrupted and the fresh round supersedes it for `task-review`,
    `spec-review`, and `integration-review`, across sessions, writing no record.
- `review-queue.test.ts` / `review-scheduler.test.ts`: the duplicate admission result reaches the
  caller.
- `runs.test.ts`: recovery keeps the interrupted semantics.
- Gate: `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `pnpm build` with no uncommitted
  generated diff.
