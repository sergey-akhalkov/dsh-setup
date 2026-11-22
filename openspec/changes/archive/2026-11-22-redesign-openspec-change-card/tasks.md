# Tasks

Serial plan: one lane. `packages/plugin-openspec/src/client/index.tsx` is a single hot file that holds
both the card markup and `PANEL_CSS`, and the row tests assert that same markup, so no two workers can
hold disjoint scopes here; generated `lib/**` and the vendored `packages/setup/**` tree are a serial
tail. Groups run in order.

## 1. Change row markup and styles (owns packages/plugin-openspec/src/client/index.tsx)

- [x] 1.1 Give `ChangeCard` its own `dsh-openspec-change-row` class and the two-column markup for an **active** row: a gutter stating `n/m` over `tasks` (or `—`), and a body holding the name with recency, the purpose, the facts row and the navigation row; keep the archived branch rendering exactly as today (archive date, task completion, purpose, commit, no actions); keep the row's Enter/Space activation, the `role="button"` row, and the stop-propagation on every inner control; verify `pnpm exec tsc -b packages/plugin-openspec` passes and the active row no longer references a labels row
- [x] 1.2 Replace the active-row rules in `PANEL_CSS` with the gutter layout (fixed gutter, hairline divider between the columns, one row of facts, one navigation row, hover and focus unchanged), leaving `.dsh-openspec-card` untouched for capability cards and for the archived branch; verify the new block contains no colour, font-size or spacing literal where a `--dsw-*` token exists (grep the block for `rgb(`, `#`, and `font-size:`), and that the row keeps the host focus ring
- [x] 1.3 Render both actions on an active row: `Apply` enabled while the change is not complete, `Archive` enabled only when every task is done, the inapplicable one disabled and inert with a state-specific description — `Archive` says every task must be complete, `Apply` on a complete change says the change is complete, and neither claims a missing task-review PASS; verify a disabled control sends no request and the archive/apply callbacks wired for the in-progress and complete groups are unchanged
- [x] 1.4 Fold the row's facts into one line — the phase as a dot plus short label, the spec verdict as a coloured word, and the review coverage as `review n/m` — and drop the task progress bar and the settled review bar from the active row; verify each fact still renders for planning, ready, applying and complete rows and that the verdict colours come from `--dsw-alias-state-*`
- [x] 1.5 Turn the artifact entries into ghost text buttons that keep `onOpenArtifact` and never open the card, clamp the purpose to two lines with its full text on the element's title, and drop the commit fact from the active row only; verify the navigation opens each artifact, the tooltip carries the untruncated text, no commit element renders on an active row, and an archived row still renders its commit
- [x] 1.6 Add the row's new label keys to the existing English label map and reuse `phase.*`, `change.tasksNotWritten` and `review.*` where the text still fits; verify every `t('...')` key the row uses exists in the map and no key the row stopped using is left behind

## 2. Tests and catalog text (owns packages/plugin-openspec/test/panel.test.ts, packages/plugin-openspec/locale/en.json)

- [x] 2.1 Update the row assertions in `test/panel.test.ts` to the new markup: gutter counts and the dash case, the two-line purpose, the facts row, the navigation row, both actions with the disabled state, and Enter/Space activation; verify `pnpm exec vitest run packages/plugin-openspec/test/panel.test.ts` passes
- [x] 2.2 Add tests for both disabled states — an incomplete change's `Archive` states that every task must be complete and sends no request when activated, and a complete change's `Apply` states that the change is complete and fills no draft; verify each test passes and fails when the matching `disabled` attribute is removed for a moment
- [x] 2.3 Rewrite the catalog description in `locale/en.json` so it describes the numeric-gutter card instead of the labels row and two progress bars; verify the file still parses (`node -e "JSON.parse(require('fs').readFileSync('packages/plugin-openspec/locale/en.json','utf8'))"`) and the sentence names the card's gutter, both actions and the read-only surface
- [x] 2.4 Add a test that an archived row keeps its archive date and last commit and offers no action, so the preserved branch cannot be folded into the active layout later; verify `pnpm exec vitest run packages/plugin-openspec/test/panel.test.ts` passes and the test fails if the archived branch renders the active layout

## 3. Generated output and gate (serial tail; owns packages/plugin-openspec/lib/**, packages/setup/**)

- [x] 3.1 Run `pnpm build` and `pnpm gen`, then commit the rebuilt `packages/plugin-openspec/lib/**` and the regenerated `packages/setup/node_modules/@dsh-setup/plugin-openspec/**`; verify `pnpm gen:check` passes and `git diff --exit-code` is clean after a second `pnpm build`
- [x] 3.2 Run `pnpm check`; verify typecheck, lint, build and the whole test suite pass with no generated drift
- [x] 3.3 Run `pnpm validate:repo` and `pnpm validate:composition`; verify both pass with the regenerated vendored tree

## 4. Live acceptance (verification only; owns no source path)

- [x] 4.1 Start a throwaway `DSH_HOME` with a web host and a fixture workspace holding two changes — one with four of twelve tasks done and a spec PASS, one complete — and open the OpenSpec tab; verify the gutter states the counts, exactly one action is enabled per card, the disabled one names the gate, and the layout holds at 360, 400 and 570 px without horizontal scrolling
- [x] 4.2 Measure the rendered card height at the sidebar's real width and record it against the current 247 px baseline in `design.md`; verify the reduction with a number rather than an impression
- [x] 4.3 Verify the Specs segment, the Archive segment and the change detail header render exactly as before the change, with the detail header still carrying the commit hash, date and subject

## Workflow follow-up

- Sync the `openspec-panel` delta into the main specs, then run
  `pnpm reviews:check --change redesign-openspec-change-card` and archive after every checked task has a
  task-review PASS.
- Release the setup and let the owner install it from an external PowerShell with the app closed.
