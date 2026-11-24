# Tasks

Lane plan: one serial lane owned by `lead` over the shared scope `packages/**`, `scripts/**`,
`docs/**`, `install.ps1`, `dsh.json`, and `openspec/**`. A global identifier rename edits the same
sources, tests, and generated output in every section, so the sections are phases of one lane, not
independent lanes.

## 1. Repository and release identity

- [ ] 1.1 Set `dsh.json` `repository` to `https://github.com/sergey-akhalkov/dsh-studio`; update `install.ps1` `$IndexUrl`, `$Repository`, `$SetupPackage`, the setup row marker, the installed-package path, and every example command; update the installer URL in `setup-hindsight.ps1`.
- [ ] 1.2 Rename the remaining workspace identity constants: the root `package.json` name, `MARKET_TITLE` in `scripts/generate-market.ts`, `HINDSIGHT_PLUGIN_PACKAGE` in `scripts/lib/hindsight.ts`, and the `USER_AGENT` strings in `scripts/update-answer-page.ts`, `scripts/update-openspec.ts`, and `scripts/update-ponytail.ts`.
- [ ] 1.3 Update the setup display identity: `packages/setup/locale/en.json` title, `packages/setup/icon.svg` aria-label, and the market-facing description in `packages/setup/package.json`.
- [ ] 1.4 Rewrite `README.md` (title, badges, intro, market source URL, one-line installer, package names) for the new identity.
- [ ] 1.5 Update `docs/install.md`, `docs/releasing.md`, and `docs/contributing.md`: URLs, install and manual-install commands, release tag flow, and the migration section from task 5.3.
- [ ] 1.6 Update the remaining named-repository docs and `AGENTS.md`: `docs/{plugins,setup-composition,goal-continuity,hindsight,lazy-mcp,loop-guard,serena,ponytail,rtk,principles,verification-gate,answer-pages,rust,openspec,workflows,codex-subagent}.md`; leave `docs/openspec-status.md` historical notes unchanged.
- [ ] 1.7 Update the per-package documentation and notice files that name the old scope: `packages/plugin-workflows/README.md` and `packages/plugin-workflows/THIRD_PARTY_NOTICES.md`.

## 2. Package scope

- [ ] 2.1 Rename every `packages/plugin-*/package.json` name to the `@dsh-studio` scope and set `SETUP_PACKAGE_NAME` in `scripts/lib/workspace.ts`.
- [ ] 2.2 Rename the runtime name exports and server-derived ids in every plugin source: provider names, HTTP route paths, client slot ids, command definition ids, `SHIPPED_SOURCE`, `OPENSPEC_ID`, and the workflows host-key comment.
- [ ] 2.3 Rename the first-party adapter and guidance text that names the package scope, including `packages/plugin-openspec/assets/guidance/task-lanes.md` and the skill adapter notes in the plugin sources.
- [ ] 2.4 Rename the identifiers inside the forked `packages/plugin-codex-subagent/lib/**`, its `README.md`, and its `NOTICE` through the documented fork patch/rebase procedure in `docs/codex-subagent.md`; do not run `pnpm build` or `pnpm gen` against that tree.
- [ ] 2.5 Update `scripts/lib/scan.ts`, `scripts/dogfood.ts` installed-package path, and every repository test that asserts package names, provider ids, routes, and command ids (`scripts/test/*`, `packages/plugin-*/test/*`).

## 3. Row ids and prompt sections

- [ ] 3.1 Rename the row ids that currently use the `dsh-setup-` prefix in all 18 `packages/plugin-*/cordis.fragment.yml` files to the `dsh-studio-` prefix; keep the approved Harness-owned `preset-goal-reviewer` row id.
- [ ] 3.2 Rename the row ids and `mounted.section` values in `packages/setup/defaults.yml`.
- [ ] 3.3 Rename the prompt-section constants in `plugin-ponytail`, `plugin-working-principles`, `plugin-rtk`, and `plugin-serena` to the `dsh-studio:` prefix.
- [ ] 3.4 Update `scripts/lib/fragments.ts` (`ROW_ID_PATTERN`), the prefix guard in `scripts/lib/generate.ts`, and the current-row ids in `scripts/lib/dogfood.ts`; keep the retired adapter allowance on `dsh-setup-nuphus-mcp` and `dsh-setup-serena`.
- [ ] 3.5 Update `scripts/validate-composition.ts`, `scripts/validate-installer.ts`, `packages/plugin-workflows/test/composed-profile.test.ts`, and the fragment/generation tests to the new ids; keep the old retired-row ids used as upgrade fixtures in `scripts/validate-composition.ts`, `scripts/test/dogfood.test.ts`, and `scripts/test/adapter-guidance.test.ts`.

## 4. Generated artifacts

- [ ] 4.1 Run `pnpm build` and `pnpm gen`; review the generated plugin patches, the setup manifest and patch, and the vendored `node_modules/@dsh-studio/**` tree; commit the result.
- [ ] 4.2 Confirm `pnpm gen:check` passes and a fresh `pnpm build` leaves `git diff --exit-code` clean.

## 5. Installer migration

- [ ] 5.1 Add the legacy-setup detection before the first write in `install.ps1`: a target profile that depends on or selects `@dsh-setup/setup` stops the run with the legacy bundle name and the removal-and-rerun action, and `-DryRun` reports the same refusal.
- [ ] 5.2 Extend `scripts/validate-installer.ts` with the refused-legacy case (no file written, no new package installed) and keep the fresh-install exercise green.
- [ ] 5.3 Write the migration section in `docs/install.md`: copy the profile manifest and patch aside, remove the legacy bundle, rename or delete stale `dsh-setup-…` profile-patch row ids, re-add the new market source, and document rollback from the copied files plus the pinned legacy commit.
- [ ] 5.4 Rename the installer backup directory to `.dsh-studio-backups` in `install.ps1` and `scripts/dogfood.ts`, and update the reference in `docs/install.md`.

## 6. Sync, release, coordination, and owner steps

- [ ] 6.1 Confirm the rebrand lands after `move-review-runtime-into-workflows`, `focused-rereview-and-section-steer`, and `add-worktree-cleanup` archive; rebase the rebrand's `workflows` delta and every other behavioral overlap on their final text, and reconcile the old-scope literals (`@dsh-setup/plugin-openspec`, the planned worktrees package) before syncing.
- [ ] 6.2 Sync the delta specs into the main specs and run `openspec validate --strict` on the synced tree.
- [ ] 6.3 Run `pnpm release:prepare --version 1.0.0`, `pnpm build`, and `pnpm gen`, then commit the version bump with the regenerated files.
- [ ] 6.4 Make the downloaded-installer step in `scripts/validate-installer.ts` resolve against a local index fixture (`serveIndex`, passed as `-IndexUrl`) instead of the live default URLs, so `pnpm validate` passes before the repository rename; the real new index and repository URLs stay verified by the owner's rename, tag, and install checks.
- [ ] 6.5 Run `pnpm validate`, `pnpm gen:check`, `git diff --exit-code`, and the scan gate on the synced tree; confirm every remaining match is on the design D10 keep-list (archived changes, historical notes, review records, retired-row fixtures, the preserved host-key path in source and generated copies, the legacy-detection and migration literals, this change's own artifacts, and third-party vendored packages) and record the result.
- [ ] 6.6 Write the release note: the breaking rename, the old market URL and one-line command now 404, the legacy-removal and snapshot steps, the stale row-id overrides, and the kept local directory name.
- [ ] 6.7 (owner) Rename the GitHub repository to `dsh-studio` and verify that Actions, Pages, and the `raw` installer URL answer on the new name.
- [ ] 6.8 (owner) Tag and push `v1.0.0`; verify the new index URL lists `@dsh-studio/setup` `1.0.0` with a commit pin.
- [ ] 6.9 (owner) On this machine: snapshot the profile manifest and patch, remove the legacy setup bundle, rerun the documented installer, and re-add the market source; keep the checkout directory name.

## 7. Verification and close-out

- [ ] 7.1 Run `pnpm dogfood` against a copy of the owner profile; confirm the composed copy has one `dsh-studio-*` row set and the retired-row allowance still uses the old ids.
- [ ] 7.2 Install the published `1.0.0` into a throwaway `DSH_HOME` profile from the new index and confirm exactly one setup row set, the new row ids, and the Hindsight phase behavior.
- [ ] 7.3 Archive the change through the repository's OpenSpec flow, with the task reviews the gate requires.
