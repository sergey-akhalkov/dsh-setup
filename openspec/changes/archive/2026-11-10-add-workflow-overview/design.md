# Design

## Context

The session Workflows tab currently has two segments, `Runs` and `Journal`. The `Runs` feed shows
projected runs; the `Journal` feed is a session-wide list of trigger evaluations with internal
reasons. The definitions, trigger catalog and receipts live on the design page. The host already
serves definitions (list and full document), triggers (with the last evaluation per trigger),
runs (paged, filterable by definition), events (paged journal) and health. The owner wants the first
segment to explain the automation: which triggers exist, which workflows they start, how often the
trigger fires, and how often the workflow succeeds, with a per-workflow page for description,
architecture, runs and history.

## Decisions

1. **Two segments**: `Workflows` first (overview, then the workflow page), `Runs` second (the
   existing all-runs feed). The `Journal` segment is removed as a breaking session-view change. Its
   useful content becomes the workflow page's evaluation history, scoped to that workflow.
2. **Group by the trigger kind the run records**: definitions carry `trigger.kind` (the value a
   run's projected `trigger` field shows), so the overview groups definitions by that kind. The
   triggers route's base entries are never summed (one event can evaluate several `fs.change`
   triggers, so summing trigger ids would multiply the count). A group's workflow list and
   mode/filter come from each definition's own `trigger`, so workflows in one kind can differ in
   mode and filter; the group's firing counter SHALL be the sum of the bound definitions'
   `definition:<id>` evaluation counts (`matched` counts evaluations that fired that workflow,
   `total` counts all its evaluations). A kind with no base catalog entry still renders from the
   definitions; a kind without bound definitions shows "no workflows bound" and no counter.
3. **Counters**: each trigger entry carries `matched/total` firings from the session journal. Each
   workflow shows `completed / all runs` plus separate `failed`, `running`, `cancelled` and
   `interrupted` counts. Success is `completed`; the denominator is every recorded run, so the ratio
   never hides unfinished work. `blocked` counts as non-terminal and is shown with `running` when
   non-zero.
4. **Read-only**: the overview and the workflow page never steer, execute, or write. The existing
   run page remains the only deeper run surface.
5. **No new persistence or routes**: the host extends two existing read responses.

## Host API

- `GET /api/workflows/triggers?session=`: every entry gains
  `counts: { matched, total }` (0/0 when the trigger never evaluated). The existing journal scan
  (`lastEvaluations`) also accumulates the counts per trigger id.
- `GET /api/workflows/runs?session=&stats=1`: returns
  `{ session, stats: { definitions: { [id]: { completed, failed, cancelled, interrupted, running,
  blocked, total } } } }` computed from the same attributed session runs, without paging. The
  displayed projection status is lossy (`done` folds `completed`; `failed` folds `failed` and
  `cancelled`; `running` folds `running`, `blocked` and `interrupted`), so the projection also gains
  an additive `lifecycle` field carrying the stored lifecycle (for a projected non-engine row, the
  outcome its record implies) and the stats aggregate the six buckets from it. Without `stats` the
  route behaves exactly as today apart from that additive field.
- `GET /api/workflows/definitions?id=<id>` stays the source for the workflow page's description and
  complete step chain (with `next`/branch/loop targets).
- `GET /api/workflows/events?session=&cursor=&limit=` stays the source for the workflow's
  evaluation history; the client filters the evaluations whose id is `definition:<id>`.

## Client architecture

- `view.tsx`: `Segment = 'workflows' | 'runs'`; a `workflow` selection (definition id) alongside the
  existing `run` selection. The navigation origin remembers where a run was opened: Back from a run
  opened on the workflow page returns to that page, otherwise to the runs list. Back from a workflow
  page returns to the overview. Scroll/focus restoration reuses the existing row-scan approach,
  generalized from `[data-run]` to `[data-workflow]`.
- New module `overview.tsx` with pure components and helpers:
  - `groupByTrigger(definitions, triggers, stats)` -> ordered trigger sections with their bound
    definitions and joined mode/filter/counts;
  - `runStatsLabel(stats)` -> the ratio plus the separate status counts;
  - `evaluationsFor(events, definitionId)` -> the evaluation records for that definition;
  - `architectureChain(steps)` -> the ordered step chain with executor and next/branch/loop text.
  Nested components stay hook-free (the client test harness renders them with the fake primitives).
- Loaders in `panel.tsx`/the view: `readDefinitions`, `readTriggers`, `readRunStats`,
  `readDefinitionDocument`, `readDefinitionRuns`, `readDefinitionEvents`. The view owns the data,
  the generation and lookup tokens, the refresh-on-open/on-demand/on-visibility behaviour, and the
  loaded-data retention on a failed background refresh.
- Locale: new EN keys for both segments, the overview group/column labels, the counter chips, the
  workflow page headings, the history labels, and the empty/error lines. Dynamic reason strings keep
  using the existing `reasonLabel`.
- Styles: layout-only additions reused from the current tab; rows remain the existing toolbar
  `Button` pattern, so no outline rules and keyboard focus work by construction.

## States

- First run / empty: overview with no definitions shows a muted "no workflows" line; a trigger
  without definitions shows "no workflows bound"; a workflow with no runs or no evaluations shows
  its own empty line.
- Loading: the status line plus per-block loading lines for the overview and the workflow page.
- Error: per-block inline error with Retry; a failed background refresh keeps the loaded overview
  and shows the refresh error.
- Narrow: the existing table/row layout wraps and stays keyboard usable; no new breakpoint logic.
- Keyboard: every row is a real button with an accessible name; focus returns to the selected
  workflow row after Back.

## Testing

- Host unit/handler tests: trigger counts (matched, total, empty session, multiple definitions), the
  projection's additive `lifecycle` field for all six statuses, and runs stats buckets
  (completed/failed/cancelled/interrupted/running/blocked, per-definition grouping, empty session),
  using persisted records for each status.
- Client pure tests: grouping order and joins including the four shipped `fs.change` catalog
  triggers, a definition kind with no base catalog entry, two workflows of one kind with different
  modes/filters, the group counter as the sum of the bound definitions' evaluation counts, the
  delegate/review newest-first order, ratio/label composition, the definition-scoped evaluation
  filter, and the step chain; client interaction tests: segment switch, overview load, workflow page
  load, run open from the workflow page and Back origin, Back scroll/focus, refresh failure
  retention, strict EN translator, read-only fetch tracker (no non-GET).
- Source guard: no raw `<button>`/`outline:` in the touched client sources (existing guard).
- Docs: `docs/workflows.md` and `docs/plugins.md`.

## Risks and mitigations

- The active `fix-workflow-run-lifecycle` change also owns `packages/plugin-workflows/src/host/**`.
  It is still in its spec phase; before implementing, check it has not touched `host/api.ts`, and
  rebase/coordinate if it does.
- Removing the Journal tab is breaking for anyone used to it; the workflow page's history replaces
  it and the docs call the change out.
- The displayed run status is lossy, so the overview's status buckets come from the additive
  `lifecycle` field; the client must never infer a bucket from `status`.
- The delta keeps the existing requirement scenario names because `openspec validate` refuses a
  MODIFIED block that drops a scenario; the journal-specific names now describe the per-workflow
  history, and the bodies state the new surface explicitly.
- Very long sessions: the stats endpoint keeps the overview light; the evaluation history still
  pages through the journal.

## Out of scope

Cross-session/global statistics, editing or re-running from the overview, cancelling runs, new
persistence, and any change to the engine's trigger evaluation or run lifecycle.
