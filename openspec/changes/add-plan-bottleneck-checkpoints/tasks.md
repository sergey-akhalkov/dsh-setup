# Tasks

## 1. Checkpoint tool v2 and the lane plan (owns `packages/plugin-goal-continuity/src/host/index.ts`, `packages/plugin-goal-continuity/test/checkpoint.test.ts`, `packages/plugin-goal-continuity/test/checkpoint-harness.ts`, `docs/goal-continuity.md`)

- [x] 1.1 Replace the `work_checkpoint` argument schema with `lanes[]` (id, owner, scope, state, blockedBy) and a `bottleneck` object (id, owner, action, blockingLanes, targets), derive the remaining work from lanes that are not `done`, and validate duplicate ids, an unknown `blockedBy`, an empty scope, an unknown state, and a plan over the 8-lane bound; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/checkpoint.test.ts` covers each rejection and the derived remainder
- [x] 1.2 Write record v2 with `lanes`, `bottleneck`, the derived remainder, and the checkpoint id, keeping the atomic write, bounds, and redaction; read a v1 record without lanes or a bottleneck without an error and without treating it as a satisfied plan; update the record example in `docs/goal-continuity.md`; verify a v1 fixture loads, the next checkpoint writes v2, and the documented example matches a written record
- [x] 1.3 Reject `parallel`, `serialReason`, `remaining`, and `speedup` with a field diagnostic naming the removed field, and name the replacement field in the message; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/checkpoint.test.ts` asserts one rejection per removed field and the diagnostic text

## 2. Computed parallel obligation (owns `packages/plugin-goal-continuity/src/host/index.ts`, `packages/plugin-goal-continuity/test/checkpoint.test.ts`, `packages/plugin-goal-continuity/test/checkpoint-harness.ts`)

- [x] 2.1 Compute `runnable` from `state` and `blockedBy`, compute parallel work as two runnable lanes with different owners and non-overlapping scopes compared by path component (case-insensitive, `\\` and `/` unified, so `src` and `src2` are disjoint, `resource:` scopes compared exactly), and wire the result to the existing tagged-worker requirement; verify tests cover shared scope, a textual sibling scope, a single owner, an unblocked lane with a done dependency, and two disjoint lanes
- [x] 2.2 Re-evaluate the gate from the latest checkpoint in the turn so a later checkpoint whose plan removes the pair satisfies it, and keep `enforceParallel: false` and the no-worker-tool case reporting nothing; verify tests for the amendment, the disabled gate, and the no-worker case

## 3. Executed bottleneck remedy (owns `packages/plugin-goal-continuity/src/host/index.ts`, `packages/plugin-goal-continuity/test/checkpoint-remedy.test.ts`, `packages/plugin-goal-continuity/test/checkpoint-harness.ts`, `docs/goal-continuity.md`)

- [x] 3.1 Track tool calls after the checkpoint and match the bottleneck action with the same `WORKER_START_TOOLS` success classifier the parallel gate uses (cached `delegate` reuse excluded, `send_message` not a start), a successful `edit`/`write` whose normalized `file_path` equals a declared target or lies beneath a declared directory target by path component (so `src2/file.ts` does not match `src`), or `ask_user_question`; refuse the close with a steer naming the bottleneck id, its action, its blocking lanes, and the missing evidence; share `maxBlocks` and the UNCHECKED close; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/checkpoint-remedy.test.ts` covers each action, one case per `WORKER_START_TOOLS` entry through the parallel gate and the remedy gate, an untagged worker, a `send_message`, a cached `delegate`, an exact file target, a directory descendant, a textual sibling target, a failed `edit`, a pending `edit` with no result, a target mentioned only in written content, a target mentioned only in a shell command, a wrong target, and the missing remedy
- [x] 3.2 Keep the `done` outcome exempt, fail open on an unreadable state, and leave the question review unchanged for `user_decision`; document the remedy gate in `docs/goal-continuity.md`; verify the tests for the exempt and fail-open paths and that the documented steers match the test strings

## 4. Bottleneck age (owns `packages/plugin-goal-continuity/src/host/index.ts`, `packages/plugin-goal-continuity/test/checkpoint-age.test.ts`, `packages/plugin-goal-continuity/test/checkpoint-harness.ts`, `docs/goal-continuity.md`)

- [x] 4.1 Read the previous checkpoint record of the same session and count consecutive checkpoints with the same bottleneck owner and the same blocking lane ids; at `bottleneckAge` refuse the close until the owner changes, a blocking lane changes state, or a `user_decision` question was asked; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/checkpoint-age.test.ts` covers the refusal and each escape
- [x] 4.2 Ignore a legacy record without a bottleneck, a record from another session, and an unreadable record without failing the turn; document the age rule and the escapes in `docs/goal-continuity.md`; verify the tests for the three ignored cases

## 5. Request evidence for stalled lanes and age (owns `packages/plugin-goal-continuity/src/host/index.ts`, `packages/plugin-goal-continuity/test/checkpoint-trigger.test.ts`, `docs/goal-continuity.md`)

- [x] 5.1 Name each lane whose state did not change for `laneStaleCheckpoints` checkpoints and the current bottleneck's age in the injected request, while keeping the redaction and the `maxMessageChars` bound; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/checkpoint-trigger.test.ts` asserts a stale lane, an absent stale lane, an aged bottleneck, and a truncated message

## 6. Configuration (owns `packages/plugin-goal-continuity/src/host/index.ts`, `packages/plugin-goal-continuity/test/config.test.ts`, `packages/plugin-goal-continuity/test/package.test.ts`, `docs/goal-continuity.md`)

- [x] 6.1 Add `bottleneckAge` (default 2) and `laneStaleCheckpoints` (default 2) to the resolved config, validation, and docs; fail plugin load with a field diagnostic for a zero, negative, or non-integer value; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/config.test.ts packages/plugin-goal-continuity/test/package.test.ts` covers the defaults and each invalid value

## 7. Always-on contract (owns `packages/plugin-working-principles/assets/working-principles/contract.md`, `packages/plugin-working-principles/test/budget.test.ts`, `docs/principles.md`)

- [x] 7.1 Rewrite the plan, checkpoint, and bottleneck clauses in `contract.md` to describe the lane plan with owners and scopes, its refresh at each checkpoint, the executed remedy before the close, and the route change for a bottleneck surviving a second checkpoint, replacing text so the registered section stays within 1500 estimated tokens; verify `pnpm exec vitest run packages/plugin-working-principles/test/budget.test.ts`
- [x] 7.2 Extend `budget.test.ts` with assertions for the lane plan, the refresh, the executed remedy, and the route change, and update the size table in `docs/principles.md`; verify the budget test passes and `pnpm lint:fix` leaves the documented size matching the measured size

## 8. Observability extraction and plan metrics (owns `packages/plugin-observability/src/host/records.ts`, `packages/plugin-observability/src/host/metrics.ts`, `packages/plugin-observability/src/host/hypotheses.ts`, `packages/plugin-observability/src/host/report.ts`, `packages/plugin-observability/test/records.test.ts`, `packages/plugin-observability/test/metrics.test.ts`, `packages/plugin-observability/test/hypotheses.test.ts`, `packages/plugin-observability/test/report.test.ts`, `docs/plugins.md`)

- [x] 8.1 Replace `checkpointRemainingCount` and `checkpointParallel` in the checkpoint extraction with the lane count, the blocked lane count, the computed parallel flag, the bottleneck action, the bottleneck age, and whether the remedy was matched before the next checkpoint, keeping metadata only (no lane text, owner text, or arguments); verify `pnpm exec vitest run packages/plugin-observability/test/records.test.ts` covers the new fields and the malformed-call cases
- [x] 8.2 Aggregate parallel share, blocked-lane rate, remedy resolution, and dispatch per checkpoint from the extracted metadata in `metrics.ts` and expose them on the existing report surface; verify `pnpm exec vitest run packages/plugin-observability/test/metrics.test.ts packages/plugin-observability/test/report.test.ts` asserts exact values from a known checkpoint and worker sequence, the not-applicable case with no checkpoint, and metadata-only output
- [x] 8.3 Add `parallel-share` and `remedy-resolution` to the fixed metric catalog in `hypotheses.ts` with the increase direction and guardrail, and document the counters and one hypothesis example in `docs/plugins.md`; verify `pnpm exec vitest run packages/plugin-observability/test/hypotheses.test.ts` accepts and evaluates both metrics, rejects an unknown metric, and `pnpm lint:fix` leaves the documented counters matching the extracted fields

## 9. Reference-failure regression (owns `packages/plugin-goal-continuity/test/checkpoint-regression.test.ts`, `packages/plugin-goal-continuity/test/checkpoint-harness.ts`)

- [x] 9.1 Add a harness scenario shaped like the reference session: a v1-style call repeating one serial reason is rejected, two disjoint owned lanes without a tagged worker are refused, a close whose only next action is a wait is refused for the outstanding remedy, and a bottleneck that survives a second checkpoint is refused; verify `pnpm exec vitest run packages/plugin-goal-continuity/test/checkpoint-regression.test.ts` asserts each refusal and its named evidence

## 10. Generated output and integration gate (owns `packages/*/lib/**`, `packages/*/cordis.patch.yml`, `packages/setup/**`)

- [ ] 10.1 Run `pnpm build` and `pnpm gen`, commit the regenerated `lib/**`, `cordis.patch.yml`, and vendored setup tree; verify `pnpm gen:check` passes and `pnpm build && git diff --exit-code` is clean
- [x] 10.2 Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, `pnpm validate:composition`, and `pnpm validate:installer`; verify every command passes
- [x] 10.3 Run `openspec validate add-plan-bottleneck-checkpoints --strict` and fix any reported issue; verify the command reports the change as valid

## Workflow follow-up

- Run the task-scoped review for each checked task and commit its `reviews/<taskId>.json` PASS before archiving.
- Archive the change after the archive gate accepts every checked task.
- Mention the checkpoint tool schema break in the release notes.
