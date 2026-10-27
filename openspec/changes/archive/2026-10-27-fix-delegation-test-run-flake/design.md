# Design

## Context

See `proposal.md` for motivation. Current state that shapes the approach:

- A review delegation starts a target and returns a run id before the target completes. The engine records `queued`, `running`, then a terminal `completed`/`failed`/`discarded` state in `.dsh/delegation/runs/<id>.json`.
- `Harness.waitForRun` (`test/helpers.ts`) polls that file up to 400 times with `setTimeout(5)`. On `windows-latest` the budget expires while the run is still settling, producing `review run <id> did not settle`; the same suite is green locally and CI is the only reproducing environment.
- `freeRun` is the single point where a run stops being pending: every terminal path (`completed`, `failed`, `discarded`, including the reused-record path) calls it after the terminal state write.
- `ApplyOptions` already carries test seams (`runGit`, `now`) and production passes none of them.

## Goals / Non-Goals

**Goals:**

- Let the tests await a background review run's terminal state through an in-process signal, with no test-owned wall-clock budget.
- Preserve the assertion that the durable run file reached the expected terminal state.
- Leave production review behavior, records, gates, concurrency, and target watchdogs unchanged.

**Non-Goals:**

- Changing how review runs are serialized, published, reused, or discarded.
- Removing the durable run files; `delegation_status` and post-restart visibility still need them.
- Removing the production per-contract target timeouts. They are watchdog behavior, not a test wait.
- Redesigning unrelated test waits (the deliberate edit/read/restore delay stays).

## Decisions

### D1: Optional settlement observer on `ApplyOptions`

Add `onRunSettled?: (runId, state) => void` to `ApplyOptions`, called once per run with a terminal state. The harness supplies it; production omits it.

Alternatives rejected: a larger polling budget (still wall-clock and still flaky on a loaded runner); `fs.watch` on the run file (platform-dependent, racy, and still an external asynchronous signal); exposing an engine promise map (larger public surface, duplicates lifecycle ownership); fake timers (does not make file I/O deterministic).

### D2: Notify after `freeRun`, not from `markRun`

`freeRun` runs after the terminal state write and removes the run from the pending set. Notifying there means a caller that then evaluates status or the turn-stopping gate cannot observe the just-finished run as pending. Notifying from `markRun` would resolve the test before that cleanup and reintroduce a race in assertions such as "no steer after the review completed".

The observer is wrapped so a throwing observer cannot change run cleanup or error reporting.

### D3: Keep the durable-state assertion after the signal

`waitForRun` awaits the signal and then reads the run file, requiring its state to equal the signalled state. This keeps the test's original subject (the run file records a terminal state) and avoids masking a lost state write. If the file disagrees, the failure names both states instead of retrying until the budget expires.

### D4: Late subscribers resolve from recorded state

A fast run can settle before the test calls `waitForRun`. The harness records terminal states as they arrive and resolves waiters that already have a record, so subscription order cannot change the result.

### D5: Signal for a queued run's start as well

`engine.test.ts` also waits for a run queued behind another to start its target, using the same 400-iteration loop. The fake subagent runtime gains an awaitable start count so that wait becomes deterministic too; no timer or retry remains on the review-run progress path.

### D6: Production timeouts stay; the test wait has no replacement budget

The helper's 400-iteration budget is deleted outright. Production still bounds a target with `timeouts.review`/`answer`/`patch` in `finishTarget`, which is unchanged. If a run never reaches a terminal state, the test now fails through Vitest's configured 20-second test timeout; that timeout is the runner's failure guard, not the completion mechanism. There is no shorter test-owned wait that could flake first.

## Risks / Trade-offs

- [A truly hung run now surfaces as a generic Vitest timeout] → The test name and the helper's failure text identify the run; the expected terminal transition is the only thing being awaited.
- [An optional public option can be misused later] → It is documented as a test seam, inert when omitted, notified only from the single settle point, and covered by an absence test.
- [The real CI cause could be a failed terminal run-file write rather than slow settling] → The helper still reads the file after the signal and fails with a state mismatch, so this change does not hide that case; fixing durable-write resilience would be a separate change.
- [Local runs cannot reproduce the CI flake] → Local repetition under load is supporting evidence only; acceptance is CI on `windows-latest` after the owner approves the push.

## Migration Plan

No configuration, manifest, or dependency migration. The unchanged generate step must run because the tracked Host output and the setup bundle's vendored copies are generated: run `pnpm build` then `pnpm gen`, keep both outputs, and verify with `pnpm gen:check`. Rollback is reverting the change.

## Open Questions

None.
