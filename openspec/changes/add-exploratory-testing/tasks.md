# Tasks

Serial plan: every group is owned by `lead`; `packages/setup/**`, generated `lib/**`, and the shared
intake/adoption checks are serial hot files, so no parallel lane is available.

## 1. Spec-less change platform (serial; owns packages/plugin-openspec/assets/workflows/**, packages/plugin-openspec/test/**, packages/plugin-workflows/src/host/adoption.ts, packages/plugin-workflows/src/host/archive-authorization.ts, packages/plugin-workflows/test/adoption.test.ts, packages/plugin-workflows/test/host-wiring.test.ts)

- [x] 1.1 Extend the `change-intake` spec step evidence and prompt to accept `skip_specs: true` in place of a spec file; verify `pnpm exec vitest run packages/plugin-openspec/test/workflows-contribution.test.ts` passes and a fixture spec-less change passes `openspec validate <name> --strict`
- [x] 1.2 Extend `verifyAdoptionEvidence` and `workflowsArchiveGate.authorizeAndCheck` to accept proposal/design/tasks plus `skip_specs: true` while still requiring the current whole-spec PASS; verify adoption tests and the host-wiring archive authorization cover the spec-less path and the missing-marker refusal
- [ ] 1.3 Update the bundled `review-spec` instruction and its test so the scope includes `findings/**/*.md` when present and a three-artifact spec-less change still gets a plan review; verify a spec-less fixture with findings earns a whole-spec PASS naming the finding evidence
- [x] 1.4 Document the spec-less intake/adoption/archive path in `docs/workflows.md` and `docs/plugins.md`; verify `pnpm lint` passes and the docs name the `skip_specs` marker
- [x] 1.5 Include the normalized effective `skip_specs` declaration in `specDigest`/`currentSpecDigest` and the review/adoption digest contract; verify review and adoption tests show that adding, changing, or removing the marker changes the digest and invalidates a current PASS
- [x] 1.6 Recheck artifact eligibility (a spec file or `skip_specs: true`) in archive authorization and adoption after the whole-spec record check; verify a marker removal after PASS refuses `mv`/archive and adoption, including during the confirmation re-verify
- [x] 1.7 Add regression coverage proving that changing or removing the marker after PASS invalidates authorization and that the live `mv`/`Move-Item` archive path cannot archive a change with neither specs nor the required marker; verify the focused workflow tests pass

## 2. Package and host registration (serial; owns packages/plugin-exploratory-testing/package.json, packages/plugin-exploratory-testing/cordis.fragment.yml, packages/plugin-exploratory-testing/tsconfig.json, packages/plugin-exploratory-testing/src/**, packages/plugin-exploratory-testing/test/**, packages/plugin-exploratory-testing/locale/**, packages/plugin-exploratory-testing/icon.svg, tsconfig.json)

- [x] 2.1 Create `packages/plugin-exploratory-testing` with `package.json`, `cordis.fragment.yml`, `tsconfig.json`, `locale/en.json`, and `icon.svg`; add the package to the root `tsconfig.json` references; verify `pnpm install` succeeds and `pnpm list -r --depth -1` includes `@dsh-setup/plugin-exploratory-testing`
- [x] 2.2 Implement `src/host/index.ts` to register `exploratory-testing` with its description, invocation flags, bundled rank, resource base, and no always-on system-prompt registration; verify `pnpm exec tsc -b packages/plugin-exploratory-testing` passes
- [x] 2.3 Add `test/skill-provider.test.ts` covering the catalog candidate, body load, unknown-name rejection, `inject` containing only `skills`, and no `systemPrompt` access; verify `pnpm exec vitest run packages/plugin-exploratory-testing/test/skill-provider.test.ts` passes

## 3. Method content (serial; owns packages/plugin-exploratory-testing/assets/**, packages/plugin-exploratory-testing/test/skill-content.test.ts)

- [x] 3.1 Write `assets/exploratory-testing/SKILL.md` covering the state scan, factor anchors, score and overrides, anti-repetition and focus modes, the two user gates, the A/B artifact contracts including the spec-less outcome path, session charters, classification, regression and spec proof, knowledge capture, and safety; verify every requirement in the delta spec has a named section in the body
- [x] 3.2 Write `assets/exploratory-testing/templates.md` with copy-ready A proposal/design/tasks/state/brief, B proposal/design/finding/decision, and session templates; verify every field named in `design.md` D4 and D5 appears in the matching template
- [x] 3.3 Add `test/skill-content.test.ts` asserting the skill names the eight state factors, both gates, the five classifications, the red-proof rule, `skip_specs` for A and the spec-less-outcome rule, and that the templates contain the A/B/finding sections; verify `pnpm exec vitest run packages/plugin-exploratory-testing/test/skill-content.test.ts` passes

## 4. Metadata and setup integration (serial; owns README.md, packages/plugin-exploratory-testing/lib/**, packages/setup/**)

- [ ] 4.1 Add the plugin row and the opt-in/no-always-on behavior to the root README plugin table and the package locale metadata; verify `pnpm lint` passes and the README row is present
- [ ] 4.2 Run `pnpm gen` and `pnpm build`, then commit the generated patch, `lib/**`, and the vendored setup tree; verify `pnpm gen:check` passes, the setup patch contains `dsh-setup-exploratory-testing`, and the setup manifest lists the package
- [ ] 4.3 Verify the package ships only declared files (`lib/index.js`, `lib/index.d.ts`, assets, locale, icon, both YAML files) with `pnpm pack --dry-run --pack-destination .tmp`; confirm no Client entry and no install scripts

## 5. Integration and acceptance (verification only; executes the serial gates, owns no source path)

- [ ] 5.1 Run `pnpm check`; verify typecheck, lint, build, and tests pass, and the worktree has no generated drift after `pnpm build`
- [ ] 5.2 Run `pnpm validate:repo` and `pnpm validate:composition`; verify both pass with the new row and the intake/adoption changes
- [ ] 5.3 Run `pnpm dogfood`; verify the installer accepts the copied profile with the new bundle mounted
- [ ] 5.4 Dry-run the method in a disposable git workspace with a minimal OpenSpec root and a throwaway `DSH_HOME`: create an `explore-*` A with `skip_specs: true`, state, brief, and tasks, and walk it through intake, adoption, and archive; create a `fix-*` B with findings and a decision log, verify both validate under the spec-less path, no fix task runs while a decision is pending, and a recorded decision updates B to `skip_specs: true` when every finding names an existing scenario or to a delta when a requirement changes
- [ ] 5.5 Verify the review-loop acceptance: a frozen whole-scope PASS survives concurrent code edits, a plan-artifact edit makes the record stale and requires another round, and a code-only edit does not invalidate the spec review; test the live fallback against its actual reviewed scope, verify the PASS record's digest matches the current change, and record the run id

## Workflow follow-up

- Sync the `exploratory-testing`, `openspec-workflows`, and `workflows` deltas into their main specs.
- Run `pnpm reviews:check --change add-exploratory-testing` and archive after every checked task has a task-review PASS.
- Release and install the setup, then run the first real exploratory cycle; that cycle creates its own `explore-*` and `fix-*` changes and is not part of this change.
