# Tasks

## 1. Baseline

- [x] 1.1 Collect the pre-change baseline over at least 10 recent sessions from the observability dashboard or a read-only pass over session logs: substantial root turns (at least 4 tool calls and at least one successful `edit`/`write` or worker start, last tool not `ask_user_question`), worker starts in the next turn after each such pause, and median steps and wall time to completion. Do not use the pre-change sample as the coverage denominator. Record the counts, the window, and the source under `.dsh/` and summarize them in the task review. Verify the baseline covers at least 10 sessions and all three behavioral fields.

## 2. Checkpoint tool and record

- [x] 2.1 Register the `work_checkpoint` tool in `packages/plugin-goal-continuity/src/host/index.ts` with `outcome` (`done` or `continue`), `verified`, `remaining`, `parallel`, `serialReason`, `next`, and `speedup`; reject an unknown field, an unknown outcome, a missing next action, and a `continue` + `parallel: false` checkpoint without a serial reason with a field diagnostic; return a short summary with a checkpoint id and the record path. Verify with a new `packages/plugin-goal-continuity/test/checkpoint.test.ts` covering every accept and reject branch and the summary shape.
- [x] 2.2 Write the atomic local record under `.dsh/work-checkpoints/<hashed-session>/<turn>.json` with the decision, checkpoint id, time, and session; bound each field, redact machine paths and obvious credentials, reuse the same record for a repeated call in the turn, and never write a tracked file. Verify with tests for the path, bounds, redaction, reuse, and a write failure that still returns the summary without claiming a record. Document the tool and record in `docs/goal-continuity.md`; verify `pnpm lint:fix` and that the documented example matches the schema.

## 3. Trigger and checkpoint request

- [x] 3.1 Implement substantial-pause detection from the plugin's observed tool results: `minToolCalls` (default 4), `requireWrite` (default true), successful `edit`/`write` and worker starts, written paths, the last shell command and its exit state, the last failed tool result, the last tool call `ask_user_question`, subagent turns, aborted turns, and once per turn. Verify with `packages/plugin-goal-continuity/test/checkpoint-trigger.test.ts` for every branch in the `Substantial-pause trigger` spec.
- [x] 3.2 Build and inject the bounded checkpoint request at `agent/turn-stopping`: name the call count, bounded paths, the last shell result, the last failed tool, and worker starts; ask the done, verified, remaining, parallel, and next questions; attribute it to the goal-continuity observability source; enforce `maxMessageChars`; redact; and do not start an idle agent. Verify with tests for the `Checkpoint request` spec and a harness assertion that the request is a non-waking steer. Document the trigger and request in `docs/goal-continuity.md`; verify `pnpm lint:fix`.

## 4. Close gate and cap

- [x] 4.1 Implement the close gate at `agent/turn-stopping`: refuse the close until a successful checkpoint exists for the turn, steer the request on each refusal, allow at most `maxBlocks` refusals (default 3) and then close with a visible UNCHECKED notice, fail open on an internal state error, and skip subagent turns. Verify with tests for every scenario in the `Close gate` spec, including the cap and the fail-open path.
- [x] 4.2 Test a goal round end with the checkpoint gate: the checkpoint is required before the turn closes, the goal driver continues after the close, the block review still runs when the same turn proposes a block, and no second goal-round-specific checkpoint is required. Verify with a goal-round fixture in `packages/plugin-goal-continuity/test/` and the `Goal rounds` spec; document the interaction in `docs/goal-continuity.md`.

## 5. Parallel-action gate

- [x] 5.1 Implement the parallel-action gate by reusing the existing worker-start evidence list and argument scan: a `continue` checkpoint with `parallel: true` requires a worker start after the checkpoint whose serialized arguments contain the checkpoint id, or an amendment with `parallel: false` and a serial reason; steer on each unsatisfied close with the id under the shared `maxBlocks` budget and the UNCHECKED cap; report nothing when no worker-start tool is registered or the outcome is `done`; a failed or untagged worker does not satisfy. Verify with tests for every scenario in the `Parallel-action gate` spec, including repeated close attempts and a failed worker start. Document the gate and the serial escape in `docs/goal-continuity.md`.

## 6. Configuration and speed-review removal

- [x] 6.1 Replace the `speedReview` section with `checkpoint` in `packages/plugin-goal-continuity/src/host/index.ts` and `cordis.fragment.yml`: `checkpoint.enabled` (default true), `minToolCalls` (4), `requireWrite` (true), `maxBlocks` (3), `enforceParallel` (true), and `maxMessageChars`; validate fail-loud. Accept a legacy `speedReview` object, warn once, and run no speed review. Verify with `test/config.test.ts` for the new defaults, every invalid field, and the legacy object; run `pnpm gen` and verify `pnpm gen:check`.
- [x] 6.2 Remove the speed review implementation from `src/host/index.ts` and the fragment: the review child, round metrics, next-round brief, follow-through gate, retro records, `speedReview` defaults, and the `round-review.md` asset; keep the block review and the shared `goal-reviewer` preset, and update the preset description and the fragment comment. Remove `test/speed-review.test.ts`, `test/speed-review-harness.ts`, and the speed-review assertions in `test/config.test.ts` and `test/package.test.ts`; keep the block-review tests passing. Verify `pnpm exec vitest run packages/plugin-goal-continuity/test` and `rg` finds no speed-review implementation reference outside the legacy config and docs.
- [x] 6.3 Update `docs/goal-continuity.md`: replace the speed-review sections with the checkpoint sections, update the title, purpose, and config example, and mark `speedReview` as deprecated and ignored. Update the package description in `docs/plugins.md` and the root `README.md`. Verify `pnpm lint:fix` and `pnpm validate:repo`.

## 7. Delegation defaults

- [x] 7.1 Remove the `task-progress` and `lane-fanout` rules from `packages/plugin-delegation-rules/cordis.fragment.yml`; keep the targets and every other rule. Update the shipped-default assertions in `packages/plugin-delegation-rules/test/config.test.ts` and `test/engine.test.ts`, and add a test that a profile rule on `implementation-work` or `lane-assignment` still composes and evaluates. Verify `pnpm exec vitest run packages/plugin-delegation-rules/test`, `pnpm gen`, and `pnpm gen:check`.
- [x] 7.2 Update `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md` and `docs/delegation-rules.md`: the two triggers remain available to profile rules, the shipped defaults no longer include them, and the `work-checkpoints` capability owns the pause-time decision. Verify `pnpm exec vitest run packages/plugin-delegation-rules/test/assets.test.ts` and `pnpm lint:fix`.

## 8. Working contract

- [x] 8.1 Rewrite `packages/plugin-working-principles/assets/working-principles/contract.md` to add the goal-as-work-unit and work-checkpoint clauses, replacing or condensing existing text so the registered section stays within the 1500 estimated-token budget; a single-turn or informational request is exempt from the goal. Update the measured sizes in `docs/principles.md`. Verify `pnpm exec vitest run packages/plugin-working-principles/test` (including the budget test) and `pnpm validate:repo`.
- [x] 8.2 Add content assertions to `packages/plugin-working-principles/test/` for the multi-step goal default, the single-turn exemption, the checkpoint decisions, the parallel worker start, and the serial reason. Verify the test fails when one of the clauses is removed from the asset.

## 9. Observability and setup generation

- [x] 9.1 Add `tool: work_checkpoint` to the `dsh-setup-goal-continuity` row in `packages/setup/defaults.yml`; run `pnpm gen`; verify the signal-map test and `pnpm gen:check`. Update `docs/plugins.md` with the row/tool attribution and verify `pnpm lint:fix`.

## 10. Integration and measurement

- [x] 10.1 Run the local gate: `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm validate:installer`, and `pnpm build && git diff --exit-code`; fix what fails.
- [ ] 10.2 Owner installs the regenerated setup from an external PowerShell with the app closed, then in a substantial pause verifies the checkpoint request, a successful `work_checkpoint` call, a parallel declaration that either starts a tagged worker or records a serial reason, the cap behavior, and no conflict with a block review. Record the observed behavior in the task review.
- [ ] 10.3 Measure the post-install window for one to two weeks: count eligible turns by the trigger definition, successful checkpoints per turn (deduplicating amendments), and UNCHECKED closes separately; report the checkpointed share, parallel share, worker-start conversion, serial rate, and UNCHECKED cap hits; compare median steps and wall time with the pre-change baseline; record the keep, tune, or revert decision in the task review.

## Workflow follow-up

- Apply task by task: mark a task `[x]` only when it is complete, then run its task-scoped review before the next one.
- Run `pnpm reviews:check --change replace-rare-triggers-with-work-checkpoints` before archiving; every checked task needs its committed task-review PASS.
- The owner installs the regenerated setup from an external PowerShell and keeps the app closed during the install.
- Archive the change after the review requirements and the measurement decision are satisfied.
