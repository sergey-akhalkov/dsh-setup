# Proposal

## Why

The owner's DeepSeek Harness setup currently exists only as machine-local profile state: a set of selected bundles, a personal `cordis.patch.yml`, and installed plugin packages. Reproducing it on another PC or sharing it with other developers requires manual bundle selection, hand-edited configuration, and a separate plugin-market setup on every machine.

DeepSeek Harness already provides the required primitives: profiles composed from installable bundles, bundle patches that apply configuration on installation, and a static JSON plugin-market index consumed by the Web Discover tab. The missing piece is a public repository that encodes the setup as versioned, installable artifacts and publishes them as a discoverable catalog.

## What Changes

- Establish `dsh-setup` as a pnpm monorepo containing plugin packages and one installable setup bundle.
- Add `packages/plugin-*`: independently versioned Host and/or Client plugins authored in TypeScript and shipped as prebuilt JavaScript, declaring `engines.dsh`, DSH peer dependencies, and their own bundle patch for à-la-carte installation.
- Add a TypeScript build and quality toolchain: strict type checking, `tsc` host compilation, `esbuild` client bundling into the DSH module-loader format, Biome lint/format, Vitest unit tests, and a CI reproducibility check for the committed runtime files.
- Add `packages/setup`: the single bundle users install for the full setup. Its generated manifest declares each plugin package as an exact dependency, vendors its publishable files as bundled dependencies, and its generated `cordis.patch.yml` mounts their rows, declares agent presets, and carries owner defaults (default model, theme, UI preferences).
- Add market generation: a `market/index.json` catalog with icons, git-commit-pinned versions, and per-version `engines.dsh`, published through GitHub Pages.
- Add release and validation automation: a pull-request validation workflow that installs the DSH CLI, composes a throwaway profile, and checks the setup patch, plus a tag-driven release workflow that validates, generates the index, and deploys Pages.
- Document the installation path: enable required experimental bundles through Plugins toggles, add the index source in Discover, install the setup bundle, and update by reinstalling a newer version.
- **BREAKING**: none; this is a new repository.
- **Out of scope**: npm publication, a custom marketplace server or UI, scripted rewriting of the Electron-owned Desktop profile, delivery of credentials, skills, or machine-local overrides.

## Capabilities

### New Capabilities

- `portable-setup`: The repository produces one installable setup bundle whose dependencies and generated patch reproduce the owner's composition, agent presets, and defaults through the native DSH bundle mechanism, while machine-local layers remain user-owned. Covers generated-patch integrity, bundle boundaries, versioning, and the documented installation and update contract.
- `plugin-market`: The repository generates and publishes a static, format-1 plugin market index with commit-pinned and compatibility-annotated versions of the setup bundle and each plugin, consumable by the Discover tab and the `plugin_market` tool, with validation gates before publication.

### Modified Capabilities

None; this is a new OpenSpec project with no existing specs.

## Impact

- New repository content: TypeScript package sources and their committed build output, package manifests, generated bundle patch, market generator, GitHub Actions workflows, installation documentation.
- DeepSeek Harness Desktop profile `desktop`: additive installation of one bundle plus documented toggles for experimental bundles; the profile's own patch layer is not modified by the setup.
- Compatibility surface: `engines.dsh` ranges against the running DSH version, validated in CI against recent published versions.
- External dependencies: GitHub Pages for index hosting, GitHub Actions for validation and release, the published `@deepseek-ai/dsh` CLI for CI composition checks.
- Security: installed bundles execute Host code in-process; the index pins git commits, and the repository contains no credentials.
