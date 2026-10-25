# Tasks

## 1. Adapter row support in the composition generator

- [x] 1.1 Extend `FragmentRow` and `parseCompositionFragment` in `scripts/lib/fragments.ts` with an optional row `name` that accepts only `@deepseek-ai/dsh-mcp-client`; keep deriving the owning package name when it is omitted. Verify with `pnpm exec vitest run scripts/test/fragments.test.ts`, including acceptance of the approved name and rejection of an unapproved one.
- [x] 1.2 Reject a foreign adapter row when the package declares `main`, `types`, or `dsh.client` in `computeGenerated` (`scripts/lib/generate.ts`), with an error that names the package and row. Verify with a focused case in `scripts/test/generate.test.ts` and by confirming a normal code-bearing plugin still generates its own row.
- [x] 1.3 Update the composition rules in `docs/plugins.md` and `AGENTS.md` to document the configuration-only exception: a fragment may name only the approved Harness adapter package, and only when the package has no Host or Client entry. Verify the text matches the implemented behavior and `pnpm lint` passes.

## 2. Serena adapter bundle

- [ ] 2.1 Scaffold `packages/plugin-serena` with a configuration-only `package.json`, `cordis.fragment.yml`, `locale/en.json`, and an original `icon.svg`; the fragment carries the pinned `uvx --from serena-agent==1.7.0` command, the IDE tool context, the disabled dashboard, the raised tool-call timeout, and boot-safe startup behavior. Verify the manifest declares `dsh.bundle.patch` with no `main`, `types`, or `dsh.client`, and that `pnpm gen` parses the fragment without an error.
- [ ] 2.2 Document the bundle in `docs/install.md` (the `uv` prerequisite, first-run download, activation) and `docs/plugins.md` (the configuration-only adapter pattern, the profile-level override, the one-instance-per-profile limit). Verify the documented commands and paths match the shipped fragment, and `pnpm lint` passes.

## 3. Generated setup composition

- [x] 3.1 Run `pnpm gen` and commit the generated `packages/plugin-serena/cordis.patch.yml`, the updated `packages/setup/package.json` and `packages/setup/cordis.patch.yml`, and the vendored `packages/setup/node_modules/@dsh-setup/plugin-serena/**` tree. Verify `pnpm gen:check` passes and the setup patch contains the `dsh-setup-serena` row with the adapter package name.
- [x] 3.2 Add `dsh-setup-serena` and `@deepseek-ai/dsh-mcp-client` to the composition markers in `scripts/validate-composition.ts`. Verify `pnpm validate:composition` composes the setup into a throwaway profile and reports the row.

## 4. Verification

- [x] 4.1 Run the full local gate: `pnpm build`, `git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, and `pnpm validate:composition`. Verify every step passes and no generated file is left uncommitted.
- [x] 4.2 Smoke-test the real integration in a throwaway profile: install `packages/plugin-serena`, start the Harness, call `mcp__serena__get_current_config`, activate the test workspace with `mcp__serena__activate_project`, and call `mcp__serena__get_symbols_overview` on a source file. Verify the tools appear and the project activates; record the observed startup time and the first-run download step. See `verification.md` for the headless credential limitation and the direct MCP result.
- [x] 4.3 Run the market dry run with `node scripts/generate-market.ts --output .tmp/market-serena`; verify the index lists `@dsh-setup/plugin-serena` with its English title, description, relative icon, version, `engines.dsh`, and git path, then remove `.tmp/market-serena`.

## 5. Release readiness

- [ ] 5.1 Bump the set version with `pnpm release:prepare --version X.Y.Z`, run `pnpm gen`, `pnpm build`, and the full gate; verify `git diff --exit-code` and `pnpm gen:check` pass with the version bump and regenerated setup manifest/vendored files committed.

## Workflow follow-up

- Sync the `mcp-adapters` and `portable-setup` deltas into `openspec/specs/` after the implementation is verified.
- Archive this change after the project's review requirements are satisfied.
- Tag and publish the release from an external shell, then verify the Pages market lists the new bundle and that a setup installation contains the Serena row.
