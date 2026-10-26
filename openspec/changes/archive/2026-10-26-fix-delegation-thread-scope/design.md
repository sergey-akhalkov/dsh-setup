## Context

The OpenSpec change is workspace-global, but the delegation trigger state is per DSH thread
(`agent.session`). The gate's `evaluateGate` runs on every turn of every thread and compares the
workspace's changes against the shared `.dsh/delegation` records. When a change's spec or task review
is missing or stale, every thread's gate steers its own agent to run the review. The owner observed
this in a second thread for both the spec review and the task review.

## Goals / Non-Goals

Goals: one owning thread per change for the change-scoped triggers; no foreign review steering or
runs; the owner visible in the status and records; existing tools available elsewhere.

Non-goals: moving changes between threads, a UI for ownership, or changing the review contracts
themselves.

## Decisions

### D1: Owner is the first thread to observe the change

The engine records `change name -> thread/session id` in the workspace's delegation state
(`.dsh/delegation/owners.json`, written atomically) the first time a thread observes an active
change through the gate, the status tool, `delegate`, or `task_progress`. That thread is the owner;
later threads reuse the stored owner. The state is local scratch (`.dsh/` is not committed) and
survives engine restarts. Reset is a manual removal of the owner entry, documented as the escape
hatch if the creating thread is gone.

### D2: Change-scoped triggers evaluate only in the owning thread

The gate evaluates `spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`,
and the optional integration review only when the current thread is the change's owner. A foreign
thread's gate does not steer those triggers and treats the change as not its own; its turn closes
without a foreign review obligation. The `failure-streak` trigger and the manual `delegate` rules
remain thread-local behavior.

### D3: Foreign review runs are refused and recorded with the owner

A review-contract `delegate` call for a change carries the owning thread check before any target
starts. In a foreign thread it fails with the owner and the next action ("run it in the owning
thread"). Review records gain the owning thread (`session`), so the record itself documents where the
review ran; the matching-PASS reuse and staleness rules are unchanged. `delegation_status` reports
each change's owner and whether it is the current thread, alongside the existing record states.

### D4: Tests and acceptance

Unit tests use two synthetic agents (different session ids) and the same workspace: the owner's gate
steers; the foreign gate does not; a foreign review `delegate` refuses before the target; the owner
persists across a re-created engine; the record carries the owner; the status reports it. The live
acceptance uses two threads on this workspace: the change's reviews stay in the creating thread and
the second thread neither sees a steer nor runs a review; the owner survives an app restart.

## Risks / Trade-offs

- **First-observation race** -> if another thread sees a change before the creating thread's next
  turn, it could claim ownership. The creating thread's post-create gate is the normal first
  observer; the status shows the owner, and the state file is the documented reset. This is the
  least surprising rule without threading a session id through OpenSpec creation.
- **Owner thread unavailable** -> the review cannot run elsewhere. The escape hatch is removing the
  owner entry; the docs name it. This preserves the requested "only in the creating thread"
  behavior over automatic failover.
- **Foreign thread edits** -> its implementation-work trigger is not steered, so its checks are
  explicit rather than gated. The user asked for thread-scoped delegation, not for cross-thread
  enforcement.
