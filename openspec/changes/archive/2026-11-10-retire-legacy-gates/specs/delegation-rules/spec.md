# Spec Delta

## ADDED Requirements

### Requirement: Gate-only retirement switch

The review engine SHALL support `gates.workflowOwned: false`, which disables only the task-review turn-stopping rule and the archive gate. It keeps the `delegate` tool, queue, runs, records, `task_progress` notes, rule data, the whole-spec `spec-review` rule, and the task-progress and lane-assignment/lane-boundary gates. A `defer` `task-review` definition MUST then be refused, while a `defer` `spec-review` step remains valid.

#### Scenario: Review runtime remains

- **WHEN** `gates.workflowOwned` is false and a task review is delegated
- **THEN** the review still queues, runs, and writes its record

#### Scenario: Workflow-owned gates are silent

- **WHEN** the switch is false and a checked task lacks a review
- **THEN** the delegation-rules task-review and archive gates do not steer or refuse

#### Scenario: Spec-review rule remains

- **WHEN** the switch is false and a change in this session's scope has no matching whole-spec review
- **THEN** the legacy `spec-ready` rule still refuses the close and steers the spec review

#### Scenario: Task-progress gate remains

- **WHEN** the switch is false and a code-changing turn has neither a newly checked reviewed task nor a matching progress note
- **THEN** the task-progress gate still refuses the close and steers to a note or a reviewed tick

#### Scenario: Stale note is rejected

- **WHEN** the switch is false and the worktree changes after a progress note
- **THEN** the task-progress gate still refuses the close because the note is stale

#### Scenario: Lane-assignment gate remains

- **WHEN** the switch is false and completing one lane leaves a single unchecked unassigned lane, or an implementation turn below the checkpoint threshold leaves an unassigned lane
- **THEN** the lane-assignment gate still reports the lane and names the tagged worker or serial-note call

#### Scenario: Workflow owns the gate

- **WHEN** `gates.workflowOwned` is false and the `task-review` definition is `own`
- **THEN** the workflow starts the review, refuses the close on FINDINGS or a missing record, allows an ERROR to close an intermediate turn without approving, requires a portable PASS for every checked task when the tick completes the list, and refuses the archive until a PASS exists

#### Scenario: Records are unchanged

- **WHEN** the switch changes
- **THEN** existing review records, queue state, and `task_progress` notes remain readable and are not rewritten

#### Scenario: Rollback

- **WHEN** `gates.workflowOwned` is true again
- **THEN** the task-review and archive gates steer again, the `task-review` definition MUST return to `defer`, and the spec-review, progress, and lane gates are unaffected
## MODIFIED Requirements

### Requirement: Turn-stopping gate

For every gated rule, the engine SHALL refuse a turn close unless a matching `PASS` or `ERROR` record exists for the rule and digest; it MUST steer with the rule id, digest, record path, and exact delegate call and MUST NOT accept a text claim. A soft rule MUST steer once per failure streak; a failed delegation MUST be reported and MUST NOT trap the turn. A stale record MUST never authorize a handoff. A change-scoped review rule MUST apply only in a session that created or modified the change. The engine MUST separate a worktree-level git failure from a per-change artifact problem: a missing or unreadable planning file in a change attributed to the current session (for example `tasks.md`) MUST NOT be reported as a worktree digest failure and MUST instead produce a distinct issue that names the change and the session, or treat the change as not review-ready. When `delegation.gates.workflowOwned` is false, the engine MUST NOT enforce or steer the task-review rule and MUST NOT refuse a close for a missing task review; the whole-spec `spec-review` rule, the task-progress gate, and the lane-assignment/lane-boundary gates MUST remain in force. A `defer` task-review definition MUST be refused in that mode.

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

#### Scenario: Workflow-owned task-review is silent

- **WHEN** `gates.workflowOwned` is false and a checked task lacks a review
- **THEN** this engine does not steer or refuse the close for the task-review rule
### Requirement: Archive approval gate

In a workspace whose tracked `openspec/review-approval.json` sets `archiveGate: true`, the engine SHALL refuse the archive operation before it runs unless every checked task has a portable task-review PASS. The refusal MUST name the change, the missing tasks, and the exact review calls, and MUST leave the change active. The guard MUST fail closed on an unreadable change, record, or task rule. A workspace without the marker MUST be unchanged. When `delegation.gates.workflowOwned` is false, this legacy archive guard MUST NOT run; the workflow archive gate is the only archive enforcement, and the switch is valid only when the `task-review` definition is `own` and the tracked parity report passes.

#### Scenario: Missing approval

- **WHEN** the archive command runs for a change with a checked task that has no portable PASS
- **THEN** the command is refused before the move and the change remains active

#### Scenario: Complete approval

- **WHEN** every checked task in the change has a portable PASS
- **THEN** the archive operation proceeds

#### Scenario: A subagent archives

- **WHEN** a subagent session runs the archive command for a change with a missing approval
- **THEN** the guard refuses it like a root session

#### Scenario: Marker absent

- **WHEN** the workspace has no `openspec/review-approval.json` marker or `archiveGate` is false
- **THEN** the archive operation is unchanged

#### Scenario: Invalid task rule

- **WHEN** the marker names a task rule that is missing, not task-scoped, or not strict
- **THEN** the archive is refused with the rule and the configuration error

#### Scenario: Unreadable evidence

- **WHEN** `tasks.md` or a required portable record cannot be read
- **THEN** the archive is refused with the path and the failure

#### Scenario: Legacy guard is off

- **WHEN** `gates.workflowOwned` is false and a checked task has no portable PASS
- **THEN** this engine does not refuse the archive and the workflow archive gate owns the check
