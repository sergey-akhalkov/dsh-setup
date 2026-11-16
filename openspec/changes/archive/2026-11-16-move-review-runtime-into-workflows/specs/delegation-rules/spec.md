# Spec Delta

## MODIFIED Requirements

### Requirement: Gate-only retirement switch

The review engine SHALL support the per-signal gate switches
`gates.{workflowOwned,specReview,integrationReview,taskProgress,laneFanout}`. `workflowOwned: false`
disables only the task-review turn-stopping rule and the archive gate; `specReview: false` disables
only the whole-spec `spec-ready` rule; `integrationReview: false` disables only the
`implementation-complete` rule; `taskProgress: false` disables only the task-progress gate;
`laneFanout: false` disables only the lane-assignment and lane-boundary triggers. Every disabled
signal keeps its tools, rules data, queue, runs, records, and notes readable, and the `delegate` tool
MUST keep working. A `defer` definition or step whose signal is disabled MUST be refused, while a
`defer` step whose signal is enabled remains valid. The shipped configuration SHALL keep the rules —
including a dormant `implementation-work` note rule that the progress gate needs — and target
configured with all five switches false, so re-enabling one switch restores that steer without a
configuration edit. The `delegate` and `task_progress` compatibility tools SHALL route by effective
owner: the workflows runtime while the signal is owned, the legacy runtime and its state while the
signal is enabled. A `task_progress` or `note` call SHALL write the active progress owner's evidence
and SHALL update the active lane owner's serial state, so a mixed ownership combination satisfies
both gates.

#### Scenario: Review runtime remains

- **WHEN** `gates.workflowOwned` is false and a review is delegated
- **THEN** the review still queues, runs, and writes its record

#### Scenario: Aliases follow the owner

- **WHEN** one legacy signal is re-enabled and the steer prints a `delegate` or `task_progress` call
- **THEN** that call reaches the legacy runtime and writes the legacy state, so the restored gate is satisfied

#### Scenario: Mixed ownership note satisfies both

- **WHEN** only `gates.laneFanout` is enabled and the printed alternative is a serial `task_progress` note
- **THEN** the call writes the workflow progress evidence and the legacy lane assignment, so the lane gate is satisfied and the progress gate is not disturbed

#### Scenario: Dormant progress rule restores

- **WHEN** `gates.taskProgress` is true and a code-changing turn has neither a reviewed tick nor a note
- **THEN** the dormant `implementation-work` rule enforces the legacy progress gate again

#### Scenario: Workflow-owned gates are silent

- **WHEN** the switch is false and a checked task lacks a review
- **THEN** the delegation-rules task-review and archive gates do not steer or refuse

#### Scenario: Spec-review rule remains

- **WHEN** `gates.workflowOwned` is false and `gates.specReview` is true, and a change in this session's scope has no matching whole-spec review
- **THEN** the legacy `spec-ready` rule still refuses the close and steers the spec review

#### Scenario: Task-progress gate remains

- **WHEN** `gates.taskProgress` is true and a code-changing turn has neither a newly checked reviewed task nor a matching progress note
- **THEN** the task-progress gate still refuses the close and steers to a note or a reviewed tick

#### Scenario: Stale note is rejected

- **WHEN** `gates.taskProgress` is true and the worktree changes after a progress note
- **THEN** the task-progress gate still refuses the close because the note is stale

#### Scenario: Lane-assignment gate remains

- **WHEN** `gates.laneFanout` is true and completing one lane leaves a single unchecked unassigned lane, or an implementation turn below the checkpoint threshold leaves an unassigned lane
- **THEN** the lane-assignment gate still reports the lane and names the tagged worker or serial-note call

#### Scenario: Workflow owns the gate

- **WHEN** `gates.workflowOwned` is false and the `task-review` definition is `own`
- **THEN** the workflow starts the review through its own executor, refuses the close on FINDINGS or a missing record, allows an ERROR to close an intermediate turn without approving, requires a portable PASS for every checked task when the tick completes the list, and refuses the archive until a PASS exists

#### Scenario: Records are unchanged

- **WHEN** a switch changes
- **THEN** existing review records, queue state, and progress notes remain readable and are not rewritten

#### Scenario: Rollback

- **WHEN** one switch returns to true
- **THEN** only that signal steers again, its covering definition MUST return to `defer`, and the other signals are unaffected

### Requirement: Shipped strong Codex targets

The shipped setup defaults SHALL select the documented strong Codex model and `xhigh` reasoning
effort for the review target. The shipped apply SHALL add that selection as `reviewers.codex` in the
workflows row and SHALL keep the legacy `codex` target, its rules, and the `bundled:` instructions
configured under the false switches, so rollback restores them intact; Release B removes them. A
profile MAY override the reviewer; an unavailable model MUST fail the run with the model next action
and MUST NOT satisfy a gate.

#### Scenario: Strong read and write defaults

- **WHEN** the setup is installed with the shipped defaults
- **THEN** `reviewers.codex` selects the documented strong model and `xhigh` effort, and the delegation row keeps the same target for rollback

#### Scenario: Advisor target isolation

- **WHEN** a profile overrides `reviewers.codex`
- **THEN** no advisor target exists to weaken; a second opinion is a `codex_subagent` call whose registered provider row applies, because that tool takes no model or effort argument

#### Scenario: Unavailable model

- **WHEN** the configured model is unavailable to the account
- **THEN** the run reports the model error with its next action, publishes no PASS, and does not satisfy a gate; composition still succeeds

#### Scenario: Documented values

- **WHEN** a user reads the reviewer documentation
- **THEN** it names the shipped model and effort and shows how to override `reviewers.codex`
