# Tasks

## 1. Settlement observer

- [x] 1.1 Add an optional `onRunSettled` seam to `ApplyOptions` and call it exactly once from the run-settle point with the run id and terminal state, only for `completed`, `failed`, or `discarded`; add focused tests for one terminal notification, no notification for `queued`/`running`, and unchanged behavior when the seam is omitted. Verify with `pnpm exec vitest run packages/plugin-delegation-rules/test/engine.test.ts`.

## 2. Deterministic test waits

- [x] 2.1 Rewrite `Harness.waitForRun` to await the settlement signal, resolve a run that settled before the wait began, and then require the durable run file to report the same terminal state; delete the 400-iteration file poll. Verify with `pnpm exec vitest run packages/plugin-delegation-rules/test/engine.test.ts packages/plugin-delegation-rules/test/gate.test.ts` and confirm no bounded run-file polling remains in `test/helpers.ts`.
- [x] 2.2 Replace the queued-run start wait (`until` with 400 `setTimeout(5)` iterations) with an awaitable start count on the fake subagent runtime. Verify the queued-review test passes and no bounded loop remains on the review-run progress path in `test/engine.test.ts`.

## 3. Repository checks

- [x] 3.1 Run `pnpm build` and `pnpm gen`, and confirm the generated `lib/index.d.ts` and the vendored setup copy expose the optional seam; then run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm validate:repo`, and `pnpm gen:check`. Verify all commands pass and the working tree contains the regenerated `lib/` and vendored output.

## Workflow follow-up

- Push only after the owner approves; then confirm the `windows-latest` Unit tests job is green for the delegation-rules files and the overall validate job passes.
- Archive this change only after the CI signal and any owner review are complete.
