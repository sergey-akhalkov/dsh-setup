# Tasks

## 1. Preconditions and composition inputs

- [x] 1.1 Commit or isolate the in-progress `add-goal-continuity` work before generating setup files; verify `git status` shows no unrelated `packages/setup/**` changes that would enter this change's diff
- [x] 1.2 Remove the `dsh-setup-nuphus-mcp` adapter row from `packages/plugin-nuphus-mcp/cordis.fragment.yml`, remove the matching `dsh-setup-nuphus-mcp` disable entry from `packages/setup/defaults.yml`, keep one enabled `dsh-setup-nuphus-guidance` row, and update the package/locale description; verify the fragment parses, `pnpm gen` emits one row, and `pnpm validate:repo` passes because no default targets the removed row
- [x] 1.3 Remove the `dsh-setup-serena` adapter row from `packages/plugin-serena/cordis.fragment.yml`, keep one enabled `dsh-setup-serena-guidance` row, and update the package/locale description; verify the fragment parses and `pnpm gen` emits one row
- [x] 1.4 Update `packages/plugin-mcp-lazy/locale/en.json` to name `nuphus-mcp` and `serena` as the setup's lazy servers; verify `pnpm validate:repo` accepts the metadata

## 2. Setup composition

- [x] 2.1 Add `serena` to the `packages/setup/defaults.yml` lazy `servers` list with the existing command, arguments, working directory and `toolCallTimeoutMs: 120000`; the Nuphus disable was removed in task 1.2 and no disabled row may remain
- [x] 2.2 Run `pnpm gen` and inspect `packages/setup/cordis.patch.yml` and the vendored copies: two lazy servers, two enabled guidance rows, no `@deepseek-ai/dsh-mcp-client` row, no `disabled`; verify `pnpm gen:check` passes
- [x] 2.3 Update `scripts/validate-composition.ts`: assert both lazy servers, both guidance rows, no static adapter row, and the Nuphus confirmation argument; verify `pnpm validate:composition` passes (needs the DSH CLI and network)
- [x] 2.4 Rewrite `scripts/test/adapter-guidance.test.ts` for the guidance-only bundles and the setup lazy configuration; verify `pnpm exec vitest run scripts/test/adapter-guidance.test.ts` passes
- [x] 2.5 Update the synthetic examples in `scripts/test/{fragments,generate,dogfood}.test.ts` that reference the removed rows; verify `pnpm test` passes
- [x] 2.6 Teach the dogfood owner-row check to treat `dsh-setup-nuphus-mcp` and `dsh-setup-serena` as explicitly retired rows: add the retired-row set to `scripts/lib/dogfood.ts`, pass the two ids from `scripts/dogfood.ts`, and add regression coverage in `scripts/test/dogfood.test.ts` for a retired row disappearing (allowed) versus another owner-patched row disappearing (still fails); verify `pnpm exec vitest run scripts/test/dogfood.test.ts` passes and the live profile is not written

## 3. Serena guidance

- [x] 3.1 Rewrite `packages/plugin-serena/assets/serena-discipline/rules.md` as the narrow trigger: large-file/cross-file refactor work only, load the skill first, keep ordinary reads/text/configuration/generated files on `grep`/`glob`/`read`/`edit`, `search_for_pattern` only as a fallback, and keep the "stop serena guidance" sentence; verify the section test
- [x] 3.2 Rewrite `packages/plugin-serena/assets/serena-discipline/SKILL.md` to carry the lazy invocation (`mcp_tools`, `mcp_call`, `activate_project`), the symbol tool names, the bounded-call rule, the small-file `read` guidance, the generated-output boundary, and the unavailable-server fallback; update the catalog description and the adapter note in `src/host/index.ts`; verify `pnpm build` and the skill-provider test
- [x] 3.3 Lower the Serena rule budget in `test/budget.test.ts` to 200 estimated tokens and update the size range; update the expected phrases in `test/section.test.ts`; verify `pnpm exec vitest run packages/plugin-serena/test` passes
- [x] 3.4 Verify the assembled prompt contains the trigger, the catalog lists `serena-discipline`, the rule names no `mcp__serena__*` tool, and the skill loads on demand; verify with the package tests and `pnpm typecheck`

## 4. Nuphus guidance

- [x] 4.1 Update `packages/plugin-nuphus-mcp/assets/nuphus-discipline/SKILL.md` (and its locale/package description) for the lazy-only path: server `nuphus-mcp`, `mcp_tools`/`mcp_call`, `--confirm-write`, 120000 ms timeout, screenshot-to-path plus `read_image`, and no shipped static row
- [x] 4.2 Verify the Nuphus guidance row is enabled, the skill is cataloged, and the text contains no stale static-adapter instructions; verify the package tests and `pnpm typecheck`

## 5. Documentation, README, and market metadata

- [x] 5.1 Rewrite `docs/serena.md` for the lazy-only setup, the trigger/skill split, the opt-out (`alwaysOn: false`, disable the guidance row, remove the lazy entry), and the measured prompt cost
- [x] 5.2 Update `docs/lazy-mcp.md` for two shipped servers, no static adapter rows, the one-home guard, the profile-override rule that restates the complete `servers` list, and the confirmation/timeout
- [x] 5.3 Update `docs/install.md` (Serena/Nuphus sections and prerequisites), `docs/plugins.md` (guidance-only bundles and the optional adapter capability), `docs/setup-composition.md` (no shipped disabled row; the two-server lazy example), `docs/principles.md` and `docs/rtk.md` (Serena budget 0.2k and the combined cost)
- [x] 5.4 Update `docs/codex-subagent.md`, `packages/plugin-codex-subagent/README.md`, `README.md`, and `AGENTS.md` for the removed static adapter rows, the lazy-only setup, the new plugin roles, and the current-state history; verify `pnpm lint:fix` and `pnpm validate:repo`
- [x] 5.5 Update the market locale for both guidance bundles and the lazy plugin so the cards state that the server comes from the lazy row; verify `pnpm validate:repo`

## 6. Specs and integration

- [x] 6.1 Validate the `session-guidance`, `lazy-mcp`, and `portable-setup` deltas with `openspec validate "lazy-only-mcp-servers"`; after implementation review, sync them into `openspec/specs/` and verify the main specs
- [x] 6.2 Run the repository gate and record the result: `pnpm build`, `git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, `pnpm validate:composition`
- [x] 6.3 Live acceptance by the owner, never by an agent-hosted session: fully quit and relaunch the Desktop app, verify no Off cards, `mcp_tools` lists both servers, no `mcp__nuphus-mcp__*`/`mcp__serena__*` schema appears, a Nuphus write without confirmation fails, the Serena trigger fires on a large-file refactor, the skill activates the project through `mcp_call`, a small-file read stays on `read`, and a screenshot saved to a path reads back with `read_image`
- [ ] 6.4 Verify the live one-home guard by adding a static adapter row for one server in a throwaway profile: the lazy call fails with the one-home error and starts no second process
- [x] 6.5 Run `pnpm dogfood` against a copy of the live profile after implementation; verify the copied composition shows both lazy servers and no static rows, the retired-row exception is covered by the new regression tests, and the live profile files are byte-identical

## Workflow follow-up

- Sync the `session-guidance`, `lazy-mcp`, and `portable-setup` deltas into the main specs, then archive the change after the review requirements are satisfied.
- Include the change in the next set release; verify the market cards (guidance-only bundles, two lazy servers) and the installer update path on a throwaway profile.
- The owner re-runs the live acceptance after the release; the agent never restarts the Desktop app.
