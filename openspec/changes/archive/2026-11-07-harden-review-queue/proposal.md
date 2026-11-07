# Proposal

## Why

Review is the dominant delegation path and the most fragile one. The 2026-11-05 analysis recorded 109 failed review runs, 53 `subagent limit reached (active child limit: 8)` errors, and about 2.7 task-review attempts per PASS; the latest mix is roughly 88 task-review calls out of 109 delegate calls. Today a review start either gets a child slot or fails into the model's turn. There is no queue, so a transient capacity error becomes a visible failure and the same review is retried by hand, often duplicating work.

## What Changes

- Add a per-profile review queue inside `@dsh-setup/plugin-delegation-rules` with bounded concurrency (default 2), a bounded waiting list, FIFO admission, and dedupe by review identity.
- Classify review failures into transient and permanent classes; retry transient classes with bounded exponential backoff and jitter; re-check a queued run's inputs before it starts and re-prepare once if they changed; an in-run input mutation stays a visible `ERROR`; never retry a permanent class.
- Keep the existing review contract, snapshot, digest, record, and gate semantics. The queue sits between validation and target start. Restart recovery preserves a published verdict and its terminal state but never turns a FINDINGS or ERROR record into an approval.
- Return a run id after queue admission so the turn can continue; a full queue or an admission timeout returns a bounded `ERROR` with the queue state and next action.
- Report queue position, wait time, attempts, and failure class in `delegation_status` and the existing observability surface.
- Add `reviewQueue` configuration and an off switch that restores the direct-start behavior.

**BREAKING (behavior):** a review may now be reported as `queued` instead of `running`; callers must use the run id and status rather than assuming the target started.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `delegation-rules`: review delegations are admitted through a bounded queue, transient failures are retried with backoff, stale inputs are re-snapshotted once, and queue state is visible.

## Impact

- `packages/plugin-delegation-rules/src/host/index.ts` (delegate start path and `beginReviewRun`), a new `src/host/review-queue.ts`, config schema and defaults, tests, and `docs/delegation-rules.md`.
- The generated setup tree and vendored plugin files through `pnpm gen`.
- No new package, bundle row, DSH version, review prompt, or archive-gate semantic.
- Out of scope: the review learning loop (separate change), changing the reviewer model or its prompt, increasing the DSH child limit, and changing the gate's refuse-versus-pass decision.
