# Tasks

## 1. Dependency install (serial, owns `packages/plugin-codex-subagent/package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`)

- [x] 1.1 Bump `@openai/codex` to `0.170.0` in `packages/plugin-codex-subagent/package.json` and list `0.170.0` plus its six platform packages in `pnpm-workspace.yaml` `minimumReleaseAgeExclude`; then run `pnpm install`. Verify `pnpm-lock.yaml` resolves `@openai/codex@0.170.0` and `@openai/codex@0.170.0-win32-x64`, and `npm view "@openai/codex@0.170.0-win32-x64" version` reports the platform package.

## 2. Package metadata, tests, and documentation (lane 2, owns `packages/plugin-codex-subagent/NOTICE`, `packages/plugin-codex-subagent/locale/en.json`, `packages/plugin-codex-subagent/README.md`, `packages/plugin-codex-subagent/test/codex-subagent.test.ts`, `packages/plugin-codex-subagent/test/live-acceptance.manual.ts`, `docs/codex-subagent.md`, `README.md`)

- [x] 2.1 Update `NOTICE`, `locale/en.json`, the package README, the pinned-dependency assertion, the status expectations, and the live acceptance target model to `0.170.0` and `gpt-6.2-astra`. Verify `pnpm exec vitest run packages/plugin-codex-subagent/test` passes, `rtk git grep -n "0\.169\.0" -- packages/plugin-codex-subagent` returns no match, and `rtk git grep -n "gpt-6-astra" -- packages/plugin-codex-subagent/README.md packages/plugin-codex-subagent/test/live-acceptance.manual.ts` returns no match. The unit fixtures may keep an arbitrary model id.
- [x] 2.2 Update `docs/codex-subagent.md` and the root `README.md`: the bundled version, the model examples and default text, the app-server verification section, and the cost text. Verify `rtk git grep -n "0\.169\.0\|gpt-6-astra" -- README.md docs/codex-subagent.md` returns no match, and every relative link in the touched docs resolves.

## 3. Reviewer default and review posture (lane 3, owns `packages/setup/defaults.yml`, `scripts/test/setup-release.test.ts`, `packages/plugin-workflows/assets/reviews/review-task.md`, `packages/plugin-workflows/assets/reviews/review-spec.md`, `packages/plugin-workflows/assets/reviews/review-integration.md`, `packages/plugin-workflows/test/assets.test.ts`)

- [x] 3.1 Change `reviewers.codex.model` to `gpt-6.2-astra` in `packages/setup/defaults.yml` (keep `provider` and `reasoningEffort: xhigh`) and update the `scripts/test/setup-release.test.ts` expectation to `gpt-6.2-astra`. Verify `rtk git grep -n "gpt-6-astra" -- packages/setup/defaults.yml scripts/test/setup-release.test.ts` returns no match; task 4.1 refreshes the generated patch and runs the test.
- [x] 3.2 Add a `## Review posture` section to the three bundled review instructions and extend `packages/plugin-workflows/test/assets.test.ts` to assert it in every id. Verify `pnpm exec vitest run packages/plugin-workflows/test/assets.test.ts` passes and each instruction names the posture, the no-questions rule, and the single JSON block.

## 4. Generation, full gate, and live acceptance (serial, owns generated `packages/setup/package.json`, `packages/setup/cordis.patch.yml`, `packages/setup/node_modules/@dsh-setup/**`, the full repository gate, and the live acceptance)

- [x] 4.1 Run `pnpm gen` after every source edit, including task 3.2, so the vendored tree carries the bumped metadata, the new model, and the review posture. Verify `pnpm gen:check` passes, the regenerated `packages/setup/cordis.patch.yml` carries `model: gpt-6.2-astra`, and `pnpm exec vitest run scripts/test/setup-release.test.ts` passes.
- [ ] 4.2 Run `pnpm build && git diff --exit-code`, `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, and `pnpm validate:installer`; verify every command exits 0.
- [x] 4.3 Run the live acceptance with the owner's `~/.codex` login and the `gpt-6.2-astra` target: `codex_subagent_status` reports `0.170.0`, one authenticated delegation completes, and a signed-out run reports the login next action. Record the observed result.
- [x] 4.4 Run `openspec validate update-codex-cli-and-reviewer-model --strict` and verify it exits 0.

## Workflow follow-up

- Sync the delta specs into `openspec/specs/` when archiving, and run `pnpm reviews:check --change update-codex-cli-and-reviewer-model` before the archive.
- Release the change with the next version bump.
