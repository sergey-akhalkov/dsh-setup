# Spec Delta

## MODIFIED Requirements

### Requirement: Owned task-review gate

When `task-review` is `own`, the workflow SHALL start the review through `delegate` only when no matching PASS or ERROR record exists for the run's change and checked task; a matching record SHALL settle the `start-review` step from that record without dispatching `delegate`. It SHALL accept a matching PASS or ERROR record as intermediate turn-close evidence and refuse the close while the record is FINDINGS or missing. Before advancing any nonterminal task-review run it SHALL compare the run's checked task id with `openspec/changes/<change>/tasks.md` and cancel the run as `superseded` when the id is absent, regardless of which step is pending, and MUST NOT start a second run for the same change and task while a live-session run for that pair is open. A failed tool dispatch SHALL be retried at most three times across turn closes; after the cap the step SHALL remain failed and the run SHALL become `failed` (terminal), and the turn-close gate MUST NOT refuse for that run's failed dispatch. That terminal exemption SHALL apply only to the failed dispatch: the retained completion-coverage and task-progress checks SHALL still refuse a final tick without a portable PASS, and the archive gate SHALL still require a PASS for every checked task. `ERROR` MUST allow an intermediate turn close and MUST NOT approve. The queue and records MUST remain, and the legacy task-review rule and archive gate MUST be off.

#### Scenario: Review is started

- **WHEN** a task is checked, the workflow is `own`, and no matching review record exists
- **THEN** the workflow starts the existing review rule for that task

#### Scenario: Matching record settles the start step

- **WHEN** a checked task already has a matching PASS or ERROR record
- **THEN** `start-review` settles from that record without dispatching `delegate` and the run advances to its record and coverage steps

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

- **WHEN** a `start-review` dispatch fails and the run has fewer than three attempts
- **THEN** the step stays failed and the next advance retries it

#### Scenario: Exhausted dispatch is terminal

- **WHEN** the third `start-review` dispatch fails
- **THEN** the step remains failed, the run becomes `failed`, and the failed-dispatch refusal stops, while the completion-coverage check still refuses a final tick without a portable PASS

#### Scenario: Failed step resumes

- **WHEN** a failed task-review run is resumed
- **THEN** its `start-review` step reopens and a later advance dispatches it again

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
- **THEN** the delegate tool, queue, and records still work
