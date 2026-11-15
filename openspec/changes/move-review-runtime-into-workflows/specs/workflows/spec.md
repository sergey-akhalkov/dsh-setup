# Spec Delta

## MODIFIED Requirements

### Requirement: Whole-spec review evidence

A whole-spec review record SHALL be read from the path its step's ownership selects: an `own` step
reads `.dsh/workflows/records/spec-review/<change>/spec.json`, a `defer` step reads the enabled legacy
`.dsh/delegation/spec-review/<change>/spec.json`. The record MUST match `rule: spec-review`, the
change name, `phase: spec`, `scope: whole`, and a digest equal to the current change spec digest; only
`PASS` completes the step, while an `ERROR` allows an intermediate close with the failure visible and
MUST NOT approve. A task-scoped record MUST NOT satisfy a whole-spec step.

#### Scenario: Whole-spec record completes the review step

- **WHEN** `.dsh/workflows/records/spec-review/auth/spec.json` has rule `spec-review`, change `auth`, phase `spec`, scope `whole`, verdict `PASS`, and the current spec digest
- **THEN** the review step is marked done with the record path and digest

#### Scenario: Deferred step reads the legacy record

- **WHEN** a `defer` step's signal is enabled and `.dsh/delegation/spec-review/auth/spec.json` has a current whole-spec PASS
- **THEN** the step completes from the legacy record and no workflows record is required

#### Scenario: ERROR allows an intermediate close

- **WHEN** the whole-spec record is `ERROR` with the current digest and the turn has no other open obligation
- **THEN** the turn may close with the failure visible, no `PASS` exists, and the next close starts a new review

#### Scenario: Stale whole-spec record blocks

- **WHEN** a whole-spec `PASS` record's digest does not match the current change artifacts
- **THEN** the step is blocked with `record-mismatch`

#### Scenario: Task-scoped record is not whole-spec evidence

- **WHEN** only a task-scoped record exists under the change's `reviews/` directory
- **THEN** the review step stays blocked with `record-mismatch`

### Requirement: Deferred spec-review

The contributed `spec-review` step SHALL be owned and SHALL start the whole-spec review through the
review executor only when no current whole-spec PASS or ERROR record exists for the change. A matching
PASS SHALL complete the step; a matching ERROR SHALL allow an intermediate close with the failure
visible, MUST NOT approve, and SHALL let the next close start a new review.

#### Scenario: Deferred spec-review does not dispatch

- **WHEN** the intake reaches the `spec-review` step and a current whole-spec PASS record already exists
- **THEN** the engine settles the step from that record and starts no review

#### Scenario: Legacy gate supplies the review

- **WHEN** the review executor writes a current whole-spec PASS record for the change
- **THEN** the step completes from that record without a second review run

### Requirement: Owned task-review gate

When `task-review` is `own`, the workflow SHALL start the review through the review executor only
when no matching PASS or ERROR record exists for the run's change and checked task; a matching record
SHALL settle the review step from that record without starting a review. It SHALL accept a matching
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

### Requirement: Retirement parity

A legacy gate behavior SHALL move to a workflow `own` definition only after a release-bound parity
report passes. The report SHALL be a tracked asset at `assets/parity/retire-legacy-gates.json`,
replay legacy scenarios in shadow, and include the covered template hashes.
`pnpm workflows:parity --check` MUST fail on a missing, stale, or mismatched report; a fresh
installation SHALL load the shipped report and `own` definitions; the release MUST NOT disable a
legacy gate without a passing report. For a `soft` legacy signal the compared decision SHALL be the
per-turn sequence, and the shipped integration definition SHALL reproduce the legacy once-only
refusal with `maxBlocks: 1`; the visible violation recorded after an exhausted soft budget is the
declared, documented difference and MUST NOT count as a parity mismatch. An exhausted soft budget
SHALL settle that step as `completed-soft`, never as a pass, so the run keeps no open required step
and MUST NOT block an otherwise authorized archive.

#### Scenario: Parity passes

- **WHEN** every legacy scenario produces the same allow/refuse decision in the workflow shadow run
- **THEN** the tracked report covers the template hashes and the migration may flip the ownership

#### Scenario: Soft signal keeps its refusal sequence

- **WHEN** the legacy soft integration rule refuses one close and allows the next
- **THEN** the workflow definition refuses the first close and allows the next with a recorded violation, and its parity entry passes

#### Scenario: Exhausted soft run does not block archive

- **WHEN** the integration run closed on its exhausted soft budget, every checked task has a PASS, and the intake receipt exists
- **THEN** the archive gate allows the archive and the integration run is reported as closed without a pass, never as an approval

#### Scenario: Fresh installation

- **WHEN** the setup is installed on a workspace with no history
- **THEN** the shipped parity report, the settings matrix, and the matching `own` definitions are present, their template hashes match, and all load successfully

#### Scenario: Parity fails

- **WHEN** one scenario differs, the report is missing, a template hash changed, or a gate status is not `pass`
- **THEN** the `own` definition is refused at load and the release does not ship defaults that disable the matching legacy signal

#### Scenario: Report is release-bound

- **WHEN** a definition template changes after the report was generated
- **THEN** `pnpm workflows:parity --check` fails with the definition id and the expected and actual template hash, and the release is blocked

#### Scenario: Missing report at runtime

- **WHEN** an installed profile has no readable or matching report
- **THEN** the loader refuses the `own` definition with the report path, the expected and actual hash, and the legacy switch to re-enable

### Requirement: Gate-only switches

The migration SHALL use per-signal gate-only switches: `checkpoint.automation: false`,
`delegation.gates.{workflowOwned,specReview,integrationReview,taskProgress,laneFanout}`, and the
disabled verification-gate row. Each delegation switch SHALL stop exactly one legacy signal:
`workflowOwned` the task-review turn-stopping rule and the archive gate, `specReview` the whole-spec
rule, `integrationReview` the `implementation-complete` rule, `taskProgress` the work-progress gate,
and `laneFanout` the lane-assignment and lane-boundary triggers. Every other signal SHALL keep
steering while its own switch is true.

#### Scenario: One config flip

- **WHEN** the owner disables one legacy signal and changes nothing else
- **THEN** the workflow loads, the shipped definition for that signal resolves to `own`, that legacy signal no longer steers, and every other signal keeps its state

#### Scenario: Spec-review signal is retained

- **WHEN** `gates.workflowOwned` is false and `gates.specReview` is true
- **THEN** the whole-spec `spec-review` rule still steers a missing spec review

#### Scenario: Switch alone restores the definition

- **WHEN** the owner re-enables one legacy signal without editing any definition
- **THEN** the shipped definition for that signal resolves to `defer`, the legacy signal steers, and every unrelated gate keeps steering

### Requirement: Per-signal legacy ownership

Legacy ownership SHALL be resolved per declared signal, not per provider. A shipped definition or
step SHALL resolve its effective ownership from the switch: while the matching legacy signal is
enabled it is effectively `defer`, and while the signal is disabled it is `own`, so a switch flip
alone changes the owner. An explicit local override that contradicts the switch MUST be refused at
load, naming both sides. A `defer` definition or step MUST be refused unless its signal is enabled,
and an `own` definition or step that does not resolve from the switch MUST be refused while its
signal is enabled. The `spec-review` signal follows `gates.specReview`, the `implementation-complete`
signal follows `gates.integrationReview`, the task-review and archive signals follow
`gates.workflowOwned`, the work-progress signal follows `gates.taskProgress`, the lane signals follow
`gates.laneFanout`, `work_checkpoint` follows `checkpoint.automation`, and verification follows its
row configuration. An engine-owned gate SHALL resolve ownership from the same signal: the
work-progress gate is active only while `gates.taskProgress` is false, and the lane-assignment gate
only while `gates.laneFanout` is false; re-enabling a signal SHALL disable its workflow counterpart
and MUST refuse the split state. The work-progress gate SHALL read task-review evidence from the
active review owner's record path: the workflows store while the review signal is owned, the legacy
store while it is enabled.

#### Scenario: Intake own steps load beside the retained spec-review signal

- **WHEN** `change-intake` is `own` for its steps and the spec-review signal is disabled
- **THEN** the intake loads and its spec-review step starts the review through the review executor

#### Scenario: Intake spec-review defer loads after the switch

- **WHEN** `change-intake` has its `spec-review` step `defer`, the `specReview` switch is true, and `delegation.gates.workflowOwned` is false
- **THEN** the intake loads, the step reads the legacy spec-review record without adding a second steer, and it does not dispatch its executor

#### Scenario: Missing spec review still steers

- **WHEN** the intake's `spec-review` step is `defer` and a change has no matching spec-review PASS while the `specReview` switch is true
- **THEN** the legacy `spec-ready` rule steers the spec review and the intake step remains open

#### Scenario: Task-review defer with the switch off is refused

- **WHEN** `task-review` is `defer` and `delegation.gates.workflowOwned` is false
- **THEN** the definition is refused because its matching signal is disabled

#### Scenario: Defer with the checkpoint switch off is refused

- **WHEN** `retro` is `defer` and `checkpoint.automation` is false
- **THEN** the definition is refused and neither owner is silently left enforcing the checkpoint

#### Scenario: Defer with the verification row disabled is refused

- **WHEN** a `verify` definition is `defer` and the verification-gate row is disabled
- **THEN** the definition is refused and neither owner is silently left enforcing verification

#### Scenario: Defer with an inert verification row is refused

- **WHEN** a `verify` definition is `defer` and the verification-gate row is active but has no configured command
- **THEN** the definition is refused because the row would not steer

#### Scenario: Enabled defer loads

- **WHEN** the definition is `defer` and its matching legacy signal is enabled
- **THEN** the definition loads and reads the legacy record without adding a second steer

#### Scenario: Installed but inert source does not block own

- **WHEN** the definition is `own` and the matching legacy source is installed but its signal is disabled
- **THEN** the definition loads and the disabled source does not steer

#### Scenario: Split state is refused

- **WHEN** the definition is `own` while the matching legacy signal is still enabled
- **THEN** the definition is refused with the split-state diagnostic and the switch that MUST be turned off

#### Scenario: Rollback

- **WHEN** the owner re-enables one legacy signal and returns the covering definition to `defer`
- **THEN** that legacy signal steers again, the workflow adds no second steer, and the other signals keep their state

#### Scenario: Engine gate yields to the restored signal

- **WHEN** the owner re-enables `gates.taskProgress` or `gates.laneFanout`
- **THEN** the matching engine-owned gate stops steering, every unrelated gate keeps steering, and the split state is refused at load

#### Scenario: Progress sees the active review owner's evidence

- **WHEN** only `gates.taskProgress` is enabled and the final task was checked and reviewed by the native executor
- **THEN** the legacy progress gate reads that native PASS, closes without demanding a legacy record, and does not require a progress note

#### Scenario: Contradicting override is refused

- **WHEN** a local definition declares `own` while its legacy signal is enabled, or `defer` while it is disabled
- **THEN** the load is refused with the definition, the declaration, the switch, and the remedy

### Requirement: Configuration and off switch

The engine SHALL be configured by `enabled`, `maxBlocks`, `maxRuns`, `definitionsDir`,
`runRetentionDays`, `allowIntent`, `checkpointApplicability` (`minToolCalls` default 4,
`requireWrite` default true), `reviewers`, `reviewQueue`, and `timeouts.review` (default 600000),
validated fail-loud. `checkpointApplicability` MUST mirror the installed goal-continuity checkpoint
settings; docs state this. `enabled: false` SHALL stop new runs and steers while keeping existing
run records readable. A configuration error MUST fail plugin load with the field.

#### Scenario: Defaults apply

- **WHEN** the row omits the workflow config
- **THEN** the engine is enabled with the documented defaults, an empty `reviewers` map, and the default review queue

#### Scenario: Applicability defaults and override

- **WHEN** the row omits `checkpointApplicability`
- **THEN** `minToolCalls` is 4 and `requireWrite` is true; an explicit value replaces the default and an out-of-range value fails load with the field

#### Scenario: Invalid configuration

- **WHEN** `maxBlocks` is zero, `runRetentionDays` is negative, `reviewQueue.concurrency` is outside 1 to 4, or a reviewer sets `model` for a provider without `agentOptions` support
- **THEN** plugin load fails with the field and accepted range or capability

#### Scenario: Disabled engine

- **WHEN** `enabled` is false
- **THEN** no new run or steer starts and existing run records remain readable

### Requirement: Installed definitions

The engine SHALL ship the built-in process definitions: `task-review`, `spec-review`,
`integration-review`, `retro`, and `verify`. The review definitions declare `own` and resolve their
effective ownership from the matching legacy switch. `change-intake` SHALL be contributed by
`@dsh-setup/plugin-openspec`. The review definitions are the built-in process, not product-specific
content: a new product-specific definition MUST NOT be added without its own delta, and a
contributed definition MUST run from the generic schema and MUST NOT require a new id-specific
engine behavior.

#### Scenario: Engine-shipped exceptions

- **WHEN** a fresh installation loads the engine definitions
- **THEN** `task-review`, `spec-review`, `integration-review`, `retro`, and `verify` load with their `own` ownership and the setup's legacy switches stay off

#### Scenario: Contributed intake loads

- **WHEN** the OpenSpec plugin registers `change-intake` while the engine is available
- **THEN** it loads with the requirements, architecture, interface, create-change, spec, spec-review, and approval steps, and the spec-review step is owned by the review executor

#### Scenario: No new engine content

- **WHEN** a plugin contributes a definition
- **THEN** the engine lists and runs it without an engine release that names or hard-codes that definition id

### Requirement: Retained gate retirement

This change SHALL retire the retained `spec-review`, work-progress, and lane gates with a workflow
replacement for every retained case, a passing release-bound parity entry, and the matching legacy
switch disabled in the same change. A future change that makes a legacy gate retained again MUST use
the same path: reproduce every case in a workflow, cover it in the parity report, and disable the
legacy switch in the same change.

#### Scenario: Later retirement is parity-gated

- **WHEN** a later change proposes to retire a retained gate
- **THEN** the workflow reproduces every retained case, the release-bound report covers it, and the legacy gate is disabled in the same change

### Requirement: Migration completion

The migration SHALL be complete when every retired gate has a passing parity entry, the matching
gate-only switch is off, the `own` workflow is the only steer for that behavior, no retained legacy
gate remains, and the setup defaults and docs name the workflow owner. The legacy code and its tool
and record providers MAY be deleted only in a later change, after the replacement has run in a live
profile.

#### Scenario: Migration completes

- **WHEN** every retired parity entry passes and the matching switches are off
- **THEN** the setup defaults disable the legacy signals, the docs name the workflow definitions, and no retained legacy gate remains enabled

#### Scenario: Replacement is proven

- **WHEN** the owner reads the Workflows view after a live run
- **THEN** the review, work-progress, lane, checkpoint, and verification obligations appear as workflow runs or engine gate cards with evidence

#### Scenario: Code is not deleted early

- **WHEN** the replacement has not completed a live profile run
- **THEN** the legacy code and tool providers remain available for rollback in the same change

## ADDED Requirements

### Requirement: Review executor

A step MAY use the `review` executor with a `target`, an `instruction`, a `scope` (`whole` or
`task`), and an optional `phase`. The engine SHALL resolve the target from `reviewers`, run the
reviewer with the configured model and effort, accept exactly one fenced JSON verdict that echoes the
prepared digest, write the record, and settle the step from a matching record. A malformed verdict, a
digest mismatch, a target failure, or a timeout SHALL write an `ERROR` record and publish no `PASS`.

#### Scenario: Task review reads a frozen snapshot

- **WHEN** a task-scope review starts
- **THEN** it reads a frozen worktree snapshot taken at the start, so a later write neither enters nor invalidates its evidence

#### Scenario: Task review settles from its record

- **WHEN** a task-scope review returns PASS for the prepared snapshot digest
- **THEN** the local record and the committed approval are written and the step is marked done with the record path

#### Scenario: Malformed verdict writes an error

- **WHEN** the reviewer returns prose, two fenced blocks, an invalid severity, or a digest that does not match
- **THEN** an `ERROR` record is written, no `PASS` exists, and the run names the failure and the next action

#### Scenario: Changed whole-scope inputs discard the verdict

- **WHEN** a git-visible reviewed input changes while a whole-scope review runs
- **THEN** the verdict is discarded, no `PASS` is published, and the error names the changed paths

### Requirement: Review condition

A trigger MAY declare a `condition`: a bounded JSONLogic predicate over the event, the change's
checked and unchecked tasks and lanes, the current whole-spec and task records with their digests,
the current spec and worktree digests, and the session's involvement. The engine SHALL evaluate it at
every turn close and MUST refuse a predicate that is not JSONLogic or names an unknown context field.
A false condition SHALL produce no run and no steer.

#### Scenario: Condition gates the run

- **WHEN** the trigger fires and its condition is false
- **THEN** no run starts and no steer is emitted

#### Scenario: Condition sees the records and digests

- **WHEN** a condition references `records.spec.pass` and `digests.spec`
- **THEN** it evaluates against the current whole-spec record and the current change artifact digest

#### Scenario: Involvement sources are bounded

- **WHEN** a condition reads `session.involved`
- **THEN** it is true for the session's own write/edit, change creation, persisted involvement, or a supported shell write (Set-Content, Add-Content, Out-File, New-Item, Copy-Item, Move-Item, Rename-Item, Remove-Item, cp, mv, rm, touch, tee, redirection, or pipeline); a shell form outside that set does not establish involvement in Release A

#### Scenario: Invalid condition fails load

- **WHEN** a definition's `condition` is not JSONLogic or names an unknown context field
- **THEN** the definition is refused at load with the definition and field

### Requirement: Reviewer configuration

The row SHALL accept `reviewers` as a map of reviewer ids to `provider`, optional `model`, optional
`reasoningEffort`, and optional provider-supported `agentOptions`. A review step SHALL name a
reviewer id and never a provider. A target whose provider is missing MUST be reported by the status
surface and by the run with the target id and provider name, and MUST NOT fail plugin load. Options
MUST be forwarded only to a provider that declares `agentOptions` support.

#### Scenario: Reviewer selection

- **WHEN** a review step names `reviewers.codex`
- **THEN** the engine starts the provider with the configured model and effort and records the reviewer id

#### Scenario: Missing provider is reported

- **WHEN** a configured reviewer names a provider that is not registered
- **THEN** the run fails with the target id, the provider name, and the next action, and composition still succeeds

#### Scenario: Unsupported option is refused

- **WHEN** a reviewer sets `model` and the provider does not declare `agentOptions` support
- **THEN** the run is refused before starting with the target, the provider, and the unsupported capability

### Requirement: Review record store

Review records SHALL live under `.dsh/workflows/records/<definition>/<change>/` as `<phase>.json` for
whole scope and `tasks/<taskId>.json` for task scope. A task-scope `PASS` SHALL also write
`openspec/changes/<change>/reviews/<taskId>.json` atomically and before the local record; a failed
write SHALL publish an `ERROR` and no `PASS`. The committed approval MUST keep its unchanged field
set and stay portable: no session id, run id, machine path, or error text.

#### Scenario: Local and committed records are written

- **WHEN** a task review returns PASS
- **THEN** the committed approval is written first and the local record second, and both carry the same digest and verdict

#### Scenario: Failed approval publication publishes nothing

- **WHEN** the committed approval cannot be written
- **THEN** the local record becomes `ERROR`, no `PASS` exists, and the run names the failed path

#### Scenario: Committed approval is portable

- **WHEN** a fresh clone runs the approval audit for a change with committed approvals and no `.dsh` state
- **THEN** every approval is readable and the audit result is unchanged

### Requirement: Owned work-progress gate

The work-progress gate SHALL be owned by the engine: a code-changing turn SHALL be refused unless
it has a newly checked and reviewed task or a `note` action whose worktree digest matches the
current worktree. It SHALL be active only while `gates.taskProgress` is false. A stale note MUST NOT
authorize the close and MUST NOT count as a `PASS`. The note SHALL be written by the `note` action to
`.dsh/workflows/notes/<change>.json` and SHALL be readable by any session.

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
worker start or a serial note on an implementation turn. A `serial` heading is the tail. The gate
SHALL be active only while `gates.laneFanout` is false and SHALL fail open on an unreadable
`tasks.md`, a plan without level-2 headings, and a lane without owned paths.

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

### Requirement: Review contract surface

The Workflows surface SHALL render a review step's contract and each engine-owned gate as separate
card kinds. A review step's inspector SHALL show the instruction id and prompt summary, the scope and
phase, the digest scope, the verdict schema, the reuse policy, and the record path. An engine-owned
gate SHALL render as a read-only contract card with its trigger condition, evidence, record path, and
steer payload, and MUST NOT render as an editable definition node or in the definition rail.

#### Scenario: Review contract is visible

- **WHEN** the owner opens a review step
- **THEN** the inspector shows the prompt, the digest scope, the verdict schema, the reuse policy, and the record path

#### Scenario: Engine gate is a card, not a definition

- **WHEN** the owner opens the Workflows overview
- **THEN** each engine-owned gate appears as a read-only contract card and no gate appears in the definition rail

## REMOVED Requirements

### Requirement: Retained task-progress gate

**Reason**: The gate moves into the engine as the owned work-progress gate with the same cases (unchecked task needs a note, a current note allows the close, a stale note is refused), so the retained-gate exception no longer exists.

**Migration**: Configure `delegation.gates.taskProgress: false` and use the `note` action; `task_progress` stays as a deprecated alias for one release.

### Requirement: Retained lane-assignment gate

**Reason**: The lane-assignment obligation moves into the engine as the owned lane-assignment gate, keeping the reported cases (a single remaining lane, an implementation turn below the checkpoint threshold) and the tagged-worker and serial-note satisfaction.

**Migration**: Configure `delegation.gates.laneFanout: false`; the engine reports the same lanes with the same payload.
