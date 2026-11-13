# Tasks

Single lane: only the lead edits this change, and the policy text, its compiled `lib/**`, and the
generated `packages/setup/**` form one serial dependency chain; no independent lane exists.

## 1. Policy text and provider tests (owns `packages/plugin-answer-page/src/host/index.ts`, `packages/plugin-answer-page/test/skill-provider.test.ts`)

- [x] 1.1 In `src/host/index.ts`, replace `SKILL_DESCRIPTION` with the proactive line from
      `design.md`, replace the adapter policy paragraph with the proactive policy, and add the
      flow-precedence paragraph. In `test/skill-provider.test.ts`, assert the new description, the
      proactive trigger and exclusions, the adapter-wins precedence, and the deployment paths; remove
      the old "No always-on use" and "Use only when the user asks" assertions.
- [x] 1.2 Run `pnpm build` (the provider test imports `lib/index.js`) and then
      `pnpm exec vitest run packages/plugin-answer-page/test/skill-provider.test.ts`; verify it passes
      and the loaded content carries the new description, policy, and precedence text.

## 2. Documentation and market metadata (owns `packages/plugin-answer-page/locale/en.json`, `README.md`, `docs/answer-pages.md`, `docs/plugins.md`)

- [x] 2.1 Update `locale/en.json` to the proactive policy and drop the "no always-on cost" claim,
      keeping the upstream project, author, version, license, and source link. Verify the JSON parses
      with `node -e` and the attribution fields are intact.
- [x] 2.2 Rewrite the "When a page is produced" section of `docs/answer-pages.md`, the README plugin
      row, and the `docs/plugins.md` Answer pages section where it restates the trigger. Verify no
      stale "narrow policy" or "on demand" trigger wording remains in the touched sections, every
      relative link resolves, and `pnpm lint` passes for the edited Markdown.

## 3. Generated artifacts and integration (owns `packages/plugin-answer-page/lib/**`, `packages/setup/**`, the repository gate)

- [x] 3.1 Run `pnpm build`, then `pnpm gen`; commit `packages/plugin-answer-page/lib/**` and the
      regenerated `packages/setup/**`. Verify `pnpm build && git diff --exit-code` and `pnpm gen:check`
      exit 0.
- [x] 3.2 Run `pnpm check`, `pnpm validate:repo`, `pnpm validate:composition`, and
      `pnpm validate:installer`; all exit 0.
- [x] 3.3 Re-run `openspec validate widen-answer-page-policy --strict` after the edits; it exits 0.
- [x] 3.4 Owner step: install the built candidate into a throwaway `DSH_HOME` dev profile through the
      documented external install-and-restart procedure (never the live desktop profile), and confirm
      its catalog description and loaded adapter text show the new proactive policy and precedence
      before the smoke. Then ask an unrequested complex explanation; confirm a page renders under
      `.tmp/answers/`, the reply links it and the `present` card appears, and nothing is written under
      the user home or the system temporary directory.

## Workflow follow-up

- Archive the change after `pnpm reviews:check --change widen-answer-page-policy` reports archive-ready.
- Sync the delta into `openspec/specs/answer-pages/spec.md` on archive.
- Release through the normal flow and update the installed desktop profile with the released setup.
