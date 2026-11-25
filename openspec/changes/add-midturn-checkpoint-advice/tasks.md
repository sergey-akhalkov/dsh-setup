# Tasks

Lane plan: one serial lane owned by `lead` over the shared scope
`packages/plugin-goal-continuity/**`, `packages/setup/**`, `docs/**`, and `scripts/**`. The trigger
and the request composer live in the same `index.ts`, and the setup default depends on the config
field, so the sections are phases of one lane, not independent lanes.

## 1. Config and trigger

- [x] 1.1 Add `periodic` to the checkpoint config type, the resolved config, and the defaults (`false`), and validate it as a boolean; verify `packages/plugin-goal-continuity/test/config.test.ts` covers the default and the fail-loud non-boolean diagnostic.
- [x] 1.2 Register the pre-step and shell-observation listeners when `automation || periodic`, keep the turn-stopping close gate behind `automation` alone, and steer the request only through the periodic path; verify `packages/plugin-goal-continuity/test/checkpoint-automation.test.ts` covers automation `false` + periodic `true` (one request) and both `false` (none).
- [x] 1.3 Keep the interval guards intact: no request within `stepInterval` of a successful checkpoint, no `ask_user_question` last call, no subagent turn, no idle start, and `requireWrite` enforced; verify the added cases in `checkpoint-trigger.test.ts` pass.
- [x] 1.4 Pass the pre-step abort signal through `evaluateStep` to the existing `steer` helper, suppress a request after the signal aborts, and remove a queued request on abort; verify the stopped-turn tests (abort before the interval; queued request removed) pass with `automation: false` and `periodic: true`.

## 2. Signal and suggestion

- [x] 2.1 Track the last successful worker start's step and the written paths' distinct first path components in the turn evidence; verify `packages/plugin-goal-continuity/test/checkpoint.test.ts` asserts the `Steps since last worker` and `Written groups` lines.
- [x] 2.2 Compose the conditional suggestion with the exact sentence (two groups, no worker start, "if they are independent", serial otherwise); verify the test covers present with two groups, absent with a worker start, absent with one group, and absent with no write.
- [x] 2.3 Make the suggestion the first text dropped under `maxMessageChars` and keep the questions tail; verify the small-bound test and the existing redaction test pass.
- [x] 2.4 Confirm the request still writes no new record or log and stays attributed to `goal-continuity`; verify the existing attribution test passes unchanged.

## 3. Setup defaults and documentation

- [x] 3.1 Set `checkpoint.periodic: true` (with `automation: false`) in `packages/setup/defaults.yml`, run `pnpm build` and `pnpm gen`, and commit the regenerated setup patch; verify `pnpm gen:check` passes and the generated `packages/setup/cordis.patch.yml` carries both values.
- [x] 3.2 Extend `scripts/test/fresh-workspace.test.ts` to assert `periodic: true` in the generated goal-continuity config; verify that test passes.
- [x] 3.3 Update `docs/principles.md`, `docs/goal-continuity.md`, and `docs/plugins.md` to describe the notice-only switch, the signal, and the conditional suggestion; verify `pnpm lint` passes on the edited Markdown.

## 4. Integration verification

- [x] 4.1 Run `pnpm exec vitest run packages/plugin-goal-continuity/test` and verify every test passes.
- [x] 4.2 Run `pnpm check` and verify typecheck, lint, build, and tests pass.
- [x] 4.3 Run `pnpm build && git diff --exit-code` and `pnpm gen:check`, and verify no drift.
- [x] 4.4 Run `pnpm validate:repo` and `openspec validate add-midturn-checkpoint-advice --strict`, and verify both pass.

## Workflow follow-up

- Every checked task needs a committed task-review PASS before archival; run `pnpm reviews:check --change add-midturn-checkpoint-advice`.
- Run the repo's spec/integration reviews for the change, then archive; archiving is the standing release request.
