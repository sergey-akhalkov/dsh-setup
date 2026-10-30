# Tasks

## 1. Owner default

- [x] 1.1 Set `agent-default-model.reasoningEffort` to `max` in `packages/setup/defaults.yml`; run
      `pnpm gen` and confirm the generated `packages/setup/cordis.patch.yml` carries `max` with no
      other drift. Verify: `pnpm validate:repo`.
- [x] 1.2 Search `docs/` and `packages/setup/` for a hard-coded `high` default; update the text that
      names the shipped value. Verify: `pnpm lint:fix` then `pnpm lint`.

## 2. Worker targets and rules

- [x] 2.1 Add `worker-fast` (`provider: spawn`, `reasoningEffort: high`) and `worker-deep`
      (`provider: spawn`, `reasoningEffort: max`) to the `targets` map in
      `packages/plugin-delegation-rules/cordis.fragment.yml`, with no `model` key.
- [x] 2.2 Add two manual `answer` rules, `worker-fast` and `worker-deep`, that target those targets.
      Verify: `pnpm gen` and `pnpm gen:check`.
- [x] 2.3 Confirm the generated `packages/plugin-delegation-rules/cordis.patch.yml` and the
      aggregated setup patch list both targets and rules.

## 3. Selection policy

- [x] 3.1 Extend `packages/plugin-delegation-rules/assets/delegation-rules/SKILL.md` with the worker
      selection policy and the three-level effort mapping. Keep the skill within its byte budget
      test. Verify: the asset test.
- [x] 3.2 Update `docs/delegation-rules.md` with the two targets, the two rules, and the policy
      paragraph. Verify: `pnpm lint:fix`.

## 4. Tests

- [x] 4.1 Config test: the shipped default config parses, both worker targets carry the expected
      provider and effort, and both rules are `manual` with the `answer` contract.
- [x] 4.2 Engine test: a worker rule starts on the in-process provider with the configured effort;
      an unavailable provider reports the target next action and satisfies no gate.
- [x] 4.3 Assets test: the bundled skill names both worker rules and the effort mapping.

## 5. Verification

- [x] 5.1 `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:composition`, and
      `pnpm build && git diff --exit-code`.
