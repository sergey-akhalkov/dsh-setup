# Proposal

## Why

OpenSpec task lists arrive as one dependency-ordered chain, so independent work is often executed
serially. The lane practice added to this project's `openspec/config.yaml` does not travel with the
setup: every other workspace and every other PC starts without it. The OpenSpec plugin already
appends a local adapter note to the loaded body of each packaged skill, which is a portable hook
that needs no project config and no per-step prompt cost.

## What Changes

- Add a plugin-owned guidance asset `packages/plugin-openspec/assets/guidance/task-lanes.md`,
  outside the pinned `assets/openspec` directory, so the upstream refresh never deletes it.
- Append that guidance to the loaded bodies of `openspec-propose`, `openspec-update-change`, and
  `openspec-apply-change`, before the adapter note. The other three skills stay unchanged.
- Validate at registration that every targeted skill is present in the provenance lock, so an
  upstream rename fails loudly instead of silently dropping the guidance.
- Ship the asset through the package `files` list and regenerate the setup's vendored copy.
- Document the addendum and its portability in `docs/openspec.md`.
- Remove the temporary project-local `rules.tasks` and `operations.apply.guidance` from
  `openspec/config.yaml`; the plugin addendum becomes the one authoritative home.
- Do not change the vendored upstream bytes, the provenance lock, the catalog descriptions, or the
  idle prompt.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-skills`: the loaded body of three packaged skills carries plugin-owned task-lane
  guidance before the adapter note, and the release-pinned update contract distinguishes vendored
  upstream bytes from plugin-owned runtime additions.

## Impact

- Code: `packages/plugin-openspec/src/host/index.ts`, its built `lib/**`, and the package test.
- Assets and packaging: `packages/plugin-openspec/assets/guidance/task-lanes.md`,
  `packages/plugin-openspec/package.json`, and the generated
  `packages/setup/node_modules/@dsh-setup/plugin-openspec/**` tree.
- Docs and config: `docs/openspec.md`, `openspec/config.yaml`.
- Specs: `openspec/specs/openspec-skills/spec.md`.
- No new dependencies, no CLI change, no write to any workspace at runtime, and no change to the
  pinned upstream assets or lock.
