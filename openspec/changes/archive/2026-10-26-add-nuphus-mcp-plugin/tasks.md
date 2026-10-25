# Tasks

## 1. Nuphus adapter bundle

- [x] 1.1 Scaffold `packages/plugin-nuphus-mcp` with a configuration-only `package.json` (no `main`, `types`, or `dsh.client`, no dependencies, no install-time script), `cordis.fragment.yml`, `locale/en.json`, and an original `icon.svg`. The fragment carries the `dsh-setup-nuphus-mcp` row that mounts `@deepseek-ai/dsh-mcp-client` with `serverName: nuphus-mcp`, `command: nuphus-mcp`, `args: ["--confirm-write"]`, `toolCallTimeoutMs: 120000`, and `failOnStartupError: false`, satisfying the new `Strict confirmation` requirement. Verify `pnpm gen` parses the fragment and `pnpm validate:repo` reports no manifest, fragment, or engine problem.
- [x] 1.2 Document the bundle in `docs/install.md` (the `npm install -g @nuphus/nuphus-mcp` prerequisite and PATH requirement, the boot-without-binary behavior, the tool inventory, Chrome/Edge for browser tools, platform limits, the confirmation default with the relax/disable overrides, the BYOK vision key override through `!!js`, the one-instance-per-profile limit, and the warning not to combine it with the upstream `dsh-nuphus-mcp` plugin) and name it as the second configuration-only example in `docs/plugins.md`. Verify the documented row configuration matches the shipped fragment field for field and `pnpm lint` passes.

## 2. Generated setup composition

- [x] 2.1 Run `pnpm gen` and commit the generated `packages/plugin-nuphus-mcp/cordis.patch.yml`, the updated `packages/setup/package.json` and `packages/setup/cordis.patch.yml`, and the vendored `packages/setup/node_modules/@dsh-setup/plugin-nuphus-mcp/**` tree. Verify `pnpm gen:check` passes and the setup patch contains the `dsh-setup-nuphus-mcp` row mounting `@deepseek-ai/dsh-mcp-client`.
- [x] 2.2 Add `dsh-setup-nuphus-mcp` to the composition markers in `scripts/validate-composition.ts`. Verify `pnpm validate:composition` composes the setup into a throwaway profile and finds the row.

## 3. Verification

- [x] 3.1 Run the full local gate: `pnpm build`, `git diff --exit-code`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, and `pnpm validate:composition`. Verify every step passes and no generated file is left uncommitted.
- [x] 3.2 Smoke-test the real integration with the `nuphus-mcp` binary already on the PATH: install the updated setup into a throwaway profile or restart the configured profile, then verify `mcp__nuphus-mcp__*` tools appear, a read tool (screen size or window list) returns a result, a write tool without the confirmation argument is rejected, and the same call with the argument succeeds. Record the observed startup, probe, and confirmation behavior.
- [x] 3.3 Run the market dry run with `node scripts/generate-market.ts --output .tmp/market-nuphus`; verify the index lists `@dsh-setup/plugin-nuphus-mcp` with its English title, description, relative icon, version, `engines.dsh`, and git path, then remove `.tmp/market-nuphus`.

## 4. Release readiness

- [x] 4.1 Confirm the release version: the set version `0.1.7` is prepared in this branch but not tagged or published (remote tags stop at `v0.1.6`), so the new bundle ships in it without a bump. Verify `pnpm gen:check` and `git diff --exit-code` pass so the tagged tree reproduces the committed setup manifest and vendored files.

## Workflow follow-up

- Sync the `mcp-adapters` delta into `openspec/specs/` after the implementation is verified.
- Archive this change after the project's review requirements are satisfied.
- Tag and publish the release from an external shell, then verify the Pages market lists the new bundle and that a setup installation contains the Nuphus row.
