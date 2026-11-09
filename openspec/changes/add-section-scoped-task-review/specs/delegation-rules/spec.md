# Spec Delta

## ADDED Requirements

### Requirement: Section-scoped task review

A task-review `delegate` call MAY name a section selector: the `tasks.md` level-2 heading number (`1`, `1.x`) or its normalized title. One run SHALL review all checked tasks in that section in one frozen worktree snapshot with one prompt and one verdict; unchecked tasks MUST be excluded and never covered. The section selector and an explicit task id are mutually exclusive.

#### Scenario: Section review covers checked tasks

- **WHEN** delegate names section `1` and it has several checked tasks
- **THEN** one run reviews all of them against one snapshot and writes one section verdict

#### Scenario: Unchecked tasks are not covered

- **WHEN** a section contains an unchecked task
- **THEN** the review excludes it and the task remains unapproved and unrecorded

#### Scenario: Task and section are exclusive

- **WHEN** a task-review call names both a task id and a section
- **THEN** the tool rejects the call before starting a target and names the accepted selectors

#### Scenario: Unknown section

- **WHEN** the selector matches no `tasks.md` section
- **THEN** the tool rejects the call and names the available sections

### Requirement: Section run identity

The section run identity SHALL include the rule, change, section key, the sorted checked task ids and texts, the frozen change-artifact digest, and the snapshot content tree; unchanged content MUST reuse a FINDINGS record. Checking or unchecking a task, or changing a covered task's text, MUST change the digest and require a new section or task review.

#### Scenario: Unchanged section reuses FINDINGS

- **WHEN** the same section is delegated again with unchanged content and a FINDINGS record exists
- **THEN** that record is reused without another paid run

#### Scenario: Newly checked task needs a new review

- **WHEN** a task is checked after the section PASS
- **THEN** the section digest changes and the task is covered only by a new section or task review

#### Scenario: Changed task text needs a new review

- **WHEN** a covered task's normalized text changes after the section PASS
- **THEN** the digest changes and the task is covered only by a new review

### Requirement: Section approval publication

A section PASS SHALL publish the existing per-task portable `reviews/<taskId>.json` PASS for every covered checked task whose current record does not satisfy the approval checks, with the same rule, verdict, target, time, and digests. A record that satisfies the current approval checks MUST stay byte-identical; a nonmatching record SHALL be replaced only by the publication transaction, and unchecked tasks MUST NOT receive a record.

#### Scenario: Missing approvals are published

- **WHEN** a section review returns PASS and its checked tasks have no portable PASS
- **THEN** each covered task gets its per-task portable PASS with the section evidence

#### Scenario: Matching approval is preserved

- **WHEN** a covered task already has a PASS that satisfies the current approval checks
- **THEN** that record stays byte-identical and the section publishes only the remaining records

#### Scenario: Nonmatching approval is replaced

- **WHEN** a covered task has a PASS from a reviewer that does not satisfy the current checks
- **THEN** the section PASS replaces it transactionally and the task becomes validly approved

#### Scenario: Unchecked task is not approved

- **WHEN** a covered unchecked task has no record
- **THEN** the section publishes no record for it

### Requirement: Section publication transaction

A section publication SHALL write all covered records under the existing publication lock, creating temporaries before any rename. On failure it MUST restore every replaced or removed destination byte-identically and remove only destinations it created; no approval survives. Overlapping section and per-task runs MUST serialize: the later discards when an authoritative PASS exists and MUST NOT overwrite it; a superseded section identity discards the whole publication.

#### Scenario: Partial replacement is rolled back

- **WHEN** a publication fails after replacing one destination that already had a record
- **THEN** the original record is restored byte-identically and no new approval survives

#### Scenario: Per-task run wins the race

- **WHEN** a per-task review for a covered task publishes before the section run
- **THEN** the section keeps that task's valid PASS and publishes the remaining covered tasks or discards wholly on a stale identity

#### Scenario: Section run wins the race

- **WHEN** the section run publishes before an overlapping per-task review
- **THEN** the per-task review discards because an authoritative PASS exists

#### Scenario: Superseded section identity

- **WHEN** a newer identity for the section exists when the run would publish
- **THEN** the section discards the entire publication and approves no task

### Requirement: Section gate and status behavior

A per-task PASS written by a section review SHALL satisfy the turn-stopping and archive checks exactly like a per-task review. While a section run is queued or running, the gate MUST suggest waiting for its record instead of starting per-task runs, and the status and review audit MUST count the covered tasks from their portable records. Section runs MUST respect the review queue identity, dedupe, retry, and settlement rules.

#### Scenario: Gate accepts the covered task

- **WHEN** a section PASS wrote the task's portable approval
- **THEN** the turn gate accepts that checked task and the archive gate reports it approved

#### Scenario: Pending section run

- **WHEN** a section review is queued or running and the turn needs a review
- **THEN** the gate suggests waiting for the section record and starts no duplicate run

#### Scenario: Status reports coverage

- **WHEN** status or the review audit runs after a section PASS
- **THEN** the PASS count includes the covered tasks and the missing list names none of them

#### Scenario: Duplicate section identity joins

- **WHEN** two calls name the same section with the same digest
- **THEN** one target starts and both calls observe the same run

### Requirement: Section failure visibility

A settled section ERROR SHALL be visible to each covered checked task's turn-gate evaluation as an ERROR record with the section's failure class preserved, so an eligible section ERROR MAY close the turn like a task ERROR. It MUST publish no new approval: existing valid approvals remain, and the archive gate reports as missing only covered tasks that lack a valid prior approval.

#### Scenario: Section ERROR closes the turn

- **WHEN** a section review settles ERROR with an eligible failure class
- **THEN** the turn may close with the error visible and no new task approval is granted

#### Scenario: Mixed coverage after ERROR

- **WHEN** one covered task had a valid approval before the section ERROR and another did not
- **THEN** the archive gate keeps the first approved and reports only the second as missing

#### Scenario: Failure class is preserved

- **WHEN** the section target fails with a classified failure
- **THEN** the covered tasks' gate state names that failure class and the retry policy still applies
