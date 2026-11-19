# Proposal

## Why

Issue #8: when a turn closes as a waiting close, the session list drops its activity spinner even
though a `spec-review`, `task-review`, or `integration-review` run is still live. The review keeps
running, but the session looks finished, so the owner has no way to tell that work is still in
flight.

The same blind spot sits in the OpenSpec change card. The card shows task completion, artifacts,
and the last commit, but nothing about review: whether the change ever received a whole-spec PASS
from the reviewer, whether that PASS is still current after a plan edit, or whether every checked
task carries the portable task-review PASS the archive gate requires. A live review and a finished
change look identical.

The records and the liveness predicate already exist. `fix-review-run-liveness` (issue #7) owns
the executor-liveness projection (`live` / `waiting on <runId>` / `orphaned`), the local
whole-spec record and the committed `reviews/<taskId>.json` approvals are the same evidence the
archive gate reads. This change turns that evidence into the two surfaces the owner actually
looks at, without inventing a second definition of "reviewed".

## What Changes

- A session whose waiting close left a review live shows a review indicator in the session list's
  leading seat: a small ring while the review is starting or running, a static ring while the run
  waits on a covering live review. The indicator ends exactly when the verdict settles and the
  shell's own turn spinner takes over.
- Each active change card gains one compact `Review` line between the progress bar and the
  artifact tags:
  - the whole-spec state: current PASS, outdated after a plan edit, findings, error, or no local
    record;
  - the checked-task coverage: how many checked tasks have a valid portable task-review PASS
    record under the change's `reviews/` directory, exactly as the archive gate counts it, out of
    how many are checked (a commit-backed audit stays with `pnpm reviews:check`);
  - a live review replaces only its own unit with a spinner and the unit label, so a running review
    is never rendered as finished.
- Missing task numbers, the PASS reviewer/model and time, and findings titles stay in the tooltip,
  so the card height does not grow with the task count.
- A profile without the workflows plugin, a workspace with no reviews, and archived changes render
  exactly as today.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `openspec-panel`: the change row's decision facts gain a review state (whole-spec current/stale/
  findings/missing and reviewed-vs-checked task coverage) and a live-review indicator, both derived
  from the workflows engine's records and liveness.
- `workflow-observability`: the read-only surface gains a session-row review indicator and a
  review-liveness read API/service; both are inert without the workflows plugin and neither steers,
  blocks, or writes review state.

## Impact

- `packages/plugin-workflows/src/host/**` — a `workflowsReviewStatus` service (summaries from the
  whole-spec record and the portable approvals; live entries from the review executor), the
  `GET /api/workflows/reviews/live` route, and the batch session filter.
- `packages/plugin-workflows/src/client/**` — the `sidebar.session.row.leading` occupant, its
  shared polling store, locale copy, and reduced-motion style.
- `packages/plugin-openspec/src/host/**` — the optional `review` field in the change-list response,
  merged from the workflows service with the list; a service failure omits the field and never
  fails the list.
- `packages/plugin-openspec/src/client/**` — the review line, the live poll, and the new decoder
  fields.
- Tests: workflows review-status and route tests, OpenSpec panel decoder and merge tests.
- Docs: `docs/workflows.md` (waiting close / review liveness surface), `docs/plugins.md` (panel
  card), the plugin metadata locale.
- Dependency: `fix-review-run-liveness` for the `waiting`/`orphaned` distinction. The static card
  state has no such dependency.
- No new package dependency, no persisted state, no change to the records or approval formats, and
  no change to the shell's own session activity spinner.
