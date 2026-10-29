# Tasks

Single lane: the skill assets, the catalog entry, and the provider test share the skill name and
description, and `lib/**` is generated; the build and validation tail is serial.

## 1. Author the skill (assets/interface-design/**)

- [x] 1.1 Write `SKILL.md` with the first-time test, the five-cost matrix, per-surface rules, red flags, repository anchors, and the review output; verify every required section heading is present in the file.
- [x] 1.2 Write `references/ui.md`, `references/cli.md`, `references/api.md`, and `references/agent-tools.md` with the detailed per-surface checklists; verify each file is linked from `SKILL.md` and that no upstream prose is copied verbatim.
- [x] 1.3 Write `references/sources.md` naming each adapted source, what was removed or rewritten, and why the CC-BY-SA CLI guidelines text and the Claude-specific plumbing are not vendored; verify it covers every reference file and the no-provenance-pin statement.

## 2. Register the skill (src/host/index.ts, package.json, test/skill-provider.test.ts)

- [x] 2.1 Add the `interface-design` entry to the `SKILLS` array in `src/host/index.ts`; verify `pnpm build` succeeds and the provider lists four skill names.
- [x] 2.2 Add the six new asset files to the package `files` list and update the package description; verify `pnpm build` succeeds and the published file list contains every asset.
- [x] 2.3 Extend `test/skill-provider.test.ts` with the new candidate and asset, keeping the description-sync assertion; verify `pnpm exec vitest run packages/plugin-working-principles/test/skill-provider.test.ts` passes.

## 3. Document the skill (README.md)

- [x] 3.1 Update the bundle's README row and description to name the interface design skill; verify `pnpm lint` and `pnpm validate:repo` pass.

## 4. Build and validate (serial tail)

- [x] 4.1 Run `pnpm build` and commit the regenerated `lib/**`; verify a second `pnpm build` leaves `git diff --exit-code` clean.
- [x] 4.2 Run `pnpm gen` and commit the regenerated `packages/setup/**` vendor copy; verify `pnpm gen:check` passes.
- [x] 4.3 Run `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, and `openspec validate "add-interface-design-skill" --strict`; verify every command exits green.

## 5. Verify the behavior in a session

- [ ] 5.1 In a fresh session with the updated package, confirm the catalog advertises `interface-design` and its body is absent until invoked; verify the catalog name and description match the asset.
- [ ] 5.2 Invoke the skill on a small interface and confirm the review output rates severity and Thinking Cost and names a concrete fix and location; verify the body and references load without network access.

## Workflow follow-up

- Run the task-scoped review for each checked task and commit the review record before the next task.
- Archive the change after the review gate passes.
