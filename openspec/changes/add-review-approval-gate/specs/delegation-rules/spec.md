# Spec Delta

## ADDED Requirements

### Requirement: Portable task-review approval

A task-scope review that returns PASS SHALL publish a sanitized portable record under the change's
`reviews/<taskId>.json` in addition to the local `.dsh` record. The record MUST identify the rule,
change, task id, verdict, target, time, and digests, MUST NOT include the reviewing session, run id,
or machine paths, and MUST be committed with the change. A failed portable write MUST NOT publish a
PASS.

#### Scenario: PASS writes the portable record

- **WHEN** a task review returns PASS
- **THEN** the change directory contains `reviews/<taskId>.json` with the rule, change, task id,
  verdict, target, time, and digests, and no session, run id, or machine path

#### Scenario: ERROR or FINDINGS is not approval

- **WHEN** a task review returns `ERROR` or `FINDINGS`
- **THEN** no portable PASS record is written for that task

#### Scenario: Failed portable write

- **WHEN** the portable record cannot be written
- **THEN** no PASS is published and the run reports the write failure

#### Scenario: The record travels with the branch

- **WHEN** a task review runs in a worktree and the branch containing the change is merged
- **THEN** the portable record is present in the merged change and can approve the task there

#### Scenario: The local record remains

- **WHEN** a task review returns PASS
- **THEN** the local `.dsh` record and the portable record both exist

### Requirement: Change-level review coverage

The engine SHALL compute approval over every checked task in `tasks.md`, independent of session
attribution. A checked task is approved only by a matching portable task-review PASS; `ERROR`,
`FINDINGS`, a missing or malformed record, and a checked line that does not parse as a numbered task
are not approved. Unchecked tasks are reported but not required.

#### Scenario: A shell tick

- **WHEN** a session changes `tasks.md` through a shell command and no task id is attributed
- **THEN** the checked task still requires a portable PASS before archive

#### Scenario: A foreign session PASS

- **WHEN** another session wrote the portable PASS for a checked task
- **THEN** the coverage accepts that task

#### Scenario: ERROR is not approval

- **WHEN** the only record for a checked task is an `ERROR` record
- **THEN** the task is unapproved

#### Scenario: Malformed record

- **WHEN** a portable record for a checked task is unreadable or malformed
- **THEN** the task is unapproved and the status names the malformed record

#### Scenario: Unparseable checked line

- **WHEN** `tasks.md` contains a checked line that is not a numbered task
- **THEN** the coverage fails closed and names the line

#### Scenario: Unchecked task

- **WHEN** a task is unchecked and every checked task is approved
- **THEN** the unchecked task is reported as an open follow-up, not required for approval

### Requirement: Archive approval gate

In a workspace whose tracked `openspec/review-approval.json` sets `archiveGate: true`, the engine
SHALL refuse the archive operation before it runs unless every checked task has a portable
task-review PASS. The refusal MUST name the change, the missing tasks, and the exact review calls,
and MUST leave the change active. The guard MUST fail closed on an unreadable change, record, or task
rule. A workspace without the marker MUST be unchanged.

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

### Requirement: PASS-only approval boundary

An `ERROR` review record MAY let a turn close but MUST NOT approve a task for archive or push. The
status and audit MUST report PASS, ERROR, and missing separately, and an archive is ready only when
every checked task has a PASS.

#### Scenario: ERROR closes a turn

- **WHEN** the only task review record is `ERROR`
- **THEN** the turn may close and the status reports the change as not archive-ready

#### Scenario: Re-review produces approval

- **WHEN** the task is reviewed again with its explicit task id and returns PASS
- **THEN** the task is approved for archive

#### Scenario: Status separates verdicts

- **WHEN** the status or audit runs
- **THEN** it reports the PASS, ERROR, and missing counts separately and names the missing tasks

## MODIFIED Requirements

### Requirement: Reviewed change-artifact inputs

A review whose digest includes the change-artifact digest MUST also track the reviewed change's
artifacts as inputs, regardless of Git ignore rules, excluding `.openspec.yaml` and the `reviews/`
approval directory; a whole-spec review tracks exactly those artifacts. A task-scoped review therefore
tracks the union of the Git-visible worktree files and the change artifacts.

#### Scenario: Ignored change artifact changes during a task review

- **WHEN** a change artifact excluded by `.gitignore` is edited while a task review runs
- **THEN** no `PASS` is published, because that artifact is part of the task digest

#### Scenario: Change artifact changes during a whole-spec review

- **WHEN** a change artifact is edited while a whole-spec review runs
- **THEN** no `PASS` is published and the run reports the changed artifacts

#### Scenario: Task approval does not invalidate the spec review

- **WHEN** a portable `reviews/<taskId>.json` record is written while a whole-spec review runs
- **THEN** the review publishes, because the approval directory is excluded from the reviewed inputs

### Requirement: Session-scoped review triggers

The gated automatic triggers for a change SHALL evaluate only in a session that created or modified
that change. `spec-ready` MUST apply only when the session created the change or changed its spec
artifacts; `spec-task-ready` MUST apply only to tasks the session checked; `implementation-work` MUST
apply only to an involved change; `implementation-complete` MUST apply only when the session's work
completed the task list. When the session's checked task makes the change's task list fully checked,
`spec-task-ready` MUST require an approved task-review PASS for every checked task in that change,
not only the tasks the session checked.

#### Scenario: Foreign session not steered

- **WHEN** a session that did not create or modify a change closes a turn while the change has
  checked tasks without review records
- **THEN** its gate does not steer a review for that change

#### Scenario: Own checked task is gated

- **WHEN** a session checks a task in a change it did not create and the task list is not complete
- **THEN** its gate requires a review for that task and not for checked tasks from other sessions

#### Scenario: Continuation does not inherit old ticks

- **WHEN** a second session checks a new task in a change started by a first session and the task
  list is not complete
- **THEN** only the second session's task is in its review scope

#### Scenario: Concurrent task writers keep separate scopes

- **WHEN** two sessions check different tasks in the same change during overlapping turns and the
  task list is not complete
- **THEN** each gate requires only the task that session checked

#### Scenario: Completion requires all checked tasks

- **WHEN** a session's checked task makes the task list fully checked and another checked task has no
  PASS record
- **THEN** the completing session's gate requires approval for that task too

#### Scenario: Spec review only from spec work

- **WHEN** a session only changes task checkboxes and does not make a substantive task-plan or spec
  edit
- **THEN** its gate does not require the whole-spec review

#### Scenario: Integration review needs the completing session

- **WHEN** a session's checked task makes the change's task list complete
- **THEN** its gate may require the integration review for the current worktree
