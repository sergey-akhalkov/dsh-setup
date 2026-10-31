# Tasks

## 1. OpenSpec lane guidance (owns `packages/plugin-openspec/assets/guidance/task-lanes.md`, `packages/plugin-openspec/test/skill-provider.test.ts`, `docs/openspec.md`)

- [x] 1.1 Update the task-lane guidance in `packages/plugin-openspec/assets/guidance/task-lanes.md`: require the owned paths in each level-2 heading or one explicit single-lane reason about the work (shared hot file, generated output, or serial gate), reject a review or archive process as that reason, and add one apply-start lane check; verify the asset contains all three statements and the diff has no other guidance change.
- [x] 1.2 Extend `packages/plugin-openspec/test/skill-provider.test.ts` with assertions for the work-only single-lane reason and the apply-start lane check; verify `pnpm exec vitest run packages/plugin-openspec/test/skill-provider.test.ts` passes.
- [x] 1.3 Update `docs/openspec.md` to describe the plan-time lane check and the work-only single-lane reason; verify `pnpm lint:fix` and that the documented rule matches the asset text.

## 2. Delegation review guidance (owns `packages/plugin-delegation-rules/assets/delegation-rules/review-spec.md`, `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md`, `packages/plugin-delegation-rules/test/assets.test.ts`, `docs/delegation-rules.md`, `AGENTS.md`)

- [x] 2.1 Add the P1 lane-shape criterion to `packages/plugin-delegation-rules/assets/delegation-rules/review-spec.md`: an unlaned multi-group `tasks.md` or a review-process single-lane reason is a finding, and the fix names the work-level reason; verify the instruction states the finding, the evidence, and the fix.
- [x] 2.2 Align `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md`, `AGENTS.md`, and `docs/delegation-rules.md` with the review overlap and the live-worktree fallback: start the task review immediately, keep implementing an independent task only when the run uses a frozen snapshot, and when it reports the live worktree restore snapshot support and re-run or defer writes until the run settles without a blocking sleep; remove the "before the next task" and blocking-sleep wording; verify `pnpm lint:fix` and that the three files state the same rule.
- [x] 2.3 Extend `packages/plugin-delegation-rules/test/assets.test.ts` with assertions for the review-spec lane-shape criterion and the SKILL overlap/fallback text; verify `pnpm exec vitest run packages/plugin-delegation-rules/test/assets.test.ts` passes.

## 3. Always-on plan streams and checkpoint (owns `packages/plugin-working-principles/assets/working-principles/contract.md`, `packages/plugin-working-principles/test/budget.test.ts`, `docs/principles.md`)

- [x] 3.1 Rewrite the "Delegate only to parallelize" paragraph in `packages/plugin-working-principles/assets/working-principles/contract.md` to add the stream rule: before a multi-file or multi-step task, name the independent streams and their owned files, start a worker per stream or state one serial reason. Extend the checkpoint sentence to "a substantial pause and each configured step interval" and add `bottleneck` to the decision fields. Keep "one agent is the default" for the rest and condense the text so the registered section stays within 1500 estimated tokens; verify `pnpm exec vitest run packages/plugin-working-principles/test/budget.test.ts`.
- [x] 3.2 Extend `packages/plugin-working-principles/test/budget.test.ts` with assertions for the stream rule, the serial reason, the one-line exemption, the bottleneck, and the step interval; verify the budget test passes.
- [x] 3.3 Update `docs/principles.md` (the "Plan before the edit" and checkpoint sections plus the size table) with the stream rule, the bottleneck, the interval, and the measured contract size; verify `pnpm lint:fix` and that the documented size matches the budget test.

## 4. Mid-turn checkpoint code (owns `packages/plugin-goal-continuity/src/host/index.ts`, `packages/plugin-goal-continuity/cordis.fragment.yml`, `packages/plugin-goal-continuity/test/checkpoint-trigger.test.ts`, `packages/plugin-goal-continuity/test/checkpoint.test.ts`, `packages/plugin-goal-continuity/test/checkpoint-goal.test.ts`, `packages/plugin-goal-continuity/test/config.test.ts`, `docs/goal-continuity.md`)

- [x] 4.1 Add `stepInterval` (default 40, positive integer range) to the checkpoint config type, resolver, validation, and `cordis.fragment.yml`; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/config.test.ts`.
- [x] 4.2 Count steps per turn from `agent/pre-step` and steer one bounded checkpoint request at each interval for a root turn with a write/worker (or `requireWrite: false`), skipping a checkpoint younger than the interval and a last `ask_user_question`; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/checkpoint-trigger.test.ts`.
- [x] 4.3 Add the required `bottleneck` field to `work_checkpoint` for `continue` (bounded, redacted, stored in the record and summary), ask it in the request, and make the close gate accept only a checkpoint younger than `stepInterval` (a checkpoint 2 steps before the close passes; a stale one requests a new checkpoint); verify `checkpoint.test.ts`, `checkpoint-goal.test.ts`, and `pnpm exec vitest run packages/plugin-goal-continuity/test`.
- [x] 4.4 Update `docs/goal-continuity.md` with the interval, the bottleneck field, the freshness rule, and the config; verify `pnpm lint:fix`.

## 5. Serial tail: generated tree and repository gate (owns `packages/setup/node_modules/@dsh-setup/**`)

- [x] 5.1 Run `pnpm gen` and verify the vendored `task-lanes.md`, `review-spec.md`, `contract.md`, and the goal-continuity fragment/patch under `packages/setup/node_modules/@dsh-setup/**` carry the new text and config; `pnpm gen:check` passes.
- [x] 5.2 Run the four test suites together (`packages/plugin-openspec/test/skill-provider.test.ts`, `packages/plugin-delegation-rules/test/assets.test.ts`, `packages/plugin-working-principles/test/budget.test.ts`, and `packages/plugin-goal-continuity/test`) and fix what fails.
- [x] 5.3 Run `pnpm check`, `pnpm validate:repo`, and `pnpm build && git diff --exit-code`; fix what fails.

## Workflow follow-up

- Apply lane by lane: tick a task only when complete and start its task-review immediately; keep implementing another lane while the review runs, and collect each PASS before the turn closes.
- Run `pnpm reviews:check --change decompose-before-apply` before archiving; every checked task needs a committed task-review PASS.
- Archive only after the owner accepts the text and every checked task has a portable PASS.
