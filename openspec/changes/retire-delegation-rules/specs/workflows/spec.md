# Spec Delta

## MODIFIED Requirements

### Requirement: Whole-spec review evidence

A whole-spec review record SHALL be read from `.dsh/workflows/records/spec-review/<change>/spec.json`.
The legacy `.dsh/delegation/spec-review/<change>/spec.json` path and the `defer` ownership path are
removed with the delegation plugin, so no enabled legacy switch can select a legacy record. The
record MUST match `rule: spec-review`, the change name, `phase: spec`, `scope: whole`, and a digest
equal to the current change spec digest; only `PASS` completes the step, while an `ERROR` allows an
intermediate close with the failure visible and MUST NOT approve. A task-scoped record MUST NOT
satisfy a whole-spec step.

#### Scenario: Whole-spec record completes the review step

- **WHEN** `.dsh/workflows/records/spec-review/auth/spec.json` has rule `spec-review`, change `auth`, phase `spec`, scope `whole`, verdict `PASS`, and the current spec digest
- **THEN** the review step is marked done with the record path and digest

#### Scenario: ERROR allows an intermediate close

- **WHEN** the whole-spec record is `ERROR` with the current digest and the turn has no other open obligation
- **THEN** the turn may close with the failure visible, no `PASS` exists, and the next close starts a new review

#### Scenario: Legacy record is not consulted

- **WHEN** only `.dsh/delegation/spec-review/auth/spec.json` exists
- **THEN** the step reads no record and its ownership cannot select a legacy path

#### Scenario: Stale whole-spec record blocks

- **WHEN** the record's digest differs from the current change spec digest
- **THEN** the step is not done and the close steers a fresh whole-spec review

#### Scenario: Task-scoped record is not whole-spec evidence

- **WHEN** only a task-scoped `PASS` exists for the change
- **THEN** the whole-spec step remains open

### Requirement: Retirement parity

A legacy gate behavior SHALL move to a workflow `own` definition only after a release-bound parity
report passes. The report SHALL be a tracked asset at `assets/parity/retire-legacy-gates.json`, replay
legacy scenarios in shadow, and include the covered template hashes. The replay SHALL run from a retained
executable baseline in the workflows test package that imports no deleted plugin code; a baseline change
MUST regenerate the report before `--check` passes again. `pnpm workflows:parity --check` MUST fail on a
missing, stale, or mismatched report or a missing baseline evaluator; a fresh installation SHALL load the
shipped report and `own` definitions. For a `soft` legacy signal the compared decision SHALL be the
per-turn sequence, and the shipped integration definition SHALL reproduce the legacy once-only
refusal with `maxBlocks: 1`; the visible violation recorded after an exhausted soft budget is the
declared, documented difference and MUST NOT count as a parity mismatch. An exhausted soft budget
SHALL settle that step as `completed-soft`, never as a pass, so the run keeps no open required step
and MUST NOT block an otherwise authorized archive. After the delegation plugin is removed, a
failing parity report is remedied by fixing the report, the retained baseline, or the definition; no
legacy switch is available to re-enable.

#### Scenario: Parity passes

- **WHEN** every legacy scenario produces the same allow/refuse decision in the workflow shadow run
- **THEN** the workflow definition may be `own`

#### Scenario: Soft signal keeps its refusal sequence

- **WHEN** the legacy soft integration rule refuses one close and allows the next
- **THEN** the workflow definition refuses the first close and allows the next with a recorded violation, and its parity entry passes

#### Scenario: Exhausted soft run does not block archive

- **WHEN** the integration run closed on its exhausted soft budget, every checked task has a PASS, and the intake receipt exists
- **THEN** the archive gate allows the archive and the integration run is reported as closed without a pass, never as an approval

#### Scenario: Parity mismatch has no legacy fallback

- **WHEN** a retained scenario mismatches after the plugin is removed
- **THEN** `pnpm workflows:parity --check` fails and the remedy names the report, the retained baseline, or the definition, not a legacy switch

#### Scenario: Fresh installation

- **WHEN** a fresh installation loads the shipped report and `own` definitions
- **THEN** the parity report is present and every bound definition loads

#### Scenario: Parity fails

- **WHEN** a retained scenario produces a different allow/refuse decision in shadow
- **THEN** `pnpm workflows:parity --check` fails with the scenario and the owned definition is refused

#### Scenario: Report is release-bound

- **WHEN** the release changes the tracked report without the matching template hashes
- **THEN** `--check` fails and the release is blocked

#### Scenario: Missing report at runtime

- **WHEN** a definition is `own` and the report is missing
- **THEN** the definition is refused and the remedy names `pnpm workflows:parity`

#### Scenario: Baseline outlives the runtime

- **WHEN** the delegation plugin is absent and every retained scenario still matches the retained executable baseline
- **THEN** `pnpm workflows:parity --check` passes and the `own` definitions load

#### Scenario: Edited baseline is stale

- **WHEN** a retained baseline decision changes without regenerating the tracked report
- **THEN** `--check` fails and names the stale report instead of certifying the edited baseline

### Requirement: Owned task-review gate

When `task-review` is `own`, the workflow SHALL start the review through the review executor only when
no matching PASS or ERROR record exists for the run's change and checked task; a matching record SHALL
settle the review step from that record without starting a review. It SHALL accept a matching PASS or
ERROR record as intermediate turn-close evidence and refuse the close while the record is FINDINGS or
missing. Before advancing any nonterminal task-review run it SHALL compare the run's checked task id
with `openspec/changes/<change>/tasks.md` and cancel the run as `superseded` when the id is absent,
regardless of which step is pending, and MUST NOT start a second run for the same change and task while
a live-session run for that pair is open. A failed review start SHALL be retried at most three times
across turn closes; after the cap the step SHALL remain failed and the run SHALL become `failed`
(terminal), and the turn-close gate MUST NOT refuse for that run's failed start. That terminal
exemption SHALL apply only to the failed start: the completion-coverage and work-progress checks SHALL
still refuse a final tick without a portable PASS, and the archive gate SHALL still require a PASS for
every checked task. `ERROR` MUST allow an intermediate turn close and MUST NOT approve.

#### Scenario: Review is started

- **WHEN** a task is checked, the workflow is `own`, and no matching review record exists
- **THEN** the workflow starts the review through the review executor and records the run

#### Scenario: Matching record settles the start step

- **WHEN** a checked task already has a matching PASS or ERROR record
- **THEN** the review step settles from that record without starting a review and the run advances to its coverage step

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

#### Scenario: Review runtime remains

- **WHEN** no legacy task-review rule exists
- **THEN** the review executor, its queue, and its records still work

### Requirement: Installed definitions

The engine SHALL ship the built-in process definitions: `task-review`, `spec-review`,
`integration-review`, `retro`, and `verify`. The three review definitions declare `own` and carry no
legacy source. `retro` and `verify` keep their surviving legacy source references (`goal-continuity`
`work_checkpoint` and `verification-gate`) and the per-signal ownership check that refuses them while
that source is enabled. `change-intake` SHALL be contributed by `@dsh-setup/plugin-openspec`. The review
definitions are the built-in process, not product-specific content: a new product-specific definition
MUST NOT be added without its own delta, and a contributed definition MUST run from the generic schema
and MUST NOT require a new id-specific engine behavior.

#### Scenario: Engine-shipped exceptions

- **WHEN** a fresh installation loads the engine definitions
- **THEN** `task-review`, `spec-review`, `integration-review`, `retro`, and `verify` load with their `own` ownership, and `retro` and `verify` keep their surviving legacy source references

#### Scenario: Contributed intake loads

- **WHEN** the OpenSpec plugin registers `change-intake` while the engine is available
- **THEN** it loads with the requirements, architecture, interface, create-change, spec, spec-review, and approval steps, and the spec-review step is owned by the review executor

#### Scenario: No new engine content

- **WHEN** a plugin contributes a definition
- **THEN** the engine lists and runs it without an engine release that names or hard-codes that definition id

### Requirement: Migration completion

The migration SHALL be complete: every retired gate has a passing parity entry, no retained legacy gate
remains, the `own` workflow is the only steer for that behavior, the legacy code and its tool and record
providers are deleted, and the setup defaults and docs name the workflow owner. Deleting the legacy code
is allowed only after the replacement has run in a live profile.

#### Scenario: Migration completes

- **WHEN** every retired parity entry passes and the replacement has run in a live profile
- **THEN** the setup defaults configure only the workflow engine, the docs name the workflow definitions, and no legacy gate or tool remains

#### Scenario: Replacement is proven

- **WHEN** the owner reads the Workflows view after a live run
- **THEN** the review, work-progress, lane, checkpoint, and verification obligations appear as workflow runs or engine gate cards with evidence

#### Scenario: Code is not deleted early

- **WHEN** the replacement has not completed a live profile run
- **THEN** the legacy code and tool providers remain available for rollback in the same change

### Requirement: Owned work-progress gate

The work-progress gate SHALL be owned by the engine: a code-changing turn SHALL be refused unless it
has a newly checked and reviewed task or a `note` action whose worktree digest matches the current
worktree. A stale note MUST NOT authorize the close and MUST NOT count as a `PASS`. The note SHALL be
written by the `note` action to `.dsh/workflows/notes/<change>.json` and SHALL be readable by any
session. The `note` action MUST require the change and the task id and MUST record a bounded reason
and a timestamp; it SHALL accept only `in-progress` or `blocked` and MUST reject an unknown or
checked task.

#### Scenario: Progress note fields and validation

- **WHEN** a `note` call names an unchecked task with status `in-progress` and a reason
- **THEN** the note records the change, task id, status, reason, timestamp, and current digest
- **AND WHEN** the same call names an unknown or checked task
- **THEN** the note is refused and nothing is written

#### Scenario: Unchecked task still needs a note

- **WHEN** a code-changing turn leaves its task unchecked and has no matching note
- **THEN** the gate steers to a note or a reviewed tick and the turn does not close for that gate

#### Scenario: Current note allows the close

- **WHEN** a code-changing turn carries a note whose worktree digest matches the current worktree
- **THEN** the gate allows the close with the task still unchecked

#### Scenario: Stale note is rejected

- **WHEN** the worktree digest changes after the note
- **THEN** the gate refuses the close and requires a fresh note or a reviewed tick

### Requirement: Owned lane-assignment gate

The engine SHALL own the lane-assignment gate: a plan with at least two non-serial lanes and an
unassigned lane with owned paths and an unchecked task SHALL require, per reported lane, a tagged
worker start or a serial note on an implementation turn. A `serial` heading is the tail. The gate SHALL
fail open on an unreadable `tasks.md`, a plan without level-2 headings, and a lane without owned paths.

#### Scenario: Gate fires on an implementation turn

- **WHEN** a turn ticks a task or changes implementation files and leaves an unassigned non-serial lane with owned paths
- **THEN** the gate reports that lane with its owned paths and the exact worker or serial-note call

#### Scenario: Lane is reported

- **WHEN** the turn ticks the last task of lane A and lane B is the only remaining unchecked lane in a plan with two non-serial lanes
- **THEN** the gate reports lane B with its owned paths and the exact worker or serial-note call

#### Scenario: Tagged worker assigns the lane

- **WHEN** a successful subagent, subagent_fork, spawn_teammate, or workflow start carries the printed `lane-tag: <change>#<n>`
- **THEN** that lane is assigned for this session and is not reported again

#### Scenario: Serial note assigns the lane

- **WHEN** a `note` action with a serial reason names a task in the lane
- **THEN** that lane is serial for this session and leaves the other lanes gated

## REMOVED Requirements

### Requirement: Gate-only switches

**Reason**: The delegation row and its per-signal switches are deleted with the plugin, so no delegation signal remains to enable or disable; the gates that replaced them are owned. The surviving checkpoint and verification legacy sources keep their per-signal ownership check, which is not delegation configuration.

**Migration**: Remove `delegation.gates` from every profile; the engine's `Configuration and off switch` keeps the `enabled` switch. A profile that still sets the deleted row or its gates fails at load with the removed row named.

### Requirement: Per-signal legacy ownership

**Reason**: The requirement resolved ownership for the five delegation signals, which are deleted with the plugin. The generic refusal rule and the checkpoint and verification signals describe plugins that survive, so they move to `Surviving legacy ownership`; the delegation signal clauses and their split-state scenarios are removed with the signal.

**Migration**: `Surviving legacy ownership` keeps the generic `own`/`defer` refusal and the checkpoint (`goal-continuity`) and verification (`verification-gate`) cases; delete only the delegation `legacy`/`ownership` blocks from local definitions and `change-intake`.
