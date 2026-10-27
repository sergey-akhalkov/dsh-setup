# Tasks

## 1. Fragment schema

- [x] 1.1 Add `disabled?: boolean` to `FragmentRow`, accept it in `parseCompositionFragment`, and reject a non-boolean value; verify `pnpm exec vitest run scripts/test/fragments.test.ts scripts/test/generate.test.ts` passes with the new cases.
- [x] 1.2 Extend the generation tests to assert a disabled row renders into both the plugin patch and the setup patch; verify the tests pass and `pnpm typecheck` is clean.

## 2. Ship Serena disabled

- [x] 2.1 Add `disabled: true` to both rows of `packages/plugin-serena/cordis.fragment.yml`; run `pnpm gen` and verify `packages/plugin-serena/cordis.patch.yml` and `packages/setup/cordis.patch.yml` contain the disabled entries, `pnpm gen:check` passes, and the vendored setup copies match.

## 3. Documentation and verification

- [x] 3.1 Document the disabled default and the two `disabled: false` enable overrides in `docs/serena.md`, `docs/plugins.md`, `docs/setup-composition.md`, `AGENTS.md`, `packages/plugin-serena/locale/en.json`, and the README plugin row; verify `pnpm lint` passes and every quoted override parses as the documented YAML.
- [x] 3.2 Run `pnpm check`, `pnpm gen:check`, and `pnpm validate:repo`; verify all three pass on a clean tree and the generated files are committed.

## Workflow follow-up

- Fully restart DeepSeek Harness, then confirm a new session has no `mcp__serena__*` tools and no code-surface rule until a profile patch enables the rows.
- Release the set version and verify the market card states the disabled default.
