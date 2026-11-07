# Design

## Context

See `proposal.md` - Why. The current review start path is:

```
delegate(rule, change, task?)
  -> createRun()                         durable run file, identity, conversation key
  -> runIdentities: duplicate?           return the pending handle
  -> runKeyHeads: same key active?       queue behind the key head
  -> beginReviewRun()
       -> prepareReview()                snapshot, digest, reviewed-input signature
       -> inspectRecord()                reuse a matching PASS/FINDINGS record
       -> startTarget()                  child starts immediately
       -> completeReviewRun() in background
            -> finishTarget(), parseVerdict(), mutation guard, publishRecord()
```

The per-key `runKeyHeads`/`runQueues` serialization and the `runIdentities` duplicate check already exist. What does not exist is a **global** capacity decision: every key head starts a child immediately, so two independent keys can both hit the active-child limit, and a start failure is returned to the model.

The queue therefore belongs between `prepareReview()`/cached-record reuse and `startTarget()`. Preparation and reuse are cheap and must happen before a queue slot is held; the slot is only for a live target.

## Goals / Non-Goals

**Goals:**

- Admit every live review target through one bounded per-profile queue with FIFO order and a documented concurrency limit.
- Turn a transient start failure into a queued retry instead of a model-visible error, without duplicating records.
- Make queue state and failure classes visible in `delegation_status` and the existing run records.
- Preserve the review contract, snapshot, digest, mutation guard, gate, provider binding, and settlement observer exactly as they are.
- Keep an off switch that restores direct start.

**Non-Goals:**

- Durable queue across Host restarts. The queue is in-memory; restart recovery reconciles a published record and marks only runs without a record as interrupted.
- A second reviewer, a prompt change, or a learning loop.
- Raising the DSH active-child limit. The queue is designed to work below it.
- Changing the review gate's pass/fail semantics or the archive gate.

## Decisions

### 1. Queue only live target starts, after preparation and cached-record reuse

`beginReviewRun()` keeps its current order: read the task, prepare the snapshot/digest, inspect an existing record, reuse it when possible. Only when no record is reused does it submit a **start job** to the queue. The job owns `startTarget()` and the background `completeReviewRun()`.

The review identity is computed only after preparation: the provisional run context is built from the validated arguments, the inputs are prepared, a reusable record is returned immediately, and only then is the identity map consulted. A changed digest is therefore a new identity, never a join of the old handle.

Every preparation, including a frozen task snapshot, also records a `queueSignature` over the source input set; before a queued run starts, the queue recomputes it and re-prepares once when it changed. Re-preparation is an atomic identity replacement: the queue removes the run's old identity and inserts its new identity in one step before any admission decision. If the new identity is free, the run keeps its queue position and starts under the new digest. If another admitted run already holds the new identity, the re-preparing run has become a duplicate: it settles `discarded` without starting a target, names the incumbent run id in its terminal detail, and fires its settlement observer exactly once; the incumbent remains authoritative and proceeds unchanged. When the discarded run was a key head, the queue promotes the next follower before continuing, so the key is not stranded. Both previously returned handles settle exactly once, and only one target runs for the identity.

This means:

- A cached PASS/FINDINGS never consumes a queue slot.
- A queued run holds a prepared snapshot. Before it starts, the queue re-checks the prepared `queueSignature` once; if the source inputs changed while waiting, it re-prepares, cleans up the old snapshot, and records the new digest. This avoids starting a reviewer on content that changed while queued.
- Early preparation inspects the authoritative record to reuse it, but that inspection is not the publication baseline. A queued run re-inspects the authoritative record when it becomes start-eligible and records that snapshot as its publication baseline immediately before its first `startTarget()`. Every writer of one record path shares a conversation key, so start eligibility follows predecessor settlement: a record the predecessor published while this run waited does not discard this run's legitimate completion. The protection against a competing publication after the baseline remains, so a superseded predecessor still cannot overwrite its successor.
- An input mutation **during** the run stays a terminal `ERROR` (`reviewed-inputs-changed`), not a retry. The reviewer read moving content; the gate's next action is to finish writes and re-run. Retrying it would hide the condition the existing spec requires to surface.

### 2. Admission is a state machine with a bounded waiting list

```
new -> queued -> starting -> running -> settled
                  |  ^
                  v  |
              retry-wait
```

- `new`: validated, prepared, not yet admitted.
- `queued`: waiting for a global slot; has a position; does not consume a child slot.
- `starting`: the target start is in flight.
- `running`: the child is live; `completeReviewRun` is in the background.
- `retry-wait`: a transient failure was classified; the run waits for its backoff and re-enters `starting`.
- `settled`: a terminal record, a classified `ERROR`, or a `discarded` outcome was recorded; the settlement observer fires once.

Queue rules:

- One queue per plugin instance (per profile).
- `concurrency` default 2, valid range 1-4. It must stay below the DSH active-child limit (8) so workers and other children retain room.
- `maxQueued` default 16; admitting beyond it returns `queue-full` immediately.
- All unique waiting runs, including per-key followers, count against `maxQueued`, and their wait timeout starts when the request is accepted. The per-key head is only a start-eligibility constraint; a follower behind a busy key still expires or rejects when the waiting budget is exhausted.
- FIFO across independent keys; the existing per-key order is preserved because a key head that is not admitted does not let its followers jump ahead.
- A key head already running blocks its key queue; those followers remain `queued` without consuming a global slot.

### 3. Identity and dedupe reuse the existing run identity

The queue computes the identity after preparation, not from the pre-preparation `reviewIdentity` (rule/change/task). The identity covers rule, change, task id or phase, digest, provider, and model. The existing `runIdentities` map is populated only after preparation and covers every admitted state: `queued`, `starting`, `running`, and `retry-wait`. A new request whose identity is present joins that run's handle and starts no target. A different digest or a different rule is a distinct run. Re-preparation replaces the map entry atomically; when the new identity is occupied, the re-preparing run is the duplicate and settles `discarded` while the incumbent proceeds (§1). The conversation-key serialization is unchanged.

### 4. Failure classes and retry budget are explicit

| Class | Typical evidence | Action |
| --- | --- | --- |
| `child-limit` | `subagent limit reached (active child limit: N)` | transient; retry with backoff |
| `provider-not-started` | provider start rejected before a child existed | transient; retry with backoff |
| `timeout` | no terminal result inside the review timeout, child cancelled | transient only when cancellation is confirmed and no record was published; otherwise terminal |
| `reviewed-inputs-changed` | the existing mutation guard | permanent; settle `ERROR`, no retry |
| `invalid-output` | unparsable verdict/schema | permanent; settle `ERROR` |
| `config` | missing provider, bad marker, invalid target | permanent; settle `ERROR` |
| `permission` | authorization/approval denial | permanent; settle `ERROR` |
| `unknown` | unrecognized failure | permanent; settle `ERROR` with the bounded message |

Retry policy:

- `maxAttempts` default 3, meaning the original attempt plus two retries.
- Exponential backoff with full jitter: `delay = min(maxDelayMs, baseDelayMs * 2^(attempt-1))`, then multiply by a random factor in `[0.5, 1]`. Defaults: `baseDelayMs 5000`, `maxDelayMs 60000`.
- A provider-supplied retry-after value is honored when it is larger, capped by `maxDelayMs`.
- A retry must not publish a record. Only the settled attempt calls `publishRecord()`, and only while the run still owns the current identity for its change/task. A superseded or late predecessor is discarded and MUST NOT overwrite the successor's record.
- If a record is published while a retry is waiting, the retry is discarded (the existing authoritative-record rule); the publication baseline is refreshed only before a run's first start, never before a retry.
- A timeout retry requires a confirmed cancelled/drained child. If cancellation cannot be confirmed within a bounded grace period, the run settles `ERROR` `timeout` and no retry starts, because a second child could duplicate the review. It also retains its conversation key, active-capacity slot, and snapshot in a quarantine set until teardown is confirmed; followers and fresh same-key starts wait during that interval. Retry suppression alone is not enough to release the key.

### 5. Admission returns before completion, with a bounded failure

`delegate` returns the run handle after `beginReviewRun()` either starts the target or enqueues it. The handle carries `queued` plus the position, or `running`. The background completion is not awaited by the tool.

- Queue full: immediate `ERROR` `queue-full` before admission, with `queue depth`, `maxQueued`, and the next action. The tool has not returned a handle yet.
- Wait timeout: asynchronous. The tool has already returned the queued handle; the run settles as `ERROR` `queue-timeout` with the position, wait time, and next action; the status reports it and the settlement observer fires. A tool call that already returned cannot return a second error.
- Both are ordinary `ERROR` records: the review gate treats them as unapproved, never as a pass.

### 6. The queue is in-memory and restart-safe by marking, not by replaying

On plugin load, the engine reads durable run files and their authoritative records. Recovery preserves the published verdict and reconciles the run to the matching terminal state: PASS and FINDINGS are `completed`, ERROR is `failed`, and a run with no matching record is marked `interrupted` with a bounded reason and is never auto-completed. Recovery grants no approval by itself: the gate evaluates the record through the existing verdict, digest, and reviewer checks, so a current PASS remains an approval while a stale PASS, FINDINGS, or ERROR does not approve archive or push. A record written before a crash is not invalidated by the run-file state or by recovery.

The queue itself is not persisted. A queued run that is lost on restart is recoverable by the gate's steer, not by a replay.

### 7. Configure once, fail loud, and keep a direct-start escape

```yaml
reviewQueue:
  enabled: true
  concurrency: 2
  maxQueued: 16
  maxAttempts: 3
  baseDelayMs: 5000
  maxDelayMs: 60000
  waitTimeoutMs: 300000
```

- Invalid values fail plugin load with the field and accepted range.
- `enabled: false` bypasses admission, queue wait, and queue-owned retries; target start is direct, as before. The per-key serialization, review contract, records, and gates are unchanged.
- The queue is intentionally not a gate. A queue failure cannot turn an unapproved review into a PASS.

### 8. Visibility rides on existing records and status

The durable run file gains bounded fields: `queuePosition`, `queuedAt`, `waitMs`, `attempts`, `failureClass`, `lastRetryAt`. `delegation_status` reports `active`, `queued`, and `queueDepth`, plus each run's position/attempts/class. The Workflows projection in change `add-workflow-observability` reads the same file; no second log is added.

Error text is bounded and redacted. A provider message is summarized to one line and never includes credentials or machine paths.

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| A long review blocks both slots. | Concurrency 2 plus the existing review timeout; a stuck run settles or is cancelled; the queue reports the head. |
| A retry duplicates a record. | Only the settled attempt publishes; a retry is discarded when the authoritative record exists; tests assert one record. |
| A timeout retry reviews a different worktree. | Retry only after confirmed cancellation; the pre-start re-check re-prepares when inputs changed. |
| The queue hides a capacity problem. | The status and Workflows view show queue depth, wait time, and failure class; a persistent backlog is visible, not silent. |
| Restart loses queued work. | The run is marked `interrupted`, never PASS; the gate asks for a fresh review; no replay. |
| The queue conflicts with the existing per-key ordering. | The key head is the only member admitted; followers wait in the key queue and cannot jump ahead. |
| `enabled: false` reintroduces the old failure mode. | The off switch is documented as a rollback, not the default; the gate still surfaces the failure. |
| The child limit is shared with workers. | Default concurrency 2 is well below 8; child-limit is a classified transient and retries rather than surfacing. |
| The queue adds latency to a fast review. | A free slot starts immediately; only capacity pressure queues. A cached record bypasses the queue entirely. |

## Migration Plan

1. Add the `reviewQueue` config with defaults enabled; the queue is a transparent latency layer for a free slot and a visible wait under pressure.
2. Add the failure classification and retry; keep the existing start path as the direct fallback used by `enabled: false` and by a queue-internal error.
3. Add the status fields and the restart marking.
4. Rollback: set `reviewQueue.enabled: false`; no records or queue data need migration.

**BREAKING (behavior):** a review may now be reported as `queued` instead of `running`; callers must use the run id/status rather than assuming the target started. The existing per-key queue already produced a `queued` handle, so the handle shape is unchanged.

## Open Questions

None. The durable-queue question is deliberately settled as "mark interrupted, ask for a fresh review"; changing it would change the specs and is out of scope.
