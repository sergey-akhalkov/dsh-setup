# Proposal

## Why

The `plugin-delegation-rules` unit tests are red on `windows-latest` while passing locally: three consecutive `main` CI runs failed in `engine.test.ts` and `gate.test.ts` with `review run <id> did not settle`. The test harness waits for a background review run by polling its durable run file with a fixed budget of 400 iterations of `setTimeout(5)`. On a loaded Windows runner that budget expires before the run reaches a terminal state, so the test reports a failure that says nothing about the review engine.

The tests must observe run completion through a deterministic signal instead of a wall-clock budget. Production review behavior must not change.

## What Changes

- Add an optional `onRunSettled` test seam to `ApplyOptions`. The engine calls it exactly once per background review run, after the run leaves the pending set, with the run id and its terminal state (`completed`, `failed`, or `discarded`).
- Use the seam from the test `Harness` (`test/helpers.ts`) and replace the bounded run-file polling in `waitForRun` with an await on that signal. A run that settles before the test starts waiting is resolved from a recorded state.
- Add focused tests for the seam: one notification per run, terminal states only, and no behavioral or observable effect when the seam is omitted.
- Keep the production target watchdog (`timeouts.review`, `timeouts.answer`, `timeouts.patch`) unchanged; only the test-side wall-clock wait is removed.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: add a deterministic settlement observation for background review runs so tests and embedders can await completion without polling the durable run file within a fixed time budget.

## Impact

- Code: `packages/plugin-delegation-rules/src/host/index.ts` (optional option, observer call), `packages/plugin-delegation-rules/test/helpers.ts`, and the affected tests.
- API: one new optional field on an already test-oriented options type; existing callers pass nothing and see no change.
- No configuration, manifest, dependency, or production timeout change.
- Generated Host output (`lib/`) and the setup bundle's vendored copies of this plugin are rebuilt, so `pnpm build` + `pnpm gen` must run and `pnpm gen:check` must pass before CI.
- CI on `windows-latest` remains the acceptance signal; the local suite cannot reproduce the failure.
