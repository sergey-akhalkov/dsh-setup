# Tasks

The change splits into three work lanes and one serial tail. Lane A owns the two read-only host
extensions; lane B owns the session view and its tests; lane C owns the documentation. The lanes are
independent (disjoint paths) and can run in separate worktrees; the serial tail owns the whole
repository gate, the change artifacts' review/archive step, and the release, so it runs after the
lanes merge.

Before lane A starts, check that the in-flight `fix-workflow-run-lifecycle` change has not touched
`packages/plugin-workflows/src/host/api.ts`; if it has, rebase or coordinate those hunks first.

## 1. Host statistics API (lane A, owns `packages/plugin-workflows/src/host/api.ts`, `packages/plugin-workflows/src/host/projection.ts`, `packages/plugin-workflows/test/api.test.ts`, `packages/plugin-workflows/test/run-provenance.test.ts`)

- [x] 1.1 Extend the triggers route so every entry carries `counts: { matched, total }` for the requesting session: the existing journal scan also accumulates, per trigger id, how many evaluations matched and how many were recorded, and the response includes `0/0` when a trigger never evaluated. Verify with tests for an empty session, a trigger that matched twice and missed once, two definitions sharing a kind, and an unknown session id.
- [x] 1.2 Add the original lifecycle to the projected run view as an additive `lifecycle` field (`completed`, `failed`, `cancelled`, `interrupted`, `running`, `blocked`; a projected non-engine row derives its value from the record outcome) without changing the displayed `status`, then add the `stats=1` mode to the runs route returning `{ session, stats: { definitions: { [id]: { completed, failed, cancelled, interrupted, running, blocked, total } } } }` aggregated over the attributed session runs from that field, without paging. Verify the field for all six persisted statuses, the status buckets, the per-definition grouping, an empty session (`definitions: {}`), and that the default paged response is unchanged apart from the additive field.

## 2. Session overview and workflow page (lane B, owns `packages/plugin-workflows/src/client/view.tsx`, new `packages/plugin-workflows/src/client/overview.tsx`, `packages/plugin-workflows/src/client/panel.tsx`, `packages/plugin-workflows/src/client/locale.ts`, `packages/plugin-workflows/src/client/styles.ts`, `packages/plugin-workflows/test/client*.test.ts`, `packages/plugin-workflows/test/locale-guard.test.ts`)

- [x] 2.1 Replace the view segments with `Workflows` and `Runs`, remove the `Journal` segment, its loader, its list, and its URL/API use, and add the overview loaders (definitions, triggers, run stats) with the existing generation/token guards. Verify that switching segments renders the overview and the all-runs feed, that no journal request is issued, and that the existing run list, run detail, refresh, and visibility behaviours still pass.
- [x] 2.2 Build the overview as one section per trigger kind: the kind, its workflows with their own mode/filter, name, version, risk, `completed / total` runs, separate `failed`/`running`/other counts, and the latest run; the group's firing count is the sum of its bound definitions' `definition:<id>` matched/total evaluation counts and never the base catalog triggers' counts. A trigger with no bound workflows states so, a kind with no base catalog entry still renders, and an empty definition list renders a truthful empty line. Rows are keyboard-accessible buttons with `data-workflow` and open the workflow page. Verify the grouping/join and label helpers, the four shipped `fs.change` catalog triggers, a kind without a base entry, two workflows of one kind with different modes/filters, and the rendered states from interaction tests.
- [x] 2.3 Add the workflow page: the definition document's description, version, risk and gate ownership; the ordered step chain with executor and next/branch/loop text; the trigger binding with firing counts; the workflow's runs newest first, paged, opening the existing run page; and the workflow's evaluation history with each event's evaluations inline, a run link only for an evaluation carrying a run id, and Back restoring the overview's scroll and focus. Remember where a run was opened so Back returns to the workflow page when it came from there, otherwise to the runs list. Verify the load, the paging, the Back origins, the empty states, the refresh retention, and the read-only fetch tracker (no non-GET request).
- [x] 2.4 Update the locale dictionary for all new visible strings and add or extend the guards: the strict translator test for every `t('…')` key, the no-raw-`<button>`/no-`outline:` source guard, and the client interaction tests for the two segments and the workflow page, including the newest-first delegate/review order in the runs list and the definition-scoped evaluation history (a shadow trigger `would-fire` evaluation is excluded). Verify a planted missing key fails the guard, and that the existing a11y and canvas-budget tests still pass.

## 3. Documentation (lane C, owns `docs/workflows.md`, `docs/plugins.md`)

- [x] 3.1 Document the two session segments, the overview's trigger grouping, firing counts and success ratio semantics (`completed` over all runs, `failed`/`running` separate), and the workflow page's description, architecture, runs and evaluation history; state the `Journal` segment removal as the breaking change.
- [x] 3.2 Document the two read-only API extensions (`counts` on the triggers route, `stats=1` on the runs route) in the plugin page's API notes and keep the existing read-only/no-write constraint visible.

## 4. Serial integration tail (serial: owns the repository-wide gate, generated output, the change review/archive step, and the release)

- [x] 4.1 Build and run the full gate on the merged tree: `pnpm build`, `pnpm check`, `pnpm gen:check`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm validate:installer`, and `git diff --exit-code` after the build; commit the regenerated output when the generator reports drift.
- [ ] 4.2 Run the spec-review on the change, tick and review the lane tasks through the delegation rules, archive `add-workflow-overview` (syncing the two delta specs into the main specs) and add its change-history entry to `docs/openspec-status.md`.
- [ ] 4.3 Release 0.31.0 per `docs/releasing.md`: `pnpm release:prepare --version 0.31.0`, build, validate, dogfood, clean-diff and `gen:check` checks, commit the bump, tag `v0.31.0`, push `main` and the tag, and verify the published market index lists 0.31.0.
