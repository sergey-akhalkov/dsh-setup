# Spec Delta

## MODIFIED Requirements

### Requirement: Turn-stopping gate

For every gated rule, the engine SHALL refuse a turn close unless a matching `PASS` or `ERROR` record exists for the rule and digest; it MUST steer with the rule id, digest, record path, and exact delegate call and MUST NOT accept a text claim. A soft rule MUST steer once per failure streak; a failed delegation MUST be reported and MUST NOT trap the turn. A stale record MUST never authorize a handoff. A change-scoped review rule MUST apply only in the change's owning thread. The engine MUST separate a worktree-level git failure from a per-change artifact problem: a missing or unreadable planning file in a change owned by the current thread (for example `tasks.md`) MUST NOT be reported as a worktree digest failure and MUST instead produce a distinct issue that names the change and its owning thread, or treat the change as not review-ready.

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

#### Scenario: Missing tasks.md in an owned change

- **WHEN** a turn is about to close in a change's owning thread and the change has no readable `tasks.md`
- **THEN** the gate names the change and its owning thread as a per-change artifact problem and does not report a worktree digest failure

#### Scenario: Worktree git failure

- **WHEN** the git status or diff command needed for the worktree digest fails
- **THEN** the gate reports the worktree digest failure and the git command to re-run

### Requirement: Thread-scoped review triggers

The gated automatic triggers for a change (`spec-ready`, `spec-task-ready`, `implementation-work`, `implementation-complete`, and the integration review) SHALL evaluate only in the change's owning thread. Another thread MUST NOT be steered to review a change it does not own. A review `delegate` call for a foreign change MUST fail with the owner and the next action before starting a target. `task_progress` notes, answer runs, and patch runs MUST remain available in any thread. Every snapshot captured for a thread (the turn-start baseline and the turn-end snapshot) MUST include only the changes that thread owns, so a foreign change's missing or unreadable artifacts MUST NOT set that thread's digest error, block its turn, or appear in its gate message.

#### Scenario: Owning thread reviews

- **WHEN** the owning thread checks a task or edits the spec of its change
- **THEN** its gate steers the spec/task/integration review as before

#### Scenario: Foreign thread not steered

- **WHEN** another thread opens the same workspace with the change's review missing or stale
- **THEN** its gate does not steer a review of that change and its turn closes without a foreign review obligation

#### Scenario: Foreign thread review refused

- **WHEN** a foreign thread calls delegate for a review rule on the change
- **THEN** the engine refuses before starting a target and names the owning thread and next action

#### Scenario: Foreign change missing tasks.md

- **WHEN** a thread opens the workspace while a change owned by another thread has no readable `tasks.md`
- **THEN** that thread's baseline and turn-end snapshots exclude the foreign change and its gate message carries no digest issue for it

### Requirement: Delegate tool and status

The bundle SHALL register a `delegate` tool whose rule parameter is generated from the configured rules and whose description names the manual tasks, a `task_progress` tool for unchecked-task notes, and a `delegation_status` tool that reports registered providers/capabilities, configured targets/rules, active/stale notes, each active change's owning thread and whether it is the current thread, and missing-target diagnostics. The tools MUST validate their rule/target/note inputs before starting a run or writing a note. A review delegate for a foreign change MUST be refused with the owning thread and next action. `delegation_status` MUST report an active change whose `tasks.md` is missing or unreadable as an unreadable per-change state, keep showing that change's owning thread and whether it is the current thread, and MUST NOT throw or run a review.

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

#### Scenario: Unreadable tasks in status

- **WHEN** delegation_status runs while an active change has no readable `tasks.md`
- **THEN** it reports that change's tasks as unreadable and returns normally
