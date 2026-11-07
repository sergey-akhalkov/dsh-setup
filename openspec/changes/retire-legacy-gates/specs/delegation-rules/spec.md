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
