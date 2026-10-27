# Design

## Context

See `proposal.md` - Why. The current engine keeps one owner per active change: `ensureOwner` writes `.dsh/delegation/owners/<hash>.json` on the first observation from a pre-step, the gate, `delegation_status`, or a tool call. The pre-step claims every active change, and `evaluateGate` then scans every checked task of every owned change. Because `.dsh/` is local scratch while `openspec/changes/` is project state, a fresh checkout, a change created before the owner feature, or a change created by another live session is adopted by the first session that observes it.

The live incident is the acceptance case: another session created `add-loop-guard` during a turn; this session's pre-step claimed it; the gate demanded its spec and task reviews; its still-missing `tasks.md` was reported as a worktree-digest failure by the old Host module loaded in the running app. The completed but unarchived `fix-delegation-foreign-change-digest` change already separates per-change artifact errors from the worktree digest; this design keeps that separation.

Constraints:

- `agent.session.id` is the session identity.
- The plugin already captures a pre-step `Snapshot` (worktree digest, implementation fingerprint, per-change tasks, `specDigest`).
- `specDigest` normalizes `tasks.md` checkbox state, so a task tick alone does not change the change-artifact digest.
- State is local scratch under `.dsh/`; review records are workspace-global.
- No rule configuration, tool parameter, or record shape changes; no Client half.
- The gate already skips sessions whose header origin is `subagent`; this design does not change that.

## Goals / Non-Goals

**Goals:**

- A session is involved in a change only when it produced write evidence for that change or made an explicit change-scoped call, not when it observed it.
- Snapshot differences identify content, not the writer; they never attribute a change on their own.
- A session reviews only the tasks it checked, not the change's historical checked tasks.
- Two sessions can work on one change without an exclusive owner and without a dead-owner trap.
- A foreign change's artifacts cannot block a session's gate or change its worktree digest.
- The behavior survives engine restarts and does not rely on git-tracked state.

**Non-Goals:**

- Moving a change between sessions, a UI for involvement, or a review handoff workflow.
- Migrating legacy owner state or preserving first-observation ownership.
- Changing review targets, contracts, record matching, async runs, or the digest definitions.
- Inheriting involvement in a forked session; a fork is a new session and starts uninvolved.
- Enforcing reviews for work done outside a DSH session or in an aborted first turn.

## Decisions

### D1: Per-session involvement files, not a per-change owner

Store one file per session at `.dsh/delegation/sessions/<sha256(session).slice(0,16)>.json`:

```json
{
  "session": "session-...",
  "changes": {
    "change-a": {
      "created": true,
      "specChanged": true,
      "tasks": ["<task-id>"],
      "completed": true
    }
  }
}
```

The filename is hashed to avoid path characters and Windows device-name collisions; the content keeps the raw session id. Writes use the existing atomic JSON writer. Missing or malformed files read as empty and are reported in `delegation_status`; they never block a turn. This is the inverse index of the old owner map: a session only needs to read its own file, and two sessions never write the same file.

Alternative rejected: keep one owner per change and only stop claiming on observation. Continuing a change would still gate all old checked tasks, and a dead owner would still block review runs.

Alternative rejected: store involvement in the DSH session log. File state matches the existing records/notes/run files and avoids a new service dependency in a bundle that deliberately keeps its runtime surface small.

### D2: Attribute only session-attributable write evidence

Snapshot differences identify *what* changed, not *who* wrote it. The engine SHALL record write evidence for the current turn from `tools/result`: a successful tool call is evidence when its name and arguments identify a write inside `openspec/changes/<change>/` or a command that creates that change. Supported evidence:

- `edit`/`write` with a resolved `file_path` under the change directory;
- a successful shell call whose command creates the change (`openspec new change <name>`) or writes a file under the change directory;
- a nested `run_code` dispatch only when it surfaces its own `tools/result` with the calling agent.

A read, `grep`, `glob`, `delegation_status`, `openspec list/show/status/validate`, or any unrecognized tool is not write evidence. A write through an unsupported tool does not attribute; the session can call `task_progress` or a review/patch `delegate` to opt in.

At `agent/turn-stopping`, compare the pre-step baseline with the current snapshot only for changes that have write evidence. If the baseline is missing, attribute nothing. For an evidenced change:

- new change + creation evidence -> `created = true`, `specChanged = true`, and no task ids from the turn-end snapshot; task ids come only from task-level write evidence or explicit calls;
- existing change + a write outside `tasks.md` -> `specChanged = true`;
- existing change + a `tasks.md` write -> derive both the transitions and the substantive-plan flag from that write's own canonical before/after contents: set `specChanged` when the checkbox-normalized before/after differ (a substantive task-plan edit or a newly supplied `tasks.md`); a checkbox-only edit does not. Add only the task ids whose checkbox state changed in that write; when the addition makes the whole list checked -> `completed = true`.

The first-party `edit`/`write` result carries canonical `before`/`after` contents (`@deepseek-ai/dsh-tool-fs`); use those per-write contents, not an independent read before or after, which is not atomic with a concurrent writer. The whole-change `specDigest` is used only for review freshness and gate matching, never to decide whether a `tasks.md` write was substantive. A write whose result exposes no before/after contents attributes the change but not individual task ids; use `task_progress`/`delegate` for task-level attribution in that case.

`captureSnapshot` MUST compute `specDigest` independently of task parsing, so a partial change whose `tasks.md` was missing still has an artifact digest and a write that makes it readable is detectable. The per-change `Snapshot.changes[].error` remains separate from the worktree digest.

Explicit change-scoped calls attribute immediately after validation: `task_progress` and a review or patch `delegate`. An `answer` delegate does not attribute even when it carries a change argument; `delegation_status` never mutates state.

Alternative rejected: attribute from the workspace diff alone. It cannot identify the writer, so a session that only observes a change created by another session would adopt it; this is the P0 failure this design fixes.

Alternative rejected: attribute from file mtimes or change-directory birth time. Those are not portable, are rewritten by checkouts, and do not identify the writer.

Alternative rejected: require every write to go through a new claim tool. It adds friction and does not cover the first-party editors the agent already uses.

### D3: Per-task review scope

For `spec-task-ready`, evaluate only the intersection of the change's currently checked tasks and `entry.tasks` (the ids this session checked). A checked task from another session is not in this session's scope. A task review record remains workspace-global: a `PASS`/`ERROR` written by any session satisfies the task, because the record describes the task, not the session.

The gate's suggested task-review call MUST name the specific task id (`delegate(rule, change, task)`) rather than a bare change call. The engine's next-task selection is workspace-wide and could pick an earlier checked task that belongs to another session; the explicit task id keeps the suggested call inside the session's scope.

`spec-ready` applies only when `created` or `specChanged` is true. A session that only checks tasks does not owe the whole-spec review; a checkbox-only tick does not change the normalized `specDigest`, while a substantive `tasks.md` edit does. `implementation-work` applies only to an involved change. `implementation-complete` applies only when `completed` is true and the current list is fully checked.

Alternative rejected: gate every checked task of any involved change. Resuming a change started by another session would recreate the reported "review all old ticks" problem.

### D4: Remove the exclusive owner and foreign review refusal

Delete `ownersDirectory`, `ownerFile`, `readOwner`, `claimOwner`, `ensureOwner`, and `ownedActiveChanges`. A review `delegate` no longer fails for a foreign change; it starts the run and records the reviewing session, and the explicit call attributes the change to the caller. Records remain keyed by rule/change/task and are shared.

`task_progress` MUST resolve the requested task across active changes with per-change error handling: an unreadable foreign `tasks.md` is skipped, not fatal, and the selected readable task is validated before the note is written.

Alternative rejected: keep refusal for sessions that are not involved. It adds a check without a security boundary (the review is read-only and records are not access-controlled), and it recreates the dead-owner failure whenever the review must run elsewhere.

Legacy `.dsh/delegation/owners/` files are ignored. No migration: the owner is often the session that observed the change rather than the one that created it, so importing it would preserve the bug. The directory may be deleted; old files have no effect.

### D5: Snapshot all active changes; evaluate only involved ones

`attachGate` passes all active changes to `captureSnapshot` so the turn diff can detect a newly created or newly edited change. `evaluateGate` loops only over changes present in the session's involvement file; a foreign change's missing `tasks.md` is not an error in this session's gate and cannot set `digestError`. Per-change `Snapshot.changes[].error` stays separate from the worktree `digestError`, preserving the `fix-delegation-foreign-change-digest` behavior. This deliberately reverses that change's decision to make the pre-step baseline claim owners, while keeping its error separation.

`delegation_status` reads the involvement file and reports, per active change, `this session: created / spec changed / N checked task(s)` or `not involved`, alongside the existing record and note state. It does not create or claim any state.

### D6: Tests and acceptance

Unit coverage uses synthetic agents with different session ids in one workspace:

- a fresh session on a change with checked tasks and no involvement is not steered and creates no state;
- an overlapping turn where only session B writes a change leaves session A uninvolved, even though A's snapshot changed;
- write evidence from `edit`/`write`, a shell creation command, and a `tasks.md` write attributes the change; an unrecognized tool, a read, and `delegation_status` do not;
- a creation command sets `created` and `specChanged` only; a task checked by another session after creation is not imported into the creator's scope;
- two sessions checking different tasks in overlapping turns each attribute only their own task and each gate requires only its own task, including an interleaving where B writes between A's mutation and A's result observation;
- a substantive `tasks.md` edit sets `specChanged`; a checkbox-only edit does not, even when another session edits `proposal.md` during the same turn;
- adding `tasks.md` to an existing partial change is attributable from the write's before/after contents, without relying on the whole-change digest;
- an involvement file and a pending task review survive engine recreation with the same session id;
- a foreign change with a missing `tasks.md` neither blocks the gate nor sets the worktree digest error, and `task_progress` for a readable task still succeeds;
- the gate's suggested task-review call names the current session's task id and does not select an earlier foreign task;
- an `answer` delegate with a change argument does not attribute involvement;
- legacy owner files do not attribute a new session;
- a review from an uninvolved session starts, records that session, and attributes the change.

The live acceptance is the current workspace: a change created by another session during a turn must not be adopted by this session, and only the creating session's own ticks must be gated.

## Risks / Trade-offs

- **A write through an unrecognized tool or an unparsed shell form** -> it produces no evidence and the change is not auto-attributed. Mitigation: support the first-party `edit`/`write` tools and the creation command; document that `task_progress` or a review/patch `delegate` is the explicit opt-in.
- **A shell write to `tasks.md`** -> the change is attributed but individual task ids are not, because the shell form is not parsed for checkbox transitions. Mitigation: use `task_progress` or a task-review `delegate` for task-level attribution in that case; first-party `edit`/`write` calls are precise.
- **A full-file write that already contains another session's checkbox state** -> the before/after comparison attributes only the transitions this write performed, but the written content can include foreign state. Mitigation: the record remains workspace-global and the explicit task id keeps the gate suggestion narrow; concurrent full-file writers are rare.
- **Write evidence lives in memory for one turn** -> an aborted turn loses it and its writes are not attributed. Mitigation: under-gating is preferable to adopting foreign work; the state remains visible in `git` and `delegation_status`.
- **A new session never adopts an existing change automatically** -> the user must modify it (or call `task_progress`/`delegate`) to opt in. Mitigation: `delegation_status` names the state and the tool calls are explicit; this is the requested behavior.
- **`.dsh` is local scratch** -> a new machine or a cleaned directory starts with no involvement and no records. Mitigation: documented; the alternative is committing session ids, which is worse.
- **A checkbox-only tick does not trigger a whole-spec review** -> an old unreviewed spec can remain unreviewed when the only work is checking tasks. Mitigation: a substantive `tasks.md` edit does trigger it; `delegation_status` reports the change's record state, and a whole-spec review is one explicit `delegate` call away.
- **Review records are global and not anti-forgery** -> any session can run a review and a filesystem-capable agent can write a record-shaped file. This is the existing trust model; this change does not make it weaker.
- **All active changes are digested at pre-step** -> more reads per turn. Mitigation: change directories are small; the worktree digest and implementation fingerprint dominate the cost.

## Migration Plan

1. Implement the involvement state and gate changes; keep the per-change artifact error handling.
2. Run `pnpm build` and `pnpm gen`, then restart the Harness so the Host module is reloaded. The currently loaded module predates the per-change error fix even when the built files contain it.
3. Legacy `.dsh/delegation/owners/` files are ignored. Delete the directory if a clean status is wanted; no other cleanup is required.
4. Existing sessions start uninvolved; their next write (or explicit change-scoped tool call) attributes them. Archive the completed `fix-delegation-foreign-change-digest` change before or after this one; this change supersedes its baseline-claim decision but depends on its per-change error separation.
5. Rollback is a revert of the plugin source and a rebuild; legacy owner files were not modified, and the new involvement files are harmless if left in place.
