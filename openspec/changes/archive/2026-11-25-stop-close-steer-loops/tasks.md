# Tasks

## 1. Turn-close delivery budget (lane 1, owns `packages/plugin-workflows/src/host/index.ts`, `packages/plugin-workflows/test/host-wiring.test.ts`)

- [x] 1.1 Make the engine-owned progress and lane refusals spend the existing per-session, per-turn delivery view: steer only while it has room, spend on submit, and at the bound submit nothing and let the turn end. Verify with a `host-wiring.test.ts` case that emits `maxBlocks + 2` turn-stopping events for an unchanged refusing state and asserts exactly `maxBlocks` `workflows-gate` messages and a final close with none.
- [x] 1.2 Assert the budget is shared across sites: a review refusal that spends the last unit leaves no owned refusal in that turn, and an owned refusal that spends it leaves no review steer. Verify with `host-wiring.test.ts` cases counting the steers per site.
- [x] 1.3 Cover the lane-assignment and parity-report refusals through the same bounded branch: their steers stop at the same bound. Verify with a `host-wiring.test.ts` case for a lane refusal and one for an uncertified parity report.
- [x] 1.4 Pin the independent budgets and the per-turn scope: after the shared bound is exhausted, an open checkpoint or run-step obligation still spends its own `turnBlocks` budget and allows one close recorded as a `VIOLATION`; a later turn that changes no implementation file is not refused by the progress gate, and a later turn that writes again refuses under a fresh budget. Verify with `host-wiring.test.ts` cases driving those turn sequences.

## 2. State-derived progress refusal (lane 2, owns `packages/plugin-workflows/src/host/engine-gates.ts`, `packages/plugin-workflows/test/owned-gates.test.ts`)

- [x] 2.1 Offer the tick-plus-review remedy only while an unchecked task exists; when every task is checked, offer only the `note` remedy and name a checked task by its 16-character id. Verify in `owned-gates.test.ts` that the all-checked refusal contains the task id and no tick instruction, and the unchecked refusal keeps the start call.
- [x] 2.2 Report the observed state: `no progress note for this change` when no note exists and no digest claim, the unreadable-digest cause when git fails, and the existing stale sentence naming both digests when they differ. Verify in `owned-gates.test.ts` with one assertion per state.
- [x] 2.3 Keep the digest read out of the no-note path: a refusing close without a note performs no extra git call. Verify in `owned-gates.test.ts` with a counting git runner.

## 3. Documentation and generated output (serial after sections 1-2, owns `docs/workflows.md`, `packages/plugin-workflows/lib/**`, `packages/setup/node_modules/@dsh-setup/plugin-workflows/**`)

- [x] 3.1 Update `docs/workflows.md` for the bounded turn-close refusal, the independent checkpoint and run-step budgets, and the state-derived work-progress refusal, then run `pnpm lint` to confirm the markdown passes.
- [x] 3.2 Run `pnpm build` and `pnpm gen`, then confirm `pnpm gen:check` and `pnpm validate:repo` pass and that the committed generated output matches its sources.

## 4. Verification (serial, owns `openspec/changes/stop-close-steer-loops/tasks.md`)

- [x] 4.1 Run `pnpm check` (typecheck, lint, build, tests) and confirm the whole gate is green.
- [x] 4.2 Run `openspec validate stop-close-steer-loops --strict` and `pnpm reviews:check --change stop-close-steer-loops`, and confirm the delta is valid and every checked task has its record before archiving.

## Workflow follow-up

- Archive under the repository procedure; an archived change is a release request.
- Refs #18: this change removes the engine cause of the deadlock but does not adopt the issue's suggestion that a whole-scope `PASS` satisfy the progress gate, so the issue stays open and the deferred question lives in `design.md`.
