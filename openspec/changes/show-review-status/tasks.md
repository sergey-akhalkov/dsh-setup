# Tasks

**Single serial lane:** one owner runs the whole plan serially. The two plugin halves are not
independent: the OpenSpec host reads the `workflowsReviewStatus` service the workflows host
provides, the panel and the sidebar share one live-route contract, and both packages ship through
the same generated `lib/**` and vendored setup copy. One owner keeps that contract coherent. The
live half (1.2, 1.5) depends on the `reviewLive` / waiting / orphaned projection from
`fix-review-run-liveness` (issue #7); the static half (1.1, 1.6-1.9) does not, so land the static
tasks first if #7 is not applied yet.

## 1. Single lane: review status surfaces (serial) `packages/plugin-workflows/**` `packages/plugin-openspec/**` `docs/workflows.md` `docs/plugins.md`

### Workflows review read model

- [x] 1.1 Add `packages/plugin-workflows/src/host/review-status.ts` with `summaries(workspace, changes)`: read the local whole-spec record, compare its `digest` with `currentSpecDigest`, count checked tasks whose portable approval matches the working-tree `taskReviewCoverage` rule, and return the bounded `ChangeReviewSummary`; verify a unit test for current PASS, stale PASS, findings, no record, missing tasks, unreadable `tasks.md`, and a valid but uncommitted approval counting as the gate counts it.
- [x] 1.2 Add `live(workspace)` on the same module, mapping the #7 `reviewLive` / waiting projection to `ReviewLiveEntry` and excluding orphaned runs; verify a unit test for starting, live, waiting, and orphaned states.
- [x] 1.3 Provide the `workflowsReviewStatus` service next to `workflowsArchiveGate` and register `GET /api/workflows/reviews/live` with both forms: a single workspace-scoped `session` and a bounded `sessions` list (dedupe, 100-id cap, neither/both refused, closed ids skipped, 405 for non-GET, no prompts/findings/diffs/paths); verify the route test for each case, including an idle session A reading session B's review in the same workspace and the `sessions` form for A omitting B.
- [x] 1.4 Document the review-liveness read route and its two forms in `docs/workflows.md` beside the review executor section; verify `pnpm lint` after the markdown edit.

### Session-row indicator (client)

- [x] 1.5 Add the Client polling store for live reviews using the `sessions` form: collect the mounted session ids, send one batch request every 4000 ms while the document is visible, cap the ids, and keep the last state on a failed read; verify unit tests for the id dedupe/cap and the response decode.
- [x] 1.6 Register the `sidebar.session.row.leading` occupant (id `dsh-setup-workflows-review`) with the 14px ring, the waiting glyph, the accessible name, the tooltip, and the reduced-motion rule; verify in a throwaway `DSH_HOME` with the Nuphus browser that a live review shows the ring and a settled verdict removes it.
- [x] 1.7 Document the session-row review indicator in `docs/workflows.md` (the waiting-close section); verify `pnpm lint`.

### OpenSpec panel review state

- [x] 1.8 Read `workflowsReviewStatus` at request time in the change-list route and add the optional `review` field to active rows only, omitting it when the service is absent or throws; verify a route test with the service, without it, and with a failing summary, plus that archived rows carry no field.
- [x] 1.9 Extend the panel wire types and decoders with the optional `review` field; verify decoder tests for a valid shape, a malformed field, and an absent field.
- [x] 1.10 Add the review line to `ChangeCard` with the `spec` and `reviewed X/Y` units, tones, missing-task and provenance tooltips, and the live/waiting unit states; verify the state mapping with unit tests for PASS, outdated, findings, missing approvals, uncommitted approval, not reviewed, live, and waiting.
- [x] 1.11 Add the panel's workspace-scoped live poll (single `session` form, 4000 ms, tab visible, stop on 404), merge the live units into the review line, and perform one debounced change-list re-read when a previously observed live entry settles; the periodic read itself never re-reads the list. Update the panel's no-polling test so it asserts that the change list registers no timer while the separate liveness timer is permitted, and verify the hidden-tab, absent-engine, idle-session and cross-session cases plus a verdict-only write (no artifact edit) updating the card without a manual refresh.
- [x] 1.12 Document the review line and the separate liveness poll in the OpenSpec panel section of `docs/plugins.md` and update the plugin metadata description in `packages/plugin-openspec/locale/en.json`; verify `pnpm lint`.

### Integration

- [x] 1.13 Rebuild the packages and the vendored setup copy (`pnpm build`, `pnpm gen`) and commit the generated files; verify `pnpm gen:check` and `pnpm build && git diff --exit-code` are clean.
- [x] 1.14 Run `pnpm check` (typecheck, lint, build, test) and `pnpm validate:repo`; verify both exit 0.
- [x] 1.15 Run `openspec validate show-review-status --strict`; verify exit 0 with the ADDED and MODIFIED requirements accepted.
- [x] 1.16 Run the acceptance in a throwaway `DSH_HOME` with the Nuphus browser: a live review shows the session-row indicator and the card line, an idle panel session sees a review owned by another session, and a settled verdict replaces both without a manual refresh; never run it against the live desktop profile.

## Workflow follow-up

- Sync the `openspec-panel` and `workflow-observability` deltas into the main specs, then archive the
  change after the current task-review and spec-review PASS.
- Run `pnpm reviews:check --change show-review-status` before archiving; every checked task needs a
  committed `reviews/<taskId>.json` PASS.
- Release through the repository process (version bump, build, gate, tag, push) when the owner
  schedules it.
