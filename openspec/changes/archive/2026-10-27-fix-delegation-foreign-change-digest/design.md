# Design

## Context

`attachGate` captures a turn-start baseline on `agent/pre-step` and `evaluateGate` captures the turn-end snapshot on `agent/turn-stopping`. The turn-end path already filters active changes by owner, but the baseline path still passes every active change to `captureSnapshot`. Inside `captureSnapshot`, a failed `readTasks` or `specDigest` writes to `snapshot.digestError`, the same field the real worktree digest failure uses. `evaluateGate` renders `current.digestError` as `the worktree digest could not be computed`, so an unreadable `tasks.md` is misreported as a git/worktree problem.

A change can be claimed by the first thread that observes it, including a thread that only closes a turn while another change is being written. That path makes the per-change error reachable even when the change was meant to be foreign.

## Goals / Non-Goals

**Goals:**

- One ownership filter shared by the baseline and turn-end paths.
- A per-change artifact problem stays a per-change issue with the change name and owner.
- The worktree digest failure remains reserved for real git failures.
- Existing records, owner files, and tool shapes stay compatible.

**Non-Goals:**

- Changing the ownership/review workflow, the record shape, or the rule configuration.
- Releasing or publishing a new setup version.
- Touching another thread's active change or owner file.

## Decisions

1. **Shared `ownedActiveChanges` helper.** Both listeners call it before `captureSnapshot`; the baseline therefore claims or reuses owners exactly like the turn-end path. Alternative: filter only in `evaluateGate` and accept foreign reads in the baseline. Rejected because the baseline is part of the same thread's gate state and the requirement is "every path".
2. **`Snapshot.changes[].error` replaces artifact writes to `digestError`.** `readTasks` and `specDigest` failures are recorded on the change entry, not on the snapshot. The worktree `digestError` remains only for `worktreeDigest` failures.
3. **A soft per-change hint.** `evaluateGate` emits a soft issue (once per turn per change) naming the change, owner, and unreadable file, then skips that change's review rules. Alternative: a strict block. Rejected because a missing `tasks.md` is a transient planning state and may be claimed by a thread that is not writing it; a soft hint informs without trapping the turn.
4. **No status changes needed.** `delegationStatus` already catches `readTasks` failures, prints `tasks: unreadable`, and keeps the owner line. The change adds regression coverage, not code.

## Risks / Trade-offs

- The baseline now claims an unowned change at pre-step instead of at turn end. This matches the recorded "first observation owns" rule and makes both paths consistent, but it moves the claim earlier.
- A soft hint still produces one gate steer for that turn; a repeat evaluation in the same turn does not re-steer.
- The fix is only effective in the running Harness after the Host plugin is rebuilt and the app restarts, or after a separate release; the current process keeps its loaded module.
