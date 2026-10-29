# Tasks

Lanes: 1 (plugin package) and 2 (documentation and config) are independent; 3 is the serial tail
(generated output and the full repository gate).

## 1. Plugin package (lane 1, owns `packages/plugin-openspec/**`)

- [x] 1.1 Add `packages/plugin-openspec/assets/guidance/task-lanes.md`: a local-guidance heading that says it is plugin-owned, the lane definition, the lane-cut-or-single-lane-reason rule, 2-4 substantive lanes, the serial tail for shared and generated files, the ban on editing the change's spec artifacts or another lane's tasks, and the apply rule that the sequential loop runs within a lane while independent lanes use separate worktrees and merge after their checks and configured task review. Verify the file is LF-only, is under 4,096 bytes, and sits outside `assets/openspec`.
- [x] 1.2 Extend `packages/plugin-openspec/src/host/index.ts`: read the guidance asset once in `apply`, export a pure `assertGuidanceTargets(skills)` that rejects a lock missing `openspec-propose`, `openspec-update-change`, or `openspec-apply-change`, and append the guidance in `get` only for those three, before the adapter note. Verify `pnpm build` emits `lib/index.js` with the new helper and one registered provider.
- [x] 1.3 Add `assets/guidance/task-lanes.md` to the package `files` list. Verify `package.json` parses and the declared path exists; group 3's `pnpm gen` proves the vendoring accepts it.
- [x] 1.4 Extend `packages/plugin-openspec/test/skill-provider.test.ts`: `openspec-propose`, `openspec-update-change`, and `openspec-apply-change` contain the guidance before the adapter note; `openspec-explore`, `openspec-sync-specs`, and `openspec-archive-change` do not; the content still starts with the vendored upstream body; the guidance asset is listed in `files`, is outside `assets/openspec`, and is under 4,096 bytes. Verify `pnpm build` and `pnpm exec vitest run packages/plugin-openspec/test/skill-provider.test.ts` pass.
- [x] 1.5 Add a test for `assertGuidanceTargets` with a fabricated lock missing each of the three target names and with the real lock. Verify the test names the missing skill and passes for the real lock.

## 2. Documentation and one authoritative home (lane 2, owns `docs/openspec.md`, `openspec/config.yaml`)

- [x] 2.1 Update `docs/openspec.md`: state that the propose, update-change, and apply-change skill bodies append a plugin-owned task-lane addendum before the adapter note; name the asset path; say the other three skills are unchanged and that no project config is needed; and note that `pnpm openspec:update` regenerates only `assets/openspec`, so the addendum survives. Verify `pnpm lint` passes and the page names the three skills, the path, and the update behavior.
- [x] 2.2 Remove `rules.tasks` and `operations.apply.guidance` from `openspec/config.yaml`, keeping the archive guidance. Verify `openspec instructions tasks --change add-task-lane-guidance --json` returns no `rules` entry for the lane rule, `openspec instructions apply --change add-task-lane-guidance --json` returns no apply operation guidance, and `openspec doctor` reports the root healthy.

## 3. Serial tail: generated output and repository checks

- [x] 3.1 Run `pnpm gen` and confirm `packages/setup/node_modules/@dsh-setup/plugin-openspec/assets/guidance/task-lanes.md` exists and the plugin's built `lib/**` is vendored; then run `pnpm gen:check` and verify it exits 0.
- [x] 3.2 Run `pnpm build`, `pnpm check`, `pnpm validate:repo`, and `pnpm validate:composition`; verify they pass and `git diff --exit-code` is clean after the generated and built output is committed.

## Workflow follow-up

- After the next release and install, load `openspec-propose` in a workspace and confirm the task-lane addendum appears before the adapter note; this live check needs the owner's restart/install step and is not run from this session.
- Sync the `openspec-skills` delta into the main spec after apply.
- Run `pnpm reviews:check --change add-task-lane-guidance` and obtain the task-review PASS records before archiving.
- Archive the change and verify the archived spec path.
