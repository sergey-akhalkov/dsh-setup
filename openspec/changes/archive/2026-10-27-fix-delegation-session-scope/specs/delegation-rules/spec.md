# Spec Delta

## MODIFIED Requirements

### Requirement: Trigger evaluation

The engine SHALL implement the six deterministic triggers `manual`, `spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`, and `failure-streak`. A trigger MUST evaluate only from session/workspace state and tool results, MUST be evaluated at `agent/turn-stopping` for gated rules, and MUST NOT start a target run from the listener. A change-scoped trigger MUST evaluate only for a change attributed to the current session. A new trigger source requires a code extension.

#### Scenario: Spec-ready trigger

- **WHEN** an active review-ready change attributed to the session has a gated whole-spec review rule without a matching pass
- **THEN** the trigger reports the rule as unsatisfied

#### Scenario: Spec-task-ready trigger

- **WHEN** a checked task attributed to the session has no matching task-review record
- **THEN** the trigger reports the task as needing a task-scoped review

#### Scenario: Implementation-work trigger

- **WHEN** a turn changed implementation files in a change attributed to the session and has neither a newly checked reviewed task nor a matching task-progress note for the current worktree
- **THEN** the trigger reports that a tick+review or a progress note is required

#### Scenario: Implementation-complete trigger

- **WHEN** a change attributed to the session has a complete task list and its optional integration-review rule has no matching pass
- **THEN** the trigger reports the integration rule as unsatisfied

#### Scenario: Failure-streak trigger

- **WHEN** the configured number of consecutive failed tool calls has no intervening success and no consultation attempt
- **THEN** the trigger reports the soft rule as needing a delegation

#### Scenario: Manual trigger

- **WHEN** a rule uses the manual trigger
- **THEN** it has no automatic condition and runs only through the delegate tool

#### Scenario: Unknown trigger

- **WHEN** a rule names a trigger outside the documented vocabulary
- **THEN** configuration validation rejects it

### Requirement: Review contract

The review contract SHALL compute the rule's scope digest, run the target with the bundled P0/P1 prompt, accept exactly one matching JSON verdict, and write an atomic record with the rule, scope, task id when task-scoped, digest, verdict, findings, target identity, time, and the reviewing session. A `PASS` MUST require zero P0/P1 findings; a matching `PASS`/`FINDINGS` record MUST be reused without another run; a stale whole-scope digest MUST be ignored. A review MAY run in any session, and the record MUST name the session that ran it.

#### Scenario: Passing review

- **WHEN** the target returns zero P0/P1 findings with the matching digest in the reviewing session
- **THEN** the engine writes a `PASS` record carrying the reviewing session and returns the verdict

#### Scenario: Findings

- **WHEN** the target returns at least one P0 or P1 finding
- **THEN** the engine writes a `FINDINGS` record and returns every blocking finding with evidence and fix

#### Scenario: Stale whole-scope record

- **WHEN** the reviewed artifact or worktree changes after a whole-scope pass
- **THEN** the stored record is ignored and a new review is required

#### Scenario: Malformed verdict

- **WHEN** the target returns no single matching verdict, an invalid severity, or prose only
- **THEN** no `PASS` is written and the failure is reported

### Requirement: Task progress gate

The gate SHALL refuse a code-changing turn close unless every checked task the current session attributed has a matching task-review `PASS`/`ERROR` and the turn has a newly checked reviewed task or a matching task-progress note for the current worktree. A note MUST NOT authorize a completed task, and the status tool MUST report active and stale notes.

#### Scenario: Code change without a tick or note

- **WHEN** a turn changes implementation files and has no checked reviewed task and no progress note
- **THEN** the gate steers to tick+review or `task_progress`

#### Scenario: Progress note allows the close

- **WHEN** a code-changing turn has a matching progress note for the current worktree
- **THEN** the gate allows the close with the task still unchecked

#### Scenario: Checked task without its review

- **WHEN** a task the session checked has no task-review PASS/ERROR
- **THEN** the gate refuses the close even if a progress note exists

#### Scenario: Stale progress note

- **WHEN** the worktree changes after a progress note
- **THEN** the stale note no longer authorizes a close

### Requirement: Turn-stopping gate

For every gated rule, the engine SHALL refuse a turn close unless a matching `PASS` or `ERROR` record exists for the rule and digest; it MUST steer with the rule id, digest, record path, and exact delegate call and MUST NOT accept a text claim. A soft rule MUST steer once per failure streak; a failed delegation MUST be reported and MUST NOT trap the turn. A stale record MUST never authorize a handoff. A change-scoped review rule MUST apply only in a session that created or modified the change. The engine MUST separate a worktree-level git failure from a per-change artifact problem: a missing or unreadable planning file in a change attributed to the current session (for example `tasks.md`) MUST NOT be reported as a worktree digest failure and MUST instead produce a distinct issue that names the change and the session, or treat the change as not review-ready.

#### Scenario: Strict rule unsatisfied

- **WHEN** a turn is about to close and a strict rule has no matching record
- **THEN** the engine refuses the close and steers to the delegate call

#### Scenario: Strict rule error

- **WHEN** the target is unavailable and the tool writes a matching `ERROR` record
- **THEN** the turn may close with the error visible and no pass is reported

#### Scenario: Stale record

- **WHEN** the digest changes after a pass
- **THEN** the stale pass is ignored and the gate requires a new run

#### Scenario: Foreign thread not steered

- **WHEN** a turn in a session that did not create or modify the change is about to close and the change's review is missing or stale
- **THEN** the gate does not steer that change's review and does not refuse the close for it

#### Scenario: Soft rule

- **WHEN** a soft rule's failure streak has no consultation attempt
- **THEN** the gate steers once and a reported failure does not loop it

#### Scenario: Text claim

- **WHEN** the agent claims a review passed without a matching record
- **THEN** the gate still refuses the close

#### Scenario: Missing tasks.md in an owned change

- **WHEN** a turn is about to close in a session that created or modified a change and the change has no readable `tasks.md`
- **THEN** the gate names the change and the session as a per-change artifact problem and does not report a worktree digest failure

#### Scenario: Worktree git failure

- **WHEN** the git status or diff command needed for the worktree digest fails
- **THEN** the gate reports the worktree digest failure and the git command to re-run

### Requirement: Delegate tool and status

The bundle SHALL register a `delegate` tool whose rule parameter is generated from the configured rules and whose description names the manual tasks, a `task_progress` tool for unchecked-task notes, and a `delegation_status` tool that reports registered providers/capabilities, configured targets/rules, active/stale notes, each active change's involvement by the current session, and missing-target diagnostics. The tools MUST validate their rule/target/note inputs before starting a run or writing a note. A review delegate MAY run in any session and records the reviewing session. `delegation_status` MUST report an active change whose `tasks.md` is missing or unreadable as an unreadable per-change state, keep showing that change's involvement and record state, and MUST NOT throw or run a review.

#### Scenario: Manual delegation

- **WHEN** the agent calls delegate for a configured manual rule
- **THEN** the engine validates the input and runs that rule's target/instruction

#### Scenario: Progress tool

- **WHEN** the agent calls task_progress for an unchecked task
- **THEN** the tool writes the note and runs no model

#### Scenario: Unknown rule

- **WHEN** the agent names a rule that is not configured
- **THEN** the tool rejects the call with the allowed rule ids

#### Scenario: Status

- **WHEN** the agent or user asks for delegation status
- **THEN** the tool reports the available providers, targets, rules, active/stale notes, and missing-target diagnostics

#### Scenario: Foreign change status

- **WHEN** delegation_status runs in a session that did not create or modify a change
- **THEN** it reports that the session is not involved and shows the change's record and task state, without a review run

#### Scenario: Unreadable tasks in status

- **WHEN** delegation_status runs while an active change has no readable `tasks.md`
- **THEN** it reports that change's tasks as unreadable and returns normally

#### Scenario: Explicit review

- **WHEN** a session calls delegate for a review of a change it did not create or modify
- **THEN** the engine starts the run, records the reviewing session, and attributes the change to that session

### Requirement: Task progress note

The `task_progress` tool SHALL write a task id, status (`in-progress` or `blocked`), reason, worktree digest, and time without running a target or writing a `PASS`. The note MUST be the only non-tick way to close a code-changing turn and MUST become stale when the worktree digest changes. Task lookup MUST skip unreadable unrelated changes and validate the selected readable task.

#### Scenario: In-progress task

- **WHEN** a task spans the turn and the agent records `task_progress(task, in-progress, reason)`
- **THEN** the engine writes the note with the current worktree digest and runs no model

#### Scenario: Blocked task

- **WHEN** the agent records `task_progress(task, blocked, reason)`
- **THEN** the note is reported and the task remains unchecked

#### Scenario: Stale note

- **WHEN** the worktree changes after a progress note
- **THEN** the note no longer authorizes a close and a fresh note or tick+review is required

#### Scenario: No pass from a note

- **WHEN** a progress note exists for a task
- **THEN** it never counts as a task-review `PASS`

#### Scenario: Unreadable foreign change

- **WHEN** the requested task is readable and another active change has no readable tasks.md
- **THEN** the note is written for the requested task

### Requirement: Explicit task review selection

A task-scoped review `delegate` call SHALL accept an explicit task id; when present, the engine MUST review that checked task after validating that it is checked and matches the task-review rule, instead of selecting the next checked task. Parallel task-review calls for different tasks MUST NOT collapse onto one task. When the task id is absent, the existing next-checked-task selection applies. A gate-suggested task-review call MUST name the explicit task id of the session's checked task.

#### Scenario: Explicit task

- **WHEN** delegate names a checked task for task-review
- **THEN** that task is reviewed even when another task is next

#### Scenario: Parallel task reviews

- **WHEN** two task-review calls name different checked tasks at the same time
- **THEN** both tasks are reviewed independently

#### Scenario: Unknown or unchecked task

- **WHEN** the named task is missing or unchecked
- **THEN** the tool rejects the call before starting a target and names the allowed checked tasks

#### Scenario: Gate names the task

- **WHEN** the gate steers to review a task the session checked and an earlier checked task from another session has no review record
- **THEN** the suggested delegate call names the session's task id, and following it reviews that task instead of the earlier foreign task

## REMOVED Requirements

### Requirement: Change ownership

**Reason**: First-observation ownership adopted changes a session had never created or modified, including changes created by another live session, and then forced reviews of every historical checked task.

**Migration**: Legacy `.dsh/delegation/owners/` files are ignored and may be deleted. A session becomes involved only by creating or modifying a change; the new attribution state lives under `.dsh/delegation/sessions/`.

### Requirement: Thread-scoped review triggers

**Reason**: Replaced by session involvement: an exclusive owner cannot represent two sessions working on one change and blocks reviews for a dead owner thread.

**Migration**: Use the session-scoped triggers and the cross-session tools in this delta. No rule configuration changes.

## ADDED Requirements

### Requirement: Session change involvement

The engine SHALL record per DSH session which active OpenSpec changes that session created or modified under `.dsh/delegation/sessions`, and MUST NOT attribute a change from observation or a workspace diff alone. Attribution MUST come from write evidence — a successful write or creation tool call targeting the change during the turn — or an explicit `task_progress` or review/patch `delegate` call. The state MUST persist across turns and restarts as local scratch.

#### Scenario: No attribution on observation

- **WHEN** a new session opens an active change with checked tasks and no session attribution
- **THEN** it records no involvement and the gate does not steer that change

#### Scenario: Concurrent session does not attribute

- **WHEN** another session creates or edits a change during a turn and the evaluating session made no write or explicit change-scoped call
- **THEN** the evaluating session records no involvement, even though its workspace snapshot changed

#### Scenario: Write evidence attributes a change

- **WHEN** a session successfully writes a file under an active change directory during a turn
- **THEN** the next gate records the change as that session's work

#### Scenario: Creation command attributes a change

- **WHEN** a session runs a successful creation command for a change during a turn
- **THEN** the next gate records the change as created and spec-changed by that session

#### Scenario: Creation does not import foreign ticks

- **WHEN** a session creates a change and another session checks a task before the creator's gate
- **THEN** the creator records created and spec-changed but not the other session's task id

#### Scenario: Persistence

- **WHEN** the engine restarts and the same session id resumes
- **THEN** the recorded involvement is reused

#### Scenario: Explicit tool use

- **WHEN** the session calls task_progress or a review/patch delegate for a change
- **THEN** the change is attributed to the session

#### Scenario: Legacy owner state

- **WHEN** only a legacy `.dsh/delegation/owners/` file exists for a change
- **THEN** it is ignored and it does not attribute the change to a new session

### Requirement: Per-write task attribution

A successful `tasks.md` write SHALL attribute only the checkbox transitions caused by that write, captured from the successful write's canonical before/after contents. It MUST set `specChanged` when that write's checkbox-normalized before/after contents differ (a substantive task-plan edit or a newly supplied `tasks.md`); a checkbox-only edit MUST NOT set `specChanged`. The whole-change artifact digest MUST NOT be used to decide whether a `tasks.md` write was substantive.

#### Scenario: Concurrent task writers

- **WHEN** two sessions check different tasks in the same change during overlapping turns
- **THEN** each session attributes only the task it checked and each gate requires only that task

#### Scenario: Substantive task-plan edit

- **WHEN** a session rewrites an unchecked task line or adds a task
- **THEN** the session's change is marked spec-changed and the whole-spec review applies

#### Scenario: Checkbox-only edit

- **WHEN** the only write is changing a task from unchecked to checked
- **THEN** the task is attributed but the change is not marked spec-changed

#### Scenario: Foreign spec edit does not change a checkbox writer

- **WHEN** another session edits `proposal.md` during a session's checkbox-only `tasks.md` write
- **THEN** the checkbox writer is not marked spec-changed

#### Scenario: New tasks.md for a partial change

- **WHEN** a session writes the first `tasks.md` for an existing change
- **THEN** the write is attributed, its before/after differs beyond checkboxes, and the change is marked spec-changed

#### Scenario: Unobservable task write

- **WHEN** a shell write changes `tasks.md` and the engine cannot capture the before/after checkbox state
- **THEN** the change is attributed but no task id is attributed, and explicit `task_progress` or a task-review `delegate` supplies task-level attribution

### Requirement: Session-scoped review triggers

The gated automatic triggers for a change SHALL evaluate only in a session that created or modified that change. `spec-ready` MUST apply only when the session created the change or changed its spec artifacts; `spec-task-ready` MUST apply only to tasks the session checked; `implementation-work` MUST apply only to an involved change; `implementation-complete` MUST apply only when the session's work completed the task list.

#### Scenario: Foreign session not steered

- **WHEN** a session that did not create or modify a change closes a turn while the change has checked tasks without review records
- **THEN** its gate does not steer a review for that change

#### Scenario: Own checked task is gated

- **WHEN** a session checks a task in a change it did not create
- **THEN** its gate requires a review for that task and not for checked tasks from other sessions

#### Scenario: Continuation does not inherit old ticks

- **WHEN** a second session checks a new task in a change started by a first session
- **THEN** only the second session's task is in its review scope

#### Scenario: Concurrent task writers keep separate scopes

- **WHEN** two sessions check different tasks in the same change during overlapping turns
- **THEN** each gate requires only the task that session checked

#### Scenario: Spec review only from spec work

- **WHEN** a session only changes task checkboxes and does not make a substantive task-plan or spec edit
- **THEN** its gate does not require the whole-spec review

#### Scenario: Integration review needs the completing session

- **WHEN** a session's checked task makes the change's task list complete
- **THEN** its gate may require the integration review for the current worktree

### Requirement: Cross-session delegation tools

`task_progress` notes, answer runs, patch runs, and explicit review runs SHALL remain available in any session. An explicit `task_progress` or review/patch `delegate` call MUST attribute that change to the calling session; an `answer` delegate MUST NOT attribute. A review record MUST name the reviewing session.

#### Scenario: Progress note in a foreign session

- **WHEN** a session that did not create or modify a change calls task_progress for its unchecked task
- **THEN** the note is written and the change is attributed to that session

#### Scenario: Unreadable foreign change does not block a note

- **WHEN** task_progress targets a task in a readable change while another active change has no readable tasks.md
- **THEN** the note is written for the readable task and the unreadable change is skipped

#### Scenario: Review from any session

- **WHEN** a session runs a review for a change it did not create or modify
- **THEN** the run starts, the record names the reviewing session, and the change is attributed to that session

#### Scenario: Answer does not attribute

- **WHEN** a session runs an answer delegate with a valid change argument
- **THEN** the change is not attributed to that session and no involvement is recorded
