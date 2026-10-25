# Tasks

## 1. Workspace and toolchain

- [x] 1.1 Create the pnpm workspace root (`package.json`, `pnpm-workspace.yaml`), `packages/`, `market/`, `scripts/`, and `docs/` directories; verify `pnpm -r list` resolves the workspace packages.
- [x] 1.2 Add the toolchain: `tsconfig.base.json` with strict settings, per-package TypeScript configs, `biome.json`, `vitest.config.ts`, and the esbuild build script; verify `pnpm check` runs type-check, lint, tests, and build on the empty workspace and exits zero.
- [x] 1.3 Pin Node and pnpm (`engines`, `packageManager`), ignore generated `node_modules/`, and keep committed build output out of `.gitignore`; verify a clean `pnpm install --frozen-lockfile` succeeds.
- [x] 1.4 Add a minimal `README.md` naming the repository purpose and pointing to `docs/install.md`; verify every link resolves to an existing file after task 5.3.

## 2. Plugin package template and first plugin

- [x] 2.1 Author the first plugin package under `packages/plugin-*` in TypeScript: a Host entry exporting the plugin object, a Client entry, `dsh.bundle`, `dsh.client`, `engines.dsh`, DSH peer dependencies, locale entries, and an icon; verify `pnpm build` emits `lib/index.js` and `client.js` and a build test confirms the client bundle registers a factory whose id equals the package name.
- [x] 2.2 Implement the client build wrapper around esbuild's CommonJS output; verify a unit test runs the bundle with a fake `window.__ModuleLoader__` and module table, asserts `require('react')` resolves from that table, and asserts the factory returns the plugin object with `apply`.
- [x] 2.3 Define the composition-fragment format (rows, defaults, ordering) and implement its reader; verify a unit test rejects a row with a non-namespaced id and an unknown fragment field.
- [x] 2.4 Add a manifest validator that rejects a missing `engines.dsh`, a missing `dsh.bundle`, an undeclared client export, and any `prepare` or install-time script; verify one failing fixture per condition and a passing run on the real package.
- [x] 2.5 Document how to add a plugin package, its fragment, and its tests in `docs/plugins.md`; verify the documented commands produce a package that passes `pnpm check`.
- [x] 2.6 Verify the local development loop: install the workspace package with a `link:` spec into a `dev` profile, run the watch build, change Host and Client code, and record whether each half reloads through HMR or requires a profile restart; verify `docs/plugins.md` states the observed behavior rather than the assumed one.

## 3. Setup bundle and generated patch

- [x] 3.1 Implement `scripts/generate.ts` to merge fragments in a fixed order, append the owner-defaults block, and write `packages/setup/cordis.patch.yml`; verify a snapshot test pins the generated output.
- [x] 3.2 Author the owner-defaults fragment (default model and reasoning effort, theme, UI settings, preset selection) that restates each targeted shipped row's complete config; verify the generated patch contains every required field for those rows.
- [x] 3.3 Make the setup manifest declare every `packages/plugin-*` package as an exact dependency; verify a test fails when the dependency set differs from the workspace plugin list.
- [x] 3.4 Add the drift check: regenerate into memory, compare with the committed patch, and exit non-zero on a difference; verify a hand-edited patch fails and a regenerated patch passes.
- [x] 3.5 Document the generation and defaults workflow in `docs/setup-composition.md`; verify the documented regeneration command clears a deliberately introduced drift.

## 4. Local composition validation

- [x] 4.1 Implement `scripts/validate-composition.ts` to create a throwaway `DSH_HOME`, initialize a `ci` profile from the `web` template with the published DSH CLI, install `packages/setup` by absolute path, and run `--dump-config`; verify the exit code is zero and the dump contains the setup rows.
- [x] 4.2 Assert in the composition check that the setup patch changes the profile bundle selection only by appending the setup bundle, and that no source, manifest, or patch file contains an absolute machine path; verify one fixture per violation fails the check.
- [x] 4.3 Add `.github/workflows/validate.yml` that runs frozen install, build, type-check, lint, unit tests, generated-patch drift, committed-runtime drift, manifest checks, repository scan, composition validation, and the installer exercise against each supported DSH version on pull requests; verify the same command sequence passes locally after the workflow is added.

## 5. Market index generation

- [x] 5.1 Implement `scripts/generate-market.ts` to emit a format-1 index with one entry per bundle, an English market title, commit-SHA and package-path versions, manifest versions, commit-time publish timestamps, copied `engines.dsh`, and relative icons published beside the index; verify the output validates with the format-1 validator or the checked-in rule set, whichever is available.
- [x] 5.2 Make the generator skip packages without `dsh.bundle`, omit versions with a missing or invalid `engines.dsh`, fail on any version without a commit SHA or path, and keep versions from the previously published index; verify a unit test covers each case.
- [x] 5.3 Write `docs/install.md` with the installer command, the index URL, the Discover steps, the supported bundled toggles, the update-by-reinstall flow, and the offline commit-pinned git specification; verify the documented git specification installs the same version as the index entry.
- [x] 5.4 Fix generated paths so every version's `path` and `repository.directory` are the repository-relative package directory (`packages/setup`, `packages/plugin-*`); verify `marketInstallTarget` produces `git+<url>.git#<sha>&path:/packages/setup`, and write unit tests for it.

## 6. Release pipeline and Pages publication

- [x] 6.1 Add `.github/workflows/release.yml` that reruns the full check on a tag against every supported DSH version, builds all packages, fetches the previously published index, generates the market directory, and deploys it to Pages as one artifact; verify a manual dry run of the generation step produces only `index.json` and `icons/`, and review the workflow for the leave-previous-on-failure property.
- [x] 6.2 Add root scripts for `generate:market`, `validate`, `release:prepare`, and `check`; verify each script exits zero on a clean checkout and non-zero when its input is broken.
- [x] 6.3 Document the release procedure and version-bump rules in `docs/releasing.md`; verify the checklist can be followed from a clean clone to a locally generated market directory.

## 7. Dogfooding and compatibility

- [ ] 7.1 Create the first GitHub release tag and confirm the published index URL returns HTTP 200 over HTTPS without a redirect; verify the Discover tab lists the setup bundle and each plugin entry after adding the source.
- [ ] 7.2 Install the setup bundle into the owner's Desktop profile through Plugins/Discover; verify the effective model, theme, UI settings, and preset match the current values and that `profile/cordis.patch.yml` is unchanged.
- [ ] 7.3 Install the setup bundle by commit-pinned git specification into a throwaway profile; verify the composed rows match the index installation.
- [ ] 7.4 Publish a second tagged version and verify the installed bundle reports an update while the older version remains installable from its entry page.

## 8. Integration rehearsal

- [ ] 8.1 On a machine or Windows user profile without prior setup, follow `docs/install.md` end to end; verify the toggled experimental bundles, the market install, and the effective defaults all match the documented expectations.
- [ ] 8.2 Verify the repository scan reports no credentials, sessions, or machine paths, and that removing the setup bundle restores the prior composition without modifying the profile patch.

## 9. One-command installer

- [x] 9.1 Add `install.ps1`: resolve the CLI and running DSH version, refuse an unsupported version, resolve the setup release from the index (or an explicit spec/local checkout), close and restart the Desktop app, keep a manifest backup, and support `-DryRun`.
- [x] 9.2 Enable the shipped optional bundles exactly like the Plugins toggles by appending the documented names to `dsh.profile.bundles`, install the registry bundle through `dsh plugin`, install the setup last, and verify selection, version, and the unchanged patch; record the bundle lists in `dsh.json`, compare the standalone installer copy in `validate-repo`, and exercise the installer on a throwaway profile with an idempotent second run (`validate:installer`).
- [x] 9.3 Document the one-command path as primary in `docs/install.md`, including options and the manual fallback; update the specs, design, and proposal for the installer requirement.

## Workflow follow-up

- Archive the change after the release and clean-machine rehearsal satisfy the review requirements.
- Verify the archived `portable-setup` and `plugin-market` specs contain the accepted requirements.
