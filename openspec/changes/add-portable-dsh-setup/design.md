# Design

## Context

See `proposal.md` — Why. Constraints discovered while inspecting the running DSH `0.2.1-rc.3` installation and its own documentation:

- A profile at `$DSH_HOME/profiles/<name>` is `package.json` (`dsh.profile.bundles` order) plus `cordis.patch.yml`. Layer order: each selected bundle's patch, then the profile patch, then the home patch, then `--patch` overlays.
- A bundle contributes exactly one patch layer and is installed by adding a package dependency and appending its name to `dsh.profile.bundles`. Only direct selections contribute layers; transitive bundle dependencies are never applied.
- `plugin_manager.installBundle` and `dsh plugin --profile <name> add <spec>` perform both steps. The Desktop profile is owned by the Electron shell: the CLI refuses to boot or dump it, but permits plugin package operations after the app is fully quit.
- The plugin market is a static format-1 JSON document fetched over HTTPS (no redirects) by the Host; the same document is read by the Discover tab and the `plugin_market` tool. Versions install from npm or from a commit-pinned git source with `&path:/...` for a monorepo package directory.
- Git-installed packages build through their `prepare` script, which pnpm blocks until `allowBuilds` approval. Registry and tarball installs of prebuilt packages need no approval.
- Shipped experimental capabilities (`agent-team`, `ralph`, `worktree`, `session-search`, `terminal`, `subagent-codex`, the market bundle) are profile-level bundle selections; a third-party bundle cannot add them to `dsh.profile.bundles`. The Plugins page enables a shipped optional bundle by appending its package name to `dsh.profile.bundles` (no dependency, because the DSH installation supplies the package); `@deepseek-ai/dsh-subagent-codex` is not shipped and is installed as a profile dependency from the registry. Repeating that selection is safe: an existing entry is left in place and the CLI installs a missing dependency for an already-selected name.
- The Desktop CLI refuses to boot or dump the `desktop` profile, so an installer cannot verify that profile by composing it; it verifies the manifest, the installed package, the patch hash, and uses a throwaway profile for composition checks. Profile writes require the app to be fully quit; the installer closes it and starts it again.
- User-global skills and instructions live in `~/.agents` and are read by DSH directly; credentials live in `~/.dsh/.credentials.yaml`. Neither belongs to this repository.

## Goals / Non-Goals

**Goals:**

- Reproduce the owner's DSH composition, plugins, presets, and defaults with one install command on another Desktop machine, including the shipped bundles the owner enables.
- Keep the setup source of truth reviewable in one public repository: package sources, generated patch, static index, installer.
- Make individual plugins independently discoverable and installable without a second distribution channel.
- Keep the machine-local layer (profile patch, credentials, skills) user-owned and untouched by installation.
- Provide strict typing and reproducible builds so plugin code survives DSH release-candidate upgrades and reviewers can trust the committed runtime.

**Non-Goals:**

- Publishing to npm, operating a market server or custom Discover UI, or supporting DSH versions other than the documented range.
- Scripted rewriting of the Electron-owned Desktop profile, automatic enablement of shipped experimental bundles, or automatic upgrades.
- Distributing credentials, sessions, agent skills, or other machine data.

## Decisions

### D1. One setup bundle with vendored plugin packages and a generated patch

`packages/setup` is the only bundle a full-install user selects. Its `package.json` declares every plugin package as an exact dependency and lists it in `bundleDependencies`; the generator materializes each plugin's publishable files under `packages/setup/node_modules/`, so a single git install delivers all plugin code without a registry or a second fetch. Its `cordis.patch.yml` is generated and contains the plugin row inserts, preset declarations, and default overrides. `packages/plugin-*` remain ordinary plugin packages that also declare `dsh.bundle` so they can be installed individually.

Vendoring is forced by pnpm behavior, verified experimentally: transitive dependencies resolved through git are refused by pnpm's `blockExoticSubdeps`, and `file:../plugin-x` dependencies do not survive a git install because pnpm materializes only the package directory. `bundleDependencies` with physically present copies is the supported self-contained mechanism.

Alternative considered: a meta-bundle depending on other bundles. Rejected — DSH deliberately does not auto-apply transitive bundle layers, so the meta-bundle would have to re-export their patches anyway, and bundle selection would still list only the meta-bundle. Re-exporting at the row level into one generated patch is the explicitly supported pattern.

Alternative considered: npm-published plugin packages. It would let the setup bundle use ordinary registry dependencies, but adds a second public release channel and an npm account; deferred until a plugin has external consumers (D2).

Alternative considered: a bootstrap script that writes the profile's `package.json` and patch. Rejected as the primary mechanism — it mutates the Electron-owned profile, duplicates DSH's own installer, and breaks the additive/removable property.

### D2. Git-only distribution with committed runtime files

Versions are immutable git commits; the market index pins SHA plus package path. Each package commits its built runtime from TypeScript sources (D10), declares `main`/`exports` pointing at it, and defines no `prepare` or install script. Validation rebuilds from source and fails on any byte difference, so the committed runtime cannot silently drift. This keeps one review surface and avoids an npm account and release token, while preserving one-click installation through the market.

Alternative considered: npm publication. Better install ergonomics but adds an external release channel, public package naming, and token management; the index format would have to mix sources. Deferred until a plugin has external consumers.

Alternative considered: distributed types-only packages built by the installer. Rejected — pnpm blocks git install scripts until the user approves them, so every consumer would need a build approval and a working toolchain.

### D3. Static index on GitHub Pages, generated at release

A release workflow regenerates `market/index.json` and `market/icons/` from the tagged commit and deploys exactly that directory to Pages. The documented URL is `https://<owner>.github.io/dsh-setup/index.json`; Pages serves it as a direct 200 over HTTPS, which the Host requires. Relative icon paths keep the document portable across hosts.

Alternative considered: `raw.githubusercontent.com`. It works but couples the URL to a branch, lacks a content-type guarantee, and is not a publishing surface; Pages gives an immutable-per-deployment artifact.

Alternative considered: no index at all (install by git spec only). Rejected — it removes the one action this repository is meant to provide and hides the catalog from Discover.

### D4. Fragments as the source of truth, generated patch as an artifact

Each plugin package carries a composition fragment declaring the rows it mounts and its default configuration. A generator concatenates fragments in a fixed order, appends the owner-defaults block, and writes `packages/setup/cordis.patch.yml`. Pull-request validation regenerates in memory and fails if the committed file differs. Row ids are namespaced per plugin to avoid collisions with shipped rows; only intentional overrides reuse shipped ids.

Alternative considered: hand-maintained setup patch. Rejected — drift between plugin packages and the setup becomes invisible until a user installs a broken build.

### D5. Defaults live in the setup layer; local precedence is respected

Owner defaults (default model and reasoning effort, theme, UI settings, preset registry selection) are explicit entries in the setup patch, targeting shipped row ids with complete config restatement. Installation never writes `profile/cordis.patch.yml`, so any local override continues to win.

Trade-off: values changed through the Desktop UI land in the profile patch and shadow the setup defaults, so the repository is the baseline rather than a live mirror. A future snapshot helper could promote local deviations back into the repository; it is not part of this change.

### D6. The setup bundle stays pure; `install.ps1` performs the bundle selections

The setup bundle's patch neither duplicates shipped experimental rows nor selects shipped bundles. Those rows belong to the shipped bundles' own layers, and a third-party bundle cannot add names to `dsh.profile.bundles`.

Because the manual toggle routine is long and easy to get wrong, the repository ships `install.ps1`, which performs the same operations as the Plugins page against the selected profile:

1. Append the documented shipped optional bundle names (`dsh.json` → `installBundles.shipped`) to `dsh.profile.bundles`, preserving existing entries and order.
2. Install the one registry bundle (`installBundles.registry`) with `dsh plugin --profile <name> add <name>@<running DSH version>`, which records the dependency and selects it.
3. Install the setup bundle with the native plugin manager, so it lands last in the selection and its defaults outrank the shipped layers.
4. Verify selection, dependency, installed setup version, and that `cordis.patch.yml` is byte-identical; restore nothing silently, but keep a manifest backup.

The Desktop profile is Electron-owned: the CLI permits these package operations only while the app is fully quit, so the installer closes and restarts the app by default, and aborts instead under `-NoStopApp`. A dry run prints the plan without changing anything. The installer duplicates the bundle and version lists for standalone use; `scripts/validate-repo.ts` compares them with `dsh.json` so drift fails validation.

Alternative considered: a shipped profile template or bundle selection inside the setup patch. Rejected — DSH applies no transitive bundle layers, and rows duplicated from shipped bundles break on DSH upgrades.

Alternative considered: keeping the toggles manual. Rejected by the installation requirement: one command must reproduce the owner's enabled set.

### D7. CI validates the composition with the published DSH CLI

Validation installs `@deepseek-ai/dsh` at each supported version, creates a throwaway profile with `--from-default-profile web`, installs the setup bundle from the workspace package path, and runs `--dump-config` to assert the composed rows and effective defaults. It also runs type-check, lint, unit tests, the generator drift check, the committed-runtime reproducibility check, manifest checks (`engines.dsh`, no install scripts), the installer-metadata check against `dsh.json`, and the secrets/machine-path scan. The Desktop profile is never touched by CI.

The installer is exercised on a throwaway profile in the same way: a fresh Harness home gets a `web`-template profile, `install.ps1` enables the documented bundles and installs the local setup directory, and `--dump-config` must show the shipped bundle rows, the setup row, and the owner defaults. A second run must be a no-op and leave the profile patch byte-identical.

Release runs the same validation against the tagged commit, then generates and deploys the index; failure leaves the previous deployment in place.

### D8. Versioning and repository layout

```
dsh-setup/
  package.json, pnpm-workspace.yaml, pnpm-lock.yaml
  tsconfig.base.json, biome.json, vitest.config.ts
  packages/plugin-<name>/
    src/                      # TypeScript host sources, client sources, tests
    lib/                      # committed tsc output (ESM + declarations)
    client.js                 # committed esbuild output in the loader format
    cordis.patch.yml          # bundle patch for à-la-carte installation
    cordis.fragment.yml       # composition fragment consumed by the generator
    locale/, icon.svg
    package.json              # dsh.bundle, dsh.client, engines.dsh, peers, exports
  packages/setup/             # generated manifest + patch + defaults +
                              #   node_modules/@dsh-setup/* vendored plugin copies (tracked)
  market/                     # generated index.json + icons/ (Pages artifact)
  scripts/                    # build, generate patch, generate index, validate, installer check
  install.ps1                 # one-command installer (standalone metadata checked against dsh.json)
  .github/workflows/          # validate on PR, release on tag
  docs/install.md
```

One release tag identifies a coherent set: package versions are bumped together for the first iteration, and the setup bundle's dependency ranges are pinned to those exact versions. The generated index lists the current package version from its manifest and keeps the versions of the previously published index, so older tags remain installable while a newer release reports as an update.

### D10. TypeScript with an explicit, committed build pipeline

Sources are TypeScript under `src/`. Host halves compile with `tsc` to ESM in `lib/`, with declarations, preserving module structure so the DSH loader and HMR observe ordinary files. Client halves bundle with `esbuild` to CommonJS with `react` external, then a small wrapper emits the `window.__ModuleLoader__.load({ id, factory(require) { ... } })` contract; imports outside the baseline module table are declared in `dsh.client.external`. Built files are committed because git installs cannot run a build step (D2).

Quality gates: `tsc --noEmit` type-checks every package against DSH type packages pinned to the supported runtime version; Vitest covers generator, validator, fragment, and loader-wrapper logic; Biome owns lint and formatting; `pnpm check` runs type-check, lint, tests, build, generated-patch drift, and committed-runtime drift in one command. CI repeats the same command set for every supported DSH version.

Alternatives considered: plain ESM JavaScript with JSDoc and `tsc --checkJs` (no build, but weaker typing and JSX ergonomics against a TypeScript-first API); ESLint with typescript-eslint and Prettier (more type-aware rules, heavier configuration); `tsdown` or `tsup` (still need the custom client wrapper, so the abstraction buys little). The chosen split keeps one deliberately small build step per artifact and the smallest tool surface.

### D9. Security posture

The index is unsigned and its metadata is a market claim; the README states that installing a bundle runs Host code with the user's privileges and shows how to review source. Sources are commit-pinned, the repository contains no credentials, and the validation workflow rejects absolute machine paths. Installation of either the setup or individual plugin bundles is the supported pattern; combining both for the same plugin is unsupported because it would mount duplicate rows.

## Risks / Trade-offs

- **Generated patch drifts from plugin fragments** → regeneration check in CI fails the pull request.
- **Vendored plugin copies drift from their packages** → the same regeneration check compares the whole `packages/setup/node_modules` tree, reports missing, changed, and unexpected files, and CI runs it on every pull request.
- **Committed runtime drifts from TypeScript sources** → the validation workflow rebuilds and fails on any byte difference; generated directories are marked as artifacts in the repository metadata.
- **DSH release candidates change type declarations** → DSH type packages are pinned as dev dependencies, the supported-version matrix type-checks on every pull request, and a bump is a deliberate, reviewed change.
- **Plugin and setup dependency versions diverge** → release pins exact versions and validates the composed profile for the tag.
- **Desktop profile is Electron-owned** → install through the in-app Plugins/Discover surfaces; CLI instructions are only documented for non-Desktop profiles.
- **Market has no upgrade action** → documentation states update = install the newer version, and old versions remain listed.
- **DSH release candidates change row ids or config schemas** → setup keeps `engines.dsh` narrow, overrides are few and complete, and CI runs against each supported version before publication.
- **UI edits shadow setup defaults** → documented as an accepted baseline-vs-live-mirror trade-off; snapshot promotion is deferred.
- **Index staleness between releases** → version list is generated per release, and Pages deploys the tagged artifact; no build-time lookups.
- **Installing setup and an individual plugin bundle together** → documented as unsupported; row ids are namespaced but duplicate mounts are still refused by review of the installation guide.
- **The installer writes the Electron-owned Desktop profile** → it appends only bundle names, delegates every package change to `dsh plugin`, saves a manifest backup, refuses to run while the app is open unless it may close and restart it, and verifies the profile patch is unchanged.
- **Standalone installer metadata drifts from the repository** → `dsh.json` is the source, `install.ps1` carries a copy for standalone use, and repository validation compares the supported versions and both bundle lists.

## Migration Plan

1. Scaffold the monorepo, the TypeScript/Biome/Vitest toolchain, and the first plugin package with its composition fragment.
2. Generate the setup patch and validate the composition in a throwaway profile with the DSH CLI; do not touch the Desktop profile.
3. Add the one-command installer and exercise it on a throwaway profile: bundle selection, setup install, idempotent rerun, unchanged patch.
4. Install the setup bundle into the owner's Desktop profile as a dogfood step; verify effective model, theme, UI, presets, and the enabled bundle set against the current values, then reduce the profile patch to genuinely machine-local entries.
5. Enable Pages, publish the first release, add the index source in Discover, and verify install on a second profile or machine.
6. Rollback: remove the setup bundle through Plugins (the profile patch was never modified, so previous behavior returns), and revert the Pages deployment to the prior artifact if an index is faulty.

## Open Questions

- When a second consumer needs a subset, should the setup bundle be split into `plugins` and `personal-defaults` bundles? The current single-bundle shape is an intentional bet that can be revisited without changing the specs.
- Should the snapshot helper that promotes local profile-patch deviations into the repository be added after the first release? Deferrable; it adds a workflow, not new externally visible behavior.
