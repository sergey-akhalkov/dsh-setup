# Proposal

## Why

The work checkpoint fires at every substantial pause and every step interval, but it records a
decision the plugin cannot check: `parallel`, `serialReason`, `remaining`, and `bottleneck` are
prose. In an observed 35-hour delivery, 12 of 16 checkpoints declared the same serial reason,
`remaining` still listed closed tasks, and a named bottleneck survived for hours while the agent
waited in ten-minute blocks. The always-on contract already asks for independent lanes and the
bottleneck's remedy; nothing verifies either, so decomposition happens once at the start and
parallel capacity sits idle. The only automatic reflection child (the goal-round speed review) ran
once, produced no verdict, and is gone; nothing replaced its check.

## What Changes

- Replace the checkpoint's free-text decision with a lane plan: `lanes[]` (id, owner, scope, state,
  blockedBy) and a `bottleneck` object (id, owner, action, blockingLanes, targets). Remove
  `parallel`, `serialReason`, `remaining`, and `speedup`; the remaining work is derived from lanes.
- **BREAKING (tool schema)**: `work_checkpoint` rejects the removed fields and requires `lanes` and
  the bottleneck object for a `continue` outcome. Local v1 records stay readable.
- Compute parallelizability in the engine: runnable lanes with different owners and non-overlapping
  scopes require a tagged worker start before the turn closes; a shared scope is the serial escape,
  so a singleton resource such as the live stand is expressed as data, not as a sentence.
- Require the bottleneck's remedy to be executed before the close: a worker start the plugin's
  existing classifier counts and tagged with the checkpoint id, an `edit`/`write` whose destination
  is a declared target, or a question to the user. A missing remedy refuses the close and names the
  missing evidence.
- Refuse the close when the same bottleneck id and owner survive `bottleneckAge` consecutive
  checkpoints without a route change: a new owner, a split lane, or a user decision.
- Name lanes whose state did not change for `laneStaleCheckpoints` checkpoints in the next request,
  so a stalled lane must be explained or become the bottleneck.
- Keep the existing trigger, shared refusal budget, fail-open behavior, and subagent exemption.
- Rewrite the always-on checkpoint and plan clauses to state the lane plan and an executed remedy
  within the existing 1500 estimated-token budget.
- Extract plan metadata (lanes, blocked lanes, computed parallel work, the remedy result, the
  bottleneck action and age) and expose parallel share, blocked-lane rate, remedy resolution, and
  dispatch per checkpoint, plus the `parallel-share` and `remedy-resolution` hypothesis metrics on
  the existing observability surface; no new log or storage surface.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `work-checkpoints`: the checkpoint tool and record carry a lane plan and a bottleneck remedy; the
  parallel obligation is computed from the plan rather than declared; the close gate also refuses a
  stale plan, an unexecuted remedy, and an aged bottleneck.
- `session-guidance`: the always-on plan and checkpoint clauses state the maintained lane plan and
  the executed remedy.
- `observability`: the checkpoint extraction, the plan metrics, and the hypothesis metric catalog
  expose the plan decision.

## Impact

- `packages/plugin-goal-continuity`: checkpoint tool schema, record, computation, gates,
  configuration, and tests.
- `packages/plugin-working-principles`: the always-on contract asset and its budget test.
- `packages/setup`: the regenerated vendored tree via `pnpm gen`; no new row or bundle.
- `docs/goal-continuity.md`, `docs/plugins.md`, `docs/principles.md`.
- `packages/plugin-observability`: checkpoint extraction, plan metrics, and the hypothesis
  metric catalog.
- No new package, bundle row, installer array, market entry, or DSH version change.
