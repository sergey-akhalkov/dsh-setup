# Tasks

## 1. Engine, tests, and docs (single lane: one hot file `packages/plugin-delegation-rules/src/host/index.ts`, shared tests, and a serial generated-output gate)

- [ ] 1.1 Exclude the reviewed change's `reviews/` approval directory from the Git-visible reviewed-input signature in `reviewedInputs`, for every review scope that uses that signature (task fallback and implementation-complete), while leaving the worktree digest unchanged; add a regression test in `packages/plugin-delegation-rules/test/engine.test.ts` where another task's portable approval record is created mid-run in fallback mode and the review publishes instead of failing with `reviewed inputs changed`; update `docs/delegation-rules.md` (the live input set and the approval-directory exclusion). Verify `pnpm exec vitest run packages/plugin-delegation-rules/test/engine.test.ts` passes and the new test fails when the filter is removed.
- [ ] 1.2 Report why a task-review snapshot was skipped: add an optional `onUnavailable(reason)` callback to `createReviewSnapshot`, report a bounded fixed reason at every early `undefined` return (outside the repository, unresolvable paths, `.dsh/` not Git-ignored with the next action, unmerged index entries, snapshot build failure), carry it on `ReviewPreparation`, write `live worktree: <reason>` as the running run detail, and keep the same cause appended to the terminal verdict/error detail after settlement; add tests in `packages/plugin-delegation-rules/test/engine.test.ts` and `packages/plugin-delegation-rules/test/snapshot.test.ts` for the `.dsh/` reason, a snapshot failure, and the reason surviving settlement, and document the detail and the `.dsh/` fix in `docs/delegation-rules.md`. Verify `pnpm exec vitest run packages/plugin-delegation-rules/test/engine.test.ts packages/plugin-delegation-rules/test/snapshot.test.ts` passes.
- [ ] 1.3 Raise `DEFAULT_TIMEOUTS.review` from 600 000 ms to 1 200 000 ms (20 minutes), update the default-timeout assertion in `packages/plugin-delegation-rules/test/config.test.ts`, and state the default next to the timeout guidance in `docs/delegation-rules.md`. Verify `pnpm exec vitest run packages/plugin-delegation-rules/test/config.test.ts` passes and the timeout error still names `timeouts.review`.

## 2. Serial tail: generated output and the repository gate

- [ ] 2.1 Run `pnpm gen` and `pnpm build`, commit the regenerated `packages/plugin-delegation-rules/lib/**`, its bundle patch if it changed, and the vendored `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules` copy; verify `pnpm gen:check` exits 0 and `git diff --exit-code` is clean after the generated output is committed.
- [ ] 2.2 Run `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, and `pnpm validate:installer`; verify they all pass and the repository gate finishes with a clean worktree.

## Workflow follow-up

- Run `pnpm reviews:check --change fix-delegation-review-fallback` before archiving: every checked task needs a committed `reviews/<taskId>.json` task-review PASS.
- Sync the delta into `openspec/specs/delegation-rules/spec.md`, archive the change, and release `v0.17.1` per `docs/releasing.md`.
