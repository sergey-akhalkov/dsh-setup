## ADDED Requirements

### Requirement: Change ownership

The engine SHALL record the first thread that observes an active OpenSpec change as its owner under `.dsh/delegation` and MUST reuse that owner across turns, threads, and engine restarts. The owner MUST be the DSH thread/session id, and the owner state MUST stay local scratch and MUST NOT be committed.

#### Scenario: Owner persists

- **WHEN** a change's owner is recorded and the engine restarts
- **THEN** the same thread remains the owner and the status reports it

#### Scenario: No owner yet

- **WHEN** no thread has observed a newly created change
- **THEN** the first thread to observe it becomes the owner

### Requirement: Thread-scoped review triggers

The gated automatic triggers for a change (`spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`, and the integration review) SHALL evaluate only in the change's owning thread. Another thread MUST NOT be steered to review a change it does not own. A review `delegate` call for a foreign change MUST fail with the owner and the next action before starting a target. `task_progress` notes, answer runs, and patch runs MUST remain available in any thread.

#### Scenario: Owning thread reviews

- **WHEN** the owning thread checks a task or edits the spec of its change
- **THEN** its gate steers the spec/task/integration review as before

#### Scenario: Foreign thread not steered

- **WHEN** another thread opens the same workspace with the change's review missing or stale
- **THEN** its gate does not steer a review of that change and its turn closes without a foreign review obligation

#### Scenario: Foreign thread review refused

- **WHEN** a foreign thread calls delegate for a review rule on the change
- **THEN** the engine refuses before starting a target and names the owning thread and next action

## MODIFIED Requirements

### Requirement: Review contract

The review contract SHALL compute the rule's scope digest, run the target with the bundled P0/P1 prompt, accept exactly one matching JSON verdict, and write an atomic record with the rule, scope, task id when task-scoped, digest, verdict, findings, target identity, time, and the owning thread. A `PASS` MUST require zero P0/P1 findings; a matching `PASS`/`FINDINGS` record MUST be reused without another run; a stale whole-scope digest MUST be ignored. A review run for a change whose owner is another thread MUST be refused before the target starts.

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

### Requirement: Turn-stopping gate

For every gated rule, the engine SHALL refuse a turn close unless a matching `PASS` or `ERROR` record exists for the rule and digest; it MUST steer with the rule id, digest, record path, and exact delegate call and MUST NOT accept a text claim. A soft rule MUST steer once per failure streak; a failed delegation MUST be reported and MUST NOT trap the turn. A stale record MUST never authorize a handoff. A change-scoped review rule MUST apply only in the change's owning thread.

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

- **WHEN** a turn in a foreign thread is about to close and the change's review is missing or stale
- **THEN** the gate does not steer that change's review and does not refuse the close for it

#### Scenario: Soft rule

- **WHEN** a soft rule's failure streak has no consultation attempt
- **THEN** the gate steers once and a reported failure does not loop it

#### Scenario: Text claim

- **WHEN** the agent claims a review passed without a matching record
- **THEN** the gate still refuses the close

### Requirement: Delegate tool and status

The bundle SHALL register a `delegate` tool whose rule parameter is generated from the configured rules and whose description names the manual tasks, a `task_progress` tool for unchecked-task notes, and a `delegation_status` tool that reports registered providers/capabilities, configured targets/rules, active/stale notes, each active change's owning thread and whether it is the current thread, and missing-target diagnostics. The tools MUST validate their rule/target/note inputs before starting a run or writing a note. A review delegate for a foreign change MUST be refused with the owning thread and next action.

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

- **WHEN** delegation_status runs in a thread that does not own a change
- **THEN** it reports the change's owning thread and the current thread, without a review run
