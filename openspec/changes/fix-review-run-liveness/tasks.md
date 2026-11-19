# Tasks

**Single lane:** every group edits the same shared files — `packages/plugin-workflows/src/host/index.ts`,
`packages/plugin-workflows/src/host/tools.ts`, `packages/plugin-workflows/test/host-wiring.test.ts`,
and `docs/workflows.md` — so implement the groups serially in one lane rather than in parallel.

## 1. Executor liveness for review coverage

- [x] 1.1 Add the host-local `reviewStarting` admission set and the `reviewLive(run)` predicate in `packages/plugin-workflows/src/host/index.ts` (scheduler entry or in-flight admission); verify with `pnpm exec tsc -p packages/plugin-workflows` and a host-wiring test that a live covering review still reuses its run.
- [x] 1.2 Use `reviewLive` in the tool `start` coverage and in the `fs.change` trigger suppression, keeping this session's pending-run allowance; verify a stored `blocked` run with no scheduler entry no longer refuses a start, and a live partial overlap still refuses.
- [x] 1.3 Name the live covering run in the partial-overlap refusal and keep the fully covered reuse path; verify the refusal message contains the live run id in `host-wiring.test.ts`.
- [x] 1.4 Use `reviewLive` for the close's `reviewOpenRuns` (this session's in-flight runs or any live run), so a foreign stored run with no executor cannot count as coverage; verify the close starts a fresh round when only non-live runs overlap.

## 2. Duplicate admission and waiting runs

- [x] 2.1 Settle a scheduler `duplicate` admission (different run id) as `cancelled` with the covering run id in the reason, inside the review executor; verify with a `host-wiring.test.ts` regression and the existing `review-scheduler.test.ts` duplicate cases.
- [x] 2.2 Keep a run that waits behind a live covering review open and blocked as coverage (the waiter path); verify it is re-advanced at the next close and does not write a record while waiting.
- [x] 2.3 Verify a duplicate settlement writes no `PASS`/`ERROR` record and leaves the covering run live; add the regression beside 2.1.
- [x] 2.4 Document the duplicate/waiter behavior in `docs/workflows.md` (run lifecycle and asynchronous review sections) and verify the described commands/status match the tests.

## 3. Cross-session cancel by owner activity

- [x] 3.1 Replace the cancel liveness check in `packages/plugin-workflows/src/host/index.ts`/`tools.ts` with the owning agent's `status`: absent or `idle` allows another session to cancel, `running` refuses; verify both cases in `host-wiring.test.ts` (idle-agent run cancels; running-agent foreign run is refused).
- [x] 3.2 Update the `cancel` paragraph in `docs/workflows.md` and the tool reference; verify `pnpm lint` covers the edited markdown.

## 4. Status liveness and restart supersede

- [x] 4.1 Add a review-state projection to the tool host and print `live (attempt <n>)`, `waiting on <runId>`, or `orphaned` (with the run's bounded reason) in `workflows status`; the waiting lookup resolves the same unit (`liveUnit`, including whole-scope phase and equal coverage at another digest) before cross-shape coverage, excluding the run itself; verify all three tokens, a whole-scope waiter, and an equal-coverage waiter in `host-wiring.test.ts`, and keep the existing status prefix byte-compatible.
- [x] 4.2 In the review executor, before enqueueing a fresh round, settle every open `interrupted` review run of the same change whose review unit overlaps the fresh unit — intersecting task coverage for task scope, same definition rule and phase for whole scope, any session — `cancelled` with the restart reason; verify the fresh-round regressions for `task-review`, `spec-review`, and `integration-review` and that no record is written.
- [x] 4.3 Document the status token and the restart supersede in `docs/workflows.md`; verify the recovery paragraph names `resume`/`cancel` as the manual path.

## 5. Generated output and gate

- [ ] 5.1 Rebuild the package and the vendored setup copy (`pnpm build`, `pnpm gen`) and verify `pnpm gen:check` and `pnpm build && git diff --exit-code` are clean after committing the generated files.
- [x] 5.2 Run `pnpm check` (typecheck, lint, build, test) and `pnpm validate:repo`; verify both exit 0.
- [x] 5.3 Run `openspec validate fix-review-run-liveness --strict` and verify exit 0 with the delta's ADDED and MODIFIED requirements accepted.

## Workflow follow-up

- Sync the `workflows` delta into `openspec/specs/workflows/spec.md` and archive the change after the owner's approval and the current task-review and spec-review PASS.
- Run `pnpm reviews:check --change fix-review-run-liveness` before archiving; every checked task needs a committed `reviews/<taskId>.json` PASS.
- Release through the repository process (version bump, build, gate, tag, push) when the owner schedules it.
