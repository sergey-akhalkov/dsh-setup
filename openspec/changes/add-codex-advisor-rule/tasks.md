# Tasks

## 1. Advisor rule and strong Codex defaults

- [x] 1.1 Add `packages/plugin-delegation-rules/assets/delegation-rules/advisor.md` with the read-only, one-decision answer shape (recommendation, strongest counterargument, risks, next action, confidence), add it to the plugin's `files` list, and add an asset-shape test; verify `pnpm exec vitest run packages/plugin-delegation-rules/test/assets.test.ts` passes.
- [x] 1.2 Add the `advisor` rule (`manual`, `answer`, `gate: none`, `to: codex-astra`, `instruction: bundled:advisor`) and set `model: gpt-6-astra` with `reasoningEffort: xhigh` on the `codex` and `codex-write` targets while keeping `codex-astra`; update the default-target/rule expectations in `packages/plugin-delegation-rules/test/config.test.ts` and verify that test passes.

## 2. Model-facing policy

- [x] 2.1 Update the `delegate` tool description and the `context` parameter description with the advisor's when-to-use/when-not policy and the soft three-call ceiling, and add the same policy plus the `advisor` row to `assets/delegation-rules/SKILL.md`; verify the model-facing budget tests in `packages/plugin-delegation-rules/test/assets.test.ts` pass.

## 3. Documentation

- [x] 3.1 Update `docs/delegation-rules.md` (default-rule table, target defaults, override path, cost caveat, measured byte counts) and `docs/codex-subagent.md` (the shipped target values and how to override them); verify the documentation assertions in `packages/plugin-delegation-rules/test/assets.test.ts` pass.

## 4. Generated artifacts

- [x] 4.1 Run `pnpm gen` and verify the regenerated `cordis.patch.yml`, `packages/setup/cordis.patch.yml`, and vendored setup tree contain the advisor rule, the strong target values, and the new prompt; verify `pnpm gen:check` passes.

## 5. Integration checks

- [x] 5.1 Run `pnpm build`, the targeted delegation-rules tests, `pnpm typecheck`, `pnpm lint`, and `openspec validate --change add-codex-advisor-rule --strict`; verify all commands pass and `git diff` contains only the intended generated and handwritten files.

## Verification

- `pnpm build` passed: 15 workspace packages and 1 client bundle.
- `rtk vitest run packages/plugin-delegation-rules/test` passed: 200 tests, 0 failures, 39 suites.
- `pnpm typecheck` passed.
- `pnpm lint` checked 249 files with no errors (3 pre-existing warnings and 7 infos).
- `openspec validate "add-codex-advisor-rule" --type change --strict` passed. The installed CLI does not accept the task text's `--change` spelling.
- `pnpm gen:check` passed: 263 generated files match 15 plugins.
- Complete changed-file set: `docs/codex-subagent.md`; `docs/delegation-rules.md`; `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md`; `packages/plugin-delegation-rules/cordis.fragment.yml`; `packages/plugin-delegation-rules/cordis.patch.yml`; `packages/plugin-delegation-rules/lib/host/index.d.ts`; `packages/plugin-delegation-rules/lib/host/index.js`; `packages/plugin-delegation-rules/package.json`; `packages/plugin-delegation-rules/src/host/index.ts`; `packages/plugin-delegation-rules/test/assets.test.ts`; `packages/plugin-delegation-rules/test/config.test.ts`; `packages/setup/cordis.patch.yml`; `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/assets/delegation-rules/SKILL.md`; `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/cordis.fragment.yml`; `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/cordis.patch.yml`; `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/lib/host/index.d.ts`; `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/lib/host/index.js`; `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/package.json`; new `openspec/changes/add-codex-advisor-rule/`; new `packages/plugin-delegation-rules/assets/delegation-rules/advisor.md`; new `packages/setup/node_modules/@dsh-setup/plugin-delegation-rules/assets/delegation-rules/advisor.md`.

## Workflow follow-up

- The owner installs the updated setup outside this agent session; the live desktop profile does not change from this repository edit.
- After install, smoke test one small `delegate(rule: "advisor", context: "…")` call. If `gpt-6-astra` is unavailable, override `codex`, `codex-write`, or `codex-astra` in the profile and retry.
- Before archive, run `pnpm reviews:check --change add-codex-advisor-rule` and complete the project's review requirements.
