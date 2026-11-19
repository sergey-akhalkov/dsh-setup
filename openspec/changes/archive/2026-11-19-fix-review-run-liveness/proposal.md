# Proposal

## Why

Issue #7: review runs that look stuck stay `blocked` with their `review` step open and no
record, a stale run refuses a fresh start for the same section, and a run owned by another
session cannot be cancelled. The local run store and journal show the reviewers were often live
and were cancelled just before their verdicts; what is missing is executor liveness in the
engine's decisions and in `workflows status`. The liveness fixes landed for the close and the
trigger (`review-until-pass`), but the tool paths, duplicate admission, and post-restart
cleanup still treat the persisted run status as the executor.

## What Changes

- A review step's liveness is the host review executor's live entry (or the bounded admission
  window), never the persisted `running`/`blocked` status alone. `start` reuses or refuses only
  against live runs; a partial-overlap refusal names the live covering run.
- A run waiting behind a live covering review stays open as coverage, while a duplicate the
  scheduler rejects is settled `cancelled` with the covering run id instead of staying open with
  no executor.
- `workflows status` names the review step's liveness: `live` (with attempts), `waiting on
  <runId>`, or `orphaned` (with the restart reason when present).
- `workflows cancel` accepts another session's run when the owning agent is not executing a
  turn (absent or idle), not only when the agent is absent.
- After a Host restart, the interrupted review run is superseded (`cancelled` with a bounded
  reason) by the next fresh round for the same unit, task or whole scope; recovery writes no
  review record and the fresh round is a normal close dispatch.

No durable review queue, no synthetic `ERROR` record, no new run status.

## Capabilities

### New Capabilities

None. The behavior belongs to the existing `workflows` capability.

### Modified Capabilities

- `workflows`: review-run liveness and coverage (new requirement), `Model interface` (`status`
  liveness and the `cancel` owner rule, plus `start` reuse/refusal against live runs), and
  `Restart reconciliation` (interrupted review runs are superseded by the next fresh round; no
  record is synthesized).

## Impact

- `packages/plugin-workflows/src/host/index.ts` — liveness predicate and admission window,
  start/trigger/gate coverage, duplicate settlement, canceled-owner rule, restart supersede.
- `packages/plugin-workflows/src/host/tools.ts` — `status` liveness token, `cancel` session
  rule, `start` reuse/refusal.
- `packages/plugin-workflows/src/host/review-scheduler.ts` — expose the same-unit and cross-shape
  coverage lookups for a run to the tool host (no admission semantics change).
- `packages/plugin-workflows/test/host-wiring.test.ts` and the queue/recovery tests — regressions
  for the six behaviors below.
- `docs/workflows.md` and `openspec/specs/workflows/spec.md` (delta) — the same change.
- Generated `packages/plugin-workflows/lib/**` and the vendored setup copy — rebuilt with
  `pnpm build`/`pnpm gen`, committed with the source.
- No dependency, config, record-schema, approval-schema, or client UI change. The shipped live
  profile keeps its current behavior until a release is installed.
