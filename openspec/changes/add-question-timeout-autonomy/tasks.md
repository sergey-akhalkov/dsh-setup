# Tasks

## 1. Contract policy and budget — packages/plugin-working-principles

- [x] 1.1 Add the pending policy and the never-ask-continue rule to `packages/plugin-working-principles/assets/working-principles/contract.md`, trimming about 660 bytes of redundant prose while preserving every phrase the existing budget test asserts. Verify with `pnpm exec vitest run packages/plugin-working-principles/test/budget.test.ts` at the new 1 500-token cap.
- [x] 1.2 Tighten `packages/plugin-working-principles/test/budget.test.ts`: set `BUDGET_TOKENS = 1500`, derive `MAXIMUM_BYTES` from the footer and the budget, and assert the pending policy and the never-ask-continue rule. Verify the test fails on the untrimmed contract and passes on the trimmed one.

## 2. Goal-continuity pending evidence — packages/plugin-goal-continuity

- [x] 2.1 Add the pending-result case to `packages/plugin-goal-continuity/test/resume-evidence.test.ts`: a `user_decision` checkpoint, a recorded ask result with `pending: true`, and a completed turn must leave the goal active without a stop notice. The test stays at the supervisor boundary: it does not execute the ask tool or its timer and asserts only the decision on the recorded result. Verify with `pnpm exec vitest run packages/plugin-goal-continuity/test/resume-evidence.test.ts`.
- [x] 2.2 Update the `latestCheckpointPlan` comment in `packages/plugin-goal-continuity/src/host/index.ts` so a pending result is named as plan freshness, not an answer and not permission; change behavior only if 2.1 shows a stop. Verify with the full `packages/plugin-goal-continuity/test` suite.

## 3. Documentation — docs/

- [x] 3.1 Add `docs/autonomy.md` with the exact preset row, the Agent Preset editor route, the new-session rule, the 10-second acceptance, the `-1` exception, the preset-copy caveat, and the limits (goal-round-only question review, loop-guard stops). Verify with `pnpm lint:fix` and the Markdown formatting.
- [x] 3.2 Link the page from the goal-continuity section of `docs/plugins.md` and from `docs/install.md`; verify the links resolve and no duplicate guidance is introduced.

## 4. Validation — serial integration gate

- [x] 4.1 Run `pnpm check`, `pnpm gen:check`, and `pnpm validate:repo`; verify all pass.
- [x] 4.2 Run `openspec validate add-question-timeout-autonomy --strict`; verify it passes.
- [x] 4.3 Runtime acceptance after the owner applies the timed preset to the active profile and starts a new session: a `timeout: 10` question returns `pending` and the turn continues; a `timeout: -1` question remains unresolved until the user answers or cancels; the card shows the countdown; a late answer steers the agent. This is the only check that executes the timed tool and its timer; record the session id and the observed results.
- [x] 4.4 Re-read the contract policy, the budget test, the goal-continuity test, and the docs against the spec deltas; verify every acceptance criterion in the session-guidance and goal-continuity deltas is covered by a test or the 4.3 runtime acceptance.

## 5. Configurable timed question — serial (shared: setup defaults, contract, docs)

- [x] 5.1 Create `packages/plugin-question-timeout` as a Host-only bundle with row config `timed` (default true) and `timeout` seconds (default 300); on apply, for every `preset-*` entry whose inherited config carries a `tool-ask-user` row, commit `ctx.configEditor.edit(entry, (current, inherited) => next)` with `next` derived from `inherited` (never from the plugin's own persisted row) and that row set to `mode: timed` plus the timeout; with `timed` false return `inherited` so the editor deletes the managed row; skip a preset whose profile patch holds a different override and log it once; fail open with one warning when the service is absent. Verify with unit tests for derive, restart idempotence, upstream-list change, timed-off restore, foreign override, and no-service.
- [x] 5.2 Read `timed`/`timeout` from the watched profile settings file `.dsh-setup-question-timeout.json` (created with the row defaults on first activation, file wins over the row config), re-derive on every save, and run the edits from a deferred task outside activation and any HMR transaction; verify with tests for the file round-trip, file-wins precedence, and the deferred apply path.
- [x] 5.3 Add the bundle to the setup: dependency in the setup manifest sources, a `dsh-setup-question-timeout` row with `{ timed: true, timeout: 300 }` in `packages/setup/defaults.yml`, run `pnpm gen`, and commit the regenerated patch and vendored tree; verify `pnpm gen:check`.
- [x] 5.4 Add the configurability rule to `packages/plugin-working-principles/assets/working-principles/contract.md`, trim the contract to stay within the 1 500-token budget, assert the rule in `test/budget.test.ts`, and update the measured size in `docs/principles.md`.
- [x] 5.5 Update `docs/autonomy.md` and `docs/plugins.md`: the setup owns the timed row, the watched settings file is the supported knob, and a manual profile override is the documented fallback; verify the links and that no duplicate guidance appears.
- [x] 5.6 Run `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `openspec validate add-question-timeout-autonomy --strict`; verify all pass.
- [x] 5.7 Remove the hand-written `preset-standard` override from the dev profile patch, since the bundle skips a foreign override; verify the plugin then derives the shipped declaration and a new session still composes the timed tool.
- [x] 5.8 Runtime acceptance in a new session: edit `.dsh-setup-question-timeout.json` to `timeout: 20`, open a new session, and ask a question **without** a `timeout` parameter — observe the deadline, `pending`, and the turn continuing; set `timed: false` and confirm the next session's tool blocks; record both session ids and the observed results.
