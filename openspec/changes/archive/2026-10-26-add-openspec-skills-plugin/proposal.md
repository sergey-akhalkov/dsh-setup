# Proposal

## Why

OpenSpec skills are normally installed per project by `openspec init --tools dsh`, which copies the
generated skill files into `<workspace>/.dsh/skills`. The owner wants the OpenSpec workflow available
in every DeepSeek Harness session from one profile-level bundle, like Ponytail, without copying skills
into each project. The `openspec` CLI is already a machine prerequisite and must stay one: this setup
does not install system runtimes.

## What Changes

- Add a host-only bundle `@dsh-setup/plugin-openspec` (`packages/plugin-openspec`) that registers the
  six OpenSpec core skills in the profile's global skill layer at bundled rank, with no configuration,
  no always-on prompt section, and no client half.
- Vendor the generated `SKILL.md` files from a pinned OpenSpec release (1.15.0 initially), plus the MIT
  license and a provenance lock recording the upstream repository, version, tag, commit, npm tarball
  integrity, generator command and profile, and each file's size and SHA-256.
- Add `pnpm openspec:update --version X.Y.Z` to regenerate that set from the pinned release and rewrite
  the lock atomically, with an offline provenance test that verifies the committed bytes.
- Append a DeepSeek Harness adapter note to every loaded skill: pinned version and license, the
  `openspec` CLI prerequisite with the exact install command, and project-local root guidance
  (`openspec init --tools none`) so per-project init never duplicates the packaged skills.
- Instruct users to delete project-local `openspec-*` skill directories under `.dsh/skills` that
  `openspec init --tools dsh` created, and remove the existing copies in this checkout, so the
  packaged definitions are the only OpenSpec skills. The bundle itself deletes no workspace files.
- Document the CLI prerequisite, the per-project root model, and the stale-copy cleanup in a new
  `docs/openspec.md`, `docs/install.md`, and the plugin locale; update the OpenSpec workflow notes in
  `AGENTS.md`.
- Out of scope: installing or vendoring the CLI, installer changes, OpenSpec stores and `defaultStore`,
  an always-on prompt section, automatic creation of `openspec/`, automatic deletion of project-local
  skill copies, and the six optional OpenSpec skills.

## Capabilities

### New Capabilities

- `openspec-skills`: packaging of the upstream OpenSpec core skills as a profile-global,
  provenance-pinned bundle, including the CLI prerequisite and the project-local spec-root guidance.

### Modified Capabilities

None. Existing capabilities keep their current requirements: `portable-setup` already requires every
repository plugin to be a setup dependency and prebuilt, `plugin-market` already defines the market
card contract, and `packaged-skills` remains the Ponytail-specific contract.

## Impact

- New package `packages/plugin-openspec` with its generated bundle patch, setup dependency, vendored
  copy under `packages/setup/node_modules`, and root `tsconfig.json` reference.
- New updater script and tests (`scripts/update-openspec.ts`, `scripts/lib/openspec.ts`,
  `scripts/test/openspec.test.ts`), package test, and root `package.json` script.
- Documentation: `docs/openspec.md` (new), `docs/install.md`, `AGENTS.md`; market locale and icon.
- No changes to `dsh.json`, `install.ps1`, the DSH API, or any existing plugin's behavior.
