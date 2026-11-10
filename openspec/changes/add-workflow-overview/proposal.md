# Proposal

## Why

The session Workflows tab answers "what ran" but not "what automation exists and how well it
works". The owner cannot see which triggers are installed, which workflow listens to each trigger,
how often a trigger fires, how many of a workflow's runs succeed, or one workflow's description,
architecture and history. The old `Journal` segment is the opposite problem: a raw list of internal
evaluation reasons (`event-mismatch`, `filter-mismatch`) that an ordinary user cannot read, and it
is used by nobody. The owner asked for a workflow-centric overview in the first segment and the
plain all-runs feed in the second.

## What Changes

- **BREAKING**: the session view's two segments become `Workflows` and `Runs`; the `Journal` segment
  is removed. Its useful content (a workflow's own trigger evaluations, in plain words) moves into
  the workflow page's evaluation history.
- New `Workflows` segment: the installed definitions grouped by trigger kind, each group showing the
  trigger's mode, its `matched/total` firing counts for the session, and the workflows bound to it
  with their `completed / all runs` ratio plus separate `failed` and `running` counts.
- New workflow page opened from a workflow row: description, version, risk, gate ownership, the
  ordered step chain (architecture), the trigger binding, all runs of that workflow, and its
  evaluation history; Back returns to the overview and restores its position.
- The `Runs` segment keeps the current all-runs feed, including the existing run page.
- Host read API: each trigger entry gains `counts { matched, total }`; the runs route accepts
  `stats=1` and returns per-definition status counts so the overview does not have to page every
  run.
- No writes, no new persistence, no new routes; the overview is read-only.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `workflows`: the session view's user interface requirement now fixes the two segments, the
  trigger-grouped workflow overview, the workflow page, and the "no authoring in the session view"
  rule.
- `workflow-observability`: the read-only surface requirement now fixes the overview-first layout;
  the session history requirement now fixes the workflow page (its runs and evaluation history) in
  place of the session-wide journal; the trigger evaluation rendering and the listener-health
  wording follow.

## Impact

- Client: `packages/plugin-workflows/src/client/view.tsx`, `run-history.tsx`, a new overview/workflow
  page module, `locale.ts`, `styles.ts`, and the client tests.
- Host: `packages/plugin-workflows/src/host/api.ts` (two read-only extensions) and its tests.
- Docs: `docs/workflows.md`, `docs/plugins.md`.
- No schema, dependency, installer, or release-workflow change; the change ships in the next release
  (0.31.0).
