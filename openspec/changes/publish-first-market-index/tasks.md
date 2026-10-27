# Tasks

## 1. Prepare the v0.5.0 release tree

- [x] 1.1 Bump every package to 0.5.0 with `pnpm release:prepare --version 0.5.0`; verify the version is 0.5.0 in the root, every plugin, `packages/setup`, and the vendored copies, and that `pnpm gen:check` passes.
- [x] 1.2 Build and run the local gate (`pnpm build`, `pnpm validate`, `pnpm gen:check`); verify the committed runtime and generated files match their sources and record any environment-limited skip.

## 2. Commit and tag

- [ ] 2.1 Commit the change artifacts, the version bump, and the regenerated files; verify the worktree is clean and a fresh `pnpm build` leaves `git diff --exit-code` clean.
- [ ] 2.2 Tag the release commit `v0.5.0`, push `main` and the tag, and verify `git rev-parse v0.5.0^{}` equals the release commit and a `release` workflow run starts for the tag.

## 3. Publish and verify

- [ ] 3.1 Watch the release workflow through `versions`, `validate`, and `publish`; verify the publish job deploys Pages and the run concludes successfully, or record the exact failing step and apply the design's failure handling.
- [ ] 3.2 Verify the published index: the documented URL answers a direct 200, `format` is 1, `@dsh-setup/setup` lists 0.5.0 at the `v0.5.0` commit, the plugin entries and icon references resolve, and `install.ps1 -DryRun -SetupVersion 0.5.0` reports the index path instead of the tag fallback.

## 4. Owner acceptance

- [ ] 4.1 Owner adds `https://sergey-akhalkov.github.io/dsh-setup/index.json` as a Discover source and confirms the setup and plugin entries render; record the confirmation.

## Workflow follow-up

- Archive the change after all tracked tasks and the owner's Discover check are complete.
- Track the second-release 404 guard (a missing previous index must not silently drop old versions) as a separate follow-up; it is out of scope here.
