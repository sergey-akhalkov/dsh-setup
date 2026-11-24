# Tasks

## 1. Supervisor source and docs (owns packages/plugin-goal-continuity/src/host, docs/plugins.md)

- [x] 1.1 In `packages/plugin-goal-continuity/src/host/index.ts`, give the reset cause its own non-terminal suppression (`loop-guard-reset`) and one bounded notice, set it only when the preceding continuation decision left no suppression, keep the existing disarm, and stop scheduling a reset resume; verify with a supervisor test asserting the reset turn end resumes nothing, delivers one notice, leaves the goal disarmed and the phase `active`.
- [x] 1.2 Keep the generic `continueAtCap` reconcile path untouched and make the reset notice state the cap prerequisite when the goal is at or above `maxGoalRounds`; verify with a test that a capped reset resumes nothing and that a later direct user message extends the cap and continues.
- [x] 1.3 Add the regression that a done plan or a `user_decision` bottleneck on a reset round keeps its own cause and single notice with no reset notice; verify with `pnpm exec vitest run packages/plugin-goal-continuity/test/supervisor.test.ts packages/plugin-goal-continuity/test/resume-evidence.test.ts`.
- [x] 1.4 Update the goal-continuity section of `docs/plugins.md` so it states that a loop-guard reset stops continuation, keeps an earlier stop's notice, and names the recovery per cap state; verify with `pnpm lint`.

## 2. Verification (owns packages/plugin-goal-continuity/test, packages/plugin-goal-continuity/lib)

- [x] 2.1 Run the full package suite with `pnpm exec vitest run packages/plugin-goal-continuity/test`; verify every test passes and no test expects a reset resume.
- [x] 2.2 Run `pnpm build`, `pnpm check` and `pnpm gen:check`; verify the committed build output matches the changed sources and the generated plugin patch is unchanged.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied.
- Release after the archive, per the repository's standing release rule.
