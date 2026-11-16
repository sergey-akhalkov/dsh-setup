# Spec Delta

## ADDED Requirements

### Requirement: Focused re-review context

After a prior `FINDINGS` record for the same task or section at a different digest, the next review prompt SHALL carry the prior findings and a bounded diff between the previously reviewed tree and the current one. When the prior reviewed tree is unavailable, the prompt SHALL carry the findings alone and name the missing input. Whole-spec reviews are unchanged.

#### Scenario: Previous findings and diff are rendered

- **WHEN** a task or section review has a prior `FINDINGS` record at a different digest
- **THEN** the next prompt names every prior finding by its stable per-record id and includes the diff between the prior reviewed tree and the current tree, bounded with the changed-path list

#### Scenario: Unavailable tree falls back to findings-only

- **WHEN** the prior record has no reviewed tree or its object is no longer in the repository
- **THEN** the prompt carries the prior findings, states that the diff is unavailable, and starts the review

#### Scenario: Whole-spec review is unchanged

- **WHEN** a whole-spec review re-runs after a prior whole-spec `FINDINGS`
- **THEN** its prompt receives no focused sections

### Requirement: Complete prior-finding inventory

A focused re-review prompt SHALL name every prior finding by its stable per-record id, severity, title, evidence, and fix; the prior-finding inventory MUST NOT be count- or byte-truncated. Only the diff is bounded. If the complete inventory cannot be rendered within the prompt's hard safety limit, the attempt SHALL settle as an `ERROR` naming the cause and MUST write no `PASS`.

#### Scenario: Every prior finding is named

- **WHEN** the prior `FINDINGS` record has N findings
- **THEN** the prompt names all N ids with their severity, title, evidence, and fix

#### Scenario: Overflow fails loud

- **WHEN** the complete prior-finding inventory exceeds the prompt's hard safety limit
- **THEN** the attempt settles as an `ERROR` naming the cause and writes no `PASS`

### Requirement: Previous-finding confirmation

On a focused re-review, the verdict SHALL confirm every prior finding by its stable per-record id as `closed` or `open`. `PASS` SHALL require every prior id `closed` with zero new findings. An `open` prior id SHALL be repeated by exactly one finding that names that id; a `closed` id MUST NOT be named by a finding. A missing, duplicate, or unknown confirmation SHALL fail the review as invalid output and MUST write no `PASS`.

#### Scenario: PASS closes every prior finding

- **WHEN** the verdict confirms each prior id `closed` and reports no new P0/P1
- **THEN** the review writes a `PASS` and its committed approval

#### Scenario: Open prior finding stays actionable

- **WHEN** one prior id is `open`
- **THEN** the verdict is `FINDINGS` and exactly one finding names that id with its severity, evidence, and fix

#### Scenario: Missing confirmation is invalid

- **WHEN** the verdict omits one prior id or names an unknown or duplicate id
- **THEN** the review settles as an `ERROR` with invalid output and writes no `PASS`

#### Scenario: Closed finding is not reported again

- **WHEN** the verdict marks a prior id `closed` and a finding still names that id
- **THEN** the verdict is invalid output

## MODIFIED Requirements

### Requirement: Owned task-review gate

When `task-review` is `own`, the workflow SHALL start the review through the review executor only
when no matching PASS or ERROR record exists for the run's change and checked task; a matching record
SHALL settle the review step from that record without starting a review. When the checked tasks
without a matching PASS or ERROR record in one `tasks.md` level-2 section number two or more, the
workflow SHALL select one section review unit covering every checked task in that section instead of
one unit per task; a section with a single missing task, a task outside any section, and a section
with no missing task keep the per-task unit. The section unit SHALL be named by its section key and
missing tasks in the turn-close steer and in the status summary. It SHALL accept a matching
PASS or ERROR record as intermediate turn-close evidence and refuse the close while the record is
FINDINGS or missing. Before advancing any nonterminal task-review run it SHALL compare the run's
checked task id with `openspec/changes/<change>/tasks.md` and cancel the run as `superseded` when the
id is absent, regardless of which step is pending, and MUST NOT start a second run for the same
change and task while a live-session run for that pair is open. A failed review start SHALL be
retried at most three times across turn closes; after the cap the step SHALL remain failed and the
run SHALL become `failed` (terminal), and the turn-close gate MUST NOT refuse for that run's failed
start. That terminal exemption SHALL apply only to the failed start: the completion-coverage and
work-progress checks SHALL still refuse a final tick without a portable PASS, and the archive gate
SHALL still require a PASS for every checked task. `ERROR` MUST allow an intermediate turn close and
MUST NOT approve. The queue and records MUST remain, and the legacy task-review rule and archive gate
MUST be off.

#### Scenario: Review is started

- **WHEN** a task is checked, the workflow is `own`, and no matching review record exists
- **THEN** the workflow starts the review through the review executor and records the run

#### Scenario: Matching record settles the start step

- **WHEN** a checked task already has a matching PASS or ERROR record
- **THEN** the review step settles from that record without starting a review and the run advances to its coverage step

#### Scenario: Section with two missing tasks is one unit

- **WHEN** section 1 has two or more checked tasks without a matching PASS or ERROR record and no other missing task
- **THEN** the workflow selects one section unit for section 1 and starts no per-task review for its missing tasks

#### Scenario: Single missing task keeps the task unit

- **WHEN** a section has exactly one checked task without a matching PASS or ERROR record
- **THEN** the workflow selects that task's unit and the per-task start

#### Scenario: Section unit covers approved tasks

- **WHEN** a section contains an approved checked task and two missing tasks
- **THEN** the one section run covers every checked task in the section, preserves a matching per-task approval byte-identically, and publishes only the missing or nonmatching approvals

#### Scenario: Pending section run suppresses a duplicate

- **WHEN** a section run for the change's section is queued or running
- **THEN** the gate points at that run and starts no per-task or second section run for its covered tasks

#### Scenario: Steer names the section

- **WHEN** the turn-close gate refuses for missing records in a section
- **THEN** the steer names the section key, the missing tasks, and the start action that covers them

#### Scenario: Removed task is superseded

- **WHEN** a task-review run's checked task id is no longer present in `tasks.md`
- **THEN** the run is cancelled as superseded before the next advance, regardless of which step is pending, and names the missing task

#### Scenario: Restored task starts a fresh run

- **WHEN** a superseded run's task text is restored and checked again
- **THEN** the cancelled run is not resumed and a fresh task-review run starts for the restored task

#### Scenario: Duplicate run is suppressed

- **WHEN** a task-review run for the same change and task is open in a live session
- **THEN** no second run starts for that pair

#### Scenario: Dispatch failure is bounded

- **WHEN** a review start fails and the run has fewer than three attempts
- **THEN** the step stays failed and the next advance retries it

#### Scenario: Exhausted dispatch is terminal

- **WHEN** the third review start fails
- **THEN** the step remains failed, the run becomes `failed`, and the failed-start refusal stops, while the completion-coverage check still refuses a final tick without a portable PASS

#### Scenario: Failed step resumes

- **WHEN** a failed task-review run is resumed
- **THEN** its review step reopens and a later advance starts the review again

#### Scenario: FINDINGS is refused

- **WHEN** the review returns FINDINGS
- **THEN** the workflow refuses the close and names the next review action

#### Scenario: ERROR closes an intermediate turn but does not approve

- **WHEN** the review returns ERROR, the turn does not complete the task list, and no other obligation is open
- **THEN** the turn may close, the task remains unapproved, and the archive still requires a PASS

#### Scenario: PASS approves

- **WHEN** every checked task has a matching PASS record
- **THEN** the turn may close and the archive gate allows the archive

#### Scenario: Archive is gated

- **WHEN** a change has a checked task without a PASS
- **THEN** the archive gate refuses and names the run and the missing task

#### Scenario: Review runtime remains

- **WHEN** the legacy task-review rule and archive gate are off
- **THEN** the review executor, its queue, and its records still work
