# Tasks

The redesign splits into five groups. Lane A owns the host projection (two additive fields and the title rule). Lane B owns the session run history. Lane C owns the new right-sidebar design page. Lane D owns the visual pass and the docs. Lane E is the serial integration tail. Groups 2 and 3 write disjoint client modules; group 4 touches both only after their shapes settle.

## 1. Host run truth (lane A, owns `packages/plugin-workflows/src/host/projection.ts`, `test/projection.test.ts`)

- [x] 1.1 Add `trigger` and `endedAt` to the projected run view, deriving `endedAt` from the latest `at` of the run's recorded steps and never from `updatedAt`; verify the projection tests assert both fields, no `endedAt` while running or when no step settled, and an unchanged `endedAt` for a completed retro that later records a turn block or a violation.
- [x] 1.2 Compose the displayed title from the recorded definition name and the recorded subject (`context.name`, the checkpoint turn parsed from `context.checkpoint`, short `taskId`), and keep the delegation, review, checkpoint, and unreadable-record titles unchanged; verify that `retro` (including its parsed `turn 6`), `verify`, `task-review`, and `change-intake` records produce distinct truthful titles and that the pinned `X intake` expectations in `test/projection.test.ts` and `test/run-provenance.test.ts` are replaced, not deleted.
- [x] 1.3 Add the optional `order=newest` parameter to the runs route, applied after the source and definition filters and before paging, and keep the default order unchanged; verify newest-first paging, that a `definition` request is reversed once and not twice, and that an unknown `order` value is ignored.
- [x] 1.4 Add the optional session-scoped single-run lookup (`run=<id>`) to the runs route, resolved after attribution so another session's run is never returned, and return the matching run or an empty list; verify a present run, an absent id, and another session's id.

## 2. Session run history (lane B, owns `src/client/view.tsx`, new `src/client/run-history.tsx`, new `src/client/run-detail.tsx`, `src/client/panel.tsx`, `test/client-view.test.ts`, `test/client.test.ts`)

- [x] 2.1 Replace the health banner with one status line (`StateDot` + text, details in a `Tooltip`) and keep the four states distinguishable; verify `listener-down`, `journal-readonly`, `waiting`, and `healthy` each render with the error or counts available on demand.
- [x] 2.2 Rebuild the run list as the first content of the view with native rows, the workflow title, the subject, the trigger, relative start time with the absolute time on hover, status dot, and duration from the terminal time when present; request the runs newest-first and deduplicate appended pages by run id; verify newest-first order, deduplication after a run arrives between pages, row content, and the loading, empty, error-with-retry, and load-more states.
- [x] 2.3 Add the run detail page with the definition identity or source, trigger, start and end time, status, steps (state, time, evidence kind and reference or link, failure class, reason), violations, error, and the record link; verify the back control restores the list scroll position and returns focus to the originating row.
- [x] 2.4 Add the journal segment with each event's trigger evaluations inline, linking only an evaluation that carries a run id; remove `DefinitionsTable`, `TriggersTable`, `ReceiptsList`, and `WhyNotTable` from the session view; verify `run-created` links to its run, `would-fire` and `run-suppressed` render their reason without a link, `not-applicable` renders its reason, and no duplicate table remains.
- [x] 2.5 Add the refresh controller: load on open, on demand, and on `visibilitychange → visible`; re-read the pages already loaded and resolve the open run by id, rendering "no longer recorded" with the back control only on a lookup miss; verify the existing generation guard rejects a stale response, a new arrival that pushes the selection beyond the re-read window keeps it selected, and a confirmed-absent run renders the not-recorded state.
- [x] 2.6 Update the locale dictionary (new keys, drop the keys the view no longer renders) and add the guard test that scans client sources for literal `t('…')` keys and fails when one is absent from `EN`; verify the guard fails on a planted missing key and that no view state renders a raw key.
- [x] 2.7 Remove the Design control and the authoring imports from the session view; verify no authoring control remains, the display path performs no write, and the container is a pure reader of the API.

## 3. Design page in the right sidebar (lane C, owns new `src/client/design-page.tsx`, `src/client/index.tsx`, `src/client/design.tsx`, `src/client/palette.tsx`, `src/client/properties.tsx`, `test/client.test.ts`)

- [x] 3.1 Register the page type (`sidebarRightTabs.register` with a guide card), its body in `sidebar.right.pane.tab`, and the inert fallback when the sidebar services are absent; verify the card opens the page by kind, the session view still registers alone, and no error reaches the host.
- [x] 3.2 Move the editor body into the page and adapt it to the panel: list mode by default below the shipped narrow width, the palette as an `Add step` menu, and the property panel as a collapsible section; verify the list/canvas modes, add/connect/edit/delete, save, reload, templates, drafts, and the 409 handling still pass their existing tests.
- [x] 3.3 Move the definition list, the trigger catalog with last evaluation, and the receipts onto the page; verify each section renders from the existing endpoints and stays read-only where it was read-only.
- [x] 3.4 Guard unsaved edits on an explicit tab close through the sidebar's close-handler seam; verify a dirty draft asks before closing and a clean page closes without a prompt.
- [x] 3.5 Update the `/workflows` command text to name the session tab and the `Workflow design` card; verify the response names both and opens nothing.

## 4. Native visual pass and documentation (lane D, owns `src/client/styles.ts`, `docs/workflows.md`, `docs/plugins.md`)

- [x] 4.1 Finish the primitive pass on both surfaces (`Button`, `SegmentedControl`, `Pill`, `Menu`, `DisclosureRow`, `AnimatedRows`, `PathLabel`, `JsonTree`, `relativeTime`, `GuideArtwork*`) and remove hand-rolled controls, raw colours, and ad-hoc focus styles; verify tokens only, visible focus, reduced-motion behaviour, and no new dependency in any `package.json`.
- [x] 4.2 Document the two entry points and the session view structure in `docs/workflows.md` and `docs/plugins.md` (run history, detail page, journal, guide card, design page, refresh); verify the documented actions match the built UI and the command text.

## 5. Integration (lane E, owns `packages/plugin-workflows/lib/**`, `packages/setup/**`, repository-wide checks)

- [x] 5.1 Run `pnpm build`, `pnpm gen`, `pnpm gen:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm validate:repo`, `pnpm validate:composition`, `pnpm validate:installer`, and `openspec validate redesign-workflows-ui --strict`; verify all pass and the regenerated `lib/**` and vendored setup are committed with no other build drift.
- [ ] 5.2 Run the owner visual check on an installed build: the session tab opens runs-first, a run opens its detail and returns, the guide card opens the design page, the narrow panel opens the list with the canvas reachable, and no screen shows a raw locale key; record the observed result.

## Workflow follow-up

- Archive the change only after the project's review requirements are satisfied: every checked task has a committed task-review PASS, then `pnpm reviews:check --change redesign-workflows-ui` before `openspec archive`.
- Do not change the engine, gates, definitions, run-record format, or receipts in this change; a needed behavior change becomes its own change.
- Release and install follow the normal release plan; the previous Design button needs no migration.
