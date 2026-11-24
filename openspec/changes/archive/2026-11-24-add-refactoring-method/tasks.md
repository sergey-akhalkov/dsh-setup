# Tasks

Serial plan: every group is owned by `lead`; `packages/setup/**`, generated `lib/**`, and the root
`tsconfig.json` are shared hot files, and the platform check depends on the `add-exploratory-testing`
work, so no parallel lane is available.

## 1. Package and host registration (owns packages/plugin-refactoring/package.json, packages/plugin-refactoring/cordis.fragment.yml, packages/plugin-refactoring/tsconfig.json, packages/plugin-refactoring/locale/**, packages/plugin-refactoring/icon.svg, packages/plugin-refactoring/src/**, packages/plugin-refactoring/test/skill-provider.test.ts, tsconfig.json)

- [x] 1.1 Create `packages/plugin-refactoring` with `package.json` (`@dsh-setup/plugin-refactoring`, the repository version, `engines.dsh`, `dsh.bundle.patch`, a files list with the skill assets, no install scripts), `cordis.fragment.yml` with row `dsh-setup-refactoring`, `tsconfig.json`, `locale/en.json`, and `icon.svg`; add the package reference to the root `tsconfig.json`; verify `pnpm install` succeeds and `pnpm list -r --depth -1` includes the package
- [x] 1.2 Implement `src/host/index.ts` to register `refactoring` with its catalog description, `modelInvocable` and `userInvocable`, bundled rank 600, `assets/refactoring` as the resource base, and `assets/refactoring/SKILL.md` as the locator; register no system-prompt contribution and no tool; verify `pnpm exec tsc -b packages/plugin-refactoring` passes
- [x] 1.3 Add `test/skill-provider.test.ts` covering the catalog candidate, body load, unknown-name rejection, `inject` containing only `skills`, the adapter note, and no `systemPrompt` access; verify `pnpm exec vitest run packages/plugin-refactoring/test/skill-provider.test.ts` passes

## 2. Method content (owns packages/plugin-refactoring/assets/refactoring/**, packages/plugin-refactoring/test/skill-content.test.ts)

- [x] 2.1 Write `assets/refactoring/SKILL.md` covering: when to use and when not; prerequisites (OpenSpec, spec-less platform, safe environment); the audit sources and the nine ROI factors with anchors, formula, hard overrides, anti-repetition, WIP limit, and path classes; user gate 1; the audit A and refactor B artifact contracts including the review-safe `findings/P-*.md` layout; the mandatory four-proof safety net; user gate 2; small green steps; the behavior-change stop rule; the deduplication rule; migration patterns; verification and the ratchet; knowledge continuity; portability and safety; optional Serena/native tool adapters; verify every requirement in `specs/refactoring/spec.md` has a named section
- [x] 2.2 Write `assets/refactoring/templates.md` with copy-ready audit A proposal/design/tasks, path finding record, ROI register, refactor B proposal/design/tasks, safety-net record, step record, verification/ratchet record, decision log, and close record; verify every field named in the design decisions appears in the matching template
- [x] 2.3 Add `test/skill-content.test.ts` asserting the skill names the nine factors and formula, both user gates, the four safety-net proofs, the behavior-change stop rule, the ratchet, the spec-less refactor rule, the review-safe artifact layout, and the optional tool boundary; verify `pnpm exec vitest run packages/plugin-refactoring/test/skill-content.test.ts` passes

## 3. Metadata, docs, and setup integration (owns README.md, docs/plugins.md, packages/plugin-refactoring/lib/**, packages/setup/**)

- [x] 3.1 Add the plugin row and the opt-in/no-always-on behavior to the root `README.md` plugin table and a short `docs/plugins.md` entry; verify `pnpm lint` passes and the README row is present
- [x] 3.2 Run `pnpm gen` and `pnpm build`, then commit the generated package patch, `lib/**`, and the vendored setup tree; verify `pnpm gen:check` passes, the setup patch contains `dsh-setup-refactoring`, and the setup manifest lists the package
- [x] 3.3 Verify the package ships only declared files (`lib/index.js`, `lib/index.d.ts`, both assets, locale, icon, both YAML files) with `pnpm pack --dry-run --pack-destination .tmp`; confirm no Client entry and no install scripts

## 4. Platform prerequisite and review-scope verification (verification only; owns no source path)

- [x] 4.1 Verify the installed platform accepts a spec-less change through intake, adoption, and user-click archive; if the `add-exploratory-testing` spec-less support is absent, record the prerequisite and stop without editing the platform or adding a fake delta; verify with a fixture change
- [x] 4.2 Verify the whole-spec review reads `findings/**/*.md` and that every decision-relevant audit/path fact lives in `proposal.md`, `design.md`, `tasks.md`, or a `findings/` record; verify the appendices `audit.md` and `brief.md` are linked but not required for the verdict

## 5. Integration and acceptance (verification only; owns no source path)

- [x] 5.1 Run `pnpm check`; verify typecheck, lint, build, and tests pass, and `pnpm build` leaves no generated drift
- [x] 5.2 Run `pnpm validate:repo` and `pnpm validate:composition`; verify both pass with the new row and the vendored package
- [x] 5.3 Run `pnpm dogfood`; verify the installer accepts the copied profile with the new bundle mounted and does not touch the live desktop profile
- [x] 5.4 Dry-run the method in a disposable git workspace with a minimal OpenSpec root and a throwaway `DSH_HOME`: create an `audit-*` change with `skip_specs: true`, a ranked register, and `findings/P-*.md` records; approve a path; create a `refactor-*` change; prove a green baseline and one mutation; execute one behavior-preserving step; verify the same oracles pass; add a ratchet; close; verify no production edit runs before either gate and no behavior changes
- [x] 5.5 Load the skill in a throwaway profile and verify the catalog entry, body load, and absence from the assembled prompt before invocation; verify the desktop profile is untouched

## Workflow follow-up

- Sync the `refactoring` delta into the main specs.
- Run `pnpm reviews:check --change add-refactoring-method` and archive after every checked task has a task-review PASS.
- Release and install the setup, then run the first real audit/refactor cycle; that cycle creates its own `audit-*` and `refactor-*` changes and is not part of this change.
