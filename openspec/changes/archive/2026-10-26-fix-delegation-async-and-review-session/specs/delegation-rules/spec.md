## ADDED Requirements

### Requirement: Asynchronous review runs

A review delegation SHALL validate the rule, target, and change (and an explicit task when supplied), start the target, and return a run id before the target completes. The run MUST continue in the background, MUST write the rule's digest-bound `PASS`/`FINDINGS`/`ERROR` record when it finishes, and MUST be visible in `delegation_status` while running and after completion. Multiple review runs MUST be able to proceed concurrently. The answer and patch contracts MUST remain synchronous.

#### Scenario: Review starts and returns

- **WHEN** the agent calls delegate for a review rule
- **THEN** the tool returns a run id and record path after the target starts, and the turn can continue

#### Scenario: Concurrent reviews

- **WHEN** the agent starts several reviews for different tasks or changes
- **THEN** the runs proceed concurrently and each writes its own record

#### Scenario: Failed run

- **WHEN** a background review run fails
- **THEN** an `ERROR` record with the failure is written and the status reports it

### Requirement: Pending review handling

A duplicate review request MUST be identified by the rule, the change, and the task/phase. A second request for the same identity while pending MUST return the existing run handle and MUST NOT start a duplicate. Distinct rules reviewing the same change/task MUST share the conversation key but queue as separate runs and write each rule's own record. Runs sharing a conversation key MUST be serialized, and a superseded or late completion MUST NOT replace the authoritative record.

#### Scenario: Duplicate pending request

- **WHEN** a review is already pending for the same rule/change/task and delegate is called again
- **THEN** the existing run handle is returned and no second target starts

#### Scenario: Different rules, same task

- **WHEN** two different review rules target the same change/task while one is pending
- **THEN** the second rule runs (queued) and writes its own record instead of returning the first rule's handle

#### Scenario: Late completion

- **WHEN** a run sharing a key completes after the authoritative record was written
- **THEN** its result is reported as discarded and does not replace the record

### Requirement: Stable review inputs

A background review MUST review immutable inputs bound to its digest. It MUST NOT publish a `PASS` when any reviewed input changed at any time during the run, including when the content is later restored. A digest re-check alone is not sufficient; the engine must use a snapshot or equivalent mutation tracking that makes the reviewed contents immutable for the run.

#### Scenario: Inputs change during a review

- **WHEN** a reviewed file is edited while a background review is still running
- **THEN** no `PASS` is published for that digest and the run reports that the inputs changed

#### Scenario: Edit-read-restore

- **WHEN** a reviewed file is edited, read by the target, and restored to its original content before the run completes
- **THEN** no `PASS` is published, because the target did not review the digest's contents

#### Scenario: Stable inputs

- **WHEN** the inputs stay unchanged for the run
- **THEN** the verdict is accepted for the digest computed at start

### Requirement: Explicit task review selection

A task-scoped review `delegate` call SHALL accept an explicit task id; when present, the engine MUST review that checked task after validating that it is checked and matches the task-review rule, instead of selecting the next checked task. Parallel task-review calls for different tasks MUST NOT collapse onto one task. When the task id is absent, the existing next-checked-task selection applies.

#### Scenario: Explicit task

- **WHEN** delegate names a checked task for task-review
- **THEN** that task is reviewed even when another task is next

#### Scenario: Parallel task reviews

- **WHEN** two task-review calls name different checked tasks at the same time
- **THEN** both tasks are reviewed independently

#### Scenario: Unknown or unchecked task

- **WHEN** the named task is missing or unchecked
- **THEN** the tool rejects the call before starting a target and names the allowed checked tasks

## MODIFIED Requirements

### Requirement: Review contract

The review contract SHALL compute the rule's scope digest, run the target with the bundled P0/P1 prompt, accept exactly one matching JSON verdict, and write an atomic record with the rule, scope, task id when task-scoped, digest, verdict, findings, target identity, time, and the owning thread. A `PASS` MUST require zero P0/P1 findings; a matching `PASS`/`FINDINGS` record MUST be reused without another run; a stale whole-scope digest MUST be ignored. A review run for a change whose owner is another thread MUST be refused before the target starts. A review run started asynchronously MUST write the same record on completion, MUST report its pending/failed/discarded state in `delegation_status`, and MUST NOT publish a `PASS` when any reviewed input changed during the run.

#### Scenario: Passing review

- **WHEN** the target returns zero P0/P1 findings with the matching digest in the owning thread
- **THEN** the engine writes a `PASS` record carrying the owning thread and returns the verdict

#### Scenario: Findings

- **WHEN** the target returns at least one P0 or P1 finding
- **THEN** the engine writes a `FINDINGS` record and returns every blocking finding with evidence and fix

#### Scenario: Stale whole-scope record

- **WHEN** the reviewed artifact or worktree changes after a whole-scope pass
- **THEN** the stored record is ignored and a new review is required

#### Scenario: Malformed verdict

- **WHEN** the target returns no single matching verdict, an invalid severity, or prose only
- **THEN** no `PASS` is written and the failure is reported

### Requirement: Delegate tool and status

The bundle SHALL register a `delegate` tool whose rule parameter is generated from the configured rules and whose description names the manual tasks, a `task_progress` tool for unchecked-task notes, and a `delegation_status` tool that reports registered providers/capabilities, configured targets/rules, active/stale notes, running/completed/failed/discarded review runs, each active change's owning thread and whether it is the current thread, and missing-target diagnostics. The tools MUST validate their rule/target/change/task/note inputs before starting a run or writing a note. A review delegate for a foreign change MUST be refused with the owning thread and next action.

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
- **THEN** the tool reports the available providers, targets, rules, active/stale notes, running reviews, and missing-target diagnostics

#### Scenario: Foreign change status

- **WHEN** delegation_status runs in a thread that does not own a change
- **THEN** it reports the change's owning thread and the current thread, without a review run
